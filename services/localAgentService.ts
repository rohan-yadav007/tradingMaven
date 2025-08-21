

import { TradingMode, type Agent, type TradeSignal, type Kline, type AgentParams, type Position, type ADXOutput, type MACDOutput, type BollingerBandsOutput, type StochasticRSIOutput, type TradeManagementSignal, type BotConfig, ChameleonAgentState } from '../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV } from 'technicalindicators';
import * as constants from '../constants';
import { calculateSupportResistance } from './chartAnalysisService';

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
    let riskRewardRatio = timeframeConfig.riskRewardRatio;

    if (agentId === 13) {
        riskRewardRatio = 10; // Use a very high R:R to set a distant, failsafe TP for the Chameleon agent
    }

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
        
        case 14: // The Sentinel: MACD reverse cross or RSI overbought/oversold
            const closes = klines.map(k => k.close);
            const rsi = getLast(RSI.calculate({ values: closes, period: config.agentParams?.rsiPeriod || 14 }))!;
            const macdInput = { values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false };
            const macd = MACD.calculate(macdInput);
            const lastMacd = getLast(macd) as MACDOutput | undefined;
            const prevMacd = getPenultimate(macd) as MACDOutput | undefined;

            if (lastMacd && prevMacd && lastMacd.MACD && lastMacd.signal && prevMacd.MACD && prevMacd.signal) {
                const isLong = position.direction === 'LONG';
                if (isLong) {
                    const bearishCross = lastMacd.MACD < lastMacd.signal && prevMacd.MACD >= prevMacd.signal;
                    const rsiOverbought = rsi > 70;
                    if (bearishCross) {
                        reasons.push('Momentum fading: MACD bearish crossover.');
                        closePosition = true;
                    }
                    if (rsiOverbought) {
                        reasons.push('Market overbought: RSI > 70.');
                        closePosition = true;
                    }
                } else { // Short position
                    const bullishCross = lastMacd.MACD > lastMacd.signal && prevMacd.MACD <= prevMacd.signal;
                    const rsiOversold = rsi < 30;
                    if (bullishCross) {
                        reasons.push('Momentum fading: MACD bullish crossover.');
                        closePosition = true;
                    }
                    if (rsiOversold) {
                        reasons.push('Market oversold: RSI < 30.');
                        closePosition = true;
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

// --- Agent 13: The Chameleon V4 (Momentum Acceleration & Profit Potential) ---
const getChameleonSignal = (klines: Kline[], params: Required<AgentParams>, config: BotConfig): TradeSignal => {
    const minKlines = Math.max(50, params.ch_atrPeriod!, params.ch_bbPeriod!, params.adxPeriod!);
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data for Chameleon analysis.'] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const lastKline = klines[klines.length - 1];
    const reasons: string[] = [];

    // --- V2: ADX Trend Strength Filter ---
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.adxPeriod! }))!;
    if (adx.adx < params.ch_adxThreshold!) {
        reasons.push(`❌ VETO: Market is not trending (ADX ${adx.adx.toFixed(1)} < ${params.ch_adxThreshold!})`);
        return { signal: 'HOLD', reasons };
    }
    reasons.push(`✅ Trend Strength: ADX is ${adx.adx.toFixed(1)}`);

    // --- Pre-Trade Volatility Veto ---
    const lastAtr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: params.ch_atrPeriod! }))!;
    const candleRange = lastKline.high - lastKline.low;
    const maxAllowedRange = lastAtr * params.ch_volatilitySpikeMultiplier!;
    if (candleRange > maxAllowedRange) {
        reasons.push(`❌ VETO: High volatility candle (Range > ${params.ch_volatilitySpikeMultiplier!}x ATR)`);
        return { signal: 'HOLD', reasons };
    }

    // --- V4: Profit Potential Veto ---
    if (config.isMinRrEnabled) {
        const timeframeConfig = constants.TIMEFRAME_ATR_CONFIG[config.timeFrame] || constants.TIMEFRAME_ATR_CONFIG['5m'];
        const stopLossDistance = lastAtr * timeframeConfig.atrMultiplier;
        const { supports, resistances } = calculateSupportResistance(klines, 10);
        const currentPrice = lastKline.close;
        
        // Bullish potential
        const nextResistance = resistances.filter(r => r > currentPrice).sort((a,b) => a - b)[0];
        if (nextResistance) {
            const profitDistance = nextResistance - currentPrice;
            if (profitDistance < stopLossDistance * constants.MIN_RISK_REWARD_RATIO) {
                reasons.push(`❌ VETO: Insufficient R:R to next resistance (< ${constants.MIN_RISK_REWARD_RATIO}:1)`);
                return { signal: 'HOLD', reasons };
            }
        }
        // Bearish potential
        const nextSupport = supports.filter(s => s < currentPrice).sort((a,b) => b-a)[0];
         if (nextSupport) {
            const profitDistance = currentPrice - nextSupport;
            if (profitDistance < stopLossDistance * constants.MIN_RISK_REWARD_RATIO) {
                reasons.push(`❌ VETO: Insufficient R:R to next support (< ${constants.MIN_RISK_REWARD_RATIO}:1)`);
                return { signal: 'HOLD', reasons };
            }
        }
        reasons.push(`✅ Profit Potential: Clear path to next S/R level.`);
    }

    // --- V2 & V4: Weighted Confluence Scoring ---
    const fastEma = getLast(EMA.calculate({ period: 9, values: closes }))!;
    const slowEma = getLast(EMA.calculate({ period: 21, values: closes }))!;
    const rsiValues = RSI.calculate({ period: params.ch_rsiPeriod!, values: closes });
    const rsi = getLast(rsiValues)!;
    const prevRsi = getPenultimate(rsiValues)!;
    const bb = getLast(BollingerBands.calculate({ period: params.ch_bbPeriod!, stdDev: params.ch_bbStdDev!, values: closes }))! as BollingerBandsOutput;
    const candlePattern = recognizeCandlestickPattern(lastKline, klines[klines.length - 2]);
    const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes }))!;

    const isBullishContext = fastEma > slowEma && adx.pdi > adx.mdi;
    const isBearishContext = fastEma < slowEma && adx.mdi > adx.pdi;

    if (isBullishContext) {
        let score = 0;
        let scoreReasons: string[] = [];

        score += 2; scoreReasons.push(`Trend Alignment (+2)`);
        if (rsi > 55) { score += 1; scoreReasons.push(`RSI Momentum (+1)`); }
        if (rsi > prevRsi) { score += 1.5; scoreReasons.push(`Momentum Accelerating (+1.5)`); } // V4
        if (lastKline.low <= bb.lower) { score += 1.5; scoreReasons.push(`BB Support Bounce (+1.5)`); }
        if (candlePattern?.type === 'bullish') { score += 2; scoreReasons.push(`Bullish Candlestick (+2)`); }
        if (getLast(volumes)! > volumeSma * params.ch_volumeMultiplier!) { score += 1; scoreReasons.push(`Volume Spike (+1)`); }

        reasons.push(`ℹ️ Bullish Score: ${score.toFixed(1)} / ${params.ch_scoreThreshold!}. Factors: ${scoreReasons.join(', ')}`);
        if (score >= params.ch_scoreThreshold!) return { signal: 'BUY', reasons };
    }

    if (isBearishContext) {
        let score = 0;
        let scoreReasons: string[] = [];

        score += 2; scoreReasons.push(`Trend Alignment (+2)`);
        if (rsi < 45) { score += 1; scoreReasons.push(`RSI Momentum (+1)`); }
        if (rsi < prevRsi) { score += 1.5; scoreReasons.push(`Momentum Accelerating (+1.5)`); } // V4
        if (lastKline.high >= bb.upper) { score += 1.5; scoreReasons.push(`BB Resistance Rejection (+1.5)`); }
        if (candlePattern?.type === 'bearish') { score += 2; scoreReasons.push(`Bearish Candlestick (+2)`); }
        if (getLast(volumes)! > volumeSma * params.ch_volumeMultiplier!) { score += 1; scoreReasons.push(`Volume Spike (+1)`); }
        
        reasons.push(`ℹ️ Bearish Score: ${score.toFixed(1)} / ${params.ch_scoreThreshold!}. Factors: ${scoreReasons.join(', ')}`);
        if (score >= params.ch_scoreThreshold!) return { signal: 'SELL', reasons };
    }

    return { signal: 'HOLD', reasons };
};


