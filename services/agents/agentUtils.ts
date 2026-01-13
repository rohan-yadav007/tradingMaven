
// services/agents/agentUtils.ts

import { Kline, BotConfig, AgentParams, MarketDataContext, ADXOutput, StochasticRSIOutput, BollingerBandsOutput, MACDOutput, IchimokuCloudOutput, VortexIndicatorOutput, BitcoinState, ChartPattern } from '../../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV, IchimokuCloud, bearishengulfingpattern, bullishengulfingpattern, darkcloudcover, dragonflydoji, gravestonedoji, hammerpattern, hangingman, morningstar, piercingline, shootingstar, eveningstar } from 'technicalindicators';
import * as constants from '../../constants';
import { findSwingPoints } from '../chartAnalysisService';
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

/**
 * Finds the nearest structural level (Swing High/Low) that could act as resistance/support.
 * Used for clamping profit targets.
 */
export function findNearestStructuralLevel(
    klines: Kline[], 
    entryPrice: number, 
    direction: 'LONG' | 'SHORT', 
    lookback: number = 50
): number | null {
    const swings = findSwingPoints(klines.slice(-lookback), 5);
    
    if (direction === 'LONG') {
        // Find the lowest Swing High that is ABOVE entry price (Next Resistance)
        const resistances = swings
            .filter(s => s.type === 'high' && s.price > entryPrice)
            .sort((a, b) => a.price - b.price); // Ascending: smallest first (nearest)
        
        return resistances.length > 0 ? resistances[0].price : null;
    } else {
        // Find the highest Swing Low that is BELOW entry price (Next Support)
        const supports = swings
            .filter(s => s.type === 'low' && s.price < entryPrice)
            .sort((a, b) => b.price - a.price); // Descending: largest first (nearest)
        
        return supports.length > 0 ? supports[0].price : null;
    }
}

/**
 * Calculates the True Range of the last candle.
 * TR = Max(H-L, Abs(H-Cp), Abs(L-Cp))
 */
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
    const prev = rsiValues[rsiValues.length - 2];
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

export function detectLiquiditySweep(klines: Kline[], lookback: number = 10): { bullish: boolean, bearish: boolean } {
    if (klines.length < lookback + 1) return { bullish: false, bearish: false };
    const current = klines[klines.length - 1];
    const previousCandles = klines.slice(-lookback - 1, -1);
    const lowestLow = Math.min(...previousCandles.map(k => k.low));
    const highestHigh = Math.max(...previousCandles.map(k => k.high));
    const bullishSweep = current.low < lowestLow && current.close > lowestLow;
    const bearishSweep = current.high > highestHigh && current.close < highestHigh;
    return { bullish: bullishSweep, bearish: bearishSweep };
}

/**
 * Validates a swing rejection with volume and structure checks.
 * Replaces simple price comparison with "Volume + Wick + SFP" logic.
 */
export function validateSwingRejection(
    candle: Kline, 
    swingLevel: number, 
    type: 'support' | 'resistance', 
    volumeSma: number
): { score: number, reason: string } {
    let score = 0;
    let reasons: string[] = [];

    // 1. Structural Check: Swing Failure Pattern (SFP)
    // Did it breach the level but close back inside?
    const isSfp = type === 'support' 
        ? candle.low < swingLevel && candle.close > swingLevel 
        : candle.high > swingLevel && candle.close < swingLevel;

    if (isSfp) {
        score += 50;
        reasons.push('SFP (Close inside)');
    } else {
        // Just a touch without SFP is weaker
        const isTouch = type === 'support'
            ? candle.low <= swingLevel * 1.001
            : candle.high >= swingLevel * 0.999;
        if (isTouch) {
            score += 20;
            reasons.push('Level Touch');
        }
    }

    // 2. Effort Check: Volume Spike
    if (candle.volume && volumeSma > 0) {
        const rvol = candle.volume / volumeSma;
        if (rvol > 2.0) {
            score += 30;
            reasons.push(`High Vol (${rvol.toFixed(1)}x)`);
        } else if (rvol > 1.2) {
            score += 15;
            reasons.push(`Mod Vol (${rvol.toFixed(1)}x)`);
        }
    }

    // 3. Rejection Check: Wick Size
    const range = candle.high - candle.low;
    if (range > 0) {
        if (type === 'support') {
            const lowerWick = Math.min(candle.open, candle.close) - candle.low;
            if (lowerWick / range > 0.3) {
                score += 20;
                reasons.push('Long Wick');
            }
        } else {
            const upperWick = candle.high - Math.max(candle.open, candle.close);
            if (upperWick / range > 0.3) {
                score += 20;
                reasons.push('Long Wick');
            }
        }
    }

    return { score, reason: reasons.join(', ') };
}

