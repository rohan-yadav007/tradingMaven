// services/agents/sentinel.ts

import { Kline, BotConfig, MarketDataContext, TradeSignal, SentinelAnalysis, ADXOutput, BollingerBandsOutput } from '../../types';
import { EMA, RSI, ADX, BollingerBands, ATR, SMA } from 'technicalindicators';
import { getLast, detectRsiDivergence } from './agentUtils';

export const getTheSentinelSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<typeof config.agentParams>;
    const minKlines = Math.max(200, params.sentinel_emaSlowPeriod!);
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for The Sentinel (${klines.length}/${minKlines} candles).`] };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];

    // --- 1. INDICATOR CALCULATIONS ---
    const emaFast = getLast(EMA.calculate({ period: params.sentinel_emaFastPeriod!, values: closes }))! as number;
    const emaSlow = getLast(EMA.calculate({ period: params.sentinel_emaSlowPeriod!, values: closes }))! as number;
    const rsiValues = RSI.calculate({ values: closes, period: params.sentinel_rsiPeriod! });
    const rsi = getLast(rsiValues)! as number;
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.sentinel_adxPeriod! }))! as ADXOutput;
    const bbValues = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    const bb = getLast(bbValues)! as BollingerBandsOutput;
    const atr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }))! as number;

    // --- 2. VETO FILTERS (DYNAMIC & CONTEXT-AWARE) ---
    // A. EMA Distance Veto: Prevent entering trades too far from the mean.
    const emaDistance = Math.abs(emaFast - emaSlow);
    if (emaDistance > atr * params.sentinel_emaDistanceVetoThreshold) {
        return { signal: 'HOLD', reasons: [`❌ VETO: Price is over-extended from EMAs (Distance > ${params.sentinel_emaDistanceVetoThreshold}x ATR)`] };
    }

    // B. Volatility Squeeze Veto: Only trade when volatility is present.
    const bbWidth = (bb.upper - bb.lower) / bb.middle;
    const dynamicBbwThreshold = (atr / currentPrice) * 0.5; // Factor of 0.5 is a sensible default
    if (bbWidth < dynamicBbwThreshold) {
        return { signal: 'HOLD', reasons: [`ℹ️ Standby: Low volatility squeeze detected (BBW ${bbWidth.toFixed(4)} < Threshold ${dynamicBbwThreshold.toFixed(4)})`] };
    }
    reasons.push(`✅ Volatility: OK (BBW: ${bbWidth.toFixed(4)})`);


    // --- 3. WEIGHTED CHECKLIST SCORING ---
    const scores = {
        bullish: { trend: 0, alignment: 0, volatility: 0, momentum: 0 },
        bearish: { trend: 0, alignment: 0, volatility: 0, momentum: 0 }
    };
    const WEIGHTS = { trend: 40, alignment: 30, volatility: 20, momentum: 10 };

    // Pillar 1: Trend (ADX) - 40 points
    if (adx.adx > params.sentinel_strongTrendAdx) {
        reasons.push(`✅ Trend: Strong (ADX ${adx.adx.toFixed(1)} > ${params.sentinel_strongTrendAdx})`);
        if (adx.pdi > adx.mdi) scores.bullish.trend = WEIGHTS.trend;
        else if (adx.mdi > adx.pdi) scores.bearish.trend = WEIGHTS.trend;
    } else {
        reasons.push(`❌ Trend: Weak (ADX ${adx.adx.toFixed(1)} < ${params.sentinel_strongTrendAdx})`);
    }

    // Pillar 2: Alignment (EMA) - 30 points
    if (emaFast > emaSlow && currentPrice > emaFast) {
        scores.bullish.alignment = WEIGHTS.alignment;
        reasons.push(`✅ Alignment: Bullish (Price > EMA${params.sentinel_emaFastPeriod} > EMA${params.sentinel_emaSlowPeriod})`);
    } else if (emaFast < emaSlow && currentPrice < emaFast) {
        scores.bearish.alignment = WEIGHTS.alignment;
        reasons.push(`✅ Alignment: Bearish (Price < EMA${params.sentinel_emaFastPeriod} < EMA${params.sentinel_emaSlowPeriod})`);
    } else {
        reasons.push(`❌ Alignment: EMAs are not aligned or price is inside them.`);
    }

    // Pillar 3: Volatility (BBW Breakout) - 20 points
    const bbwValues = klines.map((k, i) => {
        if (i < 20) return 0;
        const slice = closes.slice(i - 19, i + 1);
        const bbSlice = BollingerBands.calculate({ period: 20, stdDev: 2, values: slice });
        const lastBb = getLast(bbSlice)! as BollingerBandsOutput;
        return (lastBb.upper - lastBb.lower) / lastBb.middle;
    }).filter(v => v > 0);
    const bbwSma = getLast(SMA.calculate({ period: 50, values: bbwValues }))! as number;

    if (bbWidth > bbwSma * 1.1) { // 10% above recent average
        reasons.push(`✅ Volatility: Expanding (BBW > 50-SMA)`);
        if (currentPrice > bb.middle) scores.bullish.volatility = WEIGHTS.volatility;
        else scores.bearish.volatility = WEIGHTS.volatility;
    } else {
         reasons.push(`❌ Volatility: Not Expanding (BBW < 50-SMA)`);
    }

    // Pillar 4: Momentum (RSI) - 10 points
    const hasBearishDivergence = detectRsiDivergence(klines, rsiValues, 'LONG', params.sentinel_rsiDivergenceLookback!);
    const hasBullishDivergence = detectRsiDivergence(klines, rsiValues, 'SHORT', params.sentinel_rsiDivergenceLookback!);

    if (rsi > 50 && !hasBearishDivergence) {
        scores.bullish.momentum = WEIGHTS.momentum;
        reasons.push(`✅ Momentum: RSI > 50 and no bearish divergence.`);
    } else if (rsi < 50 && !hasBullishDivergence) {
        scores.bearish.momentum = WEIGHTS.momentum;
        reasons.push(`✅ Momentum: RSI < 50 and no bullish divergence.`);
    } else {
        reasons.push(`❌ Momentum: RSI not supportive or divergence present.`);
    }

    // --- 4. FINALIZE & GENERATE SIGNAL ---
    const bullishScore = scores.bullish.trend + scores.bullish.alignment + scores.bullish.volatility + scores.bullish.momentum;
    const bearishScore = scores.bearish.trend + scores.bearish.alignment + scores.bearish.volatility + scores.bearish.momentum;

    const analysis: SentinelAnalysis = {
        bullish: { total: bullishScore, ...scores.bullish },
        bearish: { total: bearishScore, ...scores.bearish }
    };

    if (config.isHtfConfirmationEnabled && htfContext?.htf_trend) {
        reasons.push(`ℹ️ HTF Trend is ${htfContext.htf_trend}.`);
        if (htfContext.htf_trend === 'bearish' && bullishScore > bearishScore) {
            return { signal: 'HOLD', reasons: [...reasons, '❌ VETO: HTF trend is bearish.'], sentinelAnalysis: analysis };
        }
        if (htfContext.htf_trend === 'bullish' && bearishScore > bullishScore) {
            return { signal: 'HOLD', reasons: [...reasons, '❌ VETO: HTF trend is bullish.'], sentinelAnalysis: analysis };
        }
    }
    
    if (bullishScore >= params.sentinel_scoreThreshold && bullishScore > bearishScore) {
        reasons.unshift(`✅ Bullish score of ${bullishScore.toFixed(0)} meets threshold.`);
        return { signal: 'BUY', reasons, sentinelAnalysis: analysis };
    }
    
    if (bearishScore >= params.sentinel_scoreThreshold && bearishScore > bullishScore) {
        reasons.unshift(`✅ Bearish score of ${bearishScore.toFixed(0)} meets threshold.`);
        return { signal: 'SELL', reasons, sentinelAnalysis: analysis };
    }
    
    reasons.push(`ℹ️ Conviction not met (Score Threshold: ${params.sentinel_scoreThreshold})`);
    return { signal: 'HOLD', reasons, sentinelAnalysis: analysis };
};