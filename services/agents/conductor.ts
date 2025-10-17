// services/agents/conductor.ts

// Fix: Add missing import for AgentParams from ../../types to resolve type error.
import { Kline, BotConfig, MarketDataContext, TradeSignal, ConductorAnalysis, ADXOutput, MACDOutput, AgentParams } from '../../types';
import { RSI, ATR, MACD, SMA, ADX, EMA } from 'technicalindicators';
import { getLast, recognizeCandlestickPattern, detectRsiDivergence, analyzeMicroMarketStructure } from './agentUtils';
import { findSwingPoints, analyzeMarketStructure, calculateSupportResistance } from '../chartAnalysisService';

export const getTheConductorSignal = (
    klines: Kline[], 
    config: BotConfig, 
    htfContext?: MarketDataContext,
    microKlines?: Kline[], // Added for mBOS
): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = 50;
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for The Conductor (${klines.length}/${minKlines} candles).`] };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];

    // --- Dynamic Weighting & Adaptive Thresholds ---
    const adx = getLast(ADX.calculate({ period: 14, high: highs, low: lows, close: closes })) as ADXOutput | undefined;
    let convictionThreshold = params.conductor_convictionThreshold;
    let weights = {
        structure: params.conductor_structureWeight / 100,
        momentum: params.conductor_momentumWeight / 100,
        context: params.conductor_contextWeight / 100,
        confirmation: params.conductor_confirmationWeight / 100,
    };

    if (adx) {
        if (adx.adx > params.conductor_strongTrendAdx) {
            convictionThreshold = params.conductor_strongTrendThreshold;
            weights.structure *= params.conductor_structureWeightMultiplier;
            reasons.push(`ℹ️ Regime: Strong Trend (ADX > ${params.conductor_strongTrendAdx}), Threshold: ${convictionThreshold}`);
            reasons.push(`ℹ️ Weights: Structure Boosted`);
        } else if (adx.adx < params.conductor_choppyTrendAdx) {
            convictionThreshold = params.conductor_choppyTrendThreshold;
            reasons.push(`ℹ️ Regime: Choppy Market (ADX < ${params.conductor_choppyTrendAdx}), Threshold: ${convictionThreshold}`);
        } else {
            reasons.push(`ℹ️ Regime: Developing Trend, Threshold: ${convictionThreshold}`);
        }
    }


    // --- Pillar 1: Market Structure Supremacy ---
    const swingPoints = findSwingPoints(klines, params.conductor_swingLookback);
    const structureAnalysis = analyzeMarketStructure(swingPoints);
    let structureBullish = 0;
    let structureBearish = 0;
    reasons.push(`✅ Structure: ${structureAnalysis.reason}`);
    switch (structureAnalysis.structure) {
        case 'Uptrend': structureBullish = 100; break;
        case 'Downtrend': structureBearish = 100; break;
        case 'Ranging': structureBullish = 30; structureBearish = 30; break;
    }
    if (structureAnalysis.lastSignal === 'ChoCH_Bullish') structureBullish = 80;
    if (structureAnalysis.lastSignal === 'ChoCH_Bearish') structureBearish = 80;

    // --- Pillar 2: Momentum Quality ---
    const rsiValues = RSI.calculate({ period: 14, values: closes });
    const macdValues = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const lastMacd = getLast(macdValues) as MACDOutput | undefined;
    let momentumBullish = 0;
    let momentumBearish = 0;

    let divBull = 0, divBear = 0;
    let accelBull = 0, accelBear = 0;

    // A. Divergence check (longer-term momentum signal)
    if (detectRsiDivergence(klines, rsiValues, 'SHORT', params.conductor_rsiDivergenceLookback)) {
        divBull = 60;
        reasons.push(`✅ Momentum: Hidden Bullish RSI Divergence`);
    }
    if (detectRsiDivergence(klines, rsiValues, 'LONG', params.conductor_rsiDivergenceLookback)) {
        divBear = 60;
        reasons.push(`✅ Momentum: Regular Bearish RSI Divergence`);
    }

    // B. Acceleration check (short-term momentum signal)
    if (lastMacd?.histogram && macdValues.length > 2) {
        const prevMacd = macdValues[macdValues.length - 2] as MACDOutput;
        // FIX: Use typeof check to properly narrow types for comparison.
        if (typeof lastMacd.histogram === 'number' && typeof prevMacd?.histogram === 'number') {
            if (lastMacd.histogram > 0 && lastMacd.histogram > prevMacd.histogram) {
                accelBull = 40;
                reasons.push(`✅ Momentum: Accelerating Bullish`);
            }
            if (lastMacd.histogram < 0 && lastMacd.histogram < prevMacd.histogram) {
                accelBear = 40;
                reasons.push(`✅ Momentum: Accelerating Bearish`);
            }
        }
    }
    
    momentumBullish = Math.max(0, divBull + accelBull - accelBear);
    momentumBearish = Math.max(0, divBear + accelBear - accelBull);

    // --- Pillar 3: Liquidity & Order Flow Context ---
    const srLevels = calculateSupportResistance(klines, 15, 0.01);
    const atr = getLast(ATR.calculate({ high: klines.map(k=>k.high), low: klines.map(k=>k.low), close: closes, period: 14 }))! as number;
    let contextBullish = 0;
    let contextBearish = 0;

    const nearestSupport = srLevels.supports.find(s => s.price < currentPrice);
    if (nearestSupport && Math.abs(currentPrice - nearestSupport.price) < atr * 0.75) {
        contextBullish = 100;
        reasons.push(`✅ Context: Price at key support level.`);
    }
    const nearestResistance = srLevels.resistances.find(r => r.price > currentPrice);
    if (nearestResistance && Math.abs(currentPrice - nearestResistance.price) < atr * 0.75) {
        contextBearish = 100;
        reasons.push(`✅ Context: Price at key resistance level.`);
    }

    // --- Pillar 4: Entry Trigger Module (High-Precision Confirmation) ---
    const lastKline = klines[klines.length - 1];
    const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes })) as number | undefined;
    let confirmationBullish = 0;
    let confirmationBearish = 0;

    // A. Candlestick Velocity (30%)
    const hasHighVolume = lastKline.volume && volumeSma && lastKline.volume > volumeSma * params.conductor_volumeMultiplier;
    const candlePattern = recognizeCandlestickPattern(lastKline, klines[klines.length - 2]);
    if (candlePattern && hasHighVolume) {
        const range = lastKline.high - lastKline.low;
        if (range > 0) {
            const closePosition = (lastKline.close - lastKline.low) / range;
            if (candlePattern.type === 'bullish' && closePosition > params.conductor_entryTrigger_candleVelocity) {
                confirmationBullish += 30;
                reasons.push(`✅ Trigger: High-velocity bullish candle (${candlePattern.name}).`);
            } else if (candlePattern.type === 'bearish' && closePosition < (1 - params.conductor_entryTrigger_candleVelocity)) {
                confirmationBearish += 30;
                reasons.push(`✅ Trigger: High-velocity bearish candle (${candlePattern.name}).`);
            }
        }
    }
    
    // B. Micro-Timeframe Break of Structure (mBOS) (40%)
    const microStructure = microKlines ? analyzeMicroMarketStructure(microKlines) : null;
    if (microStructure === 'ascending') {
        confirmationBullish += 40;
        reasons.push(`✅ Trigger: Micro-TF is ascending (mBOS).`);
    } else if (microStructure === 'descending') {
        confirmationBearish += 40;
        reasons.push(`✅ Trigger: Micro-TF is descending (mBOS).`);
    }

    // C. RSI Hook (30%)
    const lastRsi = getLast(rsiValues) as number | undefined;
    if (lastRsi && rsiValues.length >= params.conductor_entryTrigger_rsiHookPeriod) {
        const rsiSma = getLast(SMA.calculate({ period: params.conductor_entryTrigger_rsiHookPeriod, values: rsiValues })) as number | undefined;
        if (rsiSma) {
            if (lastRsi > rsiSma && lastRsi < 70) { // Bullish hook below overbought
                confirmationBullish += 30;
                reasons.push(`✅ Trigger: RSI Hooked Up.`);
            } else if (lastRsi < rsiSma && lastRsi > 30) { // Bearish hook above oversold
                confirmationBearish += 30;
                reasons.push(`✅ Trigger: RSI Hooked Down.`);
            }
        }
    }

    // --- Confluence Engine: Final Scoring ---
    const totalBullishScore = 
        (Math.min(100, structureBullish) * weights.structure) +
        (Math.min(100, momentumBullish) * weights.momentum) +
        (Math.min(100, contextBullish) * weights.context) +
        (Math.min(100, confirmationBullish) * weights.confirmation);

    const totalBearishScore = 
        (Math.min(100, structureBearish) * weights.structure) +
        (Math.min(100, momentumBearish) * weights.momentum) +
        (Math.min(100, contextBearish) * weights.context) +
        (Math.min(100, confirmationBearish) * weights.confirmation);

    const conductorAnalysis: ConductorAnalysis = {
        bullish: { total: totalBullishScore, structure: structureBullish, momentum: momentumBullish, context: contextBullish, confirmation: confirmationBullish },
        bearish: { total: totalBearishScore, structure: structureBearish, momentum: momentumBearish, context: contextBearish, confirmation: confirmationBearish }
    };

    reasons.push(`ℹ️ Final Score: Bull ${totalBullishScore.toFixed(0)} vs Bear ${totalBearishScore.toFixed(0)}`);

    if (totalBullishScore >= convictionThreshold && totalBullishScore > totalBearishScore) {
        reasons.unshift(`✅ Bullish conviction threshold met.`);
        return { signal: 'BUY', reasons, conductorAnalysis };
    }

    if (totalBearishScore >= convictionThreshold && totalBearishScore > totalBearishScore) {
        reasons.unshift(`✅ Bearish conviction threshold met.`);
        return { signal: 'SELL', reasons, conductorAnalysis };
    }

    reasons.push(`❌ Conviction threshold of ${convictionThreshold} not met.`);
    return { signal: 'HOLD', reasons, conductorAnalysis };
};
