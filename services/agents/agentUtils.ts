
// services/agents/agentUtils.ts

import { Kline, BotConfig, AgentParams, MarketDataContext, ADXOutput, StochasticRSIOutput, BollingerBandsOutput, MACDOutput, IchimokuCloudOutput, VortexIndicatorOutput, BitcoinState, ChartPattern, MarketStructureAnalysis, OpenInterestKline } from '../../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV, IchimokuCloud, bearishengulfingpattern, bullishengulfingpattern, darkcloudcover, dragonflydoji, gravestonedoji, hammerpattern, hangingman, morningstar, piercingline, shootingstar, eveningstar } from 'technicalindicators';
import * as constants from '../../constants';
import { findSwingPoints, analyzeMarketStructure } from '../chartAnalysisService';
import { PatternRecognitionService } from '../patternRecognitionService';

// --- Custom Indicator Implementations ---

export class Supertrend {
    static calculate(options: { high: number[]; low: number[]; close: number[]; period: number; multiplier: number; }): (number | undefined)[] {
        const { high, low, close, period, multiplier } = options;
        const atrValues = ATR.calculate({ high, low, close, period });

        const result: (number | undefined)[] = new Array(close.length).fill(undefined);
        if (atrValues.length === 0) return result;

        let trend = 1; // 1 for uptrend, -1 for downtrend
        let lastFinalUpperBand = 0;
        let lastFinalLowerBand = 0;

        for (let i = period; i < high.length; i++) {
            const currentAtr = atrValues[i - period];
            if (currentAtr === undefined) continue;

            const basicUpperBand = (high[i] + low[i]) / 2 + multiplier * currentAtr;
            const basicLowerBand = (high[i] + low[i]) / 2 - multiplier * currentAtr;
            
            if (i === period) {
                lastFinalUpperBand = basicUpperBand;
                lastFinalLowerBand = basicLowerBand;
            } else {
                lastFinalUpperBand = basicUpperBand < lastFinalUpperBand || close[i - 1] > lastFinalUpperBand ? basicUpperBand : lastFinalUpperBand;
                lastFinalLowerBand = basicLowerBand > lastFinalLowerBand || close[i - 1] < lastFinalLowerBand ? basicLowerBand : lastFinalLowerBand;
            }
            
            if (trend === 1 && close[i] < lastFinalLowerBand) {
                trend = -1;
            } else if (trend === -1 && close[i] > lastFinalUpperBand) {
                trend = 1;
            }

            result[i] = trend === 1 ? lastFinalLowerBand : lastFinalUpperBand;
        }
        return result;
    }
}

export class VortexIndicator {
    static calculate(options: { high: number[]; low: number[]; close: number[]; period: number; }): VortexIndicatorOutput {
        const { high, low, close, period } = options;
        const length = high.length;
        if (length <= period) {
            return { pdi: [], ndi: [] };
        }

        const pdi: number[] = new Array(length).fill(NaN);
        const ndi: number[] = new Array(length).fill(NaN);

        const trArr = new Array(length).fill(NaN);
        const plusVmArr = new Array(length).fill(NaN);
        const minusVmArr = new Array(length).fill(NaN);

        for (let i = 1; i < length; i++) {
            trArr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
            plusVmArr[i] = Math.abs(high[i] - low[i - 1]);
            minusVmArr[i] = Math.abs(low[i] - high[i - 1]);
        }
        
        let sumTr = 0;
        let sumPlusVm = 0;
        let sumMinusVm = 0;
        for (let i = 1; i <= period; i++) {
            sumTr += trArr[i];
            sumPlusVm += plusVmArr[i];
            sumMinusVm += minusVmArr[i];
        }

        if (sumTr > 0) {
            pdi[period] = sumPlusVm / sumTr;
            ndi[period] = sumMinusVm / sumTr;
        } else {
            pdi[period] = 0;
            ndi[period] = 0;
        }

        for (let i = period + 1; i < length; i++) {
            sumTr = sumTr - trArr[i - period] + trArr[i];
            sumPlusVm = sumPlusVm - plusVmArr[i - period] + plusVmArr[i];
            sumMinusVm = sumMinusVm - minusVmArr[i - period] + minusVmArr[i];
            
            if (sumTr > 0) {
                pdi[i] = sumPlusVm / sumTr;
                ndi[i] = sumMinusVm / sumTr;
            } else {
                pdi[i] = 0;
                ndi[i] = 0;
            }
        }
        
        return { pdi, ndi };
    }
}


// --- General Utility Functions ---

export const getLast = <T>(arr: T[] | undefined): T | undefined => arr && arr.length > 0 ? arr[arr.length - 1] : undefined;
export const getPenultimate = <T>(arr: T[] | undefined): T | undefined => arr && arr.length > 1 ? arr[arr.length - 2] : undefined;

export const isObvTrending = (obvValues: number[], direction: 'bullish' | 'bearish', period: number = 20): boolean => {
    if (obvValues.length < period) return false;
    const obvSma = SMA.calculate({ period, values: obvValues });
    const lastObv = getLast(obvValues) as number | undefined;
    const lastSma = getLast(obvSma) as number | undefined;
    if (lastObv === undefined || lastSma === undefined) return false;
    return direction === 'bullish' ? lastObv > lastSma : lastObv < lastSma;
};

