// services/vetoService.ts

import { Kline, BotConfig, MarketDataContext, StochasticRSIOutput, MACDOutput, ADXOutput } from '../types';
import { RSI, StochasticRSI, ADX, MACD, SMA, EMA } from 'technicalindicators';
import * as constants from '../constants';
import { btcConfirmationService } from './btcConfirmationService';
import { findSwingPoints, analyzeMarketStructure } from './chartAnalysisService';
import { getLast, detectRsiDivergence as isRsiDivergent } from './agents/agentUtils';

/**
 * A universal gatekeeper to prevent entering trades when the trend is likely exhausted.
 * This enhanced version requires both StochRSI overextension AND RSI divergence to veto.
 */
export function getExhaustionFilterVeto(
    klines: Kline[],
    direction: 'BUY' | 'SELL',
    config: BotConfig,
): { veto: boolean; reason: string } {
    if (klines.length < 30) return { veto: false, reason: '' }; // Need enough data for calculations
    const closes = klines.map(k => k.close);
    
    const rsiValues = RSI.calculate({ period: 14, values: closes });
    const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;
    
    if (!stochRsi) return { veto: false, reason: '' };
    
    const timeframeSettings = constants.EXHAUSTION_FILTER_TIMEFRAME_SETTINGS[config.timeFrame] || constants.EXHAUSTION_FILTER_TIMEFRAME_SETTINGS['15m'];
    const isLong = direction === 'BUY';
    const positionDirection = isLong ? 'LONG' : 'SHORT';

    const isOverextended = isLong ? stochRsi.k > timeframeSettings.overbought : stochRsi.k < timeframeSettings.oversold;
    
    if (isOverextended) {
        const hasDivergence = isRsiDivergent(klines, rsiValues, positionDirection, 14);
        if (hasDivergence) {
            return { veto: true, reason: `❌ VETO: Exhaustion risk detected (StochRSI Overextended + RSI Divergence)` };
        }
    }

    return { veto: false, reason: '' };
}


/**
 * A universal gatekeeper to prevent entering trades when the trend is likely exhausted.
 */
export function getMeanReversionVeto(
    klines: Kline[],
    direction: 'BUY' | 'SELL',
    config: BotConfig,
): { veto: boolean; reason: string } {
    const params = config.agentParams as Required<typeof constants.DEFAULT_AGENT_PARAMS>;
    const closes = klines.map(k => k.close);
    const lastRsi = getLast(RSI.calculate({ period: 14, values: closes })) as number | undefined;
    if (lastRsi === undefined) return { veto: false, reason: '' };
    
    const isLong = direction === 'BUY';

    if (config.agent.id === 9) {
        const isOverextended = isLong
            ? lastRsi > params.qsc_rsiOverextendedLong
            : lastRsi < params.qsc_rsiOverextendedShort;
        
        if (isOverextended) {
            return { veto: true, reason: `❌ VETO: Mean Reversion risk detected (RSI: ${lastRsi.toFixed(1)})` };
        }
    }
    return { veto: false, reason: '' };
}

/**
 * A universal gatekeeper to ensure trade entries align with higher timeframe momentum.
 */
export function getHtfMomentumSyncVeto(
    direction: 'BUY' | 'SELL',
    htfContext: MarketDataContext | undefined,
    config: BotConfig,
): { veto: boolean; reason: string } {
    if (!config.isHtfConfirmationEnabled || !htfContext?.htf_stochRsi) {
        return { veto: false, reason: '' };
    }
    
    const params = config.agentParams as Required<typeof constants.DEFAULT_AGENT_PARAMS>;
    const htfStochRsi = htfContext.htf_stochRsi;
    const isLong = direction === 'BUY';

    const isHtfOverbought = htfStochRsi.k > params.qsc_stochRsiOverbought;
    const isHtfOversold = htfStochRsi.k < params.qsc_stochRsiOversold;

    if (isLong && isHtfOverbought) {
        return { veto: true, reason: `❌ VETO: HTF Momentum is overbought (StochRSI K: ${htfStochRsi.k.toFixed(1)})` };
    }
    if (!isLong && isHtfOversold) {
        return { veto: true, reason: `❌ VETO: HTF Momentum is oversold (StochRSI K: ${htfStochRsi.k.toFixed(1)})` };
    }

    return { veto: false, reason: '' };
}

