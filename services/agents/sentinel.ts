// services/agents/sentinel.ts

import { Kline, BotConfig, MarketDataContext, TradeSignal, SentinelAnalysis, ADXOutput, BollingerBandsOutput, AgentParams } from '../../types';
import { EMA, RSI, ADX, BollingerBands, ATR, SMA, OBV } from 'technicalindicators';
import { getLast, detectRsiDivergence, calculateVwap, analyzeMicroMarketStructure } from './agentUtils';
import { MarketStructureAnalysis } from '../chartAnalysisService';
import { SENTINEL_WEIGHTS_BY_REGIME_AND_TIMEFRAME, TIME_FRAMES } from '../../constants';

function calculateConcordancePenalties(
    livePrice: number,
    signalDirection: 'BUY' | 'SELL',
    config: BotConfig,
    mainTimeframeKlines: Kline[],
    microKlines: Kline[] | undefined,
    momentumPillarWeight: number // Tweak #1: Pass in pillar weight
): { penalty: number, reasons: string[] } {
    const params = config.agentParams as Required<AgentParams>;
    let totalPenalty = 0;
    const reasons: string[] = [];

    // 1. Main Timeframe Candle Context
    const lastCandle = mainTimeframeKlines[mainTimeframeKlines.length - 1];
    const range = lastCandle.high - lastCandle.low;
    if (range > 0) {
        const positionInCandle = (livePrice - lastCandle.low) / range;
        const penaltyPercent = params.sentinel_penalty_concordance_candlePos_percent / 100;
        if (signalDirection === 'BUY' && positionInCandle > 0.85) {
            totalPenalty += momentumPillarWeight * penaltyPercent;
            reasons.push(`⚠️ Penalty: Poor entry price (high in candle).`);
        }
        if (signalDirection === 'SELL' && positionInCandle < 0.15) {
            totalPenalty += momentumPillarWeight * penaltyPercent;
            reasons.push(`⚠️ Penalty: Poor entry price (low in candle).`);
        }
    }
    
    // 2. LTF checks (if data available)
    if (!microKlines || microKlines.length < 50) {
        reasons.push(`ℹ️ Concordance: LTF data unavailable, skipping penalties.`);
        return { penalty: totalPenalty, reasons };
    }
    
    const ltfCloses = microKlines.map(k => k.close);

    // A. RSI Alignment Penalty
    const rsi14 = getLast(RSI.calculate({ period: 14, values: ltfCloses }));
    if (rsi14) {
        const penaltyPercent = params.sentinel_penalty_concordance_rsi_percent / 100;
        if (signalDirection === 'BUY' && rsi14 < 50) {
            totalPenalty += momentumPillarWeight * penaltyPercent;
            reasons.push(`⚠️ Penalty: LTF RSI is not bullish.`);
        }
        if (signalDirection === 'SELL' && rsi14 > 50) {
            totalPenalty += momentumPillarWeight * penaltyPercent;
            reasons.push(`⚠️ Penalty: LTF RSI is not bearish.`);
        }
    }

    // B. Volume Penalty
    const ltfVolumes = microKlines.map(k => k.volume || 0);
    const volumeSma = getLast(SMA.calculate({ period: 20, values: ltfVolumes }));
    const lastVolume = getLast(ltfVolumes);
    if (volumeSma && lastVolume && lastVolume < volumeSma) {
        const penaltyPercent = params.sentinel_penalty_concordance_volume_percent / 100;
        totalPenalty += momentumPillarWeight * penaltyPercent;
        reasons.push(`⚠️ Penalty: LTF volume is below average.`);
    }

    // C. VWAP Bias Penalty (Tweak #4)
    const vwap = getLast(calculateVwap(microKlines));
    if (vwap) {
        const penaltyPercent = params.sentinel_penalty_concordance_vwap_percent / 100;
        if (signalDirection === 'BUY' && livePrice < vwap) {
            totalPenalty += momentumPillarWeight * penaltyPercent;
            reasons.push(`⚠️ Penalty: Price is below micro-VWAP.`);
        }
        if (signalDirection === 'SELL' && livePrice > vwap) {
            totalPenalty += momentumPillarWeight * penaltyPercent;
            reasons.push(`⚠️ Penalty: Price is above micro-VWAP.`);
        }
    }

    // D. Micro-Structure Penalty (Tweak #4)
    const microStructure = analyzeMicroMarketStructure(microKlines);
    if (microStructure) {
        const penaltyPercent = params.sentinel_penalty_concordance_microStructure_percent / 100;
        if (signalDirection === 'BUY' && microStructure === 'descending') {
            totalPenalty += momentumPillarWeight * penaltyPercent;
            reasons.push(`⚠️ Penalty: Micro-structure is making lower highs.`);
        }
        if (signalDirection === 'SELL' && microStructure === 'ascending') {
            totalPenalty += momentumPillarWeight * penaltyPercent;
            reasons.push(`⚠️ Penalty: Micro-structure is making higher lows.`);
        }
    }


    return { penalty: totalPenalty, reasons };
}


