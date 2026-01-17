
// services/agents/omega.ts

import { Kline, BotConfig, TradeSignal, AgentParams, OmegaAnalysis, BitcoinState, Position, TradeManagementSignal, ADXOutput, OpenInterestKline } from '../../types';
import { EMA, ATR, RSI, SMA, ADX } from 'technicalindicators';
import { getLast, detectFairValueGaps, detectAbsorption, calculateCVDDivergence, detectMarketRegime, MarketRegime, getKillZoneMultiplier, calculateDailyVwap, validateSwingRejection, calculateRVOL, findNearestStructuralLevel, calculateTrueRange, getCandleExhaustion, analyzeHTFStructure, detectLiquidityInducement } from './agentUtils';
import { findSwingPoints, analyzeMarketStructure } from '../chartAnalysisService';
import { liquidationAnalysisService } from '../liquidationAnalysisService';

// --- TITAN MEMORY MODULE ---
const FAILED_SETUP_MEMORY = new Map<string, { price: number, type: string, timestamp: number }[]>();
const MEMORY_TTL = 60 * 60 * 1000; 

// --- TITAN STABILITY MODULE ---
const TIER_MEMORY = new Map<string, { tier: string, timestamp: number }>();
const TIER_COOLDOWN = 15 * 60 * 1000; 

const addFailedLevel = (pair: string, price: number, type: string) => {
    const memory = FAILED_SETUP_MEMORY.get(pair) || [];
    const now = Date.now();
    const cleanMemory = memory.filter(m => now - m.timestamp < MEMORY_TTL);
    cleanMemory.push({ price, type, timestamp: now });
    FAILED_SETUP_MEMORY.set(pair, cleanMemory);
};

const isLevelBurned = (pair: string, price: number, type: string, threshold: number = 1, tolerancePercent: number = 0.005): boolean => {
    const memory = FAILED_SETUP_MEMORY.get(pair);
    if (!memory) return false;
    const failures = memory.filter(m => m.type === type && Math.abs(m.price - price) / price < tolerancePercent);
    return failures.length >= threshold;
};

type OmegaMode = 'Conservative' | 'Standard' | 'Sniper';

interface TimeframeTier {
    name: '4h' | '1h' | '15m'; 
    structureTf: '15m' | '5m' | '1m'; 
    triggerTf: '5m' | '1m'; 
    targetTf: '1d' | '4h' | '1h'; 
    rationale: string;
}

interface ShapeshiftResult {
    tier: TimeframeTier;
    metrics: {
        atrPercent: number;
        adx: number;
    };
}

const TIER_MAP: Record<string, TimeframeTier> = {
    '4h':  { name: '4h', structureTf: '15m', triggerTf: '5m', targetTf: '1d', rationale: 'High Volatility Safety' },
    '1h':  { name: '1h', structureTf: '5m', triggerTf: '1m', targetTf: '4h', rationale: 'Standard Trend' },
    '15m': { name: '15m', structureTf: '1m', triggerTf: '1m', targetTf: '1h', rationale: 'Low Volatility Scalp' }
};

/**
 * Omega V13 "Titan": Sovereign Multi-Fractal Engine
 * 
 * CORE IMPROVEMENTS:
 * 1. Volatility Ratchet Floor: Stop-loss cannot suffocate a trade before 2R.
 * 2. Harmonized Scaling: Targets adapt to the selected volatility tier.
 * 3. RVOL Breakout Gate: Never enters breakouts without institutional volume confirm.
 * 4. Flight Recorder: Logs precise entry RSI, ADX, and Distance metrics.
 */
class OmegaEngine {
    private config: BotConfig;
    private params: Required<AgentParams>;

    constructor(config: BotConfig) {
        this.config = config;
        this.params = config.agentParams as Required<AgentParams>;
    }

