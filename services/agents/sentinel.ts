// services/agents/sentinel.ts

import { Kline, BotConfig, MarketDataContext, TradeSignal, SentinelAnalysis, ADXOutput, BollingerBandsOutput, AgentParams } from '../../types';
import { EMA, RSI, ADX, BollingerBands, ATR, SMA, OBV } from 'technicalindicators';
import { getLast, getPenultimate, detectRsiDivergence, calculateVwap, analyzeMicroMarketStructure } from './agentUtils';
import { MarketStructureAnalysis } from '../chartAnalysisService';
import { SENTINEL_WEIGHTS_BY_REGIME_AND_TIMEFRAME, TIME_FRAMES } from '../../constants';

function calculateConcordanceScore(
    livePrice: number,
    signalDirection: 'BUY' | 'SELL',
    config: BotConfig,
    mainTimeframeKlines: Kline[],
    immediateKlines: Kline[] | undefined, // Always 1m
    ltfKlines: Kline[] | undefined // From MICRO_TIMEFRAME_MAP
): { score: number, reasons: string[] } {
    const params = config.agentParams as Required<AgentParams>;
    let score = 100;
    const reasons: string[] = [];

    // 1. Main Timeframe Candle Context
    const lastCandle = mainTimeframeKlines[mainTimeframeKlines.length - 1];
    const range = lastCandle.high - lastCandle.low;
    if (range > 0) {
        const positionInCandle = (livePrice - lastCandle.low) / range;
        if (signalDirection === 'BUY' && positionInCandle > 0.85) {
            score -= params.sentinel_concordance_deduction_candlePos!;
            reasons.push(`-️${params.sentinel_concordance_deduction_candlePos}pts: Poor entry price (high in candle).`);
        }
        if (signalDirection === 'SELL' && positionInCandle < 0.15) {
            score -= params.sentinel_concordance_deduction_candlePos!;
            reasons.push(`-️${params.sentinel_concordance_deduction_candlePos}pts: Poor entry price (low in candle).`);
        }
    }
    
    // 2. LTF (e.g., 3m for 15m) Analysis
    if (ltfKlines && ltfKlines.length >= 50) {
        const ltfCloses = ltfKlines.map(k => k.close);
        const ltfVolumes = ltfKlines.map(k => k.volume || 0);

        // A. RSI Alignment
        const rsi14 = getLast(RSI.calculate({ period: 14, values: ltfCloses }));
        if (rsi14) {
            if (signalDirection === 'BUY' && rsi14 < 50) {
                score -= params.sentinel_concordance_deduction_rsi!;
                reasons.push(`-️${params.sentinel_concordance_deduction_rsi}pts: LTF RSI is not bullish.`);
            }
            if (signalDirection === 'SELL' && rsi14 > 50) {
                score -= params.sentinel_concordance_deduction_rsi!;
                reasons.push(`-️${params.sentinel_concordance_deduction_rsi}pts: LTF RSI is not bearish.`);
            }
        }

        // B. Volume
        const volumeSma = getLast(SMA.calculate({ period: 20, values: ltfVolumes }));
        const lastVolume = getLast(ltfVolumes);
        if (volumeSma && lastVolume && lastVolume < volumeSma) {
            score -= params.sentinel_concordance_deduction_volume!;
            reasons.push(`-️${params.sentinel_concordance_deduction_volume}pts: LTF volume is below average.`);
        }

        // C. VWAP Bias
        const vwap = getLast(calculateVwap(ltfKlines));
        if (vwap) {
            if (signalDirection === 'BUY' && livePrice < vwap) {
                score -= params.sentinel_concordance_deduction_vwap!;
                reasons.push(`-️${params.sentinel_concordance_deduction_vwap}pts: Price is below micro-VWAP.`);
            }
            if (signalDirection === 'SELL' && livePrice > vwap) {
                score -= params.sentinel_concordance_deduction_vwap!;
                reasons.push(`-️${params.sentinel_concordance_deduction_vwap}pts: Price is above micro-VWAP.`);
            }
        }

        // D. LTF Structure
        const ltfStructure = analyzeMicroMarketStructure(ltfKlines);
        if (ltfStructure) {
            if (signalDirection === 'BUY' && ltfStructure === 'descending') {
                score -= params.sentinel_concordance_deduction_ltf_structure!;
                reasons.push(`-️${params.sentinel_concordance_deduction_ltf_structure}pts: LTF structure is making lower highs.`);
            }
            if (signalDirection === 'SELL' && ltfStructure === 'ascending') {
                score -= params.sentinel_concordance_deduction_ltf_structure!;
                reasons.push(`-️${params.sentinel_concordance_deduction_ltf_structure}pts: LTF structure is making higher lows.`);
            }
        }
    } else {
        reasons.push(`ℹ️ Concordance: LTF data unavailable, skipping checks.`);
    }
    
    // 3. Immediate (1m) Momentum Check
    if (immediateKlines && immediateKlines.length >= 20) {
        const immediateCloses = immediateKlines.map(k => k.close);
        const rsi5 = getLast(RSI.calculate({ period: 5, values: immediateCloses }));
        if (rsi5) {
            if (signalDirection === 'BUY' && rsi5 < 48) {
                score -= params.sentinel_concordance_deduction_immediate_momentum!;
                reasons.push(`-️${params.sentinel_concordance_deduction_immediate_momentum}pts: Immediate (1m) momentum is bearish.`);
            }
            if (signalDirection === 'SELL' && rsi5 > 52) {
                score -= params.sentinel_concordance_deduction_immediate_momentum!;
                reasons.push(`-️${params.sentinel_concordance_deduction_immediate_momentum}pts: Immediate (1m) momentum is bullish.`);
            }
        }
    } else {
        reasons.push(`ℹ️ Concordance: Immediate (1m) data unavailable, skipping checks.`);
    }

    return { score, reasons };
}