export function calculateDailyVwap(klines: Kline[]): (number | undefined)[] {
    if (klines.length === 0) return [];

    const vwapValues: (number | undefined)[] = new Array(klines.length).fill(undefined);
    let cumulativeTpVol = 0;
    let cumulativeVol = 0;
    let lastDay = -1;

    for (let i = 0; i < klines.length; i++) {
        const kline = klines[i];
        const klineDate = new Date(kline.time);
        const currentDay = klineDate.getUTCDate();

        // Reset on a new day (UTC)
        if (lastDay !== -1 && currentDay !== lastDay) {
            cumulativeTpVol = 0;
            cumulativeVol = 0;
        }
        lastDay = currentDay;

        const typicalPrice = (kline.high + kline.low + kline.close) / 3;
        const volume = kline.volume || 0;
        
        cumulativeTpVol += typicalPrice * volume;
        cumulativeVol += volume;

        if (cumulativeVol > 0) {
            vwapValues[i] = cumulativeTpVol / cumulativeVol;
        }
    }
    return vwapValues;
}

export function findLiquidityPools(klines: Kline[]): { bsl: number[], ssl: number[] } {
    const swings = findSwingPoints(klines.slice(-200), 10);
    return {
        bsl: swings.filter(s => s.type === 'high').map(s => s.price).sort((a,b) => a-b),
        ssl: swings.filter(s => s.type === 'low').map(s => s.price).sort((a,b) => b-a)
    };
}

export interface FVG {
    top: number;
    bottom: number;
    type: 'FVG Bullish' | 'FVG Bearish';
    index: number;
    filled: boolean;
}

export function detectFairValueGaps(klines: Kline[], lookback: number = 50): FVG[] {
    const fvgs: FVG[] = [];
    if (klines.length < 3) return fvgs;

    for (let i = klines.length - 2; i > Math.max(0, klines.length - lookback); i--) {
        const k1 = klines[i - 1];
        const k3 = klines[i + 1];

        if (k3.low > k1.high) {
            // Bullish FVG: check if any subsequent candle wicked down into the gap
            let filled = false;
            for (let j = i + 2; j < klines.length; j++) {
                if (klines[j].low <= k1.high) { filled = true; break; }
            }
            if (!filled) fvgs.push({ top: k3.low, bottom: k1.high, type: 'FVG Bullish', index: i, filled: false });
        } else if (k3.high < k1.low) {
            // Bearish FVG: check if any subsequent candle wicked up into the gap
            let filled = false;
            for (let j = i + 2; j < klines.length; j++) {
                if (klines[j].high >= k1.low) { filled = true; break; }
            }
            if (!filled) fvgs.push({ top: k1.low, bottom: k3.high, type: 'FVG Bearish', index: i, filled: false });
        }
    }
    return fvgs;
}

export interface OrderBlock {
    top: number;
    bottom: number;
    type: 'Bullish' | 'Bearish';
    index: number;
    tested: boolean;
    score: number; // Phase 5: Dynamic Quality Score (0-100)
}

/**
 * Identifies high-probability Order Blocks (OB) with Smart Mitigation Logic and Dynamic Scoring.
 * Phase 4 Upgrade: Blocks are only invalidated if price CLOSES inside or deeply penetrates > 50%.
 * Phase 5 Upgrade: Added dynamic scoring based on Displacement, FVG, and Freshness.
 */
export function detectOrderBlocks(klines: Kline[], lookback: number = 50): OrderBlock[] {
    const obs: OrderBlock[] = [];
    const atr = getLast(ATR.calculate({
        high: klines.map(k=>k.high), 
        low: klines.map(k=>k.low), 
        close: klines.map(k=>k.close), 
        period: 14
    })) || 0;

    // Need at least 3 candles ahead to check for FVG
    for (let i = klines.length - 4; i > Math.max(0, klines.length - lookback); i--) {
        const current = klines[i];
        const next = klines[i+1];
        const next2 = klines[i+2];

        // Bullish OB Detection
        if (current.close < current.open) {
            if (next.close > current.high && (next.close - current.high) > atr * 0.5) {
                // Check for FVG
                const hasFVG = next2.low > current.high;
                
                // Smart Mitigation Check: OB is invalidated only when price closes BELOW the entire zone (below OB low).
                // "Touched" (price wicked into OB) is tracked separately but does NOT invalidate the block.
                let isMitigated = false;
                for (let j = i + 3; j < klines.length; j++) {
                    const candle = klines[j];
                    if (candle.close < current.low) {
                        isMitigated = true;
                        break;
                    }
                }

                if (!isMitigated) {
                    // Phase 5 Scoring
                    const moveSize = Math.abs(next.close - current.high);
                    const dispScore = Math.min((moveSize / atr) * 20, 40); // Max 40 for >2 ATR move
                    const fvgScore = hasFVG ? 30 : 0;

                    const age = klines.length - 1 - i;
                    const freshScore = Math.max(0, 30 - (age * 0.5)); // Decay over time

                    const totalScore = Math.round(dispScore + fvgScore + freshScore);

                    obs.push({
                        top: current.high,
                        bottom: current.low,
                        type: 'Bullish',
                        index: i,
                        tested: isMitigated,
                        score: totalScore
                    });
                }
            }
        }

        // Bearish OB Detection
        if (current.close > current.open) {
            if (next.close < current.low && (current.low - next.close) > atr * 0.5) {
                const hasFVG = next2.high < current.low;

                // Smart Mitigation Check: OB is invalidated only when price closes ABOVE the entire zone (above OB high).
                let isMitigated = false;
                for (let j = i + 3; j < klines.length; j++) {
                    const candle = klines[j];
                    if (candle.close > current.high) {
                        isMitigated = true;
                        break;
                    }
                }

                if (!isMitigated) {
                    // Phase 5 Scoring
                    const moveSize = Math.abs(current.low - next.close);
                    const dispScore = Math.min((moveSize / atr) * 20, 40);
                    const fvgScore = hasFVG ? 30 : 0;
                    
                    const age = klines.length - 1 - i;
                    const freshScore = Math.max(0, 30 - (age * 0.5));

                    const totalScore = Math.round(dispScore + fvgScore + freshScore);

                    obs.push({
                        top: current.high,
                        bottom: current.low,
                        type: 'Bearish',
                        index: i,
                        tested: isMitigated,
                        score: totalScore
                    });
                }
            }
        }
    }
    return obs;
}

