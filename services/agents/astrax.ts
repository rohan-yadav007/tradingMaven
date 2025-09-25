// services/agents/astrax.ts

import { Kline, BotConfig, TradeSignal, AstraXAnalysis, AgentParams, ADXOutput, MACDOutput, TradingMode, BollingerBandsOutput, StochasticRSIOutput } from '../../types';
import { RSI, MACD, ATR, ADX, BollingerBands, StochasticRSI } from 'technicalindicators';
import { getLast, calculateSessionVwap, calculateDailyVwap } from './agentUtils';
import { findSwingPoints, analyzeMarketStructure } from '../chartAnalysisService';
import { sharedKlineService } from '../sharedKlineService';

interface TimeframeMetrics {
    bullScore: number;
    bearScore: number;
    adx: number;
    atrPercentile: number;
}

const ANALYTICAL_TIMEFRAMES = ['4h', '1h', '15m', '3m'];
const PRIMARY_REFERENCE_TIMEFRAME = '15m'; // Used for structure, VWAP, etc.

interface AstraXRegime {
    regime: AstraXAnalysis['regime'];
    direction: 'bullish' | 'bearish' | 'neutral';
}

/**
 * CORRECTED: Computes a comprehensive set of metrics for a single timeframe as per the AstraX blueprint.
 * This version now correctly uses only MACD for trend and RSI for momentum, removing the incorrect EMA logic.
 */
function computeTimeframeMetrics(klines: Kline[] | undefined): TimeframeMetrics {
    // A long history is needed for reliable ATR percentile calculation.
    if (!klines || klines.length < 200) {
        return { bullScore: 0, bearScore: 0, adx: 15, atrPercentile: 50 }; // Return neutral, default values
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);

    // --- Indicator Calculations ---
    const rsi = getLast(RSI.calculate({ period: 14, values: closes }));
    const macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false })) as MACDOutput | undefined;
    const adxResult = getLast(ADX.calculate({ period: 14, high: highs, low: lows, close: closes })) as ADXOutput;
    const atrValues = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
    const lastAtr = getLast(atrValues);

    let bull = 0;
    let bear = 0;

    // Score: Trend (MACD) - 50 points
    if (macd?.MACD && macd?.signal) {
        if (macd.MACD > macd.signal) bull += 50;
        if (macd.MACD < macd.signal) bear += 50;
    }

    // Score: Momentum (RSI) - 50 points
    const rsiBullThreshold = 52;
    const rsiBearThreshold = 48;
    const rsiBullUpper = 70;
    const rsiBearLower = 30;

    if (rsi && rsi > rsiBullThreshold) {
        bull += Math.min(50, ((rsi - rsiBullThreshold) / (rsiBullUpper - rsiBullThreshold)) * 50);
    }
    if (rsi && rsi < rsiBearThreshold) {
        bear += Math.min(50, ((rsiBearThreshold - rsi) / (rsiBearThreshold - rsiBearLower)) * 50);
    }
    
    // --- ATR Percentile Calculation ---
    if (!lastAtr) {
        return { bullScore: bull, bearScore: bear, adx: adxResult.adx, atrPercentile: 50 };
    }
    const atrHistory = atrValues.slice(-200).filter(v => v !== undefined) as number[];
    const sortedAtr = [...atrHistory].sort((a, b) => a - b);
    const rank = sortedAtr.findIndex(v => v >= lastAtr);
    const atrPercentile = (rank / sortedAtr.length) * 100;

    return {
        bullScore: bull,
        bearScore: bear,
        adx: adxResult.adx,
        atrPercentile: isNaN(atrPercentile) ? 50 : atrPercentile,
    };
}


/**
 * Detects liquidity sweeps on micro timeframes (1m).
 */
function detectLiquiditySweep(klines: Kline[] | undefined, direction: 'bullish' | 'bearish', lookback: number, volMultiplier: number): boolean {
    if (!klines || klines.length < lookback + 20) return false;
    
    const recentKlines = klines.slice(-lookback);
    const volumeHistory = klines.slice(-20).map(k => k.volume || 0);
    const volumeSma = volumeHistory.reduce((acc, v) => acc + v, 0) / 20;

    for (const k of recentKlines) {
        const bodySize = Math.abs(k.close - k.open);
        const upperWick = k.high - Math.max(k.open, k.close);
        const lowerWick = Math.min(k.open, k.close) - k.low;
        const hasHighVolume = (k.volume || 0) > (volumeSma * volMultiplier);

        // A bearish sweep is a long upper wick on high volume, indicating sellers stepped in.
        if (direction === 'bearish' && upperWick > bodySize * 1.5 && hasHighVolume) return true;
        // A bullish sweep is a long lower wick on high volume, indicating buyers stepped in.
        if (direction === 'bullish' && lowerWick > bodySize * 1.5 && hasHighVolume) return true;
    }
    return false;
}

