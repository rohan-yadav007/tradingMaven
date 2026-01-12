// services/agents/omega.ts

import { Kline, BotConfig, TradeSignal, AgentParams, OmegaAnalysis, BitcoinState, Position, TradeManagementSignal } from '../../types';
import { EMA, ATR, BollingerBands, RSI } from 'technicalindicators';
import { getLast, detectLiquiditySweep, detectFairValueGaps, calculateRsiSlope } from './agentUtils';
import { findSwingPoints } from '../chartAnalysisService';

/**
 * Omega V2.0: The Sovereign Predator (Time-Agnostic)
 * Multi-dimensional convergence engine. 
 */
class OmegaEngine {
    private config: BotConfig;
    private params: Required<AgentParams>;

    constructor(config: BotConfig) {
        this.config = config;
        this.params = config.agentParams as Required<AgentParams>;
    }

    private getAggressivenessScaling() {
        const level = this.params.omega_frequencyAggressiveness || 3;
        return {
            thresholdOffset: (3 - level) * 7.5,
            expectancyMultiplier: 1 - ((level - 3) * 0.15),
        };
    }

    private getMacroScore(klinesMap: Map<string, Kline[]>): { score: number, bias: 'bull' | 'bear' | 'neutral' } {
        const d1 = klinesMap.get('1d');
        const h4 = klinesMap.get('4h');
        if (!d1 || !h4) return { score: 0, bias: 'neutral' };

        const d1Closes = d1.map(k => k.close);
        const d1Ema = getLast(EMA.calculate({ period: 200, values: d1Closes })) as number | undefined;
        const h4Closes = h4.map(k => k.close);
        const h4Ema = getLast(EMA.calculate({ period: 50, values: h4Closes })) as number | undefined;

        if (!d1Ema || !h4Ema) return { score: 0, bias: 'neutral' };

        const lastD1 = d1Closes[d1Closes.length - 1];
        const lastH4 = h4Closes[h4Closes.length - 1];

        const d1Bias = lastD1 > d1Ema;
        const h4Bias = lastH4 > h4Ema;

        if (d1Bias && h4Bias) return { score: 100, bias: 'bull' };
        if (!d1Bias && !h4Bias) return { score: 100, bias: 'bear' };
        
        return { score: 25, bias: 'neutral' }; 
    }

    private getStructuralScore(klinesMap: Map<string, Kline[]>, bias: 'bull' | 'bear' | 'neutral'): { score: number, target?: number, reasons: string[] } {
        const m15 = klinesMap.get('15m');
        if (!m15 || m15.length === 0) return { score: 0, reasons: [] };

        const currentPrice = m15[m15.length - 1].close;
        const fvgs = detectFairValueGaps(m15, this.params.omega_fvgLookback);
        
        const targetFvg = fvgs.find(f => {
            if (f.filled) return false;
            if (bias === 'bull') return f.type === 'FVG Bearish' && f.bottom > currentPrice;
            if (bias === 'bear') return f.type === 'FVG Bullish' && f.top < currentPrice;
            return false;
        });

        let score = 0;
        const reasons: string[] = [];
        let targetPrice: number | undefined;

        if (targetFvg) {
            score += 60;
            targetPrice = bias === 'bull' ? targetFvg.top : targetFvg.bottom;
            reasons.push(`ℹ️ Objective: Unmitigated Structural Void Locked`);
        } else {
            const swings = findSwingPoints(m15, 10);
            const targetSwing = bias === 'bull' 
                ? swings.filter(s => s.type === 'high' && s.price > currentPrice).slice(-1)[0]
                : swings.filter(s => s.type === 'low' && s.price < currentPrice).slice(-1)[0];
            
            if (targetSwing) {
                targetPrice = targetSwing.price;
                score += 30; 
                reasons.push(`ℹ️ Objective: External Structural Pivot`);
            }
        }

        const last15m = m15.slice(-6);
        if (last15m.length >= 6) {
            const isBOSBull = last15m[last15m.length - 1].close > Math.max(...last15m.slice(0, -6).map(k => k.high));
            const isBOSBear = last15m[last15m.length - 1].close < Math.min(...last15m.slice(0, -6).map(k => k.low));

            if (bias === 'bull' && isBOSBull) { score += 40; reasons.push("✅ MTF Expansion: Breaking Structure"); }
            if (bias === 'bear' && isBOSBear) { score += 40; reasons.push("✅ MTF Expansion: Breaking Structure"); }
        }

        return { score: Math.min(100, score), target: targetPrice, reasons };
    }