export function detectImpulseCandle(kline: Kline, atr: number): 'Bullish' | 'Bearish' | 'None' {
    const body = Math.abs(kline.close - kline.open);
    const isBig = body > atr * 1.2;
    
    if (isBig) {
        const range = kline.high - kline.low;
        const upperWick = kline.high - Math.max(kline.close, kline.open);
        const lowerWick = Math.min(kline.close, kline.open) - kline.low;
        
        if (kline.close > kline.open && upperWick < range * 0.3) return 'Bullish';
        if (kline.close < kline.open && lowerWick < range * 0.3) return 'Bearish';
    }
    return 'None';
}

export function findNearestStructuralLevel(
    klines: Kline[], 
    entryPrice: number, 
    direction: 'LONG' | 'SHORT', 
    lookback: number = 200 // Extended lookback for HTF targets
): number | null {
    const swings = findSwingPoints(klines.slice(-lookback), 5);
    
    if (direction === 'LONG') {
        // Target: Nearest higher High
        const resistances = swings
            .filter(s => s.type === 'high' && s.price > entryPrice)
            .sort((a, b) => a.price - b.price); // Ascending price
        
        return resistances.length > 0 ? resistances[0].price : null;
    } else {
        // Target: Nearest lower Low
        const supports = swings
            .filter(s => s.type === 'low' && s.price < entryPrice)
            .sort((a, b) => b.price - a.price); // Descending price
        
        return supports.length > 0 ? supports[0].price : null;
    }
}

export function calculateTrueRange(current: Kline, prev: Kline): number {
    const hl = current.high - current.low;
    const hcp = Math.abs(current.high - prev.close);
    const lcp = Math.abs(current.low - prev.close);
    return Math.max(hl, hcp, lcp);
}

export function calculateAtrTrend(klines: Kline[], period: number = 14): 'expanding' | 'contracting' | 'stable' {
    if (klines.length < period + 5) return 'stable';
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const closes = klines.map(k => k.close);
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period });
    
    const last = getLast(atrValues) as number | undefined;
    const prev = atrValues[atrValues.length - 4] as number | undefined;
    if (last === undefined || prev === undefined) return 'stable';

    const diff = (last - prev) / prev;
    if (diff > 0.05) return 'expanding';
    if (diff < -0.05) return 'contracting';
    return 'stable';
}

export function calculateBandwidthSlope(klines: Kline[], period: number = 20): number {
    if (klines.length < period + 2) return 0;
    const closes = klines.map(k => k.close);
    const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    const last = bb[bb.length - 1];
    const prev = bb[bb.length - 2];
    if (!last || !prev) return 0;
    
    const lastBW = (last.upper - last.lower) / last.middle;
    const prevBW = (prev.upper - prev.lower) / prev.middle;
    return (lastBW - prevBW) / prevBW;
}

export function calculateRVOL(klines: Kline[], period: number = 20): number {
    if (klines.length < period + 1) return 1.0;
    
    const volumes = klines.map(k => k.volume || 0);
    const lastVol = getLast(volumes) || 0;
    
    const previousVolumes = volumes.slice(0, -1).slice(-period);
    const sum = previousVolumes.reduce((a, b) => a + b, 0);
    const avg = sum / previousVolumes.length || 1;
    
    return lastVol / avg;
}

export function calculateRsiVelocity(rsiValues: number[]): number {
    if (rsiValues.length < 5) return 0;
    const last = rsiValues[rsiValues.length - 1];
    const avgPrev = (rsiValues[rsiValues.length - 2] + rsiValues[rsiValues.length - 3] + rsiValues[rsiValues.length - 4]) / 3;
    return last - avgPrev;
}

