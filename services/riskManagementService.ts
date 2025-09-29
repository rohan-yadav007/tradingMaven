// services/riskManagementService.ts

import { TradingMode, Agent, Kline, AgentParams, Position, ADXOutput, MACDOutput, BollingerBandsOutput, StochasticRSIOutput, TradeManagementSignal, BotConfig, IchimokuCloudOutput } from '../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV, IchimokuCloud, bearishengulfingpattern, bullishengulfingpattern, darkcloudcover, dragonflydoji, gravestonedoji, hammerpattern, hangingman, morningstar, piercingline, shootingstar, eveningstar } from 'technicalindicators';
import * as constants from '../constants';
import { calculateSupportResistance, findSwingPoints, analyzeMarketStructure } from './chartAnalysisService';
// FIX: Changed import from non-existent 'calculateVwap' to 'calculateDailyVwap'.
import { Supertrend, applyTimeframeSettings, getLast, getPenultimate, captureMarketContext, detectRsiDivergence, calculateDailyVwap } from './agents/agentUtils';
import { detectSmcReversalPattern } from './vetoService';

const MIN_STOP_LOSS_PERCENT = 0.5; // Minimum 0.5% SL distance from entry price.
const { TIMEFRAME_ATR_CONFIG, MIN_PROFIT_BUFFER_MULTIPLIER } = constants;


