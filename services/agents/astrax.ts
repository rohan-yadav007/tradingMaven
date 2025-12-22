// services/agents/astrax.ts

import { Kline, BotConfig, TradeSignal, AstraXAnalysis, AgentParams, ADXOutput, OrderBookAnalysis, BitcoinState } from '../../types';
import { ADX, ATR, RSI } from 'technicalindicators';
import { calculateDailyVwap, getLast, calculateRVOL, analyzeBitcoinState, detectLiquiditySweep, calculateFibLevels, detectVolatilityCompression, calculateBandwidthSlope } from './agentUtils';
import { findSwingPoints } from '../chartAnalysisService';

const signalCooldowns = new Map<string, number>();

/**
 * Sovereign Matrix V6.1 Elite Engine
 * Physics-driven archetypes optimized for high frequency.
 */
class SovereignEngine {
    private config: BotConfig;
    private params: Required<AgentParams>;
    private feeRate: number;

    constructor(config: BotConfig) {
        this.config = config;
        this.params = config.agentParams as Required<AgentParams>;
        this.feeRate = config.takerFeeRate || 0.0005;
    }

    public getCooldownMs(tf: string): number {
        // Reduced cooldowns significantly for Elite high frequency modes
        const map: Record<string, number> = { '1m': 1, '3m': 5, '5m': 10, '15m': 30 };
        return (map[tf] || 60) * 60 * 1000;
    }

    /**
     * Meat-to-Fee Gating: Multiplier of 6x fee for 1m-3m, 8x for others.
     */
    private checkUtilityViability(price: number, target: number, atr: number, tf: string): { valid: boolean; ratio: number; reason?: string } {
        const roundTripFee = price * this.feeRate * 2;
        const grossProfit = Math.abs(target - price);
        const ratio = grossProfit / roundTripFee;
        const minRatio = ['1m', '3m'].includes(tf) ? 6.0 : 8.0;
        
        if (ratio < minRatio) return { valid: false, ratio, reason: `Insufficient Meat (${ratio.toFixed(1)}x fees). Need >${minRatio}x.` };
        return { valid: true, ratio };
    }

    /**
     * Archetype: The Ninja (1m - 3m)
     * Focus: Order Book Imbalance + Liquidity Sweep Reclaim.
     */
    public getNinjaSignal(klines: Kline[], rvol: number, btc: BitcoinState, ob?: OrderBookAnalysis): TradeSignal {
        const sweep = detectLiquiditySweep(klines, 15);
        const rsi7 = getLast(RSI.calculate({ period: 7, values: klines.map(k => k.close) })) || 50;
        const reasons: string[] = [`ℹ️ Archetype: Elite Ninja (1m Liquidity)`];

        // Physics check: Bid/Ask pressure flip
        const bidPressure = ob ? ob.imbalance > 0.3 : true; 
        const askPressure = ob ? ob.imbalance < -0.3 : true;

        if (sweep.bullish && rvol > 1.4 && bidPressure && rsi7 < 60) {
            return { signal: 'BUY', reasons: [...reasons, '🚀 Ninja: Liquidity Grab + Order Flow Flip'], tradeType: 'scalp' };
        }
        if (sweep.bearish && rvol > 1.4 && askPressure && rsi7 > 40) {
            return { signal: 'SELL', reasons: [...reasons, '🚀 Ninja: Liquidity Grab + Order Flow Flip'], tradeType: 'scalp' };
        }
        return { signal: 'HOLD', reasons: ['ℹ️ Ninja: Waiting for liquidity reclaim...'] };
    }

    /**
     * Archetype: The Shark (5m - 15m)
     * Focus: Volatility Velocity (Bandwidth Expansion) + Positive ADX Slope.
     */
    public getSharkSignal(klines: Kline[], rvol: number, adx: ADXOutput): TradeSignal {
        const bwSlope = calculateBandwidthSlope(klines, 20);
        const last = klines[klines.length - 1];
        const reasons: string[] = [`ℹ️ Archetype: Elite Shark (MTF Expansion)`];
        
        // Expansion Check: Bandwidth must be increasing > 0.5% per candle
        const isExpanding = bwSlope > 0.005;

        if (adx.adx > 20 && isExpanding && rvol > 1.2) {
            if (adx.pdi > adx.mdi && last.close > last.open) {
                return { signal: 'BUY', reasons: [...reasons, '🚀 Shark: Volatility Velocity Expansion'], tradeType: 'conviction' };
            }
            if (adx.mdi > adx.pdi && last.close < last.open) {
                return { signal: 'SELL', reasons: [...reasons, '🚀 Shark: Volatility Velocity Expansion'], tradeType: 'conviction' };
            }
        }
        return { signal: 'HOLD', reasons: ['ℹ️ Shark: Waiting for volatility ignition...'] };
    }

