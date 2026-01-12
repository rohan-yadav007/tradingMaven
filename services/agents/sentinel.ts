// services/agents/sentinel.ts

import { Kline, BotConfig, MarketDataContext, TradeSignal, SentinelAnalysis, AgentParams, MACDOutput, MarketStructureAnalysis } from '../../types';
import { EMA, RSI, MACD, ATR, ADX } from 'technicalindicators';
import { getLast, detectRsiDivergence } from './agentUtils';
import { findSwingPoints, analyzeMarketStructure, calculateSupportResistance } from '../chartAnalysisService';

export const getTheSentinelSignal = (
    klines: Kline[], 
    config: BotConfig, 
    htfContext?: MarketDataContext,
): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = 200;
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for The Sentinel (${klines.length}/${minKlines} candles).`] };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const reasons: string[] = [];

    // --- Pillar 1: Market Structure (Weight: 50%) ---
    const swingPoints = findSwingPoints(klines, params.sentinel_swingLookback!);
    const structureAnalysis = analyzeMarketStructure(swingPoints);
    let structureBullish = 0;
    let structureBearish = 0;
    reasons.push(`ℹ️ Structure: ${structureAnalysis.reason}`);
    switch (structureAnalysis.structure) {
        case 'Uptrend': structureBullish = 100; break;
        case 'Downtrend': structureBearish = 100; break;
        case 'Ranging': structureBullish = 50; structureBearish = 50; break;
    }
    if (structureAnalysis.lastSignal === 'ChoCH_Bullish') structureBullish = 90;
    if (structureAnalysis.lastSignal === 'ChoCH_Bearish') structureBearish = 90;

    // --- Pillar 2: Momentum & Exhaustion (Weight: 30%) ---
    const rsiValues = RSI.calculate({ period: 14, values: closes });
    const lastRsi = getLast(rsiValues) as number | undefined;
    const macdValues = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    // FIX: Explicitly cast to MACDOutput
    const lastMacd = getLast(macdValues) as MACDOutput | undefined;
    const prevMacd = macdValues.length > 1 ? macdValues[macdValues.length - 2] as MACDOutput : undefined;

    let momentumBullish = 0;
    let momentumBearish = 0;

    // A. RSI Control Zone Scoring (60%)
    if (lastRsi) {
        if (lastRsi >= 45 && lastRsi <= 80) { // Bullish Control Zone
            momentumBullish += ((lastRsi - 45) / (80 - 45)) * 60;
        }
        if (lastRsi <= 55 && lastRsi >= 20) { // Bearish Control Zone
            momentumBearish += ((55 - lastRsi) / (55 - 20)) * 60;
        }
    }

    // B. MACD Histogram Acceleration (40%)
    if (lastMacd?.histogram && prevMacd?.histogram) {
        if (lastMacd.histogram > 0 && lastMacd.histogram > prevMacd.histogram) {
            momentumBullish += 40;
        }
        if (lastMacd.histogram < 0 && lastMacd.histogram < prevMacd.histogram) {
            momentumBearish += 40;
        }
    }
    
    // C. In-built Exhaustion Veto
    if (lastRsi && lastRsi > 85 && detectRsiDivergence(klines, rsiValues, 'LONG', 14)) {
        momentumBullish = 0;
        reasons.push(`⚠️ Momentum Veto: Bullish exhaustion detected.`);
    }
    if (lastRsi && lastRsi < 15 && detectRsiDivergence(klines, rsiValues, 'SHORT', 14)) {
        momentumBearish = 0;
        reasons.push(`⚠️ Momentum Veto: Bearish exhaustion detected.`);
    }
    
    reasons.push(`ℹ️ Momentum Score: Bull ${momentumBullish.toFixed(0)}, Bear ${momentumBearish.toFixed(0)}`);
    
    // --- Pillar 3: Context & Confirmation (Weight: 20%) ---
    const timeframeCategory = ['1m', '3m', '5m'].includes(config.timeFrame) ? 'scalping' 
        : ['15m', '30m', '1h'].includes(config.timeFrame) ? 'day' 
        : 'swing';
        
    const emaPeriods = {
        scalping: { fast: 21, slow: 50 },
        day: { fast: 50, slow: 100 },
        swing: { fast: 50, slow: 200 }
    };

    const currentEmaPeriods = emaPeriods[timeframeCategory];
    const emaFast = getLast(EMA.calculate({ period: currentEmaPeriods.fast, values: closes })) as number | undefined;
    const emaSlow = getLast(EMA.calculate({ period: currentEmaPeriods.slow, values: closes })) as number | undefined;
    const lastVolume = getLast(volumes) as number | undefined;
    const volumeSma = getLast(EMA.calculate({ period: 20, values: volumes })) as number | undefined; // Use EMA for volume too for responsiveness
    const srLevels = calculateSupportResistance(klines);
    const lastAtr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: 14 })) as number | undefined;
    
    let contextBullish = 0;
    let contextBearish = 0;

    // A. EMA Alignment (50%)
    if (emaFast && emaSlow && closes[closes.length-1] > emaFast && emaFast > emaSlow) {
        contextBullish += 50;
    }
    if (emaFast && emaSlow && closes[closes.length-1] < emaFast && emaFast < emaSlow) {
        contextBearish += 50;
    }

    // B. Volume Confirmation (30%)
    if (lastVolume && volumeSma && lastVolume > volumeSma) {
        if (closes[closes.length-1] > closes[closes.length-2]) contextBullish += 30;
        else contextBearish += 30;
    }

    // C. Support/Resistance Proximity (20%)
    if (lastAtr) {
        const closestSupport = srLevels.supports[0]?.price;
        if (closestSupport && Math.abs(closes[closes.length-1] - closestSupport) < lastAtr * 0.5) {
            contextBullish += 20;
        }
        const closestResistance = srLevels.resistances[0]?.price;
        if (closestResistance && Math.abs(closes[closes.length-1] - closestResistance) < lastAtr * 0.5) {
            contextBearish += 20;
        }
    }
    reasons.push(`ℹ️ Context Score: Bull ${contextBullish.toFixed(0)}, Bear ${contextBearish.toFixed(0)}`);


    // --- Final Score Calculation ---
    const finalBullishScore = 
        (structureBullish * (params.sentinel_structureWeight! / 100)) +
        (momentumBullish * (params.sentinel_momentumWeight! / 100)) +
        (contextBullish * (params.sentinel_contextWeight! / 100));

    const finalBearishScore = 
        (structureBearish * (params.sentinel_structureWeight! / 100)) +
        (momentumBearish * (params.sentinel_momentumWeight! / 100)) +
        (contextBearish * (params.sentinel_contextWeight! / 100));
        
    let finalScore = 0;
    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    if (finalBullishScore > finalBearishScore) {
        finalScore = finalBullishScore;
        signal = 'BUY';
    } else if (finalBearishScore > finalBullishScore) {
        finalScore = finalBearishScore;
        signal = 'SELL';
    }

    // HTF Multiplier/Penalty
    if (htfContext?.htf_trend) {
        if (signal === 'BUY' && htfContext.htf_trend === 'bullish') {
            finalScore *= params.sentinel_htfMultiplier!;
            reasons.push(`✅ HTF context is bullish, score boosted.`);
        } else if (signal === 'SELL' && htfContext.htf_trend === 'bearish') {
            finalScore *= params.sentinel_htfMultiplier!;
            reasons.push(`✅ HTF context is bearish, score boosted.`);
        } else if (signal === 'BUY' && htfContext.htf_trend === 'bearish') {
            finalScore *= params.sentinel_htfPenalty!;
            reasons.push(`⚠️ HTF context is bearish, score penalized.`);
        } else if (signal === 'SELL' && htfContext.htf_trend === 'bullish') {
            finalScore *= params.sentinel_htfPenalty!;
            reasons.push(`⚠️ HTF context is bullish, score penalized.`);
        }
    }

    reasons.push(`ℹ️ Final Score: ${finalScore.toFixed(0)} (Threshold: ${params.sentinel_entryThreshold})`);

    const analysis: SentinelAnalysis = {
        bullish: { total: finalBullishScore, structure: structureBullish, momentum: momentumBullish, context: contextBullish },
        bearish: { total: finalBearishScore, structure: structureBearish, momentum: momentumBearish, context: contextBearish }
    };
    
    if (finalScore >= params.sentinel_entryThreshold!) {
        return { signal, reasons, sentinelAnalysis: analysis };
    }

    return { signal: 'HOLD', reasons, sentinelAnalysis: analysis };
};