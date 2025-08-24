
import { TradingMode, type Agent, type TradeSignal, type Kline, type AgentParams, type Position, type ADXOutput, type MACDOutput, type BollingerBandsOutput, type StochasticRSIOutput, type TradeManagementSignal, type BotConfig, VortexIndicatorOutput, SentinelAnalysis, KSTOutput, type IchimokuCloudOutput } from '../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV, VWAP, IchimokuCloud, KST, abandonedbaby, bearishengulfingpattern, bullishengulfingpattern, darkcloudcover, downsidetasukigap, dragonflydoji, gravestonedoji, bullishharami, bearishharami, bullishharamicross, bearishharamicross, hammerpattern, hangingman, morningdojistar, morningstar, eveningdojistar, eveningstar, piercingline, shootingstar, threeblackcrows, threewhitesoldiers } from 'technicalindicators';
import * as constants from '../constants';
import { calculateSupportResistance } from './chartAnalysisService';

class Supertrend {
    static calculate(options: { high: number[]; low: number[]; close: number[]; period: number; multiplier: number; }): (number | undefined)[] {
        const { high, low, close, period, multiplier } = options;
        const atrValues = ATR.calculate({ high, low, close, period });

        const result: (number | undefined)[] = new Array(close.length).fill(undefined);
        if (atrValues.length === 0) return result;

        let trend = 1; // 1 for uptrend, -1 for downtrend
        let lastFinalUpperBand = 0;
        let lastFinalLowerBand = 0;

        for (let i = period; i < high.length; i++) {
            const currentAtr = atrValues[i - period];
            if (currentAtr === undefined) continue;

            const basicUpperBand = (high[i] + low[i]) / 2 + multiplier * currentAtr;
            const basicLowerBand = (high[i] + low[i]) / 2 - multiplier * currentAtr;
            
            if (i === period) {
                lastFinalUpperBand = basicUpperBand;
                lastFinalLowerBand = basicLowerBand;
            } else {
                lastFinalUpperBand = basicUpperBand < lastFinalUpperBand || close[i - 1] > lastFinalUpperBand ? basicUpperBand : lastFinalUpperBand;
                lastFinalLowerBand = basicLowerBand > lastFinalLowerBand || close[i - 1] < lastFinalLowerBand ? basicLowerBand : lastFinalLowerBand;
            }
            
            if (trend === 1 && close[i] < lastFinalLowerBand) {
                trend = -1;
            } else if (trend === -1 && close[i] > lastFinalUpperBand) {
                trend = 1;
            }

            result[i] = trend === 1 ? lastFinalLowerBand : lastFinalUpperBand;
        }
        return result;
    }
}

class VortexIndicator {
    static calculate(options: { high: number[]; low: number[]; close: number[]; period: number; }): VortexIndicatorOutput {
        const { high, low, close, period } = options;
        const length = high.length;
        if (length <= period) {
            return { pdi: [], ndi: [] };
        }

        const pdi: number[] = new Array(length).fill(NaN);
        const ndi: number[] = new Array(length).fill(NaN);

        const trArr = new Array(length).fill(NaN);
        const plusVmArr = new Array(length).fill(NaN);
        const minusVmArr = new Array(length).fill(NaN);

        for (let i = 1; i < length; i++) {
            trArr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
            plusVmArr[i] = Math.abs(high[i] - low[i - 1]);
            minusVmArr[i] = Math.abs(low[i] - high[i - 1]);
        }
        
        let sumTr = 0;
        let sumPlusVm = 0;
        let sumMinusVm = 0;
        for (let i = 1; i <= period; i++) {
            sumTr += trArr[i];
            sumPlusVm += plusVmArr[i];
            sumMinusVm += minusVmArr[i];
        }

        if (sumTr > 0) {
            pdi[period] = sumPlusVm / sumTr;
            ndi[period] = sumMinusVm / sumTr;
        } else {
            pdi[period] = 0;
            ndi[period] = 0;
        }

        for (let i = period + 1; i < length; i++) {
            sumTr = sumTr - trArr[i - period] + trArr[i];
            sumPlusVm = sumPlusVm - plusVmArr[i - period] + plusVmArr[i];
            sumMinusVm = sumMinusVm - minusVmArr[i - period] + minusVmArr[i];
            
            if (sumTr > 0) {
                pdi[i] = sumPlusVm / sumTr;
                ndi[i] = sumMinusVm / sumTr;
            } else {
                pdi[i] = 0;
                ndi[i] = 0;
            }
        }
        
        return { pdi, ndi };
    }
}


// --- HELPERS ---
const getLast = <T>(arr: T[] | undefined): T | undefined => arr && arr.length > 0 ? arr[arr.length - 1] : undefined;
const getPenultimate = <T>(arr: T[] | undefined): T | undefined => arr && arr.length > 1 ? arr[arr.length - 2] : undefined;

const MIN_STOP_LOSS_PERCENT = 0.5; // Minimum 0.5% SL distance from entry price.
const { TIMEFRAME_ATR_CONFIG, TAKER_FEE_RATE, MIN_PROFIT_BUFFER_MULTIPLIER } = constants;

const isObvTrending = (obvValues: number[], direction: 'bullish' | 'bearish', period: number = 5): boolean => {
    if (obvValues.length < period + 1) return false;
    const obvSma = SMA.calculate({ period, values: obvValues });
    const lastSma = getLast(obvSma);
    const prevSma = getPenultimate(obvSma);
    if (lastSma === undefined || prevSma === undefined) return false;
    return direction === 'bullish' ? lastSma > prevSma : lastSma < prevSma;
};

/**
 * Centralized function to apply timeframe-specific parameter overrides to a bot's configuration.
 * This ensures all agent logic (signal, SL/TP, management) uses the same, correct parameters.
 * @param config The original BotConfig.
 * @returns A new BotConfig instance with updated agentParams.
 */
function applyTimeframeSettings(config: BotConfig): BotConfig {
    const { agent, timeFrame, agentParams } = config;

    // Build parameters with correct precedence: Defaults -> Timeframe-Specific -> User Overrides
    let finalParams: Required<AgentParams> = { ...constants.DEFAULT_AGENT_PARAMS };
    
    // Agent-specific timeframe settings
    let timeframeSettings: Partial<AgentParams> = {};
    switch (agent.id) {
        case 7:  timeframeSettings = constants.MARKET_STRUCTURE_MAVEN_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 9:  timeframeSettings = constants.QUANTUM_SCALPER_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 11: timeframeSettings = constants.HISTORIC_EXPERT_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 13: timeframeSettings = constants.CHAMELEON_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 14: timeframeSettings = constants.SENTINEL_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 15: timeframeSettings = constants.INSTITUTIONAL_FLOW_TRACER_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 16: timeframeSettings = constants.ICHIMOKU_TREND_RIDER_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 17: timeframeSettings = constants.THE_DETONATOR_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 18: timeframeSettings = constants.CANDLESTICK_PROPHET_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
    }
    
    finalParams = { ...finalParams, ...timeframeSettings };

    // Apply user-specific overrides last
    finalParams = { ...finalParams, ...agentParams };
    
    // Return a new config object with the finalized params
    return { ...config, agentParams: finalParams };
}