    private runShapeshifterPhase(klinesMap: Map<string, Kline[]>): ShapeshiftResult {
        const allowShapeshifting = this.params.omega_allowShapeshifting;
        const defaultTier = TIER_MAP['1h']; 
        
        const h4 = klinesMap.get('4h') || [];
        const currentPrice = h4.length > 0 ? h4[h4.length - 1].close : 0;
        const atr4h = getLast(ATR.calculate({ high: h4.map(k=>k.high), low: h4.map(k=>k.low), close: h4.map(k=>k.close), period: 14 })) || 0;
        const atrPercent = currentPrice > 0 ? atr4h / currentPrice : 0;
        const adx4h = getLast(ADX.calculate({ high: h4.map(k=>k.high), low: h4.map(k=>k.low), close: h4.map(k=>k.close), period: 14 }));
        const adxVal = adx4h ? adx4h.adx : 20;

        const defaultResult = { tier: defaultTier, metrics: { atrPercent, adx: adxVal } };

        if (!allowShapeshifting || h4.length < 50) {
            return defaultResult;
        }

        const pair = this.config.pair;
        const now = Date.now();
        const cached = TIER_MEMORY.get(pair);
        
        let newTierKey = '1h';
        if (atrPercent > 0.025) { newTierKey = '4h'; }
        else if (adxVal < 15 && atrPercent < 0.005) { newTierKey = '15m'; }

        if (cached && cached.tier !== newTierKey) {
            if (now - cached.timestamp < TIER_COOLDOWN) {
                const isDrastic = (cached.tier === '15m' && newTierKey === '4h') || (cached.tier === '4h' && newTierKey === '15m');
                if (!isDrastic) {
                    return { tier: TIER_MAP[cached.tier], metrics: { atrPercent, adx: adxVal } };
                }
            }
        }

        if (!cached || cached.tier !== newTierKey) {
            TIER_MEMORY.set(pair, { tier: newTierKey, timestamp: now });
        }

        return { tier: TIER_MAP[newTierKey], metrics: { atrPercent, adx: adxVal } };
    }

    private runBiasPhase(klinesMap: Map<string, Kline[]>, tier: TimeframeTier): OmegaAnalysis['phases']['scan'] & { allowedDirection: 'LONG' | 'SHORT' | 'NONE' } {
        const contextKlines = klinesMap.get(tier.name);
        if (!contextKlines || contextKlines.length < 50) return { bias: 'Neutral', score: 0, reason: `Waiting for ${tier.name} Data...`, allowedDirection: 'NONE' };

        const structure = analyzeHTFStructure(contextKlines);
        if (structure.bias === 'BULLISH') return { bias: 'Bullish', score: 100, reason: structure.reason, allowedDirection: 'LONG' };
        if (structure.bias === 'BEARISH') return { bias: 'Bearish', score: 100, reason: structure.reason, allowedDirection: 'SHORT' };

        return { bias: 'Neutral', score: 50, reason: structure.reason, allowedDirection: 'NONE' };
    }

