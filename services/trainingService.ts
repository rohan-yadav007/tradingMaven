
// services/trainingService.ts
// Multi-pair universal pattern training engine.
// Fetches historical data in rate-safe batches, computes 25+ indicators,
// extracts pattern statistics, and aggregates into a cross-pair universal model.

import { Kline, TradingMode } from '../types';
import {
    EMA, RSI, ATR, MACD, BollingerBands, SMA, ADX, StochasticRSI, OBV,
    IchimokuCloud, WilliamsR, CCI,
} from 'technicalindicators';
import { detectFairValueGaps, detectLiquiditySweep, findLiquidityPools, calculateRVOL, Supertrend } from './agents/agentUtils';
import { calculateCVD, detectAbsorption, getVolatilityRegime } from './indicators';
import { findSwingPoints } from './chartAnalysisService';

const FUTURES_BASE = '/proxy-futures';
const SPOT_BASE = '/proxy-spot';

const BATCH_SIZE = 1000;
const BATCH_DELAY_MS = 250;

export type TrainingDuration = '3d' | '10d' | '1m' | '3m' | '6m' | '1y';

const DURATION_MS: Record<TrainingDuration, number> = {
    '3d':  3   * 86_400_000,
    '10d': 10  * 86_400_000,
    '1m':  30  * 86_400_000,
    '3m':  90  * 86_400_000,
    '6m':  180 * 86_400_000,
    '1y':  365 * 86_400_000,
};

const TF_MS: Record<string, number> = {
    '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
    '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
};

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

export interface TrainingProgress {
    phase: 'fetching' | 'computing' | 'analysing' | 'aggregating' | 'done' | 'error';
    progress: number;
    message: string;
}

export interface PatternStat {
    name: string;
    description: string;
    direction: 'LONG' | 'SHORT';
    category: string;
    occurrences: number;
    winRate: number;
    avgRMultiple: number;
    avgAdverseR: number;
}

export interface PairTrainingResult {
    symbol: string;
    timeframe: string;
    totalCandles: number;
    startDate: string;
    endDate: string;
    trendBias: 'Bullish' | 'Bearish' | 'Sideways';
    avgVolatilityRegime: 'Low' | 'Normal' | 'High';
    avgRvol: number;
    priceChangePct: number;
    patterns: PatternStat[];
    hourlyWinRate: Record<number, { wins: number; losses: number; winRate: number }>;
    chartData: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>;
}

/** A single condition inside the universal model */
export interface UniversalCondition {
    name: string;
    description: string;
    direction: 'LONG' | 'SHORT';
    category: string;
    globalWinRate: number;      // weighted avg across all trained pairs
    consistency: number;        // % of trained pairs where win rate > 50%
    avgRMultiple: number;
    avgAdverseR: number;
    trainedPairs: number;
    /** Confidence delta applied when condition aligns with Omega signal: range -15 to +15 */
    confidenceDelta: number;
}

export interface UniversalSignalModel {
    trainedPairs: string[];
    timeframe: string;
    builtAt: string;
    totalCandles: number;
    conditions: UniversalCondition[];
    /** Top 5 long conditions sorted by globalWinRate × consistency */
    bestLong: UniversalCondition[];
    /** Top 5 short conditions */
    bestShort: UniversalCondition[];
    /** Hourly consensus: aggregate win rate across all pairs */
    consensusHourlyWinRate: Record<number, number>;
    /** Strategy modifier applied to Omega thresholds and gates when this model is active */
    deployStrategy?: 'Balanced' | 'TrendRiding' | 'MeanReversion' | 'Conservative' | 'Aggressive';
}

// -----------------------------------------------------------------------
// Pattern definitions — 26 conditions across 6 categories
// -----------------------------------------------------------------------

type PatternDef = {
    name: string;
    description: string;
    category: string;
    direction: 'LONG' | 'SHORT';
    // Returns true if condition is active at candle index i
    detect: (i: number, ctx: IndicatorContext) => boolean;
};

interface IndicatorContext {
    klines: Kline[];
    closes: number[];
    highs: number[];
    lows: number[];
    vols: number[];
    rsi: (i: number) => number;
    rsi3: (i: number) => number;         // 3-period RSI for short-term exhaustion
    ema9: (i: number) => number;
    ema20: (i: number) => number;
    ema50: (i: number) => number;
    ema200: (i: number) => number;
    atr: (i: number) => number;
    macd: (i: number) => { MACD?: number; signal?: number; histogram?: number } | null;
    bb: (i: number) => { upper: number; lower: number; middle: number } | null;
    adx: (i: number) => { adx: number; pdi: number; mdi: number } | null;
    stochRsi: (i: number) => { k: number; d: number } | null;
    ichimoku: (i: number) => { conversion: number; base: number; spanA: number; spanB: number } | null;
    wr: (i: number) => number;           // Williams %R
    cci: (i: number) => number;          // Commodity Channel Index
    obv: number[];                        // OBV array
    volSma: (i: number) => number;
    cvd: number[];
    supertrend: (i: number) => { value: number; isUptrend: boolean } | null;
}

