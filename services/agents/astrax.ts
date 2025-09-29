// services/agents/astrax.ts

import { Kline, BotConfig, TradeSignal, AstraXAnalysis, AgentParams, ADXOutput, MACDOutput, TradingMode, BollingerBandsOutput, StochasticRSIOutput } from '../../types';
import { RSI, MACD, ATR, ADX, BollingerBands, SMA, EMA, StochasticRSI } from 'technicalindicators';
import { calculateDailyVwap, getLast, getPenultimate } from './agentUtils';
import { findSwingPoints, analyzeMarketStructure } from '../chartAnalysisService';
import { sharedKlineService } from '../sharedKlineService';
import * as constants from '../../constants';

interface TimeframeMetrics {
    bullScore: number;
    bearScore: number;
    adx: number;
    atrPercentile: number;
}

export interface AstraXRegime {
    regime: AstraXAnalysis['regime'];
    direction: 'bullish' | 'bearish' | 'neutral';
}

/**
 * Dynamically determines the four most relevant analytical timeframes based on a primary timeframe.
 * It selects the primary, one higher, and two lower timeframes to build a contextual view.
 * @param primaryTf The timeframe selected by the user for the bot.
 * @returns An array of four timeframe strings, sorted from highest to lowest.
 */
export const getAdaptiveAnalyticalTimeframes = (primaryTf: string): string[] => {
    const allTfs = constants.TIME_FRAMES;
    const primaryIndex = allTfs.indexOf(primaryTf);

    if (primaryIndex === -1) {
        // Fallback to original TFs if an unknown timeframe is provided
        return ['4h', '1h', '15m', '3m'];
    }

    const analyticalTfs = new Set<string>();
    analyticalTfs.add(primaryTf);

    // Add one higher TF
    if (primaryIndex < allTfs.length - 1) {
        analyticalTfs.add(allTfs[primaryIndex + 1]);
    }

    // Add two lower TFs
    if (primaryIndex > 0) {
        analyticalTfs.add(allTfs[primaryIndex - 1]);
    }
    if (primaryIndex > 1) {
        analyticalTfs.add(allTfs[primaryIndex - 2]);
    }

    // Ensure we have 4 timeframes, filling with more lower/higher if at the edges of the spectrum
    let lowerCursor = 3;
    while(analyticalTfs.size < 4 && primaryIndex - lowerCursor >= 0) {
        analyticalTfs.add(allTfs[primaryIndex - lowerCursor]);
        lowerCursor++;
    }
    let higherCursor = 2;
    while(analyticalTfs.size < 4 && primaryIndex + higherCursor < allTfs.length) {
        analyticalTfs.add(allTfs[primaryIndex + higherCursor]);
        higherCursor++;
    }

    // Convert to array and sort it from highest to lowest TF for consistent weighting
    return Array.from(analyticalTfs).sort((a, b) => allTfs.indexOf(b) - allTfs.indexOf(a));
};

/**
 * Computes a comprehensive set of metrics for a single timeframe as per the AstraX blueprint.
 */