    private runZonePhase(
        klinesMap: Map<string, Kline[]>, 
        bias: 'LONG' | 'SHORT',
        tier: TimeframeTier
    ): OmegaAnalysis['phases']['hunt'] & { target?: number, stop?: number, zoneLow?: number, zoneHigh?: number, setupType?: string, entryBandLow?: number, entryBandHigh?: number } {
        
        const contextKlines = klinesMap.get(tier.name);
        const structureKlines = klinesMap.get(tier.structureTf);
        
        if (!contextKlines || contextKlines.length < 50 || !structureKlines || structureKlines.length < 50) {
            return { setup: 'None', score: 0, reason: `Waiting for ${tier.name}/${tier.structureTf} Data...` };
        }

        const contextSnapshot = contextKlines.slice(0, -1);
        const structureSnapshot = structureKlines.slice(0, -1);
        const currentPrice = contextKlines[contextKlines.length-1].close;
        const atr = (getLast(ATR.calculate({ high: contextSnapshot.map(k=>k.high), low: contextSnapshot.map(k=>k.low), close: contextSnapshot.map(k=>k.close), period: 14 })) as number) || currentPrice * 0.01;

        // FVG Detection
        const fvgs = detectFairValueGaps(structureSnapshot, 60);
        const validFvg = fvgs.find(f => {
            if (f.filled) return false;
            if (bias === 'LONG' && f.type === 'FVG Bullish' && currentPrice < f.top && currentPrice > (f.bottom - atr)) return true;
            if (bias === 'SHORT' && f.type === 'FVG Bearish' && currentPrice > f.bottom && currentPrice < (f.top + atr)) return true; 
            return false;
        });

        if (validFvg) {
            const isBull = bias === 'LONG';
            const midPoint = (validFvg.top + validFvg.bottom) / 2;

            if (isLevelBurned(this.config.pair, midPoint, `FVG_${bias}_${tier.name}`, 2)) {
                return { setup: 'None', score: 0, reason: 'Zone Burned (Recent Failure)' };
            }

            // TITAN HARMONIZED TARGETING
            const targetKlines = klinesMap.get(tier.targetTf) || [];
            const structuralTarget = findNearestStructuralLevel(targetKlines, currentPrice, bias, 200);
            
            const targetMult = 3.0; 
            const stopBuffer = atr * 0.5;

            const stop = isBull ? validFvg.bottom - stopBuffer : validFvg.top + stopBuffer;
            const target = structuralTarget ? structuralTarget : (isBull ? currentPrice + (atr * targetMult) : currentPrice - (atr * targetMult));

            return { 
                setup: 'FVG', 
                score: 100, 
                reason: `Inside ${tier.structureTf} ${bias} FVG (Fractal: ${tier.name})`, 
                target, 
                stop,
                zoneLow: validFvg.bottom,
                zoneHigh: validFvg.top,
                entryBandLow: validFvg.bottom,
                entryBandHigh: validFvg.top,
                setupType: 'FVG'
            };
        }

        // Pullback
        const ema50 = getLast(EMA.calculate({ period: 50, values: contextSnapshot.map(k=>k.close) }));
        if (ema50) {
            const isLongPullback = bias === 'LONG' && currentPrice <= ema50 * 1.002 && currentPrice >= ema50 * 0.995;
            const isShortPullback = bias === 'SHORT' && currentPrice >= ema50 * 0.998 && currentPrice <= ema50 * 1.005;

            if (isLongPullback || isShortPullback) {
                return { 
                    setup: 'Pullback', 
                    score: 90, 
                    reason: `${tier.name} EMA50 Retest`, 
                    target: bias === 'LONG' ? currentPrice + (atr * 3) : currentPrice - (atr * 3), 
                    stop: bias === 'LONG' ? ema50 - (atr * 1.5) : ema50 + (atr * 1.5),
                    zoneLow: isLongPullback ? ema50 * 0.995 : ema50 * 0.998,
                    zoneHigh: isLongPullback ? ema50 * 1.002 : ema50 * 1.005,
                    entryBandLow: isLongPullback ? ema50 * 0.995 : ema50 * 0.998,
                    entryBandHigh: isLongPullback ? ema50 * 1.002 : ema50 * 1.005,
                    setupType: 'Pullback'
                };
            }
        }

        return { setup: 'None', score: 0, reason: 'Price not in Value Zone' };
    }

