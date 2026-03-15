
// services/riskManagementService.ts

import { TradingMode, Agent, Kline, AgentParams, Position, ADXOutput, MACDOutput, BollingerBandsOutput, StochasticRSIOutput, TradeManagementSignal, BotConfig, IchimokuCloudOutput } from '../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV, IchimokuCloud } from 'technicalindicators';
import * as constants from '../constants';
import { calculateSupportResistance, findSwingPoints, analyzeMarketStructure } from './chartAnalysisService';
import { Supertrend, applyTimeframeSettings, getLast, getPenultimate, captureMarketContext, detectRsiDivergence, calculateDailyVwap, analyzeBitcoinState, calculateRsiSlope, getCandleExhaustion, calculateRVOL, VortexIndicator } from './agents/agentUtils';
import { getVolatilityRegime } from './indicators';

const MIN_STOP_LOSS_PERCENT = 0.5;
const { TIMEFRAME_ATR_CONFIG, MIN_PROFIT_BUFFER_MULTIPLIER } = constants;

/**
 * Calculates the liquidation price for an isolated margin futures position.
 * Formula (Binance USD-M): LONG  = entry × (1 − 1/leverage + MMR)
 *                          SHORT = entry × (1 + 1/leverage − MMR)
 * @param mmr  Maintenance Margin Rate — defaults to 0.005 (0.5%), valid for most perpetuals.
 */
export function calculateLiquidationPrice(entry: number, leverage: number, direction: 'LONG' | 'SHORT', mmr = 0.005): number {
    return direction === 'LONG'
        ? entry * (1 - 1 / leverage + mmr)
        : entry * (1 + 1 / leverage - mmr);
}

/**
 * Computes a fee-aware SL hard cap and risk-based position size.
 *
 * Hard cap: the SL is pulled inside entry so that (price_move × notional + round-trip fees)
 * equals exactly maxRiskPct% of the margin (investmentAmount).
 *
 * Risk-based sizing (isDynamicSizing=true): position is sized so the total loss at the
 * (possibly capped) SL equals (maxRiskPct% × investmentAmount × convictionMultiplier).
 * If that size would exceed the standard full position (investment × leverage / entry),
 * the standard size is used instead — the SL is already within limits.
 */
export function calculateRiskBasedPosition(
    entryPrice: number,
    agentSL: number,
    investmentAmount: number,
    leverage: number,
    maxRiskPct: number,
    takerFeeRate: number,
    isDynamicSizing: boolean,
    convictionMultiplier: number = 1.0,
): {
    finalSL: number;
    tradeSize: number;
    effectiveInvestment: number;
    slReason: 'Agent Logic' | 'Hard Cap';
    sizingLog: string;
} {
    const isLong = agentSL < entryPrice;
    const standardPositionValue = investmentAmount * leverage;              // notional $
    const roundTripFeeDollars   = standardPositionValue * takerFeeRate * 2; // open + close fee
    const maxDollarLoss         = (maxRiskPct / 100) * investmentAmount;
    const slDollarBudget        = Math.max(0, maxDollarLoss - roundTripFeeDollars);
    // max price distance the SL can be from entry before total loss exceeds the cap
    const maxSlDist = standardPositionValue > 0
        ? (slDollarBudget * entryPrice) / standardPositionValue
        : 0;

    // --- Hard cap: move SL inside entry if agent placed it too far ---
    const agentSlDist = Math.abs(entryPrice - agentSL);
    let finalSL  = agentSL;
    let slReason: 'Agent Logic' | 'Hard Cap' = 'Agent Logic';

    if (maxSlDist > 0 && agentSlDist > maxSlDist) {
        finalSL  = isLong ? entryPrice - maxSlDist : entryPrice + maxSlDist;
        slReason = 'Hard Cap';
    }

    const finalSlDist  = Math.abs(entryPrice - finalSL);
    const standardSize = standardPositionValue / entryPrice;
    let tradeSize           = standardSize;
    let effectiveInvestment = investmentAmount;
    let sizingLog           = '';

    // --- Risk-based sizing ---
    if (isDynamicSizing && finalSlDist > 0) {
        const clampedConviction = Math.max(0.1, Math.min(1.0, convictionMultiplier));
        const targetRiskDollars = maxDollarLoss * clampedConviction;
        const feePerUnit        = entryPrice * takerFeeRate * 2;
        const riskBasedSize     = targetRiskDollars / (finalSlDist + feePerUnit);
        const riskBasedMargin   = (riskBasedSize * entryPrice) / leverage;

        if (riskBasedMargin <= investmentAmount) {
            tradeSize           = riskBasedSize;
            effectiveInvestment = riskBasedMargin;
            const pct = Math.round(clampedConviction * 100);
            if (pct < 100) {
                sizingLog = ` (Risk-Sized: ${pct}% conviction → $${effectiveInvestment.toFixed(2)} margin)`;
            }
        }
        // else: SL is tight enough that full position risk is already ≤ cap — use standard
    }

    if (slReason === 'Hard Cap') {
        const distPct = (finalSlDist / entryPrice * 100).toFixed(3);
        sizingLog += ` [SL Hard Cap: ${distPct}% dist, max ${(maxRiskPct)}% risk]`;
    }

    return { finalSL, tradeSize, effectiveInvestment, slReason, sizingLog };
}