function computeTimeframeMetrics(klines: Kline[] | undefined): TimeframeMetrics {
    if (!klines || klines.length < 200) {
        return { bullScore: 0, bearScore: 0, adx: 15, atrPercentile: 50 };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);

    const rsi = getLast(RSI.calculate({ period: 14, values: closes })) as number | undefined;
    const macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false })) as MACDOutput | undefined;
    const adxResult = getLast(ADX.calculate({ period: 14, high: highs, low: lows, close: closes })) as ADXOutput;
    const atrValues = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
    const lastAtr = getLast(atrValues);

    let bull = 0;
    let bear = 0;

    if (macd?.MACD && macd?.signal) {
        if (macd.MACD > macd.signal) bull += 50;
        if (macd.MACD < macd.signal) bear += 50;
    }
    
    // --- Dynamic RSI Thresholds ---
    // FIX: Explicitly cast to BollingerBandsOutput
    const bb = getLast(BollingerBands.calculate({ period: 20, stdDev: 2, values: closes })) as BollingerBandsOutput | undefined;
    const bbWidth = bb ? (bb.upper - bb.lower) / bb.middle : 0.01;
    // Normalize BBW from a typical range of 0.005 (low vol) to 0.1 (high vol) to a 0-1 factor
    const volatilityFactor = Math.min(1, Math.max(0, (bbWidth - 0.005) / (0.1 - 0.005)));
    const rsiBullThreshold = 51 + (4 * volatilityFactor); // Scales from 51 (low vol) to 55 (high vol)
    const rsiBearThreshold = 49 - (4 * volatilityFactor); // Scales from 49 (low vol) to 45 (high vol)
    
    const rsiBullUpper = 70, rsiBearLower = 30;
    if (rsi && rsi > rsiBullThreshold) {
        bull += Math.min(50, ((rsi - rsiBullThreshold) / (rsiBullUpper - rsiBullThreshold)) * 50);
    }
    if (rsi && rsi < rsiBearThreshold) {
        bear += Math.min(50, ((rsiBearThreshold - rsi) / (rsiBearThreshold - rsiBearLower)) * 50);
    }
    
    if (!lastAtr) {
        return { bullScore: bull, bearScore: bear, adx: adxResult.adx, atrPercentile: 50 };
    }
    
    // --- Corrected ATR Percentile Calculation ---
    const atrHistory = atrValues.slice(-200).filter(v => v !== undefined) as number[];
    const sortedAtr = [...atrHistory].sort((a, b) => a - b);
    // Count how many historical values are strictly less than the current one to get the rank
    const rank = sortedAtr.reduce((acc, val) => (val < lastAtr ? acc + 1 : acc), 0);
    const percentile = (rank / sortedAtr.length) * 100;

    return { bullScore: bull, bearScore: bear, adx: adxResult.adx, atrPercentile: (isNaN(percentile) || percentile < 0) ? 50 : percentile };
}

/**
 * Detects liquidity sweeps based on market structure (breaking a swing point and closing back inside).
 */
function detectLiquiditySweep(
    klines: Kline[] | undefined,
    direction: 'bullish' | 'bearish', // 'bullish' sweep means hunting for shorts (takes out lows)
    volMultiplier: number,
): boolean {
    if (!klines || klines.length < 20) return false;

    // Use a standard 5-period lookback for identifying robust swing points
    const swingPoints = findSwingPoints(klines, 5);
    const volumeHistory = klines.map(k => k.volume || 0);
    const volumeSma = volumeHistory.slice(-20).reduce((acc, v) => acc + v, 0) / 20;

    const lastCandle = klines[klines.length - 1];

    if (direction === 'bearish') { // Bearish sweep hunts longs, takes out a high then fails
        const lastSwingHigh = swingPoints.filter(p => p.type === 'high' && p.index < klines.length - 1).pop();
        if (!lastSwingHigh) return false;

        const tookOutHigh = lastCandle.high > lastSwingHigh.price;
        const closedBelowHigh = lastCandle.close < lastSwingHigh.price;
        const hasHighVolume = (lastCandle.volume || 0) > (volumeSma * volMultiplier);

        return tookOutHigh && closedBelowHigh && hasHighVolume;
    }

    if (direction === 'bullish') { // Bullish sweep hunts shorts, takes out a low then fails
        const lastSwingLow = swingPoints.filter(p => p.type === 'low' && p.index < klines.length - 1).pop();
        if (!lastSwingLow) return false;

        const tookOutLow = lastCandle.low < lastSwingLow.price;
        const closedAboveLow = lastCandle.close > lastSwingLow.price;
        const hasHighVolume = (lastCandle.volume || 0) > (volumeSma * volMultiplier);

        return tookOutLow && closedAboveLow && hasHighVolume;
    }

    return false;
}

/**
 * Internal helper to compute the market regime and multi-timeframe scores.
 */
