// services/vetoService.ts

import { Kline, BotConfig, MarketDataContext, StochasticRSIOutput, AgentParams, ADXOutput, BollingerBandsOutput } from '../types';
import { RSI, StochasticRSI, ADX, SMA, EMA, ATR, BollingerBands } from 'technicalindicators';
import * as constants from '../constants';
import { btcConfirmationService } from './btcConfirmationService';
import { getLast, getPenultimate, detectRsiDivergence } from './agents/agentUtils';

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
 * Performs a 'just-in-time' analysis before entry using micro-timeframe data to apply non-negotiable "hard" vetos.
 * This checks for extreme volatility and clear liquidity sweep patterns that pose an immediate high risk.
 */
export function getHardConcordanceVetos(
    mainTimeframeKlines: Kline[],
    livePrice: number,
    signalDirection: 'BUY' | 'SELL',
    config: BotConfig,
    microKlines: Kline[] | undefined,
    microTimeframe: string,
): { veto: boolean; reason: string } {
    const params = config.agentParams as Required<AgentParams>;

    if (!microKlines || microKlines.length < 50) {
        const reason = `Concordance: Insufficient ${microTimeframe} data.`;
        if (config.finalEntryFailSafe === 'fail-closed') {
            return { veto: true, reason: `❌ VETO: ${reason} (Fail-safe triggered)` };
        }
        return { veto: false, reason: `⚠️ ${reason} Trade allowed by fail-open.` };
    }

    const isLongSignal = signalDirection === 'BUY';
    const mainTfAdx = getLast(ADX.calculate({ high: mainTimeframeKlines.map(k=>k.high), low: mainTimeframeKlines.map(k=>k.low), close: mainTimeframeKlines.map(k=>k.close), period: 14 })) as ADXOutput | undefined;
    
    const ltfHighs = microKlines.map(k => k.high);
    const ltfLows = microKlines.map(k => k.low);
    const ltfCloses = microKlines.map(k => k.close);
    const ltfVolumes = microKlines.map(k => k.volume || 0);

    // --- Hard Veto 1: Directional ATR Chaos Veto with Grace Band & Normalization (Tweak #2) ---
    const mainTfAtrRaw = getLast(ATR.calculate({ high: mainTimeframeKlines.map(k=>k.high), low: mainTimeframeKlines.map(k=>k.low), close: mainTimeframeKlines.map(k=>k.close), period: 14 })) as number | undefined;
    const ltfAtrValues = ATR.calculate({ high: ltfHighs, low: ltfLows, close: ltfCloses, period: 5 });
    const ltfAtrRaw = getLast(ltfAtrValues) as number | undefined;
    
    let effectiveAtrRatio = params.veto_atrChaosRatio;
    if (mainTfAdx && mainTfAdx.adx > params.veto_atrChaos_strongTrendAdx) {
        effectiveAtrRatio *= params.veto_atrChaos_graceMultiplier;
    }

    if (mainTfAtrRaw && ltfAtrRaw) {
        const mainTfAtr = params.veto_normalizeAtrChaos ? mainTfAtrRaw / livePrice : mainTfAtrRaw;
        const ltfAtr = params.veto_normalizeAtrChaos ? ltfAtrRaw / livePrice : ltfAtrRaw;

        if (ltfAtr > (mainTfAtr * effectiveAtrRatio)) {
            const prevLtfAtrRaw = getPenultimate(ltfAtrValues) as number | undefined;
            if (prevLtfAtrRaw) {
                const prevLtfAtr = params.veto_normalizeAtrChaos ? prevLtfAtrRaw / livePrice : prevLtfAtrRaw;
                if (ltfAtr > prevLtfAtr) { // Volatility is expanding
                    const priceDirectionIsUp = getLast(ltfCloses)! > getPenultimate(ltfCloses)!;
                    if ((isLongSignal && !priceDirectionIsUp) || (!isLongSignal && priceDirectionIsUp)) {
                        return { veto: true, reason: `❌ VETO: LTF volatility expanding against signal direction.` };
                    }
                }
            }
            // If volatility is high but not expanding, or if we can't check expansion, treat as chaotic
            return { veto: true, reason: `❌ VETO: LTF volatility chaotic (ATR Ratio > ${effectiveAtrRatio.toFixed(1)}x).` };
        }
    }

    // --- Hard Veto 2: ADX-Gated Liquidity Sweep Detection ---
    if (mainTfAdx && mainTfAdx.adx < params.veto_liquiditySweep_maxAdx) {
        const lastLtfCandle = microKlines[microKlines.length - 1];
        const prevLtfCandle = microKlines[microKlines.length - 2];
        if (prevLtfCandle) {
            const volumeSma = getLast(SMA.calculate({ period: 20, values: ltfVolumes }));
            const lastVolume = lastLtfCandle.volume || 0;
            const hasHighVolume = volumeSma && lastVolume > volumeSma;
            const bodySize = Math.abs(lastLtfCandle.close - lastLtfCandle.open);

            if (signalDirection === 'BUY' && lastLtfCandle.high > prevLtfCandle.high && lastLtfCandle.close < prevLtfCandle.high) {
                const upperWick = lastLtfCandle.high - Math.max(lastLtfCandle.open, lastLtfCandle.close);
                if(bodySize > 0 && upperWick >= 0.4 * bodySize && hasHighVolume){ 
                    return { veto: true, reason: '❌ VETO: High volume bearish liquidity sweep.' }; 
                }
            }
            if (signalDirection === 'SELL' && lastLtfCandle.low < prevLtfCandle.low && lastLtfCandle.close > prevLtfCandle.low) {
                const lowerWick = Math.min(lastLtfCandle.open, lastLtfCandle.close) - lastLtfCandle.low;
                if(bodySize > 0 && lowerWick >= 0.4 * bodySize && hasHighVolume){ 
                    return { veto: true, reason: '❌ VETO: High volume bullish liquidity sweep.' };
                }
            }
        }
    }
    
    return { veto: false, reason: '✅ Hard Concordance: Passed' };
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