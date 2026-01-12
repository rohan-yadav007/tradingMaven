
// services/agents/astrax.ts

import { Kline, BotConfig, TradeSignal, AstraXAnalysis, AgentParams, ADXOutput, OrderBookAnalysis, BitcoinState, ChartPattern, MACDOutput } from '../../types';
import { ADX, ATR, RSI, MACD, EMA } from 'technicalindicators';
import { calculateDailyVwap, getLast, calculateRVOL, analyzeBitcoinState, detectLiquiditySweep, calculateRsiVelocity, captureMarketContext, calculateRsiSlope } from './agentUtils';

const signalCooldowns = new Map<string, number>();

/**
 * Sovereign Matrix V8.6 "Matrix Tuning" Overhaul
 * A probabilistic convergence model tuned for higher sensitivity while maintaining technical handshakes.
 */
class QuantumConvergenceEngine {
    private config: BotConfig;
    private params: Required<AgentParams>;
    private feeRate: number;

    constructor(config: BotConfig) {
        this.config = config;
        this.params = config.agentParams as Required<AgentParams>;
        this.feeRate = config.takerFeeRate || 0.0005;
    }

    public getCooldownMs(tf: string): number {
        const map: Record<string, number> = { '1m': 0.5, '3m': 1, '5m': 2, '15m': 5 }; 
        return (map[tf] || 15) * 60 * 1000;
    }

    /**
     * PILLAR 1: STRUCTURE SCORE (0-100)
     * Focus: Classic Chart Patterns, Liquidity Sweeps, and Key Levels.
     */
    private calculateStructureScore(klines: Kline[], patterns: ChartPattern[]): { bull: number, bear: number, reasons: string[], pattern?: ChartPattern } {
        const last = klines[klines.length - 1];
        const sweep = detectLiquiditySweep(klines, this.params.astraX_sweepLookback);
        
        let bull = 0, bear = 0;
        const reasons: string[] = [];
        let activePattern: ChartPattern | undefined;

        // A. Pattern Detection (Weights 60%)
        // V8.6: Slightly more lenient confidence threshold for patterns
        const topPattern = patterns.sort((a, b) => b.confidence - a.confidence)[0];
        if (topPattern && topPattern.confidence > 60) {
            activePattern = topPattern;
            const isConfirmed = topPattern.sentiment === 'Bullish' 
                ? last.close > (topPattern.triggerPrice || last.high)
                : last.close < (topPattern.triggerPrice || last.low);
            
            if (isConfirmed) {
                if (topPattern.sentiment === 'Bullish') { bull += 60; reasons.push(`✅ Structure: Confirmed ${topPattern.type}`); }
                else { bear += 60; reasons.push(`✅ Structure: Confirmed ${topPattern.type}`); }
            } else {
                if (topPattern.sentiment === 'Bullish') { bull += 35; reasons.push(`ℹ️ Structure: ${topPattern.type} Forming`); }
                else { bear += 35; reasons.push(`ℹ️ Structure: ${topPattern.type} Forming`); }
            }
        }

        // B. Liquidity Sweep (Weights 40%)
        if (sweep.bullish) { bull += 40; reasons.push(`✅ Structure: Liquidity Sweep (Bullish)`); }
        if (sweep.bearish) { bear += 40; reasons.push(`✅ Structure: Liquidity Sweep (Bearish)`); }

        return { bull, bear, reasons, pattern: activePattern };
    }