// ----------------------------------------------------------------------------------
// --- #1: INITIAL TARGET CALCULATION (SL/TP) - THE CORE RISK FIX ---
// This is the single source of truth for setting initial trade targets.
// ----------------------------------------------------------------------------------
export const getInitialAgentTargets = (
    klines: Kline[],
    entryPrice: number,
    direction: 'LONG' | 'SHORT',
    originalConfig: BotConfig
): { stopLossPrice: number; takeProfitPrice: number; slReason: 'Agent Logic' | 'Hard Cap'; agentStopLoss: number; } => {
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
    const currentAtr = (getLast(atrValues) as number) || (entryPrice * 0.01);

    // Default Fallback SL
    const fallbackStop = () => {
        const timeframeConfig = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];
        const atrMultiplier = timeframeConfig.atrMultiplier;
        return isLong ? entryPrice - (currentAtr * atrMultiplier) : entryPrice + (currentAtr * atrMultiplier);
    }

    switch (agent.id) {
        case 7: // Market Structure Maven
        case 11: // Historic Expert
            const srLookback = agent.id === 7 ? params.msm_swingPointLookback : 10;
            const { supports, resistances } = calculateSupportResistance(klines, srLookback);
            if (isLong) {
                const protectiveSupports = supports.filter(s => s < entryPrice);
                if (protectiveSupports.length > 0) {
                    const relevantSupport = Math.max(...protectiveSupports); // Closest support below entry
                    agentStopLoss = relevantSupport - currentAtr * 0.25;
                } else {
                    agentStopLoss = fallbackStop();
                }
            } else { // SHORT
                const protectiveResistances = resistances.filter(r => r > entryPrice);
                if (protectiveResistances.length > 0) {
                    const relevantResistance = Math.min(...protectiveResistances); // Closest resistance above entry
                    agentStopLoss = relevantResistance + currentAtr * 0.25;
                } else {
                    agentStopLoss = fallbackStop();
                }
            }
            break;

        case 9: // Quantum Scalper: Context-aware SL (Trending vs. Ranging).
            const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.qsc_adxPeriod! }))! as ADXOutput;
            const isTrending = adx.adx > params.qsc_adxThreshold!;
            if (isTrending) { // Use PSAR for trending SL
                const psarInput = { high: highs, low: lows, step: params.qsc_psarStep, max: params.qsc_psarMax };
                const psar = getLast(PSAR.calculate(psarInput)) as number | undefined;
                // CRITICAL FIX: Ensure PSAR is on the correct, protective side of the entry price.
                if (psar && ((isLong && psar < entryPrice) || (!isLong && psar > entryPrice))) {
                    agentStopLoss = psar;
                } else {
                    agentStopLoss = fallbackStop(); // Use fallback if PSAR is invalid or undefined
                }
            } else { // Use BB for ranging/reversion SL
                const bb = getLast(BollingerBands.calculate({ period: params.qsc_bbPeriod!, stdDev: params.qsc_bbStdDev!, values: closes }))!;
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
            const st = getLast(Supertrend.calculate({ high: highs, low: lows, close: closes, period: 10, multiplier: 3 }));
            if (st) {
                agentStopLoss = st;
            } else {
                agentStopLoss = fallbackStop();
            }
            break;

        case 15: // Institutional Flow Tracer: SL is placed just beyond the low/high of the confirmation candle.
            const lastKline = klines[klines.length - 1];
            if (lastKline) {
                agentStopLoss = isLong ? lastKline.low - currentAtr * 0.2 : lastKline.high + currentAtr * 0.2;
            } else {
                agentStopLoss = fallbackStop();
            }
            break;
        
        case 17: // The Detonator: SL at recent swing high/low.
            const detSwingLookback = 10;
            const { supports: det_supports, resistances: det_resistances } = calculateSupportResistance(klines, detSwingLookback);
             if (isLong) {
                const protectiveSupports = det_supports.filter(s => s < entryPrice);
                if (protectiveSupports.length > 0) {
                    agentStopLoss = Math.max(...protectiveSupports) - currentAtr * 0.1; // Tighter buffer for breakout
                } else {
                    agentStopLoss = fallbackStop();
                }
            } else { // SHORT
                const protectiveResistances = det_resistances.filter(r => r > entryPrice);
                if (protectiveResistances.length > 0) {
                    agentStopLoss = Math.min(...protectiveResistances) + currentAtr * 0.1; // Tighter buffer for breakout
                } else {
                    agentStopLoss = fallbackStop();
                }
            }
            break;
        
        case 18: // Candlestick Prophet
            const { patternInfo } = findLastCandlestickPattern(klines, direction);
            if (patternInfo) {
                 const buffer = currentAtr * 0.1;
                 agentStopLoss = isLong ? patternInfo.low - buffer : patternInfo.high + buffer;
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


    // --- Step 3: Apply Hard Cap as the FINAL, non-negotiable limit ---
    let finalStopLoss = stopLossAfterInitialChecks;
    let slReason: 'Agent Logic' | 'Hard Cap' = 'Agent Logic';

    const maxLossInDollars = investmentAmount * (constants.MAX_MARGIN_LOSS_PERCENT / 100);
    const positionValue = mode === TradingMode.USDSM_Futures ? investmentAmount * leverage : investmentAmount;
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


    // --- Step 4: Calculate Take Profit based on the final, intelligent SL ---
    const timeframeConfig = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];
    let riskRewardRatio = timeframeConfig.riskRewardRatio;

    if (agent.id === 13) {
        riskRewardRatio = 4; // Use a high R:R to set a distant, failsafe TP for the flip-focused agent
    } else if (agent.id === 17) {
        riskRewardRatio = params.det_rr_mult;
    }
    
    const stopLossDistance = Math.abs(entryPrice - finalStopLoss);
    let suggestedTakeProfit = isLong ? entryPrice + (stopLossDistance * riskRewardRatio) : entryPrice - (stopLossDistance * riskRewardRatio);

    // --- S/R Based Take Profit Refinement ---
    const srTpLookback = params.msm_swingPointLookback || 15;
    const { supports: tp_supports, resistances: tp_resistances } = calculateSupportResistance(klines, srTpLookback);

    if (isLong && tp_resistances.length > 0) {
        const potentialTps = tp_resistances.filter(r => r > entryPrice);
        if (potentialTps.length > 0) {
            const potentialTp = Math.min(...potentialTps);
            const bufferedTp = potentialTp * 0.999;
            const newRewardDistance = Math.abs(bufferedTp - entryPrice);
            const newRrRatio = stopLossDistance > 0 ? newRewardDistance / stopLossDistance : Infinity;
            // Only adjust if the S/R target is closer (more realistic) but still meets the minimum R:R
            if (bufferedTp > entryPrice && bufferedTp < suggestedTakeProfit && newRrRatio >= constants.MIN_RISK_REWARD_RATIO) {
                suggestedTakeProfit = bufferedTp;
            }
        }
    } else if (!isLong && tp_supports.length > 0) {
        const potentialTps = tp_supports.filter(s => s < entryPrice);
        if (potentialTps.length > 0) {
            const potentialTp = Math.max(...potentialTps);
            const bufferedTp = potentialTp * 1.001;
            const newRewardDistance = Math.abs(bufferedTp - entryPrice);
            const newRrRatio = stopLossDistance > 0 ? newRewardDistance / stopLossDistance : Infinity;
            // Only adjust if the S/R target is closer (more realistic) but still meets the minimum R:R
            if (bufferedTp < entryPrice && bufferedTp > suggestedTakeProfit && newRrRatio >= constants.MIN_RISK_REWARD_RATIO) {
                suggestedTakeProfit = bufferedTp;
            }
        }
    }


    // --- Step 5: CRITICAL FINAL SAFETY CHECKS ---
    let finalTakeProfit = suggestedTakeProfit;

    if (positionSize > 0) {
        const roundTripFee = positionValue * TAKER_FEE_RATE * 2;
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
        finalTakeProfit = isLong ? entryPrice + (finalSlDistance * riskRewardRatio) : entryPrice - (finalSlDistance * riskRewardRatio);
    }

    return {
        stopLossPrice: finalStopLoss,
        takeProfitPrice: finalTakeProfit,
        slReason,
        agentStopLoss: agentStopLoss // Return original agent SL for transparency
    };
};

// ----------------------------------------------------------------------------------
// --- #2: TRADE MANAGEMENT (Trailing Stops, etc.) ---
// ----------------------------------------------------------------------------------

/**
 * A multi-stage, fee-multiple-based profit-locking mechanism.
 * 1. Moves SL to fee-adjusted breakeven once profit reaches 2x the fee cost.
 * 2. Moves SL to lock in profits at N-1 fee-multiple milestones thereafter.
 * Called on every price tick.
 * @param position - The current open position.
 * @param currentPrice - The live price tick.
 * @returns A TradeManagementSignal with a potential new stop loss.
 */
export function getMultiStageProfitSecureSignal(
    position: Position,
    currentPrice: number
): TradeManagementSignal {
    const { entryPrice, stopLossPrice, direction, isBreakevenSet, profitLockTier, size } = position;
    const isLong = direction === 'LONG';
    const reasons: string[] = [];

    const positionValue = entryPrice * size;
    const roundTripFee = positionValue * TAKER_FEE_RATE * 2;
    const feeInPrice = roundTripFee > 0 ? (roundTripFee / size) : 0;
    if (feeInPrice <= 0) return { reasons };

    const currentGrossProfitInPrice = (currentPrice - entryPrice) * (isLong ? 1 : -1);
    if (currentGrossProfitInPrice <= 0) return { reasons }; // Not in profit

    const currentFeeMultiple = currentGrossProfitInPrice / feeInPrice;

    // Trigger 1: Move to Breakeven at 2x fee profit
    if (!isBreakevenSet) {
        if (currentFeeMultiple >= 2) {
            const breakevenStop = entryPrice + (feeInPrice * (isLong ? 1 : -1)); // Covers round-trip fee
            if ((isLong && breakevenStop > stopLossPrice) || (!isLong && breakevenStop < stopLossPrice)) {
                return {
                    newStopLoss: breakevenStop,
                    reasons: [`Profit Secure: Breakeven set at 2x fee gain.`],
                    newState: { isBreakevenSet: true, profitLockTier: 2 }
                };
            }
        } else {
            return { reasons };
        }
    }

    // Trigger 2: Dynamic (N)x -> (N-1)x profit lock for N >= 3
    if (currentFeeMultiple >= 3) {
        const triggerFeeMultiple = Math.floor(currentFeeMultiple); // This is our 'N'
        
        if (triggerFeeMultiple > profitLockTier) {
            const lockFeeMultiple = triggerFeeMultiple - 1; // This is 'N-1'
            const newStopLoss = entryPrice + (feeInPrice * lockFeeMultiple * (isLong ? 1 : -1));

            if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
                const reason = `Profit Secure: Tier ${lockFeeMultiple} activated at ${triggerFeeMultiple}x fee gain.`;
                return {
                    newStopLoss,
                    reasons: [reason],
                    newState: { profitLockTier: triggerFeeMultiple, isBreakevenSet: true }
                };
            }
        }
    }

    return { reasons };
}



