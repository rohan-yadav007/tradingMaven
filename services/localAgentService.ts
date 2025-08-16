import { TradingMode, type Agent, type TradeSignal, type Kline, type AgentParams, type Position, type ADXOutput, type MACDOutput, type BollingerBandsOutput, type StochasticRSIOutput, type TradeManagementSignal, type BotConfig } from '../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV } from 'technicalindicators';
import * as constants from '../constants';
import { calculateSupportResistance } from './chartAnalysisService';
import * as binanceService from './binanceService';

// --- HELPERS ---
const getLast = <T>(arr: T[] | undefined): T | undefined => arr && arr.length > 0 ? arr[arr.length - 1] : undefined;
const getPenultimate = <T>(arr: T[] | undefined): T | undefined => arr && arr.length > 1 ? arr[arr.length - 2] : undefined;

const MIN_STOP_LOSS_PERCENT = 0.5; // Minimum 0.5% SL distance from entry price.
const { TIMEFRAME_ATR_CONFIG, TAKER_FEE_RATE } = constants;


// ----------------------------------------------------------------------------------
// --- #1: INITIAL TARGET CALCULATION (SL/TP) - THE CORE RISK FIX ---
// This is the single source of truth for setting initial trade targets.
// ----------------------------------------------------------------------------------
export const getInitialAgentTargets = (
    klines: Kline[],
    entryPrice: number,
    direction: 'LONG' | 'SHORT',
    timeFrame: string,
    params: Required<AgentParams>,
    agentId: number
): { stopLossPrice: number; takeProfitPrice: number; } => {

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
    const atrMultiplier = timeframeConfig.atrMultiplier;
    const riskRewardRatio = timeframeConfig.riskRewardRatio;
    const atrStopOffset = currentAtr * atrMultiplier;

    let suggestedStopLoss = isLong ? entryPrice - atrStopOffset : entryPrice + atrStopOffset;
    let suggestedTakeProfit = isLong ? entryPrice + (atrStopOffset * riskRewardRatio) : entryPrice - (atrStopOffset * riskRewardRatio);

    // --- S/R Based Take Profit ---
    const srLookback = params.msm_swingPointLookback || 15;
    const { supports, resistances } = calculateSupportResistance(klines, srLookback);

    if (isLong) {
        const potentialTp = resistances.filter(r => r > entryPrice).sort((a, b) => a - b)[0];
        if (potentialTp) {
            const bufferedTp = potentialTp * 0.999;
            if (bufferedTp > entryPrice) {
                 suggestedTakeProfit = bufferedTp;
            }
        }
    } else { // SHORT
        const potentialTp = supports.filter(s => s < entryPrice).sort((a, b) => b - a)[0];
        if (potentialTp) {
            const bufferedTp = potentialTp * 1.001;
            if (bufferedTp < entryPrice) {
                suggestedTakeProfit = bufferedTp;
            }
        }
    }


    // --- Step 3: CRITICAL FINAL SAFETY CHECKS ---
    const minSlOffset = entryPrice * (MIN_STOP_LOSS_PERCENT / 100);
    const minSafeStopLoss = isLong ? entryPrice - minSlOffset : entryPrice + minSlOffset;

    const finalStopLoss = isLong
        ? Math.min(suggestedStopLoss, minSafeStopLoss)
        : Math.max(suggestedStopLoss, minSafeStopLoss);

    let finalTakeProfit = suggestedTakeProfit;
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
// This is now split into two specialized functions for performance and clarity.
// ----------------------------------------------------------------------------------

/**
 * Calculates a potential new Stop Loss based on the Universal Profit Trail logic.
 * This is a lightweight function designed to be called on every price tick.
 * @param position - The current open position.
 * @param currentPrice - The live price tick.
 * @param config - The bot's configuration.
 * @returns A TradeManagementSignal with a potential new stop loss.
 */
export function getUniversalProfitTrailSignal(
    position: Position,
    currentPrice: number,
    config: BotConfig
): TradeManagementSignal {
    const reasons: string[] = [];
    let newStopLoss: number | undefined;
    const isLong = position.direction === 'LONG';
    const entryPrice = position.entryPrice;

    // Calculate the price distance required to cover round-trip fees
    const positionValue = position.size * entryPrice;
    const roundTripFee = positionValue * TAKER_FEE_RATE * 2;
    const feeInPrice = (roundTripFee / position.size);
    const feeAdjustedBreakeven = entryPrice + (feeInPrice * (isLong ? 1 : -1));

    if (feeInPrice > 0) {
        const profitInPrice = (currentPrice - entryPrice) * (isLong ? 1 : -1);
        let potentialNewStop: number | undefined;

        // Condition 1: Move SL to a fee-adjusted "Breakeven+" point.
        // This ensures if the stop is hit, the trade PNL is ~0 after fees.
        const isStopInLoss = (isLong && position.stopLossPrice < entryPrice) || (!isLong && position.stopLossPrice > entryPrice);
        // Trigger when profit gives a buffer (e.g., 2x the fee cost)
        if (profitInPrice >= (feeInPrice * 2) && isStopInLoss) {
            potentialNewStop = feeAdjustedBreakeven;
            reasons.push('Breakeven+ Trigger');
        }

        // Condition 2: Trail the profit by locking in a percentage of unrealized gains.
        const TRAIL_START_THRESHOLD_MULTIPLIER = 3; // Start trailing when profit is 3x the fee cost.
        const PROFIT_LOCK_IN_PERCENT = 0.50; // Lock in 50% of unrealized profit.
        
        // This logic engages only after profit significantly clears the fee threshold.
        if (profitInPrice > feeInPrice * TRAIL_START_THRESHOLD_MULTIPLIER) {
            const profitToLock = profitInPrice * PROFIT_LOCK_IN_PERCENT;
            const stopAtProfitLevel = entryPrice + (profitToLock * (isLong ? 1 : -1));
            
            // The current candidate for the new stop is either the one from the breakeven logic (if triggered on this tick)
            // or the existing stop loss from the position state.
            const currentCandidateStop = potentialNewStop ?? position.stopLossPrice;

            // Only update if the new proposed stop is an improvement over the current candidate.
            if ((isLong && stopAtProfitLevel > currentCandidateStop) || (!isLong && stopAtProfitLevel < currentCandidateStop)) {
                potentialNewStop = stopAtProfitLevel;
                // If the reason array doesn't already have the breakeven trigger, add the profit trail reason.
                if (!reasons.includes('Breakeven+ Trigger')) {
                    reasons.push(`Profit Trail Lock`);
                }
            }
        }
        
        // Final check: Only propose an update if the new stop is a strict improvement over the last known stop.
        if (potentialNewStop !== undefined) {
            if ((isLong && potentialNewStop > position.stopLossPrice) || (!isLong && potentialNewStop < position.stopLossPrice)) {
                newStopLoss = potentialNewStop;
            }
        }
    }
    return { newStopLoss, reasons };
}


/**
 * Calculates a potential new Stop Loss based on agent-specific, indicator-based logic (e.g., PSAR).
 * This is a heavier function designed to be called only on candle closes.
 * @param position - The current open position.
 * @param klines - The historical klines needed for indicator calculation.
 * @param currentPrice - The price at the time of the candle close.
 * @param config - The bot's configuration.
 * @returns A TradeManagementSignal.
 */
export function getAgentExitSignal(
    position: Position,
    klines: Kline[],
    currentPrice: number,
    config: BotConfig
): TradeManagementSignal {
    const { agent } = config;
    const reasons: string[] = [];
    let newStopLoss: number | undefined;
    let closePosition: boolean | undefined;

    switch (agent.id) {
        case 9: // Quantum Scalper: PSAR-based trailing stop
            const psarInput = { high: klines.map(k => k.high), low: klines.map(k => k.low), step: config.agentParams?.qsc_psarStep ?? 0.02, max: config.agentParams?.qsc_psarMax ?? 0.2 };
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

// --- Agent 9: Quantum Scalper (Core Logic with Chop Filter) ---
const getQuantumScalperSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = 50;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };
    
    const closes = klines.map(k => k.close);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];
    
    const adx = getLast(ADX.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes, period: params.qsc_adxPeriod! }))! as ADXOutput;

    // --- Chop Zone Filter ---
    const chopBuffer = params.qsc_adxChopBuffer!;
    const adxThreshold = params.qsc_adxThreshold!;
    const lowerChop = adxThreshold - chopBuffer;
    const upperChop = adxThreshold + chopBuffer;
    const isChoppy = adx.adx > lowerChop && adx.adx < upperChop;

    if (isChoppy) {
        reasons.push(`❌ VETO: Market is choppy (ADX ${adx.adx.toFixed(1)} in ${lowerChop}-${upperChop} zone)`);
        return { signal: 'HOLD', reasons };
    }
    
    const emaFast = getLast(EMA.calculate({ period: params.qsc_fastEmaPeriod!, values: closes }))! as number;
    const emaSlow = getLast(EMA.calculate({ period: params.qsc_slowEmaPeriod!, values: closes }))! as number;
    const isTrending = adx.adx > adxThreshold;
    reasons.push(isTrending ? `ℹ️ Regime: Trending (ADX ${adx.adx.toFixed(1)})` : `ℹ️ Regime: Ranging (ADX ${adx.adx.toFixed(1)})`);
    
    const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: params.qsc_stochRsiPeriod!, stochasticPeriod: params.qsc_stochRsiPeriod!, kPeriod: 3, dPeriod: 3 }))! as StochasticRSIOutput;
    
    if (isTrending) {
        let bullishScore = 0;
        let bearishScore = 0;

        const isUptrend = emaFast > emaSlow;
        const isDowntrend = emaFast < emaSlow;
        reasons.push(isUptrend ? '✅ Trend: Up' : isDowntrend ? '✅ Trend: Down' : 'ℹ️ Trend: Neutral');
        
        const isStochBullish = stochRsi.k > stochRsi.d;
        const isStochBearish = stochRsi.k < stochRsi.d;
        reasons.push(isStochBullish ? '✅ Momentum: Bullish' : isStochBearish ? '✅ Momentum: Bearish' : 'ℹ️ Momentum: Neutral');

        const isAdxBullish = adx.pdi > adx.mdi;
        const isAdxBearish = adx.mdi > adx.pdi;
        reasons.push(isAdxBullish ? '✅ Strength: Bulls in control' : isAdxBearish ? '✅ Strength: Bears in control' : 'ℹ️ Strength: Indecisive');

        if (isUptrend) bullishScore++;
        if (isStochBullish) bullishScore++;
        if (isAdxBullish) bullishScore++;
        reasons.push(`ℹ️ Bullish Score: ${bullishScore}/${params.qsc_trendScoreThreshold!}`);

        if (bullishScore >= params.qsc_trendScoreThreshold!) {
            return { signal: 'BUY', reasons };
        }

        if (isDowntrend) bearishScore++;
        if (isStochBearish) bearishScore++;
        if (isAdxBearish) bearishScore++;
        reasons.push(`ℹ️ Bearish Score: ${bearishScore}/${params.qsc_trendScoreThreshold!}`);

        if (bearishScore >= params.qsc_trendScoreThreshold!) {
            return { signal: 'SELL', reasons };
        }

    } else { // Ranging
        let bullishScore = 0;
        let bearishScore = 0;

        const bb = getLast(BollingerBands.calculate({ period: params.qsc_bbPeriod!, stdDev: params.qsc_bbStdDev!, values: closes }))! as BollingerBandsOutput;
        
        const isPriceOversold = currentPrice < bb.lower;
        const isStochOversold = stochRsi.stochRSI < params.qsc_stochRsiOversold!;
        reasons.push(isPriceOversold ? '✅ Price: Below Lower BB' : 'ℹ️ Price: Not below Lower BB');
        reasons.push(isStochOversold ? `✅ StochRSI: Oversold (<${params.qsc_stochRsiOversold!})` : 'ℹ️ StochRSI: Not Oversold');
        
        if (isPriceOversold) bullishScore++;
        if (isStochOversold) bullishScore++;
        reasons.push(`ℹ️ Reversal Buy Score: ${bullishScore}/${params.qsc_rangeScoreThreshold!}`);

        if (bullishScore >= params.qsc_rangeScoreThreshold!) {
            return { signal: 'BUY', reasons };
        }

        const isPriceOverbought = currentPrice > bb.upper;
        const isStochOverbought = stochRsi.stochRSI > params.qsc_stochRsiOverbought!;
        reasons.push(isPriceOverbought ? '✅ Price: Above Upper BB' : 'ℹ️ Price: Not above Upper BB');
        reasons.push(isStochOverbought ? `✅ StochRSI: Overbought (>${params.qsc_stochRsiOverbought!})` : 'ℹ️ StochRSI: Not Overbought');

        if (isPriceOverbought) bearishScore++;
        if (isStochOverbought) bearishScore++;
        reasons.push(`ℹ️ Reversal Sell Score: ${bearishScore}/${params.qsc_rangeScoreThreshold!}`);

        if (bearishScore >= params.qsc_rangeScoreThreshold!) {
            return { signal: 'SELL', reasons };
        }
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

// ----------------------------------------------------------------------------------
// --- #4: MAIN ORCHESTRATOR & HELPERS ---
// ----------------------------------------------------------------------------------

export function validateTradeProfitability(
    entryPrice: number,
    stopLossPrice: number,
    takeProfitPrice: number,
    direction: 'LONG' | 'SHORT',
    config: BotConfig
): { isValid: boolean, reason: string } {

    // 1. Risk-to-Reward Check
    const riskDistance = Math.abs(entryPrice - stopLossPrice);
    const rewardDistance = Math.abs(takeProfitPrice - entryPrice);

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

    // 2. Fee-Awareness Check
    const positionValue = config.mode === TradingMode.USDSM_Futures 
        ? config.investmentAmount * config.leverage 
        : config.investmentAmount;
        
    const tradeSize = positionValue / entryPrice;
    if (tradeSize <= 0) return { isValid: true, reason: '' }; 

    const roundTripFee = positionValue * constants.TAKER_FEE_RATE * 2;
    const feeInPrice = roundTripFee / tradeSize;
    const minProfitDistance = feeInPrice * constants.MIN_PROFIT_BUFFER_MULTIPLIER;

    if (rewardDistance < minProfitDistance) {
        return {
            isValid: false,
            reason: `❌ VETO: Profit target is within the fee zone (Target: ${rewardDistance.toFixed(config.pricePrecision)}, Min Required: ${minProfitDistance.toFixed(config.pricePrecision)}).`
        };
    }

    return { isValid: true, reason: `✅ Profitability checks passed.` };
}


export async function getTradingSignal(
    agent: Agent, 
    klines: Kline[], 
    config: BotConfig, 
    htfKlines?: Kline[]
): Promise<TradeSignal> {
    const timeframeAdaptiveParams = constants.TIMEFRAME_ADAPTIVE_SETTINGS[config.timeFrame] || {};
    const finalParams: Required<AgentParams> = { ...constants.DEFAULT_AGENT_PARAMS, ...timeframeAdaptiveParams, ...config.agentParams };

    let agentSignal: TradeSignal;

    switch (agent.id) {
        case 7: agentSignal = getMarketStructureMavenSignal(klines, finalParams); break;
        case 9: agentSignal = getQuantumScalperSignal(klines, finalParams); break;
        case 11: agentSignal = getHistoricExpertSignal(klines, finalParams); break;
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