    private runTriggerPhase(
        klinesMap: Map<string, Kline[]>, 
        bias: 'LONG' | 'SHORT', 
        zoneLow: number,
        zoneHigh: number,
        mode: OmegaMode,
        triggerTf: string
    ): OmegaAnalysis['phases']['kill'] & { armed: boolean, rvol: number } {
        const triggerKlines = klinesMap.get(triggerTf);
        if (!triggerKlines || triggerKlines.length < 50) return { trigger: 'None', score: 0, reason: `Waiting for ${triggerTf} Trigger Data...`, armed: false, rvol: 1.0 };
        
        const hour = new Date().getUTCHours();
        if (mode !== 'Sniper' && hour >= 0 && hour <= 5) {
            return { trigger: 'None', score: 0, reason: 'Asia session accumulation phase', armed: false, rvol: 1.0 };
        }

        // TITAN VOLUME GATE
        const rvol = calculateRVOL(triggerKlines, 24);
        if (rvol < 1.1) return { trigger: 'None', score: 0, reason: `Insufficient RVOL (${rvol.toFixed(1)}x)`, armed: false, rvol };

        if (detectLiquidityInducement(triggerKlines.slice(-10), bias === 'LONG' ? zoneLow : zoneHigh, bias === 'LONG' ? 'support' : 'resistance')) {
            return { trigger: 'None', score: 0, reason: 'Potential Inducement Detected', armed: false, rvol };
        }

        const recentCandles = triggerKlines.slice(-3);
        const hasTappedZone = recentCandles.some(k => bias === 'LONG' ? k.low <= zoneHigh : k.high >= zoneLow);

        if (!hasTappedZone) return { trigger: 'None', score: 0, reason: 'Zone not tapped', armed: false, rvol };

        return { trigger: 'Confirmation', score: 100, reason: `${triggerTf} Trigger Confirmed`, armed: true, rvol };
    }

    private runExecutionPhase(
        klinesMap: Map<string, Kline[]>,
        bias: 'LONG' | 'SHORT',
        entryBandLow: number,
        entryBandHigh: number,
        mode: OmegaMode
    ): { execute: boolean, reason: string, rsi: number, adx: number, atr: number } {
        const m1 = klinesMap.get('1m')!;
        const last = m1[m1.length - 1];
        const prev = m1[m1.length - 2];
        
        const rsi = getLast(RSI.calculate({period: 14, values: m1.map(k=>k.close)})) || 50;
        const adx = (getLast(ADX.calculate({high: m1.map(k=>k.high), low: m1.map(k=>k.low), close: m1.map(k=>k.close), period: 14})) as ADXOutput)?.adx || 20;
        const atr = (getLast(ATR.calculate({high: m1.map(k=>k.high), low: m1.map(k=>k.low), close: m1.map(k=>k.close), period: 14})) as number) || last.close * 0.001;

        const inValueZone = bias === 'LONG' ? last.close <= entryBandHigh : last.close >= entryBandLow;
        if (!inValueZone) return { execute: false, reason: 'Outside Entry Band', rsi, adx, atr };

        const prior = m1.slice(-5, -1);
        const failedBreak = bias === 'LONG'
            ? prior.some(k => k.high > entryBandHigh && k.close < entryBandHigh)
            : prior.some(k => k.low < entryBandLow && k.close > entryBandLow);

        if (failedBreak) return { execute: false, reason: 'Liquidity Sweep Resistance', rsi, adx, atr };

        const acceptance = bias === 'LONG' 
            ? (last.close > last.open && last.close > prev.close && prev.low >= entryBandLow)
            : (last.close < last.open && last.close < prev.close && prev.high <= entryBandHigh);

        if (acceptance) return { execute: true, reason: '1m Micro-Acceptance', rsi, adx, atr };

        return { execute: false, reason: 'Waiting for Momentum', rsi, adx, atr };
    }

