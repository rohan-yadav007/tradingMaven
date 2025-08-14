

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
    const { isAtrTrailingStopEnabled } = config;
    const reasons: string[] = [];
    let newStopLoss: number | undefined;

    // --- Universal Fee-Based Trailing Stop (High Priority) ---
    if (isAtrTrailingStopEnabled) {
        const isLong = position.direction === 'LONG';
        const entryPrice = position.entryPrice;
        
        // 1. Calculate the price-equivalent of the round-trip trading fee
        const positionValue = position.size * entryPrice; // This includes leverage
        const roundTripFee = positionValue * TAKER_FEE_RATE * 2;
        const feeInPrice = roundTripFee / position.size;

        if (feeInPrice > 0) {
             // 2. Calculate current profit in terms of price movement
            const profitInPrice = (currentPrice - entryPrice) * (isLong ? 1 : -1);
            let potentialNewStop: number | undefined;

            // 3. Breakeven Trigger: If profit covers 2x fee and SL is still in loss territory
            const isStopInLoss = (isLong && position.stopLossPrice < entryPrice) || (!isLong && position.stopLossPrice > entryPrice);
            if (profitInPrice >= (feeInPrice * 2) && isStopInLoss) {
                potentialNewStop = entryPrice;
                reasons.push('Breakeven Trigger');
            }

            // 4. Profit-Securing "Ratchet" Trigger
            // For every multiple of 3x fee in profit, secure 2x fee
            if (profitInPrice > 0) {
                // Calculate how many "3x fee" chunks of profit we have
                const profitChunks = Math.floor(profitInPrice / (feeInPrice * 3));
                
                if (profitChunks > 0) {
                    // Calculate the amount of profit to lock in
                    const securedProfitInPrice = profitChunks * feeInPrice * 2;
                    const stopAtProfitLevel = entryPrice + (securedProfitInPrice * (isLong ? 1 : -1));

                    // If this new stop is better than the current one (or the breakeven one we just calculated), use it.
                    if (!potentialNewStop || (isLong && stopAtProfitLevel > potentialNewStop) || (!isLong && stopAtProfitLevel < potentialNewStop)) {
                        potentialNewStop = stopAtProfitLevel;
                        reasons.push(`Profit Lock at ${profitChunks * 2}x Fee`);
                    }
                }
            }

            // 5. Final check: never move stop-loss backwards
            if (potentialNewStop !== undefined) {
                if ((isLong && potentialNewStop > position.stopLossPrice) || (!isLong && potentialNewStop < position.stopLossPrice)) {
                    newStopLoss = potentialNewStop;
                }
            }
        }

    }
    // --- Agent-Specific Trails (Only run if Universal is OFF) ---
    else if (config.agent.id === 9) {
        // This is the original logic. Agent 9 has a special exit.
        const psarInput = { high: klines.map(k => k.high), low: klines.map(k => k.low), step: config.agentParams?.qsc_psarStep ?? 0.02, max: config.agentParams?.qsc_psarMax ?? 0.2 };
        if (psarInput.high.length >= 2) {
            const psar = PSAR.calculate(psarInput);
            const lastPsar = getLast(psar) as number | undefined;
            if (lastPsar) {
                newStopLoss = lastPsar;
                reasons.push('Agent PSAR Trail');
            }
        }
    }
    
    return { newStopLoss, reasons };
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