function buildPatternDefs(): PatternDef[] {
    return [
        // ─── MOMENTUM / RSI ───────────────────────────────────────────────
        {
            name: 'RSI Oversold Bounce',
            description: 'RSI dips below 30 then crosses back above — exhaustion reversal',
            category: 'Momentum',
            direction: 'LONG',
            detect: (i, c) => c.rsi(i) > 30 && c.rsi(i - 1) <= 30,
        },
        {
            name: 'RSI Overbought Rejection',
            description: 'RSI crosses below 70 from above — momentum exhaustion sell',
            category: 'Momentum',
            direction: 'SHORT',
            detect: (i, c) => c.rsi(i) < 70 && c.rsi(i - 1) >= 70,
        },
        {
            name: 'RSI Momentum Acceleration Long',
            description: 'RSI rapidly rising (3-period RSI > 70) while price breaks EMA20 — momentum entering',
            category: 'Momentum',
            direction: 'LONG',
            detect: (i, c) => c.rsi3(i) > 70 && c.closes[i] > c.ema20(i) && c.closes[i - 1] <= c.ema20(i - 1),
        },
        {
            name: 'RSI Momentum Acceleration Short',
            description: 'RSI rapidly falling (3-period RSI < 30) while price breaks below EMA20',
            category: 'Momentum',
            direction: 'SHORT',
            detect: (i, c) => c.rsi3(i) < 30 && c.closes[i] < c.ema20(i) && c.closes[i - 1] >= c.ema20(i - 1),
        },
        // ─── TREND / EMA ──────────────────────────────────────────────────
        {
            name: 'Full EMA Stack Bullish',
            description: 'Price > EMA9 > EMA20 > EMA50 > EMA200 — perfect trend alignment',
            category: 'Trend',
            direction: 'LONG',
            detect: (i, c) => c.closes[i] > c.ema9(i) && c.ema9(i) > c.ema20(i) && c.ema20(i) > c.ema50(i) && c.ema50(i) > c.ema200(i),
        },
        {
            name: 'Full EMA Stack Bearish',
            description: 'Price < EMA9 < EMA20 < EMA50 < EMA200 — perfect bearish alignment',
            category: 'Trend',
            direction: 'SHORT',
            detect: (i, c) => c.closes[i] < c.ema9(i) && c.ema9(i) < c.ema20(i) && c.ema20(i) < c.ema50(i) && c.ema50(i) < c.ema200(i),
        },
        {
            name: 'EMA9/20 Golden Cross',
            description: 'EMA9 crosses above EMA20 — short-term trend turning bullish',
            category: 'Trend',
            direction: 'LONG',
            detect: (i, c) => c.ema9(i) > c.ema20(i) && c.ema9(i - 1) <= c.ema20(i - 1),
        },
        {
            name: 'EMA9/20 Death Cross',
            description: 'EMA9 crosses below EMA20 — short-term trend turning bearish',
            category: 'Trend',
            direction: 'SHORT',
            detect: (i, c) => c.ema9(i) < c.ema20(i) && c.ema9(i - 1) >= c.ema20(i - 1),
        },
        {
            name: 'SuperTrend Bullish Flip',
            description: 'SuperTrend flips from bearish to bullish — structural trend change',
            category: 'Trend',
            direction: 'LONG',
            detect: (i, c) => {
                const cur = c.supertrend(i), prev = c.supertrend(i - 1);
                return !!(cur && prev && cur.isUptrend && !prev.isUptrend);
            },
        },
        {
            name: 'SuperTrend Bearish Flip',
            description: 'SuperTrend flips from bullish to bearish — structural trend change',
            category: 'Trend',
            direction: 'SHORT',
            detect: (i, c) => {
                const cur = c.supertrend(i), prev = c.supertrend(i - 1);
                return !!(cur && prev && !cur.isUptrend && prev.isUptrend);
            },
        },
        // ─── MACD ─────────────────────────────────────────────────────────
        {
            name: 'MACD Bullish Crossover',
            description: 'MACD line crosses above signal line — momentum shift up',
            category: 'Momentum',
            direction: 'LONG',
            detect: (i, c) => {
                const cur = c.macd(i), prev = c.macd(i - 1);
                return !!(cur && prev && cur.MACD !== undefined && cur.signal !== undefined && prev.MACD !== undefined && prev.signal !== undefined && cur.MACD > cur.signal && prev.MACD <= prev.signal);
            },
        },
        {
            name: 'MACD Bearish Crossover',
            description: 'MACD line crosses below signal — momentum shift down',
            category: 'Momentum',
            direction: 'SHORT',
            detect: (i, c) => {
                const cur = c.macd(i), prev = c.macd(i - 1);
                return !!(cur && prev && cur.MACD !== undefined && cur.signal !== undefined && prev.MACD !== undefined && prev.signal !== undefined && cur.MACD < cur.signal && prev.MACD >= prev.signal);
            },
        },
        {
            name: 'MACD Histogram Expansion Long',
            description: 'MACD histogram is positive and growing — strengthening bullish momentum',
            category: 'Momentum',
            direction: 'LONG',
            detect: (i, c) => {
                const cur = c.macd(i), prev = c.macd(i - 1);
                return !!(cur?.histogram !== undefined && prev?.histogram !== undefined && cur.histogram > 0 && cur.histogram > prev.histogram);
            },
        },
        // ─── BOLLINGER BANDS ──────────────────────────────────────────────
        {
            name: 'BB Squeeze Breakout Long',
            description: 'Price closes above upper BB after bandwidth contraction — volatility expansion',
            category: 'Volatility',
            direction: 'LONG',
            detect: (i, c) => {
                const b = c.bb(i), pb = c.bb(i - 5);
                if (!b || !pb) return false;
                const bw = (b.upper - b.lower) / b.middle;
                const pbw = (pb.upper - pb.lower) / pb.middle;
                return bw > pbw * 1.3 && c.closes[i] > b.upper;
            },
        },
        {
            name: 'BB Squeeze Breakout Short',
            description: 'Price closes below lower BB after bandwidth contraction',
            category: 'Volatility',
            direction: 'SHORT',
            detect: (i, c) => {
                const b = c.bb(i), pb = c.bb(i - 5);
                if (!b || !pb) return false;
                const bw = (b.upper - b.lower) / b.middle;
                const pbw = (pb.upper - pb.lower) / pb.middle;
                return bw > pbw * 1.3 && c.closes[i] < b.lower;
            },
        },
        {
            name: 'BB Mean Reversion Long',
            description: 'Price touches lower BB and closes back inside — range mean reversion',
            category: 'Volatility',
            direction: 'LONG',
            detect: (i, c) => {
                const b = c.bb(i);
                return !!(b && c.lows[i] <= b.lower && c.closes[i] > b.lower);
            },
        },
        // ─── ICHIMOKU ─────────────────────────────────────────────────────
        {
            name: 'Ichimoku TK Cross Bullish',
            description: 'Tenkan-Sen crosses above Kijun-Sen above the cloud — high conviction long',
            category: 'Structure',
            direction: 'LONG',
            detect: (i, c) => {
                const cur = c.ichimoku(i), prev = c.ichimoku(i - 1);
                if (!cur || !prev) return false;
                const aboveCloud = c.closes[i] > Math.max(cur.spanA, cur.spanB);
                return aboveCloud && cur.conversion > cur.base && prev.conversion <= prev.base;
            },
        },
        {
            name: 'Ichimoku TK Cross Bearish',
            description: 'Tenkan-Sen crosses below Kijun-Sen below the cloud — high conviction short',
            category: 'Structure',
            direction: 'SHORT',
            detect: (i, c) => {
                const cur = c.ichimoku(i), prev = c.ichimoku(i - 1);
                if (!cur || !prev) return false;
                const belowCloud = c.closes[i] < Math.min(cur.spanA, cur.spanB);
                return belowCloud && cur.conversion < cur.base && prev.conversion >= prev.base;
            },
        },
        {
            name: 'Ichimoku Kumo Breakout Long',
            description: 'Price closes above the Ichimoku cloud — major structural shift bullish',
            category: 'Structure',
            direction: 'LONG',
            detect: (i, c) => {
                const cur = c.ichimoku(i), prev = c.ichimoku(i - 1);
                if (!cur || !prev) return false;
                const cloudTop = (idx: number) => Math.max(c.ichimoku(idx)?.spanA ?? 0, c.ichimoku(idx)?.spanB ?? 0);
                return c.closes[i] > cloudTop(i) && c.closes[i - 1] <= cloudTop(i - 1);
            },
        },
        // ─── STOCHASTIC RSI ───────────────────────────────────────────────
        {
            name: 'StochRSI Oversold Cross Long',
            description: 'StochRSI K crosses above D from below 20 — deeply oversold reversal',
            category: 'Momentum',
            direction: 'LONG',
            detect: (i, c) => {
                const cur = c.stochRsi(i), prev = c.stochRsi(i - 1);
                return !!(cur && prev && cur.k > cur.d && prev.k <= prev.d && cur.k < 30);
            },
        },
        {
            name: 'StochRSI Overbought Cross Short',
            description: 'StochRSI K crosses below D from above 80 — deeply overbought reversal',
            category: 'Momentum',
            direction: 'SHORT',
            detect: (i, c) => {
                const cur = c.stochRsi(i), prev = c.stochRsi(i - 1);
                return !!(cur && prev && cur.k < cur.d && prev.k >= prev.d && cur.k > 70);
            },
        },
        // ─── VOLUME ───────────────────────────────────────────────────────
        {
            name: 'Volume Spike Bullish',
            description: 'Volume > 2.5× SMA20 on bullish candle — institutional accumulation',
            category: 'Volume',
            direction: 'LONG',
            detect: (i, c) => c.vols[i] > c.volSma(i) * 2.5 && c.closes[i] > c.klines[i].open,
        },
        {
            name: 'Volume Spike Bearish',
            description: 'Volume > 2.5× SMA20 on bearish candle — institutional distribution',
            category: 'Volume',
            direction: 'SHORT',
            detect: (i, c) => c.vols[i] > c.volSma(i) * 2.5 && c.closes[i] < c.klines[i].open,
        },
        {
            name: 'OBV Divergence Bullish',
            description: 'Price making lower lows while OBV makes higher lows — smart money buying',
            category: 'Volume',
            direction: 'LONG',
            detect: (i, c) => {
                if (i < 10) return false;
                return c.closes[i] < c.closes[i - 5] && c.obv[i] > c.obv[i - 5];
            },
        },
        {
            name: 'CVD Bullish Divergence',
            description: 'Price at lower low but CVD trending up — buy pressure increasing beneath price',
            category: 'Volume',
            direction: 'LONG',
            detect: (i, c) => i >= 10 && c.closes[i] < c.closes[i - 5] && c.cvd[i] > c.cvd[i - 5],
        },
        {
            name: 'CVD Bearish Divergence',
            description: 'Price at higher high but CVD trending down — sell pressure beneath the surface',
            category: 'Volume',
            direction: 'SHORT',
            detect: (i, c) => i >= 10 && c.closes[i] > c.closes[i - 5] && c.cvd[i] < c.cvd[i - 5],
        },
        // ─── ADX / DIRECTIONAL ────────────────────────────────────────────
        {
            name: 'ADX Confirmed Uptrend',
            description: 'ADX > 25 with +DI > −DI — statistically confirmed uptrend, low noise',
            category: 'Trend',
            direction: 'LONG',
            detect: (i, c) => { const a = c.adx(i); return !!(a && a.adx > 25 && a.pdi > a.mdi); },
        },
        {
            name: 'ADX Confirmed Downtrend',
            description: 'ADX > 25 with −DI > +DI — statistically confirmed downtrend',
            category: 'Trend',
            direction: 'SHORT',
            detect: (i, c) => { const a = c.adx(i); return !!(a && a.adx > 25 && a.mdi > a.pdi); },
        },
        // ─── WILLIAMS %R / CCI ────────────────────────────────────────────
        {
            name: 'Williams %R Oversold',
            description: 'Williams %R below −80 then rising above −80 — momentum exhaustion reversal',
            category: 'Momentum',
            direction: 'LONG',
            detect: (i, c) => c.wr(i) > -80 && c.wr(i - 1) <= -80,
        },
        {
            name: 'Williams %R Overbought',
            description: 'Williams %R above −20 then falling below −20 — overbought reversal',
            category: 'Momentum',
            direction: 'SHORT',
            detect: (i, c) => c.wr(i) < -20 && c.wr(i - 1) >= -20,
        },
        {
            name: 'CCI Extreme Long',
            description: 'CCI crosses above −100 from below — commodities cycle reversal signal',
            category: 'Momentum',
            direction: 'LONG',
            detect: (i, c) => c.cci(i) > -100 && c.cci(i - 1) <= -100,
        },
        {
            name: 'CCI Extreme Short',
            description: 'CCI crosses below +100 from above — overbought cycle reversal',
            category: 'Momentum',
            direction: 'SHORT',
            detect: (i, c) => c.cci(i) < 100 && c.cci(i - 1) >= 100,
        },
        // ─── STRUCTURE / SMC ──────────────────────────────────────────────
        {
            name: 'ATR Expansion Breakout Long',
            description: 'Bullish candle body > 2× ATR — impulsive move, trend likely continues',
            category: 'Structure',
            direction: 'LONG',
            detect: (i, c) => {
                const body = c.closes[i] - c.klines[i].open;
                return body > 0 && body > c.atr(i) * 2;
            },
        },
        {
            name: 'ATR Expansion Breakout Short',
            description: 'Bearish candle body > 2× ATR — impulsive sell, trend likely continues',
            category: 'Structure',
            direction: 'SHORT',
            detect: (i, c) => {
                const body = c.klines[i].open - c.closes[i];
                return body > 0 && body > c.atr(i) * 2;
            },
        },
        {
            name: 'Higher High Higher Low Bullish',
            description: 'Last 3 swing highs and lows all higher — textbook uptrend structure',
            category: 'Structure',
            direction: 'LONG',
            detect: (i, c) => {
                if (i < 10) return false;
                const recent = c.highs.slice(Math.max(0, i - 10), i + 1);
                const recentLow = c.lows.slice(Math.max(0, i - 10), i + 1);
                return recent[recent.length - 1] > recent[0] && recentLow[recentLow.length - 1] > recentLow[0];
            },
        },
    ];
}

