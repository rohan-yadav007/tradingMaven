

import type { Agent, TradeSignal, Kline, AgentParams, Position, ADXOutput, MACDOutput, BollingerBandsOutput, StochasticRSIOutput, TradeManagementSignal, BotConfig } from '../types';
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
    // Use support/resistance levels to set a more contextual take-profit target.
    // The lookback period for S/R is taken from agent parameters for consistency.
    const srLookback = params.msm_swingPointLookback || 15;
    const { supports, resistances } = calculateSupportResistance(klines, srLookback);

    if (isLong) {
        // Find the closest resistance level above the entry price.
        const potentialTp = resistances.filter(r => r > entryPrice).sort((a, b) => a - b)[0];
        if (potentialTp) {
            // Add a small buffer to avoid orders not filling
            const bufferedTp = potentialTp * 0.999;
            // Only use this TP if it's further than the entry price (sanity check)
            if (bufferedTp > entryPrice) {
                 suggestedTakeProfit = bufferedTp;
            }
        }
    } else { // SHORT
        // Find the closest support level below the entry price.
        const potentialTp = supports.filter(s => s < entryPrice).sort((a, b) => b - a)[0];
        if (potentialTp) {
            // Add a small buffer
            const bufferedTp = potentialTp * 1.001;
            if (bufferedTp < entryPrice) {
                suggestedTakeProfit = bufferedTp;
            }
        }
    }


    // --- Step 2: Allow specific agents to provide specialized target logic ---
    // Agent 3: Mean Reversionist targets Bollinger Bands
    if (agentId === 3) {
        const bb = BollingerBands.calculate({ period: params.mr_bbPeriod!, stdDev: params.mr_bbStdDev!, values: closes });
        const lastBb = getLast(bb) as BollingerBandsOutput | undefined;
        if (lastBb) {
            suggestedTakeProfit = lastBb.middle;
            suggestedStopLoss = isLong ? lastBb.lower * 0.998 : lastBb.upper * 1.002;
        }
    }
    // NOTE: Agent 6 (Profit Locker) partial TP logic has been removed.

    // --- Step 3: CRITICAL FINAL SAFETY CHECKS ---
    // A. Minimum percentage distance check.
    const minSlOffset = entryPrice * (MIN_STOP_LOSS_PERCENT / 100);
    const minSafeStopLoss = isLong ? entryPrice - minSlOffset : entryPrice + minSlOffset;

    // B. Choose the stop loss that MINIMIZES loss (closer to entry price).
    const finalStopLoss = isLong
        ? Math.max(suggestedStopLoss, minSafeStopLoss)
        : Math.min(suggestedStopLoss, minSafeStopLoss);

    // C. Sanity check: ensure SL and TP are on the correct sides of entry price and SL isn't through entry.
    let finalTakeProfit = suggestedTakeProfit;
    if ((isLong && finalStopLoss >= entryPrice) || (!isLong && finalStopLoss <= entryPrice)) {
        // This can happen if the calculated stop is on the wrong side of entry. Fallback to the minimum safe distance.
        return { stopLossPrice: minSafeStopLoss, takeProfitPrice: isLong ? entryPrice + minSlOffset * 2 : entryPrice - minSlOffset * 2 };
    }
    if ((isLong && finalTakeProfit <= entryPrice) || (!isLong && finalTakeProfit >= entryPrice)) {
        // TP is on wrong side. Recalculate based on the final safe SL.
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
export async function getTradeManagementSignal(
    position: Position,
    klines: Kline[],
    currentPrice: number,
    config: BotConfig
): Promise<TradeManagementSignal> {
    const { isAtrTrailingStopEnabled, agent } = config;

    // --- MASTER OVERRIDE: Universal Fee-Based Trailing Stop ---
    // If enabled, this logic takes precedence over any agent-specific exit.
    if (isAtrTrailingStopEnabled) {
        const reasons: string[] = [];
        let newStopLoss: number | undefined;
        const isLong = position.direction === 'LONG';
        const entryPrice = position.entryPrice;
        
        const positionValue = position.size * entryPrice;
        const roundTripFee = positionValue * TAKER_FEE_RATE * 2;
        const feeInPrice = roundTripFee / position.size;

        if (feeInPrice > 0) {
            const profitInPrice = (currentPrice - entryPrice) * (isLong ? 1 : -1);
            let potentialNewStop: number | undefined;

            const isStopInLoss = (isLong && position.stopLossPrice < entryPrice) || (!isLong && position.stopLossPrice > entryPrice);
            if (profitInPrice >= (feeInPrice * 2) && isStopInLoss) {
                potentialNewStop = entryPrice;
                reasons.push('Breakeven Trigger');
            }

            if (profitInPrice > 0) {
                const profitChunks = Math.floor(profitInPrice / (feeInPrice * 3));
                if (profitChunks > 0) {
                    const securedProfitInPrice = profitChunks * feeInPrice * 2;
                    const stopAtProfitLevel = entryPrice + (securedProfitInPrice * (isLong ? 1 : -1));
                    if (!potentialNewStop || (isLong && stopAtProfitLevel > potentialNewStop) || (!isLong && stopAtProfitLevel < potentialNewStop)) {
                        potentialNewStop = stopAtProfitLevel;
                        reasons.push(`Profit Lock at ${profitChunks * 2}x Fee`);
                    }
                }
            }

            if (potentialNewStop !== undefined) {
                if ((isLong && potentialNewStop > position.stopLossPrice) || (!isLong && potentialNewStop < position.stopLossPrice)) {
                    newStopLoss = potentialNewStop;
                }
            }
        }
        return { newStopLoss, reasons };
    }

    // --- AGENT-SPECIFIC MANAGEMENT (If Universal is OFF) ---
    const reasons: string[] = [];
    let newStopLoss: number | undefined;
    let closePosition: boolean | undefined;

    switch (agent.id) {
        case 4: // Scalping Expert: Exit on MACD momentum fade
            const closes = klines.map(k => k.close);
            if (closes.length > 30) {
                const macdResult = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
                const macd = getLast(macdResult) as MACDOutput | undefined;
                const prevMacd = getPenultimate(macdResult) as MACDOutput | undefined;
                if (macd?.histogram && prevMacd?.histogram) {
                    const isLong = position.direction === 'LONG';
                    const momentumFading = isLong
                        ? macd.histogram > 0 && macd.histogram < prevMacd.histogram
                        : macd.histogram < 0 && macd.histogram > prevMacd.histogram;
                    
                    if (momentumFading) {
                        closePosition = true;
                        reasons.push('Proactive Exit: MACD momentum is fading.');
                    }
                }
            }
            break;

        case 9: // Quantum Scalper: PSAR-based trailing stop
            const psarInput = { high: klines.map(k => k.high), low: klines.map(k => k.low), step: config.agentParams?.qsc_psarStep ?? 0.02, max: config.agentParams?.qsc_psarMax ?? 0.2 };
            if (psarInput.high.length >= 2) {
                const psar = PSAR.calculate(psarInput);
                const lastPsar = getLast(psar) as number | undefined;
                if (lastPsar) {
                    const isLong = position.direction === 'LONG';
                    // Only trail in the direction of the trade
                    if ((isLong && lastPsar > position.stopLossPrice) || (!isLong && lastPsar < position.stopLossPrice)) {
                        newStopLoss = lastPsar;
                        reasons.push('Agent PSAR Trail');
                    }
                }
            }
            break;
        
        default:
            // Other agents do not have proactive exit logic; they rely on their initial SL/TP.
            break;
    }
    
    return { newStopLoss, closePosition, reasons };
}


// ----------------------------------------------------------------------------------
// --- #3: AGENT-SPECIFIC ENTRY SIGNAL LOGIC ---
// These functions only decide WHEN to enter. `getInitialAgentTargets` decides SL/TP.
// ----------------------------------------------------------------------------------

// --- Agent 1: Momentum Master (Upgraded) ---
const getMomentumMasterSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.mom_emaSlowPeriod, params.adxPeriod, params.atrPeriod);
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };

    const closes = klines.map(k => k.close);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];

    const emaFast = getLast(EMA.calculate({ period: params.mom_emaFastPeriod, values: closes }))! as number;
    const emaSlow = getLast(EMA.calculate({ period: params.mom_emaSlowPeriod, values: closes }))! as number;
    reasons.push(emaFast > emaSlow ? `✅ Trend: Bullish (EMA ${params.mom_emaFastPeriod} > ${params.mom_emaSlowPeriod})` : `❌ Trend: Bearish (EMA ${params.mom_emaFastPeriod} < ${params.mom_emaSlowPeriod})`);

    const adx = getLast(ADX.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes, period: params.adxPeriod }))! as ADXOutput;
    reasons.push(adx.adx > params.adxTrendThreshold ? `✅ Trend Strength: Strong (ADX ${adx.adx.toFixed(1)} > ${params.adxTrendThreshold})` : `❌ Trend Strength: Weak (ADX ${adx.adx.toFixed(1)} < ${params.adxTrendThreshold})`);

    const rsi = getLast(RSI.calculate({ values: closes, period: params.rsiPeriod }))! as number;
    const macd = getLast(MACD.calculate({ values: closes, fastPeriod: params.macdFastPeriod, slowPeriod: params.macdSlowPeriod, signalPeriod: params.macdSignalPeriod, SimpleMAOscillator: false, SimpleMASignal: false }))! as MACDOutput;

    const atr = getLast(ATR.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes, period: params.atrPeriod }))! as number;
    const volatilityPercent = (atr / currentPrice) * 100;
    reasons.push(volatilityPercent > params.mom_atrVolatilityThreshold! ? `✅ Volatility: Active (${volatilityPercent.toFixed(2)}%)` : `❌ Volatility: Too Low (${volatilityPercent.toFixed(2)}% < ${params.mom_atrVolatilityThreshold}%)`);

    // BUY Signal
    if (emaFast > emaSlow && adx.adx > params.adxTrendThreshold && volatilityPercent > params.mom_atrVolatilityThreshold!) {
        reasons.push(rsi < params.mom_rsiThresholdBullish ? `✅ Pullback: Confirmed (RSI ${rsi.toFixed(1)} < ${params.mom_rsiThresholdBullish})` : `❌ Pullback: Not in zone (RSI ${rsi.toFixed(1)})`);
        if (rsi < params.mom_rsiThresholdBullish && macd.histogram! > 0) {
            return { signal: 'BUY', reasons };
        }
    }

    // SELL Signal
    if (emaFast < emaSlow && adx.adx > params.adxTrendThreshold && volatilityPercent > params.mom_atrVolatilityThreshold!) {
        reasons.push(rsi > params.mom_rsiThresholdBearish ? `✅ Pullback: Confirmed (RSI ${rsi.toFixed(1)} > ${params.mom_rsiThresholdBearish})` : `❌ Pullback: Not in zone (RSI ${rsi.toFixed(1)})`);
        if (rsi > params.mom_rsiThresholdBearish && macd.histogram! < 0) {
            return { signal: 'SELL', reasons };
        }
    }

    return { signal: 'HOLD', reasons };
};

