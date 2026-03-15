
// services/agents/apex.ts
// Apex: Sovereign Predator (agentId=26)
//
// A complete redesign of Omega Prime with 5 targeted fixes derived from trade history analysis:
//  1. Hard block when model score ≤ -15 (no entries against strong model opposition)
//  2. Volume hard block below 0.3× SMA20 (not just a score penalty — actual block)
//  3. Order Block Reclaim retired (0% empirical win rate across all observed trades)
//  4. Enhanced Liquidity Sweep: wick rejection ≥40% of candle range + close-back-inside required
//  5. Conviction-based patience (replaces fixed 13-candle Guardian that killed profitable trades)
// Plus: Funding rate flow intelligence integrated into context score.

import {
    Kline, BotConfig, TradeSignal, OmegaAnalysis, BitcoinState,
    Position, TradeManagementSignal, OpenInterestKline, LongShortRatio, OmegaIntent, ADXOutput
} from '../../types';
import { EMA, ATR, RSI, SMA, ADX } from 'technicalindicators';
import {
    getLast, findLiquidityPools, detectFairValueGaps, Supertrend,
    analyzeOIDynamics, calculateRVOL, detectLiquiditySweep, calculateRsiVelocity
} from './agentUtils';
import { calculateCVD, detectAbsorption, getVolatilityRegime } from '../indicators';
import { findSwingPoints, analyzeMarketStructure } from '../chartAnalysisService';
import { pairProfileService } from '../pairProfileService';
import { scoreUniversalConditions, UniversalSignalModel } from '../trainingService';
import { getTPProportionalLockSignal } from '../riskManagementService';

// ─────────────────────────────────────────────────────────────────────────────
// APEX PRIME ENGINE — Signal Generation
// ─────────────────────────────────────────────────────────────────────────────

class ApexPrimeEngine {
    private patience: 'Low' | 'Medium' | 'High';
    private intent: OmegaIntent;

    constructor(_config: BotConfig) {
        this.patience = 'Medium';
        this.intent = 'Growth';
    }

    private getSessionStatus(timestamp?: number): { isOpen: boolean; sessionName: string; patienceBoost: number } {
        const now = timestamp ? new Date(timestamp) : new Date();
        const h = now.getUTCHours();
        if (h >= 2 && h < 6)   return { isOpen: false, sessionName: 'Dead Zone (02-06 UTC)', patienceBoost: 20 };
        if (h >= 13 && h < 21) return { isOpen: true,  sessionName: h < 17 ? 'US Open' : 'US Session', patienceBoost: -5 };
        if (h >= 8 && h < 13)  return { isOpen: true,  sessionName: 'London / EU', patienceBoost: 0 };
        return { isOpen: true, sessionName: 'Asia / Late US', patienceBoost: 5 };
    }

    private determineDynamicState(
        atr: number,
        currentPrice: number,
        structure: 'Uptrend' | 'Downtrend' | 'Ranging' | 'Indeterminate',
        timestamp?: number
    ): { intent: OmegaIntent; patience: 'Low' | 'Medium' | 'High'; reasoning: string } {
        const volatilityRegime = getVolatilityRegime(atr, currentPrice);
        let intent: OmegaIntent = 'Growth';
        if (volatilityRegime === 'High') intent = 'Preserve';
        else if (structure === 'Ranging' || structure === 'Indeterminate') intent = 'Alpha';
        else intent = 'Growth';

        let patience: 'Low' | 'Medium' | 'High' = 'Medium';
        const session = this.getSessionStatus(timestamp);
        if (!session.isOpen) patience = 'High';
        else if (volatilityRegime === 'Low' && intent === 'Alpha') patience = 'Low';
        else if (volatilityRegime === 'High') patience = 'Medium';

        return { intent, patience, reasoning: `Auto: ${volatilityRegime} Vol, Struct: ${structure}, Session: ${session.sessionName}` };
    }

    private analyzeContext(
        h1Klines: Kline[],
        lsRatioHistory?: LongShortRatio[]
    ): { bias: 'Bullish' | 'Bearish' | 'Neutral'; structure: 'Uptrend' | 'Downtrend' | 'Ranging' | 'Indeterminate'; lastSignal: string | null; sentimentScore: number; reasons: string[] } {
        const reasons: string[] = [];
        let score = 0;

        const swings = findSwingPoints(h1Klines, 5);
        const structure = analyzeMarketStructure(swings);

        if (structure.structure === 'Uptrend')   { score += 3; reasons.push('1H Structure Bullish'); }
        if (structure.structure === 'Downtrend') { score -= 3; reasons.push('1H Structure Bearish'); }
        if (structure.lastSignal === 'ChoCH_Bullish') { score += 2; reasons.push('ChoCH Bullish: Downtrend losing strength'); }
        if (structure.lastSignal === 'ChoCH_Bearish') { score -= 2; reasons.push('ChoCH Bearish: Uptrend losing strength'); }

        if (lsRatioHistory && lsRatioHistory.length > 0) {
            const currentLs = lsRatioHistory[lsRatioHistory.length - 1].longShortRatio;
            if (currentLs > 2.5)      { score -= 4; reasons.push(`Retail Euphoria (L/S: ${currentLs.toFixed(2)})`); }
            else if (currentLs < 0.6) { score += 4; reasons.push(`Retail Panic (L/S: ${currentLs.toFixed(2)})`); }
            else                      { reasons.push(`Sentiment Neutral (L/S: ${currentLs.toFixed(2)})`); }
        }

        let bias: 'Bullish' | 'Bearish' | 'Neutral' = 'Neutral';
        if (structure.structure === 'Uptrend') bias = 'Bullish';
        else if (structure.structure === 'Downtrend') bias = 'Bearish';
        else if (structure.lastSignal === 'ChoCH_Bullish' && score >= 1) bias = 'Bullish';
        else if (structure.lastSignal === 'ChoCH_Bearish' && score <= -1) bias = 'Bearish';
        else if (score >= 2) bias = 'Bullish';
        else if (score <= -2) bias = 'Bearish';

        return { bias, structure: structure.structure, lastSignal: structure.lastSignal, sentimentScore: score, reasons };
    }

    private calculateRejectionScore(candle: Kline, direction: 'LONG' | 'SHORT'): number {
        const range = candle.high - candle.low;
        if (range === 0) return 0;
        if (direction === 'SHORT') {
            const body = Math.abs(candle.close - candle.open);
            if (candle.close > candle.open && body > range * 0.6) return 0.1;
            return (candle.high - candle.close) / range;
        } else {
            const body = Math.abs(candle.close - candle.open);
            if (candle.close < candle.open && body > range * 0.6) return 0.1;
            return (candle.close - candle.low) / range;
        }
    }

