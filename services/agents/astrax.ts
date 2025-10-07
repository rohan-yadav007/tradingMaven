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
    const macdValues = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const macd = getLast(macdValues) as MACDOutput | undefined;
    const prevMacd = getPenultimate(macdValues) as MACDOutput | undefined;
    const adxResult = getLast(ADX.calculate({ period: 14, high: highs, low: lows, close: closes })) as ADXOutput;
    const atrValues = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
    const lastAtr = getLast(atrValues) as number | undefined;

    let bull = 0;
    let bear = 0;

    // --- Momentum Quality Score ---
    // Part 1: MACD state and acceleration (50 points)
    if (macd?.histogram && prevMacd?.histogram) {
        if (macd.histogram > 0) {
            bull += 25; // In bullish territory
            if (macd.histogram > prevMacd.histogram) {
                bull += 25; // Accelerating bullish
            }
        }
        if (macd.histogram < 0) {
            bear += 25; // In bearish territory
            if (macd.histogram < prevMacd.histogram) {
                bear += 25; // Accelerating bearish
            }
        }
    }
    
    // Part 2: RSI state and velocity (50 points)
    const bb = getLast(BollingerBands.calculate({ period: 20, stdDev: 2, values: closes })) as BollingerBandsOutput | undefined;
    const bbWidth = bb ? (bb.upper - bb.lower) / bb.middle : 0.01;
    const volatilityFactor = Math.min(1, Math.max(0, (bbWidth - 0.005) / (0.1 - 0.005)));
    const rsiBullThreshold = 51 + (4 * volatilityFactor);
    const rsiBearThreshold = 49 - (4 * volatilityFactor);
    
    if (rsi) {
        if (rsi > rsiBullThreshold) {
            bull += 25; // In bullish control zone
        }
        if (rsi < rsiBearThreshold) {
            bear += 25; // In bearish control zone
        }
    }
    
    const rsiSma = getLast(SMA.calculate({ period: 3, values: rsi ? [rsi] : [] })) as number | undefined;
    if (rsi && rsiSma) {
        if (rsi > rsiSma) {
            bull += 25; // RSI has upward velocity
        }
        if (rsi < rsiSma) {
            bear += 25; // RSI has downward velocity
        }
    }
    
    if (!lastAtr) {
        return { bullScore: bull, bearScore: bear, adx: adxResult.adx, atrPercentile: 50 };
    }
    
    const atrHistory = atrValues.slice(-200).filter(v => v !== undefined) as number[];
    const sortedAtr = [...atrHistory].sort((a, b) => a - b);
    const rank = sortedAtr.reduce((acc, val) => (val < lastAtr ? acc + 1 : acc), 0);
    const percentile = (rank / sortedAtr.length) * 100;

    return { bullScore: bull, bearScore: bear, adx: adxResult.adx, atrPercentile: (isNaN(percentile) || percentile < 0) ? 50 : percentile };
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

