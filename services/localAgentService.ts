

import { TradingMode, type Agent, type TradeSignal, type Kline, type AgentParams, type Position, type ADXOutput, type MACDOutput, type BollingerBandsOutput, type StochasticRSIOutput, type TradeManagementSignal, type BotConfig, ChameleonAgentState, VortexIndicatorOutput } from '../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV, VWAP, IchimokuCloud } from 'technicalindicators';
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
): { stopLossPrice: number; takeProfitPrice: number; } => {
    const config = applyTimeframeSettings(originalConfig);
    const { timeFrame, agent, investmentAmount, mode, leverage } = config;
    const params = config.agentParams as Required<AgentParams>;

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const isLong = direction === 'LONG';

    // --- Step 1: Calculate a safe, baseline SL/TP using ATR ---
    const atrPeriod = params.atrPeriod;
    if (klines.length < atrPeriod) {
        // Fallback for insufficient data
        const slOffset = entryPrice * 0.02;
        const tpOffset = entryPrice * 0.04;
        return {
            stopLossPrice: isLong ? entryPrice - slOffset : entryPrice + slOffset,
            takeProfitPrice: isLong ? entryPrice + tpOffset : entryPrice - tpOffset,
        };
    }
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: atrPeriod });
    const currentAtr = (getLast(atrValues) as number) || (entryPrice * 0.01);
    
    const timeframeConfig = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];
    const atrMultiplier = agent.id === 17 ? params.det_sl_atr_mult : timeframeConfig.atrMultiplier;
    let riskRewardRatio = timeframeConfig.riskRewardRatio;

    if (agent.id === 13) {
        riskRewardRatio = 10; // Use a very high R:R to set a distant, failsafe TP for the Chameleon agent
    } else if (agent.id === 17) {
        riskRewardRatio = params.det_rr_mult;
    }

    const atrStopOffset = currentAtr * atrMultiplier;

    let suggestedStopLoss = isLong ? entryPrice - atrStopOffset : entryPrice + atrStopOffset;
    let suggestedTakeProfit = isLong ? entryPrice + (atrStopOffset * riskRewardRatio) : entryPrice - (atrStopOffset * riskRewardRatio);

    // --- Agent-Specific SL Modifications ---
    if (agent.id === 16) {
        const ichi_params = {
            high: highs, low: lows,
            conversionPeriod: params.ichi_conversionPeriod,
            basePeriod: params.ichi_basePeriod,
            spanPeriod: params.ichi_laggingSpanPeriod,
            displacement: params.ichi_displacement
        };
        const ichi = getLast(IchimokuCloud.calculate(ichi_params));
        if (ichi) {
            if (isLong && ichi.spanB) {
                // For a long, place SL below the Kumo cloud (spanB)
                suggestedStopLoss = Math.min(suggestedStopLoss, ichi.spanB);
            } else if (!isLong && ichi.spanA) {
                // For a short, place SL above the Kumo cloud (spanA)
                suggestedStopLoss = Math.max(suggestedStopLoss, ichi.spanA);
            }
        }
    }

    // --- S/R Based Take Profit ---
    const srLookback = params.msm_swingPointLookback || 15;
    const { supports, resistances } = calculateSupportResistance(klines, srLookback);

    if (isLong) {
        const potentialTp = resistances.filter(r => r > entryPrice).sort((a, b) => a - b)[0];
        if (potentialTp) {
             const bufferedTp = potentialTp * 0.999;
             if (bufferedTp > entryPrice && bufferedTp < suggestedTakeProfit) { // Only use S/R if it's a tighter TP
                 suggestedTakeProfit = bufferedTp;
             }
        }
    } else { // SHORT
        const potentialTp = supports.filter(s => s < entryPrice).sort((a, b) => b - a)[0];
        if (potentialTp) {
            const bufferedTp = potentialTp * 1.001;
             if (bufferedTp < entryPrice && bufferedTp > suggestedTakeProfit) { // Only use S/R if it's a tighter TP
                suggestedTakeProfit = bufferedTp;
            }
        }
    }


    // --- Step 3: CRITICAL FINAL SAFETY CHECKS ---
    
    // Fee-Awareness Check (pre-validation)
    const positionValue = mode === TradingMode.USDSM_Futures 
        ? investmentAmount * leverage 
        : investmentAmount;
    const tradeSize = positionValue / entryPrice;
    let finalTakeProfit = suggestedTakeProfit;

    if (tradeSize > 0) {
        const roundTripFee = positionValue * TAKER_FEE_RATE * 2;
        const feeInPrice = roundTripFee / tradeSize;
        const minProfitDistance = feeInPrice * MIN_PROFIT_BUFFER_MULTIPLIER;
        const currentRewardDistance = Math.abs(finalTakeProfit - entryPrice);

        if (currentRewardDistance < minProfitDistance) {
            finalTakeProfit = isLong 
                ? entryPrice + minProfitDistance 
                : entryPrice - minProfitDistance;
        }
    }
    
    // Min SL Distance Check
    const minSlOffset = entryPrice * (MIN_STOP_LOSS_PERCENT / 100);
    const minSafeStopLoss = isLong ? entryPrice - minSlOffset : entryPrice + minSlOffset;

    const finalStopLoss = isLong
        ? Math.min(suggestedStopLoss, minSafeStopLoss)
        : Math.max(suggestedStopLoss, minSafeStopLoss);

    // Final sanity check to ensure SL/TP are on the correct side of entry
    if ((isLong && finalStopLoss >= entryPrice) || (!isLong && finalStopLoss <= entryPrice)) {
        return { stopLossPrice: minSafeStopLoss, takeProfitPrice: isLong ? entryPrice + minSlOffset * 2 : entryPrice - minSlOffset * 2 };
    }
    if ((isLong && finalTakeProfit <= entryPrice) || (!isLong && finalTakeProfit >= entryPrice)) {
        const finalSlDistance = Math.abs(entryPrice - finalStopLoss);
        finalTakeProfit = isLong ? entryPrice + (finalSlDistance * riskRewardRatio) : entryPrice - (finalSlDistance * riskRewardRatio);
    }

    return {
        stopLossPrice: finalStopLoss,
        takeProfitPrice: finalTakeProfit,
    };
};

