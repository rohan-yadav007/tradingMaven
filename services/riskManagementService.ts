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

    const isLong = direction === 'LONG';
    
    // Special handling for Supertrend Flipper agent
    if (agent.id === 20) {
        // For the flipper, the trade runs until the next flip signal.
        // We set a very wide, "virtual" SL and TP that are highly unlikely to be hit.
        // The actual exit is handled by the flip logic in the bot manager.
        const virtualStopDistance = entryPrice * 0.95; // A 95% stop loss.
        const virtualTpDistance = entryPrice * 100;   // A 10,000% take profit.

        const stopLossPrice = isLong ? entryPrice - virtualStopDistance : entryPrice + virtualStopDistance;
        const takeProfitPrice = isLong ? entryPrice + virtualTpDistance : entryPrice - virtualTpDistance;

        return {
            stopLossPrice,
            takeProfitPrice,
            slReason: 'Agent Logic',
            agentStopLoss: stopLossPrice,
        };
    }

    // Leverage Factor: Use a square root scale to provide more room for leveraged trades without being excessive.
    const leverageFactor = mode === TradingMode.USDSM_Futures && leverage > 1 ? Math.sqrt(leverage) : 1;

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    
    const timeframeCategory = ['1m', '3m', '5m'].includes(timeFrame) ? 'scalping'
        : ['15m', '30m', '1h'].includes(timeFrame) ? 'day'
        : 'swing';

    // --- Step 1: Calculate Agent-Specific Stop Loss based on timeframe category ---
    let agentStopLoss: number;
    const atrPeriod = params.atrPeriod;
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: atrPeriod });
    const currentAtr = (getLast(atrValues) as number | undefined) || (entryPrice * 0.01);
    const timeframeConfig = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];
    let atrMultiplier = timeframeConfig.atrMultiplier;

    if (timeframeCategory === 'scalping') {
        // SCALPING LOGIC: Prioritize tight, invalidation-based stops near recent price action.
        const lastKline = klines[klines.length - 1];
        const prevKline = klines[klines.length - 2];
        const atrBuffer = currentAtr * 0.25 * leverageFactor; // Apply leverage factor

        let stopCandidate: number;
        if (isLong) {
            const lowestLow = Math.min(lastKline.low, prevKline?.low || lastKline.low);
            stopCandidate = lowestLow - atrBuffer;
        } else {
            const highestHigh = Math.max(lastKline.high, prevKline?.high || lastKline.high);
            stopCandidate = highestHigh + atrBuffer;
        }
        agentStopLoss = stopCandidate;

        // Agent-specific override (e.g., Quantum Scalper's ranging logic might need a wider stop)
        if (agent.id === 9) {
            const adxValues = ADX.calculate({ high: highs, low: lows, close: closes, period: params.qsc_adxPeriod });
            const adx = getLast(adxValues) as ADXOutput | undefined;
            const isRanging = adx && adx.adx < params.qsc_adxThreshold;
            if (isRanging) {
                const bbValues = BollingerBands.calculate({ period: params.qsc_bbPeriod, stdDev: params.qsc_bbStdDev, values: closes });
                const bb = getLast(bbValues) as BollingerBandsOutput | undefined;
                if (bb) {
                    agentStopLoss = isLong ? bb.lower - (currentAtr * 0.2 * leverageFactor) : bb.upper + (currentAtr * 0.2 * leverageFactor);
                }
            }
        }
    } else { // DAY TRADING & SWING TRADING
        // Start with a standard ATR-based volatility stop as the default safe option.
        const stopDistance = agent.id === 21
            ? currentAtr * atrMultiplier // No leverageFactor for Pivot Point Supertrend
            : currentAtr * atrMultiplier * leverageFactor; // Default logic for others

        const volatilityStop = isLong ? entryPrice - stopDistance : entryPrice + stopDistance;
        agentStopLoss = volatilityStop;

        // Now, calculate a structural stop as a potential *tighter* alternative.
        let structuralStop: number | undefined;
        switch (agent.id) {
            case 14: // Sentinel
            case 18: // Conductor
            case 19: // AstraX
                const swingPoints = findSwingPoints(klines, params.conductor_swingLookback);
                const lastSwing = isLong ? swingPoints.filter(p => p.type === 'low').pop() : swingPoints.filter(p => p.type === 'high').pop();
                if (lastSwing) {
                    const atrBuffer = currentAtr * (agent.id === 19 ? 0.25 : params.conductor_slAtrMultiplier) * leverageFactor;
                    structuralStop = isLong ? lastSwing.price - atrBuffer : lastSwing.price + atrBuffer;
                }
                break;
        }
        
        // For 'day' and 'swing', use the structural stop ONLY if it's tighter (less risk) than the volatility stop.
        if (structuralStop !== undefined) {
            if (isLong && structuralStop > agentStopLoss) { // Higher price = tighter stop for a long
                agentStopLoss = structuralStop;
            } else if (!isLong && structuralStop < agentStopLoss) { // Lower price = tighter stop for a short
                agentStopLoss = structuralStop;
            }
        }
    }
    
    let stopLossAfterInitialChecks = agentStopLoss;
    
    // --- Step 2: Enforce Minimum SL Distance (prevents stops that are too tight) ---
    const minSlOffset = entryPrice * (MIN_STOP_LOSS_PERCENT / 100);
    const minSafeStopLoss = isLong ? entryPrice - minSlOffset : entryPrice + minSlOffset;

    if ((isLong && stopLossAfterInitialChecks > minSafeStopLoss) || (!isLong && stopLossAfterInitialChecks < minSafeStopLoss)) {
        stopLossAfterInitialChecks = minSafeStopLoss;
    }

    // --- Step 3: Calculate Take Profit ---
    const stopLossDistance = Math.abs(entryPrice - stopLossAfterInitialChecks);
    
    const timeframeConfigForRr = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];
    let riskRewardRatio = timeframeConfigForRr.riskRewardRatio;
    if (agent.id === 13) riskRewardRatio = 4;
    let suggestedTakeProfit = isLong 
        ? entryPrice + (stopLossDistance * riskRewardRatio) 
        : entryPrice - (stopLossDistance * riskRewardRatio);

    if (agent.id === 14 && params.sentinel_useSrLevelsForTp) {
        const srLevels = calculateSupportResistance(klines, 15, 0.005);
        const buffer = currentAtr * 0.2;
        let targetSrLevel: number | undefined;
        if (isLong) {
            const nextResistance = srLevels.resistances.filter(r => r.price > entryPrice).sort((a, b) => a.price - b.price)[0];
            if (nextResistance) targetSrLevel = nextResistance.price - buffer;
        } else {
            const nextSupport = srLevels.supports.filter(s => s.price < entryPrice).sort((a, b) => b.price - a.price)[0];
            if (nextSupport) targetSrLevel = nextSupport.price + buffer;
        }
        if (targetSrLevel) {
            const reward = Math.abs(targetSrLevel - entryPrice);
            const rrRatio = stopLossDistance > 0 ? reward / stopLossDistance : 0;
            if (rrRatio >= Math.max(1.0, constants.MIN_RISK_REWARD_RATIO - 0.5)) {
                suggestedTakeProfit = targetSrLevel;
            }
        }
    }

    // --- Step 4: No Hard Cap. The stop loss is the agent's calculated stop loss. ---
    // The veto for this risk is now handled exclusively in validateTradeProfitability.
    let finalStopLoss = stopLossAfterInitialChecks;
    const slReason: 'Agent Logic' | 'Hard Cap' = 'Agent Logic';

    // --- Step 5: CRITICAL FINAL SAFETY CHECKS ---
    let finalTakeProfit = suggestedTakeProfit;
    const positionValue = mode === TradingMode.USDSM_Futures ? investmentAmount * leverage : investmentAmount;
    const positionSize = (entryPrice > 0) ? positionValue / entryPrice : 0;

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
        finalStopLoss = isLong ? entryPrice * (1 - (MIN_STOP_LOSS_PERCENT/100)) : entryPrice * (1 + (MIN_STOP_LOSS_PERCENT/100));
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
        agentStopLoss: stopLossAfterInitialChecks
    };
}