export function detectFairValueGaps(klines: Kline[], lookback: number = 20): { top: number, bottom: number, type: 'FVG Bullish' | 'FVG Bearish', filled: boolean }[] {
    if (klines.length < 3) return [];
    const gaps: any[] = [];
    const recent = klines.slice(-lookback);

    for (let i = 2; i < recent.length; i++) {
        const k1 = recent[i-2];
        const k2 = recent[i-1];
        const k3 = recent[i];

        // Bullish FVG (Gap between K1 High and K3 Low)
        if (k3.low > k1.high && k2.close > k2.open) {
            gaps.push({ top: k3.low, bottom: k1.high, type: 'FVG Bullish', filled: false });
        }
        // Bearish FVG (Gap between K1 Low and K3 High)
        else if (k3.high < k1.low && k2.close < k2.open) {
            gaps.push({ top: k1.low, bottom: k3.high, type: 'FVG Bearish', filled: false });
        }
    }
    return gaps;
}

export function calculateRsiSlope(rsiValues: number[]): number {
    if (rsiValues.length < 3) return 0;
    const last = rsiValues[rsiValues.length - 1];
    const prev2 = rsiValues[rsiValues.length - 3];
    return (last - prev2) / 2; 
}

export function isPriceOverextended(currentPrice: number, meanPrice: number, volatility: number, threshold: number): boolean {
    if (volatility === 0) return false;
    return Math.abs(currentPrice - meanPrice) > (volatility * threshold);
}

/**
 * Detects if the market is in a period of low volatility (Bollinger Band squeeze).
 */
export function detectVolatilityCompression(klines: Kline[], length: number = 20, threshold: number = 0.02): boolean {
    if (klines.length < length) return false;
    const closes = klines.map(k => k.close);
    const bb = BollingerBands.calculate({ period: length, stdDev: 2, values: closes });
    // FIX: Cast getLast result to BollingerBandsOutput to access its properties.
    const lastBB = getLast(bb) as BollingerBandsOutput | undefined;
    if (!lastBB) return false;
    const bandwidth = (lastBB.upper - lastBB.lower) / lastBB.middle;
    return bandwidth < threshold;
}

/**
 * Omega V4.5 New Features
 */

export type MarketRegime = 'TRENDING' | 'RANGING' | 'SQUEEZE' | 'VOLATILE';

/**
 * Classifies the current market regime based on ADX (Trend Strength) and Bollinger Bandwidth (Volatility).
 * V4.8: Returns a conviction multiplier for sizing.
 */
export function detectMarketRegime(klines: Kline[]): { regime: MarketRegime, score: number, multiplier: number } {
    if (klines.length < 20) return { regime: 'RANGING', score: 0, multiplier: 0.8 }; // Fallback

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);

    const adxVal = getLast(ADX.calculate({ period: 14, high: highs, low: lows, close: closes })) as ADXOutput | undefined;
    const bbVal = getLast(BollingerBands.calculate({ period: 20, stdDev: 2, values: closes })) as BollingerBandsOutput | undefined;

    if (!adxVal || !bbVal) return { regime: 'RANGING', score: 0, multiplier: 0.8 };

    const adx = adxVal.adx;
    const bbw = (bbVal.upper - bbVal.lower) / bbVal.middle;

    // 1. Squeeze Check (Pre-Trend Explosion)
    // V4.8: Require confirmation (Rising ATR or high Volume) to differentiate Dead vs Coiling.
    if (bbw < 0.05) {
        const atrTrend = calculateAtrTrend(klines);
        if (atrTrend === 'expanding') {
             return { regime: 'SQUEEZE', score: 85, multiplier: 1.0 }; // Ready to pop
        }
        return { regime: 'SQUEEZE', score: 80, multiplier: 0.7 }; // Caution, could be dead
    }

    // 2. Trend Check
    if (adx > 25) {
        const mult = Math.min(1.2, 0.8 + (adx / 100)); // 0.8 to 1.2 based on strength
        return { regime: 'TRENDING', score: adx, multiplier: mult };
    }

    // 3. Volatile Chop (High Bandwidth but Low ADX)
    if (bbw > 0.15 && adx < 20) {
        return { regime: 'VOLATILE', score: bbw * 100, multiplier: 0.5 }; // Reduce size significantly
    }

    // 4. Default: Ranging
    return { regime: 'RANGING', score: 50, multiplier: 0.8 };
}

/**
 * Returns a conviction multiplier based on the time of day (Kill Zones).
 * Boosts conviction during high-volume sessions (London/NY overlap).
 */