// ----------------------------------------------------------------------------------
// --- #1: INITIAL TARGET CALCULATION (SL/TP) - THE CORE RISK FIX ---
// This is the single source of truth for setting initial trade targets.
// ----------------------------------------------------------------------------------
export function getInitialAgentTargets(
    klines: Kline[],
    entryPrice: number,
    direction: 'LONG' | 'SHORT',
    originalConfig: BotConfig
): { stopLossPrice: number; takeProfitPrice: number; slReason: 'Agent Logic' | 'Hard Cap'; agentStopLoss: number; } {
    const config = applyTimeframeSettings(originalConfig);
    const { timeFrame, agent, investmentAmount, mode, leverage } = config;
    const params = config.agentParams as Required<AgentParams>;

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const isLong = direction === 'LONG';

    // --- Step 1: Calculate Agent-Specific Stop Loss ---
    let agentStopLoss: number;
    const atrPeriod = params.atrPeriod;
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: atrPeriod });
    const currentAtr = (getLast(atrValues) as number | undefined) || (entryPrice * 0.01);

    // --- Volatility-Adaptive ATR Multiplier ---
    const timeframeConfig = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];
    let atrMultiplier = timeframeConfig.atrMultiplier;
    
    if (atrValues.length > 50) {
        const recentAtrHistory = atrValues.slice(-200).filter(v => v !== undefined) as number[];
        if (recentAtrHistory.length > 20) {
            const sortedAtr = [...recentAtrHistory].sort((a, b) => a - b);
            const rank = sortedAtr.indexOf(currentAtr);
            const percentile = (rank / sortedAtr.length) * 100;
            
            if (percentile >= params.risk_atrVolatilityPercentile_upper) {
                atrMultiplier += params.risk_atrVolatilityMultiplier_upper_adj;
            } else if (percentile <= params.risk_atrVolatilityPercentile_lower) {
                atrMultiplier += params.risk_atrVolatilityMultiplier_lower_adj;
            }
        }
    }
    
    // Default Fallback SL using the (potentially adapted) ATR multiplier
    const fallbackStop = () => {
        return isLong ? entryPrice - (currentAtr * atrMultiplier) : entryPrice + (currentAtr * atrMultiplier);
    }

    switch (agent.id) {
        case 9: // Quantum Scalper: Context-aware SL (Trending vs. Ranging).
            const adxValues = ADX.calculate({ high: highs, low: lows, close: closes, period: params.qsc_adxPeriod });
            const adx = getLast(adxValues) as ADXOutput | undefined;
            if (!adx) { agentStopLoss = fallbackStop(); break; }
            
            const isTrending = adx.adx > params.qsc_adxThreshold;
            if (isTrending) { 
                const psarInput = { high: highs, low: lows, step: params.qsc_psarStep, max: params.qsc_psarMax };
                const psar = getLast(PSAR.calculate(psarInput)) as number | undefined;

                const stInput = { high: highs, low: lows, close: closes, period: params.qsc_superTrendPeriod, multiplier: params.qsc_superTrendMultiplier };
                const st = getLast(Supertrend.calculate(stInput)) as number | undefined;

                let psarCandidate: number | undefined;
                if (psar && ((isLong && psar < entryPrice) || (!isLong && psar > entryPrice))) {
                    psarCandidate = psar;
                }

                let stCandidate: number | undefined;
                if (st && ((isLong && st < entryPrice) || (!isLong && st > entryPrice))) {
                    stCandidate = st;
                }

                if (psarCandidate && stCandidate) {
                    // Both are valid, pick the one that gives a tighter stop (better R:R)
                    agentStopLoss = isLong ? Math.max(psarCandidate, stCandidate) : Math.min(psarCandidate, stCandidate);
                } else if (stCandidate) {
                    agentStopLoss = stCandidate;
                } else if (psarCandidate) {
                    agentStopLoss = psarCandidate;
                } else {
                    agentStopLoss = fallbackStop();
                }
            } else { // Use BB for ranging/reversion SL
                const bbValues = BollingerBands.calculate({ period: params.qsc_bbPeriod, stdDev: params.qsc_bbStdDev, values: closes });
                const bb = getLast(bbValues) as BollingerBandsOutput | undefined;
                if (!bb) { agentStopLoss = fallbackStop(); break; }
                agentStopLoss = isLong ? bb.lower - currentAtr * 0.2 : bb.upper + currentAtr * 0.2;
            }
            break;
            
        case 16: // Ichimoku Trend Rider
            const ichi_params_ch = {
                high: highs, low: lows,
                conversionPeriod: params.ichi_conversionPeriod, basePeriod: params.ichi_basePeriod,
                spanPeriod: params.ichi_laggingSpanPeriod, displacement: params.ichi_displacement
            };
            const ichi = getLast(IchimokuCloud.calculate(ichi_params_ch)) as IchimokuCloudOutput | undefined;
            if (ichi?.base) {
                const kijunSen = ichi.base;
                // Check if Kijun is on the protective side
                if ((isLong && kijunSen < entryPrice) || (!isLong && kijunSen > entryPrice)) {
                    agentStopLoss = isLong ? kijunSen - currentAtr * 0.25 : kijunSen + currentAtr * 0.25;
                } else if (ichi.spanA && ichi.spanB) {
                    // Kijun is on the wrong side, use Kumo as fallback
                    const kumoBoundary = isLong ? Math.min(ichi.spanA, ichi.spanB) : Math.max(ichi.spanA, ichi.spanB);
                    agentStopLoss = kumoBoundary;
                } else {
                    agentStopLoss = fallbackStop();
                }
            } else {
                agentStopLoss = fallbackStop();
            }
            break;
            
        case 14: // The Sentinel: Hybrid SL
            { // Use a block to scope variables
                const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.sentinel_adxPeriod! })) as ADXOutput | undefined;
                if (!adx) {
                    agentStopLoss = fallbackStop();
                    break;
                }

                const candidates: number[] = [];

                // Candidate 1: SuperTrend SL
                const st = getLast(Supertrend.calculate({ high: highs, low: lows, close: closes, period: params.sentinel_stPeriod!, multiplier: params.sentinel_stMultiplier! })) as number | undefined;
                if (st && ((isLong && st < entryPrice) || (!isLong && st > entryPrice))) {
                    candidates.push(st);
                }

                // Candidate 2: Swing Structure SL
                const swingPoints = findSwingPoints(klines, 5);
                const lastSwing = isLong ? swingPoints.filter(p => p.type === 'low').pop() : swingPoints.filter(p => p.type === 'high').pop();
                if (lastSwing) {
                    const swingSL = isLong ? lastSwing.price - (currentAtr * 0.5) : lastSwing.price + (currentAtr * 0.5);
                    candidates.push(swingSL);
                }

                // Candidate 3: Regime-based ATR SL
                let regimeMultiplier: number;
                if (adx.adx >= 30) {
                    regimeMultiplier = params.sentinel_atr_mult_strong!;
                } else if (adx.adx >= 20 && adx.adx < 30) {
                    regimeMultiplier = params.sentinel_atr_mult_transition!;
                } else {
                    regimeMultiplier = params.sentinel_atr_mult_chop!;
                }
                const atrSL = isLong ? entryPrice - (currentAtr * regimeMultiplier) : entryPrice + (currentAtr * regimeMultiplier);
                candidates.push(atrSL);

                // Final SL is the WIDEST (safest) of the valid candidates
                if (candidates.length > 0) {
                    agentStopLoss = isLong ? Math.min(...candidates) : Math.max(...candidates);
                } else {
                    // Fallback if no candidates were generated
                    agentStopLoss = fallbackStop();
                }
                break;
            }
        
        case 18: // The Conductor: SL based on last valid swing point.
        case 19: // AstraX: "Breathing Room" SL
            const swingPoints = findSwingPoints(klines, params.conductor_swingLookback);
            const lastSwing = isLong 
                ? swingPoints.filter(p => p.type === 'low').pop()
                : swingPoints.filter(p => p.type === 'high').pop();
            
            if (lastSwing) {
                const atrBuffer = currentAtr * (agent.id === 19 ? 0.25 : params.conductor_slAtrMultiplier);
                agentStopLoss = isLong ? lastSwing.price - atrBuffer : lastSwing.price + atrBuffer;
            } else {
                agentStopLoss = fallbackStop();
            }
            break;
            
        default:
            agentStopLoss = fallbackStop();
            break;
    }
    
    let stopLossAfterInitialChecks = agentStopLoss;
    
    // --- Step 2: Enforce Minimum SL Distance (prevents stops that are too tight) ---
    const minSlOffset = entryPrice * (MIN_STOP_LOSS_PERCENT / 100);
    const minSafeStopLoss = isLong ? entryPrice - minSlOffset : entryPrice + minSlOffset;

    // If agent's stop is tighter than the minimum, widen it to the minimum safe distance.
    if ((isLong && stopLossAfterInitialChecks > minSafeStopLoss) || (!isLong && stopLossAfterInitialChecks < minSafeStopLoss)) {
        stopLossAfterInitialChecks = minSafeStopLoss;
    }

    // --- Step 3: Calculate Take Profit ---
    const stopLossDistance = Math.abs(entryPrice - stopLossAfterInitialChecks);
    
    const timeframeConfigForRr = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];
    let riskRewardRatio = timeframeConfigForRr.riskRewardRatio;
    if (agent.id === 13) riskRewardRatio = 4; // Special R:R for Chameleon
    let suggestedTakeProfit = isLong 
        ? entryPrice + (stopLossDistance * riskRewardRatio) 
        : entryPrice - (stopLossDistance * riskRewardRatio);

    // Agent-Specific TP Logic (Sentinel S/R) - conditionally override
    if (agent.id === 14 && params.sentinel_useSrLevelsForTp) {
        const srLevels = calculateSupportResistance(klines, 15, 0.005);
        const buffer = currentAtr * 0.2; // Small buffer before the S/R level

        let targetSrLevel: number | undefined;

        if (isLong) {
            const nextResistance = srLevels.resistances.filter(r => r.price > entryPrice).sort((a, b) => a.price - b.price)[0];
            if (nextResistance) targetSrLevel = nextResistance.price - buffer;
        } else { // SHORT
            const nextSupport = srLevels.supports.filter(s => s.price < entryPrice).sort((a, b) => b.price - a.price)[0];
            if (nextSupport) targetSrLevel = nextSupport.price + buffer;
        }

        if (targetSrLevel) {
            const risk = stopLossDistance;
            const reward = Math.abs(targetSrLevel - entryPrice);
            const rrRatio = risk > 0 ? reward / risk : 0;
            const minSrRr = Math.max(1.0, constants.MIN_RISK_REWARD_RATIO - 0.5);

            if (rrRatio >= minSrRr) {
                suggestedTakeProfit = targetSrLevel; // Override default
            }
        }
    }


    // --- Step 4: Apply Hard Cap as the FINAL, non-negotiable limit ---
    let finalStopLoss = stopLossAfterInitialChecks;
    let slReason: 'Agent Logic' | 'Hard Cap' = 'Agent Logic';

    const maxLossInDollars = config.investmentAmount * (config.maxMarginLossPercent / 100);
    const positionValue = mode === TradingMode.USDSM_Futures ? config.investmentAmount * leverage : config.investmentAmount;
    const positionSize = (entryPrice > 0) ? positionValue / entryPrice : 0;

    if (positionSize > 0) {
        const priceDistanceForMaxLoss = maxLossInDollars / positionSize;
        const hardCapStopLossPrice = isLong
            ? entryPrice - priceDistanceForMaxLoss
            : entryPrice + priceDistanceForMaxLoss;
            
        // Check if the current stop loss (agent's or min distance) is riskier than the hard cap.
        const currentSlIsRiskier = isLong
            ? finalStopLoss < hardCapStopLossPrice
            : finalStopLoss > hardCapStopLossPrice;

        if (currentSlIsRiskier) {
            finalStopLoss = hardCapStopLossPrice;
            slReason = 'Hard Cap';
        }
    }


    // --- Step 5: CRITICAL FINAL SAFETY CHECKS ---
    let finalTakeProfit = suggestedTakeProfit;

    if (positionSize > 0) {
        const roundTripFee = positionValue * config.takerFeeRate * 2;
        const feeInPrice = roundTripFee / positionSize;
        const minProfitDistance = feeInPrice * MIN_PROFIT_BUFFER_MULTIPLIER;
        const currentRewardDistance = Math.abs(finalTakeProfit - entryPrice);

        if (currentRewardDistance < minProfitDistance) {
            finalTakeProfit = isLong 
                ? entryPrice + minProfitDistance 
                : entryPrice - minProfitDistance;
        }
    }
    
    if ((isLong && finalStopLoss >= entryPrice) || (!isLong && finalStopLoss <= entryPrice)) {
        finalStopLoss = fallbackStop();
        if ((isLong && finalStopLoss >= entryPrice) || (!isLong && finalStopLoss <= entryPrice)) {
            finalStopLoss = isLong ? entryPrice * (1 - (MIN_STOP_LOSS_PERCENT/100)) : entryPrice * (1 + (MIN_STOP_LOSS_PERCENT/100));
        }
    }
    
    if ((isLong && finalTakeProfit <= entryPrice) || (!isLong && finalTakeProfit >= entryPrice)) {
        const finalSlDistance = Math.abs(entryPrice - finalStopLoss);
        const fallbackRr = TIMEFRAME_ATR_CONFIG[timeFrame]?.riskRewardRatio || 2.0;
        finalTakeProfit = isLong ? entryPrice + (finalSlDistance * fallbackRr) : entryPrice - (finalSlDistance * fallbackRr);
    }

    return {
        stopLossPrice: finalStopLoss,
        takeProfitPrice: finalTakeProfit,
        slReason,
        agentStopLoss: stopLossAfterInitialChecks // Return the intended SL for validation and record-keeping
    };
};