    public async generateSignal(klinesMap: Map<string, Kline[]>, btc: BitcoinState, openInterestHistory?: OpenInterestKline[]): Promise<TradeSignal> {
        let mode: OmegaMode = 'Standard';
        const userSetting = this.params.omega_aggressiveness;

        if (!userSetting || userSetting === 'Auto') {
            const h1 = klinesMap.get('1h') || [];
            const regime = detectMarketRegime(h1);
            if (btc.state === 'CRASH' || btc.state === 'PUMP' || regime === MarketRegime.VOLATILE || regime === MarketRegime.SQUEEZE) mode = 'Conservative';
            else if ((regime === MarketRegime.TRENDING_BULLISH && btc.trend === 'bullish') || (regime === MarketRegime.TRENDING_BEARISH && btc.trend === 'bearish')) mode = 'Sniper';
            else mode = 'Standard';
        } else mode = userSetting as OmegaMode;

        const { tier, metrics } = this.runShapeshifterPhase(klinesMap);
        const bias = this.runBiasPhase(klinesMap, tier);
        if (bias.allowedDirection === 'NONE') {
            return { signal: 'HOLD', reasons: [bias.reason], omegaAnalysis: this.createAnalysis(0, bias, undefined, undefined, undefined, undefined, mode) };
        }

        const zone = this.runZonePhase(klinesMap, bias.allowedDirection, tier);
        if (zone.setup === 'None') {
            return { signal: 'HOLD', reasons: [bias.reason, zone.reason], omegaAnalysis: this.createAnalysis(30, bias, zone, undefined, undefined, undefined, mode) };
        }

        const trigger = this.runTriggerPhase(klinesMap, bias.allowedDirection, zone.zoneLow!, zone.zoneHigh!, mode, tier.triggerTf);
        if (!trigger.armed) {
             return { signal: 'HOLD', reasons: [bias.reason, zone.reason, trigger.reason], omegaAnalysis: this.createAnalysis(60, bias, zone, trigger, undefined, undefined, mode) };
        }

        const execution = this.runExecutionPhase(klinesMap, bias.allowedDirection, zone.entryBandLow!, zone.entryBandHigh!, mode);
        if (!execution.execute) {
            return { signal: 'HOLD', reasons: [bias.reason, zone.reason, trigger.reason, execution.reason], omegaAnalysis: this.createAnalysis(80, bias, zone, trigger, undefined, undefined, mode) };
        }

        // Titan "Flight Recorder" Snapshot
        const targetDist = (Math.abs(zone.target! - execution.rsi) / execution.rsi) * 100;
        const stopDist = (Math.abs(execution.rsi - zone.stop!) / execution.rsi) * 100;

        const omegaMetadata = {
            tier: tier.name,
            volatilityPercent: metrics.atrPercent * 100,
            trendStrength: metrics.adx,
            structureFractal: tier.structureTf,
            triggerFractal: tier.triggerTf,
            setupQualityScore: zone.score,
            entryAtr: execution.atr,
            entryRsi: execution.rsi,
            entryAdx: execution.adx,
            targetDistancePercent: targetDist,
            stopDistancePercent: stopDist,
            rvol: trigger.rvol
        };

        return {
            signal: bias.allowedDirection === 'LONG' ? 'BUY' : 'SELL',
            reasons: [`🚀 OMEGA V13 TITAN [${tier.name}]`, bias.reason, zone.reason, trigger.reason, execution.reason],
            entryPrice: klinesMap.get('1m')!.slice(-1)[0].close,
            stopLossPrice: zone.stop,
            takeProfitPrice: zone.target,
            tradeType: 'conviction', 
            setupType: zone.setupType,
            invalidationPrice: zone.stop, 
            omegaAnalysis: this.createAnalysis(100, bias, zone, trigger, undefined, undefined, mode),
            omegaMetadata
        };
    }

    private createAnalysis(progress: number, scan?: any, hunt?: any, kill?: any, math?: any, flow?: any, mode?: OmegaMode): OmegaAnalysis {
        return {
            conviction: progress,
            phases: {
                scan: scan || { bias: 'Neutral', score: 0, reason: 'Idle' },
                hunt: hunt || { setup: 'None', score: 0, reason: 'Scanning' },
                kill: kill || { trigger: 'None', score: 0, reason: 'Standby' },
                flow: flow || { trend: 'Neutral', score: 0, reason: 'Checking' }
            },
            feeExpectancy: math ? math.feeCheck : { cost: 0, reward: 0, ratio: 0, passed: true },
            targets: { entry: 0, stopLoss: hunt?.stop || 0, takeProfit: hunt?.target || 0 },
            sizing: math ? math.sizing : { multiplier: 1, reason: 'N/A' },
            mode: mode
        };
    }
}