    /**
     * BOS Setup Quality Score (0–100).
     * Replaces flat structScore = 70/50 for H1/M5 BOS setups.
     * Five independent dimensions: structure quality, candle character,
     * volume participation, trend alignment, RSI positioning.
     * RVOL < 0.8 penalises via rvolDim rather than hard-vetoing,
     * so strong structure + alignment can compensate weak volume.
     */
    private scoreBOS(
        bosKlines: Kline[],
        h4Klines: Kline[],
        rvol: number,
        isBuy: boolean,
        entryRsi: number,
        h1Bias: 'Bullish' | 'Bearish' | 'Neutral'
    ): number {
        // Dim 1: Prior Swing Structure (0–30)
        // HL progression (for longs) / LH progression (for shorts) before the BOS.
        const swings = findSwingPoints(bosKlines.slice(-40), 5);
        const pivots = isBuy
            ? swings.filter(s => s.type === 'low').slice(-3)
            : swings.filter(s => s.type === 'high').slice(-3);
        let trendingPivots = 0;
        for (let i = 1; i < pivots.length; i++) {
            if ( isBuy && pivots[i].price > pivots[i - 1].price) trendingPivots++;
            if (!isBuy && pivots[i].price < pivots[i - 1].price) trendingPivots++;
        }
        const structDim = trendingPivots >= 2 ? 30 : trendingPivots === 1 ? 18 : 6;

        // Dim 2: BOS Candle Character (0–25)
        // Impulse candle = conviction; doji / wrong-direction close = uncertainty.
        const bosCandle  = bosKlines[bosKlines.length - 1];
        const range      = bosCandle.high - bosCandle.low;
        const body       = Math.abs(bosCandle.close - bosCandle.open);
        const bodyPct    = range > 0 ? body / range : 0;
        const dirAligned = isBuy ? bosCandle.close > bosCandle.open : bosCandle.close < bosCandle.open;
        const candleDim  = dirAligned && bodyPct > 0.65 ? 25
                         : dirAligned && bodyPct > 0.45 ? 17
                         : dirAligned && bodyPct > 0.25 ? 10
                         : 3;

        // Dim 3: Volume Participation (0–20)
        // Continuous — low RVOL no longer hard-vetoes; strong structure/alignment can compensate.
        const rvolDim = rvol >= 2.0 ? 20
                      : rvol >= 1.5 ? 16
                      : rvol >= 1.0 ? 11
                      : rvol >= 0.8 ?  6
                      : rvol >= 0.6 ?  3
                      :                1;

        // Dim 4: Trend Alignment (0–15)
        // H1 same-TF bias + 4H confirmation. Counter-trend BOS scores 0.
        let h4Bias: 'Bullish' | 'Bearish' | 'Neutral' = 'Neutral';
        if (h4Klines.length >= 50) h4Bias = this.analyzeContext(h4Klines).bias;
        const biasAligned = isBuy ? h1Bias === 'Bullish' : h1Bias === 'Bearish';
        const h4Aligned   = isBuy ? h4Bias  === 'Bullish' : h4Bias  === 'Bearish';
        const alignDim = biasAligned && h4Aligned  ? 15
                       : biasAligned || h4Aligned  ?  9
                       : h1Bias === 'Neutral'      ?  5
                       :                              0; // H1 bias opposes trade

        // Dim 5: RSI Positioning (0–10)
        // Sweet spot: RSI < 55 for longs (room to run). Penalise overextended entries.
        const rsiDim = isBuy
            ? (entryRsi <= 50 ? 10 : entryRsi <= 57 ? 7 : entryRsi <= 63 ? 4 : 1)
            : (entryRsi >= 50 ? 10 : entryRsi >= 43 ? 7 : entryRsi >= 37 ? 4 : 1);

        return structDim + candleDim + rvolDim + alignDim + rsiDim; // max 100
    }

    // ─── ENHANCED SWEEP CONFIRMATION ────────────────────────────────────────────
    // Fix for 25% win rate: sweeps now require wick rejection + close back inside.
    // A valid sweep must:
    //  1. The sweep detection fired (via detectLiquiditySweep)
    //  2. The sweep candle has a wick ≥ 40% of total range (sharp rejection)
    //  3. The CURRENT candle closes back inside the swept level (price returned)
    private isSweepConfirmed(
        m5: Kline[],
        direction: 'LONG' | 'SHORT',
        sweepScore: number
    ): boolean {
        if (m5.length < 3) return false;

        const current = m5[m5.length - 1];
        const prev = m5[m5.length - 2];
        const sweepWindow = m5.slice(-21, -1);

        if (direction === 'LONG') {
            // Bullish sweep: price swept below a swing low then reversed
            const swingLow = Math.min(...sweepWindow.map(k => k.low));
            const range = prev.high - prev.low;
            if (range === 0) return false;
            const wickRatio = (prev.close - prev.low) / range; // lower wick relative to range
            const closedBackInside = current.close > swingLow;  // price recovered above swept level
            return wickRatio >= 0.40 && closedBackInside;
        } else {
            // Bearish sweep: price swept above a swing high then reversed
            const swingHigh = Math.max(...sweepWindow.map(k => k.high));
            const range = prev.high - prev.low;
            if (range === 0) return false;
            const wickRatio = (prev.high - prev.close) / range; // upper wick relative to range
            const closedBackInside = current.close < swingHigh; // price recovered below swept level
            return wickRatio >= 0.40 && closedBackInside;
        }
    }