export function validateTradeProfitability(
    entryPrice: number,
    agentStopLossPrice: number,
    takeProfitPrice: number,
    direction: 'LONG' | 'SHORT',
    config: BotConfig
): { isValid: boolean, reason: string } {
    const isLong = direction === 'LONG';

    // Check 1: Stop Loss and Take Profit are on the correct side of the entry price
    if ((isLong && (agentStopLossPrice >= entryPrice || takeProfitPrice <= entryPrice)) ||
        (!isLong && (agentStopLossPrice <= entryPrice || takeProfitPrice >= entryPrice))) {
        return { isValid: false, reason: "❌ VETO: SL/TP targets are on the wrong side of the entry price." };
    }

    // Check 2: The trade must be profitable enough to cover fees.
    const positionValue = config.investmentAmount * (config.mode === TradingMode.USDSM_Futures ? config.leverage : 1);
    const tradeSize = (entryPrice > 0) ? positionValue / entryPrice : 0;
    if (tradeSize > 0) {
        const roundTripFee = positionValue * config.takerFeeRate * 2;
        const feeInPrice = roundTripFee / tradeSize;
        const minProfitDistance = feeInPrice * constants.MIN_PROFIT_BUFFER_MULTIPLIER;
        const rewardDistance = Math.abs(takeProfitPrice - entryPrice);
        if (rewardDistance < minProfitDistance) {
            return { isValid: false, reason: `❌ VETO: Take Profit ($${takeProfitPrice.toFixed(config.pricePrecision)}) is within the minimum profit zone required to cover fees.` };
        }
    }

    // Check 3: Enforce Minimum Risk/Reward if enabled.
    if (config.isMinRrEnabled) {
        // Use the intended agent stop loss (post-safety-checks) for R:R calculation.
        const risk = Math.abs(entryPrice - agentStopLossPrice);
        const reward = Math.abs(takeProfitPrice - entryPrice);
        const rrRatio = risk > 0 ? reward / risk : 0;

        if (rrRatio < constants.MIN_RISK_REWARD_RATIO) {
            return { isValid: false, reason: `❌ VETO: R:R (${rrRatio.toFixed(2)}) is below the system minimum of ${constants.MIN_RISK_REWARD_RATIO}.` };
        }
        return { isValid: true, reason: `✅ R:R Veto: Passed (${rrRatio.toFixed(2)}:1)` };
    }

    return { isValid: true, reason: `✅ Profitability checks passed.` };
};