// --- Agent 2: Trend Rider (Upgraded with Breakout Confirmation) ---
const getTrendRiderSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.tr_emaSlowPeriod!, params.tr_breakoutPeriod!, params.tr_volumeSmaPeriod!);
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const lastKline = klines[klines.length - 1];
    const reasons: string[] = [];

    const emaFast = getLast(EMA.calculate({ period: params.tr_emaFastPeriod!, values: closes }))! as number;
    const emaSlow = getLast(EMA.calculate({ period: params.tr_emaSlowPeriod!, values: closes }))! as number;
    const isUptrend = emaFast > emaSlow;
    reasons.push(isUptrend ? `✅ Trend: Bullish` : `❌ Trend: Bearish`);

    const volumeSma = getLast(SMA.calculate({ period: params.tr_volumeSmaPeriod!, values: volumes }))! as number;
    const isHighVolume = lastKline.volume! > volumeSma * params.tr_volumeMultiplier!;
    reasons.push(isHighVolume ? `✅ Volume: High` : `❌ Volume: Low`);

    // Breakout Confirmation Logic
    const breakoutLookback = highs.slice(-params.tr_breakoutPeriod! - 1, -1);
    const recentHigh = Math.max(...breakoutLookback);
    const recentLow = Math.min(...lows.slice(-params.tr_breakoutPeriod! - 1, -1));

    const isBreakoutUp = lastKline.close > recentHigh;
    const isBreakoutDown = lastKline.close < recentLow;
    reasons.push(isBreakoutUp ? `✅ Breakout: Price closed above recent high of ${recentHigh.toFixed(2)}` : `ℹ️ No bullish breakout`);
    reasons.push(isBreakoutDown ? `✅ Breakout: Price closed below recent low of ${recentLow.toFixed(2)}` : `ℹ️ No bearish breakout`);

    // BUY Signal: Uptrend + High Volume Breakout
    if (isUptrend && isHighVolume && isBreakoutUp) {
        return { signal: 'BUY', reasons };
    }
    // SELL Signal: Downtrend + High Volume Breakout
    if (!isUptrend && isHighVolume && isBreakoutDown) {
        return { signal: 'SELL', reasons };
    }

    return { signal: 'HOLD', reasons };
};