// ----------------------------------------------------------------------------------
// --- #2: TRADE MANAGEMENT (Trailing Stops, etc.) ---
// ----------------------------------------------------------------------------------

/**
 * A multi-stage, fee-multiple-based profit-locking mechanism.
 * 1. Moves SL to fee-adjusted breakeven once profit reaches 3x the fee cost.
 * 2. Moves SL to lock in profits at N-2 fee-multiple milestones thereafter.
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

    // Step 1: Calculate the fee in price terms
    const positionValue = entryPrice * size;
    const roundTripFee = positionValue * TAKER_FEE_RATE * 2;
    const feeInPrice = roundTripFee > 0 ? (roundTripFee / size) : 0;
    if (feeInPrice <= 0) return { reasons };

    const currentGrossProfitInPrice = (currentPrice - entryPrice) * (isLong ? 1 : -1);
    if (currentGrossProfitInPrice <= 0) return { reasons }; // Not in profit

    const currentFeeMultiple = currentGrossProfitInPrice / feeInPrice;

    // Trigger 1: Move to Breakeven at 3x fee profit
    if (!isBreakevenSet) {
        if (currentFeeMultiple >= 3) {
            const breakevenStop = entryPrice + (feeInPrice * (isLong ? 1 : -1)); // Covers round-trip fee
            // Ratchet check: Only move SL if it's an improvement
            if ((isLong && breakevenStop > stopLossPrice) || (!isLong && breakevenStop < stopLossPrice)) {
                return {
                    newStopLoss: breakevenStop,
                    reasons: [`Profit Secure: Breakeven set at 3x fee gain.`],
                    newState: { isBreakevenSet: true, profitLockTier: 3 } // Mark BE set and tier at 3
                };
            }
        } else {
            // If not yet at 3x, do nothing. Gives breathing room.
            return { reasons };
        }
    }

    // Trigger 2: Dynamic (N)x -> (N-2)x profit lock for N >= 4
    if (currentFeeMultiple >= 4) {
        const triggerFeeMultiple = Math.floor(currentFeeMultiple); // This is our 'N'
        
        // Only trigger if we've reached a new integer multiple, and it's higher than the current tier
        if (triggerFeeMultiple > profitLockTier) {
            const lockFeeMultiple = triggerFeeMultiple - 2; // This is 'N-2'
            const newStopLoss = entryPrice + (feeInPrice * lockFeeMultiple * (isLong ? 1 : -1));

            // Ratchet Check
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
    let closePosition: boolean | undefined;

    switch (agent.id) {
        case 9: // Quantum Scalper: PSAR-based trailing stop
            const psarInput = { high: klines.map(k => k.high), low: klines.map(k => k.low), step: params.qsc_psarStep, max: params.qsc_psarMax };
            if (psarInput.high.length >= 2) {
                const psar = PSAR.calculate(psarInput);
                const lastPsar = getLast(psar) as number | undefined;
                if (lastPsar) {
                    const isLong = position.direction === 'LONG';
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
        
        case 16: // Ichimoku Trend Rider
            const ichi_params = {
                high: klines.map(k => k.high), low: klines.map(k => k.low),
                conversionPeriod: params.ichi_conversionPeriod,
                basePeriod: params.ichi_basePeriod,
                spanPeriod: params.ichi_laggingSpanPeriod,
                displacement: params.ichi_displacement
            };
            const ichiValues = IchimokuCloud.calculate(ichi_params);
            const lastIchi = getLast(ichiValues);
            if(lastIchi) {
                const isLong = position.direction === 'LONG';
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
    
    return { newStopLoss, closePosition, reasons };
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

// --- Agent 7: Market Structure Maven (Upgraded with Volatility Adaptation) ---
const getMarketStructureMavenSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.msm_htfEmaPeriod, params.atrPeriod);
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };
    
    const closes = klines.map(k => k.close);
    const currentPrice = getLast(closes)!;
    const lastKline = klines[klines.length - 1];
    const prevKline = klines[klines.length - 2];
    const reasons: string[] = [];

    const emaBias = getLast(EMA.calculate({ period: params.msm_htfEmaPeriod, values: closes }))! as number;
    const isBullishBias = currentPrice > emaBias;
    reasons.push(isBullishBias ? `✅ Trend Bias: Bullish` : `✅ Trend Bias: Bearish`);

    const { supports, resistances } = calculateSupportResistance(klines, params.msm_swingPointLookback);
    
    const atr = getLast(ATR.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes, period: params.atrPeriod }))! as number;
    const proximityZone = atr * 0.5;

    let inZone = false;
    let confirmationPattern: { name: string, type: 'bullish' | 'bearish' } | null = null;
    
    if (params.isCandleConfirmationEnabled) {
        confirmationPattern = recognizeCandlestickPattern(lastKline, prevKline);
    }
    
    if (isBullishBias && supports.length > 0) {
        const closestSupport = supports[0];
        const isNearSupport = Math.abs(currentPrice - closestSupport) <= proximityZone;
        inZone = isNearSupport;
        reasons.push(isNearSupport ? `✅ Price in support zone` : `❌ Price not near key support`);
        if (isNearSupport) {
            if (params.isCandleConfirmationEnabled) {
                reasons.push(confirmationPattern?.type === 'bullish' ? `✅ Confirmed by ${confirmationPattern.name}` : `❌ Awaiting bullish candle confirmation`);
                if (confirmationPattern?.type === 'bullish') return { signal: 'BUY', reasons };
            } else {
                return { signal: 'BUY', reasons };
            }
        }
    }

    if (!isBullishBias && resistances.length > 0) {
        const closestResistance = resistances[0];
        const isNearResistance = Math.abs(currentPrice - closestResistance) <= proximityZone;
        inZone = isNearResistance;
        reasons.push(isNearResistance ? `✅ Price in resistance zone` : `❌ Price not near key resistance`);
        if (isNearResistance) {
            if (params.isCandleConfirmationEnabled) {
                reasons.push(confirmationPattern?.type === 'bearish' ? `✅ Confirmed by ${confirmationPattern.name}` : `❌ Awaiting bearish candle confirmation`);
                if (confirmationPattern?.type === 'bearish') return { signal: 'SELL', reasons };
            } else {
                return { signal: 'SELL', reasons };
            }
        }
    }

    return { signal: 'HOLD', reasons };
};

// --- Agent 9: Quantum Scalper (Upgraded with Vortex Indicator) ---
const getQuantumScalperSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = 50;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };
    
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const closes = klines.map(k => k.close);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];
    
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.qsc_adxPeriod! }))! as ADXOutput;
    const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod }) as VortexIndicatorOutput;
    const last_vi_plus = getLast(vi.pdi)!;
    const last_vi_minus = getLast(vi.ndi)!;

    const adxThreshold = params.qsc_adxThreshold!;
    const isTrending = adx.adx > adxThreshold;
    reasons.push(isTrending ? `ℹ️ Regime: Trending (ADX ${adx.adx.toFixed(1)})` : `ℹ️ Regime: Ranging (ADX ${adx.adx.toFixed(1)})`);
    
    const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: params.qsc_stochRsiPeriod!, stochasticPeriod: params.qsc_stochRsiPeriod!, kPeriod: 3, dPeriod: 3 }))! as StochasticRSIOutput;
    
    if (isTrending) {
        let bullishScore = 0;
        let bearishScore = 0;
        const emaFast = getLast(EMA.calculate({ period: params.qsc_fastEmaPeriod!, values: closes }))! as number;
        const emaSlow = getLast(EMA.calculate({ period: params.qsc_slowEmaPeriod!, values: closes }))! as number;

        const isUptrend = emaFast > emaSlow;
        const isDowntrend = emaFast < emaSlow;
        const isViBullish = last_vi_plus > last_vi_minus;
        const isViBearish = last_vi_minus > last_vi_plus;
        
        reasons.push(isUptrend ? '✅ EMA Trend: Up' : isDowntrend ? '✅ EMA Trend: Down' : 'ℹ️ EMA Trend: Neutral');
        reasons.push(isViBullish ? '✅ VI Trend: Bullish' : isViBearish ? '✅ VI Trend: Bearish' : 'ℹ️ VI Trend: Neutral');
        if (isUptrend && isViBullish) bullishScore++;
        if (isDowntrend && isViBearish) bearishScore++;
        
        const isStochBullish = stochRsi.k > stochRsi.d;
        const isStochBearish = stochRsi.k < stochRsi.d;
        reasons.push(isStochBullish ? '✅ Momentum: Bullish' : isStochBearish ? '✅ Momentum: Bearish' : 'ℹ️ Momentum: Neutral');
        if (isStochBullish) bullishScore++;
        if (isStochBearish) bearishScore++;

        const isAdxBullish = adx.pdi > adx.mdi;
        const isAdxBearish = adx.mdi > adx.pdi;
        reasons.push(isAdxBullish ? '✅ Strength: Bulls in control' : isAdxBearish ? '✅ Strength: Bears in control' : 'ℹ️ Strength: Indecisive');
        if (isAdxBullish) bullishScore++;
        if (isAdxBearish) bearishScore++;

        reasons.push(`ℹ️ Bullish Score: ${bullishScore}/${params.qsc_trendScoreThreshold!}`);
        if (bullishScore >= params.qsc_trendScoreThreshold!) return { signal: 'BUY', reasons };

        reasons.push(`ℹ️ Bearish Score: ${bearishScore}/${params.qsc_trendScoreThreshold!}`);
        if (bearishScore >= params.qsc_trendScoreThreshold!) return { signal: 'SELL', reasons };

    } else { // Ranging
        let bullishScore = 0;
        let bearishScore = 0;

        const bb = getLast(BollingerBands.calculate({ period: params.qsc_bbPeriod!, stdDev: params.qsc_bbStdDev!, values: closes }))! as BollingerBandsOutput;
        const vwap = getLast(VWAP.calculate({ high: highs, low: lows, close: closes, volume: klines.map(k => k.volume || 0) }));

        const isPriceOversold = currentPrice < bb.lower;
        const isStochOversold = stochRsi.stochRSI < params.qsc_stochRsiOversold!;
        reasons.push(isPriceOversold ? '✅ Price: Below Lower BB' : '❌ Price: Not below Lower BB');
        reasons.push(isStochOversold ? `✅ StochRSI: Oversold (<${params.qsc_stochRsiOversold!})` : `❌ StochRSI: Not Oversold`);
        
        if (isPriceOversold) bullishScore++;
        if (isStochOversold) bullishScore++;
        
        const isFarBelowVwap = vwap && params.qsc_vwapDeviationPercent ? currentPrice < vwap * (1 - params.qsc_vwapDeviationPercent / 100) : false;
        reasons.push(isFarBelowVwap ? '✅ Price: Deviated below VWAP' : '❌ Price: Not deviated below VWAP');
        if (isFarBelowVwap) bullishScore++;


        reasons.push(`ℹ️ Reversal Buy Score: ${bullishScore}/${params.qsc_rangeScoreThreshold!}`);
        if (bullishScore >= params.qsc_rangeScoreThreshold!) return { signal: 'BUY', reasons };

        const isPriceOverbought = currentPrice > bb.upper;
        const isStochOverbought = stochRsi.stochRSI > params.qsc_stochRsiOverbought!;
        reasons.push(isPriceOverbought ? '✅ Price: Above Upper BB' : '❌ Price: Not above Upper BB');
        reasons.push(isStochOverbought ? `✅ StochRSI: Overbought (>${params.qsc_stochRsiOverbought!})` : `❌ StochRSI: Not Overbought`);
        
        if (isPriceOverbought) bearishScore++;
        if (isStochOverbought) bearishScore++;
        
        const isFarAboveVwap = vwap && params.qsc_vwapDeviationPercent ? currentPrice > vwap * (1 + params.qsc_vwapDeviationPercent / 100) : false;
        reasons.push(isFarAboveVwap ? '✅ Price: Deviated above VWAP' : '❌ Price: Not deviated above VWAP');
        if(isFarAboveVwap) bearishScore++;

        reasons.push(`ℹ️ Reversal Sell Score: ${bearishScore}/${params.qsc_rangeScoreThreshold!}`);
        if (bearishScore >= params.qsc_rangeScoreThreshold!) return { signal: 'SELL', reasons };
    }

    return { signal: 'HOLD', reasons };
};

// --- Agent 11: Historic Expert ---
const getHistoricExpertSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.he_trendSmaPeriod, params.he_slowEmaPeriod, params.he_rsiPeriod);
    if (klines.length < minKlines + 1) { // +1 for previous EMA values
        return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };
    }

    const closes = klines.map(k => k.close);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];

    // 1. Trend Determination (30-candle lookback)
    const trendSma = getLast(SMA.calculate({ period: params.he_trendSmaPeriod, values: closes }))!;
    const isBullishTrend = currentPrice > trendSma;
    const isBearishTrend = currentPrice < trendSma;
    reasons.push(isBullishTrend ? `✅ Trend: Bullish (Price > ${params.he_trendSmaPeriod}-SMA)` : `✅ Trend: Bearish (Price < ${params.he_trendSmaPeriod}-SMA)`);

    // 2. Entry Trigger (EMA Crossover)
    const fastEmas = EMA.calculate({ period: params.he_fastEmaPeriod, values: closes });
    const slowEmas = EMA.calculate({ period: params.he_slowEmaPeriod, values: closes });
    const fastEma = getLast(fastEmas)!;
    const slowEma = getLast(slowEmas)!;
    const prevFastEma = getPenultimate(fastEmas)!;
    const prevSlowEma = getPenultimate(slowEmas)!;

    const bullishCrossover = fastEma > slowEma && prevFastEma <= prevSlowEma;
    const bearishCrossover = fastEma < slowEma && prevFastEma >= prevSlowEma;
    reasons.push(bullishCrossover ? '✅ Trigger: Bullish EMA Crossover' : bearishCrossover ? '✅ Trigger: Bearish EMA Crossover' : '❌ Trigger: No EMA Crossover');

    // 3. Momentum Confirmation (RSI)
    const rsi = getLast(RSI.calculate({ period: params.he_rsiPeriod, values: closes }))!;
    const rsiIsBullish = rsi > params.he_rsiMidline;
    const rsiIsBearish = rsi < params.he_rsiMidline;
    reasons.push(`ℹ️ Momentum: RSI is ${rsi.toFixed(1)}`);

    // Combine Logic
    if (isBullishTrend && bullishCrossover && rsiIsBullish) {
        reasons.push(`✅ Momentum: RSI > ${params.he_rsiMidline}`);
        return { signal: 'BUY', reasons };
    }

    if (isBearishTrend && bearishCrossover && rsiIsBearish) {
        reasons.push(`✅ Momentum: RSI < ${params.he_rsiMidline}`);
        return { signal: 'SELL', reasons };
    }
    
    // Add unmet conditions for clarity if no signal
    if(isBullishTrend && bullishCrossover && !rsiIsBullish) reasons.push(`❌ Momentum: RSI not above ${params.he_rsiMidline}`);
    if(isBearishTrend && bearishCrossover && !rsiIsBearish) reasons.push(`❌ Momentum: RSI not below ${params.he_rsiMidline}`);

    return { signal: 'HOLD', reasons };
};

// --- Agent 13: The Chameleon (Rebuilt with Ichimoku + Vortex Indicator) ---
const getChameleonSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.ichi_basePeriod!, params.ichi_displacement!, params.viPeriod) + 5;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data for Chameleon analysis.'] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const currentPrice = getLast(closes)!;
    const lastKline = klines[klines.length - 1];
    const reasons: string[] = [];

    const ichi_params = {
        high: highs, low: lows,
        conversionPeriod: params.ichi_conversionPeriod!,
        basePeriod: params.ichi_basePeriod!,
        spanPeriod: params.ichi_laggingSpanPeriod!,
        displacement: params.ichi_displacement!
    };
    const ichi = getLast(IchimokuCloud.calculate(ichi_params));
    if (!ichi || !ichi.spanA || !ichi.spanB || !ichi.base) {
        return { signal: 'HOLD', reasons: ['ℹ️ Ichimoku Cloud not yet fully formed.'] };
    }

    const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod }) as VortexIndicatorOutput;
    const last_vi_plus = getLast(vi.pdi)!;
    const last_vi_minus = getLast(vi.ndi)!;
    
    // --- Bullish Entry Logic ---
    const isBullishKumo = ichi.spanA > ichi.spanB;
    const isPriceAboveKumo = currentPrice > ichi.spanA && currentPrice > ichi.spanB;
    if (isBullishKumo && isPriceAboveKumo) {
        reasons.push(`✅ Trend: Bullish (Price above Kumo)`);
        const kijunSen = ichi.base;
        const hasPulledBackToKijun = lastKline.low <= kijunSen && currentPrice > kijunSen;
        reasons.push(hasPulledBackToKijun ? `✅ Entry: Price pulled back to Kijun-sen` : `❌ Entry: Awaiting pullback to Kijun-sen`);
        const isViBullish = last_vi_plus > last_vi_minus;
        reasons.push(isViBullish ? `✅ VI Confirmation: Bullish` : `❌ VI Confirmation: Not Bullish`);

        if (hasPulledBackToKijun && isViBullish) {
            return { signal: 'BUY', reasons };
        }
    }

    // --- Bearish Entry Logic ---
    const isBearishKumo = ichi.spanA < ichi.spanB;
    const isPriceBelowKumo = currentPrice < ichi.spanA && currentPrice < ichi.spanB;
    if (isBearishKumo && isPriceBelowKumo) {
        reasons.push(`✅ Trend: Bearish (Price below Kumo)`);
        const kijunSen = ichi.base;
        const hasPulledBackToKijun = lastKline.high >= kijunSen && currentPrice < kijunSen;
        reasons.push(hasPulledBackToKijun ? `✅ Entry: Price pulled back to Kijun-sen` : `❌ Entry: Awaiting pullback to Kijun-sen`);
        const isViBearish = last_vi_minus > last_vi_plus;
        reasons.push(isViBearish ? `✅ VI Confirmation: Bearish` : `❌ VI Confirmation: Not Bearish`);

        if (hasPulledBackToKijun && isViBearish) {
            return { signal: 'SELL', reasons };
        }
    }

    reasons.push(`ℹ️ No valid pullback entry detected.`);
    return { signal: 'HOLD', reasons };
};

// --- Agent 14: The Sentinel (Rebuilt with Vortex Indicator) ---
const getTheSentinelSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = 200; // Requires long EMA
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for The Sentinel (${klines.length}/${minKlines} candles).`] };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    
    // --- Indicator Calculations ---
    const ema50 = getLast(EMA.calculate({ period: 50, values: closes }))!;
    const ema200 = getLast(EMA.calculate({ period: 200, values: closes }))!;
    const macdValues = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const macd = getLast(macdValues)!;
    const prevMacd = getPenultimate(macdValues)!;
    const rsi = getLast(RSI.calculate({ values: closes, period: 14 }))!;
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: 14 }))!;
    const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod }) as VortexIndicatorOutput;
    const last_vi_plus = getLast(vi.pdi)!;
    const last_vi_minus = getLast(vi.ndi)!;
    const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes }))!;
    const lastVolume = getLast(volumes)!;

    // --- Scoring Logic ---
    let bullTrend = 0, bearTrend = 0;
    let bullMomentum = 0, bearMomentum = 0;
    let bullConfirm = 0, bearConfirm = 0;
    
    const trendMax = 35, momentumMax = 40, confirmMax = 25;

    // 1. Trend (Weight: 35%) - Re-weighted for VI
    if (last_vi_plus > last_vi_minus) bullTrend += 15; else bearTrend += 15; // VI is fast, high weight
    if (currentPrice > ema200) bullTrend += 10; else bearTrend += 10; // Long-term bias
    if (ema50 > ema200) bullTrend += 5; else bearTrend += 5; // Mid-term bias
    if (adx.adx > 25) { // Strength confirmation
        if(adx.pdi > adx.mdi) bullTrend += 5; else bearTrend += 5;
    }

    // 2. Momentum (Weight: 40%)
    if (macd.histogram! > 0 && macd.histogram! > (prevMacd.histogram || 0)) bullMomentum += 20;
    else if (macd.histogram! < 0 && macd.histogram! < (prevMacd.histogram || 0)) bearMomentum += 20;
    if (rsi > 55) bullMomentum += 20;
    else if (rsi < 45) bearMomentum += 20;

    // 3. Confirmation (Weight: 25%) - Changed to use Supertrend
    const supertrend = getLast(Supertrend.calculate({ high: highs, low: lows, close: closes, period: 10, multiplier: 3 }));
    if (supertrend !== undefined) {
        if (currentPrice > supertrend) bullConfirm += 15; else bearConfirm += 15;
    }
    if (lastVolume > volumeSma) {
        if(bullMomentum > bearMomentum) bullConfirm += 10;
        if(bearMomentum > bullMomentum) bearConfirm += 10;
    }
    
    const finalBullishScore = bullTrend + bullMomentum + bullConfirm;
    const finalBearishScore = bearTrend + bearMomentum + bearConfirm;

    const reasons: string[] = [];
    reasons.push(`*Bullish Score: ${finalBullishScore.toFixed(0)}*`);
    reasons.push(` ┣ Trend: ${(bullTrend / trendMax * 100).toFixed(0)}% | Momentum: ${(bullMomentum / momentumMax * 100).toFixed(0)}% | Confirm: ${(bullConfirm / confirmMax * 100).toFixed(0)}%`);
    reasons.push(`*Bearish Score: ${finalBearishScore.toFixed(0)}*`);
    reasons.push(` ┣ Trend: ${(bearTrend / trendMax * 100).toFixed(0)}% | Momentum: ${(bearMomentum / momentumMax * 100).toFixed(0)}% | Confirm: ${(bearConfirm / confirmMax * 100).toFixed(0)}%`);

    const threshold = params.sentinel_scoreThreshold!;
    if (finalBullishScore >= threshold && finalBullishScore > finalBearishScore) {
        reasons.push(`✅ Bullish score exceeds threshold of ${threshold}%.`);
        return { signal: 'BUY', reasons };
    }
    
    if (finalBearishScore >= threshold && finalBearishScore > finalBullishScore) {
        reasons.push(`✅ Bearish score exceeds threshold of ${threshold}%.`);
        return { signal: 'SELL', reasons };
    }

    reasons.push(`❌ Neither score has met the ${threshold}% threshold.`);
    return { signal: 'HOLD', reasons };
};

// --- Agent 15: Institutional Flow Tracer (VWAP) ---
const getInstitutionalFlowTracerSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = params.vwap_emaTrendPeriod;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for VWAP agent (${klines.length}/${minKlines}).`] };

    const closes = klines.map(k => k.close);
    const currentPrice = getLast(closes)!;
    const lastKline = klines[klines.length - 1];
    const reasons: string[] = [];

    const vwapInput = {
        high: klines.map(k => k.high),
        low: klines.map(k => k.low),
        close: closes,
        volume: klines.map(k => k.volume || 0),
    };
    const vwap = getLast(VWAP.calculate(vwapInput));
    if (!vwap) return { signal: 'HOLD', reasons: ['ℹ️ Could not calculate VWAP.'] };

    const emaTrend = getLast(EMA.calculate({ period: params.vwap_emaTrendPeriod, values: closes }))!;
    const isUptrend = currentPrice > emaTrend;
    reasons.push(isUptrend ? '✅ Trend: Bullish (Price > EMA)' : '✅ Trend: Bearish (Price < EMA)');

    // Bullish Entry: Pullback and bounce off VWAP in an uptrend
    if (isUptrend) {
        const isNearVwap = Math.abs(currentPrice - vwap) / vwap < (params.vwap_proximityPercent / 100);
        const bouncedOffVwap = lastKline.low < vwap && lastKline.close > vwap;
        reasons.push(bouncedOffVwap ? '✅ Price bounced off VWAP' : isNearVwap ? 'ℹ️ Price is near VWAP' : '❌ Price not near VWAP');

        if (bouncedOffVwap) {
            return { signal: 'BUY', reasons };
        }
    }

    // Bearish Entry: Rally and rejection from VWAP in a downtrend
    if (!isUptrend) {
        const isNearVwap = Math.abs(currentPrice - vwap) / vwap < (params.vwap_proximityPercent / 100);
        const rejectedFromVwap = lastKline.high > vwap && lastKline.close < vwap;
        reasons.push(rejectedFromVwap ? '✅ Price rejected from VWAP' : isNearVwap ? 'ℹ️ Price is near VWAP' : '❌ Price not near VWAP');

        if (rejectedFromVwap) {
            return { signal: 'SELL', reasons };
        }
    }

    return { signal: 'HOLD', reasons };
};

// --- Agent 16: Ichimoku Trend Rider ---
const getIchimokuTrendRiderSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = params.ichi_basePeriod + params.ichi_displacement;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for Ichimoku agent (${klines.length}/${minKlines}).`] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const currentPrice = getLast(closes)!;
    const prevPrice = getPenultimate(closes)!;
    const reasons: string[] = [];

    const ichi_params = {
        high: highs, low: lows,
        conversionPeriod: params.ichi_conversionPeriod,
        basePeriod: params.ichi_basePeriod,
        spanPeriod: params.ichi_laggingSpanPeriod,
        displacement: params.ichi_displacement
    };
    const ichiValues = IchimokuCloud.calculate(ichi_params);
    const lastIchi = getLast(ichiValues);
    const prevIchi = getPenultimate(ichiValues);

    if (!lastIchi || !prevIchi || !lastIchi.spanA || !lastIchi.spanB || !prevIchi.spanA || !prevIchi.spanB) {
        return { signal: 'HOLD', reasons: ['ℹ️ Ichimoku Cloud not yet formed.'] };
    }

    // Kumo (Cloud) breakout logic
    const isBullishKumo = lastIchi.spanA > lastIchi.spanB;
    const prevCloudTop = Math.max(prevIchi.spanA, prevIchi.spanB);
    const prevCloudBottom = Math.min(prevIchi.spanA, prevIchi.spanB);
    const lastCloudTop = Math.max(lastIchi.spanA, lastIchi.spanB);
    const lastCloudBottom = Math.min(lastIchi.spanA, lastIchi.spanB);

    const bullishBreakout = prevPrice < prevCloudTop && currentPrice > lastCloudTop;
    const bearishBreakout = prevPrice > prevCloudBottom && currentPrice < lastCloudBottom;
    reasons.push(bullishBreakout ? `✅ Kumo Breakout: Bullish` : bearishBreakout ? `✅ Kumo Breakout: Bearish` : `❌ No Kumo Breakout`);

    // Lagging Span (Chikou) confirmation
    const chikouPriceTargetIndex = klines.length - 1 - params.ichi_displacement;
    if (chikouPriceTargetIndex >= 0) {
        const chikouTargetPrice = closes[chikouPriceTargetIndex];
        const chikouIsBullish = currentPrice > chikouTargetPrice;
        const chikouIsBearish = currentPrice < chikouTargetPrice;
        reasons.push(chikouIsBullish ? `✅ Lagging Span: Bullish` : chikouIsBearish ? `✅ Lagging Span: Bearish` : `ℹ️ Lagging Span: Neutral`);

        // Combine logic
        if (bullishBreakout && chikouIsBullish && isBullishKumo) {
            reasons.push('✅ Future Kumo: Bullish');
            return { signal: 'BUY', reasons };
        }

        if (bearishBreakout && chikouIsBearish && !isBullishKumo) {
            reasons.push('✅ Future Kumo: Bearish');
            return { signal: 'SELL', reasons };
        }
    }
    
    return { signal: 'HOLD', reasons };
};

// --- Agent 17: The Detonator ---
const getTheDetonatorSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(
        params.det_bb1_len, params.det_bb2_len, params.det_bb3_len, 
        params.det_ema_slow_len, params.det_rsi_len, params.det_vol_len
    );
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data for The Detonator.'] };

    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);
    const lastKline = klines[klines.length - 1];
    const currentPrice = lastKline.close;
    const reasons: string[] = [];

    // Indicators
    const bb1 = getLast(BollingerBands.calculate({ period: params.det_bb1_len, stdDev: params.det_bb1_dev, values: closes }))!;
    const bb2 = getLast(BollingerBands.calculate({ period: params.det_bb2_len, stdDev: params.det_bb2_dev, values: closes }))!;
    const bb3 = getLast(BollingerBands.calculate({ period: params.det_bb3_len, stdDev: params.det_bb3_dev, values: closes }))!;
    const bb4 = getLast(BollingerBands.calculate({ period: params.det_bb4_len, stdDev: params.det_bb4_dev, values: closes }))!;
    const emaFast = getLast(EMA.calculate({ period: params.det_ema_fast_len, values: closes }))!;
    const emaSlow = getLast(EMA.calculate({ period: params.det_ema_slow_len, values: closes }))!;
    const rsi = getLast(RSI.calculate({ period: params.det_rsi_len, values: closes }))!;
    const volSma = getLast(SMA.calculate({ period: params.det_vol_len, values: volumes }))!;

    // Filters & Signal Logic
    const vol_ok = lastKline.volume! > volSma * params.det_vol_mult;
    const pct_move = Math.abs((lastKline.close - lastKline.open) / lastKline.open) * 100;
    const pump_ok = pct_move < params.det_max_bar_move_pct;
    
    reasons.push(vol_ok ? `✅ Volume > Avg * ${params.det_vol_mult}` : `❌ Volume too low`);
    reasons.push(pump_ok ? `✅ Candle move is normal` : `❌ Candle move > ${params.det_max_bar_move_pct}% (Pump)`);

    // BB Breakout Counts
    const bb_bull_count = (currentPrice > bb1.upper ? 1 : 0) + (currentPrice > bb2.upper ? 1 : 0) + (currentPrice > bb3.upper ? 1 : 0) + (currentPrice > bb4.upper ? 1 : 0);
    const bb_bear_count = (currentPrice < bb1.lower ? 1 : 0) + (currentPrice < bb2.lower ? 1 : 0) + (currentPrice < bb3.lower ? 1 : 0) + (currentPrice < bb4.lower ? 1 : 0);
    reasons.push(`ℹ️ BB Breakout Count: ${bb_bull_count} (Bull), ${bb_bear_count} (Bear)`);

    // Breakout Margin Filter
    const bb_range = bb1.upper - bb1.lower;
    const breakout_margin = bb_range * params.det_bb_margin_pct;
    const close_above_margin = currentPrice > bb1.upper + breakout_margin;
    const close_below_margin = currentPrice < bb1.lower - breakout_margin;

    // Trend Filters
    const trend_ok_long = emaFast > emaSlow && currentPrice > emaFast;
    const trend_ok_short = emaFast < emaSlow && currentPrice < emaSlow;
    reasons.push(trend_ok_long ? `✅ Trend: Bullish` : trend_ok_short ? `✅ Trend: Bearish` : `❌ Trend: Sideways`);

    // RSI Momentum
    const rsi_ok_long = rsi >= params.det_rsi_thresh;
    const rsi_ok_short = rsi <= (100 - params.det_rsi_thresh);
    reasons.push(rsi_ok_long ? `✅ RSI > ${params.det_rsi_thresh}` : `❌ RSI not bullish`);
    reasons.push(rsi_ok_short ? `✅ RSI < ${100 - params.det_rsi_thresh}` : `❌ RSI not bearish`);
    
    // Fake-break Protection
    const fake_break_long = (bb_bull_count >= 2) && currentPrice > lastKline.open && vol_ok && pump_ok && close_above_margin;
    const fake_break_short = (bb_bear_count >= 2) && currentPrice < lastKline.open && vol_ok && pump_ok && close_below_margin;

    // Final Signals
    if (fake_break_long && trend_ok_long && rsi_ok_long) {
        reasons.push(`✅ Final Check: Bullish conditions met`);
        return { signal: 'BUY', reasons };
    }
    
    if (fake_break_short && trend_ok_short && rsi_ok_short) {
        reasons.push(`✅ Final Check: Bearish conditions met`);
        return { signal: 'SELL', reasons };
    }

    return { signal: 'HOLD', reasons };
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
        default:
            return { signal: 'HOLD', reasons: ['Agent not found'] };
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

export function getChameleonStrategicUpdate(
    klines: Kline[],
    originalConfig: BotConfig,
    position: Position
): ChameleonAgentState {
    const config = applyTimeframeSettings(originalConfig);
    const params = config.agentParams as Required<AgentParams>;
    
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);

    const lastAtr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: params.ch_atrPeriod! })) || 0;
    const lastRsi = getLast(RSI.calculate({ values: closes, period: params.ch_rsiPeriod! })) || 50;
    
    const lookback = params.ch_lookbackPeriod!;
    const recentKlines = klines.slice(-lookback);
    const swingPoint = position.direction === 'LONG' 
        ? Math.min(...recentKlines.map(k => k.low)) 
        : Math.max(...recentKlines.map(k => k.high));

    const fastEma = getLast(EMA.calculate({ period: 9, values: closes }))!;
    const slowEma = getLast(EMA.calculate({ period: 21, values: closes }))!;
    
    const psarInput = { high: highs, low: lows, step: params.ch_psarStep!, max: params.ch_psarMax! };
    const lastPsar = psarInput.high.length >= 2 ? getLast(PSAR.calculate(psarInput)) as number | undefined : undefined;
    
    const lastAdx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.adxPeriod! }));

    return {
        lastAtr,
        lastRsi,
        swingPoint,
        fastEma,
        slowEma,
        lastPsar,
        lastAdx,
    };
}


export function getChameleonManagementSignal(
    position: Position,
    currentPrice: number,
    agentState: ChameleonAgentState | undefined,
    originalConfig: BotConfig,
): TradeManagementSignal {
    const reasons: string[] = [];
    if (!agentState || !position.peakPrice) {
        return { reasons: ['State not initialized or peak price missing'] };
    }
    
    const config = applyTimeframeSettings(originalConfig);
    const params = config.agentParams as Required<AgentParams>;

    const { lastAtr, fastEma, slowEma, lastRsi, lastPsar, lastAdx } = agentState;
    const { ch_volatilityMultiplier, ch_breathingRoomCandles } = params;
    const isLong = position.direction === 'LONG';

    // --- 1. Proactive Exit & Flip Logic ---
    const isInProfit = isLong ? currentPrice > position.entryPrice : currentPrice < position.entryPrice;
    if (isInProfit) {
        const strongReversal = isLong 
            ? (fastEma < slowEma && lastRsi < 45 && (lastAdx?.mdi ?? 0) > (lastAdx?.pdi ?? 0))
            : (fastEma > slowEma && lastRsi > 55 && (lastAdx?.pdi ?? 0) > (lastAdx?.mdi ?? 0));

        if (strongReversal) {
            reasons.push('Proactive Flip: Strong trend reversal detected.');
            return { closeAndFlipPosition: true, reasons };
        }
    }

    // --- 2. State-Based Trailing: "Stalk" vs "Hunt" mode ---
    // Phase 1: "Stalk Mode" (Breathing Room)
    if (position.candlesSinceEntry !== undefined && position.candlesSinceEntry < ch_breathingRoomCandles!) {
        const breathingRoomSL = isLong ? position.initialStopLossPrice : position.initialStopLossPrice;
        if ((isLong && breathingRoomSL > position.stopLossPrice) || (!isLong && breathingRoomSL < position.stopLossPrice)) {
            return { newStopLoss: breathingRoomSL, reasons: ['Stalk Mode: Maintaining initial stop.'] };
        }
        return { reasons: ['Stalk Mode: Awaiting trade development.'] };
    }

    // Phase 2: "Hunt Mode" (Aggressive Multi-Factor Trailing)
    if (config.isUniversalProfitTrailEnabled) {
        return { reasons: ['Universal Profit Trail is active; skipping agent-specific trail.'] };
    }

    const stopCandidates: number[] = [];
    if (lastAtr > 0 && ch_volatilityMultiplier) {
        const atrStop = isLong ? position.peakPrice - (lastAtr * ch_volatilityMultiplier) : position.peakPrice + (lastAtr * ch_volatilityMultiplier);
        stopCandidates.push(atrStop);
    }
    if (lastPsar) stopCandidates.push(lastPsar);
    
    if (stopCandidates.length === 0) return { reasons: ['No valid stop candidates found.'] };

    let bestNewStop: number | undefined;
    for (const price of stopCandidates) {
        if (isNaN(price)) continue;
        const isTighter = isLong ? price > position.stopLossPrice : price < position.stopLossPrice;
        const isSafe = isLong ? price < currentPrice : price > currentPrice;
        if (isTighter && isSafe) {
            if (bestNewStop === undefined) { bestNewStop = price; } 
            else { bestNewStop = isLong ? Math.max(bestNewStop, price) : Math.min(bestNewStop, price); }
        }
    }

    if (bestNewStop) {
        return { newStopLoss: bestNewStop, reasons: ['Hunt Mode: Adaptive trail updated.'] };
    }

    return { reasons: ['Hunt Mode: No adaptive stop update needed.'] };
}