// ----------------------------------------------------------------------------------
// --- #2: TRADE MANAGEMENT (Trailing Stops, etc.) ---
// ----------------------------------------------------------------------------------

export function getProfitSpikeSignal(
    position: Position,
    currentPrice: number
): TradeManagementSignal {
    const { 
        entryPrice, 
        stopLossPrice, 
        direction, 
        investmentAmount, 
        size, 
        profitSpikeTier = 0
    } = position;

    if (!investmentAmount || investmentAmount <= 0 || !size || size <= 0) {
        return { reasons: [] };
    }

    const isLong = direction === 'LONG';
    const currentPnl = (currentPrice - entryPrice) * size * (isLong ? 1 : -1);

    if (currentPnl <= 0) {
        return { reasons: [] };
    }

    const pnlPercentage = (currentPnl / investmentAmount) * 100;

    // Tiers based on PNL % of initial investment, but locking in a % of *current* profit.
    const tiers = [
        { triggerPercent: 600, lockPercent: 0.80, tier: 4 }, // At 600% gain, lock 80% of it
        { triggerPercent: 400, lockPercent: 0.70, tier: 3 }, // At 400% gain, lock 70% of it
        { triggerPercent: 200, lockPercent: 0.60, tier: 2 }, // At 200% gain, lock 60% of it
        { triggerPercent: 100, lockPercent: 0.50, tier: 1 }, // At 100% gain, lock 50% of it
    ];

    const applicableTier = tiers.find(t => pnlPercentage >= t.triggerPercent && profitSpikeTier < t.tier);

    if (applicableTier) {
        // Calculate PNL to lock based on *current* profit
        const lockedPnlDollars = currentPnl * applicableTier.lockPercent;
        
        const lockedPnlInPrice = lockedPnlDollars / size;
        
        const newStopLoss = entryPrice + (lockedPnlInPrice * (isLong ? 1 : -1));

        if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
            return {
                newStopLoss,
                reasons: [`Spike Protector: Locked ${(applicableTier.lockPercent * 100).toFixed(0)}% of profit at ${pnlPercentage.toFixed(0)}% gain.`],
                newState: { profitSpikeTier: applicableTier.tier },
                activeStopLossReason: 'Profit Secure'
            };
        }
    }

    return { reasons: [] };
}


export function getMandatoryBreakevenSignal(
    position: Position,
    currentPrice: number
): TradeManagementSignal {
    const { entryPrice, stopLossPrice, direction, isBreakevenSet, size, takerFeeRate } = position;

    // Rule applies only once, before any other profit locking.
    if (isBreakevenSet) {
        return { reasons: [] };
    }

    const isLong = direction === 'LONG';
    
    // --- Direct Dollar-Based Calculation ---
    const currentPnlDollars = (currentPrice - entryPrice) * size * (isLong ? 1 : -1);
    
    // Not in profit, no action needed.
    if (currentPnlDollars <= 0) {
        return { reasons: [] };
    }
    
    const positionValueDollars = entryPrice * size;
    const roundTripFeeDollars = positionValueDollars * takerFeeRate * 2;

    // Check if the PNL is at least 2x the round-trip fee.
    if (roundTripFeeDollars > 0 && currentPnlDollars >= (roundTripFeeDollars * 2)) {
        // Breakeven stop loss is the exact price needed to exit with zero PNL after fees.
        const feeRate = takerFeeRate;
        const breakevenStop = isLong
            ? entryPrice * (1 + feeRate) / (1 - feeRate)
            : entryPrice * (1 - feeRate) / (1 + feeRate);

        // Only update if the new breakeven stop is better (tighter) than the current one.
        if ((isLong && breakevenStop > stopLossPrice) || (!isLong && breakevenStop < stopLossPrice)) {
            return {
                newStopLoss: breakevenStop,
                reasons: [`Profit Secure: Breakeven set at 2x fee gain.`],
                newState: { isBreakevenSet: true, profitLockTier: 2 },
                activeStopLossReason: 'Breakeven'
            };
        }
    }

    return { reasons: [] };
}

