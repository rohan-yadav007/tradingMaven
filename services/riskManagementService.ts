// services/riskManagementService.ts

import { TradingMode, Agent, TradeSignal, Kline, AgentParams, Position, ADXOutput, MACDOutput, BollingerBandsOutput, StochasticRSIOutput, TradeManagementSignal, BotConfig, VortexIndicatorOutput, SentinelAnalysis, IchimokuCloudOutput, MarketDataContext } from '../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV, IchimokuCloud, KST, bearishengulfingpattern, bullishengulfingpattern, darkcloudcover, dragonflydoji, gravestonedoji, hammerpattern, hangingman, morningstar, piercingline, shootingstar, eveningstar } from 'technicalindicators';
import * as constants from '../constants';
import { calculateSupportResistance } from './chartAnalysisService';
import { Supertrend, applyTimeframeSettings, getLast, getPenultimate, captureMarketContext, detectRsiDivergence } from './agents/agentUtils';
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

    // Default Fallback SL
    const fallbackStop = () => {
        const timeframeConfig = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];
        const atrMultiplier = timeframeConfig.atrMultiplier;
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
            
        case 14: // The Sentinel: SL based on Supertrend.
            const st = getLast(Supertrend.calculate({ 
                high: highs, 
                low: lows, 
                close: closes, 
                period: params.sentinel_stPeriod, 
                multiplier: params.sentinel_stMultiplier 
            })) as number | undefined;
            if (st && ((isLong && st < entryPrice) || (!isLong && st > entryPrice))) {
                agentStopLoss = st;
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

    // --- Step 3: Calculate Take Profit based on agent logic or R:R ---
    const stopLossDistance = Math.abs(entryPrice - stopLossAfterInitialChecks);
    let suggestedTakeProfit: number;
    const timeframeConfig = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];
    
    // S/R based TP for Sentinel
    if (agent.id === 14 && params.sentinel_useSrLevelsForTp) {
        const srLevels = calculateSupportResistance(klines);
        const srTarget = isLong
            ? srLevels.resistances.filter(r => r.price > entryPrice).sort((a, b) => a.price - b.price)[0]
            : srLevels.supports.filter(s => s.price < entryPrice).sort((a, b) => b.price - a.price)[0];
            
        if (srTarget) {
            const atrBuffer = currentAtr * 0.1; // 10% ATR buffer
            suggestedTakeProfit = isLong ? srTarget.price - atrBuffer : srTarget.price + atrBuffer;
        } else {
            // Fallback to R:R if no S/R level is found
            const riskRewardRatio = timeframeConfig.riskRewardRatio;
            suggestedTakeProfit = isLong ? entryPrice + (stopLossDistance * riskRewardRatio) : entryPrice - (stopLossDistance * riskRewardRatio);
        }
    } else {
        // Original R:R logic for all other agents
        let riskRewardRatio = timeframeConfig.riskRewardRatio;
        if (agent.id === 13) {
            riskRewardRatio = 4; // Special R:R for Chameleon
        }
        suggestedTakeProfit = isLong ? entryPrice + (stopLossDistance * riskRewardRatio) : entryPrice - (stopLossDistance * riskRewardRatio);
    }


    // --- Step 4: Apply Hard Cap as the FINAL, non-negotiable limit ---
    let finalStopLoss = stopLossAfterInitialChecks;
    let slReason: 'Agent Logic' | 'Hard Cap' = 'Agent Logic';

    const maxLossInDollars = config.investmentAmount * (config.maxMarginLossPercent / 100);
    const positionValue = mode === TradingMode.USDSM_Futures ? config.investmentAmount * leverage : config.investmentAmount;
    const positionSize = positionValue / entryPrice;

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
    const tradeSize = positionValue / entryPrice;
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

    const currentFeeMultiple = currentPnlDollars / roundTripFeeDollars;
    const triggerFeeMultiple = Math.floor(currentFeeMultiple);

    if (triggerFeeMultiple <= profitLockTier) {
        return { reasons: [] };
    }

    // Handle the first profit lock (breakeven equivalent) if it hasn't been done
    if (triggerFeeMultiple >= 2 && profitLockTier < 2) {
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
    
    // Handle subsequent profit locks (N-1) for N >= 3
    if (triggerFeeMultiple > profitLockTier && triggerFeeMultiple >= 3) {
        const lockFeeMultiple = triggerFeeMultiple - 1;
        const lockedPnlDollars = roundTripFeeDollars * lockFeeMultiple;
        const lockedPnlInPrice = lockedPnlDollars / size;
        const newStopLoss = entryPrice + (lockedPnlInPrice * (isLong ? 1 : -1));

        if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
            const reason = `Universal Trail: Tier ${triggerFeeMultiple - 2} activated at ${triggerFeeMultiple}x fee gain.`;
            return {
                newStopLoss,
                reasons: [reason],
                newState: { profitLockTier: triggerFeeMultiple },
                activeStopLossReason: 'Profit Secure'
            };
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
        return { reasons: [] }; // Only trail when in profit
    }
    
    let applicableTier: { trigger: number; lock: number; tier: number } | undefined;

    if (botConfigSnapshot.aggressiveTrailMode === 'distance') {
        const totalDistance = Math.abs(takeProfitPrice - entryPrice);
        if (totalDistance <= 1e-9) return { reasons: [] };

        const progressPercent = unrealizedPnlInPrice / totalDistance;
        const tiers = [
            { trigger: 0.9, lock: 0.80, tier: 4 }, // at 90% distance, lock 80% of current profit
            { trigger: 0.8, lock: 0.60, tier: 3 }, // at 80% distance, lock 60%
            { trigger: 0.6, lock: 0.40, tier: 2 }, // at 60% distance, lock 40%
            { trigger: 0.5, lock: 0.25, tier: 1 }, // at 50% distance, lock 25%
        ];
        applicableTier = tiers.find(t => progressPercent >= t.trigger && aggressiveTrailTier < t.tier);
    
    } else { // PNL mode
        const unrealizedPnl = unrealizedPnlInPrice * size;
        const pnlPercent = unrealizedPnl / investmentAmount;
        const tiers = [
            { trigger: 1.0, lock: 0.95, tier: 5 }, // at 100% PNL, lock 95%
            { trigger: 0.9, lock: 0.80, tier: 4 }, // at 90% PNL, lock 80%
            { trigger: 0.8, lock: 0.60, tier: 3 },
            { trigger: 0.6, lock: 0.40, tier: 2 },
            { trigger: 0.5, lock: 0.25, tier: 1 },
        ];
        applicableTier = tiers.find(t => pnlPercent >= t.trigger && aggressiveTrailTier < t.tier);
    }
    
    if (applicableTier) {
        const profitToLockInPrice = unrealizedPnlInPrice * applicableTier.lock;
        const newStopLoss = entryPrice + (profitToLockInPrice * (isLong ? 1 : -1));

        if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
            return {
                newStopLoss,
                reasons: [`Aggressive Trail (${botConfigSnapshot.aggressiveTrailMode}): Tier ${applicableTier.tier} activated.`],
                newState: { aggressiveTrailTier: applicableTier.tier },
                activeStopLossReason: 'Profit Secure'
            };
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
    const params = config.agentParams as Required<AgentParams>;
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
            const baseMultiplier = params.sentinel_stMultiplier;
            const trailMultiplier = Math.max(1, baseMultiplier / profitVelocity);
            if (profitVelocity > 1) reasons.push(`Agent Trail: Profit Velocity active (${profitVelocity}x speed)`);
            else reasons.push('Agent Supertrend Trail');
            newStopLoss = getLast(Supertrend.calculate({ high: highs, low: lows, close: closes, period: params.sentinel_stPeriod, multiplier: trailMultiplier })) as number | undefined;
            break;

        case 16:
            const ichi_params = { high: highs, low: lows, conversionPeriod: params.ichi_conversionPeriod, basePeriod: params.ichi_basePeriod, spanPeriod: params.ichi_laggingSpanPeriod, displacement: params.ichi_displacement };
            const ichiValues = IchimokuCloud.calculate(ichi_params);
            const lastIchi = getLast(ichiValues) as IchimokuCloudOutput | undefined;
            if(lastIchi) {
                newStopLoss = isLong ? lastIchi.spanA : lastIchi.spanB;
                if(newStopLoss) reasons.push('Agent Ichimoku Cloud Trail');
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

export async function getSupervisorSignal(
    position: Position,
    klines: Kline[],
    originalConfig: BotConfig,
    htfKlines?: Kline[]
): Promise<{ score: number; reasons: string[] }> {
    const config = applyTimeframeSettings(originalConfig);
    const params = config.agentParams as Required<AgentParams>;

    let score = 0;
    const reasons: string[] = [];

    if ((position.candlesSinceEntry || 0) < 3) {
        return { score: 0, reasons: ['Initial grace period.'] };
    }

    const currentContext = captureMarketContext(klines, htfKlines);
    const lastClose = currentContext.lastClose;
    if (!lastClose) return { score: 0, reasons: ['Could not get last close price.'] };

    const isLong = position.direction === 'LONG';

    // 0. SMC Reversal check (Max 85 points)
    if (config.isSmcVetoEnabled) {
        const closes = klines.map(k => k.close);
        const rsiValues = RSI.calculate({ period: 14, values: closes });
        const volumes = klines.map(k => k.volume || 0);
        const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes })) as number | undefined;
        
        // If we are LONG, we look for a BEARISH reversal pattern to exit.
        const reversalTypeToDetect = isLong ? 'bearish' : 'bullish';
        const smcResult = detectSmcReversalPattern(klines, reversalTypeToDetect, config, rsiValues, volumeSma);
        
        if (smcResult.detected) {
            score += 85; // High score to trigger exit across all sensitivity levels.
            reasons.push(smcResult.reason);
        }
    }


    // 1. Momentum Decay (Max 30 points)
    const rsi = currentContext.rsi14;
    if (rsi) {
        if (isLong && rsi < 48) {
            score += 30;
            reasons.push(`Momentum Faded (RSI < 48)`);
        } else if (!isLong && rsi > 52) {
            score += 30;
            reasons.push(`Momentum Faded (RSI > 52)`);
        }
    }

    // 2. Market Structure Break (Max 40 points)
    const ema21 = currentContext.ema21;
    if (ema21) {
        if (isLong && lastClose < ema21) {
            score += 40;
            reasons.push(`Market Structure Break (Price < EMA21)`);
        } else if (!isLong && lastClose > ema21) {
            score += 40;
            reasons.push(`Market Structure Break (Price > EMA21)`);
        }
    }
    
    // 3. Contradictory Candlestick Pattern (Max 20 points)
    const lastPattern = currentContext.lastCandlePattern;
    if (lastPattern) {
        if (isLong && lastPattern.type === 'bearish') {
            score += 20;
            reasons.push(`Contradictory Pattern (${lastPattern.name})`);
        } else if (!isLong && lastPattern.type === 'bullish') {
            score += 20;
            reasons.push(`Contradictory Pattern (${lastPattern.name})`);
        }
    }
    
    // 4. Time-Based & PNL Decay (Max 30 points)
    const candlesSinceEntry = position.candlesSinceEntry || 0;
    const invalidationCandleLimit = params.invalidationCandleLimit || 10;
    const currentPnlInPrice = (lastClose - position.entryPrice) * (isLong ? 1 : -1);

    if (currentPnlInPrice < 0 && candlesSinceEntry > invalidationCandleLimit) {
        // Penalty increases the longer the trade is in a loss.
        const decayScore = Math.min(30, Math.floor((candlesSinceEntry - invalidationCandleLimit) / (invalidationCandleLimit / 2)) * 10);
        if (decayScore > 0) {
            score += decayScore;
            reasons.push(`Negative PnL Decay (${candlesSinceEntry} candles in loss)`);
        }
    }

    return { score: Math.min(100, score), reasons };
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
    // FIX: Cast result of technical indicator to number | undefined to fix 'unknown' type error.
    const lastRsi = getLast(rsiValues) as number | undefined;
    const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;
    const macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false })) as MACDOutput | undefined;
    // FIX: Cast result of technical indicator to number | undefined to fix 'unknown' type error.
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
            return {
                newTakeProfit,
                reason: `Adaptive TP: Extending target due to strong momentum.`,
                newState: { adaptiveTpTriggered: true }
            };
        }
    }

    return {};
}