// --- Agent 14: The Sentinel (MACD-RSI Momentum Scalper) ---
const getTheSentinelSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.macdSlowPeriod, params.rsiPeriod, 20) + 1; // +1 for prevMacd
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data for The Sentinel.'] };
    }

    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);
    const reasons: string[] = [];

    // Indicators
    const macdInput = { values: closes, fastPeriod: params.macdFastPeriod, slowPeriod: params.macdSlowPeriod, signalPeriod: params.macdSignalPeriod, SimpleMAOscillator: false, SimpleMASignal: false };
    const macd = MACD.calculate(macdInput);
    const lastMacd = getLast(macd) as MACDOutput | undefined;
    const prevMacd = getPenultimate(macd) as MACDOutput | undefined;

    const rsi = getLast(RSI.calculate({ values: closes, period: params.rsiPeriod }))!;
    
    const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes }))!;
    const lastVolume = getLast(volumes)!;

    if (!lastMacd || !prevMacd || !lastMacd.MACD || !lastMacd.signal || !prevMacd.MACD || !prevMacd.signal) {
        return { signal: 'HOLD', reasons: ['ℹ️ Awaiting MACD calculation.'] };
    }
    
    // Long Entry Conditions
    const bullishCrossover = lastMacd.MACD > lastMacd.signal && prevMacd.MACD <= prevMacd.signal;
    const rsiBullish = rsi > 50;
    const volumeSpike = lastVolume > (volumeSma * 1.5);
    
    reasons.push(bullishCrossover ? '✅ MACD Bullish Crossover' : '❌ No Bullish Crossover');
    reasons.push(rsiBullish ? `✅ RSI > 50 (${rsi.toFixed(1)})` : `❌ RSI not > 50 (${rsi.toFixed(1)})`);
    reasons.push(volumeSpike ? `✅ Volume Spike Confirmed` : `❌ No Volume Spike`);

    if (bullishCrossover && rsiBullish && volumeSpike) {
        return { signal: 'BUY', reasons };
    }

    // Short Entry Conditions
    const bearishCrossover = lastMacd.MACD < lastMacd.signal && prevMacd.MACD >= prevMacd.signal;
    const rsiBearish = rsi < 50;
    
    reasons.push(bearishCrossover ? '✅ MACD Bearish Crossover' : '❌ No Bearish Crossover');
    reasons.push(rsiBearish ? `✅ RSI < 50 (${rsi.toFixed(1)})` : `❌ RSI not < 50 (${rsi.toFixed(1)})`);
    
    if (bearishCrossover && rsiBearish && volumeSpike) {
        return { signal: 'SELL', reasons };
    }

    return { signal: 'HOLD', reasons: reasons.filter(r => r.startsWith('❌')) };
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
    // Build parameters with correct precedence: Defaults -> Timeframe-Specific -> User Overrides
    let finalParams: Required<AgentParams> = { ...constants.DEFAULT_AGENT_PARAMS };

    // Apply agent-specific timeframe settings if they exist
    if (agent.id === 13) {
        const chameleonTimeframeSettings = constants.CHAMELEON_TIMEFRAME_SETTINGS[config.timeFrame] || {};
        finalParams = { ...finalParams, ...chameleonTimeframeSettings };
    }
    // Future agents can have their own settings objects added here with an `else if`

    // Apply user-specific overrides last
    finalParams = { ...finalParams, ...config.agentParams };

    let agentSignal: TradeSignal;

    switch (agent.id) {
        case 7: agentSignal = getMarketStructureMavenSignal(klines, finalParams); break;
        case 9: agentSignal = getQuantumScalperSignal(klines, finalParams); break;
        case 11: agentSignal = getHistoricExpertSignal(klines, finalParams); break;
        case 13: agentSignal = getChameleonSignal(klines, finalParams, config); break;
        case 14: agentSignal = getTheSentinelSignal(klines, finalParams); break;
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
    config: BotConfig,
    position: Position
): ChameleonAgentState {
    const params = { ...constants.DEFAULT_AGENT_PARAMS, ...config.agentParams };
    
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
    config: BotConfig,
): TradeManagementSignal {
    const reasons: string[] = [];
    if (!agentState || !position.peakPrice) {
        return { reasons: ['State not initialized or peak price missing'] };
    }

    // Build parameters with correct precedence for this specific function
    let finalParams: Required<AgentParams> = { ...constants.DEFAULT_AGENT_PARAMS };
    const chameleonTimeframeSettings = constants.CHAMELEON_TIMEFRAME_SETTINGS[config.timeFrame] || {};
    finalParams = { ...finalParams, ...chameleonTimeframeSettings };
    finalParams = { ...finalParams, ...config.agentParams };

    const { lastAtr, fastEma, slowEma, lastRsi, lastPsar, lastAdx } = agentState;
    const { ch_volatilityMultiplier, ch_breathingRoomCandles } = finalParams;
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
    if (config.isUniversalProfitTrailEnabled && !finalParams.ch_useHybridTrail) {
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