function _getMultiTfScoresAndRegime(
    config: BotConfig,
    klinesMap: Map<string, Kline[]>,
    analyticalTimeframes: string[]
) {
    const params = config.agentParams as Required<AgentParams>;
    const primaryKlines = klinesMap.get(config.timeFrame);
    
    if (!primaryKlines || primaryKlines.length < 200) {
        return { regime: 'Choppy Market' as AstraXAnalysis['regime'], multiTfBullish: 50, multiTfBearish: 50, adx: null };
    }
    
    const adx = getLast(ADX.calculate({ high: primaryKlines.map(k=>k.high), low: primaryKlines.map(k=>k.low), close: primaryKlines.map(k => k.close), period: 14 })) as ADXOutput;
    
    let regime: AstraXAnalysis['regime'] = 'Developing Trend';
    if (adx && adx.adx > params.astraX_strongTrendAdx) {
        regime = 'Strong Trend';
    } else if (adx && adx.adx < params.astraX_chopAdx) {
        regime = 'Choppy Market';
    }

    let baseWeights: { [key: string]: number };
    if (regime === 'Strong Trend') {
        baseWeights = { [analyticalTimeframes[0]]: 0.50, [analyticalTimeframes[1]]: 0.35, [analyticalTimeframes[2]]: 0.10, [analyticalTimeframes[3]]: 0.05 };
    } else if (regime === 'Choppy Market') {
        baseWeights = { [analyticalTimeframes[0]]: 0.10, [analyticalTimeframes[1]]: 0.20, [analyticalTimeframes[2]]: 0.45, [analyticalTimeframes[3]]: 0.25 };
    } else { // Developing Trend
        baseWeights = { [analyticalTimeframes[0]]: 0.40, [analyticalTimeframes[1]]: 0.30, [analyticalTimeframes[2]]: 0.20, [analyticalTimeframes[3]]: 0.10 };
    }
    
    const timeframes = analyticalTimeframes.map(tf => ({ name: tf, klines: klinesMap.get(tf), baseWeight: baseWeights[tf] || 0 }));
    const tfMetrics = timeframes.map(tf => ({ ...tf, metrics: computeTimeframeMetrics(tf.klines) }));
    
    let totalWeight = 0;
    const weightedMetrics = tfMetrics.map(tf => {
        const activityWeight = (tf.metrics.adx / 50) * (tf.metrics.atrPercentile / 100);
        const finalWeight = tf.baseWeight * (1 + activityWeight);
        totalWeight += finalWeight;
        return { ...tf, finalWeight };
    });

    let multiTfBullish = 0, multiTfBearish = 0;
    weightedMetrics.forEach(tf => {
        if(totalWeight > 0) {
            const normalizedWeight = tf.finalWeight / totalWeight;
            multiTfBullish += tf.metrics.bullScore * normalizedWeight;
            multiTfBearish += tf.metrics.bearScore * normalizedWeight;
        }
    });

    return { regime, multiTfBullish, multiTfBearish, adx };
}

export function getAstraXRegimeAndDirection(
    config: BotConfig,
    klinesMap: Map<string, Kline[]>,
    analyticalTimeframes: string[],
): AstraXRegime {
    const { regime, multiTfBullish, multiTfBearish } = _getMultiTfScoresAndRegime(config, klinesMap, analyticalTimeframes);
    const direction = multiTfBullish > multiTfBearish ? 'bullish' : multiTfBullish < multiTfBearish ? 'bearish' : 'neutral';
    return { regime, direction };
}