// --- Agent 3: Mean Reversionist (Upgraded) ---
const getMeanReversionistSignal = (klines: Kline[], params: Required<AgentParams>, htfKlines?: Kline[]): TradeSignal => {
    const minKlines = Math.max(params.mr_bbPeriod!, params.mr_adxPeriod!, params.mr_rsiPeriod!);
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };

    const closes = klines.map(k => k.close);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];

    // Safety Filter: High-Timeframe Trend
    if (htfKlines && htfKlines.length > params.mr_htfEmaPeriod!) {
        const htfEma = getLast(EMA.calculate({ period: params.mr_htfEmaPeriod!, values: htfKlines.map(k => k.close) }))! as number;
        reasons.push(htfEma !== undefined ? `ℹ️ HTF Trend EMA: ${htfEma.toFixed(2)}` : 'ℹ️ HTF data not available.');
        if (currentPrice > htfEma) reasons.push('ℹ️ HTF Bias: Bullish (Shorts disabled)');
        if (currentPrice < htfEma) reasons.push('ℹ️ HTF Bias: Bearish (Longs disabled)');
    }

    const adx = getLast(ADX.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes, period: params.mr_adxPeriod! }))! as ADXOutput;
    reasons.push(adx.adx < params.mr_adxThreshold! ? `✅ Market: Ranging (ADX ${adx.adx.toFixed(1)} < ${params.mr_adxThreshold})` : `❌ Market: Trending (ADX ${adx.adx.toFixed(1)} > ${params.mr_adxThreshold})`);
    if (adx.adx > params.mr_adxThreshold!) return { signal: 'HOLD', reasons };

    const bb = getLast(BollingerBands.calculate({ period: params.mr_bbPeriod!, stdDev: params.mr_bbStdDev!, values: closes }))! as BollingerBandsOutput;
    const prevKline = getPenultimate(klines)!;

    // BUY Signal
    const isBelowBand = prevKline.low < bb.lower;
    const isCrossingIn = currentPrice > bb.lower && prevKline.close < bb.lower;
    reasons.push(isBelowBand ? '✅ Price crossed below Lower BB' : '❌ Price did not cross Lower BB');
    reasons.push(isCrossingIn ? '✅ Price is closing back inside' : '❌ Price has not closed back inside');
    if (isBelowBand && isCrossingIn) {
        if (htfKlines) {
            const htfEma = getLast(EMA.calculate({ period: params.mr_htfEmaPeriod!, values: htfKlines.map(k => k.close) }))! as number;
            if (currentPrice < htfEma) return { signal: 'HOLD', reasons: [...reasons, '❌ VETO: Cannot Long in HTF Downtrend'] };
        }
        return { signal: 'BUY', reasons };
    }

    // SELL Signal
    const isAboveBand = prevKline.high > bb.upper;
    const isCrossingDown = currentPrice < bb.upper && prevKline.close > bb.upper;
    reasons.push(isAboveBand ? '✅ Price crossed above Upper BB' : '❌ Price did not cross Upper BB');
    reasons.push(isCrossingDown ? '✅ Price is closing back inside' : '❌ Price has not closed back inside');
    if (isAboveBand && isCrossingDown) {
        if (htfKlines) {
            const htfEma = getLast(EMA.calculate({ period: params.mr_htfEmaPeriod!, values: htfKlines.map(k => k.close) }))! as number;
            if (currentPrice > htfEma) return { signal: 'HOLD', reasons: [...reasons, '❌ VETO: Cannot Short in HTF Uptrend'] };
        }
        return { signal: 'SELL', reasons };
    }

    return { signal: 'HOLD', reasons };
};

