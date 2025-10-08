// services/vetoService.ts

import { Kline, BotConfig, AgentParams, BollingerBandsOutput } from '../types';
import { RSI, BollingerBands } from 'technicalindicators';
import { getLast } from './agents/agentUtils';
import { findSwingPoints } from './chartAnalysisService';

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