    private getMicroScore(klinesMap: Map<string, Kline[]>, bias: 'bull' | 'bear' | 'neutral'): { score: number, reasons: string[], sl?: number } {
        const m1 = klinesMap.get('1m');
        if (!m1) return { score: 0, reasons: [] };

        const sweep = detectLiquiditySweep(m1, this.params.omega_sweepDepth);
        let score = 0;
        let sl: number | undefined;
        const reasons: string[] = [];

        if (bias === 'bull' && sweep.bullish) {
            score = 100;
            reasons.push("🚀 Micro: Institutional Trap (Spring)");
            sl = Math.min(...m1.slice(-5).map(k => k.low)); 
        }
        if (bias === 'bear' && sweep.bearish) {
            score = 100;
            reasons.push("🚀 Micro: Institutional Trap (Upthrust)");
            sl = Math.max(...m1.slice(-5).map(k => k.high));
        }

        return { score, reasons, sl };
    }

    public async generateSignal(klinesMap: Map<string, Kline[]>, btc: BitcoinState): Promise<TradeSignal> {
        const macro = this.getMacroScore(klinesMap);
        const structural = this.getStructuralScore(klinesMap, macro.bias);
        const micro = this.getMicroScore(klinesMap, macro.bias);

        const scaling = this.getAggressivenessScaling();
        const baseConviction = (macro.score * 0.3) + (structural.score * 0.4) + (micro.score * 0.3);
        const effectiveThreshold = this.params.omega_matrixThreshold + scaling.thresholdOffset;
        const isBull = macro.bias === 'bull';

        const omegaAnalysis: OmegaAnalysis = {
            conviction: Math.round(baseConviction),
            layers: { macro: macro.score, structural: structural.score, micro: micro.score },
            targets: { fvgPrice: structural.target }
        };

        if (baseConviction >= effectiveThreshold && macro.bias !== 'neutral') {
            const entry = klinesMap.get('1m')?.slice(-1)[0]?.close || 0;
            const target = structural.target || (isBull ? entry * 1.02 : entry * 0.98);
            
            const isTpValid = isBull ? target > entry : target < entry;
            if (!isTpValid) return { signal: 'HOLD', reasons: ["❌ OMEGA VETO: Institutional Target logic out of sync."], omegaAnalysis };

            const stop = micro.sl || (isBull ? entry * 0.99 : entry * 1.01);
            
            return {
                signal: isBull ? 'BUY' : 'SELL',
                reasons: [`ℹ️ Omega Matrix: ${baseConviction.toFixed(0)}% Conviction (Level ${this.params.omega_frequencyAggressiveness})`, ...structural.reasons, ...micro.reasons],
                entryPrice: entry,
                takeProfitPrice: target,
                stopLossPrice: stop,
                tradeType: 'conviction',
                omegaAnalysis,
                btcContext: btc
            };
        }

        return { signal: 'HOLD', reasons: ['ℹ️ Matrix: Converging footprints...'], omegaAnalysis };
    }
}

/**
 * Sovereign Management Engine for Omega V2.0 (TF-Agnostic)
 * Uses Traversed Volatility (TV) and P2P Buffers.
 */
