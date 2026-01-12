// services/riskManagementService.ts

import { TradingMode, Agent, Kline, AgentParams, Position, ADXOutput, MACDOutput, BollingerBandsOutput, StochasticRSIOutput, TradeManagementSignal, BotConfig, IchimokuCloudOutput } from '../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV, IchimokuCloud } from 'technicalindicators';
import * as constants from '../constants';
import { calculateSupportResistance, findSwingPoints, analyzeMarketStructure } from './chartAnalysisService';
import { Supertrend, applyTimeframeSettings, getLast, getPenultimate, captureMarketContext, detectRsiDivergence, calculateDailyVwap, analyzeBitcoinState, calculateRsiSlope, getCandleExhaustion, calculateRVOL, VortexIndicator } from './agents/agentUtils';

const MIN_STOP_LOSS_PERCENT = 0.5;
const { TIMEFRAME_ATR_CONFIG, MIN_PROFIT_BUFFER_MULTIPLIER } = constants;

/**
 * Calculates initial stop-loss and take-profit levels.
 * V2.0: Added "Predator Scale" Noise Floor.
 */
export function getInitialAgentTargets(
    klines: Kline[],
    entryPrice: number,
    direction: 'LONG' | 'SHORT',
    originalConfig: BotConfig,
    tradeType?: 'conviction' | 'scalp',
    providedStopLoss?: number,
    providedTakeProfit?: number
): { stopLossPrice: number; takeProfitPrice: number; slReason: 'Agent Logic' | 'Hard Cap' | 'Noise Floor'; agentStopLoss: number; } {
    const config = applyTimeframeSettings(originalConfig);
    const { timeFrame, agent, leverage } = config;
    
    const maxMarginLoss = config.maxMarginLossPercent;
    const isLong = direction === 'LONG';
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);

    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const currentAtr = (getLast(atrValues) as number | undefined) || (entryPrice * 0.01);

    // Hard Limit based on Margin
    const maxPriceDistAllowed = (maxMarginLoss / 100) * (entryPrice / leverage);
    
    // --- V2.0 NOISE FLOOR ---
    // Minimum distance required to survive spread/noise, regardless of what the logic says.
    const noiseFloorMultiplier = ['1m', '3m'].includes(timeFrame) ? 1.5 : 1.2;
    const noiseFloorDist = currentAtr * noiseFloorMultiplier;
    
    const timeframeConfig = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];

    let finalSl: number;
    let finalTp: number;
    let slReason: 'Agent Logic' | 'Hard Cap' | 'Noise Floor' = 'Agent Logic';

    if (providedStopLoss && providedTakeProfit) {
        finalSl = providedStopLoss;
        finalTp = providedTakeProfit;
    } else {
        let finalDist: number;
        if (agent.id === 19) {
            const lookback = tradeType === 'scalp' ? 30 : 60; 
            const recent = klines.slice(-lookback);
            const structuralBase = isLong ? Math.min(...recent.map(k => k.low)) : Math.max(...recent.map(k => k.high));
            finalDist = Math.abs(entryPrice - structuralBase);
        } else if (providedStopLoss) {
            finalDist = Math.abs(entryPrice - providedStopLoss);
        } else {
            finalDist = currentAtr * timeframeConfig.atrMultiplier;
        }

        finalSl = isLong ? entryPrice - finalDist : entryPrice + finalDist;
        const targetRr = tradeType === 'scalp' ? 2.2 : (config.isMinRrEnabled ? 2.8 : 2.4);
        finalTp = isLong ? entryPrice + (finalDist * targetRr) : entryPrice - (finalDist * targetRr);
    }

    // --- APPLY CONSTRAINTS ---
    
    // 1. Noise Floor Check (Widen if too tight)
    const currentDist = Math.abs(entryPrice - finalSl);
    if (currentDist < noiseFloorDist) {
        const adjustment = noiseFloorDist - currentDist;
        finalSl = isLong ? entryPrice - noiseFloorDist : entryPrice + noiseFloorDist;
        // Proportionally widen TP to maintain expectancy
        const rr = Math.abs(finalTp - entryPrice) / currentDist;
        finalTp = isLong ? entryPrice + (noiseFloorDist * rr) : entryPrice - (noiseFloorDist * rr);
        slReason = 'Noise Floor';
    }

    // 2. Margin Hard Cap (Tighten if too wide)
    const afterFloorDist = Math.abs(entryPrice - finalSl);
    if (afterFloorDist > maxPriceDistAllowed) {
        finalSl = isLong ? entryPrice - maxPriceDistAllowed : entryPrice + maxPriceDistAllowed;
        slReason = 'Hard Cap';
    }

    // 3. Final Directional Failsafe
    const isTpInProfitSide = isLong ? finalTp > entryPrice : finalTp < entryPrice;
    if (!isTpInProfitSide) {
        const fallbackDist = currentAtr * 3;
        finalTp = isLong ? entryPrice + fallbackDist : entryPrice - fallbackDist;
    }

    const isSlInRiskSide = isLong ? finalSl < entryPrice : finalSl > entryPrice;
    if (!isSlInRiskSide) {
        const fallbackDist = currentAtr * 2;
        finalSl = isLong ? entryPrice - fallbackDist : entryPrice + fallbackDist;
    }

    return { stopLossPrice: finalSl, takeProfitPrice: finalTp, slReason, agentStopLoss: finalSl };
}