export const getAstraXSignal = async (config: BotConfig, immediateKlines?: Kline[], livePrice?: number, fundingRate?: number): Promise<TradeSignal> => {
    const params = config.agentParams as Required<AgentParams>;
    const reasons: string[] = [];
    const analyticalTimeframes = getAdaptiveAnalyticalTimeframes(config.timeFrame);
    
    const klinePromises = analyticalTimeframes.map(tf => sharedKlineService.getData(config.pair, tf, config.mode));
    const allFetchedKlines = await Promise.all(klinePromises);
    
    const klinesMap = new Map<string, Kline[]>();
    analyticalTimeframes.forEach((tf, index) => klinesMap.set(tf, allFetchedKlines[index]));

    const oneMinKlines = immediateKlines ? immediateKlines : await sharedKlineService.getData(config.pair, '1m', config.mode);
    const primaryKlines = klinesMap.get(config.timeFrame);

    if (!primaryKlines || primaryKlines.length < 200) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient primary TF data for AstraX.`] };
    }
    
    const currentPrice = livePrice || getLast(primaryKlines.map(k=>k.close));
    if(!currentPrice) return { signal: 'HOLD', reasons: [`ℹ️ Could not determine current price.`] };

    const { regime, multiTfBullish, multiTfBearish, adx } = _getMultiTfScoresAndRegime(config, klinesMap, analyticalTimeframes);
    let convictionThreshold = params.astraX_baseThreshold;
    if (regime === 'Strong Trend') convictionThreshold *= params.astraX_regimeMultiplier_strong;
    else if (regime === 'Choppy Market') convictionThreshold *= params.astraX_regimeMultiplier_chop;

    reasons.push(`ℹ️ Regime: ${regime} | Entry Threshold: ±${convictionThreshold.toFixed(0)}`);
    reasons.push(`✅ Multi-TF Score: Bull ${multiTfBullish.toFixed(0)}, Bear ${multiTfBearish.toFixed(0)}`);

    const swingPoints = findSwingPoints(primaryKlines, params.astraX_structureLookback);
    const structureAnalysis = analyzeMarketStructure(swingPoints);
    let structureBullish = 0, structureBearish = 0;
    if (structureAnalysis.structure === 'Uptrend') structureBullish = 100;
    if (structureAnalysis.structure === 'Downtrend') structureBearish = 100;
    if (structureAnalysis.lastSignal === 'ChoCH_Bullish') structureBullish = 80;
    if (structureAnalysis.lastSignal === 'ChoCH_Bearish') structureBearish = 80;
    reasons.push(`✅ Structure: ${structureAnalysis.reason}`);

    const vwap = getLast(calculateDailyVwap(primaryKlines));
    let vwapBullish = 0, vwapBearish = 0;
    if (vwap && vwap > 0) {
        const vwapDist = (currentPrice - vwap) / vwap;
        if (vwapDist > 0) vwapBullish = Math.min(100, vwapDist * 100 * params.astraX_vwapDistanceMultiplier);
        else vwapBearish = Math.min(100, Math.abs(vwapDist) * 100 * params.astraX_vwapDistanceMultiplier);
        reasons.push(`✅ VWAP: Price is ${((currentPrice - vwap) / vwap * 100).toFixed(2)}% from VWAP`);
    }
    
    const finalBullishScore = (multiTfBullish * 0.5) + (structureBullish * 0.3) + (vwapBullish * 0.2);
    const finalBearishScore = (multiTfBearish * 0.5) + (structureBearish * 0.3) + (vwapBearish * 0.2);
    let conviction = finalBullishScore - finalBearishScore;

    const bullishSweepDetected = detectLiquiditySweep(oneMinKlines, 'bullish', params.astraX_liquiditySweepMultiplier);
    const bearishSweepDetected = detectLiquiditySweep(oneMinKlines, 'bearish', params.astraX_liquiditySweepMultiplier);
    if (conviction > 0 && bearishSweepDetected) {
        conviction *= 0.5;
        reasons.push('⚠️ Adjustment: Bearish liquidity sweep reduced conviction.');
    }
    if (conviction < 0 && bullishSweepDetected) {
        conviction *= 0.5;
        reasons.push('⚠️ Adjustment: Bullish liquidity sweep reduced conviction.');
    }

    if (config.mode === TradingMode.USDSM_Futures) {
        // Use the passed fundingRate, or fallback to the simulated one for backtesting/UI preview
        const currentFundingRate = fundingRate ?? 0.0001; 
        const isBullishSignal = conviction > 0;
        const isBearishSignal = conviction < 0;
        const isAdverseFunding = (isBullishSignal && currentFundingRate > 0) || (isBearishSignal && currentFundingRate < 0);
        
        if (isAdverseFunding) {
            const periodsInHorizon = params.astraX_holdingPeriodHours / 8; // Assuming funding every 8 hours
            const convictionPenalty = Math.abs(currentFundingRate) * periodsInHorizon * 100 * params.astraX_fundingRateMultiplier;
            conviction -= convictionPenalty * (isBullishSignal ? 1 : -1);
            reasons.push(`⚠️ Adjustment: Adverse funding rate reduced conviction by ${convictionPenalty.toFixed(0)}.`);
        }
    }

    if (structureAnalysis.lastSignal?.startsWith('ChoCH')) {
        const chochSwingPoint = swingPoints.slice(-2)[0];
        if (chochSwingPoint) {
            const klinesBeforeChoch = primaryKlines.slice(0, chochSwingPoint.index + 1);
            const adxBeforeChochResult = getLast(ADX.calculate({ period: 14, high: klinesBeforeChoch.map(k=>k.high), low: klinesBeforeChoch.map(k=>k.low), close: klinesBeforeChoch.map(k => k.close) })) as ADXOutput | undefined;
            const adxBeforeChoch = adxBeforeChochResult ? adxBeforeChochResult.adx : params.astraX_chopAdx;
            const adxRange = params.astraX_strongTrendAdx - params.astraX_chopAdx;
            const adxProgress = Math.max(0, Math.min(1, (adxBeforeChoch - params.astraX_chopAdx) / adxRange));
            const adaptiveCap = 40 + (adxProgress * 20); // Scales cap from 40 to 60
            conviction = Math.max(-adaptiveCap, Math.min(adaptiveCap, conviction));
            reasons.push(`⚠️ Override: ChoCH detected, conviction capped to ±${adaptiveCap.toFixed(0)} based on prior trend strength (ADX ${adxBeforeChoch.toFixed(1)}).`);
        } else {
             conviction = Math.max(-40, Math.min(40, conviction));
             reasons.push(`⚠️ Override: ChoCH detected, conviction capped to ±40.`);
        }
    }

    const analysis: AstraXAnalysis = { conviction, regime, threshold: convictionThreshold, finalBullishScore, finalBearishScore };
    
    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (conviction >= convictionThreshold) signal = 'BUY';
    else if (conviction <= -convictionThreshold) signal = 'SELL';

    if (signal !== 'HOLD' && config.entryTiming === 'onNextCandle') {
        const signalCandle = getLast(primaryKlines);
        if (signalCandle) {
            const range = signalCandle.high - signalCandle.low;
            const bodySize = Math.abs(signalCandle.close - signalCandle.open);
            if (range > 0 && (bodySize / range < 0.15)) {
                reasons.push(`❌ FAIL-SAFE: Signal candle has a very small body (Indecision).`);
                return { signal: 'HOLD', reasons, astraXAnalysis: analysis };
            }
            if (signal === 'BUY') {
                const isBullishCandle = signalCandle.close > signalCandle.open;
                const closesInUpperPortion = signalCandle.close >= signalCandle.low + (range * 0.40); 
                if (!isBullishCandle || !closesInUpperPortion) {
                    reasons.push(`❌ FAIL-SAFE: Signal candle lacks bullish confirmation (weak close or bearish body).`);
                    return { signal: 'HOLD', reasons, astraXAnalysis: analysis };
                }
            }
            if (signal === 'SELL') {
                const isBearishCandle = signalCandle.close < signalCandle.open;
                const closesInLowerPortion = signalCandle.close <= signalCandle.high - (range * 0.40);
                if (!isBearishCandle || !closesInLowerPortion) {
                    reasons.push(`❌ FAIL-SAFE: Signal candle lacks bearish confirmation (weak close or bullish body).`);
                    return { signal: 'HOLD', reasons, astraXAnalysis: analysis };
                }
            }
            reasons.push(`✅ Fail-Safe: Signal candle structure confirmed.`);
        }
    }

    if (signal !== 'HOLD') {
        reasons.push(`✅ Conviction Met: Score ${conviction.toFixed(0)} vs Threshold ${convictionThreshold.toFixed(0)}`);
        return { signal, reasons, astraXAnalysis: analysis, tradeType: 'conviction' };
    }

    reasons.push(`❌ Conviction Unmet: Score ${conviction.toFixed(0)} within threshold.`);
    
    const allTfs = constants.TIME_FRAMES;
    const primaryIndex = allTfs.indexOf(config.timeFrame);
    const scalpTf = primaryIndex > 0 ? allTfs[primaryIndex - 1] : null;

    if (regime === 'Choppy Market' && scalpTf) {
        reasons.push(`ℹ️ Checking for opportunistic scalp on ${scalpTf}...`);
        const scalpKlines = klinesMap.get(scalpTf);
        if (!scalpKlines || scalpKlines.length < params.astraX_scalp_bbPeriod! + 2) {
             reasons.push(`❌ Scalp: Insufficient ${scalpTf} data.`);
        } else {
            const confirmationCandle = scalpKlines[scalpKlines.length - 1];
            if (!confirmationCandle.isFinal) {
                reasons.push(`ℹ️ Scalp: Waiting for ${scalpTf} candle to close.`);
                return { signal: 'HOLD', reasons, astraXAnalysis: analysis };
            }

            const bb = getLast(BollingerBands.calculate({ period: params.astraX_scalp_bbPeriod!, stdDev: params.astraX_scalp_bbStdDev!, values: scalpKlines.map(k => k.close) })) as BollingerBandsOutput | undefined;
            const volumeSma = getLast(SMA.calculate({ period: 20, values: scalpKlines.map(k => k.volume || 0) })) as number | undefined;
            const stochRsiValues = StochasticRSI.calculate({ values: scalpKlines.map(k=>k.close), rsiPeriod: params.astraX_scalp_stochRsiPeriod!, stochasticPeriod: params.astraX_scalp_stochRsiPeriod!, kPeriod: 3, dPeriod: 3 });
            const lastStoch = getLast(stochRsiValues) as StochasticRSIOutput | undefined;
            const prevStoch = getPenultimate(stochRsiValues) as StochasticRSIOutput | undefined;

            if (bb && volumeSma && lastStoch && prevStoch) {
                const rejectionCandle = scalpKlines[scalpKlines.length - 2];
                
                const isBullishRejection = rejectionCandle.low <= bb.lower && rejectionCandle.close > bb.lower;
                if (isBullishRejection) {
                    reasons.push(`✅ Price rejected lower BB on ${scalpTf}.`);
                    // FIX: Access properties on StochasticRSIOutput type after checking for undefined
                    const stochConfirms = lastStoch.k < params.astraX_scalp_stochRsiOversold! && lastStoch.k > lastStoch.d && prevStoch.k <= prevStoch.d;
                    const volumeConfirms = (confirmationCandle.volume || 0) > (volumeSma * params.astraX_scalp_volumeMultiplier!);
                    if(stochConfirms && volumeConfirms) {
                        reasons.push(`✅ Confirmation: Scalp confirmed by StochRSI crossover and Volume.`);
                        return { signal: 'BUY', reasons, astraXAnalysis: analysis, tradeType: 'scalp' };
                    } else reasons.push(`❌ Confirmation: No StochRSI/Volume follow-through.`);
                }

                const isBearishRejection = rejectionCandle.high >= bb.upper && rejectionCandle.close < bb.upper;
                 if (isBearishRejection) {
                    reasons.push(`✅ Price rejected upper BB on ${scalpTf}.`);
                    // FIX: Access properties on StochasticRSIOutput type after checking for undefined
                    const stochConfirms = lastStoch.k > params.astraX_scalp_stochRsiOverbought! && lastStoch.k < lastStoch.d && prevStoch.k >= prevStoch.d;
                    const volumeConfirms = (confirmationCandle.volume || 0) > (volumeSma * params.astraX_scalp_volumeMultiplier!);
                    if(stochConfirms && volumeConfirms) {
                        reasons.push(`✅ Confirmation: Scalp confirmed by StochRSI crossover and Volume.`);
                        return { signal: 'SELL', reasons, astraXAnalysis: analysis, tradeType: 'scalp' };
                    } else reasons.push(`❌ Confirmation: No StochRSI/Volume follow-through.`);
                }
                if (!isBullishRejection && !isBearishRejection) reasons.push(`ℹ️ Scalp: No valid rejection setup.`);
            } else reasons.push(`❌ Scalp: Could not calculate indicators.`);
        }
    }

    return { signal: 'HOLD', reasons, astraXAnalysis: analysis };
};