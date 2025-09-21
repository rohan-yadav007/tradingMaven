// services/agents/agentUtils.ts

import { Kline, BotConfig, AgentParams, MarketDataContext, ADXOutput, StochasticRSIOutput, BollingerBandsOutput, MACDOutput, IchimokuCloudOutput, VortexIndicatorOutput } from '../../types';
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
    const lastObv = getLast(obvValues);
    const lastSma = getLast(obvSma);
    if (lastObv === undefined || lastSma === undefined) return false;
    return direction === 'bullish' ? lastObv > lastSma : lastObv < lastSma;
};

export function calculateVwap(klines: Kline[]): (number | undefined)[] {
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

export function applyTimeframeSettings(config: BotConfig): BotConfig {
    const { agent, timeFrame, agentParams } = config;
    let finalParams: Required<AgentParams> = { ...constants.DEFAULT_AGENT_PARAMS };
    const timeframeSettings: Partial<AgentParams> = constants.getAgentTimeframeSettings(agent.id, timeFrame);
    finalParams = { ...finalParams, ...timeframeSettings };
    finalParams = { ...finalParams, ...agentParams };
    return { ...config, agentParams: finalParams };
}

export function isLastCandleContradictory(
    klines: Kline[],
    signalDirection: 'BUY' | 'SELL'
): { veto: boolean; reason: string } {
    if (klines.length < 3) return { veto: false, reason: '' };
    const input = { open: klines.map(k => k.open), high: klines.map(k => k.high), low: klines.map(k => k.low), close: klines.map(k => k.close) };
    if (signalDirection === 'SELL') {
        const patterns: Record<string, (input: any) => boolean[]> = { 'Bullish Engulfing': bullishengulfingpattern, 'Hammer Pattern': hammerpattern, 'Dragonfly Doji': dragonflydoji, 'Piercing Line': piercingline, 'Morning Star': morningstar };
        for (const [name, func] of Object.entries(patterns)) { if (getLast(func(input))) return { veto: true, reason: `❌ VETO: Strong bullish reversal pattern (${name}) detected.` }; }
    }
    if (signalDirection === 'BUY') {
        const patterns: Record<string, (input: any) => boolean[]> = { 'Bearish Engulfing': bearishengulfingpattern, 'Hanging Man': hangingman, 'Gravestone Doji': gravestonedoji, 'Shooting Star': shootingstar, 'Dark Cloud Cover': darkcloudcover, 'Evening Star': eveningstar };
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
        const highs = pivots.filter(p => p.type === 'high').slice(-2);
        if (highs.length === 2) {
            const [prev, last] = highs;
            const [prevRsi, lastRsi] = [getRsi(prev.index), getRsi(last.index)];
            if(prevRsi !== undefined && lastRsi !== undefined && last.price > prev.price && lastRsi < prevRsi) return true;
        }
    }
    if (positionDirection === 'SHORT') {
        const lows = pivots.filter(p => p.type === 'low').slice(-2);
        if (lows.length === 2) {
            const [prev, last] = lows;
            const [prevRsi, lastRsi] = [getRsi(prev.index), getRsi(last.index)];
            if(prevRsi !== undefined && lastRsi !== undefined && last.price < prev.price && lastRsi > prevRsi) return true;
        }
    }
    return false;
}

/**
 * Tweak #4: New utility to analyze micro-timeframe market structure.
 */
export function analyzeMicroMarketStructure(microKlines: Kline[]): 'ascending' | 'descending' | 'ranging' | null {
    if (microKlines.length < 20) return null;

    const swingPoints = findSwingPoints(microKlines, 3); // Use a shorter lookback for micro TFs
    
    const recentHighs = swingPoints.filter(p => p.type === 'high').slice(-3);
    if (recentHighs.length === 3) {
        if (recentHighs[2].price < recentHighs[1].price && recentHighs[1].price < recentHighs[0].price) {
            return 'descending';
        }
    }
    
    const recentLows = swingPoints.filter(p => p.type === 'low').slice(-3);
    if (recentLows.length === 3) {
        if (recentLows[2].price > recentLows[1].price && recentLows[1].price > recentLows[0].price) {
            return 'ascending';
        }
    }
    
    return 'ranging';
}


export function captureMarketContext(klines: Kline[], htfKlines?: Kline[]): Partial<MarketDataContext> {
    const context: Partial<MarketDataContext> = {};
    const calculateIndicators = (k: Kline[]): Partial<Omit<MarketDataContext, 'htf_trend'>> => {
        if (k.length < 2) return {};
        const c = k.map(x => x.close), h = k.map(x => x.high), l = k.map(x => x.low), v = k.map(x => x.volume || 0);
        const res: Partial<MarketDataContext> = {};
        if (k.length >= 14) {
            res.rsi14 = getLast(RSI.calculate({ period: 14, values: c }));
            res.adx14 = getLast(ADX.calculate({ period: 14, high: h, low: l, close: c })) as ADXOutput | undefined;
            res.atr14 = getLast(ATR.calculate({ period: 14, high: h, low: l, close: c }));
            res.stochRsi = getLast(StochasticRSI.calculate({ values: c, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;
            const vi14 = VortexIndicator.calculate({ period: 14, high: h, low: l, close: c });
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
        res.lastCandlePattern = recognizeCandlestickPattern(k[k.length - 1], k[k.length - 2]) ?? undefined;
        res.vwap = getLast(calculateVwap(k));
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
            const ema50 = getLast(EMA.calculate({ period: 50, values: htfKlines.map(x => x.close) }))!;
            const ema200 = getLast(EMA.calculate({ period: 200, values: htfKlines.map(x => x.close) }))!;
            if (lastClose > ema50 && ema50 > ema200) context.htf_trend = 'bullish';
            else if (lastClose < ema50 && ema50 < ema200) context.htf_trend = 'bearish';
            else context.htf_trend = 'neutral';
        }
    }
    return context;
}