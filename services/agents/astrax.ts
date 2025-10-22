// services/agents/astrax.ts

import { Kline, BotConfig, TradeSignal, AstraXAnalysis, AgentParams, ADXOutput, MACDOutput, TradingMode, BollingerBandsOutput, StochasticRSIOutput } from '../../types';
import { RSI, MACD, ATR, ADX, BollingerBands, SMA, EMA, StochasticRSI } from 'technicalindicators';
import { calculateDailyVwap, getLast, getPenultimate } from './agentUtils';
import { findSwingPoints, analyzeMarketStructure } from '../chartAnalysisService';
import { sharedKlineService } from '../sharedKlineService';
import * as constants from '../../constants';
import { marketBreadthService } from '../marketBreadthService';
import { liquidationAnalysisService } from '../liquidationAnalysisService';


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
 * Dynamically determines the relevant analytical timeframes based on a primary timeframe,
 * using a bottom-up confluence model. It selects the primary timeframe and all standard
 * timeframes below it.
 * @param primaryTf The timeframe selected by the user for the bot.
 * @returns An array of timeframe strings, sorted from highest to lowest.
 */
export const getLowerConfluenceTimeframes = (primaryTf: string): string[] => {
    const allTfs = constants.TIME_FRAMES;
    const primaryIndex = allTfs.indexOf(primaryTf);

    if (primaryIndex === -1) {
        // Fallback for an unknown timeframe, though this shouldn't happen
        return [primaryTf];
    }

    // Get all timeframes from the lowest up to and including the primary
    const lowerTfs = allTfs.slice(0, primaryIndex + 1);
    
    // Sort from highest to lowest timeframe for consistent weighting logic
    return lowerTfs.sort((a, b) => allTfs.indexOf(b) - allTfs.indexOf(a));
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

    const N = analyticalTimeframes.length;
    let weights: number[];

    if (regime === 'Strong Trend') {
        // Emphasize higher TFs: N^2, (N-1)^2, ...
        weights = Array.from({ length: N }, (_, i) => Math.pow(N - i, 2));
    } else if (regime === 'Choppy Market') {
        // Emphasize lower TFs: 1, 2, ... (since TFs are high-to-low, this is reversed)
        weights = Array.from({ length: N }, (_, i) => i + 1).reverse();
    } else { // Developing Trend
        // Linear emphasis on higher TFs: N, N-1, ...
        weights = Array.from({ length: N }, (_, i) => N - i);
    }

    const totalInitialWeight = weights.reduce((sum, w) => sum + w, 0);
    const normalizedWeights = totalInitialWeight > 0 ? weights.map(w => w / totalInitialWeight) : [];
    
    const baseWeights: { [key: string]: number } = {};
    analyticalTimeframes.forEach((tf, index) => {
        baseWeights[tf] = normalizedWeights[index] || 0;
    });
    
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
    const analyticalTimeframes = getLowerConfluenceTimeframes(config.timeFrame);
    
    const klinePromises = analyticalTimeframes.map(tf => sharedKlineService.getData(config.pair, tf, config.mode));
    const allFetchedKlines = await Promise.all(klinePromises);
    
    const klinesMap = new Map<string, Kline[]>();
    analyticalTimeframes.forEach((tf, index) => klinesMap.set(tf, allFetchedKlines[index]));

    const primaryKlines = klinesMap.get(config.timeFrame);
    if (!primaryKlines || primaryKlines.length < 200) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient primary TF data for AstraX.`] };
    }
    
    // =================================================================================
    // LEVEL 1: THE THESIS - Determine high-level bias and market regime.
    // =================================================================================
    const { regime, multiTfBullish, multiTfBearish } = _getMultiTfScoresAndRegime(config, klinesMap, analyticalTimeframes);
    const directionalBias = multiTfBullish > multiTfBearish ? 'Bullish' : multiTfBullish < multiTfBearish ? 'Bearish' : 'Neutral';
    
    reasons.push(`ℹ️ Thesis: ${directionalBias} Bias in a ${regime} market.`);
    if (directionalBias === 'Neutral') {
        return { signal: 'HOLD', reasons: [...reasons, `❌ No directional bias.`] };
    }
    
    // =================================================================================
    // LEVEL 2: THE SETUP - Find a high-probability entry pattern matching the thesis.
    // =================================================================================
    let setupFound = false;
    let setupType: 'Pullback' | 'Mean Reversion' | null = null;
    const lastKline = primaryKlines[primaryKlines.length-1];
    
    if (regime === 'Strong Trend' || regime === 'Developing Trend') {
        // Look for a pullback to a short-term EMA
        const retestEma = EMA.calculate({ period: params.astraX_scalp_retestEmaPeriod, values: primaryKlines.map(k=>k.close) });
        const lastEma = getLast(retestEma) as number | undefined;

        if (lastEma) {
            if (directionalBias === 'Bullish' && lastKline.low <= lastEma && lastKline.close > lastEma) {
                setupFound = true;
                setupType = 'Pullback';
                reasons.push(`✅ Setup: Bullish pullback to ${params.astraX_scalp_retestEmaPeriod}-EMA.`);
            }
            if (directionalBias === 'Bearish' && lastKline.high >= lastEma && lastKline.close < lastEma) {
                setupFound = true;
                setupType = 'Pullback';
                reasons.push(`✅ Setup: Bearish pullback to ${params.astraX_scalp_retestEmaPeriod}-EMA.`);
            }
        }
    } else { // Choppy Market
        // Look for mean reversion from BB extremes, using the retest confirmation logic
        const bb = getLast(BollingerBands.calculate({ period: params.astraX_scalp_bbPeriod, stdDev: params.astraX_scalp_bbStdDev, values: primaryKlines.map(k=>k.close) })) as BollingerBandsOutput;
        if (bb) {
            if (directionalBias === 'Bullish' && lastKline.low <= bb.lower && lastKline.close > bb.lower) {
                setupFound = true;
                setupType = 'Mean Reversion';
                reasons.push(`✅ Setup: Bullish mean reversion from lower Bollinger Band.`);
            }
            if (directionalBias === 'Bearish' && lastKline.high >= bb.upper && lastKline.close < bb.upper) {
                setupFound = true;
                setupType = 'Mean Reversion';
                reasons.push(`✅ Setup: Bearish mean reversion from upper Bollinger Band.`);
            }
        }
    }

    if (!setupFound) {
        return { signal: 'HOLD', reasons: [...reasons, `❌ No valid setup found.`] };
    }

    // =================================================================================
    // LEVEL 3: THE TRIGGER - Confirm the entry with final pillar scores.
    // =================================================================================
    const convictionThreshold = regime === 'Strong Trend' ? params.astraX_strongTrendThreshold : params.astraX_chopAdx;
    
    // --- Pillar 1: Structure ---
    const swingPoints = findSwingPoints(primaryKlines, params.astraX_structureLookback);
    const structureAnalysis = analyzeMarketStructure(swingPoints);
    let structureBullish = 0, structureBearish = 0;
    if (structureAnalysis.structure === 'Uptrend') structureBullish = 100;
    if (structureAnalysis.structure === 'Downtrend') structureBearish = 100;
    if (structureAnalysis.lastSignal === 'ChoCH_Bullish') structureBullish = 80;
    if (structureAnalysis.lastSignal === 'ChoCH_Bearish') structureBearish = 80;

    // --- Pillar 2: Momentum (is our Thesis) ---
    const momentumBullish = multiTfBullish;
    const momentumBearish = multiTfBearish;

    // --- Pillar 3: Context ---
    const vwap = getLast(calculateDailyVwap(primaryKlines));
    const primaryMetrics = computeTimeframeMetrics(primaryKlines);
    const atrPercentile = primaryMetrics.atrPercentile;
    let contextBullish = 0, contextBearish = 0;

    if (vwap) {
        contextBullish += (lastKline.close > vwap ? 1 : 0) * 35;
        contextBearish += (lastKline.close < vwap ? 1 : 0) * 35;
    }
    contextBullish += (atrPercentile > 20 && atrPercentile < 85 ? 1 : -1) * 15;
    contextBearish += (atrPercentile > 20 && atrPercentile < 85 ? 1 : -1) * 15;
    
    // Integrated Market Breadth check
    const breadthVeto = marketBreadthService.getMarketBreadthVeto(directionalBias === 'Bullish' ? 'BUY' : 'SELL');
    contextBullish += (!breadthVeto.veto ? 1 : -1) * 25;
    contextBearish += (!breadthVeto.veto ? 1 : -1) * 25;
    
    // Integrated Liquidation check
    if (config.mode === TradingMode.USDSM_Futures) {
        const liqVeto = liquidationAnalysisService.getLiquidationVeto(directionalBias === 'Bullish' ? 'BUY' : 'SELL', config.pair, config);
        contextBullish += (!liqVeto.veto ? 1 : -1) * 25;
        contextBearish += (!liqVeto.veto ? 1 : -1) * 25;
    } else {
        contextBullish += 25; contextBearish += 25;
    }

    // --- Pillar 4: Confirmation ---
    let confirmationBullish = 0, confirmationBearish = 0;
    const volumeSma = getLast(SMA.calculate({ period: 20, values: primaryKlines.map(k => k.volume || 0) })) as number | undefined;
    if (lastKline.volume && volumeSma && lastKline.volume > volumeSma * params.astraX_confirmation_minVolumeMultiplier) {
        if (lastKline.close > lastKline.open) confirmationBullish = 100;
        else confirmationBearish = 100;
    }

    // --- Final Score Calculation ---
    const finalBullishScore = 
        (structureBullish * (params.astraX_weights_structure / 100)) +
        (momentumBullish * (params.astraX_weights_momentum / 100)) +
        (contextBullish * (params.astraX_weights_context / 100)) +
        (confirmationBullish * (params.astraX_weights_confirmation / 100));

    const finalBearishScore = 
        (structureBearish * (params.astraX_weights_structure / 100)) +
        (momentumBearish * (params.astraX_weights_momentum / 100)) +
        (contextBearish * (params.astraX_weights_context / 100)) +
        (confirmationBearish * (params.astraX_weights_confirmation / 100));

    let conviction = finalBullishScore - finalBearishScore;
    
    const analysis: AstraXAnalysis = { 
        conviction, regime, threshold: convictionThreshold, 
        finalBullishScore, finalBearishScore,
        scores: {
            structure: { bull: structureBullish, bear: structureBearish, weight: params.astraX_weights_structure },
            momentum: { bull: momentumBullish, bear: momentumBearish, weight: params.astraX_weights_momentum },
            context: { bull: contextBullish, bear: contextBearish, weight: params.astraX_weights_context },
            confirmation: { bull: confirmationBullish, bear: confirmationBearish, weight: params.astraX_weights_confirmation },
        }
    };
    
    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (directionalBias === 'Bullish' && conviction >= convictionThreshold) {
        signal = 'BUY';
        reasons.push(`✅ Trigger: Final conviction score ${conviction.toFixed(0)} meets threshold.`);
    } else if (directionalBias === 'Bearish' && conviction <= -convictionThreshold) {
        signal = 'SELL';
        reasons.push(`✅ Trigger: Final conviction score ${conviction.toFixed(0)} meets threshold.`);
    } else {
        reasons.push(`❌ Trigger: Final conviction score ${conviction.toFixed(0)} did not meet threshold.`);
    }

    return { signal, reasons, astraXAnalysis: analysis, tradeType: setupType === 'Pullback' ? 'conviction' : 'scalp' };
};