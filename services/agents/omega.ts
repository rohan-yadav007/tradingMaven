
// services/agents/omega.ts

import { Kline, BotConfig, TradeSignal, AgentParams, OmegaAnalysis, BitcoinState, Position, TradeManagementSignal, OpenInterestKline, LongShortRatio, OmegaIntent, ADXOutput } from '../../types';
import { EMA, ATR, RSI, SMA, ADX } from 'technicalindicators';
import { getLast, detectOrderBlocks, findLiquidityPools, detectFairValueGaps, Supertrend, analyzeOIDynamics, calculateRVOL, detectLiquiditySweep, calculateRsiVelocity, getAtrAdjustedLookback, calculateVROC } from './agentUtils';
import { calculateCVD, detectAbsorption, getVolatilityRegime } from '../indicators';
import { findSwingPoints, analyzeMarketStructure } from '../chartAnalysisService';
import { pairProfileService } from '../pairProfileService';
import { scoreUniversalConditions, UniversalSignalModel } from '../trainingService';
import { getTPProportionalLockSignal } from '../riskManagementService';

// --- OMEGA PRIME ARCHITECTURE (PHASE 5: DYNAMIC PRECISION) ---

class OmegaPrimeEngine {
    private patience: 'Low' | 'Medium' | 'High';
    private intent: OmegaIntent;

    constructor(_config: BotConfig) {
        // Always fully autonomous — no manual overrides.
        // intent and patience are set each tick by determineDynamicState.
        this.patience = 'Medium';
        this.intent = 'Growth';
    }

    private getSessionStatus(timestamp?: number): { isOpen: boolean; sessionName: string; patienceBoost: number } {
        const now = timestamp ? new Date(timestamp) : new Date();
        const h = now.getUTCHours();

        // Crypto-native session windows (UTC):
        // Dead zone:        02:00–06:00 — very low liquidity, wide spreads, avoid
        // Asia:             06:00–12:00 — moderate, BTC/BNB active, alts thin
        // London open:      08:00–10:00 — picking up, decent for BTC
        // US pre-market:    12:00–13:30 — building momentum
        // US core session:  13:30–21:00 — highest volume, best setups
        // US late / close:  21:00–02:00 — declining but OK

        if (h >= 2 && h < 6) return { isOpen: false, sessionName: 'Dead Zone (02-06 UTC)', patienceBoost: 20 };
        if (h >= 13 && h < 21) return { isOpen: true, sessionName: h < 17 ? 'US Open' : 'US Session', patienceBoost: -5 };
        if (h >= 8 && h < 13) return { isOpen: true, sessionName: 'London / EU', patienceBoost: 0 };
        return { isOpen: true, sessionName: 'Asia / Late US', patienceBoost: 5 };
    }

    /**
     * Intent is now derived from Volatility (ATR) and Market Structure directly.
     */
    private determineDynamicState(
        atr: number,
        currentPrice: number,
        structure: 'Uptrend' | 'Downtrend' | 'Ranging' | 'Indeterminate',
        timestamp?: number
    ): { intent: OmegaIntent, patience: 'Low' | 'Medium' | 'High', reasoning: string } {
        const volatilityRegime = getVolatilityRegime(atr, currentPrice);
        let intent: OmegaIntent = 'Growth';

        // 1. Intent Logic
        if (volatilityRegime === 'High') {
            intent = 'Preserve'; // High Vol -> Defensive
        } else if (structure === 'Ranging' || structure === 'Indeterminate') {
            intent = 'Alpha'; // Ranging -> Mean Reversion/Counter-Trend allowed
        } else {
            intent = 'Growth'; // Trending + Normal Vol -> Trend Following
        }

        // 2. Patience Logic
        let patience: 'Low' | 'Medium' | 'High' = 'Medium';
        const session = this.getSessionStatus(timestamp);

        if (!session.isOpen) patience = 'High'; // Dead zone -> A+ setups only
        else if (volatilityRegime === 'Low' && intent === 'Alpha') patience = 'Low'; // Low Vol Range -> Quick scalps
        else if (volatilityRegime === 'High') patience = 'Medium'; // High Vol -> Standard caution

        const reasonStr = `Auto: ${volatilityRegime} Vol, Struct: ${structure}, Session: ${session.sessionName}`;

        return { intent, patience, reasoning: reasonStr };
    }

    private analyzeContext(
        h1Klines: Kline[],
        lsRatioHistory?: LongShortRatio[]
    ): { bias: 'Bullish' | 'Bearish' | 'Neutral', structure: 'Uptrend' | 'Downtrend' | 'Ranging' | 'Indeterminate', lastSignal: string | null, sentimentScore: number, reasons: string[] } {
        const reasons: string[] = [];
        let score = 0;

        const swings = findSwingPoints(h1Klines, 5);
        const structure = analyzeMarketStructure(swings);

        if (structure.structure === 'Uptrend') { score += 3; reasons.push('1H Structure Bullish'); }
        if (structure.structure === 'Downtrend') { score -= 3; reasons.push('1H Structure Bearish'); }

        // ChoCH detection: early reversal signal — adds conviction before structure confirms
        if (structure.lastSignal === 'ChoCH_Bullish') { score += 2; reasons.push('ChoCH Bullish: Downtrend losing strength'); }
        if (structure.lastSignal === 'ChoCH_Bearish') { score -= 2; reasons.push('ChoCH Bearish: Uptrend losing strength'); }

        if (lsRatioHistory && lsRatioHistory.length > 0) {
            const currentLs = lsRatioHistory[lsRatioHistory.length - 1].longShortRatio;
            if (currentLs > 2.5) { score -= 4; reasons.push(`Retail Euphoria (L/S: ${currentLs.toFixed(2)})`); }
            else if (currentLs < 0.6) { score += 4; reasons.push(`Retail Panic (L/S: ${currentLs.toFixed(2)})`); }
            else { reasons.push(`Sentiment Neutral (L/S: ${currentLs.toFixed(2)})`); }
        }

        let bias: 'Bullish' | 'Bearish' | 'Neutral' = 'Neutral';
        if (structure.structure === 'Uptrend') bias = 'Bullish';
        else if (structure.structure === 'Downtrend') bias = 'Bearish';
        // ChoCH gives early directional lean before full structure confirmation
        else if (structure.lastSignal === 'ChoCH_Bullish' && score >= 1) bias = 'Bullish';
        else if (structure.lastSignal === 'ChoCH_Bearish' && score <= -1) bias = 'Bearish';
        else if (score >= 2) bias = 'Bullish';
        else if (score <= -2) bias = 'Bearish';

        return { bias, structure: structure.structure, lastSignal: structure.lastSignal, sentimentScore: score, reasons };
    }