    /**
     * PILLAR 2: MOMENTUM SCORE (0-100)
     * Focus: RSI Velocity, MACD Histogram, and Trend Strength.
     */
    private calculateMomentumScore(klines: Kline[]): { bull: number, bear: number, reasons: string[] } {
        const closes = klines.map(k => k.close);
        const rsiValues = RSI.calculate({ period: 7, values: closes });
        const lastRsi = getLast(rsiValues) || 50;
        const rsiVel = calculateRsiVelocity(rsiValues);
        const macdValues = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
        // FIX: Cast getLast result to MACDOutput to fix histogram access errors.
        const lastMacd = getLast(macdValues) as MACDOutput | undefined;
        
        let bull = 0, bear = 0;
        const reasons: string[] = [];

        // A. RSI Velocity (Acceleration)
        if (rsiVel > 2.0) { bull += 40; reasons.push(`🚀 Momentum: Bullish Acceleration`); }
        else if (rsiVel < -2.0) { bear += 40; reasons.push(`🚀 Momentum: Bearish Acceleration`); }

        // B. MACD Histogram
        if (lastMacd && typeof lastMacd.histogram === 'number') {
            if (lastMacd.histogram > 0) { bull += 30; }
            else if (lastMacd.histogram < 0) { bear += 30; }
        }

        // C. Over-extension Gating (Slightly wider in V8.6)
        if (lastRsi > 82) { bull -= 50; reasons.push(`⚠️ Momentum: Bullish Over-extended`); }
        if (lastRsi < 18) { bear -= 50; reasons.push(`⚠️ Momentum: Bearish Over-extended`); }

        return { bull: Math.max(0, bull), bear: Math.max(0, bear), reasons };
    }

    /**
     * PILLAR 3: GRAVITY SCORE (0-100)
     * Focus: Higher Timeframe Trend and BTC Market Context.
     */
    private calculateGravityScore(btc: BitcoinState, htfTrend?: 'bullish' | 'bearish' | 'neutral'): { bull: number, bear: number, reasons: string[] } {
        let bull = 0, bear = 0;
        const reasons: string[] = [];

        // V8.6 Tuning: Neutral Nudge (Grant 25 pts if macro is sideways so local alpha can still trigger)
        if (btc.trend === 'bullish') { bull += 50; reasons.push(`🛰️ Gravity: BTC Trend Bullish`); }
        else if (btc.trend === 'bearish') { bear += 50; reasons.push(`🛰️ Gravity: BTC Trend Bearish`); }
        else { 
            bull += 25; bear += 25; 
            reasons.push(`🛰️ Gravity: BTC Neutral (Local Alpha priority)`); 
        }
        
        if (btc.state === 'CRASH') { bull = 0; bear += 50; reasons.push(`🚨 GRAVITY VETO: BTC Crash detected`); }
        if (btc.state === 'PUMP') { bear = 0; bull += 50; reasons.push(`🛰️ Gravity: BTC Pumping`); }

        // B. HTF Confluence (Weight 50%)
        if (htfTrend === 'bullish') { bull += 50; reasons.push(`🛰️ Gravity: HTF Confluence Bullish`); }
        else if (htfTrend === 'bearish') { bear += 50; reasons.push(`🛰️ Gravity: HTF Confluence Bearish`); }
        else { bull += 25; bear += 25; }

        return { bull, bear, reasons };
    }

    /**
     * PILLAR 4: UTILITY SCORE (Expectancy Check)
     * Focus: Fee coverage and Risk/Reward. Returns 0 or 100 (Pass/Fail).
     */
    private calculateUtilityScore(price: number, target: number, tf: string, ob?: OrderBookAnalysis): { score: number, reason?: string } {
        const spreadPercent = ob ? ob.spread : 0.0005;
        const roundTripFee = price * this.feeRate * 2;
        const totalCostInPrice = (price * spreadPercent) + roundTripFee;
        const grossProfit = Math.abs(target - price);
        const ratio = grossProfit / totalCostInPrice;
        
        // V8.6: Loosened from 6.8/8.2 to 3.5/4.5
        const baseMinRatio = ['1m', '3m'].includes(tf) ? 3.5 : 4.5; 
        
        if (ratio < baseMinRatio) return { score: 0, reason: `Low Expectancy (${ratio.toFixed(1)}x cost).` };
        return { score: 100 };
    }

