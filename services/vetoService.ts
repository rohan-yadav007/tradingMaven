// services/vetoService.ts

import { Kline, BotConfig, MarketDataContext, StochasticRSIOutput, AgentParams, ADXOutput, BollingerBandsOutput } from '../types';
import { RSI, StochasticRSI, ADX, SMA, EMA, ATR, BollingerBands } from 'technicalindicators';
import * as constants from '../constants';
import { btcConfirmationService } from './btcConfirmationService';
import { getLast, getPenultimate, detectRsiDivergence } from './agentUtils';

/**
 * A universal gatekeeper to prevent entering trades when the trend is likely exhausted.
 * This enhanced version requires both StochRSI overextension AND RSI divergence to veto, and the condition must persist for 2 candles.
 */
export function getExhaustionFilterVeto(
    klines: Kline[],
    direction: 'BUY' | 'SELL',
    config: BotConfig,
): { veto: boolean; reason: string } {
    if (klines.length < 31) return { veto: false, reason: '' };

    const timeframeSettings = constants.EXHAUSTION_FILTER_TIMEFRAME_SETTINGS[config.timeFrame] || constants.EXHAUSTION_FILTER_TIMEFRAME_SETTINGS['15m'];
    const positionDirection = direction === 'BUY' ? 'LONG' : 'SHORT';

    const checkExhaustionForSlice = (slice: Kline[]): boolean => {
        const closes = slice.map(k => k.close);
        const rsiValues = RSI.calculate({ period: 14, values: closes });
        const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;
        
        if (!stochRsi) return false;

        const isOverextended = direction === 'BUY' ? stochRsi.k > timeframeSettings.overbought : stochRsi.k < timeframeSettings.oversold;
        if (isOverextended) {
            const hasDivergence = detectRsiDivergence(slice, rsiValues, positionDirection, 14);
            return hasDivergence;
        }
        return false;
    };
    
    // Check current candle
    const isExhaustedNow = checkExhaustionForSlice(klines);
    if (!isExhaustedNow) return { veto: false, reason: '' };
    
    // Check previous candle
    const isExhaustedPreviously = checkExhaustionForSlice(klines.slice(0, -1));

    if (isExhaustedNow && isExhaustedPreviously) {
        return { veto: true, reason: `❌ VETO: Exhaustion risk detected (StochRSI Overextended + RSI Divergence for 2 consecutive candles)` };
    }

    return { veto: false, reason: '' };
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
    const params = config.agentParams as Required<AgentParams>;
    const lookback = params.smc_divergenceLookback;
    
    // --- Tweak #3: Timeframe-Sensitive Confluence ---
    const isScalpingTf = ['1m', '3m', '5m'].includes(config.timeFrame);
    let requiresConfluence = isScalpingTf && params.smc_requireConfluenceOnScalp;
    let confluenceMet = !requiresConfluence; // Default to true if not required

    if (requiresConfluence) {
        const bb = getLast(BollingerBands.calculate({ period: 20, stdDev: 2, values: klines.map(k => k.close) })) as BollingerBandsOutput | undefined;
        if (bb) {
            const bbWidth = (bb.upper - bb.lower) / bb.middle;
            if (bbWidth < params.smc_confluence_bbwSqueezeThreshold) {
                confluenceMet = true;
            }
        }
    }
    // --- End Tweak #3 ---

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
                    
                    if (hasHighVolume && confluenceMet) {
                        const reason = requiresConfluence ? `SMC Reversal: Bearish divergence + liquidity sweep + BBW Squeeze.` : `SMC Reversal: Bearish divergence + liquidity sweep.`;
                        return { detected: true, reason };
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

                    if (hasHighVolume && confluenceMet) {
                        const reason = requiresConfluence ? `SMC Reversal: Bullish divergence + liquidity sweep + BBW Squeeze.` : `SMC Reversal: Bullish divergence + liquidity sweep.`;
                        return { detected: true, reason };
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

/**
 * NEW: Context-Aware Entry Classifier.
 * This system first classifies the entry type ('breakout' or 'pullback') based on the live price's position within the
 * main timeframe candle. It then applies a specialized scoring model tailored to that specific entry type.
 */
export function getHardConcordanceVetos(
    mainTimeframeKlines: Kline[],
    livePrice: number,
    signalDirection: 'BUY' | 'SELL',
    config: BotConfig,
    microKlines: Kline[] | undefined, // 1-minute klines
): { veto: boolean; reason: string } {
    const params = config.agentParams as Required<AgentParams>;

    if (!microKlines || microKlines.length < 20) {
        const reason = `Entry Dynamics: Insufficient 1m data.`;
        if (config.finalEntryFailSafe === 'fail-closed') {
            return { veto: true, reason: `❌ VETO: ${reason} (Fail-safe triggered)` };
        }
        return { veto: false, reason: `⚠️ ${reason} Trade allowed by fail-open.` };
    }

    const isLongSignal = signalDirection === 'BUY';
    const lastMainCandle = mainTimeframeKlines[mainTimeframeKlines.length - 1];
    
    const candleRange = lastMainCandle.high - lastMainCandle.low;
    const pricePositionRatio = candleRange > 0 ? (livePrice - lastMainCandle.low) / candleRange : 0.5;
    
    let entryType: 'breakout' | 'pullback';
    if ((isLongSignal && pricePositionRatio > 0.7) || (!isLongSignal && pricePositionRatio < 0.3)) {
        entryType = 'breakout';
    } else {
        entryType = 'pullback';
    }

    let totalScore = 0;
    let scoreDetails = '';

    const microCloses = microKlines.map(k => k.close);
    const microVolumes = microKlines.map(k => k.volume || 0);

    if (entryType === 'breakout') {
        // --- BREAKOUT SCORING MODEL ---
        // 1. Momentum Flow (40 pts): 1m EMAs must be aligned and supportive.
        const microEmaFast = getLast(EMA.calculate({ period: params.veto_microEmaFast, values: microCloses })) as number | undefined;
        const microEmaSlow = getLast(EMA.calculate({ period: params.veto_microEmaSlow, values: microCloses })) as number | undefined;
        let momentumScore = 0;
        if (microEmaFast && microEmaSlow) {
            if (isLongSignal && livePrice > microEmaFast && microEmaFast > microEmaSlow) momentumScore = 40;
            if (!isLongSignal && livePrice < microEmaFast && microEmaFast < microEmaSlow) momentumScore = 40;
        }
        totalScore += momentumScore;
        scoreDetails += `Momentum:${momentumScore}/40 `;

        // 2. Volume Thrust (40 pts): Volume must be increasing and above average.
        const volumeSma = getLast(SMA.calculate({ period: 20, values: microVolumes })) as number | undefined;
        const lastVol = getLast(microVolumes);
        const prevVol = getPenultimate(microVolumes);
        let volumeScore = 0;
        if (lastVol && prevVol && volumeSma) {
            if (lastVol > prevVol && lastVol > volumeSma * 1.2) volumeScore = 40;
            else if (lastVol > volumeSma) volumeScore = 20;
        }
        totalScore += volumeScore;
        scoreDetails += `Volume:${volumeScore}/40 `;
        
        // 3. Positioning (20 pts): Penalize entering at the absolute wick extreme.
        let positionScore = 0;
        if (isLongSignal) positionScore = (1 - Math.max(0, (pricePositionRatio - 0.7) / 0.3)) * 20;
        else positionScore = (1 - Math.max(0, (0.3 - pricePositionRatio) / 0.3)) * 20;
        totalScore += positionScore;
        scoreDetails += `Position:${positionScore.toFixed(0)}/20`;

    } else { // entryType === 'pullback'
        // --- PULLBACK SCORING MODEL ---
        // 1. Favorable Positioning (50 pts): Price must have pulled back significantly.
        let positionScore = 0;
        if (isLongSignal) positionScore = Math.max(0, (0.7 - pricePositionRatio) / 0.7) * 50;
        else positionScore = Math.max(0, (pricePositionRatio - 0.3) / 0.7) * 50;
        totalScore += positionScore;
        scoreDetails += `Position:${positionScore.toFixed(0)}/50 `;

        // 2. Micro-Exhaustion Hook (30 pts): 1m StochRSI must show a reversal hook from an extreme.
        const stochRsi = getLast(StochasticRSI.calculate({ values: microCloses, rsiPeriod: params.veto_pullback_stochRsiPeriod, stochasticPeriod: params.veto_pullback_stochRsiPeriod, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;
        let exhaustionScore = 0;
        if (stochRsi) {
            if (isLongSignal && stochRsi.k < params.veto_pullback_stochRsiOversold && stochRsi.k > stochRsi.d) exhaustionScore = 30;
            if (!isLongSignal && stochRsi.k > params.veto_pullback_stochRsiOverbought && stochRsi.k < stochRsi.d) exhaustionScore = 30;
        }
        totalScore += exhaustionScore;
        scoreDetails += `Exhaustion:${exhaustionScore}/30 `;

        // 3. Volume Confirmation (20 pts): Volume on the turn should not be hostile.
        const lastMicroCandle = microKlines[microKlines.length - 1];
        const lastVol = lastMicroCandle.volume || 0;
        const volumeSma = getLast(SMA.calculate({ period: 20, values: microVolumes })) as number | undefined;
        let volumeScore = 0;
        if (volumeSma) {
             if (isLongSignal && lastMicroCandle.close > lastMicroCandle.open && lastVol > volumeSma * 0.8) volumeScore = 20;
             else if (!isLongSignal && lastMicroCandle.close < lastMicroCandle.open && lastVol > volumeSma * 0.8) volumeScore = 20;
        }
        totalScore += volumeScore;
        scoreDetails += `Volume:${volumeScore.toFixed(0)}/20`;
    }

    const threshold = params.veto_entryScoreThreshold;
    if (totalScore >= threshold) {
        return { veto: false, reason: `✅ Entry Dynamics (${entryType}): Score ${totalScore.toFixed(0)}/${threshold}` };
    } else {
        return { 
            veto: true, 
            reason: `❌ VETO: Entry Dynamics (${entryType}) Score ${totalScore.toFixed(0)} < ${threshold}. (${scoreDetails.trim()})`
        };
    }
}


export function getBtcTrendScore(btcKlines: Kline[]): { bullScore: number; bearScore: number } {
    return btcConfirmationService.getBtcTrendScore(btcKlines);
}

/**
 * Tweak #5: New Veto based on ETH/BTC capital flow.
 */
export function getBtcCorrelationVeto(
    ethBtcKlines: Kline[],
    signalDirection: 'BUY' | 'SELL',
    pair: string,
    config: BotConfig,
): { veto: boolean; reason: string } {
    const params = config.agentParams as Required<AgentParams>;
    
    // This veto only applies to altcoin LONGs
    if (signalDirection !== 'BUY' || pair.startsWith('BTC/') || pair.startsWith('ETH/')) {
        return { veto: false, reason: '' };
    }

    if (ethBtcKlines.length < params.btc_correlation_veto_ema_slow) {
        return { veto: false, reason: 'ℹ️ Correlation: Insufficient ETH/BTC data.' };
    }

    const closes = ethBtcKlines.map(k => k.close);
    const emaFast = getLast(EMA.calculate({ period: params.btc_correlation_veto_ema_fast, values: closes }));
    const emaSlow = getLast(EMA.calculate({ period: params.btc_correlation_veto_ema_slow, values: closes }));

    if (!emaFast || !emaSlow) {
        return { veto: false, reason: 'ℹ️ Correlation: Could not calculate EMAs.' };
    }

    // If fast EMA is below slow EMA, it indicates a downtrend in ETH vs BTC (capital flowing to BTC)
    if (emaFast < emaSlow) {
        return { veto: true, reason: '❌ VETO: Capital flow favors BTC over ALTS (ETH/BTC is bearish).' };
    }

    return { veto: false, reason: '✅ Correlation: Capital flow is neutral or favors ALTS.' };
}
