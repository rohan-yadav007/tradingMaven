// services/riskManagementService.ts

import { TradingMode, Agent, Kline, AgentParams, Position, ADXOutput, MACDOutput, BollingerBandsOutput, StochasticRSIOutput, TradeManagementSignal, BotConfig, IchimokuCloudOutput } from '../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV, IchimokuCloud, bearishengulfingpattern, bullishengulfingpattern, darkcloudcover, dragonflydoji, gravestonedoji, hammerpattern, hangingman, morningstar, piercingline, shootingstar, eveningstar } from 'technicalindicators';
import * as constants from '../constants';
import { calculateSupportResistance, findSwingPoints, analyzeMarketStructure } from './chartAnalysisService';
import { Supertrend, applyTimeframeSettings, getLast, getPenultimate, captureMarketContext, detectRsiDivergence, calculateDailyVwap, analyzeBitcoinState, calculateRsiSlope } from './agents/agentUtils';

const MIN_STOP_LOSS_PERCENT = 0.5;
const { TIMEFRAME_ATR_CONFIG, MIN_PROFIT_BUFFER_MULTIPLIER } = constants;

// ----------------------------------------------------------------------------------
// --- #1: INITIAL TARGET CALCULATION (SL/TP) ---
// ----------------------------------------------------------------------------------
export function getInitialAgentTargets(
    klines: Kline[],
    entryPrice: number,
    direction: 'LONG' | 'SHORT',
    originalConfig: BotConfig,
    tradeType?: 'conviction' | 'scalp',
    providedStopLoss?: number
): { stopLossPrice: number; takeProfitPrice: number; slReason: 'Agent Logic' | 'Hard Cap'; agentStopLoss: number; } {
    const config = applyTimeframeSettings(originalConfig);
    const { timeFrame, agent, leverage } = config;
    const params = config.agentParams as Required<AgentParams>;

    const isLong = direction === 'LONG';
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);

    const atrPeriod = params.atrPeriod || 14;
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: atrPeriod });
    const currentAtr = (getLast(atrValues) as number | undefined) || (entryPrice * 0.01);

    // --- V6.1 ELITE LEVERAGE-CORRECTED NOISE FLOOR ---
    // High leverage requires more 'breathing room' percentage-wise to survive ticks
    const leverageBuffer = 1 + (leverage / 20); 
    const noiseFloorDist = currentAtr * 1.5 * leverageBuffer;

    const timeframeConfig = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];

    let finalStopLoss: number;
    let finalTakeProfit: number;
    let slReason: 'Agent Logic' | 'Hard Cap' = 'Agent Logic';

    if (agent.id === 19) {
        const lookback = tradeType === 'scalp' ? 15 : 40;
        const recent = klines.slice(-lookback);
        const structuralBase = isLong ? Math.min(...recent.map(k => k.low)) : Math.max(...recent.map(k => k.high));
        const structuralDist = Math.abs(entryPrice - structuralBase);
        
        const finalDist = Math.max(structuralDist, noiseFloorDist);
        
        finalStopLoss = isLong ? entryPrice - finalDist : entryPrice + finalDist;
        const targetRr = tradeType === 'scalp' ? 1.5 : 3.0;
        finalTakeProfit = isLong ? entryPrice + (finalDist * targetRr) : entryPrice - (finalDist * targetRr);
    } else if (providedStopLoss) {
        finalStopLoss = providedStopLoss;
        const stopDistance = Math.abs(entryPrice - finalStopLoss);
        finalTakeProfit = isLong ? entryPrice + (stopDistance * timeframeConfig.riskRewardRatio) : entryPrice - (stopDistance * timeframeConfig.riskRewardRatio);
    } else {
        const stopDistance = Math.max(currentAtr * timeframeConfig.atrMultiplier, noiseFloorDist);
        finalStopLoss = isLong ? entryPrice - stopDistance : entryPrice + stopDistance;
        finalTakeProfit = isLong ? entryPrice + (stopDistance * timeframeConfig.riskRewardRatio) : entryPrice - (stopDistance * timeframeConfig.riskRewardRatio);
    }

    return {
        stopLossPrice: finalStopLoss,
        takeProfitPrice: finalTakeProfit,
        slReason,
        agentStopLoss: finalStopLoss
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
        return { isValid: false, reason: "❌ VETO: Target Misplacement." };
    }
    
    if (config.isInitialRiskVetoEnabled) {
        const maxLossDollars = config.investmentAmount * (config.maxMarginLossPercent / 100);
        const posValue = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
        const tradeSize = posValue / entryPrice;
        
        const riskDollars = Math.abs(entryPrice - agentStopLossPrice) * tradeSize;
        if (riskDollars > maxLossDollars) {
            return { isValid: false, reason: `❌ VETO: Risk ($${riskDollars.toFixed(2)}) > Allowed ($${maxLossDollars.toFixed(2)}).` };
        }
    }

    if (config.isMinRrEnabled) {
        const rr = Math.abs(takeProfitPrice - entryPrice) / Math.abs(entryPrice - agentStopLossPrice);
        if (rr < constants.MIN_RISK_REWARD_RATIO) return { isValid: false, reason: `❌ VETO: R:R (${rr.toFixed(2)}) < Min.` };
    }

    return { isValid: true, reason: `✅ Risk Cleared.` };
}