/**
 * Calculates initial stop-loss and take-profit levels.
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
    
    const isLong = direction === 'LONG';
    const maxMarginLoss = config.maxMarginLossPercent;

    // Hard Cap: fee-aware so total loss (price move + round-trip fees) = maxMarginLoss% of margin.
    // totalFees = positionSize × takerFeeRate × 2  (open + close)
    // priceLossBudget = maxMarginLoss% × investmentAmount − totalFees
    // maxPriceDist = priceLossBudget / (positionSize / entryPrice)
    const positionSize = config.investmentAmount * leverage;
    const roundTripFee = positionSize * config.takerFeeRate * 2;
    const maxTotalLoss = (maxMarginLoss / 100) * config.investmentAmount;
    const priceLossBudget = Math.max(0, maxTotalLoss - roundTripFee);
    const maxPriceDistAllowed = (priceLossBudget * entryPrice) / positionSize;

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);

    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const currentAtr = (getLast(atrValues) as number | undefined) || (entryPrice * 0.01);

    // Volatility Governor: Adjust Noise Floor based on regime
    const regime = getVolatilityRegime(currentAtr, entryPrice);
    let noiseFloorMultiplier = ['1m', '3m', '5m'].includes(timeFrame) ? 1.5 : 1.2;
    
    if (regime === 'High') noiseFloorMultiplier *= 1.5; // Widen stops in high volatility
    
    const noiseFloorDist = currentAtr * noiseFloorMultiplier;

    // --- OMEGA SOVEREIGN SYNC ---
    if (agent.id === 25) {
         let finalSl = providedStopLoss || (isLong ? entryPrice * 0.99 : entryPrice * 1.01);
         let finalTp = providedTakeProfit || (isLong ? entryPrice * 1.03 : entryPrice * 0.97);
         let slReason: 'Agent Logic' | 'Hard Cap' | 'Noise Floor' | 'Rejected: Hard Cap < Noise Floor' = 'Agent Logic';

         // 1. Noise Floor Check
         const requestedDist = Math.abs(entryPrice - finalSl);
         if (requestedDist < noiseFloorDist) {
             finalSl = isLong ? entryPrice - noiseFloorDist : entryPrice + noiseFloorDist;
             slReason = 'Noise Floor';
         }

         // 2. Leverage Constraint Sync
         const afterFloorDist = Math.abs(entryPrice - finalSl);
         if (afterFloorDist > maxPriceDistAllowed) {
             if (maxPriceDistAllowed < noiseFloorDist) {
                 slReason = 'Rejected: Hard Cap < Noise Floor';
             } else {
                 finalSl = isLong ? entryPrice - maxPriceDistAllowed : entryPrice + maxPriceDistAllowed;
                 slReason = 'Hard Cap';
             }
         }

         return { 
             stopLossPrice: finalSl, 
             takeProfitPrice: finalTp, 
             slReason: slReason as any, 
             agentStopLoss: providedStopLoss || finalSl 
         };
    }

    const timeframeConfig = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];

    let finalSl: number;
    let finalTp: number;
    let slReason: 'Agent Logic' | 'Hard Cap' | 'Noise Floor' = 'Agent Logic';

    if (providedStopLoss && providedTakeProfit) {
        finalSl = providedStopLoss;
        finalTp = providedTakeProfit;
    } else {
        let finalDist = currentAtr * timeframeConfig.atrMultiplier;
        finalSl = isLong ? entryPrice - finalDist : entryPrice + finalDist;
        const targetRr = tradeType === 'scalp' ? 2.2 : (config.isMinRrEnabled ? 2.8 : 2.4);
        finalTp = isLong ? entryPrice + (finalDist * targetRr) : entryPrice - (finalDist * targetRr);
    }

    // 1. Noise Floor Check
    const currentDist = Math.abs(entryPrice - finalSl);
    if (currentDist < noiseFloorDist) {
        finalSl = isLong ? entryPrice - noiseFloorDist : entryPrice + noiseFloorDist;
        const rr = currentDist > 0 ? Math.abs(finalTp - entryPrice) / currentDist : 2.5;
        finalTp = isLong ? entryPrice + (noiseFloorDist * (rr || 2.5)) : entryPrice - (noiseFloorDist * (rr || 2.5));
        slReason = 'Noise Floor';
    }

    // 2. Margin Hard Cap
    const afterFloorDist = Math.abs(entryPrice - finalSl);
    if (afterFloorDist > maxPriceDistAllowed) {
        finalSl = isLong ? entryPrice - maxPriceDistAllowed : entryPrice + maxPriceDistAllowed;
        slReason = 'Hard Cap';
    }

    return { stopLossPrice: finalSl, takeProfitPrice: finalTp, slReason, agentStopLoss: finalSl };
}

/**
 * Dynamic Profit Trail — tiers and ATR trail scale with volatility regime.
 * High volatility → wider tiers (harder targets, more breathing room).
 * Low volatility  → tighter tiers (easier targets, lock profits earlier).
 */