export function getMultiStageProfitSecureSignal(
    position: Position,
    currentPrice: number
): TradeManagementSignal {
    const { entryPrice, stopLossPrice, direction, profitLockTier, size, takerFeeRate } = position;

    const isLong = direction === 'LONG';
    const currentPnlDollars = (currentPrice - entryPrice) * size * (isLong ? 1 : -1);

    if (currentPnlDollars <= 0) {
        return { reasons: [] };
    }

    const positionValueDollars = entryPrice * size;
    const roundTripFeeDollars = positionValueDollars * takerFeeRate * 2;

    if (roundTripFeeDollars <= 0) {
        return { reasons: [] };
    }

    const currentFeeMultiple = Math.floor(currentPnlDollars / roundTripFeeDollars);

    if (currentFeeMultiple <= profitLockTier) {
        return { reasons: [] };
    }

    // Handle the first profit lock (breakeven equivalent) if it hasn't been done
    if (currentFeeMultiple >= 2 && profitLockTier < 2) {
        const feeRate = takerFeeRate;
        const breakevenStop = isLong
            ? entryPrice * (1 + feeRate) / (1 - feeRate)
            : entryPrice * (1 - feeRate) / (1 + feeRate);

        if ((isLong && breakevenStop > stopLossPrice) || (!isLong && breakevenStop < stopLossPrice)) {
            return {
                newStopLoss: breakevenStop,
                reasons: [`Universal Trail: Breakeven set at 2x fee gain.`],
                newState: { isBreakevenSet: true, profitLockTier: 2 },
                activeStopLossReason: 'Breakeven'
            };
        }
    }
    
    // Handle subsequent profit locks (N-2) for N >= 3 to give more breathing room
    if (currentFeeMultiple > profitLockTier && currentFeeMultiple >= 3) {
        const lockFeeMultiple = currentFeeMultiple - 2;
        
        if (lockFeeMultiple > 1) { // Ensure we are at least locking in breakeven-level profit
            const lockedPnlDollars = roundTripFeeDollars * lockFeeMultiple;
            const lockedPnlInPrice = lockedPnlDollars / size;
            const newStopLoss = entryPrice + (lockedPnlInPrice * (isLong ? 1 : -1));

            if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
                const reason = `Universal Trail: Tier ${currentFeeMultiple - 2} activated at ${currentFeeMultiple}x fee gain.`;
                return {
                    newStopLoss,
                    reasons: [reason],
                    newState: { profitLockTier: currentFeeMultiple },
                    activeStopLossReason: 'Profit Secure'
                };
            }
        }
    }

    return { reasons: [] };
}

export function getAggressiveRangeTrailSignal(
    position: Position,
    currentPrice: number
): TradeManagementSignal {
    const {
        entryPrice, stopLossPrice, takeProfitPrice, direction, size,
        investmentAmount, aggressiveTrailTier = 0, botConfigSnapshot
    } = position;
    
    if (!botConfigSnapshot || !botConfigSnapshot.aggressiveTrailMode || !size || size <= 0) {
        return { reasons: [] };
    }

    const isLong = direction === 'LONG';
    const unrealizedPnlInPrice = (currentPrice - entryPrice) * (isLong ? 1 : -1);

    if (unrealizedPnlInPrice <= 0) {
        return { reasons: [] };
    }
    
    let applicableTier: { trigger: number; lock: number; tier: number } | undefined;

    if (botConfigSnapshot.aggressiveTrailMode === 'distance') {
        const isSlBehindEntry = isLong ? stopLossPrice < entryPrice : stopLossPrice > entryPrice;
        const rangeStartPrice = isSlBehindEntry ? entryPrice : stopLossPrice;
        const totalDistance = Math.abs(takeProfitPrice - rangeStartPrice);
        if (totalDistance <= 1e-9) return { reasons: [] };
        const distanceTraveled = Math.abs(currentPrice - rangeStartPrice);
        const progressPercent = distanceTraveled / totalDistance;

        const tiers = [
            { trigger: 0.95, lock: 0.90, tier: 9 },
            { trigger: 0.90, lock: 0.80, tier: 8 },
            { trigger: 0.80, lock: 0.65, tier: 7 },
            { trigger: 0.70, lock: 0.55, tier: 6 },
            { trigger: 0.60, lock: 0.45, tier: 5 },
            { trigger: 0.50, lock: 0.35, tier: 4 },
            { trigger: 0.40, lock: 0.25, tier: 3 },
            { trigger: 0.30, lock: 0.15, tier: 2 },
            { trigger: 0.25, lock: 0.10, tier: 1 },
        ];
        
        applicableTier = tiers.find(t => progressPercent >= t.trigger && aggressiveTrailTier < t.tier);
    
        if (applicableTier) {
            const distanceToLock = totalDistance * applicableTier.lock;
            const newStopLoss = isLong 
                ? rangeStartPrice + distanceToLock 
                : rangeStartPrice - distanceToLock;
    
            if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
                return {
                    newStopLoss,
                    reasons: [`Aggressive Trail (Distance): Tier ${applicableTier.tier} activated.`],
                    newState: { aggressiveTrailTier: applicableTier.tier },
                    activeStopLossReason: 'Profit Secure'
                };
            }
        }

    } else { // PNL mode
        const unrealizedPnl = unrealizedPnlInPrice * size;
        const pnlPercent = unrealizedPnl / investmentAmount;
        const tiers = [
            { trigger: 1.0, lock: 0.95, tier: 5 },
            { trigger: 0.9, lock: 0.80, tier: 4 },
            { trigger: 0.8, lock: 0.60, tier: 3 },
            { trigger: 0.6, lock: 0.40, tier: 2 },
            { trigger: 0.5, lock: 0.25, tier: 1 },
        ];
        applicableTier = tiers.find(t => pnlPercent >= t.trigger && aggressiveTrailTier < t.tier);
        
        if (applicableTier) {
            const profitToLockInPrice = unrealizedPnlInPrice * applicableTier.lock;
            const newStopLoss = entryPrice + (profitToLockInPrice * (isLong ? 1 : -1));
    
            if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
                return {
                    newStopLoss,
                    reasons: [`Aggressive Trail (PNL): Tier ${applicableTier.tier} activated.`],
                    newState: { aggressiveTrailTier: applicableTier.tier },
                    activeStopLossReason: 'Profit Secure'
                };
            }
        }
    }
    
    return { reasons: [] };
}