// -----------------------------------------------------------------------
// Indicator context builder
// -----------------------------------------------------------------------

function buildIndicatorContext(klines: Kline[]): IndicatorContext {
    const closes = klines.map(k => k.close);
    const highs   = klines.map(k => k.high);
    const lows    = klines.map(k => k.low);
    const vols    = klines.map(k => k.volume || 0);

    // Pre-compute all indicator arrays
    const rsiArr    = RSI.calculate({ period: 14, values: closes });
    const rsi3Arr   = RSI.calculate({ period: 3, values: closes });
    const ema9Arr   = EMA.calculate({ period: 9, values: closes });
    const ema20Arr  = EMA.calculate({ period: 20, values: closes });
    const ema50Arr  = EMA.calculate({ period: 50, values: closes });
    const ema200Arr = EMA.calculate({ period: 200, values: closes });
    const atrArr    = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
    const macdArr   = MACD.calculate({ fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, values: closes, SimpleMAOscillator: false, SimpleMASignal: false });
    const bbArr     = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    const adxArr    = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });
    const volSmaArr = SMA.calculate({ period: 20, values: vols });
    const stochArr  = StochasticRSI.calculate({ rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3, values: closes });
    const wrArr     = WilliamsR.calculate({ period: 14, high: highs, low: lows, close: closes });
    const cciArr    = CCI.calculate({ period: 20, high: highs, low: lows, close: closes });
    const obvArr    = OBV.calculate({ close: closes, volume: vols });
    const cvdArr    = calculateCVD(klines);

    // Ichimoku — needs at least 52 candles
    let ichimokuArr: any[] = [];
    try {
        ichimokuArr = IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, simpleMAHigh: false, simpleMALow: false, spanPeriod: 52, displacement: 26 });
    } catch { /* not enough data */ }

    // SuperTrend
    let stArr: any[] = [];
    try {
        stArr = Supertrend.calculate({ high: highs, low: lows, close: closes, period: 10, multiplier: 3 });
    } catch { /* not enough data */ }

    const safe = <T>(arr: T[], absIdx: number, offset: number): T | null => {
        const idx = absIdx - offset;
        return (idx >= 0 && idx < arr.length) ? arr[idx] : null;
    };

    return {
        klines, closes, highs, lows, vols,
        rsi:      (i) => (safe(rsiArr,    i, 14) as number) ?? 50,
        rsi3:     (i) => (safe(rsi3Arr,   i, 3)  as number) ?? 50,
        ema9:     (i) => (safe(ema9Arr,   i, 9)  as number) ?? closes[i],
        ema20:    (i) => (safe(ema20Arr,  i, 20) as number) ?? closes[i],
        ema50:    (i) => (safe(ema50Arr,  i, 50) as number) ?? closes[i],
        ema200:   (i) => (safe(ema200Arr, i, 200) as number) ?? closes[i],
        atr:      (i) => (safe(atrArr,    i, 14) as number) ?? 0,
        macd:     (i) => safe(macdArr,    i, 33),
        bb:       (i) => safe(bbArr,      i, 20),
        adx:      (i) => safe(adxArr,     i, 14),
        stochRsi: (i) => {
            const v = safe(stochArr, i, 20);
            return v ? { k: (v as any).k, d: (v as any).d } : null;
        },
        ichimoku: (i) => {
            const v = safe(ichimokuArr, i, 52) as any;
            if (!v) return null;
            return { conversion: v.conversion ?? v.tenkanSen ?? 0, base: v.base ?? v.kijunSen ?? 0, spanA: v.spanA ?? v.senkouSpanA ?? 0, spanB: v.spanB ?? v.senkouSpanB ?? 0 };
        },
        wr:       (i) => (safe(wrArr,  i, 14) as number) ?? -50,
        cci:      (i) => (safe(cciArr, i, 20) as number) ?? 0,
        obv:      obvArr,
        volSma:   (i) => (safe(volSmaArr, i, 20) as number) ?? vols[i] ?? 0,
        cvd:      cvdArr,
        supertrend: (i) => {
            const v = safe(stArr, i, 10);
            if (!v) return null;
            return { value: (v as any).value ?? 0, isUptrend: (v as any).isUptrend ?? true };
        },
    };
}