export class SovereignManagementEngine {
    public static manage(
        position: Position,
        currentPrice: number,
        klines: Kline[],
        klinesMap: Map<string, Kline[]>
    ): TradeManagementSignal {
        const signal: TradeManagementSignal = { reasons: [] };
        const isLong = position.direction === 'LONG';
        
        // --- Agnostic Volatility Baseline ---
        const m1 = klinesMap.get('1m') || klines;
        const atrVals = ATR.calculate({ high: m1.map(k=>k.high), low: m1.map(k=>k.low), close: m1.map(k=>k.close), period: 14 });
        const lastAtr = (getLast(atrVals) as number) || (position.entryPrice * 0.005);

        // --- TRAVERSED VOLATILITY (TV) ---
        const recentKlines = klines.slice(-position.candlesSinceEntry - 1);
        const traversedVolatility = recentKlines.reduce((sum, k, i) => {
            if (i === 0) return 0;
            return sum + Math.abs(k.close - recentKlines[i-1].close);
        }, 0);
        
        const tvInAtr = traversedVolatility / lastAtr;

        // 1. COMBAT DISPLACEMENT IMMUNITY
        // Refuse to tighten Stop Loss until the price has moved 2.5 ATRs.
        if (tvInAtr < 2.5) {
            return signal;
        }

        // 2. MTF GEOMETRIC RATCHET (Purely Structural)
        const m15 = klinesMap.get('15m');
        if (m15) {
            const swings = findSwingPoints(m15, 8);
            const anchor = isLong 
                ? swings.filter(s => s.type === 'low').slice(-1)[0]
                : swings.filter(s => s.type === 'high').slice(-1)[0];
            
            if (anchor) {
                const isTighter = isLong ? anchor.price > position.stopLossPrice : anchor.price < position.stopLossPrice;
                // V2.0: P2P Buffer (Pivot-to-Price)
                // Anchor must be at least 0.7 ATR from current price to avoid choke.
                const isSafeDist = isLong ? anchor.price < (currentPrice - (lastAtr * 0.7)) : anchor.price > (currentPrice + (lastAtr * 0.7));
                
                if (isTighter && isSafeDist) {
                    signal.newStopLoss = anchor.price;
                    signal.activeStopLossReason = 'Sovereign Ratchet';
                    signal.reasons.push(`Ratchet: MTF Anchor Shift.`);
                }
            }
        }

        // 3. ALPHA ENTROPY DECAY (Volatility-Based)
        if (tvInAtr > 25.0) {
            const pnlR = (isLong ? (currentPrice - position.entryPrice) : (position.entryPrice - currentPrice)) / position.initialRiskInPrice;
            if (pnlR < 0.2 && pnlR > -0.2) { 
                signal.newStopLoss = position.entryPrice;
                signal.activeStopLossReason = 'Breakeven';
                signal.reasons.push(`Entropy: High churn without expansion. BE locked.`);
            }
        }

        // 4. VOLATILITY COMPRESSION (V-COMP)
        const bbValues = BollingerBands.calculate({ period: 20, stdDev: 2, values: m1.map(k=>k.close) });
        const lastBB = getLast(bbValues) as any;
        if (lastBB) {
            const bbw = (lastBB.upper - lastBB.lower) / lastBB.middle;
            const pnlR = Math.abs(currentPrice - position.entryPrice) / position.initialRiskInPrice;
            
            if (bbw < 0.008 && pnlR > 1.5) { 
                const securePrice = isLong ? currentPrice - (lastAtr * 0.5) : currentPrice + (lastAtr * 0.5);
                const isImprovement = isLong ? securePrice > (signal.newStopLoss || position.stopLossPrice) : securePrice < (signal.newStopLoss || position.stopLossPrice);
                if (isImprovement) {
                    signal.newStopLoss = securePrice;
                    signal.activeStopLossReason = 'Profit Secure';
                    signal.reasons.push(`V-COMP: Compressing risk on squeeze.`);
                }
            }
        }

        // 5. MOMENTUM GRAVITY
        const rsiValues = RSI.calculate({ period: 14, values: m1.map(k=>k.close) });
        const slope = calculateRsiSlope(rsiValues);
        const distToTp = Math.abs(position.takeProfitPrice - currentPrice) / currentPrice;
        
        if (distToTp < 0.003 && (isLong ? slope < -4.5 : slope > 4.5)) {
            signal.newTakeProfit = currentPrice;
            signal.reasons.push(`Gravity: Secure fill on momentum shift.`);
        }

        return signal;
    }
}

export const getOmegaSignal = async (config: BotConfig, klinesMap: Map<string, Kline[]>, btc: BitcoinState): Promise<TradeSignal> => {
    const engine = new OmegaEngine(config);
    return await engine.generateSignal(klinesMap, btc);
};
