// services/agents/agentUtils.ts

import { Kline, BotConfig, AgentParams, MarketDataContext, ADXOutput, StochasticRSIOutput, BollingerBandsOutput, MACDOutput, IchimokuCloudOutput, VortexIndicatorOutput, BitcoinState } from '../../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV, IchimokuCloud, bearishengulfingpattern, bullishengulfingpattern, darkcloudcover, dragonflydoji, gravestonedoji, hammerpattern, hangingman, morningstar, piercingline, shootingstar, eveningstar } from 'technicalindicators';
import * as constants from '../../constants';
import { findSwingPoints } from '../chartAnalysisService';

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
 * Calculates the slope of Bollinger Bandwidth to detect volatility expansion velocity.
 */
export function calculateBandwidthSlope(klines: Kline[], period: number = 20): number {
    if (klines.length < period + 2) return 0;
    const closes = klines.map(k => k.close);
    const bb = BollingerBands.calculate({ period, stdDev: 2, values: closes });
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
    
    // Slice off the last volume to calculate the average of previous N
    const previousVolumes = volumes.slice(0, -1).slice(-period);
    
    const sum = previousVolumes.reduce((a, b) => a + b, 0);
    const avg = sum / previousVolumes.length || 1;
    
    return lastVol / avg;
}

export function applyTimeframeSettings(config: BotConfig): BotConfig {
    const { agent, timeFrame, agentParams } = config;
    let finalParams: Required<AgentParams> = { ...constants.DEFAULT_AGENT_PARAMS };
    const timeframeSettings: Partial<AgentParams> = constants.getAgentTimeframeSettings(agent.id, timeFrame);
    finalParams = { ...finalParams, ...timeframeSettings };
    finalParams = { ...finalParams, ...agentParams };
    return { ...config, agentParams: finalParams };
}

/**
 * Calculates Fibonacci retracement levels based on a given swing.
 */
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

/**
 * Simplified Value Area (VA) calculator to estimate VAL/VAH.
 * Finds the price range that contains roughly 70% of the total volume.
 */