/**
 * V2.0: RE-CALIBRATED UNIVERSAL PROFIT TRAIL
 * Prevents "Choking" trades. BE only moves at 2.2R profit.
 */
export function getMultiStageProfitSecureSignal(
    position: Position,
    currentPrice: number
): TradeManagementSignal {
    const isLong = position.direction === 'LONG';
    const pnlPercent = isLong 
        ? (currentPrice - position.entryPrice) / position.entryPrice 
        : (position.entryPrice - currentPrice) / position.entryPrice;
    
    const riskPercent = position.initialRiskInPrice / position.entryPrice;
    const rMultiple = pnlPercent / riskPercent;
    
    let newTier = position.profitLockTier || 0;
    let newSl: number | undefined;

    // V2.0 Tuning: Increased thresholds to 2.2R/4R/6R
    if (rMultiple >= 6.0 && newTier < 3) {
        newTier = 3;
        newSl = isLong ? position.entryPrice + position.initialRiskInPrice * 3.0 : position.entryPrice - position.initialRiskInPrice * 3.0;
    } else if (rMultiple >= 4.0 && newTier < 2) {
        newTier = 2;
        newSl = isLong ? position.entryPrice + position.initialRiskInPrice * 1.5 : position.entryPrice - position.initialRiskInPrice * 1.5;
    } else if (rMultiple >= 2.2 && newTier < 1) {
        newTier = 1;
        newSl = position.entryPrice; // BE only at 2.2R profit
    }

    if (newSl) {
        const isTighter = isLong ? newSl > position.stopLossPrice : newSl < position.stopLossPrice;
        if (isTighter) {
            return {
                newStopLoss: newSl,
                activeStopLossReason: 'Profit Secure',
                newState: { profitLockTier: newTier },
                reasons: [`Universal: Secured Tier ${newTier} (${rMultiple.toFixed(1)}R reached).`]
            };
        }
    }
    return { reasons: [] };
}

/**
 * THE TRADE GUARDIAN: Zero-Time Invalidation Logic.
 * V2.0: Momentum Panic reduced.
 */
export function getTradeGuardianSignal(
    position: Position,
    klines: Kline[],
    immediateKlines: Kline[] | undefined,
    currentPrice: number,
    btcKlines: Kline[] | undefined
): { action: 'hold' | 'close'; reason?: string } {
    const config = position.botConfigSnapshot;
    if (!config || !config.isTradeGuardianEnabled) return { action: 'hold' };

    const isLong = position.direction === 'LONG';
    
    if (position.invalidationPrice) {
        const isInvalid = isLong ? currentPrice < position.invalidationPrice : currentPrice > position.invalidationPrice;
        if (isInvalid) return { action: 'close', reason: 'Guardian: Structural thesis invalidated.' };
    }

    const closes = klines.map(k => k.close);
    const rsiValues = RSI.calculate({ period: 14, values: closes });
    const lastRsi = getLast(rsiValues) as number | undefined;
    if (lastRsi) {
        // V2.0: Further relaxed to 30/70 for Guardian. Let the SL handle the exit unless it's an extreme reversal.
        const isRsiVeto = isLong ? lastRsi < 30 : lastRsi > 70;
        if (isRsiVeto && position.hasBeenProfitable) {
             return { action: 'close', reason: `Guardian: Extreme Momentum reversal (RSI: ${lastRsi.toFixed(1)})` };
        }
    }

    if (position.agentId !== 25) {
        if (position.candlesSinceEntry > 100) {
            return { action: 'close', reason: `Guardian: Time-decay limit reached.` };
        }
    }

    if (btcKlines && config.isBtcConfirmationEnabled) {
        const btcState = analyzeBitcoinState(btcKlines);
        const btcContradicts = isLong ? btcState.trend === 'bearish' : btcState.trend === 'bullish';
        // V2.0: Only exit on BTC conflict if the trade is in RED and stagnant.
        const pnlR = (isLong ? (currentPrice - position.entryPrice) : (position.entryPrice - currentPrice)) / position.initialRiskInPrice;
        if (btcContradicts && pnlR < -0.5) {
            return { action: 'close', reason: `Guardian: BTC Trend conflict while underwater.` };
        }
    }

    return { action: 'hold' };
}

// --- Re-export standard management functions ---