export function getCandleExhaustion(kline: Kline): { bullish: boolean, bearish: boolean, intensity: number } {
    const body = Math.abs(kline.close - kline.open);
    const range = kline.high - kline.low;
    if (range === 0) return { bullish: false, bearish: false, intensity: 0 };
    
    const upperWick = kline.high - Math.max(kline.close, kline.open);
    const lowerWick = Math.min(kline.close, kline.open) - kline.low;
    
    const intensity = Math.max(upperWick, lowerWick) / range;
    
    return {
        bullish: lowerWick > body * 1.5 && lowerWick > upperWick, 
        bearish: upperWick > body * 1.5 && upperWick > lowerWick, 
        intensity
    };
}

export function applyTimeframeSettings(config: BotConfig): BotConfig {
    const { agent, timeFrame, agentParams } = config;
    let finalParams: Required<AgentParams> = { ...constants.DEFAULT_AGENT_PARAMS };
    const timeframeSettings: Partial<AgentParams> = constants.getAgentTimeframeSettings(agent.id, timeFrame);
    finalParams = { ...finalParams, ...timeframeSettings };
    finalParams = { ...finalParams, ...agentParams };
    return { ...config, agentParams: finalParams };
}

export function calculateFibLevels(high: number, low: number): { [key: string]: number } {
    const diff = high - low;
    return {
        0: high,
        0.236: high - 0.236 * diff,
        0.382: high - 0.382 * diff,
        0.5: high - 0.5 * diff,
        0.618: high - 0.618 * diff,
        0.786: high - 0.786 * diff,
        1: low
    };
}

export function calculateValueArea(klines: Kline[]): { val: number, vah: number, poc: number } {
    if (klines.length === 0) return { val: 0, vah: 0, poc: 0 };
    
    const min = Math.min(...klines.map(k => k.low));
    const max = Math.max(...klines.map(k => k.high));
    const range = max - min;
    const step = range / 50; 

    const buckets = new Map<number, number>();
    let totalVolume = 0;

    for (const k of klines) {
        const bucketIdx = Math.floor((k.close - min) / step);
        const price = min + bucketIdx * step;
        const currentVol = buckets.get(price) || 0;
        buckets.set(price, currentVol + (k.volume || 0));
        totalVolume += (k.volume || 0);
    }

    const sortedBuckets = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
    let pocPrice = 0, maxVol = 0;
    for (const [price, vol] of sortedBuckets) {
        if (vol > maxVol) { maxVol = vol; pocPrice = price; }
    }

    const vaThreshold = totalVolume * 0.7;
    let currentVaVol = maxVol;
    let lowIdx = sortedBuckets.findIndex(b => b[0] === pocPrice);
    let highIdx = lowIdx;

    while (currentVaVol < vaThreshold && (lowIdx > 0 || highIdx < sortedBuckets.length - 1)) {
        const lowVol = lowIdx > 0 ? sortedBuckets[lowIdx - 1][1] : 0;
        const highVol = highIdx < sortedBuckets.length - 1 ? sortedBuckets[highIdx + 1][1] : 0;

        if (lowVol >= highVol && lowIdx > 0) {
            lowIdx--;
            currentVaVol += lowVol;
        } else if (highIdx < sortedBuckets.length - 1) {
            highIdx++;
            currentVaVol += highVol;
        } else {
            break;
        }
    }

    return {
        poc: pocPrice,
        val: sortedBuckets[lowIdx][0],
        vah: sortedBuckets[highIdx][0]
    };
}

export function calculatePivotPoints(high: number, low: number, close: number) {
    const pivot = (high + low + close) / 3;
    const r1 = 2 * pivot - low;
    const s1 = 2 * pivot - high;
    const r2 = pivot + (high - low);
    const s2 = pivot - (high - low);
    const r3 = high + 2 * (pivot - low);
    const s3 = low - 2 * (high - pivot);
    return { pivot, r1, s1, r2, s2, r3, s3 };
}

export function isLastCandleContradictory(
    klines: Kline[],
    signalDirection: 'BUY' | 'SELL'
): { veto: boolean; reason: string } {
    if (klines.length < 3) return { veto: false, reason: '' };
    const input = { open: klines.map(k => k.open), high: klines.map(k => k.high), low: klines.map(k => k.low), close: klines.map(k => k.close) };
    if (signalDirection === 'SELL') {
        const patterns: Record<string, (input: any) => boolean[]> = { 
            'Bullish Engulfing': bullishengulfingpattern, 
            'Hammer Pattern': hammerpattern, 
            'Dragonfly Doji': dragonflydoji, 
            'Piercing Line': piercingline, 
            'Morning Star': morningstar 
        };
        for (const [name, func] of Object.entries(patterns)) { if (getLast(func(input))) return { veto: true, reason: `❌ VETO: Strong bullish reversal pattern (${name}) detected.` }; }
    }
    if (signalDirection === 'BUY') {
        const patterns: Record<string, (input: any) => boolean[]> = { 
            'Bearish Engulfing': bearishengulfingpattern, 
            'Hanging Man': hangingman, 
            'Gravestone Doji': gravestonedoji, 
            'Shooting Star': shootingstar, 
            'Dark Cloud Cover': darkcloudcover, 
            'Evening Star': eveningstar 
        };
        for (const [name, func] of Object.entries(patterns)) { if (getLast(func(input))) return { veto: true, reason: `❌ VETO: Strong bearish reversal pattern (${name}) detected.` }; }
    }
    return { veto: false, reason: '' };
}