// --- Agent 4: Scalping Expert (Upgraded with Precision Trigger) ---
const getScalpingExpertSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = 50;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };
    
    const closes = klines.map(k => k.close);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];
    let bullishScore = 0;
    let bearishScore = 0;

    // Condition 1: Trend (EMA)
    const emaFast = getLast(EMA.calculate({ period: params.se_emaFastPeriod!, values: closes }))! as number;
    const emaSlow = getLast(EMA.calculate({ period: params.se_emaSlowPeriod!, values: closes }))! as number;
    const isUptrend = emaFast > emaSlow;
    const isDowntrend = emaFast < emaSlow;
    reasons.push(isUptrend ? '✅ Trend: Up' : isDowntrend ? '✅ Trend: Down' : '❌ Trend: Sideways');

    // Condition 2: Momentum (MACD)
    const macdResult = MACD.calculate({ values: closes, fastPeriod: params.se_macdFastPeriod!, slowPeriod: params.se_macdSlowPeriod!, signalPeriod: params.se_macdSignalPeriod!, SimpleMAOscillator: false, SimpleMASignal: false });
    const macd = getLast(macdResult)! as MACDOutput;
    const prevMacd = getPenultimate(macdResult)! as MACDOutput;
    const isMacdBullish = macd.MACD! > macd.signal! && macd.histogram! > 0;
    const isMacdBearish = macd.MACD! < macd.signal! && macd.histogram! < 0;
    const isMacdCrossUp = macd.histogram! > 0 && prevMacd.histogram! <= 0;
    const isMacdCrossDown = macd.histogram! < 0 && prevMacd.histogram! >= 0;
    reasons.push(isMacdBullish ? '✅ MACD: Bullish' : isMacdBearish ? '✅ MACD: Bearish' : '❌ MACD: Neutral');

    // Condition 3: Pullback/Exhaustion (RSI)
    const rsi = getLast(RSI.calculate({ period: params.se_rsiPeriod!, values: closes }))! as number;
    const isRsiBullish = rsi > 50 && rsi < params.se_rsiOverbought!;
    const isRsiBearish = rsi < 50 && rsi > params.se_rsiOversold!;
    reasons.push(isRsiBullish ? '✅ RSI: Bullish Zone' : isRsiBearish ? '✅ RSI: Bearish Zone' : '❌ RSI: Out of zone');

    // Condition 4: Volatility (ATR)
    const atr = getLast(ATR.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes, period: params.se_atrPeriod! }))! as number;
    const volatilityPercent = (atr / currentPrice) * 100;
    const isVolatile = volatilityPercent > params.se_atrVolatilityThreshold!;
    reasons.push(isVolatile ? `✅ Volatility: Active (${volatilityPercent.toFixed(2)}%)` : `❌ Volatility: Too Low`);
    
    // Calculate Bullish Score
    if (isUptrend) bullishScore++;
    if (isMacdBullish) bullishScore++;
    if (isRsiBullish) bullishScore++;
    if (isVolatile) bullishScore++;
    reasons.push(`ℹ️ Bullish Score: ${bullishScore}/${params.se_scoreThreshold}`);
    
    // Final Bullish Trigger
    if (bullishScore >= params.se_scoreThreshold! && isMacdCrossUp) {
        reasons.push('🔥 TRIGGER: MACD Histogram crossed up.');
        return { signal: 'BUY', reasons };
    }

    // Calculate Bearish Score
    if (isDowntrend) bearishScore++;
    if (isMacdBearish) bearishScore++;
    if (isRsiBearish) bearishScore++;
    if (isVolatile) bearishScore++;
    reasons.push(`ℹ️ Bearish Score: ${bearishScore}/${params.se_scoreThreshold}`);

    // Final Bearish Trigger
    if (bearishScore >= params.se_scoreThreshold! && isMacdCrossDown) {
        reasons.push('🔥 TRIGGER: MACD Histogram crossed down.');
        return { signal: 'SELL', reasons };
    }

    return { signal: 'HOLD', reasons };
};