export function getAgentExitSignal(position: Position, klines: Kline[], currentPrice: number, config: BotConfig): TradeManagementSignal {
    const params = position.agentParamsSnapshot as Required<AgentParams>;
    const isLong = position.direction === 'LONG';
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const closes = klines.map(k => k.close);
    const signal: TradeManagementSignal = { reasons: [] };

    if (position.agentId === 20 || position.agentId === 21) {
        const stValues = Supertrend.calculate({ high: highs, low: lows, close: closes, period: params.stf_atrPeriod || 10, multiplier: params.stf_atrMultiplier || 3 });
        const st = getLast(stValues) as number | undefined;
        if (st !== undefined) {
            const isTighter = isLong ? st > position.stopLossPrice : st < position.stopLossPrice;
            const isValid = isLong ? st < currentPrice : st > currentPrice;
            if (isTighter && isValid) {
                signal.newStopLoss = st;
                signal.activeStopLossReason = 'Agent Trail';
                signal.reasons.push(`Trailing: Supertrend.`);
            }
        }
    }
    return signal;
}

export function validateTradeProfitability(price: number, sl: number, tp: number, direction: 'LONG' | 'SHORT', config: BotConfig): { isValid: boolean; reason: string } {
    const isLong = direction === 'LONG';
    const risk = Math.abs(price - sl);
    const reward = Math.abs(tp - price);
    const rr = risk > 0 ? reward / risk : 0;
    if (config.isMinRrEnabled && rr < constants.MIN_RISK_REWARD_RATIO) return { isValid: false, reason: `❌ VETO: Poor R:R Ratio (${rr.toFixed(2)}:1).` };
    const feeRate = config.takerFeeRate || 0.0005;
    const roundTripFee = price * feeRate * 2;
    if (reward < roundTripFee * constants.MIN_PROFIT_BUFFER_MULTIPLIER) return { isValid: false, reason: `❌ VETO: Profit target does not cover fees.` };
    return { isValid: true, reason: '' };
}

export function getMandatoryBreakevenSignal(position: Position, currentPrice: number): TradeManagementSignal {
    if (position.isBreakevenSet) return { reasons: [] };
    const isLong = position.direction === 'LONG';
    const feeRate = position.takerFeeRate || 0.0005;
    const roundTripFeePercent = feeRate * 2;
    const profitPercent = isLong ? (currentPrice - position.entryPrice) / position.entryPrice : (position.entryPrice - currentPrice) / position.entryPrice;
    if (profitPercent > roundTripFeePercent * 5) { 
        const breakevenPrice = isLong ? position.entryPrice * (1 + feeRate) / (1 - feeRate) : position.entryPrice * (1 - feeRate) / (1 + feeRate);
        return { newStopLoss: breakevenPrice, activeStopLossReason: 'Breakeven', newState: { isBreakevenSet: true }, reasons: ['Mandatory Breakeven (Profit > 5x Fees).'] };
    }
    return { reasons: [] };
}

export function getProfitSpikeSignal(position: Position, currentPrice: number): TradeManagementSignal {
    const isLong = position.direction === 'LONG';
    const pnlPercent = isLong ? (currentPrice - position.entryPrice) / position.entryPrice : (position.entryPrice - currentPrice) / position.entryPrice;
    if (pnlPercent > 0.08 && (position.profitSpikeTier || 0) < 1) {
        const lockPrice = isLong ? currentPrice * 0.98 : currentPrice * 1.02;
        return { newStopLoss: lockPrice, activeStopLossReason: 'Profit Secure', newState: { profitSpikeTier: 1 }, reasons: ['Spike Protector: Locking extreme move.'] };
    }
    return { reasons: [] };
}

export function getAggressiveRangeTrailSignal(position: Position, currentPrice: number): TradeManagementSignal {
    const isLong = position.direction === 'LONG';
    const distToTp = Math.abs(position.takeProfitPrice - currentPrice);
    const totalRange = Math.abs(position.takeProfitPrice - position.entryPrice);
    if (distToTp < totalRange * 0.05 && (position.aggressiveTrailTier || 0) < 1) {
        const newSl = isLong ? currentPrice - (totalRange * 0.01) : currentPrice + (totalRange * 0.01);
        const isTighter = isLong ? (newSl as number) > position.stopLossPrice : (newSl as number) < position.stopLossPrice;
        if (isTighter) return { newStopLoss: newSl, activeStopLossReason: 'Profit Secure', newState: { aggressiveTrailTier: 1 }, reasons: ['Final Stretch: Hyper-trail active.'] };
    }
    return { reasons: [] };
}

export function getAdaptiveTakeProfit(position: Position, klines: Kline[], currentPrice: number): TradeManagementSignal {
    const isLong = position.direction === 'LONG';
    const rsi = getLast(RSI.calculate({ period: 14, values: klines.map(k => k.close) })) as number | undefined;
    if (rsi) {
        const isNearTp = Math.abs(position.takeProfitPrice - currentPrice) / currentPrice < 0.005;
        const isMomentumFading = isLong ? rsi > 72 && rsi < 78 : rsi < 28 && rsi > 22; 
        if (isNearTp && isMomentumFading && !position.adaptiveTpTriggered) {
             return { newTakeProfit: currentPrice, newState: { adaptiveTpTriggered: true }, reasons: ['Adaptive: Momentum fade near target.'] };
        }
    }
    return { reasons: [] };
}
