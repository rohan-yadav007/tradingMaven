// services/agents/sentinel.ts

import { Kline, BotConfig, MarketDataContext, TradeSignal, SentinelAnalysis, MACDOutput, ADXOutput, BollingerBandsOutput } from '../../types';
import { EMA, MACD, RSI, ADX, BollingerBands, ATR, OBV, SMA } from 'technicalindicators';
import { getLast, getPenultimate, recognizeCandlestickPattern, VortexIndicator, Supertrend, detectRsiDivergence } from './agentUtils';
import { calculateSupportResistance, findSwingPoints, analyzeMarketStructure } from '../chartAnalysisService';
import { getInitialAgentTargets } from '../riskManagementService';

export const getTheSentinelSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<typeof config.agentParams>;
    const minKlines = Math.max(200, params.sentinel_emaSlowPeriod!);
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for The Sentinel (${klines.length}/${minKlines} candles).`] };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];

    // --- 1. INDICATOR CALCULATIONS ---
    const emaFast = getLast(EMA.calculate({ period: params.sentinel_emaFastPeriod!, values: closes }))! as number;
    const emaSlow = getLast(EMA.calculate({ period: params.sentinel_emaSlowPeriod!, values: closes }))! as number;
    const macdValues = MACD.calculate({ values: closes, fastPeriod: params.sentinel_macdFastPeriod!, slowPeriod: params.sentinel_macdSlowPeriod!, signalPeriod: params.sentinel_macdSignalPeriod!, SimpleMAOscillator: false, SimpleMASignal: false });
    const macd = getLast(macdValues)! as MACDOutput;
    const rsiValues = RSI.calculate({ values: closes, period: params.sentinel_rsiPeriod! });
    const rsi = getLast(rsiValues)! as number;
    const adxValues = ADX.calculate({ high: highs, low: lows, close: closes, period: params.sentinel_adxPeriod! });
    const adx = getLast(adxValues)! as ADXOutput;
    const prevAdx = getPenultimate(adxValues)! as ADXOutput;
    const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod });
    const last_vi_plus = getLast(vi.pdi)!;
    const last_vi_minus = getLast(vi.ndi)!;
    const obv = OBV.calculate({ close: closes, volume: volumes });
    const bbValues = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    const bb = getLast(bbValues)! as BollingerBandsOutput;
    const atr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }))! as number;
    const candlePattern = recognizeCandlestickPattern(klines[klines.length - 1], klines[klines.length - 2]);

    // --- 2. REGIME ANALYSIS & FILTERS ---
    const bbWidth = (bb.upper - bb.lower) / bb.middle;
    if (bbWidth < params.sentinel_bbwSqueezeThreshold) {
        return { signal: 'HOLD', reasons: [`ℹ️ Standby: Low volatility squeeze (BBW: ${bbWidth.toFixed(4)})`] };
    }
    const candleRange = klines[klines.length - 1].high - klines[klines.length - 1].low;
    if (candleRange > atr * params.sentinel_atrChaosThreshold) {
        return { signal: 'HOLD', reasons: [`ℹ️ Standby: Chaotic volatility (Candle > ${params.sentinel_atrChaosThreshold}x ATR)`] };
    }
    reasons.push(`✅ Volatility: OK (BBW: ${bbWidth.toFixed(4)}, ATR Ratio: ${(candleRange / atr).toFixed(1)})`);

    let threshold = params.sentinel_scoreThreshold;
    if (adx.adx > params.sentinel_strongTrendAdx) {
        threshold = params.sentinel_strongTrendThreshold;
        reasons.push(`ℹ️ Regime: Strong Trend (ADX > ${params.sentinel_strongTrendAdx}), Threshold: ${threshold}`);
    } else if (adx.adx < params.sentinel_choppyTrendAdx) {
        threshold = params.sentinel_choppyTrendThreshold;
        reasons.push(`ℹ️ Regime: Choppy Market (ADX < ${params.sentinel_choppyTrendAdx}), Threshold: ${threshold}`);
    } else {
        reasons.push(`ℹ️ Regime: Developing Trend, Threshold: ${threshold}`);
    }
    
    // --- 3. DYNAMIC WEIGHTING ---
    const BASE_WEIGHTS = { trend: 0.30, momentum: 0.30, confirmation: 0.15, structure: 0.25 };
    let finalWeights = { ...BASE_WEIGHTS };
    const isAdxRising = adx.adx > prevAdx.adx;

    if (adx.adx > params.sentinel_strongTrendAdx) {
        finalWeights = { ...finalWeights, trend: BASE_WEIGHTS.trend * params.sentinel_trendingWeightMultiplier, momentum: BASE_WEIGHTS.momentum / params.sentinel_trendingWeightMultiplier };
        reasons.push(`ℹ️ Weights: Trend Boosted`);
    } else if (adx.adx > params.sentinel_choppyTrendAdx && isAdxRising) {
        finalWeights = { ...finalWeights, momentum: BASE_WEIGHTS.momentum * params.sentinel_transitioningWeightMultiplier, trend: BASE_WEIGHTS.trend / params.sentinel_transitioningWeightMultiplier };
        reasons.push(`ℹ️ Weights: Momentum Boosted`);
    }

    // --- 4. SCORING (Calculate raw points for each category) ---
    const MAX_POINTS = { trend: 30, momentum: 30, confirmation: 15, structure: 25 };
    let bullishPoints = { trend: 0, momentum: 0, confirmation: 0, structure: 0 };
    let bearishPoints = { trend: 0, momentum: 0, confirmation: 0, structure: 0 };
    
    // Trend Score (Max 30)
    if (currentPrice > emaSlow) bullishPoints.trend += 15; else bearishPoints.trend += 15;
    if (emaFast > emaSlow) bullishPoints.trend += 10; else bearishPoints.trend += 10;
    if (adx.adx > 22) {
        if (adx.pdi > adx.mdi) bullishPoints.trend += 5;
        else if (adx.mdi > adx.pdi) bearishPoints.trend += 5;
    }

    // Momentum Score (Max 30)
    // FIX: Corrected divergence scoring to be purely additive, preventing negative scores.
    const hasBearishDivergence = detectRsiDivergence(klines, rsiValues, 'LONG', params.sentinel_rsiDivergenceLookback!);
    const hasBullishDivergence = detectRsiDivergence(klines, rsiValues, 'SHORT', params.sentinel_rsiDivergenceLookback!);

    if (hasBearishDivergence) {
        bearishPoints.momentum += 25; // Add points to bearish score
        reasons.push(`✅ Momentum: Bearish RSI Divergence detected.`);
    }

    if (hasBullishDivergence) {
        bullishPoints.momentum += 25; // Add points to bullish score
        reasons.push(`✅ Momentum: Bullish RSI Divergence detected.`);
    }
    
    let bullishCross = false;
    let bearishCross = false;
    const freshnessLookback = params.sentinel_macdCrossoverFreshness!;
    for (let i = 1; i <= freshnessLookback; i++) {
        const current = macdValues[macdValues.length - i] as MACDOutput;
        const prev = macdValues[macdValues.length - i - 1] as MACDOutput;
        if (!current || !prev) break;
        if (prev.MACD! < prev.signal! && current.MACD! > current.signal!) bullishCross = true;
        if (prev.MACD! > prev.signal! && current.MACD! < current.signal!) bearishCross = true;
    }
    if (bullishCross) bullishPoints.momentum += 15;
    else if (macd.histogram! > 0) bullishPoints.momentum += 5;
    if (bearishCross) bearishPoints.momentum += 15;
    else if (macd.histogram! < 0) bearishPoints.momentum += 5;
    
    let rsiBuyThreshold = 55; let rsiSellThreshold = 45;
    if (adx.adx > 30) { rsiBuyThreshold = 60; rsiSellThreshold = 40; } 
    else if (adx.adx < 20) { rsiBuyThreshold = 52; rsiSellThreshold = 48; }
    if (rsi > rsiBuyThreshold) bullishPoints.momentum += 10;
    else if (rsi < rsiSellThreshold) bearishPoints.momentum += 10;
    
    if (last_vi_plus > last_vi_minus) bullishPoints.momentum += 5;
    else if (last_vi_minus > last_vi_plus) bearishPoints.momentum += 5;

    // Confirmation Score (Max 15)
    const obvLookback = 5;
    if (obv.length > obvLookback) {
        const obvSlice = obv.slice(-obvLookback);
        const firstObv = obvSlice[0];
        const lastObv = obvSlice[obvSlice.length - 1];
        const obvSma = getLast(SMA.calculate({ period: 20, values: obv }))!;
        const obvChange = (lastObv - firstObv) / obvSma;
        if (obvChange > 0.01) bullishPoints.confirmation += 15 * Math.min(1, obvChange / 0.05);
        if (obvChange < -0.01) bearishPoints.confirmation += 15 * Math.min(1, Math.abs(obvChange) / 0.05);
    }
    
    // Structure Score (Max 25)
    const swingPoints = findSwingPoints(klines, params.sentinel_swingPointLookback!);
    const structureAnalysis = analyzeMarketStructure(swingPoints);
    reasons.push(`ℹ️ Structure: ${structureAnalysis.reason}`);
    
    bullishPoints.structure = 0;
    bearishPoints.structure = 0;

    if (structureAnalysis.lastSignal === 'ChoCH_Bullish') {
        bullishPoints.structure += 20;
    } else if (structureAnalysis.structure === 'Uptrend') {
        bullishPoints.structure += 20;
    }

    if (structureAnalysis.lastSignal === 'ChoCH_Bearish') {
        bearishPoints.structure += 20;
    } else if (structureAnalysis.structure === 'Downtrend') {
        bearishPoints.structure += 20;
    }

    if (structureAnalysis.structure === 'Ranging') {
        bullishPoints.structure += 5;
        bearishPoints.structure += 5;
    }

    if (candlePattern) {
        if (candlePattern.type === 'bullish') bullishPoints.structure += 5;
        if (candlePattern.type === 'bearish') bearishPoints.structure += 5;
    }

    // --- 5. NORMALIZE, APPLY WEIGHTS & FINALIZE ---
    const bullScores = {
        trend: (bullishPoints.trend / MAX_POINTS.trend) * 100,
        momentum: (bullishPoints.momentum / MAX_POINTS.momentum) * 100,
        confirmation: (bullishPoints.confirmation / MAX_POINTS.confirmation) * 100,
        structure: (bullishPoints.structure / MAX_POINTS.structure) * 100,
    };
    let totalBull = bullScores.trend * finalWeights.trend + bullScores.momentum * finalWeights.momentum + bullScores.confirmation * finalWeights.confirmation + bullScores.structure * finalWeights.structure;

    const bearScores = {
        trend: (bearishPoints.trend / MAX_POINTS.trend) * 100,
        momentum: (bearishPoints.momentum / MAX_POINTS.momentum) * 100,
        confirmation: (bearishPoints.confirmation / MAX_POINTS.confirmation) * 100,
        structure: (bearishPoints.structure / MAX_POINTS.structure) * 100,
    };
    let totalBear = bearScores.trend * finalWeights.trend + bearScores.momentum * finalWeights.momentum + bearScores.confirmation * finalWeights.confirmation + bearScores.structure * finalWeights.structure;
    
    if (config.isHtfConfirmationEnabled && htfContext?.htf_trend) {
        reasons.push(`ℹ️ HTF Trend is ${htfContext.htf_trend}.`);
        if (htfContext.htf_trend === 'bearish') totalBull = 0;
        if (htfContext.htf_trend === 'bullish') totalBear = 0;
    }

    const sentinelAnalysis: SentinelAnalysis = {
        bullish: { total: totalBull, trend: bullScores.trend, momentum: bullScores.momentum, confirmation: bullScores.confirmation, structure: bullScores.structure },
        bearish: { total: totalBear, trend: bearScores.trend, momentum: bearScores.momentum, confirmation: bearScores.confirmation, structure: bearScores.structure }
    };

    // --- 6. PULLBACK & EXHAUSTION VETO (POST-SCORING) ---
    if (totalBull >= threshold && totalBull > totalBear) {
        if (rsi > params.sentinel_rsiOverextendedLong!) {
            reasons.unshift(`❌ VETO: RSI is overextended (${rsi.toFixed(1)} > ${params.sentinel_rsiOverextendedLong}).`);
            return { signal: 'HOLD', reasons, sentinelAnalysis };
        }
        reasons.unshift(`✅ Bullish score meets threshold.`);
        return { signal: 'BUY', reasons, sentinelAnalysis };
    }
    
    if (totalBear > totalBull && totalBear >= threshold) {
        if (rsi < params.sentinel_rsiOverextendedShort!) {
            reasons.unshift(`❌ VETO: RSI is oversold (${rsi.toFixed(1)} < ${params.sentinel_rsiOverextendedShort}).`);
            return { signal: 'HOLD', reasons, sentinelAnalysis };
        }
        reasons.unshift(`✅ Bearish score meets threshold.`);
        return { signal: 'SELL', reasons, sentinelAnalysis };
    }
    
    reasons.push(`ℹ️ Final Score: Bull ${totalBull.toFixed(0)} vs Bear ${totalBear.toFixed(0)}`);
    return { signal: 'HOLD', reasons, sentinelAnalysis };
};