export function recognizeCandlestickPattern(kline: Kline, prevKline?: Kline): { name: string, type: 'bullish' | 'bearish' } | null {
    if (!kline) return null;
    const { open, high, low, close } = kline;
    const bodySize = Math.abs(close - open);
    const upperWick = high - Math.max(open, close);
    const lowerWick = Math.min(open, close) - low;
    const totalRange = high - low;
    if (totalRange === 0) return null;
    if (bodySize / totalRange < 0.33) {
        if (lowerWick > bodySize * 2 && upperWick < bodySize) return { name: 'Hammer', type: 'bullish' };
        if (upperWick > bodySize * 2 && lowerWick < bodySize) return { name: 'Shooting Star', type: 'bearish' };
    }
    if (prevKline) {
        if (bodySize > Math.abs(prevKline.close - prevKline.open)) {
            if (close > open && prevKline.close < prevKline.open && close > prevKline.open && open < prevKline.close) return { name: 'Bullish Engulfing', type: 'bullish' };
            if (close < open && prevKline.close > prevKline.open && open > prevKline.close && close < prevKline.open) return { name: 'Bearish Engulfing', type: 'bearish' };
        }
    }
    return null;
}

export function calculateHeikinAshi(klines: Kline[]): Kline[] {
    if (klines.length === 0) return [];
    const haKlines: Kline[] = [];
    haKlines.push({ ...klines[0], open: (klines[0].open + klines[0].close) / 2, close: (klines[0].open + klines[0].high + klines[0].low + klines[0].close) / 4 });
    for (let i = 1; i < klines.length; i++) {
        const k = klines[i], prevHa = haKlines[i-1];
        const haClose = (k.open + k.high + k.low + k.close) / 4, haOpen = (prevHa.open + prevHa.close) / 2;
        haKlines.push({ ...k, open: haOpen, high: Math.max(k.high, haOpen, haClose), low: Math.min(k.low, haOpen, haClose), close: haClose });
    }
    return haKlines;
}

export function isMarketCohesive(
    heikinAshiKlines: Kline[],
    direction: 'BUY' | 'SELL',
    timeframe: string,
    candleLookback: number
): { cohesive: boolean; reason: string } {
    if (heikinAshiKlines.length < candleLookback) return { cohesive: true, reason: 'Insufficient HA klines for cohesion check.' };
    const relevantKlines = heikinAshiKlines.slice(-candleLookback);
    const isKlineCohesive = (ha: Kline, dir: 'BUY' | 'SELL'): boolean => {
        const bodySize = Math.abs(ha.close - ha.open);
        if (bodySize === 0) return false;
        if (dir === 'BUY') return ha.close > ha.open && (ha.open - ha.low) <= bodySize * 0.10;
        else return ha.close < ha.open && (ha.high - ha.open) <= bodySize * 0.10;
    };
    if (relevantKlines.every(k => isKlineCohesive(k, direction))) return { cohesive: true, reason: `✅ HA Cohesion: Passed` };
    return { cohesive: false, reason: `❌ VETO: Market lacks cohesion.` };
}

export function detectRsiDivergence(klines: Kline[], rsiValues: number[], positionDirection: 'LONG' | 'SHORT', lookback: number): boolean {
    const rsiPeriod = 14;
    if (klines.length < (lookback * 2) + 2 || klines.length < rsiPeriod) return false;
    const rsiStartIndex = klines.length - rsiValues.length;
    if (rsiStartIndex < 0) return false;
    const pivots: { index: number; price: number, type: 'high' | 'low' }[] = [];
    for (let i = Math.max(lookback, rsiStartIndex); i < klines.length - lookback; i++) {
        const w = klines.slice(i - lookback, i + 1 + lookback);
        if (klines[i].high === Math.max(...w.map(k => k.high))) pivots.push({ index: i, price: klines[i].high, type: 'high'});
        if (klines[i].low === Math.min(...w.map(k => k.low))) pivots.push({ index: i, price: klines[i].low, type: 'low'});
    }
    const getRsi = (idx: number) => rsiValues[idx - rsiStartIndex];
    if (positionDirection === 'LONG') {
        const lows = pivots.filter(p => p.type === 'low').slice(-2);
        if (lows.length === 2) {
            const [prev, last] = lows;
            const [prevRsi, lastRsi] = [getRsi(prev.index), getRsi(last.index)];
            if(prevRsi !== undefined && lastRsi !== undefined && last.price < prev.price && lastRsi > prevRsi) return true;
        }
    }
    if (positionDirection === 'SHORT') {
        const highs = pivots.filter(p => p.type === 'high').slice(-2);
        if (highs.length === 2) {
            const [prev, last] = highs;
            const [prevRsi, lastRsi] = [getRsi(prev.index), getRsi(last.index)];
            if(prevRsi !== undefined && lastRsi !== undefined && last.price > prev.price && lastRsi < prevRsi) return true;
        }
    }
    return false;
}