/**
 * Calculates a potential new Stop Loss based on agent-specific, indicator-based logic (e.g., PSAR).
 * This is a heavier function designed to be called only on candle closes.
 * @param position - The current open position.
 * @param klines - The historical klines needed for indicator calculation.
 * @param currentPrice - The price at the time of the candle close.
 * @param originalConfig - The bot's configuration.
 * @returns A TradeManagementSignal.
 */
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

    switch (agent.id) {
        case 7: // Market Structure Maven
        case 18: // Candlestick Prophet (uses S/R for trailing)
            const srLookback = params.msm_swingPointLookback;
            const { supports, resistances } = calculateSupportResistance(klines, srLookback);
            let trailStopCandidateSR: number | undefined;
            if (isLong) {
                const protectiveSupports = supports.filter(s => s < currentPrice);
                if (protectiveSupports.length > 0) {
                    trailStopCandidateSR = Math.max(...protectiveSupports); // Closest support below current price
                }
            } else { // SHORT
                const protectiveResistances = resistances.filter(r => r > currentPrice);
                if (protectiveResistances.length > 0) {
                    trailStopCandidateSR = Math.min(...protectiveResistances); // Closest resistance above current price
                }
            }
            if (trailStopCandidateSR &&
                ((isLong && trailStopCandidateSR > position.stopLossPrice) || (!isLong && trailStopCandidateSR < position.stopLossPrice))
            ) {
                newStopLoss = trailStopCandidateSR;
                reasons.push('Agent S/R Trail');
            }
            break;

        case 9: // Quantum Scalper: PSAR-based trailing stop
        case 17: // The Detonator: Also uses aggressive PSAR trailing for breakouts
            const step = agent.id === 9 ? params.qsc_psarStep : params.scalp_psarStep;
            const max = agent.id === 9 ? params.qsc_psarMax : params.scalp_psarMax;
            const psarInput = { high: klines.map(k => k.high), low: klines.map(k => k.low), step, max };
            if (psarInput.high.length >= 2) {
                const psar = PSAR.calculate(psarInput);
                const lastPsar = getLast(psar) as number | undefined;
                if (lastPsar) {
                    // CRITICAL FIX: Ensure the new SL is on the correct side of the current price.
                    // For a LONG, the new SL must be higher than the old one, but still BELOW the current price.
                    if (isLong && lastPsar > position.stopLossPrice && lastPsar < currentPrice) {
                        newStopLoss = lastPsar;
                        reasons.push('Agent PSAR Trail');
                    }
                    // For a SHORT, the new SL must be lower than the old one, but still ABOVE the current price.
                    else if (!isLong && lastPsar < position.stopLossPrice && lastPsar > currentPrice) {
                        newStopLoss = lastPsar;
                        reasons.push('Agent PSAR Trail');
                    }
                }
            }
            break;

        case 11: // Historic Expert
        case 13: // The Chameleon
            const slowEmaPeriod = agent.id === 11 ? params.he_slowEmaPeriod : params.ch_slowEmaPeriod!;
            const slowEma = getLast(EMA.calculate({ period: slowEmaPeriod, values: closes }));
            if (slowEma &&
                ((isLong && slowEma > position.stopLossPrice && slowEma < currentPrice) ||
                 (!isLong && slowEma < position.stopLossPrice && slowEma > currentPrice))
            ) {
                newStopLoss = slowEma;
                reasons.push('Agent EMA Trail');
            }
            break;

        case 14: // The Sentinel
            const st = getLast(Supertrend.calculate({ high: highs, low: lows, close: closes, period: 10, multiplier: 3 }));
            if (st &&
                ((isLong && st > position.stopLossPrice && st < currentPrice) ||
                 (!isLong && st < position.stopLossPrice && st > currentPrice))
            ) {
                newStopLoss = st;
                reasons.push('Agent Supertrend Trail');
            }
            break;

        case 15: // Institutional Flow Tracer
            const vwap = getLast(VWAP.calculate({ high: highs, low: lows, close: closes, volume: klines.map(k => k.volume || 0) }));
             if (vwap &&
                ((isLong && vwap > position.stopLossPrice && vwap < currentPrice) ||
                 (!isLong && vwap < position.stopLossPrice && vwap > currentPrice))
            ) {
                newStopLoss = vwap;
                reasons.push('Agent VWAP Trail');
            }
            break;

        case 16: // Ichimoku Trend Rider
            const ichi_params = {
                high: klines.map(k => k.high), low: klines.map(k => k.low),
                conversionPeriod: params.ichi_conversionPeriod,
                basePeriod: params.ichi_basePeriod,
                spanPeriod: params.ichi_laggingSpanPeriod,
                displacement: params.ichi_displacement
            };
            const ichiValues = IchimokuCloud.calculate(ichi_params) as IchimokuCloudOutput[];
            const lastIchi = getLast(ichiValues);
            if(lastIchi) {
                // For a long trade, trail with the top of the cloud (Senkou Span A). For short, use bottom (Senkou Span B)
                const trailStopCandidate = isLong ? lastIchi.spanA : lastIchi.spanB;
                if(trailStopCandidate) {
                    // Ratchet check: is the new SL tighter and still safe?
                    if ((isLong && trailStopCandidate > position.stopLossPrice && trailStopCandidate < currentPrice) ||
                        (!isLong && trailStopCandidate < position.stopLossPrice && trailStopCandidate > currentPrice)) {
                        newStopLoss = trailStopCandidate;
                        reasons.push('Agent Ichimoku Cloud Trail');
                    }
                }
            }
            break;

        default:
            break;
    }

    return { newStopLoss, action, reasons };
}



// ----------------------------------------------------------------------------------
// --- #3: AGENT-SPECIFIC ENTRY SIGNAL LOGIC ---
// ----------------------------------------------------------------------------------

function recognizeCandlestickPattern(kline: Kline, prevKline?: Kline): { name: string, type: 'bullish' | 'bearish' } | null {
    if (!kline) return null;
    const { open, high, low, close } = kline;
    const bodySize = Math.abs(close - open);
    const upperWick = high - Math.max(open, close);
    const lowerWick = Math.min(open, close) - low;
    const totalRange = high - low;

    if (totalRange === 0) return null;

    // Hammer & Shooting Star
    if (bodySize / totalRange < 0.33) { // Small body
        if (lowerWick > bodySize * 2 && upperWick < bodySize) {
            return { name: 'Hammer', type: 'bullish' };
        }
        if (upperWick > bodySize * 2 && lowerWick < bodySize) {
            return { name: 'Shooting Star', type: 'bearish' };
        }
    }
    
    // Engulfing Patterns
    if (prevKline) {
        const prevBodySize = Math.abs(prevKline.close - prevKline.open);
        if (bodySize > prevBodySize) { // Current body must be larger
             // Bullish Engulfing
            if (close > open && prevKline.close < prevKline.open && // Current is green, previous is red
                close > prevKline.open && open < prevKline.close) { // Engulfs previous body
                return { name: 'Bullish Engulfing', type: 'bullish' };
            }
            // Bearish Engulfing
            if (close < open && prevKline.close > prevKline.open && // Current is red, previous is green
                open > prevKline.close && close < prevKline.open) { // Engulfs previous body
                return { name: 'Bearish Engulfing', type: 'bearish' };
            }
        }
    }

    return null;
}

// --- Agent 7: Market Structure Maven (Upgraded with Vortex Indicator Confirmation) ---
const getMarketStructureMavenSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.msm_htfEmaPeriod, params.atrPeriod, params.viPeriod, params.obvPeriod, 20);
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };

    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    const lastKline = klines[klines.length - 1];
    const prevKline = klines[klines.length - 2];
    const reasons: string[] = [];

    const emaBias = getLast(EMA.calculate({ period: params.msm_htfEmaPeriod, values: closes }))! as number;
    const isBullishBias = currentPrice > emaBias;
    reasons.push(isBullishBias ? `✅ Trend Bias: Bullish` : `✅ Trend Bias: Bearish`);
    
    const vi = VortexIndicator.calculate({ high: klines.map(k=>k.high), low: klines.map(k=>k.low), close: closes, period: params.viPeriod }) as VortexIndicatorOutput;
    const last_vi_plus = getLast(vi.pdi)!;
    const last_vi_minus = getLast(vi.ndi)!;
    const isViBullish = last_vi_plus > last_vi_minus;
    const isViBearish = last_vi_minus > last_vi_plus;

    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');

    const { supports, resistances } = calculateSupportResistance(klines, params.msm_swingPointLookback);
    const atr = getLast(ATR.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes, period: params.atrPeriod }))! as number;
    const proximityZone = atr * 0.5;
    const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes }))! as number;
    const lastVolume = getLast(volumes)!;

    if (isBullishBias && supports.length > 0) {
        const closestSupport = supports.find(s => s < currentPrice) || supports[0];
        if (Math.abs(currentPrice - closestSupport) <= proximityZone) {
            reasons.push(`✅ Price in support zone`);
            reasons.push(isViBullish ? `✅ VI Momentum: Bullish` : `❌ VI Momentum: Not Bullish`);
            reasons.push(isObvBullish ? `✅ OBV Confirmation: Bullish` : `❌ OBV Confirmation: Not Bullish`);
            if (params.isCandleConfirmationEnabled) {
                const pattern = recognizeCandlestickPattern(lastKline, prevKline);
                const hasConfirmationCandle = pattern?.type === 'bullish';
                const hasConfirmationVolume = lastVolume > volumeSma;
                reasons.push(hasConfirmationCandle ? `✅ Confirmed by ${pattern.name}` : `❌ Awaiting bullish candle`);
                reasons.push(hasConfirmationVolume ? `✅ Confirmation volume is strong` : `❌ Awaiting strong volume`);
                if (isViBullish && hasConfirmationCandle && hasConfirmationVolume && isObvBullish) return { signal: 'BUY', reasons };
            } else {
                const isLowVolume = lastVolume < volumeSma;
                reasons.push(isLowVolume ? `✅ Low volume pullback detected` : `❌ Awaiting low volume pullback`);
                if (isViBullish && isLowVolume && isObvBullish) return { signal: 'BUY', reasons };
            }
        }
    }

    if (!isBullishBias && resistances.length > 0) {
        const closestResistance = resistances.find(r => r > currentPrice) || resistances[0];
        if (Math.abs(currentPrice - closestResistance) <= proximityZone) {
            reasons.push(`✅ Price in resistance zone`);
            reasons.push(isViBearish ? `✅ VI Momentum: Bearish` : `❌ VI Momentum: Not Bearish`);
            reasons.push(isObvBearish ? `✅ OBV Confirmation: Bearish` : `❌ OBV Confirmation: Not Bearish`);
             if (params.isCandleConfirmationEnabled) {
                const pattern = recognizeCandlestickPattern(lastKline, prevKline);
                const hasConfirmationCandle = pattern?.type === 'bearish';
                const hasConfirmationVolume = lastVolume > volumeSma;
                reasons.push(hasConfirmationCandle ? `✅ Confirmed by ${pattern.name}` : `❌ Awaiting bearish candle`);
                reasons.push(hasConfirmationVolume ? `✅ Confirmation volume is strong` : `❌ Awaiting strong volume`);
                if (isViBearish && hasConfirmationCandle && hasConfirmationVolume && isObvBearish) return { signal: 'SELL', reasons };
            } else {
                const isLowVolume = lastVolume < volumeSma;
                reasons.push(isLowVolume ? `✅ Low volume pullback detected` : `❌ Awaiting low volume pullback`);
                if (isViBearish && isLowVolume && isObvBearish) return { signal: 'SELL', reasons };
            }
        }
    }

    return { signal: 'HOLD', reasons };
};