export function getBtcTrendScore(
    btcKlines: Kline[]
): { bullScore: number; bearScore: number } {
    if (btcKlines.length < 50) {
        return { bullScore: 50, bearScore: 50 };
    }

    const closes = btcKlines.map(k => k.close);
    const highs = btcKlines.map(k => k.high);
    const lows = btcKlines.map(k => k.low);
    const currentPrice = getLast(closes)! as number;

    let bullScore = 0;
    let bearScore = 0;

    const ema21 = getLast(EMA.calculate({ period: 21, values: closes })) as number | undefined;
    const ema50 = getLast(EMA.calculate({ period: 50, values: closes })) as number | undefined;
    if (ema21 && ema50 && currentPrice > ema21 && ema21 > ema50) {
        bullScore += 50;
    } else if (ema21 && ema50 && currentPrice < ema21 && ema21 < ema50) {
        bearScore += 50;
    }

    const macdValues = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const macd = getLast(macdValues) as MACDOutput | undefined;
    const prevMacd = macdValues[macdValues.length - 2] as MACDOutput | undefined;
    if (macd?.histogram !== undefined && prevMacd?.histogram !== undefined && macd.histogram > 0 && macd.histogram > (prevMacd.histogram || 0)) {
        bullScore += 30;
    } else if (macd?.histogram !== undefined && prevMacd?.histogram !== undefined && macd.histogram < 0 && macd.histogram < (prevMacd.histogram || 0)) {
        bearScore += 30;
    }
    
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: 14 })) as ADXOutput | undefined;
    if (adx && adx.adx > 20) {
        if (adx.pdi > adx.mdi) {
            bullScore += 20;
        } else if (adx.mdi > adx.pdi) {
            bearScore += 20;
        }
    }

    return { bullScore, bearScore };
}

/**
 * The core detection logic for the Smart Money Concepts (SMC) reversal pattern.
 * Exported for use in both entry veto and trade management.
 */
export function detectSmcReversalPattern(
    klines: Kline[],
    reversalTypeToDetect: 'bullish' | 'bearish', // e.g., 'bearish' to find a reason to exit a LONG or veto a BUY
    config: BotConfig,
    rsiValues: number[],
    volumeSma: number | undefined,
): { detected: boolean; reason: string } {
    const params = config.agentParams as Required<typeof constants.DEFAULT_AGENT_PARAMS>;
    const lookback = params.smc_divergenceLookback;
    
    const rsiStartIndex = klines.length - rsiValues.length;
    if (rsiStartIndex < 0) return { detected: false, reason: '' };
    const getRsiForKlineIndex = (klineIndex: number): number | undefined => {
        const rsiIndex = klineIndex - rsiStartIndex;
        if (rsiIndex >= 0 && rsiIndex < rsiValues.length) {
            return rsiValues[rsiIndex];
        }
        return undefined;
    };

    const pivots: { index: number; price: number, type: 'high' | 'low' }[] = [];
    for (let i = Math.max(lookback, rsiStartIndex); i < klines.length - lookback; i++) {
        const window = klines.slice(i - lookback, i + 1 + lookback);
        const currentHigh = klines[i].high;
        const currentLow = klines[i].low;
        if (currentHigh === Math.max(...window.map(k => k.high))) pivots.push({ index: i, price: currentHigh, type: 'high'});
        if (currentLow === Math.min(...window.map(k => k.low))) pivots.push({ index: i, price: currentLow, type: 'low'});
    }

    if (reversalTypeToDetect === 'bearish') {
        const recentHighs = pivots.filter(p => p.type === 'high').slice(-2);
        if (recentHighs.length === 2) {
            const [prevHigh, lastHigh] = recentHighs;
            const prevRsi = getRsiForKlineIndex(prevHigh.index);
            const lastRsi = getRsiForKlineIndex(lastHigh.index);

            if (prevRsi !== undefined && lastRsi !== undefined) {
                const priceMakesHigherHigh = lastHigh.price > prevHigh.price;
                const rsiMakesLowerHigh = lastRsi < prevRsi;
                
                if (priceMakesHigherHigh && rsiMakesLowerHigh) {
                    const sweepCandle = klines[lastHigh.index];
                    const hasHighVolume = sweepCandle.volume! > (volumeSma || 0) * params.smc_volumeMultiplier;
                    
                    if (hasHighVolume) {
                        return { detected: true, reason: `SMC Reversal: Bearish divergence + liquidity sweep.` };
                    }
                }
            }
        }
    }

    if (reversalTypeToDetect === 'bullish') {
        const recentLows = pivots.filter(p => p.type === 'low').slice(-2);
        if (recentLows.length === 2) {
            const [prevLow, lastLow] = recentLows;
            const prevRsi = getRsiForKlineIndex(prevLow.index);
            const lastRsi = getRsiForKlineIndex(lastLow.index);

            if (prevRsi !== undefined && lastRsi !== undefined) {
                const priceMakesLowerLow = lastLow.price < prevLow.price;
                const rsiMakesHigherLow = lastRsi > prevRsi;

                if (priceMakesLowerLow && rsiMakesHigherLow) {
                    const sweepCandle = klines[lastLow.index];
                    const hasHighVolume = sweepCandle.volume! > (volumeSma || 0) * params.smc_volumeMultiplier;

                    if (hasHighVolume) {
                        return { detected: true, reason: `SMC Reversal: Bullish divergence + liquidity sweep.` };
                    }
                }
            }
        }
    }
    
    return { detected: false, reason: '' };
}