export function analyzeMicroMarketStructure(microKlines: Kline[]): 'ascending' | 'descending' | 'ranging' | null {
    if (microKlines.length < 20) return null;
    const swingPoints = findSwingPoints(microKlines, 3);
    const recentHighs = swingPoints.filter(p => p.type === 'high').slice(-3);
    if (recentHighs.length === 3) {
        if (recentHighs[2].price < recentHighs[1].price && recentHighs[1].price < recentHighs[0].price) return 'descending';
    }
    const recentLows = swingPoints.filter(p => p.type === 'low').slice(-3);
    if (recentLows.length === 3) {
        if (recentLows[2].price > recentLows[1].price && recentLows[1].price > recentLows[0].price) return 'ascending';
    }
    return 'ranging';
}

export function captureMarketContext(klines: Kline[], htfKlines?: Kline[], params?: AgentParams, timeframe?: string): Partial<MarketDataContext> {
    const context: Partial<MarketDataContext> = {};
    const calculateIndicators = (k: Kline[]): Partial<Omit<MarketDataContext, 'htf_trend'>> => {
        if (k.length < 2) return {};
        const c = k.map(x => x.close), h = k.map(x => x.high), l = k.map(x => x.low), v = k.map(x => x.volume || 0);
        const res: Partial<MarketDataContext> = {};

        const rsiPeriod = params?.rsiPeriod || 14;
        const adxPeriod = params?.adxPeriod || 14;
        const atrPeriod = params?.atrPeriod || 14;
        const viPeriod = params?.viPeriod || 14;

        if (k.length >= Math.max(rsiPeriod, adxPeriod, atrPeriod, viPeriod)) {
            res.rsi14 = getLast(RSI.calculate({ period: rsiPeriod, values: c })) as number | undefined;
            res.adx14 = getLast(ADX.calculate({ period: adxPeriod, high: h, low: l, close: c })) as ADXOutput | undefined;
            res.atr14 = getLast(ATR.calculate({ period: atrPeriod, high: h, low: l, close: c })) as number | undefined;
            res.stochRsi = getLast(StochasticRSI.calculate({ values: c, rsiPeriod: rsiPeriod, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;
            const vi14 = VortexIndicator.calculate({ period: viPeriod, high: h, low: l, close: c });
            if(getLast(vi14.pdi) !== undefined && getLast(vi14.ndi) !== undefined) res.vi14 = { pdi: getLast(vi14.pdi)!, ndi: getLast(vi14.ndi)! };
        }
        if (k.length >= 20) {
            res.bb20_2 = getLast(BollingerBands.calculate({ period: 20, stdDev: 2, values: c })) as BollingerBandsOutput | undefined;
            res.volumeSma20 = getLast(SMA.calculate({ period: 20, values: v })) as number | undefined;
            const obv = OBV.calculate({ close: c, volume: v });
            res.obvTrend = isObvTrending(obv, 'bullish') ? 'bullish' : isObvTrending(obv, 'bearish') ? 'bearish' : 'neutral';
        }
        if (k.length >= 26) res.macd = getLast(MACD.calculate({ values: c, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false })) as MACDOutput | undefined;
        if (k.length >= 9) res.ema9 = getLast(EMA.calculate({ period: 9, values: c })) as number | undefined;
        if (k.length >= 21) res.ema21 = getLast(EMA.calculate({ period: 21, values: c })) as number | undefined;
        if (k.length >= 50) res.ema50 = getLast(EMA.calculate({ period: 50, values: c })) as number | undefined;
        if (k.length >= 100) res.ema100 = getLast(EMA.calculate({ period: 100, values: c })) as number | undefined;
        if (k.length >= 200) res.ema200 = getLast(EMA.calculate({ period: 200, values: c })) as number | undefined;
        if (k.length >= 50) res.sma50 = getLast(SMA.calculate({ period: 50, values: c })) as number | undefined;
        if (k.length >= 200) res.sma200 = getLast(SMA.calculate({ period: 200, values: c })) as number | undefined;
        res.ichiCloud = getLast(IchimokuCloud.calculate({ conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26, high: h, low: l })) as IchimokuCloudOutput | undefined;
        res.lastCandlePattern = recognizeCandlestickPattern(k[k.length - 1], k[k.length - 2]) as { name: string; type: 'bullish' | 'bearish' } | undefined;
        res.vwap = getLast(calculateDailyVwap(k)) as number | undefined;
        res.lastVolume = getLast(v) as number | undefined;
        res.lastClose = getLast(c) as number | undefined;

        // V8.0: Vortex Geometry Snapshot (Requires deeper lookbacks up to 500 candles)
        if (timeframe) {
            res.activePatterns = PatternRecognitionService.detectPatterns(k, timeframe);
        }
        
        return res;
    };
    Object.assign(context, calculateIndicators(klines));
    if (htfKlines && htfKlines.length > 0) {
        const htfCtxRaw = calculateIndicators(htfKlines);
        for (const key in htfCtxRaw) (context as any)[`htf_${key}`] = (htfCtxRaw as any)[key];
        if(htfKlines.length >= 200) {
            const htfCloses = htfKlines.map(x => x.close);
            const lastClose = getLast(htfCloses)!;
            const ema50 = getLast(EMA.calculate({ period: 50, values: htfCloses })) as number;
            const ema200 = getLast(EMA.calculate({ period: 200, values: htfCloses })) as number;
            if (lastClose > ema50 && ema50 > ema200) context.htf_trend = 'bullish';
            else if (lastClose < ema50 && ema50 < ema200) context.htf_trend = 'bearish';
            else context.htf_trend = 'neutral';
        }
    }
    return context;
}

// --- OMEGA V7.3 Architecture Additions ---

/**
 * Analyzes Higher Timeframe (4H) Structure.
 * Distinguishes between Range, Uptrend, and Downtrend using pure Price Action.
 * CRITICAL: This dictates the Hard Gate for Omega V8.0.
 */
export function analyzeHTFStructure(klines: Kline[]): { bias: 'BULLISH' | 'BEARISH' | 'RANGE', reason: string } {
    if (klines.length < 50) return { bias: 'RANGE', reason: 'Insuff. Data' };

    const swingPoints = findSwingPoints(klines, 5); // 5-candle fractal lookback
    const structure = analyzeMarketStructure(swingPoints);

    if (structure.structure === 'Uptrend') {
        return { bias: 'BULLISH', reason: '4H Structure: Higher Highs + Higher Lows' };
    }
    if (structure.structure === 'Downtrend') {
        return { bias: 'BEARISH', reason: '4H Structure: Lower Lows + Lower Highs' };
    }
    
    // Ranging or Indeterminate -> FORCE RANGE BIAS
    return { bias: 'RANGE', reason: '4H Structure: Range / Indeterminate (No Clear Trend)' };
}

export function detectLiquidityInducement(klines: Kline[], level: number, type: 'support' | 'resistance'): boolean {
    const last = klines[klines.length - 1];
    
    if (type === 'resistance') {
        // Price wicked above level but failed to close significantly above?
        // Or low volume breakout?
        const isWickFakeout = last.high > level && last.close < level;
        const isWeakBreakout = last.close > level && (last.close - level) / level < 0.001; // < 0.1% breakout
        return isWickFakeout || isWeakBreakout;
    } else {
        const isWickFakeout = last.low < level && last.close > level;
        const isWeakBreakout = last.close < level && (level - last.close) / level < 0.001;
        return isWickFakeout || isWeakBreakout;
    }
}

// Implement calculateRsiSlope
export function calculateRsiSlope(rsiValues: number[], period: number = 3): number {
    if (rsiValues.length < period + 1) return 0;
    const current = rsiValues[rsiValues.length - 1];
    const prev = rsiValues[rsiValues.length - 1 - period];
    return (current - prev) / period;
}

// Phase 4 Update: Liquidity Sweep Score based on RVOL Intensity
export function detectLiquiditySweep(klines: Kline[], lookback: number = 50): { bullish: boolean, bearish: boolean, score: number } {
    if (klines.length < lookback + 5) return { bullish: false, bearish: false, score: 0 };

    const current = klines[klines.length - 1];
    const windowKlines = klines.slice(-lookback - 1, -1);

    const lowestLow = Math.min(...windowKlines.map(k => k.low));
    const highestHigh = Math.max(...windowKlines.map(k => k.high));

    const rvol = calculateRVOL(klines, 20);
    // Require real stop-hunt volume — weak candles at 1.5x are noise, true sweeps spike 2x+
    const isSignificantVolume = rvol >= 2.0;

    const candleRange = current.high - current.low;
    // Wick quality: the reversal wick must be at least 40% of the full candle range.
    // A tiny close-back-above doesn't confirm rejection; we need a dominant wick.
    const lowerWickPct = candleRange > 0 ? (current.close - current.low) / candleRange : 0;
    const upperWickPct = candleRange > 0 ? (current.high - current.close) / candleRange : 0;

    const bullishSweep = current.low < lowestLow     // wick pierced below structural low
        && current.close > lowestLow                  // closed back inside (stop-hunt confirmed)
        && lowerWickPct >= 0.40                        // lower wick dominates (strong rejection body)
        && isSignificantVolume;                        // real volume spike confirms stop absorption

    const bearishSweep = current.high > highestHigh   // wick pierced above structural high
        && current.close < highestHigh                 // closed back inside
        && upperWickPct >= 0.40                        // upper wick dominates
        && isSignificantVolume;

    // Score (0-100): baseline at RVOL 2.0, scales to 100 at RVOL 3.5
    const score = isSignificantVolume ? Math.min(((rvol - 2.0) / 1.5) * 50 + 50, 100) : 0;

    return { bullish: bullishSweep, bearish: bearishSweep, score };
}

// Phase 4 Update: Dynamic Volatility Scaling for Pump/Crash logic
export function analyzeBitcoinState(btcKlines: Kline[]): BitcoinState {
    if (!btcKlines || btcKlines.length < 50) {
        return {
            state: 'NEUTRAL',
            trend: 'neutral',
            momentum: 'neutral',
            reason: 'Insufficient Data',
            rejection: 'none'
        };
    }

    const closes = btcKlines.map(k => k.close);
    const lastClose = closes[closes.length - 1];
    
    // Calculate ATR for dynamic threshold
    const atr = getLast(ATR.calculate({
        high: btcKlines.map(k=>k.high), low: btcKlines.map(k=>k.low), close: closes, period: 14
    })) || (lastClose * 0.01);

    const ema50 = getLast(EMA.calculate({ period: 50, values: closes })) || lastClose;
    const ema200 = getLast(EMA.calculate({ period: 200, values: closes })) || lastClose;
    
    const trend = lastClose > ema50 ? 'bullish' : 'bearish';
    
    const rsiValues = RSI.calculate({ period: 14, values: closes });
    const lastRsi = getLast(rsiValues) || 50;
    
    let momentum: 'accelerating' | 'decelerating' | 'neutral' = 'neutral';
    if (lastRsi > 60) momentum = 'accelerating';
    else if (lastRsi < 40) momentum = 'decelerating';
    
    let state: BitcoinState['state'] = 'NEUTRAL';
    
    if (lastClose > ema50 && ema50 > ema200) state = 'TREND_UP';
    else if (lastClose < ema50 && ema50 < ema200) state = 'TREND_DOWN';
    else state = 'RANGE';
    
    const lastOpen = btcKlines[btcKlines.length - 1].open;
    const change = Math.abs(lastClose - lastOpen);
    
    // Dynamic Threshold: 3x ATR is a significant move regardless of timeframe/volatility
    if (change > atr * 3) {
        state = lastClose > lastOpen ? 'PUMP' : 'CRASH';
    }

    return {
        state,
        trend,
        momentum,
        reason: `BTC ${state} (${trend})`,
        rejection: 'none'
    };
}

/**
 * Phase 4 Upgrade: Dynamic Thresholding for Open Interest.
 * Calculates score based on intensity relative to noise floor (ATR/StdDev).
 */
export function analyzeOIDynamics(
    klines: Kline[], 
    oiHistory: OpenInterestKline[] | undefined
): { state: string, intensity: number, reason: string } {
    if (!oiHistory || oiHistory.length < 20 || klines.length < 20) {
        return { state: 'Neutral', intensity: 0, reason: 'Insufficient Data' };
    }

    // 1. Calculate Price Threshold (0.5 ATR)
    const atrInput = {
        high: klines.map(k => k.high),
        low: klines.map(k => k.low),
        close: klines.map(k => k.close),
        period: 14
    };
    const atr = getLast(ATR.calculate(atrInput)) || 0;
    const currentPrice = klines[klines.length-1].close;
    const priceThreshold = (atr * 0.5) / currentPrice; // Percentage

    // 2. Calculate OI Volatility (StdDev of % changes)
    const oiChanges: number[] = [];
    for(let i=1; i<oiHistory.length; i++) {
        const prev = parseFloat(oiHistory[i-1].sumOpenInterest);
        const curr = parseFloat(oiHistory[i].sumOpenInterest);
        if (prev > 0) oiChanges.push(Math.abs((curr - prev) / prev));
    }
    const avgChange = oiChanges.reduce((a,b)=>a+b, 0) / (oiChanges.length || 1);
    const variance = oiChanges.reduce((a,b)=>a+ Math.pow(b-avgChange, 2), 0) / (oiChanges.length || 1);
    const oiStdDev = Math.sqrt(variance);
    const oiThreshold = Math.max(oiStdDev, 0.001); // Min 0.1% floor

    // 3. Current Deltas (Last closed candle period)
    const lastKline = klines[klines.length-1];
    const prevKline = klines[klines.length-2];
    const priceDelta = (lastKline.close - prevKline.close) / prevKline.close;

    const lastOi = parseFloat(oiHistory[oiHistory.length-1].sumOpenInterest);
    const prevOi = parseFloat(oiHistory[oiHistory.length-2].sumOpenInterest);
    const oiDelta = (lastOi - prevOi) / prevOi;

    const absPriceDelta = Math.abs(priceDelta);
    const absOiDelta = Math.abs(oiDelta);

    if (absPriceDelta < priceThreshold || absOiDelta < oiThreshold) {
        return { state: 'Neutral', intensity: 0, reason: 'Flow Below Noise Floor' };
    }

    // 4. Calculate Intensity Score (0-100)
    // Scale: 1x Threshold = 33, 3x Threshold = 100
    const priceScore = Math.min((absPriceDelta / priceThreshold), 3);
    const oiScore = Math.min((absOiDelta / oiThreshold), 3);
    const totalIntensity = ((priceScore + oiScore) / 6) * 100;

    let state = 'Neutral';
    let reason = 'Indeterminate Flow';

    if (priceDelta > 0 && oiDelta > 0) { state = 'Long Buildup'; reason = 'Strong Long Flow'; }
    else if (priceDelta > 0 && oiDelta < 0) { state = 'Short Covering'; reason = 'Shorts Exiting'; }
    else if (priceDelta < 0 && oiDelta > 0) { state = 'Short Buildup'; reason = 'Strong Short Flow'; }
    else if (priceDelta < 0 && oiDelta < 0) { state = 'Long Liquidation'; reason = 'Longs Puking'; }

    return { state, intensity: totalIntensity, reason };
}