// --- Agent 9: Quantum Scalper (Upgraded with Volatility Filter, Ichimoku Gatekeeper, and Safer Reversals) ---
const getQuantumScalperSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.qsc_ichi_basePeriod + params.qsc_ichi_displacement, 50);
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data (${klines.length}/${minKlines})`] };
    
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);
    const lastKline = klines[klines.length - 1];
    const currentPrice = lastKline.close;
    const reasons: string[] = [];
    
    // --- 1. Volatility Filter (Master Switch) ---
    const bbForWidth = BollingerBands.calculate({ period: params.qsc_bbPeriod, stdDev: params.qsc_bbStdDev, values: closes });
    const lastBbForWidth = getLast(bbForWidth)!;
    const bbWidth = (lastBbForWidth.upper - lastBbForWidth.lower) / lastBbForWidth.middle;
    if (bbWidth < params.qsc_bbwSqueezeThreshold) {
        return { signal: 'HOLD', reasons: [`ℹ️ Standby: Low volatility squeeze detected (BBW: ${bbWidth.toFixed(4)})`] };
    }
    
    // --- 2. Regime Filter ---
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.qsc_adxPeriod }))! as ADXOutput;
    const isTrending = adx.adx > params.qsc_adxThreshold;
    reasons.push(isTrending ? `ℹ️ Regime: Trending (ADX ${adx.adx.toFixed(1)})` : `ℹ️ Regime: Ranging (ADX ${adx.adx.toFixed(1)})`);
    
    // Common Indicators
    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');

    if (isTrending) {
        // --- Trend Logic with Ichimoku Gatekeeper ---
        const ichi_params = {
            high: highs, low: lows,
            conversionPeriod: params.qsc_ichi_conversionPeriod, basePeriod: params.qsc_ichi_basePeriod,
            spanPeriod: params.qsc_ichi_laggingSpanPeriod, displacement: params.qsc_ichi_displacement
        };
        const ichi = getLast(IchimokuCloud.calculate(ichi_params)) as IchimokuCloudOutput | undefined;
        const isPriceAboveKumo = ichi && ichi.spanA && ichi.spanB && currentPrice > ichi.spanA && currentPrice > ichi.spanB;
        const isPriceBelowKumo = ichi && ichi.spanA && ichi.spanB && currentPrice < ichi.spanA && currentPrice < ichi.spanB;
        
        if (isPriceAboveKumo) { // Bullish Trend Gate
            reasons.push('✅ Ichimoku: Bullish Trend Confirmed');
            let bullishScore = 0;
            const stValues = Supertrend.calculate({ high: highs, low: lows, close: closes, period: params.qsc_superTrendPeriod, multiplier: params.qsc_superTrendMultiplier });
            const lastStValue = getLast(stValues);
            const isStBullish = lastStValue !== undefined && currentPrice > lastStValue;
            if(isStBullish) bullishScore++;
            reasons.push(isStBullish ? '✅ Supertrend: Bullish' : '❌ Supertrend: Not Bullish');

            const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod }) as VortexIndicatorOutput;
            const isViBullish = getLast(vi.pdi)! > getLast(vi.ndi)!;
            if(isViBullish) bullishScore++;
            reasons.push(isViBullish ? '✅ VI: Bullish Momentum' : '❌ VI: Lacks Bullish Momentum');
            
            if(isObvBullish) bullishScore++;
            reasons.push(isObvBullish ? '✅ OBV: Bullish Flow' : '❌ OBV: Lacks Bullish Flow');

            if (bullishScore >= params.qsc_trendScoreThreshold) return { signal: 'BUY', reasons };

        } else if (isPriceBelowKumo) { // Bearish Trend Gate
             reasons.push('✅ Ichimoku: Bearish Trend Confirmed');
            let bearishScore = 0;
            const stValues = Supertrend.calculate({ high: highs, low: lows, close: closes, period: params.qsc_superTrendPeriod, multiplier: params.qsc_superTrendMultiplier });
            const lastStValue = getLast(stValues);
            const isStBearish = lastStValue !== undefined && currentPrice < lastStValue;
            if(isStBearish) bearishScore++;
            reasons.push(isStBearish ? '✅ Supertrend: Bearish' : '❌ Supertrend: Not Bearish');
            
            const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod }) as VortexIndicatorOutput;
            const isViBearish = getLast(vi.ndi)! > getLast(vi.pdi)!;
            if(isViBearish) bearishScore++;
            reasons.push(isViBearish ? '✅ VI: Bearish Momentum' : '❌ VI: Lacks Bearish Momentum');

            if(isObvBearish) bearishScore++;
            reasons.push(isObvBearish ? '✅ OBV: Bearish Flow' : '❌ OBV: Lacks Bearish Flow');

            if (bearishScore >= params.qsc_trendScoreThreshold) return { signal: 'SELL', reasons };
        } else {
             reasons.push('❌ Ichimoku: Price is inside Kumo (No Clear Trend)');
        }

    } else { // --- Ranging Logic with Safer Reversals ---
        let bullishScore = 0;
        let bearishScore = 0;
        const bb = getLast(bbForWidth)!;
        const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: params.qsc_stochRsiPeriod, stochasticPeriod: params.qsc_stochRsiPeriod, kPeriod: 3, dPeriod: 3 }))!;

        // Bullish Reversal
        const isPriceOversold = lastKline.low < bb.lower && lastKline.close > bb.lower;
        const isStochOversold = stochRsi.stochRSI < params.qsc_stochRsiOversold;
        if (isPriceOversold) bullishScore++;
        if (isStochOversold) bullishScore++;
        if (isObvBullish) bullishScore++;
        reasons.push(isPriceOversold ? `✅ Price: Rejected Lower BB` : `❌ Price: No Lower BB Rejection`);
        reasons.push(isStochOversold ? `✅ StochRSI: Oversold` : `❌ StochRSI: Not Oversold`);
        reasons.push(isObvBullish ? `✅ OBV: Bullish Pressure` : `❌ OBV: Lacks Bullish Pressure`);
        if (bullishScore >= params.qsc_rangeScoreThreshold) return { signal: 'BUY', reasons };

        // Bearish Reversal
        const isPriceOverbought = lastKline.high > bb.upper && lastKline.close < bb.upper;
        const isStochOverbought = stochRsi.stochRSI > params.qsc_stochRsiOverbought;
        if (isPriceOverbought) bearishScore++;
        if (isStochOverbought) bearishScore++;
        if (isObvBearish) bearishScore++;
        reasons.push(isPriceOverbought ? `✅ Price: Rejected Upper BB` : `❌ Price: No Upper BB Rejection`);
        reasons.push(isStochOverbought ? `✅ StochRSI: Overbought` : `❌ StochRSI: Not Overbought`);
        reasons.push(isObvBearish ? `✅ OBV: Bearish Pressure` : `❌ OBV: Lacks Bearish Pressure`);
        if (bearishScore >= params.qsc_rangeScoreThreshold) return { signal: 'SELL', reasons };
    }

    return { signal: 'HOLD', reasons };
};

// --- Agent 11: Historic Expert (REFACTORED to Pullback Strategy) ---
const getHistoricExpertSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.he_trendSmaPeriod, params.he_fastEmaPeriod, params.he_rsiPeriod, params.adxPeriod, params.obvPeriod);
    if (klines.length < minKlines + 1) {
        return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    const lastKline = klines[klines.length - 1];
    const prevKline = klines[klines.length - 2];
    const reasons: string[] = [];

    const trendSma = getLast(SMA.calculate({ period: params.he_trendSmaPeriod, values: closes }))!;
    const isBullishTrend = currentPrice > trendSma;
    const isBearishTrend = currentPrice < trendSma;
    reasons.push(isBullishTrend ? `✅ Trend: Bullish (Price > ${params.he_trendSmaPeriod}-SMA)` : `✅ Trend: Bearish (Price < ${params.he_trendSmaPeriod}-SMA)`);

    const pullbackEma = getLast(EMA.calculate({ period: params.he_fastEmaPeriod, values: closes }))!;
    const bullishPullback = isBullishTrend && lastKline.low <= pullbackEma && lastKline.close > pullbackEma;
    const bearishPullback = isBearishTrend && lastKline.high >= pullbackEma && lastKline.close < pullbackEma;
    reasons.push(bullishPullback ? '✅ Entry: Bullish pullback to EMA' : bearishPullback ? '✅ Entry: Bearish pullback to EMA' : '❌ Entry: No pullback to EMA');

    const rsi = getLast(RSI.calculate({ period: params.he_rsiPeriod, values: closes }))!;
    const rsiIsBullish = rsi > params.he_rsiMidline;
    const rsiIsBearish = rsi < params.he_rsiMidline;
    
    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');

    if (bullishPullback) {
        reasons.push(rsiIsBullish ? `✅ RSI > ${params.he_rsiMidline}` : `❌ RSI not bullish`);
        reasons.push(isObvBullish ? `✅ OBV Confirmed` : `❌ OBV not bullish`);
        if (rsiIsBullish && isObvBullish) return { signal: 'BUY', reasons };
    }

    if (bearishPullback) {
        reasons.push(rsiIsBearish ? `✅ RSI < ${params.he_rsiMidline}` : `❌ RSI not bearish`);
        reasons.push(isObvBearish ? `✅ OBV Confirmed` : `❌ OBV not bearish`);
        if (isObvBearish && isObvBearish) return { signal: 'SELL', reasons };
    }
    
    return { signal: 'HOLD', reasons };
};

// --- Agent 13: The Chameleon (V6 - KST Momentum Flip Strategy with Zero-Line Confirmation) ---
const getChameleonSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(
        params.ch_trendEmaPeriod!,
        params.ch_kst_rocPer4! + params.ch_kst_smaRocPer4!,
        params.adxPeriod
    ) + 5;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data for analysis.'] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];

    // 1. Trend Filter
    const trendEma = getLast(EMA.calculate({ period: params.ch_trendEmaPeriod!, values: closes }))!;
    const isMacroBullish = currentPrice > trendEma;
    const isMacroBearish = currentPrice < trendEma;
    
    // 2. Regime Filter
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.adxPeriod }))! as ADXOutput;
    const isTrending = adx.adx > params.ch_adxThreshold!;

    // 3. Primary Signal: KST with Zero-Line Confirmation
    const kstInput = {
        values: closes,
        ROCPer1: params.ch_kst_rocPer1!, ROCPer2: params.ch_kst_rocPer2!, ROCPer3: params.ch_kst_rocPer3!, ROCPer4: params.ch_kst_rocPer4!,
        SMAROCPer1: params.ch_kst_smaRocPer1!, SMAROCPer2: params.ch_kst_smaRocPer2!, SMAROCPer3: params.ch_kst_smaRocPer3!, SMAROCPer4: params.ch_kst_smaRocPer4!,
        signalPeriod: params.ch_kst_signalPeriod!,
    };
    const kstValues = KST.calculate(kstInput) as KSTOutput[];
    const lastKst = getLast(kstValues)!;
    const prevKst = getPenultimate(kstValues)!;
    const kstBullishCross = prevKst.kst < prevKst.signal && lastKst.kst > lastKst.signal;
    const kstBearishCross = prevKst.kst > prevKst.signal && lastKst.kst < lastKst.signal;
    const isKstBullishBias = lastKst.kst > 0;
    const isKstBearishBias = lastKst.kst < 0;

    // 4. Entry Trigger: Fast EMA Cross (Removed as KST cross is sufficient)
    
    // 5. Volume Confirmation
    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');

    // --- Bullish Logic ---
    reasons.push(isMacroBullish ? `✅ Trend: Bullish (Price > ${params.ch_trendEmaPeriod}-EMA)` : `❌ Trend: Not Bullish`);
    reasons.push(isTrending ? `✅ Regime: Trending (ADX ${adx.adx.toFixed(1)})` : `❌ Regime: Not Trending`);
    reasons.push(kstBullishCross ? `✅ KST: Bullish Cross` : `❌ KST: No Bullish Cross`);
    reasons.push(isKstBullishBias ? `✅ KST > 0 (Bullish Bias)` : `❌ KST: Not in Bullish Territory`);
    reasons.push(isObvBullish ? `✅ Volume: Bullish Flow` : `❌ Volume: Not Bullish`);

    if (isMacroBullish && isTrending && kstBullishCross && isKstBullishBias && isObvBullish) {
        return { signal: 'BUY', reasons };
    }

    // --- Bearish Logic ---
    reasons.push(isMacroBearish ? `✅ Trend: Bearish (Price < ${params.ch_trendEmaPeriod}-EMA)` : `❌ Trend: Not Bearish`);
    reasons.push(kstBearishCross ? `✅ KST: Bearish Cross` : `❌ KST: No Bearish Cross`);
    reasons.push(isKstBearishBias ? `✅ KST < 0 (Bearish Bias)` : `❌ KST: Not in Bearish Territory`);
    reasons.push(isObvBearish ? `✅ Volume: Bearish Flow` : `❌ Volume: Not Bearish`);
    
    if (isMacroBearish && isTrending && kstBearishCross && isKstBearishBias && isObvBearish) {
        return { signal: 'SELL', reasons };
    }

    reasons.push(`ℹ️ No valid KST signal detected.`);
    return { signal: 'HOLD', reasons };
};


// --- Agent 14: The Sentinel (Upgraded with OBV and re-weighted confirmation) ---
const getTheSentinelSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = 200;
    if (klines.length < minKlines) {
        const reasons = [`ℹ️ Insufficient data for The Sentinel (${klines.length}/${minKlines} candles).`];
        return { signal: 'HOLD', reasons };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    
    const ema50 = getLast(EMA.calculate({ period: 50, values: closes }))!;
    const ema200 = getLast(EMA.calculate({ period: 200, values: closes }))!;
    const macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }))!;
    const prevMacd = getPenultimate(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }))!;
    const rsi = getLast(RSI.calculate({ values: closes, period: 14 }))!;
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: 14 }))!;
    const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod }) as VortexIndicatorOutput;
    const last_vi_plus = getLast(vi.pdi)!;
    const last_vi_minus = getLast(vi.ndi)!;
    const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes }))!;
    const lastVolume = getLast(volumes)!;
    const obv = OBV.calculate({ close: closes, volume: volumes });

    let bullTrend = 0, bearTrend = 0;
    let bullMomentum = 0, bearMomentum = 0;
    let bullConfirm = 0, bearConfirm = 0;
    const trendMax = 35, momentumMax = 40, confirmMax = 25;

    if (last_vi_plus > last_vi_minus) bullTrend += 5; else bearTrend += 5;
    if (currentPrice > ema200) bullTrend += 25; else bearTrend += 25;
    if (ema50 > ema200) bullTrend += 5; else bearTrend += 5;
    if (adx.adx > 25) { if(adx.pdi > adx.mdi) bullTrend += 5; else bearTrend += 5; }

    if (macd.histogram! > 0 && macd.histogram! > (prevMacd.histogram || 0)) bullMomentum += 15;
    else if (macd.histogram! < 0 && macd.histogram! < (prevMacd.histogram || 0)) bearMomentum += 15;
    if (rsi > 55) bullMomentum += 15;
    else if (rsi < 45) bearMomentum += 15;
    if (isObvTrending(obv, 'bullish')) bullMomentum += 10;
    else if (isObvTrending(obv, 'bearish')) bearMomentum += 10;

    if (lastVolume > volumeSma) {
        if (bullTrend > bearTrend) bullConfirm += 25;
        if (bearTrend > bullTrend) bearConfirm += 25;
    }
    
    const finalBullishScore = bullTrend + bullMomentum + bullConfirm;
    const finalBearishScore = bearTrend + bearMomentum + bullConfirm;

    const sentinelAnalysis: SentinelAnalysis = {
        bullish: {
            total: finalBullishScore,
            trend: (bullTrend / trendMax) * 100,
            momentum: (bullMomentum / momentumMax) * 100,
            confirmation: (bullConfirm / confirmMax) * 100
        },
        bearish: {
            total: finalBearishScore,
            trend: (bearTrend / trendMax) * 100,
            momentum: (bearMomentum / momentumMax) * 100,
            confirmation: (bearConfirm / confirmMax) * 100
        }
    };

    const reasons: string[] = [];
    const threshold = params.sentinel_scoreThreshold!;

    if (finalBullishScore >= threshold && finalBullishScore > finalBearishScore) {
        reasons.push(`✅ Bullish score exceeds threshold of ${threshold}%.`);
        return { signal: 'BUY', reasons, sentinelAnalysis };
    }
    
    if (finalBearishScore >= threshold && finalBearishScore > finalBearishScore) {
        reasons.push(`✅ Bearish score exceeds threshold of ${threshold}%.`);
        return { signal: 'SELL', reasons, sentinelAnalysis };
    }

    reasons.push(`❌ Neither score has met the ${threshold}% threshold.`);
    return { signal: 'HOLD', reasons, sentinelAnalysis };
};

// --- Agent 15: Institutional Flow Tracer (Upgraded with OBV Confirmation) ---
const getInstitutionalFlowTracerSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.vwap_emaTrendPeriod, params.rsiPeriod, params.obvPeriod);
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data (${klines.length}/${minKlines}).`] };

    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    const lastKline = klines[klines.length - 1];
    const prevKline = klines[klines.length - 2];
    const reasons: string[] = [];

    const vwap = getLast(VWAP.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes, volume: volumes }));
    if (!vwap) return { signal: 'HOLD', reasons: ['ℹ️ Could not calculate VWAP.'] };

    const emaTrend = getLast(EMA.calculate({ period: params.vwap_emaTrendPeriod, values: closes }))!;
    const isUptrend = currentPrice > emaTrend;
    reasons.push(isUptrend ? '✅ Trend: Bullish (Price > EMA)' : '✅ Trend: Bearish (Price < EMA)');

    const isNearVwap = Math.abs(currentPrice - vwap) / vwap < (params.vwap_proximityPercent / 100);
    const pattern = recognizeCandlestickPattern(lastKline, prevKline);
    const rsi = getLast(RSI.calculate({ period: params.rsiPeriod, values: closes }))!;
    const isMomentumBullish = rsi > 50;
    const isMomentumBearish = rsi < 50;

    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');

    if (isUptrend) {
        reasons.push(isNearVwap ? '✅ Price near VWAP' : '❌ Price not near VWAP');
        reasons.push(pattern?.type === 'bullish' ? `✅ Confirmed by ${pattern.name}` : '❌ Awaiting bullish candle at VWAP');
        reasons.push(isMomentumBullish ? `✅ RSI Momentum: Bullish (>50)` : `❌ RSI Momentum: Not Bullish`);
        reasons.push(isObvBullish ? `✅ OBV Flow: Bullish` : `❌ OBV Flow: Not Bullish`);
        if (isNearVwap && pattern?.type === 'bullish' && isMomentumBullish && isObvBullish) {
            return { signal: 'BUY', reasons };
        }
    }

    if (!isUptrend) {
        reasons.push(isNearVwap ? '✅ Price near VWAP' : '❌ Price not near VWAP');
        reasons.push(pattern?.type === 'bearish' ? `✅ Confirmed by ${pattern.name}` : '❌ Awaiting bearish candle at VWAP');
        reasons.push(isMomentumBearish ? `✅ RSI Momentum: Bearish (<50)` : `❌ RSI Momentum: Not Bearish`);
        reasons.push(isObvBearish ? `✅ OBV Flow: Bearish` : `❌ OBV Flow: Not Bearish`);
        if (isNearVwap && pattern?.type === 'bearish' && isMomentumBearish && isObvBearish) {
            return { signal: 'SELL', reasons };
        }
    }

    return { signal: 'HOLD', reasons };
};