    private calculateSmoothedRejection(klines: Kline[], direction: 'LONG' | 'SHORT', period: number = 3): number {
        const scores = [];
        for (let i = Math.max(0, klines.length - period); i < klines.length; i++) {
            scores.push(this.calculateRejectionScore(klines[i], direction));
        }
        return scores.reduce((a, b) => a + b, 0) / scores.length;
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

    public async generateSignal(
        klinesMap: Map<string, Kline[]>,
        btc: BitcoinState,
        lsRatioHistory?: LongShortRatio[],
        openInterestHistory?: OpenInterestKline[],
        timestamp?: number,
        injectedModel?: UniversalSignalModel | null
    ): Promise<TradeSignal> {
        const h1 = klinesMap.get('1h') || [];
        const m5 = klinesMap.get('5m') || []; 
        
        if (h1.length < 200 || m5.length < 100) return { signal: 'HOLD', reasons: ['Syncing Matrix Data...'] };

        // --- MODEL & STRATEGY (resolved early — needed before RVOL gate) ---
        const universalModel = injectedModel !== undefined ? injectedModel : pairProfileService.getModel();
        const deployStrategy = universalModel?.deployStrategy ?? 'Balanced';

        const currentKline = m5[m5.length-1];
        const currentPrice = currentKline.close;
        
        // Detailed ATR calculation for Volatility Expansion Check
        const atrValues = ATR.calculate({high: m5.map(k=>k.high), low: m5.map(k=>k.low), close: m5.map(k=>k.close), period: 14});
        const currentAtr = getLast(atrValues) || 0;
        const atrSmaPeriod = 20;
        const atrSmaValues = SMA.calculate({period: atrSmaPeriod, values: atrValues});
        const currentAtrSma = getLast(atrSmaValues) || currentAtr;
        const isVolatilityExpanding = currentAtr > currentAtrSma;

        // ADX/DI Calculation for Directional Integrity
        const adxOutput = getLast(ADX.calculate({
            high: m5.map(k=>k.high), 
            low: m5.map(k=>k.low), 
            close: m5.map(k=>k.close), 
            period: 14
        }));

        // 1. Context & Intent
        const context = this.analyzeContext(h1, lsRatioHistory); 

        const dynamic = this.determineDynamicState(currentAtr, currentPrice, context.structure, timestamp);
        this.intent = dynamic.intent;
        this.patience = dynamic.patience;
        const autoStateDescription = dynamic.reasoning;

        const sessionInfo = this.getSessionStatus(timestamp);

        // --- VOLATILITY-ADJUSTED LOOKBACKS ---
        const lookback = getAtrAdjustedLookback(currentAtr, currentPrice, 50);

        // Critical Fix: if the current kline is still forming (isFinal=false), use previous
        // closed candle for RVOL to prevent JIT mid-candle calls from always failing the veto.
        const rvolKlines = (!currentKline.isFinal && m5.length > 1) ? m5.slice(-lookback) : m5.slice(-lookback);
        const rvol = calculateRVOL(rvolKlines, 20);

        // --- GATE 1: RVOL & CHURN CHECKS ---
        const minRvol = this.intent === 'Alpha' ? 0.5 : 0.8;
        if (rvol < minRvol) {
            return {
                signal: 'HOLD',
                reasons: [`⛔ VETO: Low Volatility (RVOL ${rvol.toFixed(2)} < ${minRvol})`, autoStateDescription]
            };
        }

        // Churn Veto: High Volume (>3x) with Small Body (<30% range) = Indecision/Absorption
        const candleRange = currentKline.high - currentKline.low;
        const candleBody = Math.abs(currentKline.close - currentKline.open);
        if (rvol > 3.0 && candleRange > 0 && (candleBody / candleRange) < 0.3) {
             return {
                signal: 'HOLD',
                reasons: [`⛔ VETO: High Volume Churn detected (RVOL ${rvol.toFixed(1)}x with Doji/Small Body). Waiting for clarity.`]
            };
        }

        // 2. Indicators
        const cvd = calculateCVD(m5);
        const absorption = detectAbsorption(m5, cvd, 20);
        const obs = detectOrderBlocks(h1, 50);
        const oiAnalysis = analyzeOIDynamics(m5, openInterestHistory);
        const fvgs = detectFairValueGaps(m5, 30);

        const stValues = Supertrend.calculate({ high: m5.map(k => k.high), low: m5.map(k => k.low), close: m5.map(k => k.close), period: 10, multiplier: 3 });
        const lastSt = getLast(stValues);
        const stTrend = lastSt && currentPrice > lastSt ? 'Bullish' : 'Bearish';

        const closes = m5.map(k=>k.close);
        const rsiValues = RSI.calculate({ period: 14, values: closes });
        const lastRsi = getLast(rsiValues) || 50;
        const rsiVel = calculateRsiVelocity(rsiValues);
        const sweep = detectLiquiditySweep(m5, 50);

        // --- RSI DIVERGENCE DETECTION (pivot-based, 40-candle lookback) ---
        // Requires two confirmed swing pivots: price makes LL while RSI makes HL (bullish), or HH with LH (bearish).
        // Uses findSwingPoints(3-candle fractal) to avoid false divergence on noisy/ranging markets.
        let rsiDivBullish = false;
        let rsiDivBearish = false;
        if (rsiValues.length >= 40) {
            const divWindow = m5.slice(-40);
            const divSwings = findSwingPoints(divWindow, 3);
            // rsiOffset: index into rsiValues corresponding to divWindow[0]
            const rsiOffset = rsiValues.length - 40;

            const swingLows = divSwings.filter(s => s.type === 'low');
            if (swingLows.length >= 2) {
                const sl1 = swingLows[swingLows.length - 2];
                const sl2 = swingLows[swingLows.length - 1];
                const r1 = rsiOffset + sl1.index;
                const r2 = rsiOffset + sl2.index;
                if (r1 >= 0 && r2 > r1 && r2 < rsiValues.length) {
                    // Price made lower low, RSI made higher low → hidden bullish strength
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
                    // Price made higher high, RSI made lower high → hidden bearish weakness
                    if (sh2.price > sh1.price && rsiValues[r2] < rsiValues[r1] - 3) rsiDivBearish = true;
                }
            }
        }

        // --- MULTI-TIMEFRAME CONFLUENCE ---
        const h1Obs = detectOrderBlocks(h1, 50);
        const h1Fvgs = detectFairValueGaps(h1, 50);
        
        const isAnchored = (price: number): boolean => {
            const ob = h1Obs.find(ob => Math.abs(price - ob.top) < currentAtr * 1.5 || Math.abs(price - ob.bottom) < currentAtr * 1.5);
            const fvg = h1Fvgs.find(fvg => Math.abs(price - fvg.top) < currentAtr * 1.5 || Math.abs(price - fvg.bottom) < currentAtr * 1.5);
            return !!ob || !!fvg;
        }

        // --- CVD DIVERGENCE (25-candle lookback) ---
        // Bullish: price falling but CVD rising → smart money absorption over meaningful swing
        // Bearish: price rising but CVD falling → smart money distribution over meaningful swing
        // 25 candles (~125 min) avoids 10-candle noise from normal intrabar retracements.
        let cvdDivBullish = false;
        let cvdDivBearish = false;
        if (cvd.length >= 25 && m5.length >= 25) {
            const cvdSlice   = cvd.slice(-25);
            const pSlice25   = m5.slice(-25);
            const priceDelta = pSlice25[pSlice25.length - 1].close - pSlice25[0].close;
            const cvdDelta   = cvdSlice[cvdSlice.length - 1] - cvdSlice[0];
            if (priceDelta < 0 && cvdDelta > 0) {
                if (isAnchored(currentPrice)) cvdDivBullish = true;
            }
            if (priceDelta > 0 && cvdDelta < 0) {
                if (isAnchored(currentPrice)) cvdDivBearish = true;
            }
        }

        // Precompute swept extreme levels for structural stop placement (matches 50-candle detection lookback)
        const sweepWindow = m5.slice(-51, -1);
        const sweepedLow  = sweepWindow.length > 0 ? Math.min(...sweepWindow.map(k => k.low))  : currentPrice;
        const sweepedHigh = sweepWindow.length > 0 ? Math.max(...sweepWindow.map(k => k.high)) : currentPrice;

        let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let setupType = 'None';

        // --- MODE WEIGHTING (The Soul of the Bot) ---
        let weights = { s: 0.4, m: 0.3, c: 0.3 };
        if (this.intent === 'Growth')   weights = { s: 0.35, m: 0.4, c: 0.25 };
        if (this.intent === 'Alpha')    weights = { s: 0.2, m: 0.6, c: 0.2 };
        if (this.intent === 'Preserve') weights = { s: 0.6, m: 0.2, c: 0.2 };

        // 3. Triggers — OB requires close INSIDE the zone (not just a wick graze) AND rejection confirmation
        // Tolerance is ATR-relative so high-volatility pairs don't miss triggers with tight fixed %-bands
        const obTol = currentAtr * 0.3;
        const bullOB = obs.find(ob =>
            ob.type === 'Bullish' &&
            currentKline.low <= ob.top &&
            currentKline.close >= ob.bottom &&
            currentKline.close <= ob.top + obTol &&
            currentKline.close > currentKline.open
        );
        const bearOB = obs.find(ob =>
            ob.type === 'Bearish' &&
            currentKline.high >= ob.bottom &&
            currentKline.close <= ob.top &&
            currentKline.close >= ob.bottom - obTol &&
            currentKline.close < currentKline.open
        );

        // --- FVG ENTRY TRIGGER DETECTION ---
        // Price entering an unfilled FVG with a matching confirmation candle.
        // Score = 45 base + freshness bonus (newer FVG = more relevant)
        const bullFVG = fvgs
            .filter(f => f.type === 'FVG Bullish' && currentPrice >= f.bottom && currentPrice <= f.top && currentKline.close > currentKline.open)
            .sort((a, b) => b.index - a.index)[0]; // prefer most recent
        const bearFVG = fvgs
            .filter(f => f.type === 'FVG Bearish' && currentPrice >= f.bottom && currentPrice <= f.top && currentKline.close < currentKline.open)
            .sort((a, b) => b.index - a.index)[0];

        const bullFVGScore = bullFVG ? Math.min(65, 45 + Math.max(0, 20 - (m5.length - bullFVG.index))) : 0;
        const bearFVGScore = bearFVG ? Math.min(65, 45 + Math.max(0, 20 - (m5.length - bearFVG.index))) : 0;

        // --- CONFLICT RESOLUTION (Priority: Sweep > OB > FVG) ---
        const hasBullSweep = sweep.bullish;
        const hasBearSweep = sweep.bearish;
        const hasBullOB = !!bullOB;
        const hasBearOB = !!bearOB;
        const hasBullFVG = !!bullFVG;
        const hasBearFVG = !!bearFVG;

        // --- DYNAMIC SETUP PRIORITY ---
        const priority = {
            Sweep: this.intent === 'Alpha' ? 3 : 1,
            OB: this.intent === 'Growth' ? 3 : 2,
            FVG: this.intent === 'Growth' ? 2 : 1
        };

        let isBullTrigger = false;
        let isBearTrigger = false;

        const bullScore = (hasBullSweep ? priority.Sweep * 100 : 0) + (hasBullOB ? priority.OB * 50 : 0) + (hasBullFVG ? priority.FVG * 25 : 0);
        const bearScore = (hasBearSweep ? priority.Sweep * 100 : 0) + (hasBearOB ? priority.OB * 50 : 0) + (hasBearFVG ? priority.FVG * 25 : 0);

        if (bullScore > bearScore) isBullTrigger = true;
        else if (bearScore > bullScore) isBearTrigger = true;
        else if (bullScore === bearScore && bullScore > 0) {
            // Tie-break with bias
            if (context.bias === 'Bullish') isBullTrigger = true;
            else if (context.bias === 'Bearish') isBearTrigger = true;
        }

        // Apply Confluence Veto
        if (isBullTrigger && !isAnchored(currentPrice)) {
             isBullTrigger = false;
             context.reasons.push('⛔ VETO: M5 Bullish setup lacks H1 Confluence.');
        }
        if (isBearTrigger && !isAnchored(currentPrice)) {
             isBearTrigger = false;
             context.reasons.push('⛔ VETO: M5 Bearish setup lacks H1 Confluence.');
        }

        // --- GLOBAL SCORING LOGIC ---
        const scoreDirection: 'LONG' | 'SHORT' = isBullTrigger ? 'LONG' : (isBearTrigger ? 'SHORT' : (stTrend === 'Bullish' ? 'LONG' : 'SHORT'));

        // --- HARD GATES (applied to secondary setup types) ---
        const checkHardGates = (direction: 'LONG' | 'SHORT'): { allowed: boolean, reason?: string, penalty?: number } => {
            // RSI Exhaustion — Convert to dynamic penalty
            let penalty = 0;
            if (direction === 'LONG' && lastRsi > 72) {
                penalty = Math.min((lastRsi - 72) * 2, 40);
                context.reasons.push(`⚠️ RSI Penalty: ${penalty}`);
            } else if (direction === 'SHORT' && lastRsi < 28) {
                penalty = Math.min((28 - lastRsi) * 2, 40);
                context.reasons.push(`⚠️ RSI Penalty: ${penalty}`);
            }
            
            // HTF Gravity Lock (Keep as hard gate)
            if (direction === 'LONG' && context.structure === 'Downtrend' && this.intent !== 'Alpha') return { allowed: false, reason: `⛔ VETO: Hard Lock against 1H Downtrend.` };
            if (direction === 'SHORT' && context.structure === 'Uptrend' && this.intent !== 'Alpha') return { allowed: false, reason: `⛔ VETO: Hard Lock against 1H Uptrend.` };
            
            // DI Alignment (Keep as hard gate)
            if (adxOutput) {
                if (direction === 'LONG' && adxOutput.mdi > adxOutput.pdi) return { allowed: false, reason: `⛔ VETO: Bearish DI Dominance.` };
                if (direction === 'SHORT' && adxOutput.pdi > adxOutput.mdi) return { allowed: false, reason: `⛔ VETO: Bullish DI Dominance.` };
            }
            return { allowed: true, penalty };
        };

        // --- M5 BREAK OF STRUCTURE DETECTION ---
        // Requires: close above/below 20-candle swing extreme + RVOL + DI alignment
        const detectM5BOS = (direction: 'LONG' | 'SHORT'): boolean => {
            const window = m5.slice(-22, -1); // 21 candles prior to current
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

        // --- H1 BREAK OF STRUCTURE DETECTION (premium setup, scores higher than M5 BOS) ---
        // Fires when the last closed H1 candle broke above/below the 20-candle H1 swing extreme.
        // Fresh within 1 H1 candle of the break only to avoid trading stale BOS signals.
        const detectH1BOS = (direction: 'LONG' | 'SHORT'): boolean => {
            if (h1.length < 25) return false;
            const closed = h1.filter(k => k.isFinal !== false); // use only confirmed candles
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
                    // Sweeps are counter-local-trend entries — exempt from DI/H1-structure gates (which would always reject them),
                    // but block RSI exhaustion: a bullish sweep when RSI is already overbought is not a reversal.
                    if (lastRsi > 72) {
                        context.reasons.push(`⛔ VETO: RSI Exhaustion (${lastRsi.toFixed(1)} > 72) — bullish sweep rejected.`);
                    } else {
                        structScore = sweep.score;
                        setupType = 'Liquidity Sweep';
                    }
                } else {
                    // OB and FVG must pass the same hard gates as BOS — HTF lock, DI dominance
                    const gate = checkHardGates('LONG');
                    if (!gate.allowed) {
                        context.reasons.push(gate.reason!);
                    } else {
                        if (gate.penalty) structScore -= gate.penalty;
                        if (hasBullOB && bullOB) {
                            structScore = bullOB.score;
                            setupType = 'Order Block Reclaim';
                        } else if (hasBullFVG) {
                            structScore = bullFVGScore;
                            setupType = 'FVG Entry';
                        }
                    }
                }
            } else {
                // Fallback: H1 BOS (premium) → M5 BOS
                const gate = checkHardGates('LONG');
                if (!gate.allowed) {
                    context.reasons.push(gate.reason!);
                } else if (stTrend === 'Bullish' && detectH1BOS('LONG')) {
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
                    // Block RSI exhaustion: a bearish sweep when RSI is already oversold is not a reversal.
                    if (lastRsi < 28) {
                        context.reasons.push(`⛔ VETO: RSI Exhaustion (${lastRsi.toFixed(1)} < 28) — bearish sweep rejected.`);
                    } else {
                        structScore = sweep.score;
                        setupType = 'Liquidity Sweep';
                    }
                } else {
                    const gate = checkHardGates('SHORT');
                    if (!gate.allowed) {
                        context.reasons.push(gate.reason!);
                    } else {
                        if (gate.penalty) structScore -= gate.penalty;
                        if (hasBearOB && bearOB) {
                            structScore = bearOB.score;
                            setupType = 'Order Block Reclaim';
                        } else if (hasBearFVG) {
                            structScore = bearFVGScore;
                            setupType = 'FVG Entry';
                        }
                    }
                }
            } else {
                // Fallback: H1 BOS (premium) → M5 BOS
                const gate = checkHardGates('SHORT');
                if (!gate.allowed) {
                    context.reasons.push(gate.reason!);
                } else {
                    if (gate.penalty) structScore -= gate.penalty;
                    if (stTrend === 'Bearish' && detectH1BOS('SHORT')) {
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
        }

        // --- VOLUME CONFIRMATION GATE (all setups) ---
        // Sweeps already require RVOL >= 2.0 internally, so this gate won't affect them in practice.
        // Use last CLOSED candle for volume — forming candles accumulate volume mid-bar and show near-zero
        // on fresh opens, producing misleading "0.00× SMA" readings.
        if (structScore > 0) {
            const volSma20 = SMA.calculate({ period: 20, values: m5.map(k => k.volume ?? 0) });
            const lastVolSma = getLast(volSma20) || 0;
            const volGateKline = (!currentKline.isFinal && m5.length > 1) ? m5[m5.length - 2] : currentKline;
            const lastVol = volGateKline.volume ?? 0;
            if (lastVolSma > 0 && lastVol < lastVolSma * 1.2) {
                structScore = Math.round(structScore * 0.8);
                context.reasons.push(`⚠️ Vol Gate: Low volume (${(lastVol / lastVolSma).toFixed(2)}× SMA) — structScore reduced 20%`);
            }
        }

        // --- DEAD ZONE ADAPTATION ---
        // If ATR is high enough during the "Dead Zone," allow trading.
        if (!sessionInfo.isOpen && structScore > 0) {
            if (currentAtr < 5) { // Low volatility
                context.reasons.push(`⛔ Dead Zone (02–06 UTC): ${setupType} blocked — no entries in thin liquidity.`);
                structScore = 0;
            } else {
                context.reasons.push(`⚠️ Dead Zone (02–06 UTC): High volatility detected, allowing trade.`);
            }
        }

        // 5. Momentum Score (Clamped)
        let momScore = 0;
        const rejection = this.calculateSmoothedRejection(m5.slice(-3), scoreDirection);
        momScore += Math.min(rejection * 130, 60); 
        
        // Add VROC to momentum score
        const vroc = calculateVROC(m5.map(k => k.volume ?? 0), 5);
        momScore += Math.min(vroc * 50, 20);
        
        if (scoreDirection === 'LONG') {
            if (rsiVel > 0.5) momScore += Math.min(rsiVel * 10, 50);
            else if (rsiVel < -1.0) momScore -= 20; 
        } else {
            if (rsiVel < -0.5) momScore += Math.min(Math.abs(rsiVel) * 10, 50);
            else if (rsiVel > 1.0) momScore -= 20;
        }
        momScore = Math.max(0, Math.min(100, momScore));

        // --- 4H MULTI-TIMEFRAME ALIGNMENT ---
        // 4H structure confirmation: aligned adds to ctxScore, conflicted subtracts
        const h4 = klinesMap.get('4h') || [];
        let htfAlignment: 'Aligned' | 'Conflicted' | 'Neutral' = 'Neutral';
        if (h4.length >= 50) {
            const h4Context = this.analyzeContext(h4);
            if ((scoreDirection === 'LONG' && h4Context.bias === 'Bullish') ||
                (scoreDirection === 'SHORT' && h4Context.bias === 'Bearish')) {
                htfAlignment = 'Aligned';
            } else if ((scoreDirection === 'LONG' && h4Context.bias === 'Bearish') ||
                       (scoreDirection === 'SHORT' && h4Context.bias === 'Bullish')) {
                htfAlignment = 'Conflicted';
                if (this.intent !== 'Alpha') context.reasons.push(`⚠️ 4H Conflict: ${h4Context.bias} structure opposes trade.`);
            }
        }

        // 6. Context Score
        let ctxScore = 0;
        if (scoreDirection === 'LONG') {
            if (btc.trend === 'bullish') ctxScore += 30;
            if (oiAnalysis.state === 'Long Buildup') ctxScore += Math.min(oiAnalysis.intensity, 40);
            if (context.sentimentScore >= 0) ctxScore += 20;
            // Opposing OI penalty: smart money building shorts while we go long
            if (oiAnalysis.state === 'Short Buildup') ctxScore -= Math.round(Math.min(oiAnalysis.intensity * 0.4, 15));
            if (oiAnalysis.state === 'Long Liquidation') ctxScore -= 10;
        } else {
            if (btc.trend === 'bearish') ctxScore += 30;
            if (oiAnalysis.state === 'Short Buildup') ctxScore += Math.min(oiAnalysis.intensity, 40);
            if (context.sentimentScore <= 0) ctxScore += 20;
            // Opposing OI penalty: smart money building longs while we go short
            if (oiAnalysis.state === 'Long Buildup') ctxScore -= Math.round(Math.min(oiAnalysis.intensity * 0.4, 15));
            if (oiAnalysis.state === 'Short Covering') ctxScore -= 10;
        }
        if (isVolatilityExpanding) ctxScore += 10;

        // RSI Divergence → structural hidden strength / weakness
        if (scoreDirection === 'LONG'  && rsiDivBullish) { ctxScore += 15; context.reasons.push('📊 Bullish RSI Divergence (+15)'); }
        if (scoreDirection === 'SHORT' && rsiDivBearish) { ctxScore += 15; context.reasons.push('📊 Bearish RSI Divergence (+15)'); }

        // CVD Divergence → smart money absorption / distribution
        if (scoreDirection === 'LONG'  && cvdDivBullish) { ctxScore += 10; context.reasons.push('📈 CVD Absorption: Smart money buying (+10)'); }
        if (scoreDirection === 'SHORT' && cvdDivBearish) { ctxScore += 10; context.reasons.push('📉 CVD Distribution: Smart money selling (+10)'); }

        // 4H alignment bonus/penalty to context score
        // Alpha mode gets a reduced penalty (not exempt) — counter-trend is allowed but HTF conflict still matters
        if (htfAlignment === 'Aligned') ctxScore += 15;
        else if (htfAlignment === 'Conflicted') {
            ctxScore -= this.intent === 'Alpha' ? 10 : 20;
            // In Alpha mode, only Liquidity Sweeps are permitted against a conflicted 4H — OB/BOS require HTF agreement
            if (this.intent === 'Alpha' && structScore > 0 && setupType !== 'Liquidity Sweep') {
                context.reasons.push(`⛔ VETO: 4H Conflict blocks ${setupType} in Alpha mode. Only Liquidity Sweeps allowed counter-HTF.`);
                structScore = 0; // nullify the setup — sweep is the only valid counter-HTF entry
            }
        }

        // --- DAILY STRUCTURE ALIGNMENT ---
        // 1D bias as the macro anchor: aligned = +15 triple confluence, conflicted = -10 macro headwind
        const d1 = klinesMap.get('1d') || [];
        if (d1.length >= 30) {
            const d1Context = this.analyzeContext(d1);
            if ((scoreDirection === 'LONG' && d1Context.bias === 'Bullish') ||
                (scoreDirection === 'SHORT' && d1Context.bias === 'Bearish')) {
                ctxScore += 15;
                context.reasons.push(`📅 Daily Aligned: macro ${d1Context.bias} (+15)`);
            } else if ((scoreDirection === 'LONG' && d1Context.bias === 'Bearish') ||
                       (scoreDirection === 'SHORT' && d1Context.bias === 'Bullish')) {
                ctxScore -= 10;
                context.reasons.push(`📅 Daily Conflict: macro ${d1Context.bias} opposes trade (-10)`);
            }
        }

        ctxScore = Math.min(ctxScore, 80);

        // --- FINAL CONFIDENCE ---
        const finalConfidenceRaw = (structScore * weights.s) + (momScore * weights.m) + (ctxScore * weights.c);
        // Hard cap at 78% when 4H is Conflicted — prevents momentum alone from overriding HTF structure
        const conflictCap = htfAlignment === 'Conflicted' ? 78 : 100;
        const finalConfidence = Math.max(0, Math.min(conflictCap, finalConfidenceRaw));

        // --- UNIVERSAL MODEL ALIGNMENT ---
        // universalModel resolved at function top (line 142) — available here
        let universalDelta = 0;
        let modelHourWinRate = 0;
        let perfectBonus = 0;
        let uActiveCount = 0;

        if (universalModel && structScore > 0) {
            const uSignal = scoreDirection === 'LONG' ? 'BUY' : 'SELL';
            const uScore = scoreUniversalConditions(m5, uSignal, universalModel);
            universalDelta = uScore.delta;
            uActiveCount = uScore.activeConditions.length;

            // Perfect-alignment bonus: if 2+ of the top-ranked "best" conditions are active → +6/+9
            const bestConditions = scoreDirection === 'LONG' ? universalModel.bestLong : universalModel.bestShort;
            const activeSet = new Set(uScore.activeConditions);
            const topMatchCount = bestConditions.slice(0, 3).filter(c => activeSet.has(c.name)).length;
            if (topMatchCount >= 2) {
                perfectBonus = topMatchCount * 3; // +6 for 2, +9 for 3
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
        // Setup-aware model delta: apply different rules per setup type.
        // Liquidity Sweep: model can only VETO (negative delta), never BOOST. It has its own
        //   independent quality filters (RVOL≥2, wick≥40%, 50-candle structural level) — a positive
        //   model delta should not push marginal sweeps over the conviction threshold.
        // H1 Structure BOS: already passes strong structural gates. Only veto on clear opposition
        //   (delta ≤ -10); small negatives (-3 to -8) are pattern noise, not real disqualifiers.
        let effectiveDelta = universalDelta;
        let effectivePerfectBonus = perfectBonus;
        if (setupType === 'Liquidity Sweep') {
            effectiveDelta = Math.min(0, effectiveDelta);
            effectivePerfectBonus = 0;
        } else if (setupType === 'H1 Structure BOS' && effectiveDelta > -10) {
            effectiveDelta = Math.max(0, effectiveDelta); // ignore mild negatives for premium structural setup
        }

        const adjustedConfidence = Math.max(0, Math.min(100, finalConfidence + effectiveDelta + effectivePerfectBonus));

        // Model pillar only included when the model actually evaluated conditions (structScore > 0)
        // When structScore = 0 (no trigger), delta is always 0 — showing 50 as "neutral" is misleading
        const modelRan = !!(universalModel && structScore > 0);
        const scoreBreakdown = modelRan
            ? { structure: structScore, momentum: momScore, context: ctxScore, model: effectiveDelta + effectivePerfectBonus }
            : { structure: structScore, momentum: momScore, context: ctxScore };

        // --- THRESHOLD RE-CALIBRATION ---
        let threshold = 55; // Base: Medium
        if (this.patience === 'High') threshold = 70;
        if (this.patience === 'Low') threshold = 45;
        if (this.intent === 'Preserve') threshold += 5;
        if (this.intent === 'Alpha') threshold -= 5;
        // Session-based threshold adjustment (crypto-native)
        threshold = Math.min(80, Math.max(40, threshold + sessionInfo.patienceBoost));

        // deployStrategy modifier — trained model's intended trading style shifts the threshold.
        // Liquidity Sweep is exempt from threshold REDUCTIONS — it qualifies independently via
        // RVOL/wick/structural criteria. An "Aggressive" strategy should not lower the bar for sweeps.
        if (universalModel?.deployStrategy) {
            const stratAdj: Record<string, number> = {
                TrendRiding:   -5,   // more aggressive: ride confirmed trends
                MeanReversion: +5,   // more selective: only take high-confidence reversals
                Conservative:  +12,  // very selective: capital preservation first
                Aggressive:    -10,  // very aggressive: take early entries
                Balanced:       0,   // no change
            };
            let adj = stratAdj[deployStrategy] ?? 0;
            if (setupType === 'Liquidity Sweep' && adj < 0) adj = 0; // no threshold lowering for sweeps
            if (adj !== 0) {
                threshold = Math.min(80, Math.max(40, threshold + adj));
                context.reasons.push(`🎯 Strategy [${deployStrategy}]: threshold ${adj > 0 ? '+' : ''}${adj} → ${threshold}%`);
            }
        }

        // Hourly model consensus filter: use historical win-rate data for this UTC hour
        if (universalModel) {
            const currentHour = new Date(timestamp ?? Date.now()).getUTCHours();
            modelHourWinRate = universalModel.consensusHourlyWinRate[currentHour] ?? 0;
            if (modelHourWinRate > 0) {
                if (modelHourWinRate < 40) { threshold = Math.min(80, threshold + 8); context.reasons.push(`🕒 Weak hour ${currentHour}:00 UTC (${modelHourWinRate}% win rate) — threshold raised`); }
                else if (modelHourWinRate >= 65) { threshold = Math.max(40, threshold - 5); context.reasons.push(`🕒 Strong hour ${currentHour}:00 UTC (${modelHourWinRate}% win rate) — threshold eased`); }
            }
        }

        // --- HARD GATE & EXECUTION ---
        if (structScore > 0) {
            if (scoreDirection === 'LONG') {
                const isCounterTrend = stTrend === 'Bearish';
                if (this.intent === 'Preserve' && isCounterTrend) {
                    context.reasons.push('⛔ VETO: Preserve Mode blocks counter-trend.');
                } else {
                    const isStrongRejection = rejection > 0.10;
                    const isImpulse = currentKline.close > currentKline.open &&
                                      (currentKline.close - currentKline.open) > (currentKline.high - currentKline.low) * 0.5 &&
                                      rvol > 1.3;
                    const highConvictionOverride = adjustedConfidence >= (threshold + 7);

                    if (adjustedConfidence >= threshold && (isStrongRejection || isImpulse || highConvictionOverride)) {
                        signal = 'BUY';
                    } else if (adjustedConfidence < threshold) {
                        context.reasons.push(`⚠️ Confidence ${adjustedConfidence.toFixed(0)} < Threshold ${threshold}`);
                    } else {
                        context.reasons.push(`⚠️ Setup valid (${adjustedConfidence.toFixed(0)}%) but no entry confirmation (no rejection/impulse/high-conviction override).`);
                    }
                }
            } else if (scoreDirection === 'SHORT') {
                const isCounterTrend = stTrend === 'Bullish';
                if (this.intent === 'Preserve' && isCounterTrend) {
                    context.reasons.push('⛔ VETO: Preserve Mode blocks counter-trend.');
                } else {
                    const isStrongRejection = rejection > 0.10;
                    const isImpulse = currentKline.close < currentKline.open &&
                                      (currentKline.open - currentKline.close) > (currentKline.high - currentKline.low) * 0.5 &&
                                      rvol > 1.3;
                    const highConvictionOverride = adjustedConfidence >= (threshold + 7);

                    if (adjustedConfidence >= threshold && (isStrongRejection || isImpulse || highConvictionOverride)) {
                        signal = 'SELL';
                    } else if (adjustedConfidence < threshold) {
                        context.reasons.push(`⚠️ Confidence ${adjustedConfidence.toFixed(0)} < Threshold ${threshold}`);
                    } else {
                        context.reasons.push(`⚠️ Setup valid (${adjustedConfidence.toFixed(0)}%) but no entry confirmation (no rejection/impulse/high-conviction override).`);
                    }
                }
            }
        }

        // --- BTC REGIME HARD GATE ---
        // Extreme BTC states override individual pair signals — no longs in a crash, no shorts in a parabolic pump.
        if (signal === 'BUY' && (btc.state === 'CRASH' || (btc.state === 'TREND_DOWN' && btc.momentum === 'accelerating'))) {
            signal = 'HOLD';
            context.reasons.push(`⛔ BTC Regime Block: ${btc.state} / ${btc.momentum} — no longs until BTC stabilizes.`);
        }
        if (signal === 'SELL' && (btc.state === 'PUMP' || (btc.state === 'TREND_UP' && btc.momentum === 'accelerating'))) {
            signal = 'HOLD';
            context.reasons.push(`⛔ BTC Regime Block: ${btc.state} / ${btc.momentum} — no shorts against parabolic BTC.`);
        }

        // --- NUANCED OI VETO ---
        // Liquidity Sweep setups are EXEMPT: sweeps naturally occur alongside short covering / long liquidation.
        // Apply OI veto to OB and BOS trades where the move may be unsustainable forced-exit noise.
        if (setupType !== 'Liquidity Sweep') {
            if (signal === 'BUY' && oiAnalysis.state === 'Short Covering' && oiAnalysis.intensity > 55) {
                signal = 'HOLD';
                context.reasons.push(`⚠️ VETO: Pure Short Squeeze (${oiAnalysis.intensity.toFixed(0)}% intensity) — no genuine long buildup.`);
            }
            if (signal === 'SELL' && oiAnalysis.state === 'Long Liquidation' && oiAnalysis.intensity > 55) {
                signal = 'HOLD';
                context.reasons.push(`⚠️ VETO: Cascade Long Liquidation (${oiAnalysis.intensity.toFixed(0)}% intensity) — avoid knife-catch short.`);
            }
        }

        // --- Output ---
        const baseReasons = [
            ...context.reasons, 
            autoStateDescription, 
            `Patience: ${this.patience} (Req: ${threshold}%)`, 
            `ST: ${stTrend}`, 
            `OI: ${oiAnalysis.state} (${oiAnalysis.intensity.toFixed(0)}%)`
        ];

        let poiDistDisplay = 'Scanning';
        let poiPrice = 0;
        let poiType: 'Order Block' | 'Liquidity Sweep' | 'FVG Entry' | 'None' = 'None';

        const relevantOBs = obs.filter(ob => {
             if ((this.intent === 'Preserve' || this.intent === 'Growth') && context.bias === 'Bullish') return ob.type === 'Bullish';
             if ((this.intent === 'Preserve' || this.intent === 'Growth') && context.bias === 'Bearish') return ob.type === 'Bearish';
             return true; 
        });
        
        if (relevantOBs.length > 0) {
             const sorted = relevantOBs.map(ob => {
                 const mid = (ob.top + ob.bottom) / 2;
                 const dist = Math.abs(currentPrice - mid);
                 const isInside = currentPrice >= ob.bottom && currentPrice <= ob.top;
                 return { ob, dist, isInside, mid };
             }).sort((a,b) => a.dist - b.dist);
             
             const nearest = sorted[0];
             poiPrice = nearest.mid;
             
             if (nearest.isInside) {
                 poiDistDisplay = 'Inside Zone';
                 poiType = 'Order Block';
             } else if (nearest.dist < currentAtr * 5) {
                 poiDistDisplay = 'Approaching';
                 poiType = 'Order Block';
             } else {
                 poiDistDisplay = 'Zone Found (Far)';
                 poiType = 'None';
             }
        } else {
            poiDistDisplay = 'No Levels';
        }

        let triggerCondDisplay = 'Quiet';
        if (absorption === 'Bullish') triggerCondDisplay = 'Bullish Flow';
        else if (absorption === 'Bearish') triggerCondDisplay = 'Bearish Flow';
        else if (rvol > 1.2) triggerCondDisplay = 'Volatile';
        else triggerCondDisplay = 'Consolidating';
        
        const commonAnalysis: OmegaAnalysis = {
            conviction: adjustedConfidence,
            intent: this.intent,
            marketState: { bias1H: context.bias, structure: context.structure as any },
            sentiment: {
                lsRatio: lsRatioHistory?.[lsRatioHistory.length-1]?.longShortRatio || 0,
                cvdState: absorption === 'None' ? 'Neutral' : absorption === 'Bullish' ? 'Absorption' : 'Distribution',
                fundingRate: '0%',
                oiState: oiAnalysis.state
            },
            poiStatus: { type: setupType === 'FVG Entry' ? 'FVG Entry' : setupType.includes('Order Block') ? 'Order Block' : (setupType.includes('Liquidity') ? 'Liquidity Sweep' : poiType), distance: poiDistDisplay, priceLevel: poiPrice },
            triggerStatus: { ready: signal !== 'HOLD', condition: triggerCondDisplay },
            targets: { entry: currentPrice, stopLoss: 0, takeProfit: 0 },
            sizing: { multiplier: 1.0 },
            sessionAnalysis: sessionInfo.sessionName,
            htfAlignment,
            scoreBreakdown,
            modelScore: modelRan ? { delta: universalDelta + perfectBonus, activeCount: uActiveCount, hourWinRate: modelHourWinRate, perfectBonus } : undefined,
        };

        if (signal !== 'HOLD') {
            const isBuy = signal === 'BUY';
            const buffer = currentAtr * 0.2;

            // --- STRUCTURAL STOP LOSS ---
            // Placed at the invalidation level of the triggering setup, not a flat ATR distance.
            let stopLoss: number;
            if (setupType === 'Liquidity Sweep') {
                // Stop beyond the swept extreme — if longs sweep SSL then reverse, stop is below the wick
                stopLoss = isBuy
                    ? sweepedLow - buffer
                    : sweepedHigh + buffer;
            } else if (setupType === 'Order Block Reclaim' && isBuy && bullOB) {
                // Stop below the OB zone — if price closes below it, the OB is invalidated
                stopLoss = bullOB.bottom - buffer;
            } else if (setupType === 'Order Block Reclaim' && !isBuy && bearOB) {
                // Stop above the OB zone
                stopLoss = bearOB.top + buffer;
            } else if (setupType === 'FVG Entry' && isBuy && bullFVG) {
                // Stop just below the FVG bottom — FVG entry is invalidated on any close below the gap
                stopLoss = bullFVG.bottom - buffer;
                const minDist = currentAtr * 1.0;
                if (currentPrice - stopLoss < minDist) stopLoss = currentPrice - minDist;
            } else if (setupType === 'FVG Entry' && !isBuy && bearFVG) {
                // Stop just above the FVG top
                stopLoss = bearFVG.top + buffer;
                const minDist = currentAtr * 1.0;
                if (stopLoss - currentPrice < minDist) stopLoss = currentPrice + minDist;
            } else {
                // Structure BOS (M5 or H1) — stop at the last confirmed swing low (long) / swing high (short)
                // For H1 BOS: use H1 swing pivots. For M5 BOS: use M5 swing pivots.
                // This is the true structural invalidation level — the HL (for longs) or LH (for shorts)
                // that confirmed the trend before the BOS. If price returns there, the BOS is failed.
                const bosKlines = setupType === 'H1 Structure BOS' ? h1.slice(-40) : m5.slice(-40);
                const bosSwings = findSwingPoints(bosKlines, 3);
                if (isBuy) {
                    const lastSwingLow = bosSwings.filter(s => s.type === 'low').pop();
                    stopLoss = lastSwingLow ? lastSwingLow.price - buffer : currentPrice - currentAtr * 2.0;
                } else {
                    const lastSwingHigh = bosSwings.filter(s => s.type === 'high').pop();
                    stopLoss = lastSwingHigh ? lastSwingHigh.price + buffer : currentPrice + currentAtr * 2.0;
                }
                // Minimum distance: 1.2 ATR — BOS SL is usually near, so tighter floor than other setups
                const minDist = currentAtr * 1.2;
                if (isBuy && currentPrice - stopLoss < minDist) stopLoss = currentPrice - minDist;
                if (!isBuy && stopLoss - currentPrice < minDist) stopLoss = currentPrice + minDist;
            }

            const riskDist = Math.abs(currentPrice - stopLoss);
            const stopDistPct = (riskDist / currentPrice) * 100;

            // --- STRUCTURAL TAKE PROFIT ---
            // For H1 Structure BOS: the signal comes from H1, so TP targets must also be H1-level
            // swing highs/lows. M5 micro-swings are too close and too noisy for a structural H1 trade.
            // For M5 BOS and other setups: M5 is appropriate.
            const tpKlines = setupType === 'H1 Structure BOS' ? h1.slice(-100) : m5;
            const liquidityPools = findLiquidityPools(tpKlines);

            // H1 BOS / Structure BOS: allow levels from 1.2R (closer structures are still valid R:R).
            // Sweep / OB / FVG: keep 1.5R minimum — these entries are counter-structural so need more room.
            const minRMultiple = (setupType === 'H1 Structure BOS' || setupType === 'Structure BOS') ? 1.2 : 1.5;
            const minTP = isBuy
                ? currentPrice + riskDist * minRMultiple
                : currentPrice - riskDist * minRMultiple;
            const maxTP = isBuy
                ? currentPrice + riskDist * 5
                : currentPrice - riskDist * 5;

            const structuralTPLevel = isBuy
                ? liquidityPools.bsl.find(l => l > minTP && l < maxTP)
                : liquidityPools.ssl.find(l => l < minTP && l > maxTP);

            // 2. Try nearest unfilled FVG as TP magnet — search H1 FVGs too for H1 BOS setups
            const h1fvgs = setupType === 'H1 Structure BOS' ? detectFairValueGaps(h1, 50) : [];
            const allFvgs = setupType === 'H1 Structure BOS' ? [...fvgs, ...h1fvgs] : fvgs;
            const fvgTP = isBuy
                ? allFvgs.filter(f => f.type === 'FVG Bearish' && f.bottom > minTP && f.bottom < maxTP)
                         .sort((a, b) => a.bottom - b.bottom)[0]?.bottom
                : allFvgs.filter(f => f.type === 'FVG Bullish' && f.top < minTP && f.top > maxTP)
                         .sort((a, b) => b.top - a.top)[0]?.top;

            // 3. Fallback R — scaled to stop distance so the target stays achievable:
            //    Wide stop (>5%): 1.5R — a 9% stop × 2.5R = 22.5% TP is unrealistic in most markets
            //    Medium stop (3–5%): 2.0R — moderate stretch, still conservative
            //    Normal stop (<3%): 2.5R — tight SL means tight position, full stretch is fine
            const fallbackR = stopDistPct > 5 ? 1.5 : stopDistPct > 3 ? 2.0 : 2.5;
            const fallbackTP = isBuy
                ? currentPrice + riskDist * fallbackR
                : currentPrice - riskDist * fallbackR;

            // Pick the nearest valid structural level; prefer liquidity pool > FVG > fallback
            const takeProfit = structuralTPLevel ?? fvgTP ?? fallbackTP;
            const tpSource = structuralTPLevel ? 'Liquidity Pool' : (fvgTP ? 'FVG Magnet' : `Fallback ${fallbackR}R`);

            const sizingMultiplier = this.intent === 'Alpha' ? 0.5 : (this.intent === 'Preserve' ? 0.75 : 1.0);

            // Add technicals to metadata for debugging/logging
            const omegaMetadata = {
                tier: this.intent,
                rvol: rvol,
                entryRsi: lastRsi,
                stopDistancePercent: (riskDist / currentPrice) * 100,
                tpSource,
                slSource: setupType === 'Liquidity Sweep' ? 'Swept Level' : setupType === 'Order Block Reclaim' ? 'OB Zone' : setupType === 'FVG Entry' ? 'FVG Zone' : 'BOS Level'
            };

            commonAnalysis.targets = { entry: currentPrice, stopLoss, takeProfit };
            commonAnalysis.sizing = { multiplier: sizingMultiplier };

            return {
                signal,
                reasons: [...baseReasons, `Trigger: ${setupType}`, `Vol: ${rvol.toFixed(2)}x`],
                entryPrice: currentPrice,
                stopLossPrice: stopLoss,
                takeProfitPrice: takeProfit,
                tradeType: 'conviction',
                setupType,
                omegaAnalysis: commonAnalysis,
                omegaMetadata // Pass metadata up
            };
        }

        return {
            signal: 'HOLD',
            reasons: baseReasons,
            omegaAnalysis: commonAnalysis
        };
    }
}

// --- SOVEREIGN MANAGEMENT ENGINE (The Elastic Ratchet) ---
export class SovereignManagementEngine {
    public static manage(position: Position, currentPrice: number, klines: Kline[], klinesMap?: Map<string, Kline[]>, modelDelta?: number): TradeManagementSignal {
        const signal: TradeManagementSignal = { reasons: [] };
        const isLong = position.direction === 'LONG';
        const elapsedCandles = position.candlesSinceEntry;

        // 1. Time-Based Invalidation (The Rot Check)
        const isCounterTrend = position.setupType?.includes('Counter-Trend') || false;
        const rotThreshold = isCounterTrend ? 12 : 24;

        const entryPrice = position.entryPrice;
        const pnlR = (isLong ? currentPrice - entryPrice : entryPrice - currentPrice) / position.initialRiskInPrice;

        // Pre-calculate ATR (needed by both guardian tight-trail and elastic ratchet below)
        const atrValuesEarly = ATR.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: klines.map(k => k.close), period: 14 });
        const atrEarly = getLast(atrValuesEarly) || 0;

        if (elapsedCandles > rotThreshold && pnlR < 0.2 && pnlR > -0.5) {
            if (pnlR > 0 && atrEarly > 0) {
                // Any positive movement → trail with SL floored at fee-breakeven.
                // Even if price is only slightly positive, feeBreakeven floor ensures SL is
                // at/above entry + fees, so the exit can never produce a net loss.
                const feeBreakeven = isLong
                    ? entryPrice * (1 + position.takerFeeRate * 2)
                    : entryPrice * (1 - position.takerFeeRate * 2);
                const rawTightSl = isLong ? currentPrice - atrEarly * 0.5 : currentPrice + atrEarly * 0.5;
                const tightSl = isLong ? Math.max(rawTightSl, feeBreakeven) : Math.min(rawTightSl, feeBreakeven);
                if ((isLong && tightSl > position.stopLossPrice) || (!isLong && tightSl < position.stopLossPrice)) {
                    return {
                        newStopLoss: tightSl,
                        activeStopLossReason: 'Guardian Trail',
                        reasons: [`Guardian: Profitable but stagnant (>${rotThreshold} candles) → tight trail (min fee-breakeven)`]
                    };
                }
            } else {
                return { action: 'close', reasons: [`Guardian: Trade Stagnant (${isCounterTrend ? 'Alpha' : 'Standard'}: >${rotThreshold} candles).`] };
            }
        }

        // 2. TP-Proportional Profit Lock (runs before elastic ratchet)
        // Only activates when a concrete TP exists; locks profit in 6 accelerating stages
        // based on distance remaining to TP rather than fixed R-multiples.
        if (position.takeProfitPrice) {
            const tpLock = getTPProportionalLockSignal(position, currentPrice, modelDelta);
            if (tpLock.newStopLoss !== undefined) return tpLock;
        }

        // 2.5 Fee-Based Profit Lock (Sovereign Fee Lock)
        // Parallel to other ratchets. Locks profit based on multiples of the round-trip fee.
        const roundTripFee = entryPrice * (position.takerFeeRate || 0.0005) * 2;
        const pnlPrice = isLong ? currentPrice - entryPrice : entryPrice - currentPrice;
        
        if (roundTripFee > 0) {
            const nFees = pnlPrice / roundTripFee;
            if (nFees >= 3) {
                const lockedFees = nFees < 5 ? 1 : Math.floor(nFees) - 3;
                const feeBasedSl = entryPrice + (isLong ? 1 : -1) * (lockedFees * roundTripFee);
                
                if ((isLong && feeBasedSl > (signal.newStopLoss ?? position.stopLossPrice)) || 
                    (!isLong && feeBasedSl < (signal.newStopLoss ?? position.stopLossPrice))) {
                    signal.newStopLoss = feeBasedSl;
                    signal.activeStopLossReason = 'Fee Lock';
                    signal.reasons.push(`FeeLock: ${nFees.toFixed(1)}x fees → locked ${lockedFees}x fees`);
                }
            }
        }

        // 3. Elastic Ratchet (Dynamic Trailing)
        // If TP-lock is engaged (stage ≥1), it owns SL progression for the rest of the trade.
        // ATR-based trail would compete with TP-lock's TP-progress-based placements.
        if ((position.tpLockStage || 0) >= 1) return signal;

        const atr = atrEarly;
        // Guard: if ATR is zero (insufficient klines), all trail distances become 0 → SL would collapse to currentPrice.
        if (atr === 0) return signal;

        // Volatility regime — scales both breakeven trigger and trail widths
        const volRegime: 'Low' | 'Normal' | 'High' = getVolatilityRegime(atr, currentPrice);

        // Regime-based trail ATR multiplier (default Standard trail)
        // High vol → wider trail (don't get stopped by noise)
        // Low vol  → tighter trail (capture smaller but cleaner moves)
        const stdTrail  = volRegime === 'High' ? 2.0 : volRegime === 'Low' ? 0.8 : 1.5;
        const fastTrail = volRegime === 'High' ? 1.2 : volRegime === 'Low' ? 0.5 : 1.0;
        const tightTrail = volRegime === 'High' ? 0.8 : 0.5;

        // ── TP-PROPORTIONAL RATCHET THRESHOLDS ──────────────────────────────────
        // Root cause of zero TP hits: fixed R-multiple thresholds (0.5R / 1.1R / 1.5R) were
        // calibrated for 3–5R TPs. At 50× leverage, TPs are routinely 7–42R away, so the Ratchet
        // fired at <2% of TP progress and exited every position before structure could breathe.
        //
        // Fix: scale all thresholds as a fraction of TP distance (in R terms).
        //   beThreshold   = 15% of TP in R  (min 0.5R, max 3.0R)
        //   midThreshold  = 30% of TP in R  (min 1.1R, max 7.0R)
        //   fullThreshold = 45% of TP in R  (min 1.5R, max 12.0R)
        //
        // Examples:
        //   TP=3R  (tight): be=0.5R, mid=1.1R, full=1.5R  → same as before ✓
        //   TP=7R  (mid):   be=1.05R, mid=2.1R, full=3.15R → gives trade room ✓
        //   TP=42R (wide):  be=3.0R, mid=7.0R, full=12.0R  → TP-lock stage1 at 16R reachable ✓
        const tpRange = position.takeProfitPrice
            ? Math.abs(position.takeProfitPrice - entryPrice)
            : 0;
        const tpInR = tpRange > 0 && position.initialRiskInPrice > 0
            ? tpRange / position.initialRiskInPrice
            : 3.0; // sensible fallback when no TP set

        const baseBeThreshold   = Math.min(Math.max(tpInR * 0.15, 0.5), 3.0);
        const baseMidThreshold  = Math.min(Math.max(tpInR * 0.30, 1.1), 7.0);
        const baseFullThreshold = Math.min(Math.max(tpInR * 0.45, 1.5), 12.0);

        const beThreshold        = volRegime === 'Low' ? baseBeThreshold  * 0.75 : baseBeThreshold;
        const midTrailThreshold  = volRegime === 'High' ? baseMidThreshold  * 1.2 : baseMidThreshold;
        const fullTrailThreshold = volRegime === 'High' ? baseFullThreshold * 1.2 : baseFullThreshold;

        // Early Breakeven Defense — activates at beThreshold R
        // SL is placed at the fee-adjusted true breakeven: the price at which profit = round-trip fee cost.
        // Using entry + 0.1×ATR was wrong — at 50× leverage the tiny price move produces negligible
        // dollar profit that is smaller than fees, turning every "breakeven" exit into a ~$4 net loss.
        if (pnlR > beThreshold && !position.isBreakevenSet) {
            const bePrice = isLong
                ? entryPrice * (1 + position.takerFeeRate * 2)
                : entryPrice * (1 - position.takerFeeRate * 2);
            
            // Ensure current price is actually beyond the breakeven price + a small buffer
            // Otherwise, if R is very small, 0.5R might be less than the fee distance,
            // causing the stop loss to be placed on the wrong side of the current price!
            const isBeyondBe = isLong 
                ? currentPrice > bePrice + (atr * 0.1)
                : currentPrice < bePrice - (atr * 0.1);

            if (isBeyondBe) {
                signal.newStopLoss = bePrice;
                signal.activeStopLossReason = 'Sovereign Ratchet';
                signal.newState = { isBreakevenSet: true };
                signal.reasons.push(`Ratchet: Breakeven Defense (${volRegime} vol, secured at ${beThreshold.toFixed(2)}R of ${tpInR.toFixed(1)}R TP)`);
                return signal;
            }
        }

        if (pnlR > midTrailThreshold && pnlR <= fullTrailThreshold) {
            // Mid-phase: gentle trail at stdTrail * 1.2 from entry side to prevent deep reversal
            const midTrailDist = atr * stdTrail * 1.2;
            const midSl = isLong ? currentPrice - midTrailDist : currentPrice + midTrailDist;
            // Only move stop if it's tighter than current AND still above entry (don't give back breakeven)
            const isAboveEntry = isLong ? midSl > entryPrice : midSl < entryPrice;
            if (isAboveEntry && ((isLong && midSl > (signal.newStopLoss ?? position.stopLossPrice)) || (!isLong && midSl < (signal.newStopLoss ?? position.stopLossPrice)))) {
                signal.newStopLoss = midSl;
                signal.activeStopLossReason = 'Sovereign Ratchet';
                signal.reasons.push(`Ratchet: Mid-Phase Trail (${(stdTrail * 1.2).toFixed(1)} ATR, ${volRegime} vol)`);
            }
            return signal;
        }

        // Full Elastic Trail (Active after fullTrailThreshold R)
        if (pnlR > fullTrailThreshold) {
            const closes = klines.map(k => k.close);
            const rsi = getLast(RSI.calculate({ period: 14, values: closes })) || 50;

            let trailDist = stdTrail;
            let trailType = "Standard";

            if (isLong) {
                if (rsi > 75) { trailDist = tightTrail; trailType = "Parabolic Tight"; }
                else if (rsi > 65) { trailDist = fastTrail; trailType = "Accelerated"; }
            } else {
                if (rsi < 25) { trailDist = tightTrail; trailType = "Parabolic Tight"; }
                else if (rsi < 35) { trailDist = fastTrail; trailType = "Accelerated"; }
            }

            // Velocity Lock: rapid 5-candle expansion → tighten immediately
            const k5 = klines.slice(-5);
            if (k5.length === 5) {
                const range5 = Math.abs(k5[4].close - k5[0].open);
                if (range5 > atr * 3) {
                    trailDist = tightTrail;
                    trailType = "Velocity Lock";
                }
            }

            const newSl = isLong
                ? currentPrice - (atr * trailDist)
                : currentPrice + (atr * trailDist);

            if ((isLong && newSl > (signal.newStopLoss ?? position.stopLossPrice)) || (!isLong && newSl < (signal.newStopLoss ?? position.stopLossPrice))) {
                signal.newStopLoss = newSl;
                signal.activeStopLossReason = 'Sovereign Ratchet';
                signal.reasons.push(`Ratchet: ${trailType} Trail (${trailDist.toFixed(1)} ATR, ${volRegime} vol)`);
            }
        }

        return signal;
    }
}

export const getOmegaSignal = async (
    config: BotConfig,
    klinesMap: Map<string, Kline[]>,
    btc: BitcoinState,
    openInterestHistory?: OpenInterestKline[],
    lsRatioHistory?: LongShortRatio[],
    timestamp?: number,
    universalModel?: UniversalSignalModel | null
): Promise<TradeSignal> => {
    const engine = new OmegaPrimeEngine(config);
    return await engine.generateSignal(klinesMap, btc, lsRatioHistory, openInterestHistory, timestamp, universalModel);
};

export function logFailedOmegaSetup(pair: string, stopPrice: number, setupType: string, direction: string) {
    console.log(`[Omega Prime] Setup failed for ${pair}: ${setupType} (${direction}) hit ${stopPrice}`);
}