/**
 * Gatekeeper: Implements the Smart Money Concepts (SMC) reversal pattern veto for new entries.
 */
export function getSmcVeto(
    klines: Kline[],
    direction: 'BUY' | 'SELL',
    config: BotConfig,
    rsiValues: number[],
    volumeSma: number | undefined,
): { veto: boolean; reason: string } {
    if (!config.isSmcVetoEnabled || klines.length < 50) {
        return { veto: false, reason: '' };
    }

    // A BUY signal should be vetoed by a potential BEARISH reversal pattern.
    const reversalTypeToDetect = direction === 'BUY' ? 'bearish' : 'bullish';
    const result = detectSmcReversalPattern(klines, reversalTypeToDetect, config, rsiValues, volumeSma);
    
    if (result.detected) {
        return { veto: true, reason: `❌ VETO: ${result.reason}` };
    }

    return { veto: false, reason: '' };
}


export function getMarketStructureVeto(
    klines: Kline[],
    direction: 'BUY' | 'SELL',
): { veto: boolean; reason: string } {
    if (klines.length < 50) {
        return { veto: false, reason: '' };
    }

    const swingPoints = findSwingPoints(klines, 5);
    if (swingPoints.length < 4) {
        return { veto: false, reason: 'ℹ️ Insufficient swing points for structure analysis.' };
    }
    
    const analysis = analyzeMarketStructure(swingPoints);
    const isLongSignal = direction === 'BUY';

    if (isLongSignal) {
        if (analysis.structure === 'Downtrend' || analysis.lastSignal === 'ChoCH_Bearish') {
            return { veto: true, reason: `❌ VETO: Market structure is bearish. ${analysis.reason}` };
        }
    } else { // SELL signal
        if (analysis.structure === 'Uptrend' || analysis.lastSignal === 'ChoCH_Bullish') {
            return { veto: true, reason: `❌ VETO: Market structure is bullish. ${analysis.reason}` };
        }
    }

    return { veto: false, reason: `✅ MS Veto: ${analysis.reason}` };
}

/**
 * NEW: A crucial safety filter to prevent entering trades against strong, immediate momentum.
 * This acts as a "falling knife" or "overheated rocket" detector.
 */
export function getImmediateTrendVeto(
    klines: Kline[],
    direction: 'BUY' | 'SELL',
): { veto: boolean; reason: string } {
    if (klines.length < 10) return { veto: false, reason: '' };

    const closes = klines.map(k => k.close);
    const lastClose = closes[closes.length - 1];
    
    // Use a very short-term EMA to gauge immediate momentum
    const shortEmaPeriod = 5;
    const shortEma = getLast(EMA.calculate({ period: shortEmaPeriod, values: closes })) as number | undefined;
    
    if (!shortEma) return { veto: false, reason: '' };
    
    const isLongSignal = direction === 'BUY';

    // For a BUY signal, if the price is currently trading *below* the immediate trend EMA, it's a high-risk entry.
    if (isLongSignal && lastClose < shortEma) {
        return { veto: true, reason: `❌ VETO: Immediate momentum is bearish (Price < ${shortEmaPeriod}-EMA).` };
    }

    // For a SELL signal, if the price is currently trading *above* the immediate trend EMA, it's a high-risk entry.
    if (!isLongSignal && lastClose > shortEma) {
        return { veto: true, reason: `❌ VETO: Immediate momentum is bullish (Price > ${shortEmaPeriod}-EMA).` };
    }

    return { veto: false, reason: '✅ Momentum Concordance: Passed' };
}