// --- Agent 16: Ichimoku Trend Rider (Upgraded with OBV) ---
const getIchimokuTrendRiderSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = params.ichi_basePeriod + params.ichi_displacement;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for Ichimoku agent (${klines.length}/${minKlines}).`] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    const prevPrice = getPenultimate(closes)!;
    const reasons: string[] = [];

    const ichi_params = {
        high: highs, low: lows,
        conversionPeriod: params.ichi_conversionPeriod, basePeriod: params.ichi_basePeriod,
        spanPeriod: params.ichi_laggingSpanPeriod, displacement: params.ichi_displacement
    };
    const ichiValues = IchimokuCloud.calculate(ichi_params) as IchimokuCloudOutput[];
    const lastIchi = getLast(ichiValues);
    const prevIchi = getPenultimate(ichiValues);
    if (!lastIchi || !prevIchi || !lastIchi.spanA || !lastIchi.spanB || !prevIchi.spanA || !prevIchi.spanB) {
        return { signal: 'HOLD', reasons: ['ℹ️ Ichimoku Cloud not yet formed.'] };
    }

    const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod }) as VortexIndicatorOutput;
    const last_vi_plus = getLast(vi.pdi)!;
    const last_vi_minus = getLast(vi.ndi)!;
    const isViBullish = last_vi_plus > last_vi_minus;
    const isViBearish = last_vi_minus > last_vi_plus;

    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');

    const isBullishKumo = lastIchi.spanA > lastIchi.spanB;
    const prevCloudTop = Math.max(prevIchi.spanA, prevIchi.spanB);
    const lastCloudTop = Math.max(lastIchi.spanA, lastIchi.spanB);
    const bullishBreakout = prevPrice < prevCloudTop && currentPrice > lastCloudTop;
    reasons.push(bullishBreakout ? `✅ Kumo Breakout: Bullish` : `❌ No Bullish Kumo Breakout`);

    const chikouPriceTargetIndex = klines.length - 1 - params.ichi_displacement;
    if (chikouPriceTargetIndex >= 0) {
        const chikouIsBullish = currentPrice > closes[chikouPriceTargetIndex];
        reasons.push(chikouIsBullish ? `✅ Lagging Span: Bullish` : `❌ Lagging Span: Not Bullish`);
        reasons.push(isViBullish ? `✅ VI Confirmation: Bullish` : `❌ VI Confirmation: Not Bullish`);
        reasons.push(isObvBullish ? `✅ OBV Confirmation: Bullish` : `❌ OBV Confirmation: Not Bullish`);

        if (bullishBreakout && chikouIsBullish && isBullishKumo && isViBullish && isObvBullish) {
            reasons.push('✅ Future Kumo: Bullish');
            return { signal: 'BUY', reasons };
        }
    }
    
    const prevCloudBottom = Math.min(prevIchi.spanA, prevIchi.spanB);
    const lastCloudBottom = Math.min(lastIchi.spanA, lastIchi.spanB);
    const bearishBreakout = prevPrice > prevCloudBottom && currentPrice < lastCloudBottom;
    reasons.push(bearishBreakout ? `✅ Kumo Breakout: Bearish` : `❌ No Bearish Kumo Breakout`);
     if (chikouPriceTargetIndex >= 0) {
        const chikouIsBearish = currentPrice < closes[chikouPriceTargetIndex];
        reasons.push(chikouIsBearish ? `✅ Lagging Span: Bearish` : `❌ Lagging Span: Not Bearish`);
        reasons.push(isViBearish ? `✅ VI Confirmation: Bearish` : `❌ VI Confirmation: Not Bearish`);
        reasons.push(isObvBearish ? `✅ OBV Confirmation: Bearish` : `❌ OBV Confirmation: Not Bearish`);

        if (bearishBreakout && chikouIsBearish && !isBullishKumo && isViBearish && isObvBearish) {
            reasons.push('✅ Future Kumo: Bearish');
            return { signal: 'SELL', reasons };
        }
    }
    
    return { signal: 'HOLD', reasons };
};

// --- Agent 17: The Detonator (Upgraded with OBV Accumulation) ---
const getTheDetonatorSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(
        params.det_bb1_len, params.det_bb2_len, params.det_bb3_len, 
        params.det_ema_slow_len, params.det_rsi_len, params.det_vol_len, params.det_atr_len, params.obvPeriod, 35
    );
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data.'] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const lastKline = klines[klines.length - 1];
    const currentPrice = lastKline.close;
    const reasons: string[] = [];

    const bb1 = getLast(BollingerBands.calculate({ period: params.det_bb1_len, stdDev: params.det_bb1_dev, values: closes }))!;
    const bb2 = getLast(BollingerBands.calculate({ period: params.det_bb2_len, stdDev: params.det_bb2_dev, values: closes }))!;
    const bb3 = getLast(BollingerBands.calculate({ period: params.det_bb3_len, stdDev: params.det_bb3_dev, values: closes }))!;
    const emaFast = getLast(EMA.calculate({ period: params.det_ema_fast_len, values: closes }))!;
    const emaSlow = getLast(EMA.calculate({ period: params.det_ema_slow_len, values: closes }))!;
    const rsi = getLast(RSI.calculate({ period: params.det_rsi_len, values: closes }))!;
    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');

    const bb_bull_count = (currentPrice > bb1.upper ? 1 : 0) + (currentPrice > bb2.upper ? 1 : 0) + (currentPrice > bb3.upper ? 1 : 0);
    const bb_bear_count = (currentPrice < bb1.lower ? 1 : 0) + (currentPrice < bb2.lower ? 1 : 0) + (currentPrice < bb3.lower ? 1 : 0);
    reasons.push(`ℹ️ BB Breakout Count: ${bb_bull_count} (Bull), ${bb_bear_count} (Bear)`);

    const trend_ok_long = emaFast > emaSlow && currentPrice > emaFast;
    const trend_ok_short = emaFast < emaSlow && currentPrice < emaFast;
    reasons.push(trend_ok_long ? `✅ Trend: Bullish` : trend_ok_short ? `✅ Trend: Bearish` : `❌ Trend: Sideways`);

    const rsi_ok_long = rsi >= params.det_rsi_thresh;
    const rsi_ok_short = rsi <= (100 - params.det_rsi_thresh);
    reasons.push(rsi_ok_long ? `✅ RSI > ${params.det_rsi_thresh}` : `❌ RSI not bullish`);
    reasons.push(rsi_ok_short ? `✅ RSI < ${100 - params.det_rsi_thresh}` : `❌ RSI not bearish`);
    
    const fake_break_long = bb_bull_count >= 2;
    const fake_break_short = bb_bear_count >= 2;

    if (fake_break_long && trend_ok_long && rsi_ok_long) {
        reasons.push(isObvBullish ? `✅ OBV Momentum: Confirmed Bullish Pressure` : `❌ OBV Momentum: Lacks Bullish Pressure`);
        if (isObvBullish) return { signal: 'BUY', reasons };
    }
    
    if (fake_break_short && trend_ok_short && rsi_ok_short) {
        reasons.push(isObvBearish ? `✅ OBV Momentum: Confirmed Bearish Pressure` : `❌ OBV Momentum: Lacks Bearish Pressure`);
        if (isObvBearish) return { signal: 'SELL', reasons };
    }

    return { signal: 'HOLD', reasons };
};

// --- Agent 18: Candlestick Prophet ---
const bullishPatterns = { 'Bullish Engulfing': bullishengulfingpattern, 'Dragonfly Doji': dragonflydoji, 'Bullish Harami': bullishharami, 'Bullish Harami Cross': bullishharamicross, 'Hammer': hammerpattern, 'Morning Doji Star': morningdojistar, 'Morning Star': morningstar, 'Piercing Line': piercingline, 'Three White Soldiers': threewhitesoldiers };
const bearishPatterns = { 'Abandoned Baby': abandonedbaby, 'Bearish Engulfing': bearishengulfingpattern, 'Dark Cloud Cover': darkcloudcover, 'Downside Tasuki Gap': downsidetasukigap, 'Gravestone Doji': gravestonedoji, 'Bearish Harami': bearishharami, 'Bearish Harami Cross': bearishharamicross, 'Hanging Man': hangingman, 'Evening Doji Star': eveningdojistar, 'Evening Star': eveningstar, 'Shooting Star': shootingstar, 'Three Black Crows': threeblackcrows };

const getCandlestickProphetSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.csp_emaMomentumPeriod, params.obvPeriod, 20);
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data.'] };
    
    const opens = klines.map(k => k.open);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    
    const input = { open: opens, high: highs, low: lows, close: closes };

    const emaMomentum = getLast(EMA.calculate({ period: params.csp_emaMomentumPeriod, values: closes }))!;
    const obv = OBV.calculate({ close: closes, volume: volumes });

    let bullishSignal: TradeSignal | null = null;
    let bearishSignal: TradeSignal | null = null;

    // Check for Bullish Patterns
    for (const [name, patternFunc] of Object.entries(bullishPatterns)) {
        if (getLast(patternFunc(input))) {
            const reasons = [`✅ Pattern: ${name}`];
            const isMomentumConfirmed = currentPrice > emaMomentum;
            reasons.push(isMomentumConfirmed ? `✅ Momentum: Price > ${params.csp_emaMomentumPeriod}-EMA` : `❌ Momentum: Price not > EMA`);
            const isVolumeConfirmed = isObvTrending(obv, 'bullish');
            reasons.push(isVolumeConfirmed ? `✅ Volume: OBV Confirmed` : `❌ Volume: Not bullish`);

            bullishSignal = { signal: (isMomentumConfirmed && isVolumeConfirmed) ? 'BUY' : 'HOLD', reasons };
            break; // Found one, no need to check for more bullish patterns
        }
    }

    // Check for Bearish Patterns
    for (const [name, patternFunc] of Object.entries(bearishPatterns)) {
        if (getLast(patternFunc(input))) {
            const reasons = [`✅ Pattern: ${name}`];
            const isMomentumConfirmed = currentPrice < emaMomentum;
            reasons.push(isMomentumConfirmed ? `✅ Momentum: Price < ${params.csp_emaMomentumPeriod}-EMA` : `❌ Momentum: Price not < EMA`);
            const isVolumeConfirmed = isObvTrending(obv, 'bearish');
            reasons.push(isVolumeConfirmed ? `✅ Volume: OBV Confirmed` : `❌ Volume: OBV not bearish`);
            
            bearishSignal = { signal: (isMomentumConfirmed && isVolumeConfirmed) ? 'SELL' : 'HOLD', reasons };
            break; // Found one, no need to check for more bearish patterns
        }
    }

    // --- Decision Logic ---
    const isBullishConfirmed = bullishSignal?.signal === 'BUY';
    const isBearishConfirmed = bearishSignal?.signal === 'SELL';

    if (isBullishConfirmed && isBearishConfirmed) {
        return { signal: 'HOLD', reasons: ['ℹ️ Conflicting bullish and bearish candlestick patterns detected.'] };
    }
    if (isBullishConfirmed) {
        return bullishSignal!;
    }
    if (isBearishConfirmed) {
        return bearishSignal!;
    }

    // If patterns were found but not confirmed, return the reasons for the first one found.
    if (bullishSignal) return bullishSignal;
    if (bearishSignal) return bearishSignal;

    return { signal: 'HOLD', reasons: ['ℹ️ No recognized candlestick patterns.'] };
};

// Helper for Agent 18 SL placement
const findLastCandlestickPattern = (klines: Kline[], direction: 'LONG' | 'SHORT'): { patternInfo: { name: string; index: number; low: number; high: number } | null } => {
    const patternsToCheck = direction === 'LONG' ? bullishPatterns : bearishPatterns;
    const opens = klines.map(k => k.open);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const closes = klines.map(k => k.close);
    
    // Check last 3 candles for a pattern completion
    for (let i = klines.length - 1; i >= Math.max(0, klines.length - 3); i--) {
        const tempInput = { open: opens.slice(0, i + 1), high: highs.slice(0, i + 1), low: lows.slice(0, i + 1), close: closes.slice(0, i + 1) };
        for (const [name, patternFunc] of Object.entries(patternsToCheck)) {
            try {
                if (getLast(patternFunc(tempInput))) {
                    const multiCandlePatterns: Record<string, number> = { 'Morning Star': 3, 'Evening Star': 3, 'Three White Soldiers': 3, 'Three Black Crows': 3, 'Bullish Engulfing': 2, 'Bearish Engulfing': 2 };
                    const patternLength = multiCandlePatterns[name] || 1;
                    const patternCandles = klines.slice(Math.max(0, i - patternLength + 1), i + 1);
                    
                    const patternLow = Math.min(...patternCandles.map(c => c.low));
                    const patternHigh = Math.max(...patternCandles.map(c => c.high));
                    
                    return { patternInfo: { name, index: i, low: patternLow, high: patternHigh } };
                }
            } catch (e) { /* Ignore errors from insufficient data for a pattern */ }
        }
    }
    return { patternInfo: null };
};

// ----------------------------------------------------------------------------------
// --- #4: MAIN ORCHESTRATOR & HELPERS ---
// ----------------------------------------------------------------------------------

export function validateTradeProfitability(
    entryPrice: number,
    stopLossPrice: number,
    takeProfitPrice: number,
    direction: 'LONG' | 'SHORT',
    originalConfig: BotConfig
): { isValid: boolean, reason: string } {
    const config = applyTimeframeSettings(originalConfig);
    const riskDistance = Math.abs(entryPrice - stopLossPrice);
    const rewardDistance = Math.abs(takeProfitPrice - entryPrice);

    // 1. Risk-to-Reward Check
    if (config.isMinRrEnabled) {
        if (riskDistance <= 0) {
            return { isValid: false, reason: '❌ VETO: Risk distance is zero.' };
        }

        const rrRatio = rewardDistance / riskDistance;
        if (rrRatio < constants.MIN_RISK_REWARD_RATIO) {
            return {
                isValid: false,
                reason: `❌ VETO: R:R Ratio of ${rrRatio.toFixed(2)}:1 is below the minimum of ${constants.MIN_RISK_REWARD_RATIO}:1.`
            };
        }
    }

    return { isValid: true, reason: `✅ Profitability checks passed.` };
}


/**
 * A simple check for RSI divergence to prevent entering trades at points of exhaustion.
 */
function detectMomentumExhaustion(
    klines: Kline[],
    direction: 'BUY' | 'SELL'
): { isExhausted: boolean, reason: string } {
    const lookback = 20; // Lookback for finding peaks/troughs
    const closes = klines.map(k => k.close);
    if (closes.length < lookback + 14) return { isExhausted: false, reason: '' };

    const rsiValues = RSI.calculate({ values: closes, period: 14 });
    const priceSlice = closes.slice(-lookback);
    const rsiSlice = rsiValues.slice(-lookback);
    if (rsiSlice.length === 0) return { isExhausted: false, reason: ''};

    if (direction === 'BUY') { // Check for bearish divergence
        const currentPrice = priceSlice[priceSlice.length - 1];
        const currentRsi = rsiSlice[rsiSlice.length - 1];

        let prevPricePeak = 0;
        let prevRsiPeak = 0;
        // Find the highest high before the last 2 bars
        for (let i = 0; i < priceSlice.length - 2; i++) {
            if (priceSlice[i] > prevPricePeak) {
                prevPricePeak = priceSlice[i];
                prevRsiPeak = rsiSlice[i];
            }
        }
        
        // If current price makes a higher high, but RSI makes a lower high
        if (currentPrice > prevPricePeak && currentRsi < prevRsiPeak) {
            return { isExhausted: true, reason: '❌ [VETO] Bearish RSI divergence detected (peak exhaustion).' };
        }

    } else { // Check for bullish divergence
        const currentPrice = priceSlice[priceSlice.length - 1];
        const currentRsi = rsiSlice[rsiSlice.length - 1];

        let prevPriceTrough = Infinity;
        let prevRsiTrough = Infinity;
        // Find the lowest low before the last 2 bars
        for (let i = 0; i < priceSlice.length - 2; i++) {
            if (priceSlice[i] < prevPriceTrough) {
                prevPriceTrough = priceSlice[i];
                prevRsiTrough = rsiSlice[i];
            }
        }

        if (currentPrice < prevPriceTrough && currentRsi > prevRsiTrough) {
            return { isExhausted: true, reason: '❌ [VETO] Bullish RSI divergence detected (bottom exhaustion).' };
        }
    }

    return { isExhausted: false, reason: '' };
}

/**
 * Checks if the signal candle represents a climactic, exhaustive move.
 * Such moves are often traps, and entering on them is high-risk.
 */
function isClimacticMove(
    klines: Kline[],
): { isClimactic: boolean, reason: string } {
    const minKlines = 21; // For 20-period SMA volume
    if (klines.length < minKlines) return { isClimactic: false, reason: '' };
    
    const lastKline = klines[klines.length - 1];
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);

    const candleRange = lastKline.high - lastKline.low;
    const lastAtr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: 14 })) || 0;
    const lastVolume = getLast(volumes) || 0;
    const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes })) || 0;

    // A climactic move is defined by an unusually large price range combined with high volume.
    // We use a generous multiplier to only catch truly exceptional, exhaustive moves.
    const isLargeRange = candleRange > (lastAtr * 3.5);
    const isHighVolume = lastVolume > (volumeSma * 2.0);

    if (isLargeRange && isHighVolume) {
        return { isClimactic: true, reason: `❌ [VETO] Signal on climactic candle (3.5x ATR, 2.0x Vol), suggesting exhaustion.` };
    }
    
    return { isClimactic: false, reason: '' };
}

/**
 * Checks if the price is overextended from its Volume-Weighted Average Price (VWAP).
 * This prevents chasing trades far from their local "fair value".
 */
function isOverextendedFromVwap(
    klines: Kline[],
    direction: 'BUY' | 'SELL',
    vwapDeviationPercent: number
): { isOverextended: boolean, reason: string } {
    if (klines.length < 20) return { isOverextended: false, reason: '' };

    const inputs = {
        high: klines.map(k => k.high),
        low: klines.map(k => k.low),
        close: klines.map(k => k.close),
        volume: klines.map(k => k.volume || 0),
    };
    const vwapValues = VWAP.calculate(inputs);
    const lastVwap = getLast(vwapValues);
    const currentPrice = getLast(inputs.close);

    if (!lastVwap || !currentPrice) return { isOverextended: false, reason: '' };

    const deviation = ((currentPrice - lastVwap) / lastVwap) * 100;
    const deviationThreshold = vwapDeviationPercent;

    if (direction === 'BUY' && deviation > deviationThreshold) {
        return { 
            isOverextended: true, 
            reason: `❌ [VETO] Price is ${deviation.toFixed(2)}% above VWAP (>${deviationThreshold}%), suggesting overextension.` 
        };
    }

    if (direction === 'SELL' && deviation < -deviationThreshold) {
        return { 
            isOverextended: true, 
            reason: `❌ [VETO] Price is ${Math.abs(deviation).toFixed(2)}% below VWAP (>${deviationThreshold}%), suggesting overextension.` 
        };
    }
    
    return { isOverextended: false, reason: '' };
}


/**
 * Checks for signs of fading momentum on a profitable trade, suggesting a proactive exit.
 */
export function checkMomentumFadingSignal(
    position: Position,
    klines: Kline[],
    config: BotConfig,
): { closePosition: boolean, reason: string } {
    const isLong = position.direction === 'LONG';
    const closes = klines.map(k => k.close);
    const currentPrice = getLast(closes)!;
    const isInProfit = isLong ? currentPrice > position.entryPrice : currentPrice < position.entryPrice;

    // This check is only for profitable trades.
    if (!isInProfit) {
        return { closePosition: false, reason: '' };
    }
    
    if(closes.length < 25) return { closePosition: false, reason: '' }; // Need enough data for EMAs

    const fastEma = getLast(EMA.calculate({ period: 9, values: closes }))!;
    const slowEma = getLast(EMA.calculate({ period: 21, values: closes }))!;

    if (isLong) {
        // Bearish crossover is a strong sign of fading momentum
        if (fastEma < slowEma) {
            return { closePosition: true, reason: 'Proactive Exit: Fading momentum detected (EMA crossover).' };
        }
    } else { // SHORT
        // Bullish crossover
        if (fastEma > slowEma) {
            return { closePosition: true, reason: 'Proactive Exit: Fading momentum detected (EMA crossover).' };
        }
    }
    
    return { closePosition: false, reason: '' };
}

/**
 * Checks for strong counter-trend signals on a losing trade to minimize loss.
 */
export function checkLossMinimizationSignal(
    position: Position,
    klines: Kline[],
    config: BotConfig,
): { closePosition: boolean, reason: string } {
    const isLong = position.direction === 'LONG';
    const closes = klines.map(k => k.close);
    
    if(closes.length < 25) return { closePosition: false, reason: '' };

    const fastEma = getLast(EMA.calculate({ period: 9, values: closes }))!;
    const slowEma = getLast(EMA.calculate({ period: 21, values: closes }))!;
    
    // Check if the momentum is decisively against the position.
    if (isLong) {
        // Bearish crossover exists
        if (fastEma < slowEma) {
            return { closePosition: true, reason: 'Loss Minimization: Bearish momentum confirmed (EMA cross).' };
        }
    } else { // SHORT
        // Bullish crossover exists
        if (fastEma > slowEma) {
            return { closePosition: true, reason: 'Loss Minimization: Bullish momentum confirmed (EMA cross).' };
        }
    }
    
    return { closePosition: false, reason: '' };
}


export async function getTradingSignal(
    agent: Agent, 
    klines: Kline[], 
    originalConfig: BotConfig, 
    htfKlines?: Kline[]
): Promise<TradeSignal> {
    const config = applyTimeframeSettings(originalConfig);
    const finalParams = config.agentParams as Required<AgentParams>;

    let agentSignal: TradeSignal;

    switch (agent.id) {
        case 7: agentSignal = getMarketStructureMavenSignal(klines, finalParams); break;
        case 9: agentSignal = getQuantumScalperSignal(klines, finalParams); break;
        case 11: agentSignal = getHistoricExpertSignal(klines, finalParams); break;
        case 13: agentSignal = getChameleonSignal(klines, finalParams); break;
        case 14: agentSignal = getTheSentinelSignal(klines, finalParams); break;
        case 15: agentSignal = getInstitutionalFlowTracerSignal(klines, finalParams); break;
        case 16: agentSignal = getIchimokuTrendRiderSignal(klines, finalParams); break;
        case 17: agentSignal = getTheDetonatorSignal(klines, finalParams); break;
        case 18: agentSignal = getCandlestickProphetSignal(klines, finalParams); break;
        default:
            return { signal: 'HOLD', reasons: ['Agent not found'] };
    }

    // --- Universal RSI Divergence Veto ---
    if (agentSignal.signal !== 'HOLD') {
        const { isExhausted, reason } = detectMomentumExhaustion(klines, agentSignal.signal);
        if (isExhausted) {
            agentSignal.signal = 'HOLD';
            agentSignal.reasons.push(reason);
        }
    }

    // --- Universal Climactic Move Veto ---
    if (agentSignal.signal !== 'HOLD') {
        const { isClimactic, reason } = isClimacticMove(klines);
        if (isClimactic) {
            agentSignal.signal = 'HOLD';
            agentSignal.reasons.push(reason);
        }
    }
    
    // --- Universal VWAP Proximity Veto ---
    if (agentSignal.signal !== 'HOLD') {
        // Use a specific param for agents that need tuning, otherwise a sensible default.
        const deviationPercent = finalParams.qsc_vwapDeviationPercent ?? 0.25; // Default to 0.25% if not specified
        const { isOverextended, reason } = isOverextendedFromVwap(klines, agentSignal.signal, deviationPercent);
        if (isOverextended) {
            agentSignal.signal = 'HOLD';
            agentSignal.reasons.push(reason);
        }
    }

    // --- Universal HTF Confirmation Filter ---
    if (config.isHtfConfirmationEnabled && htfKlines && htfKlines.length > 50) {
        if (agentSignal.signal !== 'HOLD') {
            const htfEmaPeriod = 50;
            const htfCloses = htfKlines.map(k => k.close);
            const htfEma = getLast(EMA.calculate({ period: htfEmaPeriod, values: htfCloses })) as number | undefined;
            const currentPrice = getLast(klines.map(k => k.close))!;

            if (htfEma) {
                const isHtfBullish = currentPrice > htfEma;
                const isHtfBearish = currentPrice < htfEma;

                const signalDirection = agentSignal.signal === 'BUY' ? 'LONG' : 'SHORT';

                if (isHtfBearish && signalDirection === 'LONG') {
                    agentSignal.signal = 'HOLD';
                    agentSignal.reasons.push(`❌ [HTF VETO] Signal contradicts bearish HTF trend (Price < ${htfEmaPeriod}-EMA).`);
                } else if (isHtfBullish && signalDirection === 'SHORT') {
                    agentSignal.signal = 'HOLD';
                    agentSignal.reasons.push(`❌ [HTF VETO] Signal contradicts bullish HTF trend (Price > ${htfEmaPeriod}-EMA).`);
                } else {
                    agentSignal.reasons.push(`✅ [HTF CONFIRMED] Signal aligns with ${isHtfBullish ? 'bullish' : 'bearish'} HTF trend.`);
                }
            }
        }
    }

    return agentSignal;
}

export function getChameleonManagementSignal(
    position: Position,
    klines: Kline[],
    originalConfig: BotConfig,
): TradeManagementSignal {
    const config = applyTimeframeSettings(originalConfig);
    const reasons: string[] = [];
    
    // --- Proactive Flip Logic ---
    // Check if a valid, opposing signal has formed
    const opposingSignal = getChameleonSignal(klines, config.agentParams as Required<AgentParams>);
    const isLong = position.direction === 'LONG';

    if ((isLong && opposingSignal.signal === 'SELL') || (!isLong && opposingSignal.signal === 'BUY')) {
        reasons.push('Proactive Flip: Strong trend reversal detected.');
        return { action: 'flip', reasons };
    }

    return { reasons: ['No flip signal detected'] };
}