// -----------------------------------------------------------------------
// Outcome evaluator
// -----------------------------------------------------------------------

function evaluateOutcome(klines: Kline[], idx: number, direction: 'LONG' | 'SHORT', atr: number, lookForward = 5): { win: boolean; rMultiple: number; adverseR: number } {
    const entry = klines[idx].close;
    const risk = atr || entry * 0.005;
    let mfe = 0, mae = 0;
    for (let i = idx + 1; i <= Math.min(idx + lookForward, klines.length - 1); i++) {
        const fav = direction === 'LONG' ? klines[i].high - entry : entry - klines[i].low;
        const adv = direction === 'LONG' ? entry - klines[i].low : klines[i].high - entry;
        mfe = Math.max(mfe, fav);
        mae = Math.max(mae, adv);
    }
    const rMultiple = mfe / risk;
    const adverseR  = mae / risk;
    const win = rMultiple >= 1.0 && rMultiple > adverseR;
    return { win, rMultiple: parseFloat(rMultiple.toFixed(2)), adverseR: parseFloat(adverseR.toFixed(2)) };
}

// -----------------------------------------------------------------------
// Batch fetcher
// -----------------------------------------------------------------------

async function fetchKlinesBatch(symbol: string, interval: string, startTime: number, endTime: number, mode: TradingMode): Promise<Kline[]> {
    const base = mode === TradingMode.USDSM_Futures ? FUTURES_BASE : SPOT_BASE;
    const ep   = mode === TradingMode.USDSM_Futures ? '/fapi/v1/klines' : '/api/v3/klines';
    const params = new URLSearchParams({ symbol, interval, startTime: String(startTime), endTime: String(endTime), limit: String(BATCH_SIZE) });
    const resp = await fetch(`${base}${ep}?${params}`);
    if (resp.status === 429 || resp.status === 418) throw new Error(`RateLimit:${resp.status}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const raw: any[][] = await resp.json();
    return raw.map(k => ({
        openTime: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]),
        close: parseFloat(k[4]), volume: parseFloat(k[5]), closeTime: k[6],
        quoteVolume: parseFloat(k[7]), trades: k[8],
        takerBuyVolume: parseFloat(k[9]), takerBuyQuoteVolume: parseFloat(k[10]), isFinal: true,
    }));
}

async function fetchAllKlines(symbol: string, interval: string, duration: TrainingDuration, mode: TradingMode, onProgress: (msg: string, pct: number) => void): Promise<Kline[]> {
    const tfMs = TF_MS[interval] ?? 300_000;
    const durationMs = DURATION_MS[duration];
    const endTime = Date.now();
    const startTime = endTime - durationMs;
    const totalBatches = Math.ceil(durationMs / (BATCH_SIZE * tfMs));

    const all: Kline[] = [];
    let cursor = startTime, batchIdx = 0, rateLimitBackoff = 0;

    while (cursor < endTime) {
        if (rateLimitBackoff > 0) {
            onProgress(`Rate limit — waiting ${Math.round(rateLimitBackoff / 1000)}s…`, 0);
            await new Promise(r => setTimeout(r, rateLimitBackoff));
            rateLimitBackoff = 0;
        }
        const batchEnd = Math.min(cursor + BATCH_SIZE * tfMs, endTime);
        try {
            const batch = await fetchKlinesBatch(symbol, interval, cursor, batchEnd, mode);
            if (batch.length === 0) break;
            all.push(...batch);
            cursor = batch[batch.length - 1].closeTime + 1;
            batchIdx++;
            onProgress(`${symbol}: ${all.length.toLocaleString()} candles`, Math.round((batchIdx / totalBatches) * 100));
            await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        } catch (e: any) {
            if (e.message?.startsWith('RateLimit')) { rateLimitBackoff = 65_000; }
            else throw e;
        }
    }
    return all;
}

// -----------------------------------------------------------------------
// Single-pair pattern analysis
// -----------------------------------------------------------------------

function analysePairPatterns(klines: Kline[], patternDefs: PatternDef[]): PatternStat[] {
    if (klines.length < 250) return [];
    const ctx = buildIndicatorContext(klines);
    const startI = 220; // enough for EMA200 + all indicators

    const stats: PatternStat[] = [];

    for (const def of patternDefs) {
        let wins = 0, losses = 0, totalR = 0, totalAdv = 0;
        for (let i = startI; i < klines.length - 5; i++) {
            try { if (!def.detect(i, ctx)) continue; } catch { continue; }
            const a = ctx.atr(i);
            if (a === 0) continue;
            const out = evaluateOutcome(klines, i, def.direction, a, 5);
            if (out.win) wins++; else losses++;
            totalR += out.rMultiple;
            totalAdv += out.adverseR;
        }
        const n = wins + losses;
        if (n < 3) continue;
        stats.push({
            name: def.name,
            description: def.description,
            direction: def.direction,
            category: def.category,
            occurrences: n,
            winRate: Math.round((wins / n) * 100),
            avgRMultiple: parseFloat((totalR / n).toFixed(2)),
            avgAdverseR: parseFloat((totalAdv / n).toFixed(2)),
        });
    }
    return stats;
}

// -----------------------------------------------------------------------
// Auto strategy selector — picks the best deployment mode based on what
// the universal model actually found, no manual input required.
// -----------------------------------------------------------------------

function autoSelectStrategy(
    bestLong: UniversalCondition[],
    bestShort: UniversalCondition[]
): UniversalSignalModel['deployStrategy'] {
    const top = [...bestLong, ...bestShort];
    if (top.length === 0) return 'Balanced';

    const trendCount    = top.filter(c => c.category === 'Trend').length;
    const reversalCount = top.filter(c => c.category === 'Momentum' || c.category === 'Volatility').length;
    const avgConsistency = top.reduce((s, c) => s + c.consistency, 0) / top.length;
    const avgWinRate     = top.reduce((s, c) => s + c.globalWinRate, 0) / top.length;

    // High-quality universal signals → be aggressive to capture early entries
    if (avgConsistency >= 70 && avgWinRate >= 60) return 'Aggressive';
    // Weak or inconsistent signals → protect capital first
    if (avgConsistency < 30 || avgWinRate < 45)   return 'Conservative';
    // Trend conditions dominate → ride confirmed momentum
    if (trendCount > reversalCount && trendCount >= 3) return 'TrendRiding';
    // Reversal/exhaustion conditions dominate → wait for extremes
    if (reversalCount > trendCount && reversalCount >= 3) return 'MeanReversion';
    // Mixed signals → default balanced threshold
    return 'Balanced';
}

// -----------------------------------------------------------------------
// Main export: multi-pair training → universal model
// -----------------------------------------------------------------------

export async function trainMultiPair(
    symbols: string[],
    timeframe: string,
    duration: TrainingDuration,
    mode: TradingMode,
    onProgress: (p: TrainingProgress) => void
): Promise<{ pairResults: Map<string, PairTrainingResult>; universalModel: UniversalSignalModel }> {

    const patternDefs = buildPatternDefs();
    const pairResults = new Map<string, PairTrainingResult>();
    const totalSymbols = symbols.length;

    // ── Phase 1: Fetch + analyse each pair ──────────────────────────────
    for (let si = 0; si < symbols.length; si++) {
        const symbol = symbols[si];
        const basePct = (si / totalSymbols) * 70;

        onProgress({ phase: 'fetching', progress: Math.round(basePct), message: `[${si + 1}/${totalSymbols}] Fetching ${symbol}…` });

        let klines: Kline[];
        try {
            klines = await fetchAllKlines(symbol, timeframe, duration, mode, (msg, subPct) => {
                onProgress({ phase: 'fetching', progress: Math.round(basePct + (subPct / totalSymbols) * 0.35), message: msg });
            });
        } catch (e: any) {
            onProgress({ phase: 'error', progress: 0, message: `Failed to fetch ${symbol}: ${e.message}` });
            throw e;
        }

        if (klines.length < 100) {
            onProgress({ phase: 'computing', progress: Math.round(basePct + 1), message: `${symbol}: insufficient candles (${klines.length}), skipping…` });
            continue;
        }

        onProgress({ phase: 'computing', progress: Math.round(basePct + 1), message: `Analysing ${symbol} (${klines.length.toLocaleString()} candles)…` });

        const patterns = analysePairPatterns(klines, patternDefs);

        // Hourly win rate
        const ctx = buildIndicatorContext(klines);
        const hourlyWinRate: Record<number, { wins: number; losses: number; winRate: number }> = {};
        for (let h = 0; h < 24; h++) hourlyWinRate[h] = { wins: 0, losses: 0, winRate: 0 };
        for (let i = 220; i < klines.length - 5; i++) {
            const h = new Date(klines[i].openTime).getUTCHours();
            const a = ctx.atr(i);
            if (a === 0) continue;
            const dir: 'LONG' | 'SHORT' = klines[i].close > ctx.ema50(i) ? 'LONG' : 'SHORT';
            const out = evaluateOutcome(klines, i, dir, a, 5);
            if (out.win) hourlyWinRate[h].wins++; else hourlyWinRate[h].losses++;
        }
        for (let h = 0; h < 24; h++) {
            const t = hourlyWinRate[h].wins + hourlyWinRate[h].losses;
            hourlyWinRate[h].winRate = t > 0 ? Math.round((hourlyWinRate[h].wins / t) * 100) : 0;
        }

        const closes = klines.map(k => k.close);
        const atrVals = ATR.calculate({ period: 14, high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes });
        const avgAtr = (atrVals.slice(-100).reduce((a, b) => a + b, 0) / Math.min(atrVals.length, 100)) || 0;
        const volRegimeCounts = { Low: 0, Normal: 0, High: 0 };
        atrVals.slice(-100).forEach((a, idx) => { volRegimeCounts[getVolatilityRegime(a, closes[closes.length - 100 + idx] ?? closes[closes.length - 1])]++; });
        const avgVolatilityRegime = (Object.entries(volRegimeCounts).sort((a, b) => b[1] - a[1])[0][0]) as 'Low' | 'Normal' | 'High';

        const firstClose = klines[0].close, lastClose = klines[klines.length - 1].close;
        const priceChangePct = parseFloat((((lastClose - firstClose) / firstClose) * 100).toFixed(2));

        const step = Math.max(1, Math.floor(klines.length / 400));
        const chartData = klines.filter((_, i) => i % step === 0).map(k => ({ time: k.openTime, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume || 0 }));

        const rvolArr = klines.slice(-100).map((_, idx, arr) => {
            const abs = klines.length - 100 + idx;
            const w = klines.slice(Math.max(0, abs - 20), abs).map(k => k.volume || 0);
            const avg = w.length > 0 ? w.reduce((a, b) => a + b, 0) / w.length : 1;
            return avg > 0 ? (klines[abs].volume || 0) / avg : 1;
        });
        const avgRvol = parseFloat((rvolArr.reduce((a, b) => a + b, 0) / rvolArr.length).toFixed(2));

        pairResults.set(symbol, {
            symbol, timeframe,
            totalCandles: klines.length,
            startDate: new Date(klines[0].openTime).toISOString().split('T')[0],
            endDate:   new Date(klines[klines.length - 1].closeTime).toISOString().split('T')[0],
            trendBias: priceChangePct > 5 ? 'Bullish' : priceChangePct < -5 ? 'Bearish' : 'Sideways',
            avgVolatilityRegime, avgRvol, priceChangePct,
            patterns, hourlyWinRate, chartData,
        });
    }

    // ── Phase 2: Aggregate into Universal Model ──────────────────────────
    onProgress({ phase: 'aggregating', progress: 72, message: `Aggregating ${pairResults.size} pair results into universal model…` });

    const allPairResults = Array.from(pairResults.values());
    const universalConditions: UniversalCondition[] = [];

    // Collect all pattern names
    const allPatternNames = new Set<string>();
    allPairResults.forEach(r => r.patterns.forEach(p => allPatternNames.add(p.name)));

    for (const name of allPatternNames) {
        const pairStats = allPairResults
            .map(r => r.patterns.find(p => p.name === name))
            .filter((p): p is PatternStat => p !== undefined && p.occurrences >= 3);

        if (pairStats.length === 0) continue;

        const totalOccurrences = pairStats.reduce((s, p) => s + p.occurrences, 0);
        // Weighted average win rate (weight by occurrences)
        const globalWinRate = Math.round(
            pairStats.reduce((s, p) => s + p.winRate * p.occurrences, 0) / totalOccurrences
        );
        const consistency = Math.round((pairStats.filter(p => p.winRate > 50).length / pairStats.length) * 100);
        const avgRMultiple = parseFloat((pairStats.reduce((s, p) => s + p.avgRMultiple, 0) / pairStats.length).toFixed(2));
        const avgAdverseR  = parseFloat((pairStats.reduce((s, p) => s + p.avgAdverseR, 0) / pairStats.length).toFixed(2));

        const def = patternDefs.find(d => d.name === name);

        // Confidence delta: conditions that are universally reliable get larger boosts
        // Formula: if 70%+ win rate and 70%+ consistency → +12, scale down from there
        const quality = (globalWinRate / 100) * (consistency / 100);
        const confidenceDelta = globalWinRate >= 50
            ? Math.round(quality * 15)              // up to +15 for perfect condition
            : -Math.round((1 - quality) * 8);       // up to -8 for universally bad condition

        universalConditions.push({
            name,
            description: def?.description ?? '',
            direction: pairStats[0].direction,
            category: def?.category ?? 'General',
            globalWinRate,
            consistency,
            avgRMultiple,
            avgAdverseR,
            trainedPairs: pairStats.length,
            confidenceDelta,
        });
    }

    // Sort and split
    const qualified = universalConditions.filter(c => c.trainedPairs >= Math.max(1, Math.floor(pairResults.size * 0.5)));
    const bestLong  = qualified.filter(c => c.direction === 'LONG').sort((a, b) => (b.globalWinRate * b.consistency) - (a.globalWinRate * a.consistency)).slice(0, 6);
    const bestShort = qualified.filter(c => c.direction === 'SHORT').sort((a, b) => (b.globalWinRate * b.consistency) - (a.globalWinRate * a.consistency)).slice(0, 6);

    // Consensus hourly win rate
    const consensusHourlyWinRate: Record<number, number> = {};
    for (let h = 0; h < 24; h++) {
        const hourRates = allPairResults.map(r => r.hourlyWinRate[h]).filter(v => v.wins + v.losses >= 3);
        consensusHourlyWinRate[h] = hourRates.length > 0
            ? Math.round(hourRates.reduce((s, v) => s + v.winRate, 0) / hourRates.length)
            : 0;
    }

    const deployStrategy = autoSelectStrategy(bestLong, bestShort);

    const universalModel: UniversalSignalModel = {
        trainedPairs: Array.from(pairResults.keys()),
        timeframe,
        builtAt: new Date().toISOString(),
        totalCandles: allPairResults.reduce((s, r) => s + r.totalCandles, 0),
        conditions: universalConditions,
        bestLong,
        bestShort,
        consensusHourlyWinRate,
        deployStrategy,
    };

    onProgress({ phase: 'done', progress: 100, message: `Universal model built: ${universalConditions.length} conditions across ${pairResults.size} pairs. Strategy: ${deployStrategy}.` });

    return { pairResults, universalModel };
}

// -----------------------------------------------------------------------
// Real-time condition scorer — used by Omega during signal generation
// -----------------------------------------------------------------------

/** Checks which universal conditions are currently active and returns a confidence delta */
export function scoreUniversalConditions(
    klines: Kline[],
    signal: 'BUY' | 'SELL',
    model: UniversalSignalModel
): { delta: number; activeConditions: string[]; opposingConditions: string[] } {
    if (klines.length < 250 || model.conditions.length === 0) return { delta: 0, activeConditions: [], opposingConditions: [] };

    const ctx = buildIndicatorContext(klines);
    const i = klines.length - 1; // current candle
    const direction: 'LONG' | 'SHORT' = signal === 'BUY' ? 'LONG' : 'SHORT';
    const patternDefs = buildPatternDefs();

    const active: string[] = [];
    const opposing: string[] = [];
    let delta = 0;

    // Only consider conditions that are in the universal model
    for (const cond of model.conditions) {
        // Must appear on at least half the trained pairs to count
        if (cond.trainedPairs < Math.max(1, model.trainedPairs.length * 0.4)) continue;

        const def = patternDefs.find(d => d.name === cond.name);
        if (!def) continue;

        let isActive = false;
        try { isActive = def.detect(i, ctx); } catch { continue; }
        if (!isActive) continue;

        if (cond.direction === direction) {
            active.push(cond.name);
            delta += cond.confidenceDelta;
        } else {
            // Opposing direction condition — subtract half its delta as a penalty
            opposing.push(cond.name);
            delta -= Math.round(cond.confidenceDelta * 0.5);
        }
    }

    // Cap the total delta to ±20
    delta = Math.max(-20, Math.min(20, delta));
    return { delta, activeConditions: active, opposingConditions: opposing };
}