// ----------------------------------------------------------------------------------
// --- #2: TRADE MANAGEMENT (Trailing Systems) ---
// ----------------------------------------------------------------------------------

export function getProfitSpikeSignal(
    position: Position,
    currentPrice: number
): TradeManagementSignal {
    const { entryPrice, stopLossPrice, direction, size, investmentAmount, profitSpikeTier = 0 } = position;
    if (!investmentAmount || !size) return { reasons: [] };

    const isLong = direction === 'LONG';
    const currentPnl = (currentPrice - entryPrice) * size * (isLong ? 1 : -1);
    if (currentPnl <= 0) return { reasons: [] };

    const pnlPercentage = (currentPnl / investmentAmount) * 100;

    const tiers = [
        { triggerPercent: 120, lockPercent: 0.85, tier: 4 },
        { triggerPercent: 60, lockPercent: 0.70, tier: 3 },
        { triggerPercent: 30, lockPercent: 0.60, tier: 2 },
        { triggerPercent: 10, lockPercent: 0.40, tier: 1 },
    ];

    const applicableTier = tiers.find(t => pnlPercentage >= t.triggerPercent && profitSpikeTier < t.tier);

    if (applicableTier) {
        const lockedPnlDollars = currentPnl * applicableTier.lockPercent;
        const lockedPnlInPrice = lockedPnlDollars / size;
        const newStopLoss = entryPrice + (lockedPnlInPrice * (isLong ? 1 : -1));

        if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
            return {
                newStopLoss,
                reasons: [`Spike Protector: Locked gains at ${applicableTier.triggerPercent}% profit.`],
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
    if (isBreakevenSet || !size) return { reasons: [] };

    const isLong = direction === 'LONG';
    const currentPnlDollars = (currentPrice - entryPrice) * size * (isLong ? 1 : -1);
    if (currentPnlDollars <= 0) return { reasons: [] };
    
    const positionValueDollars = entryPrice * size;
    const roundTripFeeDollars = positionValueDollars * takerFeeRate * 2;

    if (roundTripFeeDollars > 0 && currentPnlDollars >= (roundTripFeeDollars * 2.5)) {
        const feeRate = takerFeeRate;
        const breakevenStop = isLong
            ? entryPrice * (1 + feeRate) / (1 - feeRate)
            : entryPrice * (1 - feeRate) / (1 + feeRate);

        if ((isLong && breakevenStop > stopLossPrice) || (!isLong && breakevenStop < stopLossPrice)) {
            return {
                newStopLoss: breakevenStop,
                reasons: [`Protected Breakeven set.`],
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
    if (!size) return { reasons: [] };
    const isLong = direction === 'LONG';
    const currentPnlDollars = (currentPrice - entryPrice) * size * (isLong ? 1 : -1);
    if (currentPnlDollars <= 0) return { reasons: [] };

    const positionValueDollars = entryPrice * size;
    const roundTripFeeDollars = positionValueDollars * takerFeeRate * 2;
    if (roundTripFeeDollars <= 0) return { reasons: [] };

    const currentFeeMultiple = Math.floor(currentPnlDollars / roundTripFeeDollars);
    if (currentFeeMultiple <= profitLockTier) return { reasons: [] };

    // Standard Universal Locking Tiers
    if (currentFeeMultiple >= 2 && profitLockTier < 2) {
        const feeRate = takerFeeRate;
        const breakevenStop = isLong ? entryPrice * (1 + feeRate) / (1 - feeRate) : entryPrice * (1 - feeRate) / (1 + feeRate);
        if ((isLong && breakevenStop > stopLossPrice) || (!isLong && breakevenStop < stopLossPrice)) {
            return { newStopLoss: breakevenStop, reasons: [`Universal Trail: BE Secured`], newState: { isBreakevenSet: true, profitLockTier: 2 }, activeStopLossReason: 'Breakeven' };
        }
    }
    
    if (currentFeeMultiple > profitLockTier && currentFeeMultiple >= 6) {
        const lockFeeMultiple = currentFeeMultiple - 3;
        if (lockFeeMultiple > 1) {
            const lockedPnlDollars = Number(roundTripFeeDollars) * lockFeeMultiple;
            const lockedPnlInPrice = lockedPnlDollars / size;
            const newStopLoss = entryPrice + (lockedPnlInPrice * (isLong ? 1 : -1));
            if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
                return { newStopLoss, reasons: [`Universal Trail: Locked ${lockFeeMultiple}x fees.`], newState: { profitLockTier: currentFeeMultiple }, activeStopLossReason: 'Profit Secure' };
            }
        }
    }
    return { reasons: [] };
}

export function getAggressiveRangeTrailSignal(
    position: Position,
    currentPrice: number
): TradeManagementSignal {
    const { entryPrice, stopLossPrice, takeProfitPrice, direction, size, aggressiveTrailTier = 0, botConfigSnapshot } = position;
    if (!botConfigSnapshot || !botConfigSnapshot.aggressiveTrailMode || botConfigSnapshot.aggressiveTrailMode === 'disabled' || !size) return { reasons: [] };

    const isLong = direction === 'LONG';
    const unrealizedPnlInPrice = (currentPrice - entryPrice) * (isLong ? 1 : -1);
    if (unrealizedPnlInPrice <= 0) return { reasons: [] };
    
    if (botConfigSnapshot.aggressiveTrailMode === 'distance') {
        const isSlBehindEntry = isLong ? stopLossPrice < entryPrice : stopLossPrice > entryPrice;
        const rangeStartPrice = isSlBehindEntry ? entryPrice : stopLossPrice;
        const totalDistance = Math.abs(takeProfitPrice - rangeStartPrice);
        if (totalDistance <= 1e-9) return { reasons: [] };
        const distanceTraveled = Math.abs(currentPrice - rangeStartPrice);
        const progressPercent = distanceTraveled / totalDistance;

        const tiers = [
            { trigger: 0.90, lock: 0.80, tier: 5 },
            { trigger: 0.75, lock: 0.60, tier: 4 },
            { trigger: 0.60, lock: 0.45, tier: 3 },
            { trigger: 0.45, lock: 0.30, tier: 2 },
            { trigger: 0.30, lock: 0.15, tier: 1 },
        ];
        const applicableTier = tiers.find(t => progressPercent >= t.trigger && aggressiveTrailTier < t.tier);
        if (applicableTier) {
            const distanceToLock = totalDistance * applicableTier.lock;
            const newStopLoss = isLong ? rangeStartPrice + distanceToLock : rangeStartPrice - distanceToLock;
            if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
                return { newStopLoss, reasons: [`Hyper Trail: Secured T${applicableTier.tier}`], newState: { aggressiveTrailTier: applicableTier.tier }, activeStopLossReason: 'Profit Secure' };
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
    const { direction } = position;
    const isLong = direction === 'LONG';
    const reasons: string[] = [];
    
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const closes = klines.map(k => k.close);

    // --- V6.1 ELITE ELASTIC TRAILING (ASTRAX ONLY) ---
    if (agent.id === 19) {
        const atr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: 10 })) || (currentPrice * 0.01);
        const pnlDist = Math.abs(currentPrice - position.entryPrice);
        const rr = pnlDist / position.initialRiskInPrice;
        
        // Elasticity Level 1: RR > 1.0 -> Move to Breakeven + Noise Buffer
        if (rr > 1.0 && !position.isBreakevenSet) {
             const bePrice = isLong ? position.entryPrice * 1.001 : position.entryPrice * 0.999;
             return { 
                newStopLoss: bePrice, 
                reasons: ['Elastic: RR 1.0 reached, snapping to Breakeven+'], 
                newState: { isBreakevenSet: true }, 
                activeStopLossReason: 'Breakeven' 
             };
        }

        // Elasticity Level 2: RR > 2.0 -> Parabolic Elastic Trail (0.5 ATR distance)
        if (rr > 2.0) {
            const newSL = isLong ? currentPrice - (atr * 0.5) : currentPrice + (atr * 0.5);
            if ((isLong && newSL > position.stopLossPrice) || (!isLong && newSL < position.stopLossPrice)) {
                return { 
                    newStopLoss: newSL, 
                    reasons: ['Elastic: High-precision trail active.'], 
                    activeStopLossReason: 'Agent Trail' 
                };
            }
        }
        
        // Structural Pivot Snapping
        const swingPoints = findSwingPoints(klines, 10);
        const pivots = isLong ? swingPoints.filter(p => p.type === 'low') : swingPoints.filter(p => p.type === 'high');
        const lastPivot = pivots[pivots.length - 1];
        if (lastPivot) {
            const isBetter = isLong ? lastPivot.price > position.stopLossPrice : lastPivot.price < position.stopLossPrice;
            const isSafe = isLong ? lastPivot.price < currentPrice : lastPivot.price > currentPrice;
            if (isBetter && isSafe) {
                return { newStopLoss: lastPivot.price, reasons: [`Structural: Snapped to pivot.`], activeStopLossReason: 'Agent Trail' };
            }
        }
        return { reasons: [] };
    }

    // --- STANDARD AGENT EXITS ---
    let newStopLoss: number | undefined;
    const params = config.agentParams as Required<AgentParams>;

    switch (agent.id) {
        case 9: // Quantum Scalper (PSAR)
            newStopLoss = getLast(PSAR.calculate({ high: highs, low: lows, step: params.qsc_psarStep, max: params.qsc_psarMax }));
            break;
        case 11: // Historic Expert (Slow EMA)
        case 13: // Chameleon (Slow EMA)
            const emaPeriod = agent.id === 11 ? params.he_slowEmaPeriod : params.ch_slowEmaPeriod;
            newStopLoss = getLast(EMA.calculate({ period: emaPeriod, values: closes }));
            break;
        case 14: // Sentinel (Supertrend)
            newStopLoss = getLast(Supertrend.calculate({ high: highs, low: lows, close: closes, period: params.sentinel_stPeriod, multiplier: params.sentinel_stMultiplier }));
            break;
        case 20: // Supertrend Flipper (Supertrend)
            newStopLoss = getLast(Supertrend.calculate({ high: highs, low: lows, close: closes, period: params.stf_atrPeriod!, multiplier: params.stf_atrMultiplier! }));
            break;
        default:
            break;
    }

    if (newStopLoss !== undefined && ((isLong && newStopLoss > position.stopLossPrice) || (!isLong && newStopLoss < position.stopLossPrice))) {
        return { newStopLoss, reasons: ['Agent Trail Update'], activeStopLossReason: 'Agent Trail' };
    }
    return { reasons: [] };
}

export function getAdaptiveTakeProfit(
    position: Position,
    klines: Kline[],
    currentPrice: number,
): { newTakeProfit?: number; newStopLoss?: number; reason?: string; newState?: Partial<Position>; activeStopLossReason?: Position['activeStopLossReason'] } {
    const { direction, entryPrice, takeProfitPrice, botConfigSnapshot, adaptiveTpTriggered } = position;
    if (!botConfigSnapshot?.isAdaptiveTpEnabled || adaptiveTpTriggered || klines.length < 30) return {};

    const isLong = direction === 'LONG';
    const totalDist = Math.abs(takeProfitPrice - entryPrice);
    if (totalDist === 0) return {};
    
    const currentProgress = Math.abs(currentPrice - entryPrice) / totalDist;
    if (currentProgress < 0.75) return {};

    const closes = klines.map(k => k.close);
    const rsiValues = RSI.calculate({ period: 14, values: closes });
    const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;

    const hasDivergence = detectRsiDivergence(klines, rsiValues, isLong ? 'LONG' : 'SHORT', 14);
    if (!stochRsi) return {};

    const isExhaustion = (isLong && stochRsi.k > 85 && stochRsi.k < stochRsi.d) || (!isLong && stochRsi.k < 15 && stochRsi.k > stochRsi.d);
    
    if (hasDivergence || isExhaustion) {
        return {
            newTakeProfit: isLong ? currentPrice * 1.0005 : currentPrice * 0.9995,
            reason: `Adaptive TP: Momentum fading near objective. Locking in.`,
            newState: { adaptiveTpTriggered: true }
        };
    }
    return {};
}

export function getTradeGuardianSignal(
    position: Position,
    klines: Kline[], 
    microKlines: Kline[] | undefined, 
    currentPrice: number,
    btcKlines?: Kline[]
): { action: 'hold' | 'close'; reason?: string } {
    const isLong = position.direction === 'LONG';
    const pnlPercent = ((isLong ? currentPrice - position.entryPrice : position.entryPrice - currentPrice) / position.entryPrice) * 100;
    
    // 1. BTC Tsunami Protection
    if (btcKlines) {
        const btc = analyzeBitcoinState(btcKlines);
        if (isLong && btc.state === 'CRASH') return { action: 'close', reason: 'Guardian: BTC Tsunami Exit (Flash Crash).' };
        if (!isLong && btc.state === 'PUMP') return { action: 'close', reason: 'Guardian: BTC Tsunami Exit (Flash Pump).' };
    }

    // 2. SCALP ELITE STAGNATION (V6.1)
    // Snipers must work instantly. If not in 0.25% profit in 4 candles, kill it.
    if (position.tradeType === 'scalp' && position.candlesSinceEntry >= 4 && pnlPercent < 0.25) {
        return { action: 'close', reason: 'Guardian: Sniper Stagnation Kill Switch.' };
    }

    // 3. RETRACE PROTECTION
    if (position.peakPrice && position.hasBeenProfitable) {
        const peakPnl = ((isLong ? position.peakPrice - position.entryPrice : position.entryPrice - position.peakPrice) / position.entryPrice) * 100;
        const currentPnl = ((isLong ? currentPrice - position.entryPrice : position.entryPrice - currentPrice) / position.entryPrice) * 100;
        
        // If we were up > 0.5% and now we've lost 60% of that peak profit, kill it.
        if (peakPnl > 0.5 && currentPnl < peakPnl * 0.4) {
             return { action: 'close', reason: `Guardian: Profit Retrace (60% of gains faded).` };
        }
    }
    
    // 4. CONVICTION STAGNATION
    // If a normal trade doesn't move into profit within 15 candles, the thesis is likely dead.
    if (position.candlesSinceEntry > 15 && !position.hasBeenProfitable) {
        return { action: 'close', reason: 'Guardian: Thesis stagnation (15 candle limit).' };
    }

    return { action: 'hold' };
}