export function getAstraXRegimeAndDirection(
    config: BotConfig,
    klines4h?: Kline[],
    klines1h?: Kline[],
    klines15m?: Kline[],
    klines3m?: Kline[],
): AstraXRegime {
    const params = config.agentParams as Required<AgentParams>;
    const primaryKlines = klines15m;
    
    if (!primaryKlines || primaryKlines.length < 200) {
        return { regime: 'Choppy Market', direction: 'neutral' };
    }
    
    // --- 1. Define Market Regime ---
    const primaryCloses = primaryKlines.map(k => k.close);
    const adx = getLast(ADX.calculate({ high: primaryKlines.map(k=>k.high), low: primaryKlines.map(k=>k.low), close: primaryCloses, period: 14 })) as ADXOutput;
    
    let regime: AstraXAnalysis['regime'] = 'Developing Trend';
    if (adx && adx.adx > params.astraX_strongTrendAdx) {
        regime = 'Strong Trend';
    } else if (adx && adx.adx < params.astraX_chopAdx) {
        regime = 'Choppy Market';
    }

    if (regime === 'Choppy Market') {
        return { regime, direction: 'neutral' };
    }

    // --- 2. Determine Direction from Multi-TF Aggregation ---
    const timeframes = [
        { name: '4h', klines: klines4h, baseWeight: 0.4 },
        { name: '1h', klines: klines1h, baseWeight: 0.3 },
        { name: '15m', klines: klines15m, baseWeight: 0.2 },
        { name: '3m', klines: klines3m, baseWeight: 0.1 },
    ];

    const tfMetrics = timeframes.map(tf => ({ ...tf, metrics: computeTimeframeMetrics(tf.klines) }));
    
    let totalWeight = 0;
    const weightedMetrics = tfMetrics.map(tf => {
        const activityWeight = (tf.metrics.adx / 50) * (tf.metrics.atrPercentile / 100);
        const finalWeight = tf.baseWeight * (1 + activityWeight);
        totalWeight += finalWeight;
        return { ...tf, finalWeight };
    });

    let multiTfBullish = 0;
    let multiTfBearish = 0;

    weightedMetrics.forEach(tf => {
        if(totalWeight > 0) {
            const normalizedWeight = tf.finalWeight / totalWeight;
            multiTfBullish += tf.metrics.bullScore * normalizedWeight;
            multiTfBearish += tf.metrics.bearScore * normalizedWeight;
        }
    });

    const direction = multiTfBullish > multiTfBearish ? 'bullish' : multiTfBullish < multiTfBearish ? 'bearish' : 'neutral';

    return { regime, direction };
}