function getAstraXScalpSignal(config: BotConfig, scalpKlines: Kline[] | undefined, oneMinKlines: Kline[] | undefined, livePrice?: number): TradeSignal {
    const params = config.agentParams as Required<AgentParams>;
    const reasons: string[] = [];

    if (!scalpKlines || scalpKlines.length < params.astraX_scalp_bbPeriod! + 2) {
        reasons.push(`❌ Scalp: Insufficient data on scalp timeframe.`);
        return { signal: 'HOLD', reasons };
    }

    const scalpCloses = scalpKlines.map(k => k.close);
    const bb = getLast(BollingerBands.calculate({ period: params.astraX_scalp_bbPeriod!, stdDev: params.astraX_scalp_bbStdDev!, values: scalpCloses })) as BollingerBandsOutput | undefined;
    const volumeSma = getLast(SMA.calculate({ period: 20, values: scalpKlines.map(k => k.volume || 0) })) as number | undefined;
    const stochRsiValues = StochasticRSI.calculate({ values: scalpCloses, rsiPeriod: params.astraX_scalp_stochRsiPeriod!, stochasticPeriod: params.astraX_scalp_stochRsiPeriod!, kPeriod: 3, dPeriod: 3 });

    if (params.astraX_scalp_useRetestConfirmation) {
        const retestEma = EMA.calculate({ period: params.astraX_scalp_retestEmaPeriod!, values: scalpCloses });
        const confirmationCandle = scalpKlines[scalpKlines.length - 1];
        
        const lookbackLimit = Math.max(0, scalpKlines.length - 1 - params.astraX_scalp_retestCandleLookback!);
        for (let i = scalpKlines.length - 2; i >= lookbackLimit; i--) {
            const setupCandle = scalpKlines[i];
            const bbForSetup = BollingerBands.calculate({ period: params.astraX_scalp_bbPeriod!, stdDev: params.astraX_scalp_bbStdDev!, values: scalpCloses.slice(0, i + 1) }).pop();

            if (!bbForSetup) continue;

            const isBullishRejection = setupCandle.low <= bbForSetup.lower && setupCandle.close > bbForSetup.lower;
            if (isBullishRejection) {
                const emaForRetest = retestEma[i];
                const isRetest = emaForRetest && confirmationCandle.low <= emaForRetest;
                if (isRetest) {
                     const lastStoch = getLast(stochRsiValues.slice(0, i+2)) as StochasticRSIOutput;
                     const volumeConfirms = (confirmationCandle.volume || 0) > (volumeSma! * params.astraX_scalp_volumeMultiplier!);
                     const isBullishTrigger = confirmationCandle.close > confirmationCandle.open;

                     if (isBullishTrigger && lastStoch && lastStoch.k < params.astraX_scalp_stochRsiOversold! && volumeConfirms) {
                        if (oneMinKlines && oneMinKlines.length > 26) {
                            const microCloses = oneMinKlines.map(k => k.close);
                            const microStochRsi = getLast(StochasticRSI.calculate({ values: microCloses, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;
                            if (microStochRsi && microStochRsi.k > 80) {
                                reasons.push(`❌ Scalp Veto: 1m Momentum Overbought.`);
                                continue;
                            }
                            const microMacdValues = MACD.calculate({ values: microCloses, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
                            const lastHist = (getLast(microMacdValues) as MACDOutput | undefined)?.histogram;
                            const prevHist = (getPenultimate(microMacdValues) as MACDOutput | undefined)?.histogram;
                            if (lastHist !== undefined && prevHist !== undefined) {
                                if (lastHist > 0 && lastHist < prevHist) {
                                    reasons.push(`❌ Scalp Veto: 1m Bullish Momentum is Decelerating.`);
                                    continue;
                                }
                            }
                        }
                        reasons.push(`✅ Scalp: Bullish retest confirmed.`);
                        return { signal: 'BUY', reasons, tradeType: 'scalp' };
                     }
                }
            }

            const isBearishRejection = setupCandle.high >= bbForSetup.upper && setupCandle.close < bbForSetup.upper;
            if (isBearishRejection) {
                const emaForRetest = retestEma[i];
                const isRetest = emaForRetest && confirmationCandle.high >= emaForRetest;
                 if (isRetest) {
                    const lastStoch = getLast(stochRsiValues.slice(0, i+2)) as StochasticRSIOutput;
                    const volumeConfirms = (confirmationCandle.volume || 0) > (volumeSma! * params.astraX_scalp_volumeMultiplier!);
                    const isBearishTrigger = confirmationCandle.close < confirmationCandle.open;
                    
                    if (isBearishTrigger && lastStoch && lastStoch.k > params.astraX_scalp_stochRsiOverbought! && volumeConfirms) {
                        if (oneMinKlines && oneMinKlines.length > 26) {
                            const microCloses = oneMinKlines.map(k => k.close);
                            const microStochRsi = getLast(StochasticRSI.calculate({ values: microCloses, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;
                            if (microStochRsi && microStochRsi.k < 20) {
                                reasons.push(`❌ Scalp Veto: 1m Momentum Oversold.`);
                                continue;
                            }
                            const microMacdValues = MACD.calculate({ values: microCloses, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
                            const lastHist = (getLast(microMacdValues) as MACDOutput | undefined)?.histogram;
                            const prevHist = (getPenultimate(microMacdValues) as MACDOutput | undefined)?.histogram;
                            if (lastHist !== undefined && prevHist !== undefined) {
                                if (lastHist < 0 && lastHist > prevHist) {
                                    reasons.push(`❌ Scalp Veto: 1m Bearish Momentum is Decelerating.`);
                                    continue;
                                }
                            }
                        }
                        reasons.push(`✅ Scalp: Bearish retest confirmed.`);
                        return { signal: 'SELL', reasons, tradeType: 'scalp' };
                    }
                }
            }
        }
    }
    
    reasons.push('ℹ️ No scalp setup found.');
    return { signal: 'HOLD', reasons };
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
    
    if (params.astraX_executionMode === 'scalp') {
        const allTfs = constants.TIME_FRAMES;
        const primaryIndex = allTfs.indexOf(config.timeFrame);
        const scalpTf = primaryIndex > 0 ? allTfs[primaryIndex - 1] : (config.timeFrame === '1m' ? '1m' : null);
        
        if (!scalpTf) {
            return { signal: 'HOLD', reasons: [`❌ Scalp mode not available for timeframe ${config.timeFrame}`] };
        }

        const scalpKlines = klinesMap.get(scalpTf);
        return getAstraXScalpSignal(config, scalpKlines, oneMinKlines, livePrice);
    }
    
    // --- CONVICTION MODE ---
    const primaryKlines = klinesMap.get(config.timeFrame);
    if (!primaryKlines || primaryKlines.length < 200) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient primary TF data for AstraX.`] };
    }
    
    const currentPrice = livePrice || getLast(primaryKlines.map(k=>k.close));
    if(!currentPrice) return { signal: 'HOLD', reasons: [`ℹ️ Could not determine current price.`] };

    const { regime, multiTfBullish, multiTfBearish } = _getMultiTfScoresAndRegime(config, klinesMap, analyticalTimeframes);
    let convictionThreshold = params.astraX_baseThreshold;
    if (regime === 'Strong Trend') convictionThreshold *= params.astraX_regimeMultiplier_strong;
    else if (regime === 'Choppy Market') convictionThreshold *= params.astraX_regimeMultiplier_chop;

    reasons.push(`ℹ️ Regime: ${regime} | Entry Threshold: ±${convictionThreshold.toFixed(0)}`);
    
    // --- Pillar 1: Structure ---
    const swingPoints = findSwingPoints(primaryKlines, params.astraX_structureLookback);
    const structureAnalysis = analyzeMarketStructure(swingPoints);
    let structureBullish = 0, structureBearish = 0;
    if (structureAnalysis.structure === 'Uptrend') structureBullish = 100;
    if (structureAnalysis.structure === 'Downtrend') structureBearish = 100;
    if (structureAnalysis.lastSignal === 'ChoCH_Bullish') structureBullish = 80;
    if (structureAnalysis.lastSignal === 'ChoCH_Bearish') structureBearish = 80;

    // --- Pillar 2: Momentum ---
    // (This is the multiTfBullish/multiTfBearish score)
    
    // --- Pillar 3: Context ---
    let contextBullish = 0, contextBearish = 0;
    // A. VWAP Context
    const vwap = getLast(calculateDailyVwap(primaryKlines));
    if (vwap && vwap > 0) {
        if (currentPrice > vwap) contextBullish += 50;
        else contextBearish += 50;
    }
    // B. Volatility Context
    const primaryMetrics = computeTimeframeMetrics(primaryKlines);
    const atrPercentile = primaryMetrics.atrPercentile;
    // Reward healthy volatility, penalize extremes
    if (atrPercentile > 30 && atrPercentile < 80) {
        contextBullish += 50; contextBearish += 50;
    } else {
        contextBullish -= 25; contextBearish -= 25;
    }

    // --- Pillar 4: Confirmation ---
    let confirmationBullish = 0, confirmationBearish = 0;
    const lastKline = primaryKlines[primaryKlines.length - 1];
    const volumeSma20 = getLast(SMA.calculate({ period: 20, values: primaryKlines.map(k => k.volume || 0) })) as number | undefined;
    if (lastKline.volume && volumeSma20 && lastKline.volume > volumeSma20 * params.astraX_confirmation_minVolumeMultiplier) {
        const bodySize = Math.abs(lastKline.close - lastKline.open);
        const totalRange = lastKline.high - lastKline.low;
        if (totalRange > 0 && bodySize / totalRange > params.astraX_confirmation_candleBodyMinRatio) {
            if (lastKline.close > lastKline.open) confirmationBullish = 100;
            if (lastKline.close < lastKline.open) confirmationBearish = 100;
        }
    }

    // --- Final Score Calculation ---
    const finalBullishScore = 
        (structureBullish * (params.astraX_weights_structure / 100)) +
        (multiTfBullish * (params.astraX_weights_momentum / 100)) +
        (contextBullish * (params.astraX_weights_context / 100)) +
        (confirmationBullish * (params.astraX_weights_confirmation / 100));

    const finalBearishScore = 
        (structureBearish * (params.astraX_weights_structure / 100)) +
        (multiTfBearish * (params.astraX_weights_momentum / 100)) +
        (contextBearish * (params.astraX_weights_context / 100)) +
        (confirmationBearish * (params.astraX_weights_confirmation / 100));

    let conviction = finalBullishScore - finalBearishScore;
    
    const analysis: AstraXAnalysis = { 
        conviction, regime, threshold: convictionThreshold, 
        finalBullishScore, finalBearishScore,
        scores: {
            structure: { bull: structureBullish, bear: structureBearish, weight: params.astraX_weights_structure },
            momentum: { bull: multiTfBullish, bear: multiTfBearish, weight: params.astraX_weights_momentum },
            context: { bull: contextBullish, bear: contextBearish, weight: params.astraX_weights_context },
            confirmation: { bull: confirmationBullish, bear: confirmationBearish, weight: params.astraX_weights_confirmation },
        }
    };
    
    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (conviction >= convictionThreshold) signal = 'BUY';
    else if (conviction <= -convictionThreshold) signal = 'SELL';

    // --- VWAP Hard Veto (if enabled) ---
    if (params.astraX_useVwapAsHardVeto && vwap && vwap > 0) {
        if (signal === 'BUY' && currentPrice < vwap) {
            reasons.push(`❌ VETO: Price is below VWAP (Hard Veto enabled).`);
            signal = 'HOLD';
        }
        if (signal === 'SELL' && currentPrice > vwap) {
            reasons.push(`❌ VETO: Price is above VWAP (Hard Veto enabled).`);
            signal = 'HOLD';
        }
    }

    if (signal !== 'HOLD') {
        reasons.push(`✅ Conviction Met: Score ${conviction.toFixed(0)} vs Threshold ${convictionThreshold.toFixed(0)}`);
        return { signal, reasons, astraXAnalysis: analysis, tradeType: 'conviction' };
    }
    
    if (Math.abs(conviction) < convictionThreshold) {
        reasons.push(`❌ Conviction Unmet: Score ${conviction.toFixed(0)} within threshold.`);
    }

    // Fallback to scalp logic if in conviction mode and market is choppy
    if (params.astraX_scalp_enabledInChop && regime === 'Choppy Market') {
        reasons.push(`ℹ️ Conviction unmet. Checking for fallback scalp trade...`);
        const allTfs = constants.TIME_FRAMES;
        const primaryIndex = allTfs.indexOf(config.timeFrame);
        const scalpTf = primaryIndex > 0 ? allTfs[primaryIndex - 1] : (config.timeFrame === '1m' ? '1m' : null);
        if (scalpTf) {
            const scalpKlines = klinesMap.get(scalpTf);
            const scalpSignal = getAstraXScalpSignal(config, scalpKlines, oneMinKlines, livePrice);
            if (scalpSignal.signal !== 'HOLD') {
                return { ...scalpSignal, astraXAnalysis: analysis };
            }
        }
    } else if (regime === 'Choppy Market') {
        reasons.push(`ℹ️ Fallback scalping in chop is disabled.`);
    }

    return { signal: 'HOLD', reasons, astraXAnalysis: analysis };
};