    /**
     * VORTEX RETEST CHECK
     * For high-conviction breakout entries, ensures we've seen a micro-tap of the level.
     */
    private performVortexRetest(klines: Kline[], level: number, direction: 'BUY' | 'SELL'): { passed: boolean, reason?: string } {
        if (['15m', '30m', '1h', '4h', '1d'].includes(this.config.timeFrame)) return { passed: true }; 

        // V8.6: Slightly wider retest buffer (0.15% -> 0.25%)
        const recent = klines.slice(-6);
        const hasTapped = direction === 'BUY' 
            ? recent.some(k => Math.abs(k.low - level) / level < 0.0025) 
            : recent.some(k => Math.abs(k.high - level) / level < 0.0025);
        
        if (hasTapped) return { passed: true };
        return { passed: false, reason: 'Waiting for Vortex Retest' };
    }

    public async generateSignal(
        klines: Kline[], 
        btc: BitcoinState, 
        patterns: ChartPattern[], 
        htfTrend?: 'bullish' | 'bearish' | 'neutral', 
        ob?: OrderBookAnalysis
    ): Promise<TradeSignal> {
        const last = klines[klines.length - 1];
        const tf = this.config.timeFrame;
        const reasons: string[] = [`ℹ️ Mode: Quantum Tuning V8.6`];

        // 1. Calculate Pilar Scores
        const structure = this.calculateStructureScore(klines, patterns);
        const momentum = this.calculateMomentumScore(klines);
        const gravity = this.calculateGravityScore(btc, htfTrend);

        // 2. Convergent Handshake
        const w = {
            s: this.params.astraX_weights_structure / 100,
            m: this.params.astraX_weights_momentum / 100,
            g: this.params.astraX_weights_context / 100, 
        };

        const totalBull = (structure.bull * w.s) + (momentum.bull * w.m) + (gravity.bull * w.g);
        const totalBear = (structure.bear * w.s) + (momentum.bear * w.m) + (gravity.bear * w.g);

        let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let setupName = 'Hunting Convergence';
        let targetPrice = 0;
        let stopPrice = 0;

        // V8.6: Lowered aggregate threshold from 70 -> 62
        const threshold = 62;

        if (totalBull >= threshold && totalBull > totalBear) {
            signal = 'BUY';
            setupName = structure.pattern ? `Vortex ${structure.pattern.type}` : 'Momentum Sweep';
            targetPrice = structure.pattern?.measuredTarget || (last.close * 1.015);
            stopPrice = structure.pattern?.invalidationLevel || (last.close * 0.99);
        } else if (totalBear >= threshold && totalBear > totalBull) {
            signal = 'SELL';
            setupName = structure.pattern ? `Vortex ${structure.pattern.type}` : 'Momentum Sweep';
            targetPrice = structure.pattern?.measuredTarget || (last.close * 0.985);
            stopPrice = structure.pattern?.invalidationLevel || (last.close * 1.01);
        }

        // 3. Final Validation Gateways
        if (signal !== 'HOLD') {
            // A. Utility Gate
            const utility = this.calculateUtilityScore(last.close, targetPrice, tf, ob);
            if (utility.score === 0) {
                return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: ${utility.reason}`] };
            }

            // B. Vortex Retest Gate
            if (structure.pattern && ['1m', '3m'].includes(tf)) {
                const retest = this.performVortexRetest(klines, structure.pattern.triggerPrice || last.close, signal);
                if (!retest.passed) {
                    return { signal: 'HOLD', reasons: [...reasons, `ℹ️ ${retest.reason}`] };
                }
            }

            // C. Order Book Pressure Gate (V8.6: Relaxed slightly)
            if (ob) {
                const pressureMatches = (signal === 'BUY' && ob.imbalance > -0.3) || (signal === 'SELL' && ob.imbalance < 0.3);
                if (!pressureMatches) {
                    return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Extreme Book Contradiction`] };
                }
            }

            return {
                signal,
                reasons: [...reasons, ...structure.reasons, ...momentum.reasons, ...gravity.reasons, `🚀 HANDSHAKE: ${setupName}`],
                tradeType: ['1m', '3m'].includes(tf) ? 'scalp' : 'conviction',
                takeProfitPrice: targetPrice,
                stopLossPrice: stopPrice,
                astraXAnalysis: {
                    conviction: Math.round(Math.max(totalBull, totalBear)),
                    regime: (getLast(ADX.calculate({high: klines.map(k=>k.high), low: klines.map(k=>k.low), close: klines.map(k=>k.close), period: 14})) as ADXOutput)?.adx > 25 ? 'Strong Trend' : 'Developing Trend',
                    thesis: signal === 'BUY' ? 'Bullish' : 'Bearish',
                    setupName,
                    confidenceMetrics: {
                        structure: Math.round(Math.max(structure.bull, structure.bear)),
                        momentum: Math.round(Math.max(momentum.bull, momentum.bear)),
                        technical: 100,
                        volume: Math.round(calculateRVOL(klines, 24) * 33)
                    }
                } as any
            };
        }

        return { signal: 'HOLD', reasons: ['ℹ️ AstraX: Scaling pillar convergence...'] };
    }
}