export const getTheSentinelSignal = (
    klines: Kline[], 
    config: BotConfig, 
    htfContext?: MarketDataContext, 
    structureAnalysis?: MarketStructureAnalysis,
    microKlines?: Kline[],
    microTimeframe?: string,
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
    const currentPrice = getLast(closes);

    if (!emaFast || !emaSlow || !rsi || !adx || !atr || !bb || !volumeSma || lastVolume === undefined || !currentPrice) {
        return { signal: 'HOLD', reasons: ['ℹ️ Core indicators for Sentinel failed to calculate.'] };
    }


    // --- 2. VETO FILTERS & ADAPTIVE LOGIC ---
    // A. EMA Distance Veto
    const emaDistance = Math.abs(emaFast - emaSlow);
    if (emaDistance > atr * params.sentinel_emaDistanceVetoThreshold) {
        return { signal: 'HOLD', reasons: [`❌ VETO: Price is over-extended from EMAs (Distance > ${params.sentinel_emaDistanceVetoThreshold}x ATR)`] };
    }

    // B. Timeframe- and Regime-Adaptive Scoring Weights
    const tfIndex = TIME_FRAMES.indexOf(config.timeFrame);
    const tfCategory = tfIndex <= 2 ? 'scalping' : tfIndex <= 5 ? 'day' : 'swing';
    
    let regime: 'strong' | 'transition' | 'chop' = 'transition';
    if (adx.adx > params.sentinel_regime_strongTrendAdx) regime = 'strong';
    else if (adx.adx < params.sentinel_regime_chopAdx) regime = 'chop';

    const WEIGHTS = SENTINEL_WEIGHTS_BY_REGIME_AND_TIMEFRAME[tfCategory][regime];
    reasons.push(`ℹ️ Strategy: ${tfCategory}/${regime} (T:${WEIGHTS.trend}/A:${WEIGHTS.alignment}/V:${WEIGHTS.volatility}/M:${WEIGHTS.momentum})`);


    // --- 3. WEIGHTED CHECKLIST SCORING ---
    const scores = {
        bullish: { trend: 0, alignment: 0, volatility: 0, momentum: 0 },
        bearish: { trend: 0, alignment: 0, volatility: 0, momentum: 0 }
    };

    // Pillar 1: Trend (ADX)
    if (adx.adx > params.sentinel_strongTrendAdx) {
        reasons.push(`✅ Trend: Strong (ADX ${adx.adx.toFixed(1)} > ${params.sentinel_strongTrendAdx})`);
        if (adx.pdi > adx.mdi) scores.bullish.trend = WEIGHTS.trend;
        else if (adx.mdi > adx.pdi) scores.bearish.trend = WEIGHTS.trend;
    } else {
        reasons.push(`❌ Trend: Weak (ADX ${adx.adx.toFixed(1)} < ${params.sentinel_strongTrendAdx})`);
    }

    // Pillar 2: Alignment (EMA & Market Structure)
    if (emaFast > emaSlow && currentPrice > emaFast) {
        scores.bullish.alignment = WEIGHTS.alignment;
        reasons.push(`✅ Alignment: Bullish (Price > EMA${params.sentinel_emaFastPeriod} > EMA${params.sentinel_emaSlowPeriod})`);
    } else if (emaFast < emaSlow && currentPrice < emaFast) {
        scores.bearish.alignment = WEIGHTS.alignment;
        reasons.push(`✅ Alignment: Bearish (Price < EMA${params.sentinel_emaFastPeriod} < EMA${params.sentinel_emaSlowPeriod})`);
    } else {
        reasons.push(`❌ Alignment: EMAs not aligned.`);
    }
    
    // **NEW**: Market Structure Veto (replaces weak penalty)
    if (config.isMarketStructureVetoEnabled && structureAnalysis) {
        const isBullishSignalAdverse = structureAnalysis.structure === 'Downtrend' || structureAnalysis.lastSignal === 'ChoCH_Bearish';
        const isBearishSignalAdverse = structureAnalysis.structure === 'Uptrend' || structureAnalysis.lastSignal === 'ChoCH_Bullish';
        
        if (isBullishSignalAdverse) {
            return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Market Structure is adverse (Bearish).`] };
        }
        if (isBearishSignalAdverse) {
            return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Market Structure is adverse (Bullish).`] };
        }
        reasons.push(`✅ Market Structure: Passed`);
    }


    // Pillar 3: Volatility (ATR-based BBW)
    const bbWidth = (bb.upper - bb.lower) / bb.middle;
    const dynamicBbwThreshold = (atr / currentPrice) * 0.5;
    if (bbWidth > dynamicBbwThreshold * 1.1) {
        reasons.push(`✅ Volatility: Expanding`);
        if (currentPrice > bb.middle) scores.bullish.volatility = WEIGHTS.volatility;
        else scores.bearish.volatility = WEIGHTS.volatility;
    } else {
         reasons.push(`❌ Volatility: Not Expanding`);
    }

    // Pillar 4: Momentum (RSI & OBV Delta)
    const hasBearishDivergence = detectRsiDivergence(klines, rsiValues, 'LONG', params.sentinel_rsiDivergenceLookback!);
    const hasBullishDivergence = detectRsiDivergence(klines, rsiValues, 'SHORT', params.sentinel_rsiDivergenceLookback!);
    if (rsi > 50 && !hasBearishDivergence) { scores.bullish.momentum = WEIGHTS.momentum; reasons.push(`✅ Momentum: RSI > 50.`); } 
    else if (rsi < 50 && !hasBullishDivergence) { scores.bearish.momentum = WEIGHTS.momentum; reasons.push(`✅ Momentum: RSI < 50.`); }
    else { reasons.push(`❌ Momentum: RSI not supportive or divergence present.`); }
    
    const obvValues = OBV.calculate({close: closes, volume: volumes});
    const obvLookback = 8;
    if (obvValues.length > obvLookback) {
        const obvSlice = obvValues.slice(-obvLookback);
        const obvStart = obvSlice[0];
        const obvEnd = obvSlice[obvSlice.length - 1];
        const isObvUp = obvEnd > obvStart;
        const isObvDown = obvEnd < obvStart;
        const penalty = WEIGHTS.momentum * (params.sentinel_penalty_obv_percent / 100);
        
        // **FIXED LOGIC**: Penalize when OBV contradicts the signal direction
        if (isObvDown) { scores.bullish.momentum -= penalty; } // Penalize bullish score if OBV is down
        else { reasons.push(`✅ OBV Delta Bullish.`); }

        if (isObvUp) { scores.bearish.momentum -= penalty; } // Penalize bearish score if OBV is up
        else { reasons.push(`✅ OBV Delta Bearish.`); }
    }

    // --- 4. FINALIZE & GENERATE SIGNAL ---
    let bullishScore = scores.bullish.trend + scores.bullish.alignment + scores.bullish.volatility + scores.bullish.momentum;
    let bearishScore = scores.bearish.trend + scores.bearish.alignment + scores.bearish.volatility + scores.bearish.momentum;

    // A. Volume-based Score Adjustment
    if (lastVolume > volumeSma * params.sentinel_volume_bonusMultiplier) {
      if (currentPrice > klines[klines.length - 2].close) { bullishScore += params.sentinel_volume_bonusPoints; } 
      else { bearishScore += params.sentinel_volume_bonusPoints; }
      reasons.push('✅ Bonus: High confirmation volume.');
    }

    // B. Soft Veto / Concordance Penalties
    if (config.isMomentumConcordanceEnabled && microKlines && microTimeframe && livePrice) {
        const { penalty, reasons: penaltyReasons } = calculateConcordancePenalties(livePrice, bullishScore > bearishScore ? 'BUY' : 'SELL', config, klines, microKlines, WEIGHTS.momentum);
        if (bullishScore > bearishScore) bullishScore -= penalty;
        else bearishScore -= penalty;
        reasons.push(...penaltyReasons);
    }

    const analysis: SentinelAnalysis = {
        bullish: { total: bullishScore, ...scores.bullish },
        bearish: { total: bearishScore, ...scores.bearish }
    };

    if (htfContext?.htf_trend) {
        reasons.push(`ℹ️ HTF Trend is ${htfContext.htf_trend}.`);
        if (htfContext.htf_trend === 'bearish' && bullishScore > bearishScore) return { signal: 'HOLD', reasons: [...reasons, '❌ VETO: HTF trend is bearish.'], sentinelAnalysis: analysis };
        if (htfContext.htf_trend === 'bullish' && bearishScore > bullishScore) return { signal: 'HOLD', reasons: [...reasons, '❌ VETO: HTF trend is bullish.'], sentinelAnalysis: analysis };
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