export function getAgentExitSignal(
    position: Position,
    klines: Kline[],
    currentPrice: number,
    originalConfig: BotConfig
): TradeManagementSignal {
    const config = applyTimeframeSettings(originalConfig);
    const { agent } = config;
    const params = config.agentParams as Required<typeof config.agentParams>;
    const reasons: string[] = [];
    let newStopLoss: number | undefined;
    let action: TradeManagementSignal['action'] = 'hold';

    const isLong = position.direction === 'LONG';
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);

    // --- Profit Velocity Engine ---
    const { entryPrice, takeProfitPrice, timeFrame } = position;
    
    const totalTargetDistance = Math.abs(takeProfitPrice - entryPrice);
    const currentProgressDistance = isLong ? Math.max(0, currentPrice - entryPrice) : Math.max(0, entryPrice - currentPrice);
    
    const progressToTarget = totalTargetDistance > 1e-9 ? currentProgressDistance / totalTargetDistance : 0;
    
    const isLowTimeframe = ['1m', '3m', '5m'].includes(timeFrame);
    const progressThresholds = isLowTimeframe
        ? { high: 0.50, hyper: 0.70, max: 0.85 }
        : { high: 0.60, hyper: 0.80, max: 0.90 };
    
    let profitVelocity = 1;
    if (progressToTarget > progressThresholds.max) profitVelocity = 4;
    else if (progressToTarget > progressThresholds.hyper) profitVelocity = 3;
    else if (progressToTarget > progressThresholds.high) profitVelocity = 2;


    switch (agent.id) {
        case 9: // Quantum Scalper: PSAR-based trailing stop with ATR buffer
            let step = params.qsc_psarStep;
            let max = params.qsc_psarMax;
            
            if (profitVelocity > 1) {
                step *= profitVelocity;
                max *= profitVelocity;
                reasons.push(`Agent Trail: Profit Velocity active (${profitVelocity}x)`);
            } else {
                 reasons.push('Agent PSAR Trail');
            }
            
            const psarInput = { high: highs, low: lows, step, max };
            if (psarInput.high.length >= 2) {
                const psar = getLast(PSAR.calculate(psarInput)) as number | undefined;
                if (psar) {
                    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
                    const lastAtr = (getLast(atrValues) as number | undefined) || 0;
                    const buffer = lastAtr * 0.1;
                    newStopLoss = isLong ? psar - buffer : psar + buffer;
                }
            }
            break;

        case 11: 
        case 13: 
            const baseEmaPeriod = agent.id === 11 ? params.he_slowEmaPeriod : params.ch_slowEmaPeriod;
            const fastEmaPeriod = agent.id === 11 ? params.he_fastEmaPeriod : params.ch_slowEmaPeriod;
            const trailEmaPeriod = Math.max(fastEmaPeriod, Math.round(baseEmaPeriod / profitVelocity));
            if (profitVelocity > 1) reasons.push(`Agent Trail: Profit Velocity active (${profitVelocity}x speed)`);
            else reasons.push('Agent EMA Trail');
            newStopLoss = getLast(EMA.calculate({ period: trailEmaPeriod, values: closes })) as number | undefined;
            break;

        case 14:
            { // Block scope
                // --- Momentum Check ---
                const rsi = getLast(RSI.calculate({ period: params.sentinel_rsiPeriod!, values: closes })) as number | undefined;
                const obvValues = OBV.calculate({ close: closes, volume: klines.map(k => k.volume || 0) });
                const obvDelta = (getLast(obvValues) || 0) - (getPenultimate(obvValues) || 0);

                let momentumSupportsTrail = false;
                if (rsi) {
                    if (isLong && rsi > 50 && obvDelta >= 0) {
                        momentumSupportsTrail = true;
                    } else if (!isLong && rsi < 50 && obvDelta <= 0) {
                        momentumSupportsTrail = true;
                    }
                }

                if (momentumSupportsTrail) {
                    reasons.push(`✅ Momentum supports trailing.`);
                    // --- Trailing Logic ---
                    const baseMultiplier = params.sentinel_stMultiplier;
                    const trailMultiplier = Math.max(1, baseMultiplier / profitVelocity);
                    if (profitVelocity > 1) reasons.push(`Agent Trail: Profit Velocity active (${profitVelocity}x speed)`);
                    else reasons.push('Agent Supertrend Trail');
                    newStopLoss = getLast(Supertrend.calculate({ high: highs, low: lows, close: closes, period: params.sentinel_stPeriod, multiplier: trailMultiplier })) as number | undefined;
                } else {
                    reasons.push(`ℹ️ Momentum faded. Trailing SL is frozen.`);
                    // newStopLoss remains undefined, so the SL doesn't move
                }
                break;
            }

        case 16:
            const ichi_params = { high: highs, low: lows, conversionPeriod: params.ichi_conversionPeriod, basePeriod: params.ichi_basePeriod, spanPeriod: params.ichi_laggingSpanPeriod, displacement: params.ichi_displacement };
            const ichiValues = IchimokuCloud.calculate(ichi_params);
            const lastIchi = getLast(ichiValues) as IchimokuCloudOutput | undefined;
            if(lastIchi) {
                newStopLoss = isLong ? lastIchi.spanA : lastIchi.spanB;
                if(newStopLoss) reasons.push('Agent Ichimoku Cloud Trail');
            }
            break;

        case 19: // AstraX
            {
                // Tier 3: Critical reversal (ChoCH on main TF) -> Aggressive close
                const swingPoints = findSwingPoints(klines, params.astraX_structureLookback || 8);
                const structure = analyzeMarketStructure(swingPoints);
                if ((isLong && structure.lastSignal === 'ChoCH_Bearish') || (!isLong && structure.lastSignal === 'ChoCH_Bullish')) {
                    newStopLoss = isLong ? currentPrice * 0.999 : currentPrice * 1.001;
                    reasons.push('AstraX Tier 3: Market structure broke against position.');
                    break;
                }
        
                // Tier 2: Actionable warning (divergence)
                const rsiValues = RSI.calculate({ period: 14, values: closes });
                if (detectRsiDivergence(klines, rsiValues, position.direction, 14)) {
                     const breakevenPrice = isLong
                        ? position.entryPrice * (1 + position.takerFeeRate) / (1 - position.takerFeeRate)
                        : position.entryPrice * (1 - position.takerFeeRate) / (1 + position.takerFeeRate);
                    newStopLoss = breakevenPrice;
                    reasons.push('AstraX Tier 2: Divergence detected, moving SL to Break-even.');
                    break;
                }
        
                // Tier 1: Soft deterioration (momentum fade) -> Trail with fast EMA
                const macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false })) as MACDOutput | undefined;
                if ((isLong && macd?.histogram && macd.histogram < 0) || (!isLong && macd?.histogram && macd.histogram > 0)) {
                    const fastEma = getLast(EMA.calculate({ period: 9, values: closes }));
                    if (fastEma) {
                        newStopLoss = fastEma;
                        reasons.push('AstraX Tier 1: Momentum faded, trailing with fast EMA.');
                    }
                }
            }
            break;

        default:
            break;
    }
    
    if (position.isBreakevenSet && newStopLoss !== undefined) {
        const feeRate = position.takerFeeRate;
        const breakevenPrice = isLong
            ? position.entryPrice * (1 + feeRate) / (1 - feeRate)
            : position.entryPrice * (1 - feeRate) / (1 + feeRate);
        if (isLong) newStopLoss = Math.max(newStopLoss, breakevenPrice);
        else newStopLoss = Math.min(newStopLoss, breakevenPrice);
        reasons.push('Agent Trail active post-breakeven.');
    }

    return { newStopLoss, action, reasons, activeStopLossReason: 'Agent Trail' };
}