// --- Agent 5: Market Ignition (Upgraded) ---
const getMarketIgnitionSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.mi_bbPeriod!, params.mi_volumeLookback!, params.mi_emaBiasPeriod!);
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };

    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];

    // Directional Bias Filter
    const emaBias = getLast(EMA.calculate({ period: params.mi_emaBiasPeriod!, values: closes }))! as number;
    const isBullishBias = currentPrice > emaBias;
    const isBearishBias = currentPrice < emaBias;
    reasons.push(isBullishBias ? `✅ Bias: Bullish (Price > EMA${params.mi_emaBiasPeriod})` : `❌ Bias: Bearish (Price < EMA${params.mi_emaBiasPeriod})`);
    
    // Squeeze Detection
    const bb = BollingerBands.calculate({ period: params.mi_bbPeriod!, stdDev: params.mi_bbStdDev!, values: closes }) as BollingerBandsOutput[];
    const bbWidth = bb.map(b => (b.upper - b.lower) / b.middle);
    const inSqueeze = getLast(bbWidth)! < params.mi_bbwSqueezeThreshold!;
    reasons.push(inSqueeze ? `✅ Squeeze: Detected (BBW < ${params.mi_bbwSqueezeThreshold})` : `❌ Squeeze: Not detected`);
    if (!inSqueeze) return { signal: 'HOLD', reasons };

    // Breakout Confirmation
    const lastKline = getLast(klines)!;
    const isBreakoutCandle = lastKline.close > lastKline.open;
    const volumeSma = getLast(SMA.calculate({ period: params.mi_volumeLookback!, values: volumes }))! as number;
    const isVolumeSpike = lastKline.volume! > volumeSma * params.mi_volumeMultiplier!;
    reasons.push(isVolumeSpike ? `✅ Breakout Volume: High` : `❌ Breakout Volume: Low`);
    
    // BUY Signal
    if (isBullishBias && isBreakoutCandle && isVolumeSpike) {
        return { signal: 'BUY', reasons };
    }
    // SELL Signal
    if (isBearishBias && !isBreakoutCandle && isVolumeSpike) {
        return { signal: 'SELL', reasons };
    }

    return { signal: 'HOLD', reasons };
};