export function calculateValueArea(klines: Kline[]): { val: number, vah: number, poc: number } {
    if (klines.length === 0) return { val: 0, vah: 0, poc: 0 };
    
    const min = Math.min(...klines.map(k => k.low));
    const max = Math.max(...klines.map(k => k.high));
    const range = max - min;
    const step = range / 50; // 50 price buckets

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

/**
 * Calculates standard Weekly Pivot Points.
 */
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

// Re-using existing logic below
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

export function captureMarketContext(klines: Kline[], htfKlines?: Kline[], params?: AgentParams): Partial<MarketDataContext> {
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
            res.rsi14 = getLast(RSI.calculate({ period: rsiPeriod, values: c }));
            res.adx14 = getLast(ADX.calculate({ period: adxPeriod, high: h, low: l, close: c })) as ADXOutput | undefined;
            res.atr14 = getLast(ATR.calculate({ period: atrPeriod, high: h, low: l, close: c }));
            res.stochRsi = getLast(StochasticRSI.calculate({ values: c, rsiPeriod: rsiPeriod, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;
            const vi14 = VortexIndicator.calculate({ period: viPeriod, high: h, low: l, close: c });
            if(getLast(vi14.pdi) !== undefined && getLast(vi14.ndi) !== undefined) res.vi14 = { pdi: getLast(vi14.pdi)!, ndi: getLast(vi14.ndi)! };
        }
        if (k.length >= 20) {
            res.bb20_2 = getLast(BollingerBands.calculate({ period: 20, stdDev: 2, values: c })) as BollingerBandsOutput | undefined;
            res.volumeSma20 = getLast(SMA.calculate({ period: 20, values: v }));
            const obv = OBV.calculate({ close: c, volume: v });
            res.obvTrend = isObvTrending(obv, 'bullish') ? 'bullish' : isObvTrending(obv, 'bearish') ? 'bearish' : 'neutral';
        }
        if (k.length >= 26) res.macd = getLast(MACD.calculate({ values: c, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false })) as MACDOutput | undefined;
        if (k.length >= 9) res.ema9 = getLast(EMA.calculate({ period: 9, values: c }));
        if (k.length >= 21) res.ema21 = getLast(EMA.calculate({ period: 21, values: c }));
        if (k.length >= 50) res.ema50 = getLast(EMA.calculate({ period: 50, values: c }));
        if (k.length >= 200) res.ema200 = getLast(EMA.calculate({ period: 200, values: c }));
        if (k.length >= 50) res.sma50 = getLast(SMA.calculate({ period: 50, values: c }));
        if (k.length >= 200) res.sma200 = getLast(SMA.calculate({ period: 200, values: c }));
        res.ichiCloud = getLast(IchimokuCloud.calculate({ conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26, high: h, low: l })) as IchimokuCloudOutput | undefined;
        res.lastCandlePattern = recognizeCandlestickPattern(k[k.length - 1], k[k.length - 2]);
        res.vwap = getLast(calculateDailyVwap(k));
        res.lastVolume = getLast(v);
        res.lastClose = getLast(c);
        return res;
    };
    Object.assign(context, calculateIndicators(klines));
    if (htfKlines && htfKlines.length > 0) {
        const htfCtxRaw = calculateIndicators(htfKlines);
        for (const key in htfCtxRaw) (context as any)[`htf_${key}`] = (htfCtxRaw as any)[key];
        if(htfKlines.length >= 200) {
            const lastClose = getLast(htfKlines.map(x => x.close))!;
            const ema50 = getLast(EMA.calculate({ period: 50, values: htfKlines.map(x => x.close) })) as number;
            const ema200 = getLast(EMA.calculate({ period: 200, values: htfKlines.map(x => x.close) })) as number;
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

export function detectVolatilityCompression(klines: Kline[], length: number = 20, threshold: number = 0.02): boolean {
    if (klines.length < length) return false;
    const closes = klines.map(k => k.close);
    const bb = getLast(BollingerBands.calculate({ period: length, stdDev: 2, values: closes })) as BollingerBandsOutput | undefined;
    if (!bb) return false;
    const bandwidth = (bb.upper - bb.lower) / bb.middle;
    return bandwidth < threshold;
}

export function analyzeBitcoinState(btcKlines: Kline[]): BitcoinState {
    const minData = 50;
    if (!btcKlines || btcKlines.length < minData) return { state: 'NEUTRAL', trend: 'neutral', momentum: 'neutral', rejection: 'none', reason: 'Insufficient BTC Data' };
    const closes = btcKlines.map(k => k.close), highs = btcKlines.map(k => k.high), lows = btcKlines.map(k => k.low), volumes = btcKlines.map(k => k.volume || 0);
    const ema50 = getLast(EMA.calculate({ period: 50, values: closes })) || 0, rsi = getLast(RSI.calculate({ period: 14, values: closes })) || 50;
    const atr = getLast(ATR.calculate({ period: 14, high: highs, low: lows, close: closes })) || 0, adx = getLast(ADX.calculate({ period: 14, high: highs, low: lows, close: closes })) as ADXOutput;
    const volSma = getLast(SMA.calculate({ period: 20, values: volumes })) || 0;
    const macdValues = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const lastMacd = getLast(macdValues) as MACDOutput | undefined, prevMacd = macdValues.length > 1 ? macdValues[macdValues.length - 2] as MACDOutput : undefined;
    const lastKline = btcKlines[btcKlines.length - 1], currentPrice = lastKline.close, candleBody = Math.abs(lastKline.close - lastKline.open);
    let state: BitcoinState['state'] = 'NEUTRAL', trend: BitcoinState['trend'] = 'neutral', reasonParts: string[] = [];
    if (currentPrice > ema50) { trend = 'bullish'; state = 'TREND_UP'; } else if (currentPrice < ema50) { trend = 'bearish'; state = 'TREND_DOWN'; }
    let momentum: BitcoinState['momentum'] = 'neutral';
    if (lastMacd?.histogram !== undefined && prevMacd?.histogram !== undefined) {
        const delta = lastMacd.histogram - prevMacd.histogram;
        if (trend === 'bullish') momentum = delta > 0 ? 'accelerating' : 'decelerating';
        else if (trend === 'bearish') momentum = delta < 0 ? 'accelerating' : 'decelerating';
    }
    if (momentum === 'decelerating') reasonParts.push('Momentum slowing');
    if (momentum === 'accelerating') reasonParts.push('Momentum accelerating');
    let rejection: BitcoinState['rejection'] = 'none';
    const upperWick = lastKline.high - Math.max(lastKline.close, lastKline.open), lowerWick = Math.min(lastKline.close, lastKline.open) - lastKline.low;
    const wickThreshold = Math.max(candleBody * 1.5, atr * 0.2);
    if (upperWick > wickThreshold && upperWick > lowerWick) { rejection = 'resistance'; reasonParts.push('Rejected at Resistance'); }
    else if (lowerWick > wickThreshold && lowerWick > upperWick) { rejection = 'support'; reasonParts.push('Rejected at Support'); }
    const isCrash = currentPrice < ema50 && rsi < 35 && lastKline.close < lastKline.open && candleBody > (atr * 2) && lastKline.volume! > (volSma * 1.5);
    const isPump = currentPrice > ema50 && rsi > 70 && lastKline.close > lastKline.open && candleBody > (atr * 2) && lastKline.volume! > (volSma * 1.5);
    if (isCrash) { state = 'CRASH'; reasonParts = ['BTC Flash Crash']; }
    else if (isPump) { state = 'PUMP'; reasonParts = ['BTC Flash Pump']; }
    else if (adx && adx.adx < 25) { state = 'RANGE'; if (!reasonParts.includes('Ranging')) reasonParts.unshift(`Ranging (ADX ${adx.adx.toFixed(0)})`); }
    else reasonParts.unshift(state === 'TREND_UP' ? 'BTC Uptrend' : 'BTC Downtrend');
    return { state, trend, momentum, rejection, reason: reasonParts.join(', ') };
}