export function getMultiStageProfitSecureSignal(
    position: Position,
    currentPrice: number,
    klines?: Kline[]
): TradeManagementSignal {
    // Omega/Apex manage their own ratchet via SovereignManagementEngine / ApexManagementEngine
    if (position.agentId === 25 || position.agentId === 26) return { reasons: [] };

    const isLong = position.direction === 'LONG';
    const pnlPercent = isLong
        ? (currentPrice - position.entryPrice) / position.entryPrice
        : (position.entryPrice - currentPrice) / position.entryPrice;

    const riskPercent = position.initialRiskInPrice / position.entryPrice;
    const rMultiple = pnlPercent / riskPercent;

    // --- Dynamic tier calibration based on volatility regime ---
    let tier1R = 2.2, tier2R = 4.0, tier3R = 6.0;
    let lock1R = 0,   lock2R = 1.5, lock3R = 3.0;
    let regime = 'Normal';

    if (klines && klines.length >= 20) {
        const atrVals = ATR.calculate({
            high: klines.map(k => k.high),
            low:  klines.map(k => k.low),
            close: klines.map(k => k.close),
            period: 14,
        });
        const currentAtr = getLast(atrVals) as number | undefined;
        if (currentAtr && currentAtr > 0) {
            regime = getVolatilityRegime(currentAtr, currentPrice);
        }
    }

    if (regime === 'High') {
        // Widen tiers: market is noisy, don't lock too early
        tier1R = 3.0; tier2R = 5.0; tier3R = 8.0;
        lock1R = 0;   lock2R = 2.0; lock3R = 4.0;
    } else if (regime === 'Low') {
        // Tight tiers: clean moves, capture gains quickly
        tier1R = 1.8; tier2R = 3.0; tier3R = 5.0;
        lock1R = 0;   lock2R = 1.0; lock3R = 2.5;
    }

    let newTier = position.profitLockTier || 0;
    let newSl: number | undefined;

    if (rMultiple >= tier3R && newTier < 3) {
        newTier = 3;
        newSl = isLong
            ? position.entryPrice + position.initialRiskInPrice * lock3R
            : position.entryPrice - position.initialRiskInPrice * lock3R;
    } else if (rMultiple >= tier2R && newTier < 2) {
        newTier = 2;
        newSl = isLong
            ? position.entryPrice + position.initialRiskInPrice * lock2R
            : position.entryPrice - position.initialRiskInPrice * lock2R;
    } else if (rMultiple >= tier1R && newTier < 1) {
        newTier = 1;
        newSl = isLong
            ? position.entryPrice + position.initialRiskInPrice * lock1R
            : position.entryPrice - position.initialRiskInPrice * lock1R;
    }

    if (newSl !== undefined) {
        const isTighter = isLong ? newSl > position.stopLossPrice : newSl < position.stopLossPrice;
        if (isTighter) {
            return {
                newStopLoss: newSl,
                activeStopLossReason: 'Profit Secure',
                newState: { profitLockTier: newTier },
                reasons: [`Dynamic Secure Tier ${newTier} [${regime}] (${rMultiple.toFixed(1)}R → locked ${newTier === 1 ? 'breakeven' : newTier === 2 ? lock2R + 'R' : lock3R + 'R'}).`],
            };
        }
    }
    return { reasons: [] };
}