// --- Agent 2: Trend Rider (Upgraded) ---
const getTrendRiderSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.tr_emaSlowPeriod, params.tr_volumeSmaPeriod!);
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };

    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);
    const reasons: string[] = [];

    const emaFast = getLast(EMA.calculate({ period: params.tr_emaFastPeriod!, values: closes }))! as number;
    const emaSlow = getLast(EMA.calculate({ period: params.tr_emaSlowPeriod!, values: closes }))! as number;
    reasons.push(emaFast > emaSlow ? `✅ Trend: Bullish` : `❌ Trend: Bearish`);

    const adx = getLast(ADX.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes, period: params.adxPeriod }))! as ADXOutput;
    reasons.push(adx.adx > params.adxTrendThreshold ? `✅ Trend Strength: Strong (ADX ${adx.adx.toFixed(1)})` : `❌ Trend Strength: Weak (ADX ${adx.adx.toFixed(1)})`);

    const volumeSma = getLast(SMA.calculate({ period: params.tr_volumeSmaPeriod!, values: volumes }))! as number;
    const currentVolume = getLast(volumes)!;
    reasons.push(currentVolume > volumeSma * params.tr_volumeMultiplier! ? `✅ Volume: High (${(currentVolume / volumeSma).toFixed(1)}x)` : `❌ Volume: Low`);

    const rsi = getLast(RSI.calculate({ values: closes, period: params.rsiPeriod }))! as number;
    reasons.push(rsi > params.tr_rsiMomentumBullish! || rsi < params.tr_rsiMomentumBearish! ? `✅ Momentum: Strong (RSI ${rsi.toFixed(1)})` : `❌ Momentum: Weak`);

    // BUY Signal
    if (emaFast > emaSlow && adx.adx > params.adxTrendThreshold && rsi > params.tr_rsiMomentumBullish! && currentVolume > volumeSma * params.tr_volumeMultiplier!) {
        return { signal: 'BUY', reasons };
    }
    // SELL Signal
    if (emaFast < emaSlow && adx.adx > params.adxTrendThreshold && rsi < params.tr_rsiMomentumBearish! && currentVolume > volumeSma * params.tr_volumeMultiplier!) {
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

// --- Agent 4: Scalping Expert (Upgraded) ---
const getScalpingExpertSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = 50;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };
    
    const closes = klines.map(k => k.close);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];
    let score = 0;

    // Condition 1: Trend (EMA)
    const emaFast = getLast(EMA.calculate({ period: params.se_emaFastPeriod!, values: closes }))! as number;
    const emaSlow = getLast(EMA.calculate({ period: params.se_emaSlowPeriod!, values: closes }))! as number;
    const isUptrend = emaFast > emaSlow;
    const isDowntrend = emaFast < emaSlow;
    reasons.push(isUptrend ? '✅ Trend: Up' : isDowntrend ? '✅ Trend: Down' : '❌ Trend: Sideways');

    // Condition 2: Momentum (MACD)
    const macd = getLast(MACD.calculate({ values: closes, fastPeriod: params.se_macdFastPeriod!, slowPeriod: params.se_macdSlowPeriod!, signalPeriod: params.se_macdSignalPeriod!, SimpleMAOscillator: false, SimpleMASignal: false }))! as MACDOutput;
    const isMacdBullish = macd.MACD! > macd.signal! && macd.histogram! > 0;
    const isMacdBearish = macd.MACD! < macd.signal! && macd.histogram! < 0;
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
    
    // Calculate Score & Signal
    if (isUptrend) score++;
    if (isMacdBullish) score++;
    if (isRsiBullish) score++;
    if (isVolatile) score++;
    reasons.push(`ℹ️ Bullish Score: ${score}/${params.se_scoreThreshold}`);
    if (isUptrend && isMacdBullish && isRsiBullish && isVolatile && score >= params.se_scoreThreshold!) {
        return { signal: 'BUY', reasons };
    }

    score = 0;
    if (isDowntrend) score++;
    if (isMacdBearish) score++;
    if (isRsiBearish) score++;
    if (isVolatile) score++;
    reasons.push(`ℹ️ Bearish Score: ${score}/${params.se_scoreThreshold}`);
    if (isDowntrend && isMacdBearish && isRsiBearish && isVolatile && score >= params.se_scoreThreshold!) {
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

// --- Agent 6: Profit Locker (uses its structure-based TP logic) ---
// The entry logic is similar to the old scalper. The exit logic is its key feature.
const getProfitLockerSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    // This agent's primary feature was its market-structure TP, which has been removed.
    // It now functions as a standard scalper, using Trend Rider logic for entry.
    return getTrendRiderSignal(klines, params);
};