export const getAstraXSignal = async (config: BotConfig): Promise<TradeSignal> => {
    const params = config.agentParams as Required<AgentParams>;
    const reasons: string[] = [];

    // --- Data Fetching: Agent is now responsible for its own data needs ---
    const [klines4h, klines1h, klines15m, klines3m, oneMinKlines] = await Promise.all([
        sharedKlineService.getData(config.pair, '4h', config.mode),
        sharedKlineService.getData(config.pair, '1h', config.mode),
        sharedKlineService.getData(config.pair, '15m', config.mode),
        sharedKlineService.getData(config.pair, '3m', config.mode),
        sharedKlineService.getData(config.pair, '1m', config.mode) // For liquidity sweeps
    ]);

    // The primary reference klines (15m) are used for structure, VWAP, etc.
    const primaryKlines = klines15m;
    if (!primaryKlines || primaryKlines.length < 200) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient primary TF data for AstraX.`] };
    }
    
    const primaryCloses = primaryKlines.map(k => k.close);
    const currentPrice = getLast(primaryCloses);
    if(!currentPrice) {
        return { signal: 'HOLD', reasons: [`ℹ️ Could not determine current price from primary klines.`] };
    }


    // --- 1. Define Market Regime & Adaptive Threshold ---
    const adx = getLast(ADX.calculate({ high: primaryKlines.map(k=>k.high), low: primaryKlines.map(k=>k.low), close: primaryCloses, period: 14 })) as ADXOutput;
    
    let regime: AstraXAnalysis['regime'] = 'Developing Trend';
    let convictionThreshold = params.astraX_baseThreshold;
    if (adx && adx.adx > params.astraX_strongTrendAdx) {
        regime = 'Strong Trend';
        convictionThreshold *= params.astraX_regimeMultiplier_strong;
    } else if (adx && adx.adx < params.astraX_chopAdx) {
        regime = 'Choppy Market';
        convictionThreshold *= params.astraX_regimeMultiplier_chop;
    }
    reasons.push(`ℹ️ Regime: ${regime} | Entry Threshold: ±${convictionThreshold.toFixed(0)}`);

    // --- 2. Multi-TF Aggregation with Dynamic Weighting ---
    const timeframes = [
        { name: '4h', klines: klines4h, baseWeight: 0.4 },
        { name: '1h', klines: klines1h, baseWeight: 0.3 },
        { name: '15m', klines: klines15m, baseWeight: 0.2 },
        { name: '3m', klines: klines3m, baseWeight: 0.1 },
    ];

    const tfMetrics = timeframes.map(tf => ({ ...tf, metrics: computeTimeframeMetrics(tf.klines) }));
    
    let totalWeight = 0;
    const weightedMetrics = tfMetrics.map(tf => {
        // Activity weight boosts TFs with high ADX and high ATR percentile (volatility)
        const activityWeight = (tf.metrics.adx / 50) * (tf.metrics.atrPercentile / 100);
        const finalWeight = tf.baseWeight * (1 + activityWeight);
        totalWeight += finalWeight;
        return { ...tf, finalWeight };
    });

    let multiTfBullish = 0;
    let multiTfBearish = 0;

    weightedMetrics.forEach(tf => {
        if(totalWeight > 0) {
            const normalizedWeight = tf.finalWeight / totalWeight;
            multiTfBullish += tf.metrics.bullScore * normalizedWeight;
            multiTfBearish += tf.metrics.bearScore * normalizedWeight;
        }
    });
    reasons.push(`✅ Multi-TF Score: Bull ${multiTfBullish.toFixed(0)}, Bear ${multiTfBearish.toFixed(0)}`);

    // --- 3. Market Structure (from Primary Reference TF) ---
    const swingPoints = findSwingPoints(primaryKlines, params.astraX_structureLookback);
    const structureAnalysis = analyzeMarketStructure(swingPoints);
    let structureBullish = 0;
    let structureBearish = 0;
    if (structureAnalysis.structure === 'Uptrend') structureBullish = 100;
    if (structureAnalysis.structure === 'Downtrend') structureBearish = 100;
    if (structureAnalysis.lastSignal === 'ChoCH_Bullish') structureBullish = 80;
    if (structureAnalysis.lastSignal === 'ChoCH_Bearish') structureBearish = 80;
    reasons.push(`✅ Structure: ${structureAnalysis.reason}`);

    // --- 4. VWAP Context (from Primary Reference TF) ---
    const sessionWindows = [{start: 0, end: 8}, {start: 8, end: 16}, {start: 16, end: 24}];
    const { vwap: sessionVwap, session: activeSession } = calculateSessionVwap(primaryKlines, sessionWindows);
    const dailyVwap = getLast(calculateDailyVwap(primaryKlines));
    const vwap = sessionVwap ?? dailyVwap; // Prioritize session VWAP

    let vwapBullish = 0;
    let vwapBearish = 0;
    if (vwap && vwap > 0) {
        const vwapDist = (currentPrice - vwap) / vwap;
        if (vwapDist > 0) {
            vwapBullish = Math.min(100, vwapDist * 100 * params.astraX_vwapDistanceMultiplier);
        } else {
            vwapBearish = Math.min(100, Math.abs(vwapDist) * 100 * params.astraX_vwapDistanceMultiplier);
        }
         reasons.push(`✅ VWAP: Price is ${((currentPrice - vwap) / vwap * 100).toFixed(2)}% from ${sessionVwap ? `Session VWAP (UTC ${activeSession})` : 'Daily VWAP'}`);
    }
    
    // --- 5. Preliminary Conviction Score ---
    const finalBullishScore = (multiTfBullish * 0.5) + (structureBullish * 0.3) + (vwapBullish * 0.2);
    const finalBearishScore = (multiTfBearish * 0.5) + (structureBearish * 0.3) + (vwapBearish * 0.2);
    let conviction = finalBullishScore - finalBearishScore;

    // --- 6. Adjustments & Overrides ---
    // A. Liquidity Sweep Adjustment
    const bullishSweepDetected = detectLiquiditySweep(oneMinKlines, 'bullish', params.astraX_microTfLookback, params.astraX_liquiditySweepMultiplier);
    const bearishSweepDetected = detectLiquiditySweep(oneMinKlines, 'bearish', params.astraX_microTfLookback, params.astraX_liquiditySweepMultiplier);
    
    if (conviction > 0 && bearishSweepDetected) {
        conviction *= 0.5; // Reduce bullish conviction if a bearish sweep is seen
        reasons.push('⚠️ Adjustment: Bearish liquidity sweep reduced conviction.');
    }
    if (conviction < 0 && bullishSweepDetected) {
        conviction *= 0.5; // Reduce bearish conviction if a bullish sweep is seen
        reasons.push('⚠️ Adjustment: Bullish liquidity sweep reduced conviction.');
    }

    // B. Funding Rate Adjustment
    if (config.mode === TradingMode.USDSM_Futures) {
        // NOTE: Live funding rate is not available in the agent service. Using a realistic simulation.
        const simulatedFundingRate = 0.0001; // 0.01%
        const isBullishSignal = conviction > 0;
        const isBearishSignal = conviction < 0;

        const isAdverseFunding = (isBullishSignal && simulatedFundingRate > 0) || (isBearishSignal && simulatedFundingRate < 0);
        if (isAdverseFunding) {
            const periodsInHorizon = params.astraX_holdingPeriodHours / 8; // Funding is typically every 8 hours
            const expectedCostPercent = Math.abs(simulatedFundingRate) * periodsInHorizon;
            const convictionPenalty = expectedCostPercent * 100 * params.astraX_fundingRateMultiplier;
            conviction -= convictionPenalty * (isBullishSignal ? 1 : -1);
            reasons.push(`⚠️ Adjustment: Adverse funding rate reduced conviction by ${convictionPenalty.toFixed(0)}.`);
        }
    }

    // C. Market Structure Override
    if (structureAnalysis.lastSignal === 'ChoCH_Bullish' || structureAnalysis.lastSignal === 'ChoCH_Bearish') {
        conviction = Math.max(-40, Math.min(40, conviction)); // Cap conviction during transition
        reasons.push(`⚠️ Override: ChoCH detected, conviction capped to ±40.`);
    }

    const analysis: AstraXAnalysis = {
        conviction, regime, threshold: convictionThreshold,
        finalBullishScore: finalBullishScore,
        finalBearishScore: finalBearishScore,
    };
    
    if (conviction > convictionThreshold) {
        reasons.push(`✅ Conviction Met: Score ${conviction.toFixed(0)} > ${convictionThreshold.toFixed(0)}`);
        return { signal: 'BUY', reasons, astraXAnalysis: analysis, tradeType: 'conviction' };
    }
    if (conviction < -convictionThreshold) {
        reasons.push(`✅ Conviction Met: Score ${conviction.toFixed(0)} < -${convictionThreshold.toFixed(0)}`);
        return { signal: 'SELL', reasons, astraXAnalysis: analysis, tradeType: 'conviction' };
    }

    reasons.push(`❌ Conviction Unmet: Score ${conviction.toFixed(0)} within threshold.`);
    
    // --- 7. Opportunistic Scalping Module (Only if no conviction signal & regime is choppy) ---
    if (regime === 'Choppy Market') {
        reasons.push('ℹ️ Checking for opportunistic scalp...');

        if (!klines3m || klines3m.length < params.astraX_scalp_bbPeriod!) {
            reasons.push('❌ Scalp: Insufficient 3m data.');
        } else {
            const scalpCloses = klines3m.map(k => k.close);
            const bb = getLast(BollingerBands.calculate({ period: params.astraX_scalp_bbPeriod!, stdDev: params.astraX_scalp_bbStdDev!, values: scalpCloses })) as BollingerBandsOutput | undefined;
            const stochRsiValues = StochasticRSI.calculate({ values: scalpCloses, rsiPeriod: 14, stochasticPeriod: params.astraX_scalp_stochRsiPeriod!, kPeriod: 3, dPeriod: 3 });
            const stochRsi = getLast(stochRsiValues) as StochasticRSIOutput | undefined;
            const prevStochRsi = stochRsiValues.length > 1 ? stochRsiValues[stochRsiValues.length - 2] : undefined;

            if (bb && stochRsi && prevStochRsi) {
                const currentPrice3m = getLast(scalpCloses)!;
                
                // Bullish Scalp Condition
                if (currentPrice3m <= bb.lower && stochRsi.k < params.astraX_scalp_stochRsiOversold! && stochRsi.k > prevStochRsi.k) {
                    reasons.push(`✅ Price at lower Bollinger Band.`);
                    reasons.push(`✅ Confirmation: StochRSI is oversold & crossing up.`);
                    return { signal: 'BUY', reasons, astraXAnalysis: analysis, tradeType: 'scalp' };
                }

                // Bearish Scalp Condition
                if (currentPrice3m >= bb.upper && stochRsi.k > params.astraX_scalp_stochRsiOverbought! && stochRsi.k < prevStochRsi.k) {
                    reasons.push(`✅ Price at upper Bollinger Band.`);
                    reasons.push(`✅ Confirmation: StochRSI is overbought and crossing down.`);
                    return { signal: 'SELL', reasons, astraXAnalysis: analysis, tradeType: 'scalp' };
                }
                
                reasons.push(`ℹ️ Scalp: Price not at BB extremes or StochRSI not confirming.`);
            } else {
                 reasons.push(`❌ Scalp: Could not calculate indicators.`);
            }
        }
    }

    return { signal: 'HOLD', reasons, astraXAnalysis: analysis };
};