export const getTheSentinelSignal = (
    klines: Kline[], 
    config: BotConfig, 
    htfContext?: MarketDataContext, 
    structureAnalysis?: MarketStructureAnalysis,
    immediateKlines?: Kline[],
    ltfKlines?: Kline[],
    livePrice?: number,
): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = Math.max(200, params.sentinel_emaSlowPeriod!);
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for The Sentinel (${klines.length}/${minKlines} candles).`] };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const reasons: string[] = [];

    // --- 1. INDICATOR CALCULATIONS ---
    const emaFast = getLast(EMA.calculate({ period: params.sentinel_emaFastPeriod!, values: closes })) as number | undefined;
    const emaSlow = getLast(EMA.calculate({ period: params.sentinel_emaSlowPeriod!, values: closes })) as number | undefined;
    const rsiValues = RSI.calculate({ values: closes, period: params.sentinel_rsiPeriod! });
    const rsi = getLast(rsiValues) as number | undefined;
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.sentinel_adxPeriod! })) as ADXOutput | undefined;
    const atr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: 14 })) as number | undefined;
    const bb = getLast(BollingerBands.calculate({ period: 20, stdDev: 2, values: closes })) as BollingerBandsOutput | undefined;
    const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes })) as number | undefined;
    const lastVolume = getLast(volumes);
    const currentPrice = livePrice || getLast(closes)!;

    if (!emaFast || !emaSlow || !rsi || !adx || !atr || !bb || !volumeSma || lastVolume === undefined || !currentPrice) {
        return { signal: 'HOLD', reasons: ['ℹ️ Core indicators for Sentinel failed to calculate.'] };
    }

    // --- 2. REGIME ANALYSIS & WEIGHTS ---
    const tfIndex = TIME_FRAMES.indexOf(config.timeFrame);
    const tfCategory = tfIndex <= 2 ? 'scalping' : tfIndex <= 5 ? 'day' : 'swing';
    
    let regime: 'strong' | 'transition' | 'chop' = 'transition';
    if (adx.adx > params.sentinel_regime_strongTrendAdx) regime = 'strong';
    else if (adx.adx < params.sentinel_regime_chopAdx) regime = 'chop';

    const WEIGHTS = SENTINEL_WEIGHTS_BY_REGIME_AND_TIMEFRAME[tfCategory][regime];
    reasons.push(`ℹ️ Strategy: ${tfCategory}/${regime} (T:${WEIGHTS.trend}/A:${WEIGHTS.alignment}/V:${WEIGHTS.volatility}/M:${WEIGHTS.momentum})`);


    // --- 3. GATE 1: TREND CONVICTION SCORE ---
    const scores = {
        bullish: { trend: 0, alignment: 0, volatility: 0, momentum: 0 },
        bearish: { trend: 0, alignment: 0, volatility: 0, momentum: 0 }
    };

    // Pillar 1: Trend
    if (adx.adx > params.sentinel_strongTrendAdx!) {
        reasons.push(`✅ Trend: Strong (ADX ${adx.adx.toFixed(1)} > ${params.sentinel_strongTrendAdx})`);
        if (adx.pdi > adx.mdi) scores.bullish.trend = WEIGHTS.trend;
        else if (adx.mdi > adx.pdi) scores.bearish.trend = WEIGHTS.trend;
    } else {
        reasons.push(`❌ Trend: Weak (ADX ${adx.adx.toFixed(1)} < ${params.sentinel_strongTrendAdx})`);
    }

    // Pillar 2: Alignment
    if (emaFast > emaSlow && currentPrice > emaFast) {
        scores.bullish.alignment = WEIGHTS.alignment;
        reasons.push(`✅ Alignment: Bullish (Price > EMA${params.sentinel_emaFastPeriod} > EMA${params.sentinel_emaSlowPeriod})`);
    } else if (emaFast < emaSlow && currentPrice < emaFast) {
        scores.bearish.alignment = WEIGHTS.alignment;
        reasons.push(`✅ Alignment: Bearish (Price < EMA${params.sentinel_emaFastPeriod} < EMA${params.sentinel_emaSlowPeriod})`);
    } else {
        reasons.push(`❌ Alignment: EMAs not aligned.`);
    }

    // Pillar 3: Volatility
    const bbWidth = (bb.upper - bb.lower) / bb.middle;
    const dynamicBbwThreshold = (atr / currentPrice) * 0.5;
    if (bbWidth > dynamicBbwThreshold * 1.1) {
        reasons.push(`✅ Volatility: Expanding`);
        if (currentPrice > bb.middle) scores.bullish.volatility = WEIGHTS.volatility;
        else scores.bearish.volatility = WEIGHTS.volatility;
    } else {
         reasons.push(`❌ Volatility: Not Expanding`);
    }

    // Pillar 4: Momentum
    const hasBearishDivergence = detectRsiDivergence(klines, rsiValues, 'LONG', params.sentinel_rsiDivergenceLookback!);
    const hasBullishDivergence = detectRsiDivergence(klines, rsiValues, 'SHORT', params.sentinel_rsiDivergenceLookback!);
    if (rsi > 50 && !hasBearishDivergence) { scores.bullish.momentum = WEIGHTS.momentum; reasons.push(`✅ Momentum: RSI > 50.`); } 
    else if (rsi < 50 && !hasBullishDivergence) { scores.bearish.momentum = WEIGHTS.momentum; reasons.push(`✅ Momentum: RSI < 50.`); }
    else { reasons.push(`❌ Momentum: RSI not supportive or divergence present.`); }
    
    // Final Trend Scores
    let bullishTrendScore = scores.bullish.trend + scores.bullish.alignment + scores.bullish.volatility + scores.bullish.momentum;
    let bearishTrendScore = scores.bearish.trend + scores.bearish.alignment + scores.bearish.volatility + scores.bearish.momentum;
    
    if (lastVolume > volumeSma * params.sentinel_volume_bonusMultiplier!) {
      if (currentPrice > klines[klines.length - 2].close) { bullishTrendScore += params.sentinel_volume_bonusPoints!; } 
      else { bearishTrendScore += params.sentinel_volume_bonusPoints!; }
      reasons.push('✅ Bonus: High confirmation volume.');
    }

    // --- Scaled Exhaustion Penalty ---
    let trendExhaustionPenalty = 0;
    if (adx.adx > params.sentinel_exhaustion_adx_start!) {
        const penaltyPoints = (adx.adx - params.sentinel_exhaustion_adx_start!) * params.sentinel_exhaustion_penalty_per_point!;
        trendExhaustionPenalty = penaltyPoints;
        if (bullishTrendScore > bearishTrendScore) {
            bullishTrendScore -= penaltyPoints;
        } else {
            bearishTrendScore -= penaltyPoints;
        }
        reasons.push(`⚠️ Trend Exhaustion Penalty: -${penaltyPoints.toFixed(0)}pts (ADX: ${adx.adx.toFixed(1)})`);
    }

    const analysis: SentinelAnalysis = {
        bullish: { total: bullishTrendScore, ...scores.bullish },
        bearish: { total: bearishTrendScore, ...scores.bearish }
    };
    
    // --- GATE 1 CHECK ---
    let signalDirection: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let trendScore = 0;
    
    if (bullishTrendScore >= params.sentinel_trendConvictionThreshold! && bullishTrendScore > bearishTrendScore) {
        signalDirection = 'BUY';
        trendScore = bullishTrendScore;
    } else if (bearishTrendScore >= params.sentinel_trendConvictionThreshold! && bearishTrendScore > bullishTrendScore) {
        signalDirection = 'SELL';
        trendScore = bearishTrendScore;
    }

    if (signalDirection === 'HOLD') {
        reasons.push(`ℹ️ Conviction not met (Trend Score Threshold: ${params.sentinel_trendConvictionThreshold})`);
        return { signal: 'HOLD', reasons, sentinelAnalysis: analysis };
    }
    reasons.unshift(`✅ Trend Score of ${trendScore.toFixed(0)} meets threshold.`);

    // --- HTF CONTEXT VETO (after Trend Gate) ---
    if (htfContext?.htf_trend) {
        reasons.push(`ℹ️ HTF Trend is ${htfContext.htf_trend}.`);
        if (htfContext.htf_trend === 'bearish' && signalDirection === 'BUY') return { signal: 'HOLD', reasons: [...reasons, '❌ VETO: HTF trend is bearish.'], sentinelAnalysis: analysis };
        if (htfContext.htf_trend === 'bullish' && signalDirection === 'SELL') return { signal: 'HOLD', reasons: [...reasons, '❌ VETO: HTF trend is bullish.'], sentinelAnalysis: analysis };
    }
    
    // --- 4. GATE 2: ENTRY QUALITY (CONCORDANCE SCORE) ---
    const { score: concordanceScore, reasons: concordanceReasons } = calculateConcordanceScore(livePrice || currentPrice, signalDirection, config, klines, immediateKlines, ltfKlines);
    reasons.push(...concordanceReasons);

    const finalConcordanceScore = concordanceScore - trendExhaustionPenalty;
    analysis.concordanceScore = finalConcordanceScore;

    if (finalConcordanceScore < params.sentinel_entryQualityThreshold!) {
         reasons.push(`❌ VETO: Entry Quality score of ${finalConcordanceScore.toFixed(0)} is below threshold of ${params.sentinel_entryQualityThreshold!}.`);
        return { signal: 'HOLD', reasons, sentinelAnalysis: analysis };
    }
    reasons.unshift(`✅ Entry Quality score of ${finalConcordanceScore.toFixed(0)} meets threshold.`);

    return { signal: signalDirection, reasons, sentinelAnalysis: analysis };
};