export function getAdaptiveTakeProfit(
    position: Position,
    klines: Kline[],
    currentPrice: number,
): { newTakeProfit?: number; reason?: string; newState?: Partial<Position> } {
    const { direction, entryPrice, takeProfitPrice, botConfigSnapshot, adaptiveTpTriggered } = position;

    if (!botConfigSnapshot?.isAdaptiveTpEnabled || adaptiveTpTriggered) {
        return {};
    }
    if (klines.length < 30) return {};

    const isLong = direction === 'LONG';
    
    const totalTpDistance = Math.abs(takeProfitPrice - entryPrice);
    const currentProgress = Math.abs(currentPrice - entryPrice);
    
    if (totalTpDistance === 0 || (currentProgress / totalTpDistance) < 0.70) {
        return {};
    }

    if (klines.length === 0) return {};
    const lastKline = klines[klines.length - 1];
    const previewKline: Kline = {
        ...lastKline,
        high: Math.max(lastKline.high, currentPrice),
        low: Math.min(lastKline.low, currentPrice),
        close: currentPrice,
        isFinal: false,
    };
    const klinesForAnalysis = [...klines.slice(0, -1), previewKline];
    
    const closes = klinesForAnalysis.map(k => k.close);
    const highs = klinesForAnalysis.map(k => k.high);
    const lows = klinesForAnalysis.map(k => k.low);
    const rsiValues = RSI.calculate({ period: 14, values: closes });
    
    const lastRsi = getLast(rsiValues) as number | undefined;
    const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;
    const macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false })) as MACDOutput | undefined;
    const atr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: 14 })) as number | undefined;

    if (lastRsi === undefined || !stochRsi || !macd?.histogram || !atr) return {};

    const hasDivergence = detectRsiDivergence(klinesForAnalysis, rsiValues, isLong ? 'LONG' : 'SHORT', 14);
    const isStochExhausted = (isLong && stochRsi.k > 85 && stochRsi.k < stochRsi.d) || (!isLong && stochRsi.k < 15 && stochRsi.k > stochRsi.d);
    
    if (hasDivergence || isStochExhausted) {
        const reason = hasDivergence ? `Adaptive TP: Tightening due to RSI divergence.` : `Adaptive TP: Tightening due to StochRSI exhaustion.`;
        const newTakeProfit = isLong ? currentPrice * 1.0005 : currentPrice * 0.9995;
        
        const isStillProfitable = (isLong && newTakeProfit > entryPrice) || (!isLong && newTakeProfit < takeProfitPrice);
        const isTighter = (isLong && newTakeProfit < takeProfitPrice) || (!isLong && newTakeProfit > takeProfitPrice);

        if (isStillProfitable && isTighter) {
            return {
                newTakeProfit,
                reason,
                newState: { adaptiveTpTriggered: true }
            };
        }
    }

    const isMomentumStrong = (isLong && lastRsi > 65 && macd.histogram > 0) || (!isLong && lastRsi < 35 && macd.histogram < 0);
    
    if (isMomentumStrong) {
        const newTakeProfit = isLong ? takeProfitPrice + (atr * 1.5) : takeProfitPrice - (atr * 1.5);
        const isExtension = (isLong && newTakeProfit > takeProfitPrice) || (!isLong && newTakeProfit < takeProfitPrice);
        
        if (isExtension) {
            return {
                newTakeProfit,
                reason: `Adaptive TP: Extending target due to strong momentum.`,
                newState: { adaptiveTpTriggered: true }
            };
        }
    }

    return {};
}

interface GuardianSignal {
    action: 'hold' | 'close';
    reason?: string;
}

