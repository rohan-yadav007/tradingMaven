// services/agents/sentinel.ts

import { Kline, BotConfig, MarketDataContext, TradeSignal, SentinelAnalysis } from '../../types';
import { EMA, MACD, RSI, ADX, BollingerBands, ATR, OBV } from 'technicalindicators';
import { getLast, getPenultimate, isObvTrending, recognizeCandlestickPattern, VortexIndicator } from './agentUtils';
import { calculateSupportResistance } from '../chartAnalysisService';

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
    const emaFast = getLast(EMA.calculate({ period: params.sentinel_emaFastPeriod!, values: closes }))!;
    const emaSlow = getLast(EMA.calculate({ period: params.sentinel_emaSlowPeriod!, values: closes }))!;
    const macdValues = MACD.calculate({ values: closes, fastPeriod: params.sentinel_macdFastPeriod!, slowPeriod: params.sentinel_macdSlowPeriod!, signalPeriod: params.sentinel_macdSignalPeriod!, SimpleMAOscillator: false, SimpleMASignal: false });
    const macd = getLast(macdValues)!;
    const prevMacd = getPenultimate(macdValues)!;
    const rsi = getLast(RSI.calculate({ values: closes, period: params.sentinel_rsiPeriod! }))!;
    const adxValues = ADX.calculate({ high: highs, low: lows, close: closes, period: params.sentinel_adxPeriod! });
    const adx = getLast(adxValues)!;
    const prevAdx = getPenultimate(adxValues)!;
    const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod });
    const last_vi_plus = getLast(vi.pdi)!;
    const last_vi_minus = getLast(vi.ndi)!;
    const obv = OBV.calculate({ close: closes, volume: volumes });
    const bbValues = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    const bb = getLast(bbValues)!;
    const atr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }))!;
    const srLevels = calculateSupportResistance(klines, 15, 0.01);
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
    const BASE_WEIGHTS = { trend: 0.35, momentum: 0.30, confirmation: 0.15, structure: 0.20 };
    let finalWeights = { ...BASE_WEIGHTS };
    const isAdxRising = adx.adx > prevAdx.adx;

    if (adx.adx > 25) { // Strongly trending market: Boost Trend weight
        const boost = 0.15;
        const remainingWeight = 1.0 - BASE_WEIGHTS.trend - boost;
        finalWeights.trend = BASE_WEIGHTS.trend + boost;
        const denominator = BASE_WEIGHTS.momentum + BASE_WEIGHTS.confirmation + BASE_WEIGHTS.structure;
        finalWeights.momentum = BASE_WEIGHTS.momentum * (remainingWeight / denominator);
        finalWeights.confirmation = BASE_WEIGHTS.confirmation * (remainingWeight / denominator);
        finalWeights.structure = BASE_WEIGHTS.structure * (remainingWeight / denominator);
        reasons.push(`ℹ️ Weights: Trend Boosted`);
    } else if (adx.adx > 20 && isAdxRising) { // Transitioning market: Boost Momentum weight
        const boost = 0.15;
        const remainingWeight = 1.0 - BASE_WEIGHTS.momentum - boost;
        finalWeights.momentum = BASE_WEIGHTS.momentum + boost;
        const denominator = BASE_WEIGHTS.trend + BASE_WEIGHTS.confirmation + BASE_WEIGHTS.structure;
        finalWeights.trend = BASE_WEIGHTS.trend * (remainingWeight / denominator);
        finalWeights.confirmation = BASE_WEIGHTS.confirmation * (remainingWeight / denominator);
        finalWeights.structure = BASE_WEIGHTS.structure * (remainingWeight / denominator);
        reasons.push(`ℹ️ Weights: Momentum Boosted`);
    }

    // --- 4. SCORING (Calculate raw points for each category) ---
    const MAX_POINTS = { trend: 35, momentum: 30, confirmation: 15, structure: 20 };
    let bullishPoints = { trend: 0, momentum: 0, confirmation: 0, structure: 0 };
    let bearishPoints = { trend: 0, momentum: 0, confirmation: 0, structure: 0 };
    
    // Trend Score (Max 35)
    if (currentPrice > emaSlow) bullishPoints.trend += 15; else bearishPoints.trend += 15;
    if (emaFast > emaSlow) bullishPoints.trend += 10; else bearishPoints.trend += 10;
    if (adx.adx > 22) {
        if (adx.pdi > adx.mdi) bullishPoints.trend += 10;
        else if (adx.mdi > adx.pdi) bearishPoints.trend += 10;
    }

    // Momentum Score (Max 30)
    if (macd.histogram! > 0 && macd.histogram! > (prevMacd.histogram || 0)) bullishPoints.momentum += 10;
    else if (macd.histogram! < 0 && macd.histogram! < (prevMacd.histogram || 0)) bearishPoints.momentum += 10;
    if (rsi > 55) bullishPoints.momentum += 10;
    else if (rsi < 45) bearishPoints.momentum += 10;
    if (last_vi_plus > last_vi_minus) bullishPoints.momentum += 10;
    else if (last_vi_minus > last_vi_plus) bearishPoints.momentum += 10;

    // Confirmation Score (Max 15)
    if (isObvTrending(obv, 'bullish')) bullishPoints.confirmation += 15;
    else if (isObvTrending(obv, 'bearish')) bearishPoints.confirmation += 15;
    
    // Structure Score (Max 20)
    const closestSupport = srLevels.supports.length > 0 ? srLevels.supports[0].price : -Infinity;
    const closestResistance = srLevels.resistances.length > 0 ? srLevels.resistances[0].price : Infinity;
    const distToSupport = currentPrice - closestSupport;
    const distToResistance = closestResistance - currentPrice;
    if (distToSupport > 0 && distToResistance > 0) {
        const riskRewardStructure = distToResistance / distToSupport;
        if (riskRewardStructure > 1.5) bullishPoints.structure += 10;
        if (1 / riskRewardStructure > 1.5) bearishPoints.structure += 10;
    }
    
    if (candlePattern) {
        if (candlePattern.type === 'bullish') bullishPoints.structure += 10;
        if (candlePattern.type === 'bearish') bearishPoints.structure += 10;
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

    if (totalBull >= threshold && totalBull > totalBear) {
        reasons.unshift(`✅ Bullish score meets threshold.`);
        return { signal: 'BUY', reasons, sentinelAnalysis };
    }
    if (totalBear > totalBull && totalBear >= threshold) {
        reasons.unshift(`✅ Bearish score meets threshold.`);
        return { signal: 'SELL', reasons, sentinelAnalysis };
    }
    
    reasons.push(`ℹ️ Final Score: Bull ${totalBull.toFixed(0)} vs Bear ${totalBear.toFixed(0)}`);
    return { signal: 'HOLD', reasons, sentinelAnalysis };
};