// --- Agent 7: Market Structure Maven (Upgraded with Volatility Adaptation) ---
const getMarketStructureMavenSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.msm_htfEmaPeriod!, params.atrPeriod);
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };
    
    const closes = klines.map(k => k.close);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];

    // Trend Bias
    const emaBias = getLast(EMA.calculate({ period: params.msm_htfEmaPeriod!, values: closes }))! as number;
    const isBullishBias = currentPrice > emaBias;
    reasons.push(isBullishBias ? `✅ Bias: Bullish` : `✅ Bias: Bearish`);

    // Get S/R levels
    const { supports, resistances } = calculateSupportResistance(klines, params.msm_swingPointLookback);
    
    // Volatility-adaptive zone
    const atr = getLast(ATR.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes, period: params.atrPeriod }))! as number;
    const proximityZone = atr * 0.5; // Zone is 50% of ATR

    // BUY Signal: Price pulls back to a significant support level in an uptrend
    if (isBullishBias && supports.length > 0) {
        const closestSupport = supports[0];
        const isNearSupport = Math.abs(currentPrice - closestSupport) <= proximityZone;
        reasons.push(isNearSupport ? `✅ Price in support zone (${(proximityZone).toFixed(4)}) near ${closestSupport.toFixed(2)}` : `❌ Price not near key support`);
        if (isNearSupport) return { signal: 'BUY', reasons };
    }

    // SELL Signal: Price pulls back to a significant resistance level in a downtrend
    if (!isBullishBias && resistances.length > 0) {
        const closestResistance = resistances[0];
        const isNearResistance = Math.abs(currentPrice - closestResistance) <= proximityZone;
        reasons.push(isNearResistance ? `✅ Price in resistance zone (${(proximityZone).toFixed(4)}) near ${closestResistance.toFixed(2)}` : `❌ Price not near key resistance`);
        if (isNearResistance) return { signal: 'SELL', reasons };
    }

    return { signal: 'HOLD', reasons };
};