    public async generateSignal(
        klinesMap: Map<string, Kline[]>,
        btc: BitcoinState,
        lsRatioHistory?: LongShortRatio[],
        openInterestHistory?: OpenInterestKline[],
        timestamp?: number,
        injectedModel?: UniversalSignalModel | null,
        fundingRate?: number | null  // raw decimal, e.g. 0.0001 = 0.01%
    ): Promise<TradeSignal> {
        const h1 = klinesMap.get('1h') || [];
        const m5 = klinesMap.get('5m') || [];

        if (h1.length < 200 || m5.length < 100) return { signal: 'HOLD', reasons: ['Syncing Matrix Data...'] };

        // Model & strategy resolved early
        const universalModel = injectedModel !== undefined ? injectedModel : pairProfileService.getModel();
        const deployStrategy = universalModel?.deployStrategy ?? 'Balanced';

        const currentKline = m5[m5.length - 1];
        const currentPrice = currentKline.close;

        // ATR
        const atrValues = ATR.calculate({ high: m5.map(k => k.high), low: m5.map(k => k.low), close: m5.map(k => k.close), period: 14 });
        const currentAtr = getLast(atrValues) || 0;
        const atrSmaValues = SMA.calculate({ period: 20, values: atrValues });
        const currentAtrSma = getLast(atrSmaValues) || currentAtr;
        const isVolatilityExpanding = currentAtr > currentAtrSma;

        // ADX
        const adxOutput = getLast(ADX.calculate({ high: m5.map(k => k.high), low: m5.map(k => k.low), close: m5.map(k => k.close), period: 14 }));

        // Context & intent
        const context = this.analyzeContext(h1, lsRatioHistory);
        const dynamic = this.determineDynamicState(currentAtr, currentPrice, context.structure, timestamp);
        this.intent = dynamic.intent;
        this.patience = dynamic.patience;
        const autoStateDescription = dynamic.reasoning;
        const sessionInfo = this.getSessionStatus(timestamp);

        // RVOL (use prev closed candle to avoid mid-candle distortion)
        const rvolKlines = (!currentKline.isFinal && m5.length > 1) ? m5.slice(0, -1) : m5;
        const rvol = calculateRVOL(rvolKlines, 20);

        // ── GATE 1: RVOL minimum ─────────────────────────────────────────────
        const minRvol = this.intent === 'Alpha' ? 0.5 : 0.8;
        if (rvol < minRvol) {
            return { signal: 'HOLD', reasons: [`⛔ VETO: Low Volatility (RVOL ${rvol.toFixed(2)} < ${minRvol})`, autoStateDescription] };
        }

        // Churn veto
        const candleRange = currentKline.high - currentKline.low;
        const candleBody = Math.abs(currentKline.close - currentKline.open);
        if (rvol > 3.0 && candleRange > 0 && (candleBody / candleRange) < 0.3) {
            return { signal: 'HOLD', reasons: [`⛔ VETO: High Volume Churn (RVOL ${rvol.toFixed(1)}x, Doji). Waiting for clarity.`] };
        }

        // ── GATE 2: VOLUME HARD BLOCK (Apex fix #2) ─────────────────────────
        // Omega reduced score 20% on low volume — Apex BLOCKS entirely below 0.3× SMA.
        // Prevents entries in illiquid conditions that have no institutional participation.
        // Use last CLOSED candle — forming candles show near-zero volume on fresh opens.
        const volSma20Values = SMA.calculate({ period: 20, values: m5.map(k => k.volume ?? 0) });
        const lastVolSma = getLast(volSma20Values) || 0;
        const volGateKline = (!currentKline.isFinal && m5.length > 1) ? m5[m5.length - 2] : currentKline;
        const lastVol = volGateKline.volume ?? 0;
        if (lastVolSma > 0 && lastVol < lastVolSma * 0.3) {
            return {
                signal: 'HOLD',
                reasons: [`⛔ VETO: Volume Dead Zone (${(lastVol / lastVolSma).toFixed(2)}× SMA < 0.30) — no institutional participation.`, autoStateDescription]
            };
        }

        // Indicators
        const cvd = calculateCVD(m5);
        const absorption = detectAbsorption(m5, cvd, 20);
        const oiAnalysis = analyzeOIDynamics(m5, openInterestHistory);
        const fvgs = detectFairValueGaps(m5, 30);

        const stValues = Supertrend.calculate({ high: m5.map(k => k.high), low: m5.map(k => k.low), close: m5.map(k => k.close), period: 10, multiplier: 3 });
        const lastSt = getLast(stValues);
        const stTrend = lastSt && currentPrice > lastSt ? 'Bullish' : 'Bearish';

        const closes = m5.map(k => k.close);
        const rsiValues = RSI.calculate({ period: 14, values: closes });
        const lastRsi = getLast(rsiValues) || 50;
        const rsiVel = calculateRsiVelocity(rsiValues);
        const sweep = detectLiquiditySweep(m5, 50);

        // ── RSI DIVERGENCE (pivot-based, 40-candle lookback) ─────────────────
        let rsiDivBullish = false;
        let rsiDivBearish = false;
        if (rsiValues.length >= 40) {
            const divWindow = m5.slice(-40);
            const divSwings = findSwingPoints(divWindow, 3);
            const rsiOffset = rsiValues.length - 40;
            const swingLows = divSwings.filter(s => s.type === 'low');
            if (swingLows.length >= 2) {
                const sl1 = swingLows[swingLows.length - 2];
                const sl2 = swingLows[swingLows.length - 1];
                const r1 = rsiOffset + sl1.index;
                const r2 = rsiOffset + sl2.index;
                if (r1 >= 0 && r2 > r1 && r2 < rsiValues.length) {
                    if (sl2.price < sl1.price && rsiValues[r2] > rsiValues[r1] + 3) rsiDivBullish = true;
                }
            }
            const swingHighs = divSwings.filter(s => s.type === 'high');
            if (swingHighs.length >= 2) {
                const sh1 = swingHighs[swingHighs.length - 2];
                const sh2 = swingHighs[swingHighs.length - 1];
                const r1 = rsiOffset + sh1.index;
                const r2 = rsiOffset + sh2.index;
                if (r1 >= 0 && r2 > r1 && r2 < rsiValues.length) {
                    if (sh2.price > sh1.price && rsiValues[r2] < rsiValues[r1] - 3) rsiDivBearish = true;
                }
            }
        }

        // ── CVD DIVERGENCE (25-candle lookback) ──────────────────────────────
        let cvdDivBullish = false;
        let cvdDivBearish = false;
        if (cvd.length >= 25 && m5.length >= 25) {
            const cvdSlice = cvd.slice(-25);
            const pSlice25 = m5.slice(-25);
            const priceDelta = pSlice25[pSlice25.length - 1].close - pSlice25[0].close;
            const cvdDelta = cvdSlice[cvdSlice.length - 1] - cvdSlice[0];
            if (priceDelta < 0 && cvdDelta > 0) cvdDivBullish = true;
            if (priceDelta > 0 && cvdDelta < 0) cvdDivBearish = true;
        }

        // Match 50-candle detection lookback for consistent SL placement
        const sweepWindow = m5.slice(-51, -1);
        const sweepedLow  = sweepWindow.length > 0 ? Math.min(...sweepWindow.map(k => k.low))  : currentPrice;
        const sweepedHigh = sweepWindow.length > 0 ? Math.max(...sweepWindow.map(k => k.high)) : currentPrice;

        let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let setupType = 'None';

        // Intent weights
        let weights = { s: 0.4, m: 0.3, c: 0.3 };
        if (this.intent === 'Growth')   weights = { s: 0.35, m: 0.4, c: 0.25 };
        if (this.intent === 'Alpha')    weights = { s: 0.2,  m: 0.6, c: 0.2  };
        if (this.intent === 'Preserve') weights = { s: 0.6,  m: 0.2, c: 0.2  };

        // ── FVG DETECTION (trending markets only — Apex fix #3) ──────────────
        // Omega entered FVGs in ranging markets. Apex only takes FVG entries when
        // the trend is confirmed (Uptrend for LONG, Downtrend for SHORT).
        const isStrongTrend = context.structure === 'Uptrend' || context.structure === 'Downtrend';
        const bullFVG = isStrongTrend && context.structure === 'Uptrend'
            ? fvgs.filter(f => f.type === 'FVG Bullish' && currentPrice >= f.bottom && currentPrice <= f.top && currentKline.close > currentKline.open)
                  .sort((a, b) => b.index - a.index)[0]
            : undefined;
        const bearFVG = isStrongTrend && context.structure === 'Downtrend'
            ? fvgs.filter(f => f.type === 'FVG Bearish' && currentPrice >= f.bottom && currentPrice <= f.top && currentKline.close < currentKline.open)
                  .sort((a, b) => b.index - a.index)[0]
            : undefined;

        const bullFVGScore = bullFVG ? Math.min(65, 45 + Math.max(0, 20 - (m5.length - bullFVG.index))) : 0;
        const bearFVGScore = bearFVG ? Math.min(65, 45 + Math.max(0, 20 - (m5.length - bearFVG.index))) : 0;

        // ── TRIGGER RESOLUTION (Priority: Sweep > FVG — OB Reclaim RETIRED) ─
        // Sweeps re-enabled with strengthened detection: RVOL ≥ 2.0, wick ≥ 40%, 50-candle lookback.
        // Old detection (RVOL 1.5, 20-candle, no wick check) was noise; new criteria ensures real stop-hunts.
        const hasBullSweep = sweep.bullish;
        const hasBearSweep = sweep.bearish;
        const hasBullFVG = !!bullFVG;
        const hasBearFVG = !!bearFVG;

        let isBullTrigger = false;
        let isBearTrigger = false;

        if (hasBullSweep && !hasBearSweep) {
            isBullTrigger = true;
        } else if (hasBearSweep && !hasBullSweep) {
            isBearTrigger = true;
        } else if (hasBullSweep && hasBearSweep) {
            if (sweep.score >= 60) isBullTrigger = context.bias === 'Bullish';
        } else if (hasBullFVG && !hasBearFVG) {
            isBullTrigger = true;
        } else if (hasBearFVG && !hasBullFVG) {
            isBearTrigger = true;
        } else if (hasBullFVG && hasBearFVG) {
            if (bullFVGScore >= bearFVGScore) isBullTrigger = context.bias === 'Bullish';
            else isBearTrigger = context.bias === 'Bearish';
        }

        const scoreDirection = isBullTrigger ? 'LONG' : (isBearTrigger ? 'SHORT' : (stTrend === 'Bullish' ? 'LONG' : 'SHORT'));

        // ── HARD GATES (secondary setups) ────────────────────────────────────
        const checkHardGates = (direction: 'LONG' | 'SHORT'): { allowed: boolean; reason?: string } => {
            if (direction === 'LONG'  && lastRsi > 72) return { allowed: false, reason: `⛔ VETO: RSI Exhaustion (${lastRsi.toFixed(1)} > 72).` };
            if (direction === 'SHORT' && lastRsi < 28) return { allowed: false, reason: `⛔ VETO: RSI Exhaustion (${lastRsi.toFixed(1)} < 28).` };
            if (direction === 'LONG'  && context.structure === 'Downtrend' && this.intent !== 'Alpha') return { allowed: false, reason: `⛔ VETO: Hard Lock against 1H Downtrend.` };
            if (direction === 'SHORT' && context.structure === 'Uptrend'   && this.intent !== 'Alpha') return { allowed: false, reason: `⛔ VETO: Hard Lock against 1H Uptrend.` };
            if (adxOutput) {
                if (direction === 'LONG'  && adxOutput.mdi > adxOutput.pdi) return { allowed: false, reason: `⛔ VETO: Bearish DI Dominance.` };
                if (direction === 'SHORT' && adxOutput.pdi > adxOutput.mdi) return { allowed: false, reason: `⛔ VETO: Bullish DI Dominance.` };
            }
            return { allowed: true };
        };

        // ── M5 & H1 BOS DETECTION ────────────────────────────────────────────
        const detectM5BOS = (direction: 'LONG' | 'SHORT'): boolean => {
            const window = m5.slice(-22, -1);
            if (window.length < 15) return false;
            const current = m5[m5.length - 1];
            const prev = m5[m5.length - 2];
            if (direction === 'LONG') {
                const swingHigh = Math.max(...window.map(k => k.high));
                return current.close > swingHigh && prev.close <= swingHigh && rvol > 1.3;
            } else {
                const swingLow = Math.min(...window.map(k => k.low));
                return current.close < swingLow && prev.close >= swingLow && rvol > 1.3;
            }
        };

        const detectH1BOS = (direction: 'LONG' | 'SHORT'): boolean => {
            if (h1.length < 25) return false;
            const closed = h1.filter(k => k.isFinal !== false);
            if (closed.length < 23) return false;
            const current = closed[closed.length - 1];
            const prev    = closed[closed.length - 2];
            const window  = closed.slice(-22, -1);
            if (direction === 'LONG') {
                const h1SwingHigh = Math.max(...window.map(k => k.high));
                return current.close > h1SwingHigh && prev.close <= h1SwingHigh;
            } else {
                const h1SwingLow = Math.min(...window.map(k => k.low));
                return current.close < h1SwingLow && prev.close >= h1SwingLow;
            }
        };

        let structScore = 0;

        if (scoreDirection === 'LONG') {
            if (isBullTrigger) {
                if (hasBullSweep) {
                    // Detection already requires RVOL ≥ 2.0 + wick ≥ 40% + 50-candle lookback.
                    // Only additional gate: block if RSI is already overbought (not a reversal).
                    if (lastRsi > 72) {
                        context.reasons.push(`⛔ VETO: RSI Exhaustion (${lastRsi.toFixed(1)} > 72) — bullish sweep rejected.`);
                    } else {
                        structScore = sweep.score;
                        setupType = 'Liquidity Sweep';
                    }
                } else if (hasBullFVG) {
                    const gate = checkHardGates('LONG');
                    if (!gate.allowed) context.reasons.push(gate.reason!);
                    else { structScore = bullFVGScore; setupType = 'FVG Entry'; }
                }
            } else {
                const gate = checkHardGates('LONG');
                if (!gate.allowed) context.reasons.push(gate.reason!);
                else if (stTrend === 'Bullish' && detectH1BOS('LONG')) {
                    setupType = 'H1 Structure BOS';
                    const rawBos = this.scoreBOS(h1, klinesMap.get('4h') || [], rvol, true, lastRsi, context.bias);
                    structScore = this.intent === 'Preserve' ? Math.round(rawBos * 0.85) : rawBos;
                } else if (stTrend === 'Bullish' && detectM5BOS('LONG')) {
                    setupType = 'Structure BOS';
                    const rawBos = this.scoreBOS(m5, klinesMap.get('4h') || [], rvol, true, lastRsi, context.bias);
                    // M5 is noisier — apply 15% quality discount; Preserve uses 0.72 (0.85²)
                    structScore = Math.round(rawBos * (this.intent === 'Preserve' ? 0.72 : 0.85));
                }
            }
        } else {
            if (isBearTrigger) {
                if (hasBearSweep) {
                    if (lastRsi < 28) {
                        context.reasons.push(`⛔ VETO: RSI Exhaustion (${lastRsi.toFixed(1)} < 28) — bearish sweep rejected.`);
                    } else {
                        structScore = sweep.score;
                        setupType = 'Liquidity Sweep';
                    }
                } else if (hasBearFVG) {
                    const gate = checkHardGates('SHORT');
                    if (!gate.allowed) context.reasons.push(gate.reason!);
                    else { structScore = bearFVGScore; setupType = 'FVG Entry'; }
                }
            } else {
                const gate = checkHardGates('SHORT');
                if (!gate.allowed) context.reasons.push(gate.reason!);
                else if (stTrend === 'Bearish' && detectH1BOS('SHORT')) {
                    setupType = 'H1 Structure BOS';
                    const rawBos = this.scoreBOS(h1, klinesMap.get('4h') || [], rvol, false, lastRsi, context.bias);
                    structScore = this.intent === 'Preserve' ? Math.round(rawBos * 0.85) : rawBos;
                } else if (stTrend === 'Bearish' && detectM5BOS('SHORT')) {
                    setupType = 'Structure BOS';
                    const rawBos = this.scoreBOS(m5, klinesMap.get('4h') || [], rvol, false, lastRsi, context.bias);
                    structScore = Math.round(rawBos * (this.intent === 'Preserve' ? 0.72 : 0.85));
                }
            }
        }

        // ── VOLUME SOFT PENALTY (between 0.3× and 1.2×) ──────────────────────
        // Below 0.3× is already a hard block above. Between 0.3-1.2× we still reduce score slightly.
        if (structScore > 0 && setupType !== 'Liquidity Sweep') {
            if (lastVolSma > 0 && lastVol >= lastVolSma * 0.3 && lastVol < lastVolSma * 1.2) {
                structScore = Math.round(structScore * 0.85);
                context.reasons.push(`⚠️ Vol Gate: Below-avg volume (${(lastVol / lastVolSma).toFixed(2)}× SMA) — structScore reduced 15%`);
            }
        }

        // ── DEAD ZONE HARD GATE ───────────────────────────────────────────────
        if (!sessionInfo.isOpen && structScore > 0 && setupType !== 'Liquidity Sweep') {
            context.reasons.push(`⛔ Dead Zone (02–06 UTC): ${setupType} blocked.`);
            structScore = 0;
        }

        // ── MOMENTUM SCORE ────────────────────────────────────────────────────
        let momScore = 0;
        const rejection = this.calculateRejectionScore(currentKline, scoreDirection);
        momScore += Math.min(rejection * 130, 60);
        if (scoreDirection === 'LONG') {
            if (rsiVel > 0.5) momScore += Math.min(rsiVel * 10, 50);
            else if (rsiVel < -1.0) momScore -= 20;
        } else {
            if (rsiVel < -0.5) momScore += Math.min(Math.abs(rsiVel) * 10, 50);
            else if (rsiVel > 1.0) momScore -= 20;
        }
        momScore = Math.max(0, Math.min(100, momScore));

        // ── 4H MULTI-TIMEFRAME ALIGNMENT ─────────────────────────────────────
        const h4 = klinesMap.get('4h') || [];
        let htfAlignment: 'Aligned' | 'Conflicted' | 'Neutral' = 'Neutral';
        if (h4.length >= 50) {
            const h4Context = this.analyzeContext(h4);
            if ((scoreDirection === 'LONG' && h4Context.bias === 'Bullish') || (scoreDirection === 'SHORT' && h4Context.bias === 'Bearish')) {
                htfAlignment = 'Aligned';
            } else if ((scoreDirection === 'LONG' && h4Context.bias === 'Bearish') || (scoreDirection === 'SHORT' && h4Context.bias === 'Bullish')) {
                htfAlignment = 'Conflicted';
                if (this.intent !== 'Alpha') context.reasons.push(`⚠️ 4H Conflict: ${h4Context.bias === 'Bearish' ? 'Bearish' : 'Bullish'} structure opposes trade.`);
            }
        }

        // ── CONTEXT SCORE ─────────────────────────────────────────────────────
        let ctxScore = 0;
        if (scoreDirection === 'LONG') {
            if (btc.trend === 'bullish') ctxScore += 30;
            if (oiAnalysis.state === 'Long Buildup')   ctxScore += Math.min(oiAnalysis.intensity, 40);
            if (context.sentimentScore >= 0)           ctxScore += 20;
            if (oiAnalysis.state === 'Short Buildup')  ctxScore -= Math.round(Math.min(oiAnalysis.intensity * 0.4, 15));
            if (oiAnalysis.state === 'Long Liquidation') ctxScore -= 10;
        } else {
            if (btc.trend === 'bearish') ctxScore += 30;
            if (oiAnalysis.state === 'Short Buildup')  ctxScore += Math.min(oiAnalysis.intensity, 40);
            if (context.sentimentScore <= 0)           ctxScore += 20;
            if (oiAnalysis.state === 'Long Buildup')   ctxScore -= Math.round(Math.min(oiAnalysis.intensity * 0.4, 15));
            if (oiAnalysis.state === 'Short Covering')  ctxScore -= 10;
        }
        if (isVolatilityExpanding) ctxScore += 10;

        // ── FUNDING RATE INTELLIGENCE (Apex addition) ────────────────────────
        // Positive funding = longs pay shorts (longs crowded).
        // Negative funding = shorts pay longs (shorts crowded).
        // Used to gauge positioning extremes and flow alignment.
        const fundingPct = (fundingRate ?? 0) * 100; // convert to % (e.g., 0.0001 → 0.01%)
        if (fundingPct > 0.03) {
            // Longs very crowded — reward SHORT, penalise LONG
            if (scoreDirection === 'SHORT') { ctxScore += 12; context.reasons.push(`💰 Funding Tailwind: ${fundingPct.toFixed(4)}% (shorts earn) (+12)`); }
            else                            { ctxScore -= 10; context.reasons.push(`⚠️ Funding Headwind: ${fundingPct.toFixed(4)}% (longs pay) (-10)`); }
        } else if (fundingPct < -0.01) {
            // Shorts crowded — reward LONG, penalise SHORT
            if (scoreDirection === 'LONG')  { ctxScore += 10; context.reasons.push(`💰 Funding Tailwind: ${fundingPct.toFixed(4)}% (longs earn) (+10)`); }
            else                            { ctxScore -= 8;  context.reasons.push(`⚠️ Funding Headwind: ${fundingPct.toFixed(4)}% (shorts pay) (-8)`); }
        } else if (fundingRate !== null && fundingRate !== undefined && Math.abs(fundingPct) <= 0.005) {
            // Neutral funding — no meaningful edge
            context.reasons.push(`⚖️ Funding Neutral (${fundingPct.toFixed(4)}%)`);
        }

        // RSI & CVD divergence
        if (scoreDirection === 'LONG'  && rsiDivBullish) { ctxScore += 15; context.reasons.push('📊 Bullish RSI Divergence (+15)'); }
        if (scoreDirection === 'SHORT' && rsiDivBearish) { ctxScore += 15; context.reasons.push('📊 Bearish RSI Divergence (+15)'); }
        if (scoreDirection === 'LONG'  && cvdDivBullish) { ctxScore += 10; context.reasons.push('📈 CVD Absorption: Smart money buying (+10)'); }
        if (scoreDirection === 'SHORT' && cvdDivBearish) { ctxScore += 10; context.reasons.push('📉 CVD Distribution: Smart money selling (+10)'); }

        // 4H alignment
        if (htfAlignment === 'Aligned') ctxScore += 15;
        else if (htfAlignment === 'Conflicted') {
            ctxScore -= this.intent === 'Alpha' ? 10 : 20;
            if (this.intent === 'Alpha' && structScore > 0 && setupType !== 'Liquidity Sweep') {
                context.reasons.push(`⛔ VETO: 4H Conflict blocks ${setupType} in Alpha mode.`);
                structScore = 0;
            }
        }

        // Daily structure
        const d1 = klinesMap.get('1d') || [];
        if (d1.length >= 30) {
            const d1Context = this.analyzeContext(d1);
            if ((scoreDirection === 'LONG' && d1Context.bias === 'Bullish') || (scoreDirection === 'SHORT' && d1Context.bias === 'Bearish')) {
                ctxScore += 15; context.reasons.push(`📅 Daily Aligned: macro ${d1Context.bias} (+15)`);
            } else if ((scoreDirection === 'LONG' && d1Context.bias === 'Bearish') || (scoreDirection === 'SHORT' && d1Context.bias === 'Bullish')) {
                ctxScore -= 10; context.reasons.push(`📅 Daily Conflict: macro ${d1Context.bias} opposes trade (-10)`);
            }
        }

        ctxScore = Math.min(ctxScore, 80);

        // ── FINAL CONFIDENCE ──────────────────────────────────────────────────
        const finalConfidenceRaw = (structScore * weights.s) + (momScore * weights.m) + (ctxScore * weights.c);
        const conflictCap = htfAlignment === 'Conflicted' ? 78 : 100;
        const finalConfidence = Math.max(0, Math.min(conflictCap, finalConfidenceRaw));

        // ── UNIVERSAL MODEL ALIGNMENT ─────────────────────────────────────────
        let universalDelta = 0;
        let modelHourWinRate = 0;
        let perfectBonus = 0;
        let uActiveCount = 0;

        if (universalModel && structScore > 0) {
            const uSignal = scoreDirection === 'LONG' ? 'BUY' : 'SELL';
            const uScore = scoreUniversalConditions(m5, uSignal, universalModel);
            universalDelta = uScore.delta;
            uActiveCount = uScore.activeConditions.length;

            const bestConditions = scoreDirection === 'LONG' ? universalModel.bestLong : universalModel.bestShort;
            const activeSet = new Set(uScore.activeConditions);
            const topMatchCount = bestConditions.slice(0, 3).filter(c => activeSet.has(c.name)).length;
            if (topMatchCount >= 2) {
                perfectBonus = topMatchCount * 3;
                context.reasons.push(`⭐ Perfect Alignment: ${topMatchCount} elite conditions active (+${perfectBonus})`);
            }

            if (universalDelta !== 0 || perfectBonus > 0) {
                const alignedStr = uScore.activeConditions.slice(0, 2).join(', ') || 'none';
                context.reasons.push(
                    universalDelta > 0
                        ? `✅ Model: +${universalDelta} (${uActiveCount} align: ${alignedStr})`
                        : `⚠️ Model: ${universalDelta} (${uScore.opposingConditions.length} oppose)`
                );
            }
        }

        // Setup-aware model delta: same rules as Omega.
        // Liquidity Sweep: model can only veto (negative delta), never boost marginal entries.
        // H1 Structure BOS: ignore mild negatives (> -10) — only clear model opposition vetoes premium structural setups.
        let effectiveDelta = universalDelta;
        let effectivePerfectBonus = perfectBonus;
        if (setupType === 'Liquidity Sweep') {
            effectiveDelta = Math.min(0, effectiveDelta);
            effectivePerfectBonus = 0;
        } else if (setupType === 'H1 Structure BOS' && effectiveDelta > -10) {
            effectiveDelta = Math.max(0, effectiveDelta);
        }

        const adjustedConfidence = Math.max(0, Math.min(100, finalConfidence + effectiveDelta + effectivePerfectBonus));

        // ── HARD BLOCK: MODEL ≤ -15 (Apex fix #1) ────────────────────────────
        // Hard-block entries where the trained model strongly opposes.
        if (structScore > 0 && universalDelta <= -15) {
            return {
                signal: 'HOLD',
                reasons: [
                    `⛔ APEX VETO: Model strongly opposes entry (delta ${universalDelta}). No trade.`,
                    autoStateDescription,
                    `Trigger: ${setupType}`, `Vol: ${rvol.toFixed(2)}x`
                ]
            };
        }

        const modelRan = !!(universalModel && structScore > 0);
        const scoreBreakdown = modelRan
            ? { structure: structScore, momentum: momScore, context: ctxScore, model: effectiveDelta + effectivePerfectBonus }
            : { structure: structScore, momentum: momScore, context: ctxScore };

        // ── THRESHOLD RE-CALIBRATION ──────────────────────────────────────────
        let threshold = 55;
        if (this.patience === 'High') threshold = 70;
        if (this.patience === 'Low')  threshold = 45;
        if (this.intent === 'Preserve') threshold += 5;
        if (this.intent === 'Alpha')    threshold -= 5;
        threshold = Math.min(80, Math.max(40, threshold + sessionInfo.patienceBoost));

        if (universalModel?.deployStrategy) {
            const stratAdj: Record<string, number> = {
                TrendRiding: -5, MeanReversion: +5, Conservative: +12, Aggressive: -10, Balanced: 0,
            };
            let adj = stratAdj[deployStrategy] ?? 0;
            if (setupType === 'Liquidity Sweep' && adj < 0) adj = 0; // no threshold lowering for sweeps
            if (adj !== 0) {
                threshold = Math.min(80, Math.max(40, threshold + adj));
                context.reasons.push(`🎯 Strategy [${deployStrategy}]: threshold ${adj > 0 ? '+' : ''}${adj} → ${threshold}%`);
            }
        }

        if (universalModel) {
            const currentHour = new Date(timestamp ?? Date.now()).getUTCHours();
            modelHourWinRate = universalModel.consensusHourlyWinRate[currentHour] ?? 0;
            if (modelHourWinRate > 0) {
                if (modelHourWinRate < 40)      { threshold = Math.min(80, threshold + 8); context.reasons.push(`🕒 Weak hour ${currentHour}:00 UTC (${modelHourWinRate}% win rate) — threshold raised`); }
                else if (modelHourWinRate >= 65) { threshold = Math.max(40, threshold - 5); context.reasons.push(`🕒 Strong hour ${currentHour}:00 UTC (${modelHourWinRate}% win rate) — threshold eased`); }
            }
        }

        // ── HARD GATE & EXECUTION ─────────────────────────────────────────────
        if (structScore > 0) {
            if (scoreDirection === 'LONG') {
                const isCounterTrend = stTrend === 'Bearish';
                if (this.intent === 'Preserve' && isCounterTrend) {
                    context.reasons.push('⛔ VETO: Preserve Mode blocks counter-trend.');
                } else {
                    const isStrongRejection = rejection > 0.10;
                    const isImpulse = currentKline.close > currentKline.open &&
                        (currentKline.close - currentKline.open) > (currentKline.high - currentKline.low) * 0.5 && rvol > 1.3;
                    const highConvictionOverride = adjustedConfidence >= (threshold + 7);
                    if (adjustedConfidence >= threshold && (isStrongRejection || isImpulse || highConvictionOverride)) {
                        signal = 'BUY';
                    } else if (adjustedConfidence < threshold) {
                        context.reasons.push(`⚠️ Confidence ${adjustedConfidence.toFixed(0)} < Threshold ${threshold}`);
                    } else {
                        context.reasons.push(`⚠️ Setup valid (${adjustedConfidence.toFixed(0)}%) but no entry confirmation.`);
                    }
                }
            } else if (scoreDirection === 'SHORT') {
                const isCounterTrend = stTrend === 'Bullish';
                if (this.intent === 'Preserve' && isCounterTrend) {
                    context.reasons.push('⛔ VETO: Preserve Mode blocks counter-trend.');
                } else {
                    const isStrongRejection = rejection > 0.10;
                    const isImpulse = currentKline.close < currentKline.open &&
                        (currentKline.open - currentKline.close) > (currentKline.high - currentKline.low) * 0.5 && rvol > 1.3;
                    const highConvictionOverride = adjustedConfidence >= (threshold + 7);
                    if (adjustedConfidence >= threshold && (isStrongRejection || isImpulse || highConvictionOverride)) {
                        signal = 'SELL';
                    } else if (adjustedConfidence < threshold) {
                        context.reasons.push(`⚠️ Confidence ${adjustedConfidence.toFixed(0)} < Threshold ${threshold}`);
                    } else {
                        context.reasons.push(`⚠️ Setup valid (${adjustedConfidence.toFixed(0)}%) but no entry confirmation.`);
                    }
                }
            }
        }

        // ── BTC REGIME HARD GATE ──────────────────────────────────────────────
        if (signal === 'BUY' && (btc.state === 'CRASH' || (btc.state === 'TREND_DOWN' && btc.momentum === 'accelerating'))) {
            signal = 'HOLD';
            context.reasons.push(`⛔ BTC Regime Block: ${btc.state} / ${btc.momentum} — no longs.`);
        }
        if (signal === 'SELL' && (btc.state === 'PUMP' || (btc.state === 'TREND_UP' && btc.momentum === 'accelerating'))) {
            signal = 'HOLD';
            context.reasons.push(`⛔ BTC Regime Block: ${btc.state} / ${btc.momentum} — no shorts against parabolic BTC.`);
        }

        // ── OI VETO ───────────────────────────────────────────────────────────
        if (setupType !== 'Liquidity Sweep') {
            if (signal === 'BUY'  && oiAnalysis.state === 'Short Covering' && oiAnalysis.intensity > 55) {
                signal = 'HOLD';
                context.reasons.push(`⚠️ VETO: Pure Short Squeeze — no genuine long buildup.`);
            }
            if (signal === 'SELL' && oiAnalysis.state === 'Long Liquidation' && oiAnalysis.intensity > 55) {
                signal = 'HOLD';
                context.reasons.push(`⚠️ VETO: Cascade Long Liquidation — avoid knife-catch short.`);
            }
        }

        // ── OUTPUT ASSEMBLY ───────────────────────────────────────────────────
        const baseReasons = [
            ...context.reasons,
            autoStateDescription,
            `Patience: ${this.patience} (Req: ${threshold}%)`,
            `ST: ${stTrend}`,
            `OI: ${oiAnalysis.state} (${oiAnalysis.intensity.toFixed(0)}%)`
        ];

        const triggerCondDisplay = absorption === 'Bullish' ? 'Bullish Flow' : absorption === 'Bearish' ? 'Bearish Flow' : rvol > 1.2 ? 'Volatile' : 'Consolidating';

        const commonAnalysis: OmegaAnalysis = {
            conviction: adjustedConfidence,
            intent: this.intent,
            marketState: { bias1H: context.bias, structure: context.structure as any },
            sentiment: {
                lsRatio: lsRatioHistory?.[lsRatioHistory.length - 1]?.longShortRatio || 0,
                cvdState: absorption === 'None' ? 'Neutral' : absorption === 'Bullish' ? 'Absorption' : 'Distribution',
                fundingRate: fundingRate !== null && fundingRate !== undefined ? `${(fundingRate * 100).toFixed(4)}%` : '—',
                oiState: oiAnalysis.state
            },
            poiStatus: {
                type: setupType.includes('Liquidity') ? 'Liquidity Sweep' : setupType.includes('FVG') ? 'FVG Entry' : 'None',
                distance: signal !== 'HOLD' ? 'Active' : 'Scanning',
                priceLevel: currentPrice
            },
            triggerStatus: { ready: signal !== 'HOLD', condition: triggerCondDisplay },
            targets: { entry: currentPrice, stopLoss: 0, takeProfit: 0 },
            sizing: { multiplier: 1.0 },
            sessionAnalysis: sessionInfo.sessionName,
            htfAlignment,
            scoreBreakdown,
            modelScore: modelRan ? { delta: effectiveDelta + effectivePerfectBonus, activeCount: uActiveCount, hourWinRate: modelHourWinRate, perfectBonus: effectivePerfectBonus } : undefined,
        };

        if (signal !== 'HOLD') {
            const isBuy = signal === 'BUY';
            const buffer = currentAtr * 0.2;

            // ── STRUCTURAL STOP LOSS ──────────────────────────────────────────
            let stopLoss: number;
            if (setupType === 'Liquidity Sweep') {
                stopLoss = isBuy ? sweepedLow - buffer : sweepedHigh + buffer;
            } else if (setupType === 'FVG Entry' && isBuy && bullFVG) {
                stopLoss = bullFVG.bottom - buffer;
                const minDist = currentAtr * 1.0;
                if (currentPrice - stopLoss < minDist) stopLoss = currentPrice - minDist;
            } else if (setupType === 'FVG Entry' && !isBuy && bearFVG) {
                stopLoss = bearFVG.top + buffer;
                const minDist = currentAtr * 1.0;
                if (stopLoss - currentPrice < minDist) stopLoss = currentPrice + minDist;
            } else {
                // H1 BOS / M5 BOS — stop at last confirmed structural swing
                const bosKlines = setupType === 'H1 Structure BOS' ? h1.slice(-40) : m5.slice(-40);
                const bosSwings = findSwingPoints(bosKlines, 3);
                if (isBuy) {
                    const lastSwingLow = bosSwings.filter(s => s.type === 'low').pop();
                    stopLoss = lastSwingLow ? lastSwingLow.price - buffer : currentPrice - currentAtr * 2.0;
                } else {
                    const lastSwingHigh = bosSwings.filter(s => s.type === 'high').pop();
                    stopLoss = lastSwingHigh ? lastSwingHigh.price + buffer : currentPrice + currentAtr * 2.0;
                }
                const minDist = currentAtr * 1.2;
                if (isBuy  && currentPrice - stopLoss < minDist) stopLoss = currentPrice - minDist;
                if (!isBuy && stopLoss - currentPrice < minDist) stopLoss = currentPrice + minDist;
            }

            const riskDist = Math.abs(currentPrice - stopLoss);
            const stopDistPct = (riskDist / currentPrice) * 100;

            // ── STRUCTURAL TAKE PROFIT ────────────────────────────────────────
            // For H1 Structure BOS: the signal comes from H1, so TP targets must also be H1-level
            // swing highs/lows. M5 micro-swings are too close and too noisy for a structural H1 trade.
            const tpKlines = setupType === 'H1 Structure BOS' ? h1.slice(-100) : m5;
            const liquidityPools = findLiquidityPools(tpKlines);

            // H1 BOS / Structure BOS: accept levels from 1.2R (closer structures are still valid R:R).
            // Sweep / OB / FVG: keep 1.5R minimum.
            const minRMultiple = (setupType === 'H1 Structure BOS' || setupType === 'Structure BOS') ? 1.2 : 1.5;
            const minTP = isBuy ? currentPrice + riskDist * minRMultiple : currentPrice - riskDist * minRMultiple;
            const maxTP = isBuy ? currentPrice + riskDist * 5            : currentPrice - riskDist * 5;

            const structuralTPLevel = isBuy
                ? liquidityPools.bsl.find(l => l > minTP && l < maxTP)
                : liquidityPools.ssl.find(l => l < minTP && l > maxTP);

            // Also search H1 FVGs as TP magnets for H1 BOS setups
            const h1fvgs = setupType === 'H1 Structure BOS' ? detectFairValueGaps(h1, 50) : [];
            const allFvgs = setupType === 'H1 Structure BOS' ? [...fvgs, ...h1fvgs] : fvgs;
            const fvgTP = isBuy
                ? allFvgs.filter(f => f.type === 'FVG Bearish' && f.bottom > minTP && f.bottom < maxTP)
                         .sort((a, b) => a.bottom - b.bottom)[0]?.bottom
                : allFvgs.filter(f => f.type === 'FVG Bullish' && f.top < minTP && f.top > maxTP)
                         .sort((a, b) => b.top - a.top)[0]?.top;

            // Fallback R scaled to stop distance — wide stops need conservative targets:
            //   >5% stop: 1.5R  |  3–5% stop: 2.0R  |  <3% stop: 2.5R
            const fallbackR = stopDistPct > 5 ? 1.5 : stopDistPct > 3 ? 2.0 : 2.5;
            const fallbackTP = isBuy ? currentPrice + riskDist * fallbackR : currentPrice - riskDist * fallbackR;
            const tpSource = structuralTPLevel ? 'Liquidity Pool' : (fvgTP ? 'FVG Magnet' : `Fallback ${fallbackR}R`);

            const rawTP = structuralTPLevel ?? fvgTP ?? fallbackTP;
            // Sanity check: ensure TP is inside the intended [minTP, maxTP] window.
            const tpInBounds = isBuy
                ? rawTP > minTP && rawTP <= maxTP
                : rawTP < minTP && rawTP >= maxTP;
            const takeProfit = tpInBounds ? rawTP : fallbackTP;

            const sizingMultiplier = this.intent === 'Alpha' ? 0.5 : (this.intent === 'Preserve' ? 0.75 : 1.0);

            commonAnalysis.targets = { entry: currentPrice, stopLoss, takeProfit };
            commonAnalysis.sizing  = { multiplier: sizingMultiplier };

            return {
                signal,
                reasons: [...baseReasons, `Trigger: ${setupType}`, `Vol: ${rvol.toFixed(2)}x`],
                entryPrice: currentPrice,
                stopLossPrice: stopLoss,
                takeProfitPrice: takeProfit,
                tradeType: 'conviction',
                setupType,
                omegaAnalysis: commonAnalysis,
                omegaMetadata: {
                    tier: this.intent,
                    rvol,
                    entryRsi: lastRsi,
                    stopDistancePercent: (riskDist / currentPrice) * 100,
                    tpSource,
                    slSource: setupType === 'Liquidity Sweep' ? 'Swept Level' : setupType === 'FVG Entry' ? 'FVG Zone' : 'BOS Level',
                    // Store conviction for conviction-based patience in management engine
                    entryConviction: adjustedConfidence,
                }
            };
        }

        return { signal: 'HOLD', reasons: baseReasons, omegaAnalysis: commonAnalysis };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// APEX MANAGEMENT ENGINE — Position Management
// ─────────────────────────────────────────────────────────────────────────────
// Key improvement over SovereignManagementEngine:
//  - Conviction-based patience replaces fixed 13-candle Guardian
//  - Winners near TP get patience extensions (prevents early exits like MEME +7.76% → +0.44%)
//  - Still uses TP-Proportional Profit Lock for profit capture

export class ApexManagementEngine {
    public static manage(
        position: Position,
        currentPrice: number,
        klines: Kline[],
        klinesMap?: Map<string, Kline[]>,
        modelDelta?: number
    ): TradeManagementSignal {
        const signal: TradeManagementSignal = { reasons: [] };
        const isLong = position.direction === 'LONG';
        const entryPrice = position.entryPrice;
        const pnlR = (isLong ? currentPrice - entryPrice : entryPrice - currentPrice) / position.initialRiskInPrice;

        // Pre-calculate ATR (needed by both guardian tight-trail and elastic ratchet below)
        const atrValues = ATR.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: klines.map(k => k.close), period: 14 });
        const atr = getLast(atrValues) || 0;
        if (atr === 0) return signal;
        const volRegime: 'Low' | 'Normal' | 'High' = getVolatilityRegime(atr, currentPrice);

        // ── 1. CONVICTION-BASED PATIENCE (Apex fix #5) ───────────────────────
        // Trade history showed MEME had 7.76% MFE but exited at +0.44% after 13 candles.
        // New system: patience budget scales with entry conviction + extends when near TP.
        const entryConviction: number = position.entryContext?.omega_metadata?.entryConviction ?? 65;

        let rotThreshold: number;
        if (entryConviction >= 80)      rotThreshold = 24; // max conviction → maximum patience
        else if (entryConviction >= 70)  rotThreshold = 20;
        else if (entryConviction >= 60)  rotThreshold = 16;
        else                             rotThreshold = 10; // low conviction → exit faster

        // Patience EXTENSION: if trade is profitable or near TP, hold longer
        const tpLockStage = position.tpLockStage ?? 0;
        if (tpLockStage > 0) rotThreshold += 6; // position locked profit → let it run

        // Patience EXTENSION: if price is within 25% of TP distance remaining, never exit on candle count
        if (position.takeProfitPrice) {
            const totalRange = Math.abs(position.takeProfitPrice - entryPrice);
            const remainingDist = Math.abs(position.takeProfitPrice - currentPrice);
            const remainingPct = totalRange > 0 ? (remainingDist / totalRange) * 100 : 100;
            if (remainingPct <= 25) rotThreshold = 999; // don't Guardian-exit within 25% of TP
        }

        const isCounterTrend = position.setupType?.includes('Counter-Trend') || false;
        if (isCounterTrend) rotThreshold = Math.round(rotThreshold * 0.7); // shorter for counter-trend

        if (position.candlesSinceEntry > rotThreshold && pnlR < 0.2 && pnlR > -0.5) {
            if (pnlR > 0) {
                // Any positive movement → trail with SL floored at fee-breakeven.
                // Even if price is only slightly positive, feeBreakeven floor ensures SL is
                // at/above entry + fees, so the exit can never produce a net loss.
                const feeBreakeven = isLong
                    ? entryPrice * (1 + position.takerFeeRate * 2)
                    : entryPrice * (1 - position.takerFeeRate * 2);
                const rawTightSl = isLong ? currentPrice - atr * 0.5 : currentPrice + atr * 0.5;
                const tightSl = isLong ? Math.max(rawTightSl, feeBreakeven) : Math.min(rawTightSl, feeBreakeven);
                if ((isLong && tightSl > position.stopLossPrice) || (!isLong && tightSl < position.stopLossPrice)) {
                    return {
                        newStopLoss: tightSl,
                        activeStopLossReason: 'Apex Guardian Trail',
                        reasons: [`Apex Guardian: Profitable but stagnant (${position.candlesSinceEntry} candles, conv ${Math.round(entryConviction)}%) → tight trail (min fee-breakeven)`]
                    };
                }
            } else {
                // Negative or flat — exit cleanly.
                return {
                    action: 'close',
                    reasons: [`Apex Guardian: Trade Stagnant (${position.candlesSinceEntry} candles > threshold ${rotThreshold}, conviction ${Math.round(entryConviction)}%).`]
                };
            }
        }

        // ── 2. TP-PROPORTIONAL PROFIT LOCK ───────────────────────────────────
        if (position.takeProfitPrice) {
            const tpLock = getTPProportionalLockSignal(position, currentPrice, modelDelta);
            if (tpLock.newStopLoss !== undefined) return tpLock;
        }

        // ── 3. ELASTIC RATCHET (Dynamic Trailing) ────────────────────────────
        // If TP-lock is engaged (stage ≥1), it owns SL progression for the rest of the trade.
        // ATR-based trail would compete with TP-lock's TP-progress-based placements.
        if (tpLockStage >= 1) return signal;

        const stdTrail  = volRegime === 'High' ? 2.0 : volRegime === 'Low' ? 0.8 : 1.5;
        const fastTrail = volRegime === 'High' ? 1.2 : volRegime === 'Low' ? 0.5 : 1.0;
        const tightTrail = volRegime === 'High' ? 0.8 : 0.5;

        // TP-proportional R-tiers
        // TP-lock stage 1 fires at 38% TP progress. The R-tiers are a safety net for the
        // segment BEFORE stage 1 kicks in. They must not fire so early that they terminate
        // a trade that is simply making normal progress toward its structural target.
        //
        // Tier base = half of where TP-lock stage 1 fires (R), minimum 2.2R.
        // At 3R TP:  stage1=1.14R, base=max(0.57,2.2)=2.2 → tiers: 2.2/4.0/6.0 (same as before)
        // At 7R TP:  stage1=2.66R, base=max(1.33,2.2)=2.2 → tiers: 2.2/4.0/6.0 (same)
        // At 42R TP: stage1=16R,   base=max(8.0,2.2)=8.0 → tiers: 8.0/14.4/21.6
        // → For wide TPs, tiers defer to the TP-lock system which handles them from stage 1 onward.
        const apexTpRange = position.takeProfitPrice
            ? Math.abs(position.takeProfitPrice - entryPrice)
            : 0;
        const apexTpInR = apexTpRange > 0 && position.initialRiskInPrice > 0
            ? apexTpRange / position.initialRiskInPrice
            : 5.0;
        const tpStage1R  = apexTpInR * 0.38; // R-value where TP-lock stage 1 activates
        const tierBase   = Math.max(tpStage1R * 0.5, 2.2);
        const tier1R = tierBase;
        const tier2R = tierBase * (4.0 / 2.2);  // preserve original tier ratios
        const tier3R = tierBase * (6.0 / 2.2);

        if (pnlR >= tier3R) {
            const trail = isLong ? currentPrice - atr * tightTrail : currentPrice + atr * tightTrail;
            if ((isLong && trail > position.stopLossPrice) || (!isLong && trail < position.stopLossPrice)) {
                return { newStopLoss: trail, activeStopLossReason: 'Apex Trail (T3)', reasons: [`Apex Ratchet Tier 3 (${pnlR.toFixed(1)}R): Trail ×${tightTrail} ATR`] };
            }
        } else if (pnlR >= tier2R) {
            const trail = isLong ? currentPrice - atr * fastTrail : currentPrice + atr * fastTrail;
            if ((isLong && trail > position.stopLossPrice) || (!isLong && trail < position.stopLossPrice)) {
                return { newStopLoss: trail, activeStopLossReason: 'Apex Trail (T2)', reasons: [`Apex Ratchet Tier 2 (${pnlR.toFixed(1)}R): Trail ×${fastTrail} ATR`] };
            }
        } else if (pnlR >= tier1R) {
            const trail = isLong ? currentPrice - atr * stdTrail : currentPrice + atr * stdTrail;
            if ((isLong && trail > position.stopLossPrice) || (!isLong && trail < position.stopLossPrice)) {
                return { newStopLoss: trail, activeStopLossReason: 'Apex Trail (T1)', reasons: [`Apex Ratchet Tier 1 (${pnlR.toFixed(1)}R): Trail ×${stdTrail} ATR`] };
            }
        }

        return signal;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export const getApexSignal = async (
    config: BotConfig,
    klinesMap: Map<string, Kline[]>,
    btc: BitcoinState,
    openInterestHistory?: OpenInterestKline[],
    lsRatioHistory?: LongShortRatio[],
    timestamp?: number,
    universalModel?: UniversalSignalModel | null,
    fundingRate?: number | null
): Promise<TradeSignal> => {
    const engine = new ApexPrimeEngine(config);
    return await engine.generateSignal(klinesMap, btc, lsRatioHistory, openInterestHistory, timestamp, universalModel, fundingRate);
};
