
// services/predictiveModel.ts

import type { Position, Kline } from '../types';

export interface WinProbabilityFactors {
    pnlR: number;
    remainingRR: number;
    mfeEfficiency: number;
    stagnationPenalty: number;
    breakevenBonus: number;
    rsiAlignment: number;
    volumeSupport: number;      // Is volume growing in trade direction?
    emaStructure: number;       // Is price above/below key EMAs?
    momentumScore: number;      // Short-term price rate of change
}

export interface WinProbabilityResult {
    probability: number;        // 0-100
    factors: WinProbabilityFactors;
    trend: 'improving' | 'declining' | 'stable';
    shouldEarlyExit: boolean;   // Proactive: model sees deterioration ahead
    earlyExitReason?: string;
}

function computeRSI(klines: Kline[], period = 14): number {
    if (klines.length < period + 1) return 50;
    const closes = klines.slice(-(period + 1)).map(k => k.close);
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d > 0) gains += d; else losses -= d;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
}

function computeEMA(values: number[], period: number): number {
    if (values.length < period) return values[values.length - 1] ?? 0;
    const k = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) {
        ema = values[i] * k + ema * (1 - k);
    }
    return ema;
}

function sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
}

export function calculateWinProbability(
    position: Position,
    currentPrice: number,
    klines: Kline[],
    probabilityHistory?: number[]
): WinProbabilityResult {
    const isLong = position.direction === 'LONG';

    const initialRisk = position.initialRiskInPrice > 0
        ? position.initialRiskInPrice
        : Math.abs(position.entryPrice - position.initialStopLossPrice);

    if (initialRisk <= 0) {
        return {
            probability: 50,
            factors: { pnlR: 0, remainingRR: 1, mfeEfficiency: 1, stagnationPenalty: 0, breakevenBonus: 0, rsiAlignment: 0, volumeSupport: 0, emaStructure: 0, momentumScore: 0 },
            trend: 'stable',
            shouldEarlyExit: false,
        };
    }

    // --- Factor Calculation ---

    // 1. Current P&L in R-units
    const pnlInPrice = (currentPrice - position.entryPrice) * (isLong ? 1 : -1);
    const pnlR = pnlInPrice / initialRisk;

    // 2. Remaining R:R (distance to TP vs distance to current SL)
    const distToTP = Math.abs(position.takeProfitPrice - currentPrice);
    const distToSL = Math.abs(currentPrice - position.stopLossPrice);
    const remainingRR = distToSL > 0 ? distToTP / distToSL : 2;

    // 3. MFE Efficiency: how much of our peak profit we're still holding
    const peakPnlInPrice = (position.peakPrice - position.entryPrice) * (isLong ? 1 : -1);
    const peakPnlR = peakPnlInPrice / initialRisk;
    let mfeEfficiency = 1;
    if (peakPnlR > 0.25) {
        mfeEfficiency = Math.max(0, Math.min(1, pnlR / peakPnlR));
    }

    // 4. Stagnation penalty: time-weighted decay (scales with timeframe awareness)
    // 18 candles for 5m = 1.5h; reasonable starting point
    const stagnationStart = 18;
    const stagnationPenalty = Math.min(1, Math.max(0, (position.candlesSinceEntry - stagnationStart) / 25));

    // 5. Breakeven bonus: if SL is at/above entry we cannot lose (ignoring fees)
    const breakevenBonus = position.isBreakevenSet ? 1 : 0;

    // 6. RSI alignment with trade direction
    const rsi = computeRSI(klines, 14);
    let rsiAlignment = 0;
    if (isLong) {
        if (rsi > 55) rsiAlignment = Math.min(1, (rsi - 55) / 25);
        else if (rsi < 45) rsiAlignment = Math.max(-1, (rsi - 45) / 25);
    } else {
        if (rsi < 45) rsiAlignment = Math.min(1, (45 - rsi) / 25);
        else if (rsi > 55) rsiAlignment = Math.max(-1, (55 - rsi) / 25);
    }

    // 7. Volume Support: is volume trending in the direction of the trade?
    // Compare recent 3-candle avg volume vs prior 10-candle avg volume
    let volumeSupport = 0;
    if (klines.length >= 15) {
        const recentVols = klines.slice(-4, -1).map(k => k.volume || 0);
        const priorVols = klines.slice(-14, -4).map(k => k.volume || 0);
        const recentAvg = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
        const priorAvg = priorVols.reduce((a, b) => a + b, 0) / priorVols.length;

        // Check if recent candles are moving in our direction with volume
        const recentCandles = klines.slice(-4, -1);
        const directedVolumeRatio = recentCandles.reduce((acc, k) => {
            const isBullish = k.close > k.open;
            return acc + (isLong ? (isBullish ? k.volume || 0 : -(k.volume || 0)) : (isBullish ? -(k.volume || 0) : (k.volume || 0)));
        }, 0) / (recentAvg * recentCandles.length || 1);

        // volumeSupport: -1 to +1
        volumeSupport = Math.max(-1, Math.min(1, directedVolumeRatio * (recentAvg / (priorAvg || 1))));
    }

    // 8. EMA Structure: is price on the right side of EMA20 and EMA50?
    let emaStructure = 0;
    if (klines.length >= 52) {
        const closes = klines.map(k => k.close);
        const ema20 = computeEMA(closes, 20);
        const ema50 = computeEMA(closes, 50);

        // Each EMA alignment adds/subtracts 0.5
        const aboveEma20 = currentPrice > ema20;
        const aboveEma50 = currentPrice > ema50;
        const ema20Aligned = isLong ? aboveEma20 : !aboveEma20;
        const ema50Aligned = isLong ? aboveEma50 : !aboveEma50;

        emaStructure = (ema20Aligned ? 0.5 : -0.5) + (ema50Aligned ? 0.5 : -0.5);

        // Extra boost if EMAs are stacked in our direction (EMA20 > EMA50 for longs)
        if (isLong && ema20 > ema50) emaStructure = Math.min(1, emaStructure + 0.25);
        else if (!isLong && ema20 < ema50) emaStructure = Math.min(1, emaStructure + 0.25);
    }

    // 9. Momentum Score: short-term Rate of Change (3-period)
    let momentumScore = 0;
    if (klines.length >= 5) {
        const closeNow = klines[klines.length - 1].close;
        const close3 = klines[klines.length - 4].close;
        if (close3 > 0) {
            const roc3 = (closeNow - close3) / close3;
            // Normalise to ±1 using a ±0.5% threshold
            momentumScore = Math.max(-1, Math.min(1, roc3 / 0.005)) * (isLong ? 1 : -1);
        }
    }

    // --- Logit (log-odds) composition ---
    let logit = 0;

    // P&L contribution — strongest signal
    logit += Math.max(-2.5, Math.min(3.0, pnlR)) * 1.1;

    // Remaining R:R — more R still on offer = good
    logit += (Math.min(remainingRR, 5) - 1) * 0.35;

    // MFE pull-back — pulling away from peak is a warning
    if (peakPnlR > 0.25) {
        logit -= (1 - mfeEfficiency) * 0.8;
    }

    // Stagnation — decaying probability the longer nothing happens
    logit -= stagnationPenalty * 0.7;

    // Breakeven — effectively guaranteed positive outcome
    logit += breakevenBonus * 0.6;

    // RSI alignment — mild contextual factor
    logit += rsiAlignment * 0.35;

    // Volume support — moderately important
    logit += volumeSupport * 0.4;

    // EMA structure — structural context
    logit += emaStructure * 0.45;

    // Momentum — short-term signal
    logit += momentumScore * 0.3;

    const probability = Math.max(2, Math.min(98, Math.round(sigmoid(logit) * 100)));

    // Trend from history
    let trend: WinProbabilityResult['trend'] = 'stable';
    if (probabilityHistory && probabilityHistory.length >= 4) {
        const recent = probabilityHistory.slice(-4);
        const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
        if (probability > avg + 3) trend = 'improving';
        else if (probability < avg - 3) trend = 'declining';
    }

    // --- Early Exit Assessment (forward-looking) ---
    // Recommend early exit if multiple bearish conditions converge:
    let shouldEarlyExit = false;
    let earlyExitReason: string | undefined;

    const earlyExitConditions: string[] = [];
    if (pnlR < -0.3) earlyExitConditions.push('position in drawdown');
    if (mfeEfficiency < 0.3 && peakPnlR > 0.5) earlyExitConditions.push('severe pullback from peak');
    if (stagnationPenalty > 0.6) earlyExitConditions.push('prolonged stagnation');
    if (emaStructure < -0.5) earlyExitConditions.push('EMA structure against trade');
    if (volumeSupport < -0.5) earlyExitConditions.push('volume opposing trade');
    if (trend === 'declining' && probabilityHistory && probabilityHistory.length >= 6) {
        const last6 = probabilityHistory.slice(-6);
        const allDeclining = last6.every((v, i) => i === 0 || v <= last6[i - 1] + 2);
        if (allDeclining) earlyExitConditions.push('consistent probability decline');
    }

    // Exit if probability < 25% AND at least 2 bearish conditions confirm
    if (probability < 25 && earlyExitConditions.length >= 2) {
        shouldEarlyExit = true;
        earlyExitReason = `Low conviction (${probability}%): ${earlyExitConditions.slice(0, 2).join(', ')}.`;
    }
    // Also flag if probability is in freefall (10+ point drop in last 3 ticks) and in loss
    if (!shouldEarlyExit && pnlR < 0 && probabilityHistory && probabilityHistory.length >= 3) {
        const last3 = probabilityHistory.slice(-3);
        const drop = last3[0] - probability;
        if (drop >= 10) {
            shouldEarlyExit = true;
            earlyExitReason = `Rapid probability collapse (−${drop}pts in 3 ticks) while in loss.`;
        }
    }

    return {
        probability,
        factors: { pnlR, remainingRR, mfeEfficiency, stagnationPenalty, breakevenBonus, rsiAlignment, volumeSupport, emaStructure, momentumScore },
        trend,
        shouldEarlyExit,
        earlyExitReason,
    };
}