// --- Agent 9: Quantum Scalper (FIXED LOGIC) ---
const getQuantumScalperSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = 50;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };
    
    const closes = klines.map(k => k.close);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];
    
    // --- Regime Detection ---
    const emaFast = getLast(EMA.calculate({ period: params.qsc_fastEmaPeriod!, values: closes }))! as number;
    const emaSlow = getLast(EMA.calculate({ period: params.qsc_slowEmaPeriod!, values: closes }))! as number;
    const adx = getLast(ADX.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes, period: params.qsc_adxPeriod! }))! as ADXOutput;
    const isTrending = adx.adx > params.qsc_adxThreshold!;
    reasons.push(isTrending ? `ℹ️ Regime: Trending (ADX ${adx.adx.toFixed(1)})` : `ℹ️ Regime: Ranging (ADX ${adx.adx.toFixed(1)})`);
    
    // --- Shared Indicators ---
    const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: params.qsc_stochRsiPeriod!, stochasticPeriod: params.qsc_stochRsiPeriod!, kPeriod: 3, dPeriod: 3 }))! as StochasticRSIOutput;
    
    if (isTrending) {
        // --- Trending Logic ---
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

        // Bullish Confluence
        if (isUptrend) bullishScore++;
        if (isStochBullish) bullishScore++;
        if (isAdxBullish) bullishScore++;
        reasons.push(`ℹ️ Bullish Score: ${bullishScore}/${params.qsc_trendScoreThreshold!}`);

        if (bullishScore >= params.qsc_trendScoreThreshold!) {
            return { signal: 'BUY', reasons };
        }

        // Bearish Confluence
        if (isDowntrend) bearishScore++;
        if (isStochBearish) bearishScore++;
        if (isAdxBearish) bearishScore++;
        reasons.push(`ℹ️ Bearish Score: ${bearishScore}/${params.qsc_trendScoreThreshold!}`);

        if (bearishScore >= params.qsc_trendScoreThreshold!) {
            return { signal: 'SELL', reasons };
        }

    } else {
        // --- Ranging (Mean Reversion) Logic ---
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


// ----------------------------------------------------------------------------------
// --- #4: MAIN ORCHESTRATOR & HELPERS ---
// ----------------------------------------------------------------------------------

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
        case 1: agentSignal = getMomentumMasterSignal(klines, finalParams); break;
        case 2: agentSignal = getTrendRiderSignal(klines, finalParams); break;
        case 3: agentSignal = getMeanReversionistSignal(klines, finalParams, htfKlines); break;
        case 4: agentSignal = getScalpingExpertSignal(klines, finalParams); break;
        case 5: agentSignal = getMarketIgnitionSignal(klines, finalParams); break;
        case 7: agentSignal = getMarketStructureMavenSignal(klines, finalParams); break;
        case 9: agentSignal = getQuantumScalperSignal(klines, finalParams); break;
        default:
            return { signal: 'HOLD', reasons: ['Agent not found'] };
    }

    // --- Universal HTF Confirmation Filter ---
    // Apply this filter to all agents except those with their own specific HTF logic (like Agent 3).
    if (config.isHtfConfirmationEnabled && htfKlines && htfKlines.length > 50 && agent.id !== 3) {
        if (agentSignal.signal !== 'HOLD') {
            const htfEmaPeriod = 50; // A robust period for HTF trend direction.
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

export const analyzeTrendExhaustion = (klines: Kline[], direction: 'LONG' | 'SHORT'): { veto: boolean, reasons: string[] } => {
    const closes = klines.map(k => k.close);
    const rsi = getLast(RSI.calculate({ values: closes, period: 14 })) as number | undefined;
    const reasons: string[] = [];
    let veto = false;

    if (direction === 'LONG' && rsi && rsi > 75) {
        reasons.push(`RSI is high (${rsi.toFixed(1)} > 75)`);
        veto = true;
    }
    if (direction === 'SHORT' && rsi && rsi < 25) {
        reasons.push(`RSI is low (${rsi.toFixed(1)} < 25)`);
        veto = true;
    }

    return { veto, reasons };
}