/**
 * THE TRADE GUARDIAN
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
    const lastKline = klines[klines.length - 1];
    
    if (position.agentId === 25 || position.agentId === 26) {
        // Structural invalidation check
        if (position.invalidationPrice) {
            const buffer = position.entryPrice * 0.001;
            const isInvalid = isLong
                ? currentPrice < (position.invalidationPrice - buffer)
                : currentPrice > (position.invalidationPrice + buffer);
            if (isInvalid) {
                return { action: 'close', reason: 'Guardian: Structural Invalidation (Hard Level Breach).' };
            }
        }

        // Liquidation proximity emergency close
        // Uses the real Binance liq price stored at entry (live) or computed formula (backtest)
        const liqPrice: number | undefined = position.liquidationPrice
            ?? (position.leverage > 1 ? calculateLiquidationPrice(position.entryPrice, position.leverage, position.direction as 'LONG' | 'SHORT') : undefined);

        if (liqPrice && liqPrice > 0) {
            const highs = klines.map(k => k.high);
            const lows  = klines.map(k => k.low);
            const closes = klines.map(k => k.close);
            const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
            const atr = (getLast(atrValues) as number | undefined) || (position.entryPrice * 0.005);
            const dangerZone = atr * 1.5;

            const approachingLiq = isLong
                ? currentPrice < liqPrice + dangerZone
                : currentPrice > liqPrice - dangerZone;

            if (approachingLiq) {
                const distPct = (Math.abs(currentPrice - liqPrice) / position.entryPrice * 100).toFixed(2);
                return { action: 'close', reason: `Guardian: Emergency Close — price within ${distPct}% of liquidation (${liqPrice.toFixed(position.pricePrecision ?? 4)}).` };
            }
        }

        // Capital imprisonment prevention: after breakeven is locked, if price has not
        // made meaningful progress toward TP in 40+ candles, free the capital.
        // "Breakeven locked" = Ratchet set isBreakevenSet OR TP-lock Stage 1 fired.
        const tpLockStage = (position as any).tpLockStage as number | undefined;
        const beEngaged = position.isBreakevenSet || (tpLockStage !== undefined && tpLockStage >= 1);
        if (beEngaged && position.takeProfitPrice) {
            const totalRange = Math.abs(position.takeProfitPrice - position.entryPrice);
            if (totalRange > 0) {
                const progressToTp = isLong
                    ? (currentPrice - position.entryPrice) / totalRange
                    : (position.entryPrice - currentPrice) / totalRange;
                const candles = position.candlesSinceEntry || 0;
                // 40 candles (~3.3h on 5m) at breakeven with <15% TP progress → zombie, close.
                if (candles > 40 && progressToTp < 0.15) {
                    return {
                        action: 'close',
                        reason: `Guardian: Capital freed — ${candles} candles at breakeven, only ${(progressToTp * 100).toFixed(0)}% toward TP.`,
                    };
                }
            }
        }

        return { action: 'hold' };
    }

    const pnlR = (isLong ? (currentPrice - position.entryPrice) : (position.entryPrice - currentPrice)) / position.initialRiskInPrice;
    if (pnlR < -0.3 && lastKline && lastKline.volume) {
        const volumes = klines.map(k => k.volume || 0);
        const volSlice = volumes.slice(-21, -1);
        const avgVol = volSlice.reduce((a, b) => a + b, 0) / (volSlice.length || 1);
        
        const isPanicCandle = isLong 
            ? lastKline.close < lastKline.open && lastKline.volume > avgVol * 4 
            : lastKline.close > lastKline.open && lastKline.volume > avgVol * 4;

        if (isPanicCandle) {
             return { action: 'close', reason: `Guardian: High Volume Panic against position (${(lastKline.volume/avgVol).toFixed(1)}x RVOL).` };
        }
    }

    return { action: 'hold' };
}

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
    const minRr = config.minRrRatio ?? constants.MIN_RISK_REWARD_RATIO;
    if (config.isMinRrEnabled && rr < minRr) return { isValid: false, reason: `❌ VETO: Poor R:R Ratio (${rr.toFixed(2)}:1 < ${minRr.toFixed(1)}:1).` };
    const feeRate = config.takerFeeRate || 0.0005;
    const roundTripFee = price * feeRate * 2;
    if (reward < roundTripFee * constants.MIN_PROFIT_BUFFER_MULTIPLIER) return { isValid: false, reason: `❌ VETO: Profit target does not cover fees.` };

    // Liquidation Safety Check (futures only)
    const leverage = config.leverage ?? 1;
    if (leverage > 1) {
        const liqPrice = calculateLiquidationPrice(price, leverage, direction);
        // SL must be at least 15% of the liq-to-entry distance away from liq price
        const liqToEntry = Math.abs(price - liqPrice);
        const safeBuffer = liqToEntry * 0.15;
        const slBeyondLiq = isLong ? sl <= liqPrice : sl >= liqPrice;
        const slTooClose  = isLong ? sl < liqPrice + safeBuffer : sl > liqPrice - safeBuffer;
        if (slBeyondLiq) {
            return { isValid: false, reason: `❌ VETO: SL (${sl.toFixed(4)}) is at or beyond liquidation price (${liqPrice.toFixed(4)}). Trade would liquidate before SL fires.` };
        }
        if (slTooClose) {
            const slDistPct = (Math.abs(sl - liqPrice) / price * 100).toFixed(2);
            return { isValid: false, reason: `❌ VETO: SL is only ${slDistPct}% from liquidation price at ${leverage}x leverage. Risk of gap liquidation too high.` };
        }
    }

    return { isValid: true, reason: '' };
}

export function getMandatoryBreakevenSignal(position: Position, currentPrice: number): TradeManagementSignal {
    if (position.agentId === 25 || position.agentId === 26) return { reasons: [] };
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
    if (position.agentId === 25 || position.agentId === 26) return { reasons: [] };
    const isLong = position.direction === 'LONG';
    const pnlPercent = isLong ? (currentPrice - position.entryPrice) / position.entryPrice : (position.entryPrice - currentPrice) / position.entryPrice;
    if (pnlPercent > 0.08 && (position.profitSpikeTier || 0) < 1) {
        const lockPrice = isLong ? currentPrice * 0.98 : currentPrice * 1.02;
        return { newStopLoss: lockPrice, activeStopLossReason: 'Profit Secure', newState: { profitSpikeTier: 1 }, reasons: ['Spike Protector: Locking extreme move.'] };
    }
    return { reasons: [] };
}

export function getAggressiveRangeTrailSignal(position: Position, currentPrice: number): TradeManagementSignal {
    if (position.agentId === 25 || position.agentId === 26) return { reasons: [] };
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
    return { reasons: [] };
}

/**
 * TP-Proportional Profit Locking
 * Locks profit in 6 accelerating stages based on distance REMAINING to TP.
 * Activates only when position has a concrete takeProfitPrice.
 * Fee-aware: true breakeven = entry + round-trip fee cost.
 *
 * Stage thresholds (remaining % of TP distance):
 *   Stage 1 ≤62% → fee-adjusted breakeven
 *   Stage 2 ≤45% → entry + 18% of TP range
 *   Stage 3 ≤30% → entry + 38% of TP range
 *   Stage 4 ≤18% → entry + 58% of TP range
 *   Stage 5 ≤8%  → entry + 78% of TP range
 *   Stage 6 ≤3%  → hyper-trail (1% of range behind current price)
 *
 * @param modelDelta  Optional live model score delta; if ≤-15, stages trigger
 *                    10% earlier (price treated as 10% closer to TP).
 */