export const getConfluenceTimeframes = (primaryTf: string): string[] => {
    const mappings: Record<string, string[]> = {
        '1m': ['15m'], '3m': ['15m'], '5m': ['1h'], '15m': ['4h'], '30m': ['4h'], '1h': ['1d']
    };
    return mappings[primaryTf] || [primaryTf];
};

export const getAstraXSignal = async (
    config: BotConfig,
    klinesMap: Map<string, Kline[]>,
    immediateKlines?: Kline[],
    livePrice?: number,
    fundingRate?: number,
    ltfKlines?: Kline[],
    btcKlines?: Kline[],
    orderBook?: OrderBookAnalysis,
    ethBtcKlines?: Kline[]
): Promise<TradeSignal> => {
    const primaryTf = config.timeFrame;
    const klines = klinesMap.get(primaryTf);
    const pairKey = `${config.pair}:${primaryTf}`;
    const now = Date.now();

    if (!klines || klines.length < 500) return { signal: 'HOLD', reasons: [`ℹ️ Scaling data (${klines?.length || 0}/500)...`] };

    const engine = new QuantumConvergenceEngine(config);
    const lastSignal = signalCooldowns.get(pairKey) || 0;
    
    if (now - lastSignal < engine.getCooldownMs(primaryTf)) {
        return { signal: 'HOLD', reasons: ['ℹ️ Matrix: Cooling...'] };
    }

    // 1. Gather Gravity/Context
    // FIX: Provided a complete BitcoinState fallback object to resolve type mismatch errors.
    const btc: BitcoinState = btcKlines ? analyzeBitcoinState(btcKlines) : { 
        state: 'NEUTRAL', 
        trend: 'neutral', 
        momentum: 'neutral', 
        rejection: 'none', 
        reason: 'BTC context unavailable' 
    };
    const htfTf = getConfluenceTimeframes(primaryTf)[0];
    const htfKlines = klinesMap.get(htfTf);
    let htfTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (htfKlines && htfKlines.length >= 200) {
        const htfCloses = htfKlines.map(k => k.close);
        // FIX: Cast getLast result to number.
        const htfEma = getLast(EMA.calculate({ period: 50, values: htfCloses })) as number | undefined;
        if (htfEma !== undefined) htfTrend = htfCloses[htfCloses.length - 1] > htfEma ? 'bullish' : 'bearish';
    }

    // 2. Gather Eyes (Patterns)
    const context = captureMarketContext(klines, undefined, config.agentParams, primaryTf);
    const patterns = context.activePatterns || [];

    // 3. Handshake
    const signal = await engine.generateSignal(klines, btc as any, patterns, htfTrend, orderBook);

    if (signal.signal !== 'HOLD') {
        signalCooldowns.set(pairKey, now);
    }

    return signal;
};

export function getAstraXRegimeAndDirection(config: BotConfig, klinesMap: Map<string, Kline[]>, analyticalTimeframes: string[]) {
    return { regime: 'Matrix V8.6 Ready', direction: 'neutral' as any };
}