export function getTradeGuardianSignal(
    position: Position,
    klines: Kline[],
    microKlines: Kline[] | undefined,
    currentPrice: number,
): GuardianSignal {
    const config = position.botConfigSnapshot;
    if (!config || klines.length < 50) {
        return { action: 'hold' };
    }
    
    const params = constants.TRADE_GUARDIAN_CONFIG[position.timeFrame] || constants.TRADE_GUARDIAN_CONFIG['15m'];
    const strikes = new Set<string>();
    const isLong = position.direction === 'LONG';
    
    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const lastKline = getLast(klines)!;

    // --- Check 1: Momentum Exhaustion ---
    const rsi14_values = RSI.calculate({ period: 14, values: closes });
    const rsi14 = getLast(rsi14_values);
    const prev_rsi14 = rsi14_values[rsi14_values.length - 2];
    const rsi7_values = RSI.calculate({ period: 7, values: closes });
    const rsi7 = getLast(rsi7_values);

    if (rsi7 !== undefined && rsi14 !== undefined && prev_rsi14 !== undefined) {
        const rsi14_is_weakening_for_long = rsi14 < prev_rsi14 || Math.abs(rsi14 - prev_rsi14) < 1;
        const rsi14_is_weakening_for_short = rsi14 > prev_rsi14 || Math.abs(rsi14 - prev_rsi14) < 1;
        
        if (isLong && params.rsi7_long_threshold && rsi7 < params.rsi7_long_threshold && rsi14_is_weakening_for_long) {
            strikes.add('Momentum Exhaustion (RSI)');
        }
        if (!isLong && params.rsi7_short_threshold && rsi7 > params.rsi7_short_threshold && rsi14_is_weakening_for_short) {
            strikes.add('Momentum Exhaustion (RSI)');
        }
        if (isLong && params.rsi14_long_threshold && rsi14 < params.rsi14_long_threshold && prev_rsi14 >= params.rsi14_long_threshold) {
             strikes.add('Momentum Exhaustion (RSI)');
        }
        if (!isLong && params.rsi14_short_threshold && rsi14 > params.rsi14_short_threshold && prev_rsi14 <= params.rsi14_short_threshold) {
             strikes.add('Momentum Exhaustion (RSI)');
        }
    }
    const obv_values = OBV.calculate({ close: closes, volume: volumes });
    if (obv_values.length > 5) {
        const price_slope_positive = (lastKline.close - klines[klines.length - 5].close) > 0;
        const obv_slope_positive = (getLast(obv_values)! - obv_values[obv_values.length - 5]) > 0;
        if (isLong && price_slope_positive && !obv_slope_positive) strikes.add('Momentum Exhaustion (OBV Divergence)');
        if (!isLong && !price_slope_positive && obv_slope_positive) strikes.add('Momentum Exhaustion (OBV Divergence)');
    }

    // --- Check 2: Candle Behavior Shift ---
    const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes }));
    const hasVolumeSpike = lastKline.volume && volumeSma && lastKline.volume > volumeSma * 1.5;
    if (klines.length >= 2) {
        const engulfingInput = { open: [klines[klines.length-2].open, lastKline.open], high: [klines[klines.length-2].high, lastKline.high], low: [klines[klines.length-2].low, lastKline.low], close: [klines[klines.length-2].close, lastKline.close]};
        if (isLong && bearishengulfingpattern(engulfingInput) && hasVolumeSpike) {
            strikes.add('Bearish Engulfing Candle');
        }
        if (!isLong && bullishengulfingpattern(engulfingInput) && hasVolumeSpike) {
            strikes.add('Bullish Engulfing Candle');
        }
    }
    if (microKlines && microKlines.length >= 3) {
        const last3micro = microKlines.slice(-3);
        if (isLong && last3micro.every(k => k.close < k.open)) strikes.add('3 consecutive micro-bear candles');
        if (!isLong && last3micro.every(k => k.close > k.open)) strikes.add('3 consecutive micro-bull candles');
    }
    
    // --- Check 3: ATR/Volatility Spike ---
    const currentAtr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }));
    if (position.entryAtr && currentAtr && currentAtr > position.entryAtr * params.atrSpikeMultiplier) {
        const isAgainst = isLong ? lastKline.close < lastKline.open : lastKline.close > lastKline.open;
        if (isAgainst) {
            strikes.add('Volatility Spike Reversal');
        }
    }

    // --- Check 4: VWAP/EMA Guardian ---
    const vwap = getLast(calculateDailyVwap(klines));
    const ema = getLast(EMA.calculate({ period: params.vwapEmaPeriod, values: closes }));
    if (vwap && ema) {
        if (isLong && currentPrice < vwap && currentPrice < ema) {
            strikes.add('Broken below VWAP/EMA support');
        }
        if (!isLong && currentPrice > vwap && currentPrice > ema) {
            strikes.add('Broken above VWAP/EMA resistance');
        }
    }

    // --- Check 5: Micro-Timeframe Concordance (Simplified) ---
    if (microKlines) {
        const microRsi = getLast(RSI.calculate({ period: 14, values: microKlines.map(k => k.close) }));
        if (microRsi) {
            if (isLong && microRsi < 45) strikes.add('Micro-TF momentum weak');
            if (!isLong && microRsi > 55) strikes.add('Micro-TF momentum weak');
        }
    }

    // --- Check 6: PnL Sensitivity Layer ---
    const mfe_in_price = isLong ? Math.max(0, position.peakPrice - position.entryPrice) : Math.max(0, position.entryPrice - position.peakPrice);
    if (position.initialRiskInPrice && mfe_in_price > position.initialRiskInPrice * 1.2) {
        const retrace_in_price = isLong ? position.peakPrice - currentPrice : currentPrice - position.peakPrice;
        if (mfe_in_price > 0 && retrace_in_price > 0 && retrace_in_price / mfe_in_price > params.pnlRetracePercent) {
            strikes.add('PnL Retracement');
        }
    }

    // --- Check 7: Time Decay ---
    if (position.candlesSinceEntry > params.maxCandles) {
        const currentPnl_in_price = (currentPrice - position.entryPrice) * (isLong ? 1 : -1);
        if (position.initialRiskInPrice && currentPnl_in_price < position.initialRiskInPrice * 0.5) { 
             strikes.add('Time Decay');
        }
    }

    if (strikes.size >= 3) {
        return { action: 'close', reason: `Trade Guardian Exit: ${[...strikes].join('; ')}` };
    }

    return { action: 'hold' };
}