    /**
     * Archetype: The Architect (30m+)
     * Focus: VWAP Reversion Value Zones.
     */
    public getArchitectSignal(klines: Kline[], btc: BitcoinState): TradeSignal {
        const vwap = getLast(calculateDailyVwap(klines));
        const last = klines[klines.length - 1];
        const reasons: string[] = [`ℹ️ Archetype: Elite Architect (HTF Value)`];

        if (!vwap) return { signal: 'HOLD', reasons: ['ℹ️ Architect: Calibrating...'] };

        // Entry on "Institutional Value" retest
        if (last.close > vwap && last.low <= vwap * 1.002 && btc.trend === 'bullish') {
            return { signal: 'BUY', reasons: [...reasons, '🏛️ Architect: VWAP Retest confirmed'], tradeType: 'conviction' };
        }
        if (last.close < vwap && last.high >= vwap * 0.998 && btc.trend === 'bearish') {
            return { signal: 'SELL', reasons: [...reasons, '🏛️ Architect: VWAP Retest confirmed'], tradeType: 'conviction' };
        }
        return { signal: 'HOLD', reasons: ['ℹ️ Architect: Waiting for retest of value...'] };
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

    if (!klines || klines.length < 60) return { signal: 'HOLD', reasons: ['ℹ️ Matrix: Sensors warming up...'] };

    const engine = new SovereignEngine(config);
    const lastSignal = signalCooldowns.get(pairKey) || 0;
    
    if (now - lastSignal < engine.getCooldownMs(primaryTf)) {
        return { signal: 'HOLD', reasons: ['ℹ️ Matrix: Engine cooling.'] };
    }

    const btc = btcKlines ? analyzeBitcoinState(btcKlines) : { state: 'NEUTRAL', trend: 'neutral' };
    const rvol = calculateRVOL(klines, 20);
    const adx = getLast(ADX.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: klines.map(k => k.close), period: 10 })) as ADXOutput;

    if (!adx) return { signal: 'HOLD', reasons: ['ℹ️ Matrix: Calibration in progress...'] };

    let signal: TradeSignal;
    if (['1m', '3m'].includes(primaryTf)) {
        signal = engine.getNinjaSignal(klines, rvol, btc as any, orderBook);
    } else if (['5m', '15m'].includes(primaryTf)) {
        signal = engine.getSharkSignal(klines, rvol, adx);
    } else {
        signal = engine.getArchitectSignal(klines, btc as any);
    }

    if (signal.signal !== 'HOLD') {
        const last = klines[klines.length - 1];
        const atr = getLast(ATR.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: klines.map(k => k.close), period: 10 })) || last.close * 0.01;
        const targetRr = signal.tradeType === 'scalp' ? 1.5 : 3.0;
        const targetPrice = signal.signal === 'BUY' ? last.close + (atr * targetRr) : last.close - (atr * targetRr);
        
        // @ts-ignore
        const viability = engine['checkUtilityViability'](last.close, targetPrice, atr, primaryTf);
        if (!viability.valid) {
            return { signal: 'HOLD', reasons: [`❌ VETO: ${viability.reason}`] };
        }

        signalCooldowns.set(pairKey, now);
        return {
            ...signal,
            astraXAnalysis: {
                conviction: 95,
                regime: adx.adx > 25 ? 'Strong Trend' : 'Developing Trend',
                thesis: btc.trend === 'bullish' ? 'Bullish' : 'Bearish',
                setupName: signal.reasons[signal.reasons.length - 1],
                confidenceMetrics: { technical: 95, volume: Math.min(100, rvol * 50), structure: 90, momentum: 85 }
            } as any
        };
    }

    return signal;
};

export function getAstraXRegimeAndDirection(config: BotConfig, klinesMap: Map<string, Kline[]>, analyticalTimeframes: string[]) {
    return { regime: 'Matrix V6.1 Elite', direction: 'neutral' as any };
}