export function getKillZoneMultiplier(): number {
    const now = new Date();
    const hour = now.getUTCHours(); // 0-23

    // London Open (07:00 - 10:00 UTC) -> High Volatility
    if (hour >= 7 && hour < 10) return 1.1;

    // NY Open / London Close Overlap (13:00 - 16:00 UTC) -> Highest Volatility
    if (hour >= 13 && hour < 16) return 1.2;

    // Asian Lunch / Weekend (Low Volatility) -> Reduce Size
    const day = now.getUTCDay(); // 0 is Sunday, 6 is Saturday
    if (day === 0 || day === 6) return 0.9;
    
    // Default
    return 1.0;
}

/**
 * Calculates percentage deviation from VWAP.
 * Returns negative if price < VWAP, positive if price > VWAP.
 */
export function calculateVwapDeviation(currentPrice: number, vwap: number): number {
    if (vwap === 0) return 0;
    return (currentPrice - vwap) / vwap;
}

/**
 * Analyzes the state of Bitcoin to provide market-wide context.
 * Returns a standardized BitcoinState object based on EMA alignment and RSI momentum.
 */
export function analyzeBitcoinState(btcKlines: Kline[]): BitcoinState {
    if (btcKlines.length < 50) {
        return { 
            state: 'NEUTRAL', 
            trend: 'neutral', 
            momentum: 'neutral', 
            rejection: 'none', 
            reason: 'Insufficient BTC data for analysis.' 
        };
    }

    const closes = btcKlines.map(k => k.close);
    const lastClose = getLast(closes)!;
    
    // EMA-based trend analysis
    const ema20Values = EMA.calculate({ period: 20, values: closes });
    const ema50Values = EMA.calculate({ period: 50, values: closes });
    // FIX: Explicitly cast EMA results to number.
    const lastEma20 = getLast(ema20Values) as number | undefined;
    const lastEma50 = getLast(ema50Values) as number | undefined;
    
    // RSI-based momentum analysis
    const rsiValues = RSI.calculate({ period: 14, values: closes });
    // FIX: Explicitly cast RSI result to number.
    const lastRsi = getLast(rsiValues) as number | undefined;

    let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (lastEma20 !== undefined && lastEma50 !== undefined) {
        if (lastClose > lastEma20 && lastEma20 > lastEma50) trend = 'bullish';
        else if (lastClose < lastEma20 && lastEma20 < lastEma50) trend = 'bearish';
    }

    // Detect sudden spikes (PUMP/CRASH)
    const returns = [];
    for(let i=1; i < Math.min(closes.length, 30); i++) {
        const idx = closes.length - 1 - i;
        if (idx >= 0) {
            returns.push((closes[idx+1] - closes[idx]) / closes[idx]);
        }
    }
    const lastReturn = returns[0] || 0;
    const avgReturn = returns.reduce((a,b) => a + Math.abs(b), 0) / (returns.length || 1);
    
    let state: BitcoinState['state'] = 'NEUTRAL';
    if (lastReturn > avgReturn * 5) state = 'PUMP';
    else if (lastReturn < -avgReturn * 5) state = 'CRASH';
    else if (trend === 'bullish') state = 'TREND_UP';
    else if (trend === 'bearish') state = 'TREND_DOWN';
    else state = 'RANGE';

    let momentum: BitcoinState['momentum'] = 'neutral';
    if (lastRsi !== undefined) {
        if (lastRsi > 60) momentum = 'accelerating';
        else if (lastRsi < 40) momentum = 'decelerating';
    }

    return {
        state,
        trend,
        momentum,
        rejection: 'none',
        reason: `BTC is in ${state} regime (${trend} trend).`
    };
}

// --- Omega V2.1 Additions ---

/**
 * CVD: Cumulative Volume Delta
 * Measures the net difference between aggressive buyers and sellers over a window.
 */
export function calculateCVD(klines: Kline[], period: number = 20): number {
    const slice = klines.slice(-period);
    return slice.reduce((acc, k) => {
        const total = k.volume || 0;
        const buy = k.takerBuyVolume || total / 2; // Fallback if taker volume missing
        const sell = total - buy;
        return acc + (buy - sell);
    }, 0);
}

/**
 * CVD DIVERGENCE (Omega V2.2)
 * Detects if CVD is making Higher Lows while Price makes Lower Lows (Bullish Divergence)
 * or CVD Lower Highs while Price Higher Highs (Bearish Divergence).
 */