/**
 * Titan Management Engine V13.0
 * - Volatility Floor: Stop loss cannot suffocate trade before 2R.
 * - Minimum ATR Buffer: 1.5x ATR spacing guaranteed for noise protection.
 */
export class SovereignManagementEngine {
    public static manage(position: Position, currentPrice: number, klines: Kline[], klinesMap: Map<string, Kline[]>): TradeManagementSignal {
        const entry = position.entryPrice;
        const initialRisk = position.initialRiskInPrice;
        const isLong = position.direction === 'LONG';
        const pnl = isLong ? currentPrice - entry : entry - currentPrice;
        const currentR = pnl / initialRisk;
        const peakPrice = position.peakPrice || entry;
        const peakPnl = isLong ? peakPrice - entry : entry - peakPrice;
        const peakR = peakPnl / initialRisk;

        const atrValues = ATR.calculate({high: klines.map(k=>k.high), low: klines.map(k=>k.low), close: klines.map(k=>k.close), period: 14});
        const currentATR = (getLast(atrValues) as number) || (entry * 0.005);

        // TITAN VOLATILITY FLOOR
        // If we haven't hit 2R profit, the stop-loss CANNOT move closer than 1.5 ATR from current price.
        const volFloorDist = currentATR * 1.5;

        let bestSL = position.stopLossPrice;
        let activeReason = position.activeStopLossReason;
        let logReason = "Hold";

        // 1. Neural Retention
        if (peakR > 2.0) {
            const retentionRatio = Math.min(0.9, 0.4 + (Math.log(peakR) * 0.15));
            const candidate = isLong ? entry + (peakPnl * retentionRatio) : entry - (peakPnl * retentionRatio);
            if (isLong ? candidate > bestSL : candidate < bestSL) {
                bestSL = candidate;
                activeReason = 'Sovereign Ratchet';
                logReason = "Titan: Neural Retention";
            }
        }

        // 2. Structural Lock (only after 1.5R)
        if (currentR > 1.5) {
            const swings = findSwingPoints(klines, 5);
            const valid = isLong 
                ? swings.filter(s=>s.type==='low' && s.price < currentPrice).sort((a,b)=>b.price-a.price)[0]?.price
                : swings.filter(s=>s.type==='high' && s.price > currentPrice).sort((a,b)=>a.price-b.price)[0]?.price;
            
            if (valid && (isLong ? valid > bestSL : valid < bestSL)) {
                bestSL = valid;
                activeReason = 'Sovereign Ratchet';
                logReason = "Titan: Structure Lock";
            }
        }

        // 3. Apply Volatility Floor Override
        if (currentR < 2.0) {
            const floorSL = isLong ? currentPrice - volFloorDist : currentPrice + volFloorDist;
            // Floor acts as a 'cap' on how much we can tighten
            if (isLong) bestSL = Math.min(bestSL, floorSL);
            else bestSL = Math.max(bestSL, floorSL);
        }

        const signal: TradeManagementSignal = { reasons: [] };
        if (bestSL !== position.stopLossPrice) {
            signal.newStopLoss = bestSL;
            signal.activeStopLossReason = activeReason;
            signal.reasons.push(`${logReason} -> ${bestSL.toFixed(position.pricePrecision)}`);
        }

        return signal;
    }
}

export const getOmegaSignal = async (config: BotConfig, klinesMap: Map<string, Kline[]>, btc: BitcoinState, openInterestHistory?: OpenInterestKline[]): Promise<TradeSignal> => {
    const engine = new OmegaEngine(config);
    return await engine.generateSignal(klinesMap, btc, openInterestHistory);
};

export const logFailedOmegaSetup = (pair: string, price: number, type: string, direction?: string) => {
    const key = direction ? `${type}_${direction}` : type;
    addFailedLevel(pair, price, key);
};
