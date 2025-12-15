
// services/riskManagementService.ts

import { TradingMode, Agent, Kline, AgentParams, Position, ADXOutput, MACDOutput, BollingerBandsOutput, StochasticRSIOutput, TradeManagementSignal, BotConfig, IchimokuCloudOutput } from '../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV, IchimokuCloud, bearishengulfingpattern, bullishengulfingpattern, darkcloudcover, dragonflydoji, gravestonedoji, hammerpattern, hangingman, morningstar, piercingline, shootingstar, eveningstar } from 'technicalindicators';
import * as constants from '../constants';
import { calculateSupportResistance, findSwingPoints, analyzeMarketStructure } from './chartAnalysisService';
import { Supertrend, applyTimeframeSettings, getLast, getPenultimate, captureMarketContext, detectRsiDivergence, calculateDailyVwap, analyzeBitcoinState } from './agents/agentUtils';
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
    originalConfig: BotConfig,
    tradeType?: 'conviction' | 'scalp',
    providedStopLoss?: number // NEW: Allow agent to pass exact stop
): { stopLossPrice: number; takeProfitPrice: number; slReason: 'Agent Logic' | 'Hard Cap'; agentStopLoss: number; } {
    const config = applyTimeframeSettings(originalConfig);
    const { timeFrame, agent, investmentAmount, mode, leverage } = config;
    const params = config.agentParams as Required<AgentParams>;

    const isLong = direction === 'LONG';
    
    // Special handling for Supertrend Flipper agent
    if (agent.id === 20) {
        const virtualStopDistance = entryPrice * 0.95;
        const virtualTpDistance = entryPrice * 100;

        const stopLossPrice = isLong ? entryPrice - virtualStopDistance : entryPrice + virtualStopDistance;
        const takeProfitPrice = isLong ? entryPrice + virtualTpDistance : entryPrice - virtualTpDistance;

        return {
            stopLossPrice,
            takeProfitPrice,
            slReason: 'Agent Logic',
            agentStopLoss: stopLossPrice,
        };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);

    // --- DYNAMIC MULTIPLIER LOGIC ---
    const atrPeriod = params.atrPeriod || 14;
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: atrPeriod });
    const currentAtr = (getLast(atrValues) as number | undefined) || (entryPrice * 0.01);
    
    // Calculate Long-Term Average Volatility (Baseline)
    const longTermAtrPeriod = 100;
    const longTermAtrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: longTermAtrPeriod });
    const avgAtr = getLast(longTermAtrValues) || currentAtr;
    
    // Volatility Ratio: > 1.0 means market is hotter than usual.
    const volatilityRatio = avgAtr > 0 ? currentAtr / avgAtr : 1.0;
    
    // Volatility Scalar: Clamp between 0.8 (calm, tighter stops) and 1.5 (chaos, wider stops)
    // This breathes with the market.
    const volatilityScalar = Math.max(0.8, Math.min(1.5, volatilityRatio));

    // --- LEVERAGE GUARD (Prevent Liquidation Proximity) ---
    // Higher leverage reduces the distance to liquidation.
    // 1/Leverage is roughly the liquidation distance (e.g., 20x = 5%).
    // We must ensure the SL is safer than 80% of the liquidation distance.
    const liquidationDistancePercent = 1 / leverage;
    const maxSafeStopDistancePercent = liquidationDistancePercent * 0.8;
    const maxSafeStopDistance = entryPrice * maxSafeStopDistancePercent;

    const timeframeConfig = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];
    
    // Apply volatility scalar to the base multiplier
    let atrMultiplier = timeframeConfig.atrMultiplier * volatilityScalar;
    
    // Adjust Risk Reward requirement based on volatility. 
    // In high volatility, we expect larger moves, so we can aim higher.
    let riskRewardRatio = timeframeConfig.riskRewardRatio * (volatilityRatio > 1.2 ? 1.2 : 1.0);

    // --- HANDLING PROVIDED STOP LOSS (e.g. from AstraX Sweep) ---
    if (providedStopLoss) {
        let finalStopLoss = providedStopLoss;
        
        // 1. Minimum Volatility Check
        const minVolatilityDist = currentAtr * 0.5; 
        const providedDist = Math.abs(entryPrice - providedStopLoss);
        
        if (providedDist < minVolatilityDist) {
             finalStopLoss = isLong ? entryPrice - minVolatilityDist : entryPrice + minVolatilityDist;
        }

        // 2. Leverage Safety Clamp
        const distFromEntry = Math.abs(entryPrice - finalStopLoss);
        if (distFromEntry > maxSafeStopDistance) {
            // Clamp stop loss to be safe from liquidation
            finalStopLoss = isLong ? entryPrice - maxSafeStopDistance : entryPrice + maxSafeStopDistance;
        }

        const riskDistance = Math.abs(entryPrice - finalStopLoss);
        
        // --- STRUCTURAL TAKE PROFIT SCAN ---
        // Try to find a realistic structural target first
        let finalTakeProfit = 0;
        const srLevels = calculateSupportResistance(klines, 30, 0.015);
        let structuralTpFound = false;

        if (isLong) {
            // Find next major resistance
            const nextRes = srLevels.resistances.find(r => r.price > entryPrice + (riskDistance * 1.5)); // Must offer at least 1.5R
            if (nextRes) {
                finalTakeProfit = nextRes.price * 0.998; // Front-run the level slightly
                structuralTpFound = true;
            }
        } else {
            // Find next major support
            const nextSup = srLevels.supports.find(s => s.price < entryPrice - (riskDistance * 1.5)); // Must offer at least 1.5R
            if (nextSup) {
                finalTakeProfit = nextSup.price * 1.002; // Front-run the level slightly
                structuralTpFound = true;
            }
        }

        if (!structuralTpFound) {
            // Fallback to R:R
            const rrMultiplier = tradeType === 'scalp' ? 1.5 : 2.5; 
            finalTakeProfit = isLong 
                ? entryPrice + (riskDistance * rrMultiplier)
                : entryPrice - (riskDistance * rrMultiplier);
        }

        return {
            stopLossPrice: finalStopLoss,
            takeProfitPrice: finalTakeProfit,
            slReason: 'Agent Logic',
            agentStopLoss: finalStopLoss
        };
    }

    const timeframeCategory = ['1m', '3m', '5m'].includes(timeFrame) ? 'scalping'
        : ['15m', '30m', '1h'].includes(timeFrame) ? 'day'
        : 'swing';

    // --- Step 1: Calculate Agent-Specific Stop Loss (Fallback if not provided) ---
    let agentStopLoss: number;

    if (timeframeCategory === 'scalping') {
        const lastKline = klines[klines.length - 1];
        const prevKline = klines[klines.length - 2];
        const atrBuffer = currentAtr * 0.5 * volatilityScalar; 

        let stopCandidate: number;
        if (isLong) {
            const lowestLow = Math.min(lastKline.low, prevKline?.low || lastKline.low);
            stopCandidate = lowestLow - atrBuffer;
        } else {
            const highestHigh = Math.max(lastKline.high, prevKline?.high || lastKline.high);
            stopCandidate = highestHigh + atrBuffer;
        }
        agentStopLoss = stopCandidate;

        if (agent.id === 9) {
             // Quantum Scalper specific BB logic
            const bbValues = BollingerBands.calculate({ period: params.qsc_bbPeriod, stdDev: params.qsc_bbStdDev, values: closes });
            const bb = getLast(bbValues) as BollingerBandsOutput | undefined;
            if (bb) {
                const adxValues = ADX.calculate({ high: highs, low: lows, close: closes, period: params.qsc_adxPeriod });
                const adx = getLast(adxValues) as ADXOutput | undefined;
                if (adx && adx.adx < params.qsc_adxThreshold) {
                     agentStopLoss = isLong ? bb.lower - (currentAtr * 0.2) : bb.upper + (currentAtr * 0.2);
                }
            }
        }
    } else { // DAY TRADING & SWING TRADING
        const stopDistance = currentAtr * atrMultiplier;
        const volatilityStop = isLong ? entryPrice - stopDistance : entryPrice + stopDistance;
        agentStopLoss = volatilityStop;

        let structuralStop: number | undefined;
        // Agents that prefer structural stops
        if ([14, 18, 19].includes(agent.id)) {
            const swingPoints = findSwingPoints(klines, params.conductor_swingLookback || 8);
            const lastSwing = isLong ? swingPoints.filter(p => p.type === 'low').pop() : swingPoints.filter(p => p.type === 'high').pop();
            if (lastSwing) {
                const buffer = currentAtr * 0.5;
                structuralStop = isLong ? lastSwing.price - buffer : lastSwing.price + buffer;
            }
        }
        
        if (structuralStop !== undefined) {
            const distStruct = Math.abs(entryPrice - structuralStop);
            const distVol = Math.abs(entryPrice - volatilityStop);
            
            // Use structural stop if it's sensible, otherwise stick to volatility stop
            if (distStruct > distVol * 0.5 && distStruct < distVol * 1.5) {
                 agentStopLoss = structuralStop;
            } else {
                 agentStopLoss = volatilityStop;
            }
        }
    }
    
    let stopLossAfterInitialChecks = agentStopLoss;
    
    // Leverage Safety Clamp (Global Check)
    const dist = Math.abs(entryPrice - stopLossAfterInitialChecks);
    if (dist > maxSafeStopDistance) {
        stopLossAfterInitialChecks = isLong ? entryPrice - maxSafeStopDistance : entryPrice + maxSafeStopDistance;
    }
    
    // Minimum safety distance check (0.5%)
    const minSlOffset = entryPrice * (MIN_STOP_LOSS_PERCENT / 100);
    const minSafeStopLoss = isLong ? entryPrice - minSlOffset : entryPrice + minSlOffset;

    // Only apply min safe stop if it doesn't violate leverage safety
    const minSafeDist = Math.abs(entryPrice - minSafeStopLoss);
    if (minSafeDist < maxSafeStopDistance) {
        if ((isLong && stopLossAfterInitialChecks > minSafeStopLoss) || (!isLong && stopLossAfterInitialChecks < minSafeStopLoss)) {
            stopLossAfterInitialChecks = minSafeStopLoss;
        }
    }

    const stopLossDistance = Math.abs(entryPrice - stopLossAfterInitialChecks);
    
    // --- Step 2: Realistic Take Profit (Structural) ---
    let structuralTakeProfit: number | undefined;
    
    // Calculate significant levels for TP
    const tpSrLevels = calculateSupportResistance(klines, 30, 0.01); 
    
    if (isLong) {
        const resistances = tpSrLevels.resistances
            .filter(r => r.price > entryPrice)
            .sort((a, b) => a.price - b.price);
        
        if (resistances.length > 0) {
            structuralTakeProfit = resistances[0].price - (currentAtr * 0.1);
        }
    } else {
        const supports = tpSrLevels.supports
            .filter(s => s.price < entryPrice)
            .sort((a, b) => b.price - a.price);
            
        if (supports.length > 0) {
            structuralTakeProfit = supports[0].price + (currentAtr * 0.1);
        }
    }

    let finalTakeProfit: number;

    if (structuralTakeProfit) {
        const potentialReward = Math.abs(structuralTakeProfit - entryPrice);
        const rr = potentialReward / stopLossDistance;
        
        // Only use structural TP if it offers a decent R:R (at least 1.2)
        if (rr >= 1.2) {
            finalTakeProfit = structuralTakeProfit;
        } else {
            // Structure is blocking us. Fallback to R:R calc but push it further.
            finalTakeProfit = isLong 
                ? entryPrice + (stopLossDistance * Math.max(riskRewardRatio, 2.0))
                : entryPrice - (stopLossDistance * Math.max(riskRewardRatio, 2.0));
        }
    } else {
        // No structure found nearby, use standard R:R
        finalTakeProfit = isLong 
            ? entryPrice + (stopLossDistance * riskRewardRatio) 
            : entryPrice - (stopLossDistance * riskRewardRatio);
    }

    let finalStopLoss = stopLossAfterInitialChecks;
    const slReason: 'Agent Logic' | 'Hard Cap' = 'Agent Logic';

    // Fee Buffer Check
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
    
    // Failsafes for invalid prices
    if ((isLong && finalStopLoss >= entryPrice) || (!isLong && finalStopLoss <= entryPrice)) {
        // Emergency fallback: If leverage constraint forced SL to entry, use min safe distance if possible
        // If not, we have a problem with config (too high leverage for volatility)
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
    
    if (currentFeeMultiple > profitLockTier && currentFeeMultiple >= 6) {
        const lockFeeMultiple = currentFeeMultiple - 3;
        
        if (lockFeeMultiple > 1) {
            const lockedPnlDollars = Number(roundTripFeeDollars) * lockFeeMultiple;
            const lockedPnlInPrice = lockedPnlDollars / size;
            const newStopLoss = entryPrice + (lockedPnlInPrice * (isLong ? 1 : -1));

            if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
                const reason = `Universal Trail: Tier ${lockFeeMultiple} activated at ${currentFeeMultiple}x fee gain.`;
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
    
    if (!botConfigSnapshot || !botConfigSnapshot.aggressiveTrailMode || botConfigSnapshot.aggressiveTrailMode === 'disabled' || !size || size <= 0) {
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
    const { entryPrice, direction, initialRiskInPrice, takeProfitPrice } = position;
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

    // --- SMART TRAIL METRICS ---
    // 1. Volatility Ratio
    const atr14Values = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const currentAtr = getLast(atr14Values) || (entryPrice * 0.01);
    
    // Use a longer period ATR as a baseline to determine if current volatility is high or low
    // If not enough data for 50, use 14 as baseline (ratio 1.0)
    const baselineAtrPeriod = klines.length > 50 ? 50 : 14;
    const baselineAtr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: baselineAtrPeriod })) || currentAtr;
    const volatilityRatio = baselineAtr > 0 ? currentAtr / baselineAtr : 1.0;

    // 2. Profit Progress
    const totalDist = Math.abs(takeProfitPrice - entryPrice);
    const currentDist = Math.abs(currentPrice - entryPrice);
    const progressToTarget = totalDist > 0 ? Math.max(0, currentDist / totalDist) : 0;

    // --- SMART SCALAR CALCULATION ---
    // A. Volatility Factor: 
    //    - High Volatility (>1.0) -> Loosen buffer (up to 1.3x) to ride out noise.
    //    - Low Volatility (<1.0) -> Tighten buffer (down to 0.8x) to protect against reversal.
    const volFactor = Math.max(0.8, Math.min(1.3, volatilityRatio));

    // B. Profit Factor (Squeeze):
    //    - As progress increases, we tighten the stop significantly to lock in gains.
    //    - 0% Progress -> 1.0x (Normal)
    //    - 90% Progress -> 0.4x (Very Tight)
    const profitFactor = Math.max(0.4, 1.0 - (progressToTarget * 0.6));

    const combinedSmartFactor = volFactor * profitFactor;

    switch (agent.id) {
        case 9: // Quantum Scalper (PSAR)
            let step = params.qsc_psarStep;
            let max = params.qsc_psarMax;
            
            // Accelerate PSAR based on profit progress
            if (progressToTarget > 0.5) {
                step *= 2;
                max *= 2;
                reasons.push(`Smart Trail: Accelerated PSAR (Progress > 50%)`);
            } else {
                 reasons.push('Agent PSAR Trail');
            }
            
            const psarInput = { high: highs, low: lows, step, max };
            if (psarInput.high.length >= 2) {
                const psar = getLast(PSAR.calculate(psarInput)) as number | undefined;
                if (psar) {
                    const buffer = currentAtr * 0.1;
                    newStopLoss = isLong ? psar - buffer : psar + buffer;
                }
            }
            break;

        case 11: 
        case 13: 
            const baseEmaPeriod = agent.id === 11 ? params.he_slowEmaPeriod : params.ch_slowEmaPeriod;
            // Tighten EMA period based on profit factor (smaller period = tighter trail)
            const trailEmaPeriod = Math.max(5, Math.round(baseEmaPeriod * profitFactor));
            
            reasons.push(`Smart Trail: EMA ${trailEmaPeriod} (Factor ${profitFactor.toFixed(2)})`);
            newStopLoss = getLast(EMA.calculate({ period: trailEmaPeriod, values: closes })) as number | undefined;
            break;

        case 14: // Sentinel
            {
                const rsi = getLast(RSI.calculate({ period: params.sentinel_rsiPeriod!, values: closes })) as number | undefined;
                const obvValues = OBV.calculate({ close: closes, volume: klines.map(k => k.volume || 0) });
                const obvDelta = (getLast(obvValues) || 0) - (getPenultimate(obvValues) || 0);

                let momentumSupportsTrail = false;
                if (rsi) {
                    if (isLong && rsi > 50 && obvDelta >= 0) momentumSupportsTrail = true;
                    else if (!isLong && rsi < 50 && obvDelta <= 0) momentumSupportsTrail = true;
                }

                if (momentumSupportsTrail) {
                    const baseMultiplier = params.sentinel_stMultiplier;
                    // Apply smart factor to multiplier (Smaller multiplier = Tighter Supertrend)
                    const trailMultiplier = Math.max(1.0, baseMultiplier * combinedSmartFactor);
                    
                    reasons.push(`Smart Sentinel Trail: Supertrend(${trailMultiplier.toFixed(2)})`);
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

        case 19: // AstraX
            // Dynamic Supertrend Trail
            // Base Multiplier: 3.5 (Standard)
            // Smart Multiplier: 3.5 * combinedSmartFactor
            const baseStMult = 3.5;
            const dynamicStMult = Math.max(1.0, baseStMult * combinedSmartFactor);
            
            const stValues = Supertrend.calculate({ 
                high: highs, 
                low: lows, 
                close: closes, 
                period: 10, 
                multiplier: dynamicStMult 
            });
            const smartSt = getLast(stValues);
            
            if (smartSt) {
                // Ensure the ST value is on the correct side of price to be a valid stop
                if (isLong && currentPrice > smartSt) {
                    newStopLoss = smartSt;
                    reasons.push(`AstraX Smart Trail: Supertrend(${dynamicStMult.toFixed(2)})`);
                } else if (!isLong && currentPrice < smartSt) {
                    newStopLoss = smartSt;
                    reasons.push(`AstraX Smart Trail: Supertrend(${dynamicStMult.toFixed(2)})`);
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

// === NEW ASTRAX SPECIFIC GUARDIAN ===
function getAstraXGuardianSignal(
    position: Position,
    klines: Kline[], 
    currentPrice: number,
    btcKlines?: Kline[]
): GuardianSignal {
    const isLong = position.direction === 'LONG';
    const params = position.agentParamsSnapshot as Required<AgentParams>;
    
    // 1. SCALP PROTECTION (For Liquidity Sweeps)
    // CRITICAL FIX: Use the STATIC invalidation price captured at entry.
    // This prevents the "drifting stop" bug where recalculation moves the invalidation level.
    if (position.tradeType === 'scalp' && position.invalidationPrice !== undefined) {
        if (isLong) {
            if (currentPrice < position.invalidationPrice) return { action: 'close', reason: 'AstraX Guardian: Bullish Sweep Invalidated (Low Broken)' };
        } else {
            if (currentPrice > position.invalidationPrice) return { action: 'close', reason: 'AstraX Guardian: Bearish Sweep Invalidated (High Broken)' };
        }
    }
    
    // 2. TIDE PROTECTION (BTC Correlation)
    // If we are LONG and BTC Crashes -> Panic Exit.
    // If we are SHORT and BTC Pumps -> Panic Exit.
    if (btcKlines) {
        const btcState = analyzeBitcoinState(btcKlines);
        if (isLong && btcState.state === 'CRASH') {
             return { action: 'close', reason: 'AstraX Guardian: Panic Exit (BTC Crash)' };
        }
        if (!isLong && btcState.state === 'PUMP') {
             return { action: 'close', reason: 'AstraX Guardian: Panic Exit (BTC Pump)' };
        }
    }

    // 3. CONVICTION PROTECTION (Trend Following)
    if (position.tradeType === 'conviction') {
        const closes = klines.map(k => k.close);
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        
        // A. Trend Strength Death (ADX)
        const adx = getLast(ADX.calculate({ period: 14, high: highs, low: lows, close: closes }));
        if (adx && adx.adx < 20) {
            return { action: 'close', reason: 'AstraX Guardian: Trend Died (ADX < 20)' };
        }
        
        // B. Supertrend Breach
        const st = getLast(Supertrend.calculate({ period: 10, multiplier: 3, high: highs, low: lows, close: closes }));
        if (st) {
            if (isLong && currentPrice < st) return { action: 'close', reason: 'AstraX Guardian: Trend Reversal (Supertrend)' };
            if (!isLong && currentPrice > st) return { action: 'close', reason: 'AstraX Guardian: Trend Reversal (Supertrend)' };
        }
    }
    
    return { action: 'hold' };
}

export function getTradeGuardianSignal(
    position: Position,
    klines: Kline[], 
    microKlines: Kline[] | undefined, 
    currentPrice: number,
    btcKlines?: Kline[]
): GuardianSignal {
    
    // --- ROUTING LOGIC ---
    if (position.agentId === 19) {
        return getAstraXGuardianSignal(position, klines, currentPrice, btcKlines);
    }
    
    const config = position.botConfigSnapshot;
    if (!config || klines.length < 50) {
        return { action: 'hold' };
    }
    
    const params = constants.TRADE_GUARDIAN_CONFIG[position.timeFrame] || constants.TRADE_GUARDIAN_CONFIG['15m'];
    const strikes = new Set<string>();
    const isLong = position.direction === 'LONG';
    
    if (microKlines && microKlines.length >= 20) {
        const microCloses = microKlines.map(k => k.close);
        const microVolumes = microKlines.map(k => k.volume || 0);
        
        const rsi14 = getLast(RSI.calculate({ period: 14, values: microCloses })) as number | undefined;
        const rsi7 = getLast(RSI.calculate({ period: 7, values: microCloses })) as number | undefined;

        if (params.rsi7_long_threshold && rsi7 !== undefined) {
            if (isLong && rsi7 < params.rsi7_long_threshold) strikes.add('Fast Momentum Weakness (RSI7)');
            if (!isLong && params.rsi7_short_threshold && rsi7 > params.rsi7_short_threshold) strikes.add('Fast Momentum Weakness (RSI7)');
        }
        
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

    const mainCloses = klines.map(k => k.close);
    const mainHighs = klines.map(k => k.high);
    const mainLows = klines.map(k => k.low);
    const lastMainKline = getLast(klines)!;

    const currentAtr = getLast(ATR.calculate({ high: mainHighs, low: mainLows, close: mainCloses, period: 14 }));
    if (position.entryAtr && currentAtr && currentAtr > position.entryAtr * params.atrSpikeMultiplier) {
        const isAgainst = isLong ? lastMainKline.close < lastMainKline.open : lastMainKline.close > lastMainKline.open;
        if (isAgainst) {
            strikes.add('Volatility Spike Reversal');
        }
    }

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

    const mfe_in_price = isLong ? Math.max(0, position.peakPrice - position.entryPrice) : Math.max(0, position.entryPrice - position.peakPrice);
    if (position.initialRiskInPrice && mfe_in_price > position.initialRiskInPrice * 1.2) {
        const retrace_in_price = isLong ? position.peakPrice - currentPrice : currentPrice - position.peakPrice;
        if (mfe_in_price > 0 && retrace_in_price > 0 && retrace_in_price / mfe_in_price > params.pnlRetracePercent) {
            strikes.add('PnL Retracement');
        }
    }

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