export function validateTradeProfitability(
    entryPrice: number,
    agentStopLossPrice: number,
    takeProfitPrice: number,
    direction: 'LONG' | 'SHORT',
    config: BotConfig
): { isValid: boolean, reason: string } {
    const isLong = direction === 'LONG';

    if ((isLong && (agentStopLossPrice >= entryPrice || takeProfitPrice <= entryPrice)) ||
        (!isLong && (agentStopLossPrice <= entryPrice || takeProfitPrice >= entryPrice))) {
        return { isValid: false, reason: "❌ VETO: SL/TP targets are on the wrong side of the entry price." };
    }
    
    // --- True Initial Risk Veto Implementation ---
    if (config.isInitialRiskVetoEnabled) {
        const maxLossInDollars = config.investmentAmount * (config.maxMarginLossPercent / 100);
        const positionValue = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
        const tradeSize = (entryPrice > 0) ? positionValue / entryPrice : 0;
        
        if (tradeSize > 0) {
            const agentRiskInDollars = Math.abs(entryPrice - agentStopLossPrice) * tradeSize;
            if (agentRiskInDollars > maxLossInDollars) {
                return { isValid: false, reason: `❌ VETO: Agent's risk ($${agentRiskInDollars.toFixed(2)}) exceeds max setting of $${maxLossInDollars.toFixed(2)}.` };
            }
        }
    }

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

    if (config.isMinRrEnabled) {
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

// ... (rest of the file remains the same)
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

    const tiers = [
        { triggerPercent: 600, lockPercent: 0.80, tier: 4 },
        { triggerPercent: 400, lockPercent: 0.70, tier: 3 },
        { triggerPercent: 200, lockPercent: 0.60, tier: 2 },
        { triggerPercent: 100, lockPercent: 0.50, tier: 1 },
    ];

    const applicableTier = tiers.find(t => pnlPercentage >= t.triggerPercent && profitSpikeTier < t.tier);

    if (applicableTier) {
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

    if (isBreakevenSet) {
        return { reasons: [] };
    }

    const isLong = direction === 'LONG';
    const currentPnlDollars = (currentPrice - entryPrice) * size * (isLong ? 1 : -1);
    
    if (currentPnlDollars <= 0) {
        return { reasons: [] };
    }
    
    const positionValueDollars = entryPrice * size;
    const roundTripFeeDollars = positionValueDollars * takerFeeRate * 2;

    if (roundTripFeeDollars > 0 && currentPnlDollars >= (roundTripFeeDollars * 2)) {
        const feeRate = takerFeeRate;
        const breakevenStop = isLong
            ? entryPrice * (1 + feeRate) / (1 - feeRate)
            : entryPrice * (1 - feeRate) / (1 + feeRate);

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
    
    // FIX: Changed logic to give more breathing room. Trail starts locking profit only after 4x fees are covered.
    if (currentFeeMultiple > profitLockTier && currentFeeMultiple >= 4) {
        const lockFeeMultiple = currentFeeMultiple - 3; // Previously was -2
        
        if (lockFeeMultiple > 1) {
            // FIX: Explicitly cast to number to resolve potential type inference issue.
            const lockedPnlDollars = Number(roundTripFeeDollars) * lockFeeMultiple;
            const lockedPnlInPrice = lockedPnlDollars / size;
            const newStopLoss = entryPrice + (lockedPnlInPrice * (isLong ? 1 : -1));

            if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
                const reason = `Universal Trail: Tier ${currentFeeMultiple - 3} activated at ${currentFeeMultiple}x fee gain.`;
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
    
    // --- 1R PROFIT GATEKEEPER ---
    const { entryPrice, direction, initialRiskInPrice } = position;
    if (!initialRiskInPrice || initialRiskInPrice <= 0) {
        // Failsafe if initialRiskInPrice is not set, don't trail.
        return { reasons: [`ℹ️ Agent Trail: Initial risk not defined.`] };
    }
    const isLong = direction === 'LONG';
    const currentProfitInPrice = isLong ? currentPrice - entryPrice : entryPrice - currentPrice;

    // Only allow trailing after 1R of profit is achieved.
    if (currentProfitInPrice < initialRiskInPrice) {
        return { reasons: [`ℹ️ Agent Trail: Awaiting 1R profit target.`] };
    }
    // --- END GATEKEEPER ---
    
    const reasons: string[] = [];
    let newStopLoss: number | undefined;
    let action: TradeManagementSignal['action'] = 'hold';

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);

    const { takeProfitPrice, timeFrame } = position;
    
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
        case 9:
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
                    // FIX: Type 'unknown' is not assignable to type 'number'. Corrected to handle potential 'undefined' and ensure it's a number for arithmetic operation.
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
            {
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
                    const baseMultiplier = params.sentinel_stMultiplier;
                    const trailMultiplier = Math.max(1, baseMultiplier / profitVelocity);
                    if (profitVelocity > 1) reasons.push(`Agent Trail: Profit Velocity active (${profitVelocity}x speed)`);
                    else reasons.push('Agent Supertrend Trail');
                    newStopLoss = getLast(Supertrend.calculate({ high: highs, low: lows, close: closes, period: params.sentinel_stPeriod, multiplier: trailMultiplier })) as number | undefined;
                } else {
                    reasons.push(`ℹ️ Momentum faded. Trailing SL is frozen.`);
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

        case 19:
            {
                const swingPoints = findSwingPoints(klines, params.astraX_structureLookback || 8);
                const structure = analyzeMarketStructure(swingPoints);
                if ((isLong && structure.lastSignal === 'ChoCH_Bearish') || (!isLong && structure.lastSignal === 'ChoCH_Bullish')) {
                    newStopLoss = isLong ? currentPrice * 0.999 : currentPrice * 1.001;
                    reasons.push('AstraX Tier 3: Market structure broke against position.');
                    break;
                }
        
                const rsiValues = RSI.calculate({ period: 14, values: closes });
                if (detectRsiDivergence(klines, rsiValues, position.direction, 14)) {
                     const breakevenPrice = isLong
                        ? position.entryPrice * (1 + position.takerFeeRate) / (1 - position.takerFeeRate)
                        : position.entryPrice * (1 - position.takerFeeRate) / (1 + position.takerFeeRate);
                    newStopLoss = breakevenPrice;
                    reasons.push('AstraX Tier 2: Divergence detected, moving SL to Break-even.');
                    break;
                }
        
                const macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false })) as MACDOutput | undefined;
                // FIX: Use `typeof` check to safely access `histogram` which might be `unknown` or `undefined`.
                if ((isLong && typeof macd?.histogram === 'number' && macd.histogram < 0) || (!isLong && typeof macd?.histogram === 'number' && macd.histogram > 0)) {
                    const fastEma = getLast(EMA.calculate({ period: 9, values: closes }));
                    if (fastEma) {
                        // FIX: Cast `fastEma` to number on assignment as `getLast` may return `unknown`.
                        newStopLoss = fastEma as number;
                        reasons.push('AstraX Tier 1: Momentum faded, trailing with fast EMA.');
                    }
                }
            }
            break;
            
        case 20: // Supertrend Flipper uses its own line as a natural trail
            newStopLoss = getLast(Supertrend.calculate({
                high: highs, low: lows, close: closes,
                period: params.stf_atrPeriod!, multiplier: params.stf_atrMultiplier!
            })) as number | undefined;
            if (newStopLoss) {
                reasons.push('Agent Supertrend Trail');
            }
            break;

        default:
            break;
    }
    
    if (position.isBreakevenSet && newStopLoss !== undefined) {
        const feeRate = position.takerFeeRate;
        const breakevenPrice = isLong
            ? position.entryPrice * (1 + feeRate) / (1 - feeRate)
            // FIX: Corrected breakeven calculation for short positions.
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
): { newTakeProfit?: number; newStopLoss?: number; reason?: string; newState?: Partial<Position>; activeStopLossReason?: Position['activeStopLossReason'] } {
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
        
        const isStillProfitable = (isLong && newTakeProfit > entryPrice) || (!isLong && newTakeProfit < entryPrice);
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
            const unrealizedPnlInPrice = (currentPrice - entryPrice) * (isLong ? 1 : -1);
            if (unrealizedPnlInPrice > 0) {
                const profitToLockInPrice = unrealizedPnlInPrice * 0.90;
                const newStopLoss = entryPrice + (profitToLockInPrice * (isLong ? 1 : -1));

                const isTighter = (isLong && newStopLoss > position.stopLossPrice) || (!isLong && newStopLoss < position.stopLossPrice);
                
                if (isTighter) {
                    return {
                        newTakeProfit,
                        newStopLoss,
                        reason: `Adaptive TP: Extending target & locking 90% of profit due to strong momentum.`,
                        newState: { adaptiveTpTriggered: true },
                        activeStopLossReason: 'Profit Secure'
                    };
                }
            }
            
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
    klines: Kline[], // Main TF klines for context
    microKlines: Kline[] | undefined, // Micro TF klines for reactivity
    currentPrice: number,
): GuardianSignal {
    const config = position.botConfigSnapshot;
    if (!config || klines.length < 50) {
        return { action: 'hold' };
    }
    
    const params = constants.TRADE_GUARDIAN_CONFIG[position.timeFrame] || constants.TRADE_GUARDIAN_CONFIG['15m'];
    const strikes = new Set<string>();
    const isLong = position.direction === 'LONG';
    
    // --- Reactive Checks on Micro-Timeframe Data ---
    if (microKlines && microKlines.length >= 20) {
        const microCloses = microKlines.map(k => k.close);
        const microVolumes = microKlines.map(k => k.volume || 0);
        
        // --- Check 1: Momentum Exhaustion (on Micro TF) ---
        const rsi14 = getLast(RSI.calculate({ period: 14, values: microCloses })) as number | undefined;
        const rsi7 = getLast(RSI.calculate({ period: 7, values: microCloses })) as number | undefined;

        // Fast RSI check (early warning)
        if (params.rsi7_long_threshold && rsi7 !== undefined) {
            if (isLong && rsi7 < params.rsi7_long_threshold) strikes.add('Fast Momentum Weakness (RSI7)');
            if (!isLong && params.rsi7_short_threshold && rsi7 > params.rsi7_short_threshold) strikes.add('Fast Momentum Weakness (RSI7)');
        }
        
        // Slow RSI check (stronger signal)
        if (rsi14 !== undefined) {
            if (isLong && rsi14 < params.rsi14_long_threshold) strikes.add('Core Momentum Failure (RSI14)');
            if (!isLong && rsi14 > params.rsi14_short_threshold) strikes.add('Core Momentum Failure (RSI14)');
        }

        const obv_values = OBV.calculate({ close: microCloses, volume: microVolumes });
        if (obv_values.length > 5) {
            const price_slope_positive = (getLast(microCloses)! - microCloses[microCloses.length - 5]) > 0;
            const obv_slope_positive = ((getLast(obv_values) as number) - obv_values[obv_values.length - 5]) > 0;
            if (isLong && price_slope_positive && !obv_slope_positive) strikes.add('Momentum Exhaustion (OBV Divergence)');
            if (!isLong && !price_slope_positive && obv_slope_positive) strikes.add('Momentum Exhaustion (OBV Divergence)');
        }

        // --- Check 2: Candle Behavior Shift (on Micro TF) ---
        if (microKlines.length >= 2) {
            const prevMicroKline = microKlines[microKlines.length - 2];
            const lastMicroKline = microKlines[microKlines.length - 1];
            const engulfingInput = { 
                open: [prevMicroKline.open, lastMicroKline.open], 
                high: [prevMicroKline.high, lastMicroKline.high], 
                low: [prevMicroKline.low, lastMicroKline.low], 
                close: [prevMicroKline.close, lastMicroKline.close]
            };
            if (isLong && getLast(bearishengulfingpattern(engulfingInput))) {
                strikes.add('Bearish Engulfing Candle (Micro)');
            }
            if (!isLong && getLast(bullishengulfingpattern(engulfingInput))) {
                strikes.add('Bullish Engulfing Candle (Micro)');
            }
        }
        const last3micro = microKlines.slice(-3);
        if (isLong && last3micro.length === 3 && last3micro.every(k => k.close < k.open)) strikes.add('3 consecutive micro-bear candles');
        if (!isLong && last3micro.length === 3 && last3micro.every(k => k.close > k.open)) strikes.add('3 consecutive micro-bull candles');
    }

    // --- Contextual Checks on Main Timeframe Data ---
    const mainCloses = klines.map(k => k.close);
    const mainHighs = klines.map(k => k.high);
    const mainLows = klines.map(k => k.low);
    const lastMainKline = getLast(klines)!;

    // --- Check 3: ATR/Volatility Spike (on Main TF) ---
    const currentAtr = getLast(ATR.calculate({ high: mainHighs, low: mainLows, close: mainCloses, period: 14 }));
    if (position.entryAtr && currentAtr && currentAtr > position.entryAtr * params.atrSpikeMultiplier) {
        const isAgainst = isLong ? lastMainKline.close < lastMainKline.open : lastMainKline.close > lastMainKline.open;
        if (isAgainst) {
            strikes.add('Volatility Spike Reversal');
        }
    }

    // --- Check 4: VWAP/EMA Guardian (on Main TF) ---
    const vwap = getLast(calculateDailyVwap(klines));
    const ema = getLast(EMA.calculate({ period: params.vwapEmaPeriod, values: mainCloses }));
    if (vwap !== undefined && ema !== undefined) {
        if (isLong && currentPrice < vwap && currentPrice < ema) {
            strikes.add('Broken below VWAP/EMA support');
        }
        if (!isLong && currentPrice > vwap && currentPrice > ema) {
            strikes.add('Broken above VWAP/EMA resistance');
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

    if (strikes.size >= 4) {
        return { action: 'close', reason: `Trade Guardian Exit: ${[...strikes].join('; ')}` };
    }

    return { action: 'hold' };
}