export function getTPProportionalLockSignal(
    position: Position,
    currentPrice: number,
    modelDelta?: number
): TradeManagementSignal {
    if (!position.takeProfitPrice) return { reasons: [] };

    const isLong      = position.direction === 'LONG';
    const totalRange  = Math.abs(position.takeProfitPrice - position.entryPrice);
    if (totalRange === 0) return { reasons: [] };

    const distToTp = isLong
        ? position.takeProfitPrice - currentPrice
        : currentPrice - position.takeProfitPrice;

    // Price moved past TP or hasn't moved toward it at all
    if (distToTp < 0 || distToTp >= totalRange) return { reasons: [] };

    // remainingPct: 100 = at entry, 0 = at TP
    let remainingPct = (distToTp / totalRange) * 100;

    // Model-aware acceleration: strong opposing signal → treat as 10% closer to TP
    if (modelDelta !== undefined && modelDelta <= -15) {
        remainingPct = Math.max(0, remainingPct - 10);
    }

    const currentStage = position.tpLockStage || 0;
    const feeRate      = position.takerFeeRate || 0.0004;
    const roundTrip    = feeRate * 2;

    // Fee-adjusted breakeven — entry + cost to open AND close the trade
    const trueBreakeven = isLong
        ? position.entryPrice * (1 + roundTrip)
        : position.entryPrice * (1 - roundTrip);

    const stages = [
        { threshold: 62, lockFraction: 0,    stage: 1, label: 'Breakeven (fees covered)' },
        { threshold: 45, lockFraction: 0.18, stage: 2, label: '18% locked'               },
        { threshold: 30, lockFraction: 0.38, stage: 3, label: '38% locked'               },
        { threshold: 18, lockFraction: 0.58, stage: 4, label: '58% locked'               },
        { threshold: 8,  lockFraction: 0.78, stage: 5, label: '78% locked'               },
        { threshold: 3,  lockFraction: -1,   stage: 6, label: 'Hyper-Trail'              },
    ] as const;

    for (const s of stages) {
        if (remainingPct <= s.threshold && currentStage < s.stage) {
            let newSl: number;

            if (s.stage === 1) {
                newSl = trueBreakeven;
            } else if (s.lockFraction === -1) {
                // Stage 6: trail 1% of total range behind current price
                newSl = isLong
                    ? currentPrice - totalRange * 0.01
                    : currentPrice + totalRange * 0.01;
            } else {
                newSl = isLong
                    ? position.entryPrice + totalRange * s.lockFraction
                    : position.entryPrice - totalRange * s.lockFraction;
            }

            const isTighter = isLong ? newSl > position.stopLossPrice : newSl < position.stopLossPrice;
            if (isTighter) {
                const coveredPct = (100 - remainingPct).toFixed(0);
                const modelTag   = modelDelta !== undefined && modelDelta <= -15 ? ' [Model-accelerated]' : '';
                return {
                    newStopLoss: newSl,
                    activeStopLossReason: 'Profit Secure',
                    newState: { tpLockStage: s.stage },
                    reasons: [`TP Lock Stage ${s.stage}: ${s.label} (${coveredPct}% to TP)${modelTag}`],
                };
            }
        }
    }

    return { reasons: [] };
}