export function calculateCVDDivergence(klines: Kline[], lookback: number = 20): 'Bullish Divergence' | 'Bearish Divergence' | 'None' {
    if (klines.length < lookback) return 'None';
    
    const slice = klines.slice(-lookback);
    
    // Calculate cumulative CVD array
    let currentCVD = 0;
    const cvdArray: number[] = [];
    const prices: number[] = [];
    
    for (const k of slice) {
        const total = k.volume || 0;
        const buy = k.takerBuyVolume || total / 2;
        const sell = total - buy;
        currentCVD += (buy - sell);
        cvdArray.push(currentCVD);
        prices.push(k.close);
    }
    
    // Find pivots in Price and CVD
    const findLocalExtremes = (data: number[]) => {
        const lows: { val: number, idx: number }[] = [];
        const highs: { val: number, idx: number }[] = [];
        for(let i=2; i<data.length-2; i++) {
            if (data[i] < data[i-1] && data[i] < data[i-2] && data[i] < data[i+1] && data[i] < data[i+2]) lows.push({val: data[i], idx: i});
            if (data[i] > data[i-1] && data[i] > data[i-2] && data[i] > data[i+1] && data[i] > data[i+2]) highs.push({val: data[i], idx: i});
        }
        return { lows, highs };
    }
    
    const priceExtremes = findLocalExtremes(prices);
    const cvdExtremes = findLocalExtremes(cvdArray);
    
    // Bullish Divergence: Price Lower Low, CVD Higher Low
    if (priceExtremes.lows.length >= 2 && cvdExtremes.lows.length >= 2) {
        const pL1 = priceExtremes.lows[priceExtremes.lows.length-2];
        const pL2 = priceExtremes.lows[priceExtremes.lows.length-1];
        
        // Find corresponding CVD points (roughly same time index)
        const cL1 = cvdExtremes.lows.find(c => Math.abs(c.idx - pL1.idx) <= 3);
        const cL2 = cvdExtremes.lows.find(c => Math.abs(c.idx - pL2.idx) <= 3);
        
        if (cL1 && cL2 && pL2.val < pL1.val && cL2.val > cL1.val) return 'Bullish Divergence';
    }
    
    // Bearish Divergence: Price Higher High, CVD Lower High
    if (priceExtremes.highs.length >= 2 && cvdExtremes.highs.length >= 2) {
        const pH1 = priceExtremes.highs[priceExtremes.highs.length-2];
        const pH2 = priceExtremes.highs[priceExtremes.highs.length-1];
        
        const cH1 = cvdExtremes.highs.find(c => Math.abs(c.idx - pH1.idx) <= 3);
        const cH2 = cvdExtremes.highs.find(c => Math.abs(c.idx - pH2.idx) <= 3);
        
        if (cH1 && cH2 && pH2.val > pH1.val && cH2.val < cH1.val) return 'Bearish Divergence';
    }
    
    return 'None';
}

/**
 * ABSORPTION DETECTION
 * V4.8: Added Location Filter (VWAP/BB proximity) to reduce noise.
 */
export function detectAbsorption(
    klines: Kline[], 
    context?: { vwap?: number, upperBand?: number, lowerBand?: number, atr?: number }
): 'Bullish Absorption' | 'Bearish Distribution' | 'None' {
    const last = klines[klines.length - 1];
    if (!last || !last.volume || last.volume === 0) return 'None';

    // Delta = Taker Buys - Taker Sells
    const takerBuy = last.takerBuyVolume || last.volume / 2;
    const delta = takerBuy - (last.volume - takerBuy);
    
    const range = last.high - last.low;
    // const body = Math.abs(last.close - last.open); // Unused for now
    
    // V4.8 Location Filter Logic
    let isLocationValid = true;
    if (context && context.atr) {
        const atr = context.atr;
        const threshold = atr * 0.5; // Within 0.5 ATR of key level
        let nearKeyLevel = false;

        // Valid if near VWAP or BB Extremes
        if (context.vwap && Math.abs(last.close - context.vwap) < threshold) nearKeyLevel = true;
        if (context.upperBand && Math.abs(last.close - context.upperBand) < threshold) nearKeyLevel = true;
        if (context.lowerBand && Math.abs(last.close - context.lowerBand) < threshold) nearKeyLevel = true;

        if (!nearKeyLevel) isLocationValid = false;
    }

    if (!isLocationValid) return 'None';

    // Bullish Absorption: High negative delta (aggressive sells) but price refuses to fall
    // Condition: Price closes in top half, small body relative to volume
    if (delta < -(last.volume * 0.15) && last.close > last.low + (range * 0.4)) {
        return 'Bullish Absorption';
    }
    
    // Bearish Distribution: High positive delta (aggressive buys) but price refuses to rise
    // Condition: Price closes in bottom half
    if (delta > (last.volume * 0.15) && last.close < last.high - (range * 0.4)) {
        return 'Bearish Distribution';
    }
    
    return 'None';
}