// --- Agent 7: Market Structure Maven (Upgraded) ---
const getMarketStructureMavenSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = params.msm_htfEmaPeriod!;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };
    
    const closes = klines.map(k => k.close);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];

    // Trend Bias
    const emaBias = getLast(EMA.calculate({ period: params.msm_htfEmaPeriod!, values: closes }))! as number;
    const isBullishBias = currentPrice > emaBias;
    reasons.push(isBullishBias ? `✅ Bias: Bullish` : `✅ Bias: Bearish`);

    // Get S/R levels from the chart analysis service (now with volume scoring)
    const { supports, resistances } = calculateSupportResistance(klines, params.msm_swingPointLookback);
    
    // BUY Signal: Price pulls back to a significant support level in an uptrend
    if (isBullishBias && supports.length > 0) {
        const closestSupport = supports[0]; // Highest scored support
        const isNearSupport = Math.abs(currentPrice - closestSupport) / currentPrice < 0.005; // Within 0.5% of support
        reasons.push(isNearSupport ? `✅ Price near support ${closestSupport.toFixed(2)}` : `❌ Price not near key support`);
        if (isNearSupport) return { signal: 'BUY', reasons };
    }

    // SELL Signal: Price pulls back to a significant resistance level in a downtrend
    if (!isBullishBias && resistances.length > 0) {
        const closestResistance = resistances[0];
        const isNearResistance = Math.abs(currentPrice - closestResistance) / currentPrice < 0.005;
        reasons.push(isNearResistance ? `✅ Price near resistance ${closestResistance.toFixed(2)}` : `❌ Price not near key resistance`);
        if (isNearResistance) return { signal: 'SELL', reasons };
    }

    return { signal: 'HOLD', reasons };
};

// --- Agent 9: Quantum Scalper (Upgraded) ---
const getQuantumScalperSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = 50;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };
    
    const closes = klines.map(k => k.close);
    const reasons: string[] = [];
    let score = 0;

    // Regime Detection
    const emaFast = getLast(EMA.calculate({ period: params.qsc_fastEmaPeriod!, values: closes }))! as number;
    const emaSlow = getLast(EMA.calculate({ period: params.qsc_slowEmaPeriod!, values: closes }))! as number;
    const adx = getLast(ADX.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes, period: params.qsc_adxPeriod! }))! as ADXOutput;
    const isTrending = adx.adx > params.qsc_adxThreshold!;
    reasons.push(isTrending ? `ℹ️ Regime: Trending (ADX ${adx.adx.toFixed(1)})` : `ℹ️ Regime: Ranging (ADX ${adx.adx.toFixed(1)})`);
    
    // Shared Indicators
    const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: params.qsc_stochRsiPeriod!, stochasticPeriod: params.qsc_stochRsiPeriod!, kPeriod: 3, dPeriod: 3 }))! as StochasticRSIOutput;
    
    if (isTrending) {
        // Trending Logic
        const isUptrend = emaFast > emaSlow;
        if (isUptrend && stochRsi.k > stochRsi.d) score++;
        if (!isUptrend && stochRsi.k < stochRsi.d) score++;
        
        if (score >= params.qsc_trendScoreThreshold!) {
            return { signal: isUptrend ? 'BUY' : 'SELL', reasons: [...reasons, '✅ Trending conditions met'] };
        }
    } else {
        // Ranging Logic
        const bb = getLast(BollingerBands.calculate({ period: params.qsc_bbPeriod!, stdDev: params.qsc_bbStdDev!, values: closes }))! as BollingerBandsOutput;
        const isOversold = getLast(closes)! < bb.lower && stochRsi.stochRSI < params.qsc_stochRsiOversold!;
        const isOverbought = getLast(closes)! > bb.upper && stochRsi.stochRSI > params.qsc_stochRsiOverbought!;
        
        if (isOversold) score++;
        if (isOverbought) score++;
        
        if (isOversold && score >= params.qsc_rangeScoreThreshold!) return { signal: 'BUY', reasons: [...reasons, '✅ Ranging (oversold) conditions met'] };
        if (isOverbought && score >= params.qsc_rangeScoreThreshold!) return { signal: 'SELL', reasons: [...reasons, '✅ Ranging (overbought) conditions met'] };
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

    switch (agent.id) {
        case 1: return getMomentumMasterSignal(klines, finalParams);
        case 2: return getTrendRiderSignal(klines, finalParams);
        case 3: return getMeanReversionistSignal(klines, finalParams, htfKlines);
        case 4: return getScalpingExpertSignal(klines, finalParams);
        case 5: return getMarketIgnitionSignal(klines, finalParams);
        case 6: return getProfitLockerSignal(klines, finalParams);
        case 7: return getMarketStructureMavenSignal(klines, finalParams);
        case 9: return getQuantumScalperSignal(klines, finalParams);
        default:
            return { signal: 'HOLD', reasons: ['Agent not found'] };
    }
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