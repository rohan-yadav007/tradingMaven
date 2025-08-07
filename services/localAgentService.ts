
import type { Agent, TradeSignal, Kline, AgentParams, Position, ADXOutput, MACDOutput, BollingerBandsOutput, StochasticRSIOutput, TradeManagementSignal, BotConfig } from '../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV } from 'technicalindicators';
import * as constants from '../constants';
import { calculateSupportResistance, SupportResistance } from './chartAnalysisService';

const getLast = <T>(arr: T[] | undefined): T | undefined => arr && arr.length > 0 ? arr[arr.length - 1] : undefined;

// This is the minimum stop loss as a percentage of the entry price.
// It prevents the stop loss from being set too tightly in low-volatility markets.
const MIN_STOP_LOSS_PERCENT = 0.5;

const TIMEFRAME_ATR_CONFIG: Record<string, { atrMultiplier: number, riskRewardRatio: number }> = {
    '1m':  { atrMultiplier: 1.5, riskRewardRatio: 1.2 },
    '3m':  { atrMultiplier: 1.8, riskRewardRatio: 1.5 },
    '5m':  { atrMultiplier: 2.0, riskRewardRatio: 1.5 },
    '15m': { atrMultiplier: 2.2, riskRewardRatio: 1.8 },
    '1h':  { atrMultiplier: 2.5, riskRewardRatio: 2.0 },
    '4h':  { atrMultiplier: 3.0, riskRewardRatio: 2.5 },
    '1d':  { atrMultiplier: 3.5, riskRewardRatio: 3.0 },
};

// --- GENERIC HELPERS (moved to top level for reuse) ---
const findPivotsGeneric = (series: number[], lookback: number): { highs: { value: number, index: number }[], lows: { value: number, index: number }[] } => {
    const highs: { value: number, index: number }[] = [];
    const lows: { value: number, index: number }[] = [];

    if (series.length < lookback * 2 + 1) return { highs, lows };

    for (let i = lookback; i < series.length - lookback; i++) {
        let isPivotHigh = true;
        let isPivotLow = true;

        for (let j = 1; j <= lookback; j++) {
            if (series[i] <= series[i - j] || series[i] < series[i + j]) isPivotHigh = false;
            if (series[i] >= series[i - j] || series[i] > series[i + j]) isPivotLow = false;
        }

        if (isPivotHigh) highs.push({ value: series[i], index: i });
        if (isPivotLow) lows.push({ value: series[i], index: i });
    }
    return { highs, lows };
};


// --- Agent 1: Momentum Master (Upgraded) ---
// [FIXED] This agent now enters on pullbacks within a confirmed trend, instead of chasing momentum.
const getMomentumMasterSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    if (klines.length < params.mom_emaSlowPeriod) {
        return { signal: 'HOLD', reasons: [`Not enough klines for Momentum Master analysis (need ${params.mom_emaSlowPeriod}).`] };
    }
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);

    // Calculate indicators
    const adx = getLast(ADX.calculate({ close: closes, high: highs, low: lows, period: params.adxPeriod })) as ADXOutput | undefined;
    const macdValues = MACD.calculate({ values: closes, fastPeriod: params.macdFastPeriod, slowPeriod: params.macdSlowPeriod, signalPeriod: params.macdSignalPeriod, SimpleMAOscillator: false, SimpleMASignal: false }) as MACDOutput[];
    const macd = getLast(macdValues);
    const prevMacd = macdValues.length > 1 ? macdValues[macdValues.length-2] : undefined;
    const rsi = getLast(RSI.calculate({ period: params.rsiPeriod, values: closes }));
    const emaFast = getLast(EMA.calculate({ period: params.mom_emaFastPeriod, values: closes }));
    const emaSlow = getLast(EMA.calculate({ period: params.mom_emaSlowPeriod, values: closes }));
    
    if (!adx || !macd || !prevMacd || typeof macd.histogram !== 'number' || typeof prevMacd.histogram !== 'number' || typeof rsi !== 'number' || typeof emaFast !== 'number' || typeof emaSlow !== 'number') {
        return { signal: 'HOLD', reasons: ["Could not calculate all momentum indicators."] };
    }

    if (adx.adx < params.adxTrendThreshold) {
        return { signal: 'HOLD', reasons: [`Market is not trending (ADX: ${adx.adx.toFixed(1)} < ${params.adxTrendThreshold}).`] };
    }

    const checks: string[] = [];
    
    // Bullish Entry
    if (emaFast > emaSlow) {
        checks.push('✅ Uptrend context (EMA Fast > Slow).');
        const isPullbackRsi = rsi > 50 && rsi < 70; // In a pullback zone, not extremely overbought
        checks.push(isPullbackRsi ? `✅ RSI in pullback zone (${rsi.toFixed(1)})` : `❌ RSI not in pullback zone (${rsi.toFixed(1)})`);
        
        const macdIsRising = macd.histogram > prevMacd.histogram;
        checks.push(macdIsRising ? `✅ MACD histogram rising` : `❌ MACD histogram not rising`);

        if (isPullbackRsi && macdIsRising) {
            const finalReasons = checks.filter(c => c.startsWith('✅'));
            return { signal: 'BUY', reasons: [`Uptrend pullback entry.`, ...finalReasons] };
        }
    }
    
    // Bearish Entry
    if (emaFast < emaSlow) {
        checks.push('✅ Downtrend context (EMA Fast < Slow).');
        const isPullbackRsi = rsi < 50 && rsi > 30; // In a pullback zone, not extremely oversold
        checks.push(isPullbackRsi ? `✅ RSI in pullback zone (${rsi.toFixed(1)})` : `❌ RSI not in pullback zone (${rsi.toFixed(1)})`);
        
        const macdIsFalling = macd.histogram < prevMacd.histogram;
        checks.push(macdIsFalling ? `✅ MACD histogram falling` : `❌ MACD histogram not falling`);

        if (isPullbackRsi && macdIsFalling) {
            const finalReasons = checks.filter(c => c.startsWith('✅'));
            return { signal: 'SELL', reasons: [`Downtrend pullback entry.`, ...finalReasons] };
        }
    }

    return { signal: 'HOLD', reasons: ['No pullback entry setup found.', ...checks] };
};

// --- Agent 2: Trend Rider ---
const getTrendRiderSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.tr_emaSlowPeriod, params.adxPeriod, params.tr_breakoutPeriod);
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`Not enough klines for Trend Rider analysis (need ${minKlines}).`] };
    }
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const currentPrice = closes[closes.length - 1];

    // Calculate indicators
    const adx = getLast(ADX.calculate({ close: closes, high: highs, low: lows, period: params.adxPeriod })) as ADXOutput | undefined;
    const rsi = getLast(RSI.calculate({ period: params.rsiPeriod, values: closes }));
    const emaFast = getLast(EMA.calculate({ period: params.tr_emaFastPeriod, values: closes }));
    const emaSlow = getLast(EMA.calculate({ period: params.tr_emaSlowPeriod, values: closes }));
    
    // Breakout check
    const recentHighs = highs.slice(-params.tr_breakoutPeriod - 1, -1);
    const recentLows = lows.slice(-params.tr_breakoutPeriod - 1, -1);
    const highestSince = Math.max(...recentHighs);
    const lowestSince = Math.min(...recentLows);

    if (!adx || typeof rsi !== 'number' || typeof emaFast !== 'number' || typeof emaSlow !== 'number') {
        return { signal: 'HOLD', reasons: ["Could not calculate all Trend Rider indicators."] };
    }

    const checks: string[] = [];
    const isTrending = adx.adx > params.adxTrendThreshold;
    checks.push(isTrending ? `✅ Strong Trend (ADX: ${adx.adx.toFixed(1)} > ${params.adxTrendThreshold})` : `❌ Weak Trend (ADX: ${adx.adx.toFixed(1)})`);
    
    if (!isTrending) {
        return { signal: 'HOLD', reasons: checks };
    }

    // Bullish Entry
    const isUptrend = emaFast > emaSlow;
    checks.push(isUptrend ? '✅ Uptrend Context (Fast EMA > Slow EMA)' : '❌ Not in Uptrend Context');
    
    if (isUptrend) {
        const hasMomentum = rsi > params.tr_rsiMomentumBullish;
        checks.push(hasMomentum ? `✅ Bullish Momentum (RSI: ${rsi.toFixed(1)} > ${params.tr_rsiMomentumBullish})` : `❌ Lacks Bullish Momentum (RSI: ${rsi.toFixed(1)})`);

        const isBreakout = currentPrice > highestSince;
        checks.push(isBreakout ? `✅ Price breaking out above recent highs` : `❌ Price not breaking out`);

        if (hasMomentum && isBreakout) {
            const finalReasons = checks.filter(c => c.startsWith('✅'));
            return { signal: 'BUY', reasons: [`Strong uptrend momentum entry.`, ...finalReasons] };
        }
    }
    
    // Bearish Entry
    const isDowntrend = emaFast < emaSlow;
    checks.push(isDowntrend ? '✅ Downtrend Context (Fast EMA < Slow EMA)' : '❌ Not in Downtrend Context');
    
    if (isDowntrend) {
         const hasMomentum = rsi < params.tr_rsiMomentumBearish;
         checks.push(hasMomentum ? `✅ Bearish Momentum (RSI: ${rsi.toFixed(1)} < ${params.tr_rsiMomentumBearish})` : `❌ Lacks Bearish Momentum (RSI: ${rsi.toFixed(1)})`);
         
         const isBreakout = currentPrice < lowestSince;
         checks.push(isBreakout ? `✅ Price breaking down below recent lows` : `❌ Price not breaking down`);

         if (hasMomentum && isBreakout) {
             const finalReasons = checks.filter(c => c.startsWith('✅'));
             return { signal: 'SELL', reasons: [`Strong downtrend momentum entry.`, ...finalReasons] };
         }
    }

    return { signal: 'HOLD', reasons: ['No momentum breakout setup found.', ...checks] };
};

// --- SuperTrend Calculation Helper ---
function calculateSuperTrend(candles: Kline[], period: number, multiplier: number) {
  if (candles.length <= period) return undefined;

  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  const atrResult = ATR.calculate({ high: highs, low: lows, close: closes, period });
  if (atrResult.length === 0) return undefined;

  const st: { trend: 'bullish' | 'bearish', supertrend: number }[] = [];
  const firstAtr = atrResult.shift()!;
  const firstCandleIdx = period;
  st.push({ trend: 'bullish', supertrend: (highs[firstCandleIdx] + lows[firstCandleIdx]) / 2 - multiplier * firstAtr });

  for (let i = 0; i < atrResult.length; i++) {
    const atr = atrResult[i];
    const candle_idx = i + period + 1;
    if (candle_idx >= closes.length) continue;
    
    const high = highs[candle_idx], low = lows[candle_idx], close = closes[candle_idx];
    const prev_st = st[i];
    
    let upperBand = (high + low) / 2 + multiplier * atr;
    let lowerBand = (high + low) / 2 - multiplier * atr;
    
    if (prev_st.trend === 'bullish') {
        lowerBand = Math.max(lowerBand, prev_st.supertrend);
    } else {
        upperBand = Math.min(upperBand, prev_st.supertrend);
    }

    let currentTrend: 'bullish' | 'bearish' = prev_st.trend;
    if (close > upperBand) currentTrend = 'bullish';
    else if (close < lowerBand) currentTrend = 'bearish';
    
    st.push({ trend: currentTrend, supertrend: currentTrend === 'bullish' ? lowerBand : upperBand });
  }
  return getLast(st);
}

/**
 * [FIXED] Detects classic bullish or bearish divergence between price and OBV.
 * This version correctly finds price pivots and then compares OBV values at those exact pivot times.
 */
const detectObvDivergence = (closes: number[], obvValues: number[], lookback: number): { bullish: boolean; bearish: boolean } => {
    if (closes.length < lookback * 2 + 1 || obvValues.length < lookback * 2 + 1) {
        return { bullish: false, bearish: false };
    }

    const pricePivots = findPivotsGeneric(closes, lookback);

    // Bullish: Lower low in price, higher low in OBV
    if (pricePivots.lows.length >= 2) {
        const lastPriceLow = pricePivots.lows[pricePivots.lows.length - 1];
        const prevPriceLow = pricePivots.lows[pricePivots.lows.length - 2];
        if (lastPriceLow.value < prevPriceLow.value && obvValues[lastPriceLow.index] > obvValues[prevPriceLow.index]) {
            return { bullish: true, bearish: false };
        }
    }

    // Bearish: Higher high in price, lower high in OBV
    if (pricePivots.highs.length >= 2) {
        const lastPriceHigh = pricePivots.highs[pricePivots.highs.length - 1];
        const prevPriceHigh = pricePivots.highs[pricePivots.highs.length - 2];
        if (lastPriceHigh.value > prevPriceHigh.value && obvValues[lastPriceHigh.index] < obvValues[prevPriceHigh.index]) {
            return { bullish: false, bearish: true };
        }
    }

    return { bullish: false, bearish: false };
};


// --- Agent 4 & 6: Scalping Expert & Profit Locker ---
function getScalpingExpertSignal(klines: Kline[], params: Required<AgentParams>): TradeSignal {
    const minKlines = Math.max(params.scalp_emaPeriod, params.scalp_superTrendPeriod, params.scalp_rsiPeriod, params.scalp_obvLookback) + params.scalp_stochRsiPeriod;
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`Need ${minKlines} klines for Scalping Expert.`] };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = closes[closes.length - 1];

    // Indicators
    const ema = getLast(EMA.calculate({ period: params.scalp_emaPeriod, values: closes }));
    const st = calculateSuperTrend(klines, params.scalp_superTrendPeriod, params.scalp_superTrendMultiplier);
    const psar = getLast(PSAR.calculate({ high: highs, low: lows, step: params.scalp_psarStep, max: params.scalp_psarMax }));
    
    const stochRsiInput = {
        values: closes, rsiPeriod: params.scalp_rsiPeriod, stochasticPeriod: params.scalp_stochRsiPeriod,
        kPeriod: 3, dPeriod: 3,
    };
    const stochRsiResult = StochasticRSI.calculate(stochRsiInput);
    const stochRsi = getLast(stochRsiResult);
    const prevStochRsi = stochRsiResult.length > 1 ? stochRsiResult[stochRsiResult.length - 2] : undefined;
    
    const obvValues = OBV.calculate({close: closes, volume: volumes});
    const divergence = detectObvDivergence(closes, obvValues, params.scalp_obvLookback);

    if (typeof ema !== 'number' || !st || typeof psar !== 'number' || !stochRsi || !prevStochRsi) {
        return { signal: 'HOLD', reasons: ["Calculating indicators..."] };
    }

    // --- REVISED LOGIC: Score-Based Entry ---
    // No hard trend gate. Instead, score each condition.
    let buyScore = 0;
    const buyChecks: string[] = [];

    // Trend conditions
    if (currentPrice > ema) { buyScore++; buyChecks.push(`✅ Price > EMA`); } else { buyChecks.push(`❌ Price < EMA`); }
    if (st.trend === 'bullish') { buyScore++; buyChecks.push(`✅ Supertrend is Bullish`); } else { buyChecks.push(`❌ Supertrend is Bearish`); }

    // Entry conditions
    if (currentPrice > psar) { buyScore++; buyChecks.push(`✅ PSAR confirms uptrend`); } else { buyChecks.push(`❌ PSAR does not confirm uptrend`); }
    if (prevStochRsi.stochRSI < params.scalp_stochRsiOversold && stochRsi.stochRSI >= params.scalp_stochRsiOversold) { 
        buyScore += 2; buyChecks.push(`✅ StochRSI pullback entry (+2)`);
    } else { 
        buyChecks.push(`❌ No StochRSI pullback entry`);
    }
    if (divergence.bullish) { 
        buyScore += params.scalp_obvScore; buyChecks.push(`✅ Bullish OBV Divergence (+${params.scalp_obvScore}pts)`); 
    }

    // Check for BUY signal
    if (buyScore >= params.scalp_scoreThreshold) {
        const finalReasons = buyChecks.filter(r => r.startsWith('✅'));
        return { signal: 'BUY', reasons: [`Buy score ${buyScore} >= ${params.scalp_scoreThreshold}.`, ...finalReasons] };
    }

    // --- Bearish Score ---
    let sellScore = 0;
    const sellChecks: string[] = [];

    // Trend conditions
    if (currentPrice < ema) { sellScore++; sellChecks.push('✅ Price < EMA'); } else { sellChecks.push('❌ Price > EMA'); }
    if (st.trend === 'bearish') { sellScore++; sellChecks.push('✅ Supertrend is Bearish'); } else { sellChecks.push('❌ Supertrend is Bullish'); }

    // Entry conditions
    if (currentPrice < psar) { sellScore++; sellChecks.push('✅ PSAR confirms downtrend'); } else { sellChecks.push('❌ PSAR not confirming downtrend'); }
    if (prevStochRsi.stochRSI > params.scalp_stochRsiOverbought && stochRsi.stochRSI <= params.scalp_stochRsiOverbought) {
        sellScore += 2; sellChecks.push(`✅ StochRSI pullback entry (+2)`);
    } else { 
        sellChecks.push(`❌ No StochRSI pullback entry`); 
    }
    if (divergence.bearish) { 
        sellScore += params.scalp_obvScore; sellChecks.push(`✅ Bearish OBV Divergence (+${params.scalp_obvScore}pts)`);
    }

    // Check for SELL signal
    if (sellScore >= params.scalp_scoreThreshold) {
        const finalReasons = sellChecks.filter(r => r.startsWith('✅'));
        return { signal: 'SELL', reasons: [`Sell score ${sellScore} >= ${params.scalp_scoreThreshold}.`, ...finalReasons] };
    }

    // Default HOLD if neither score is high enough
    return { signal: 'HOLD', reasons: [`Awaiting Signal (Buy: ${buyScore}/${params.scalp_scoreThreshold}, Sell: ${sellScore}/${params.scalp_scoreThreshold})`] };
}

// --- Agent 9: Quantum Scalper (Corrected logic from previous fix, remains valid) ---
const getQuantumScalperSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.qsc_slowEmaPeriod, params.qsc_adxPeriod, params.qsc_bbPeriod, params.qsc_stochRsiPeriod + 1);
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`Need ${minKlines} klines for Quantum Scalper.`] };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const currentPrice = closes[closes.length - 1];

    // Regime Detection
    const adxResult = getLast(ADX.calculate({ close: closes, high: highs, low: lows, period: params.qsc_adxPeriod })) as ADXOutput | undefined;
    const emaFast = getLast(EMA.calculate({ period: params.qsc_fastEmaPeriod, values: closes }));
    const emaSlow = getLast(EMA.calculate({ period: params.qsc_slowEmaPeriod, values: closes }));
    const bb = getLast(BollingerBands.calculate({ period: params.qsc_bbPeriod, stdDev: params.qsc_bbStdDev, values: closes }));

    // Entry Signal Indicators
    const stochRsiResult = StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: params.qsc_stochRsiPeriod, kPeriod: 3, dPeriod: 3 });
    const stochRsi = getLast(stochRsiResult);
    const prevStochRsi = stochRsiResult.length > 1 ? stochRsiResult[stochRsiResult.length - 2] : undefined;
    
    const macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }));
    const supertrend = calculateSuperTrend(klines, params.qsc_superTrendPeriod, params.qsc_superTrendMultiplier);

    if (!adxResult || !emaFast || !emaSlow || !bb || !stochRsi || !prevStochRsi || !macd || typeof macd.histogram !== 'number' || !supertrend) {
        return { signal: 'HOLD', reasons: ['Calculating indicators...'] };
    }

    let regime: 'BullishTrend' | 'BearishTrend' | 'Ranging' = 'Ranging';
    let regimeReason = `Regime: Ranging (ADX ${adxResult.adx.toFixed(1)} < ${params.qsc_adxThreshold}).`;

    if (adxResult.adx > params.qsc_adxThreshold) {
        if (emaFast > emaSlow && adxResult.pdi > adxResult.mdi) {
            regime = 'BullishTrend';
            regimeReason = `Regime: Bullish Trend (ADX ${adxResult.adx.toFixed(1)}, EMAs aligned).`;
        } else if (emaFast < emaSlow && adxResult.mdi > adxResult.pdi) {
            regime = 'BearishTrend';
            regimeReason = `Regime: Bearish Trend (ADX ${adxResult.adx.toFixed(1)}, EMAs aligned).`;
        }
    }
    
    let score = 0;
    const checks: string[] = [];

    if (regime === 'BullishTrend') {
        if (prevStochRsi.stochRSI < params.qsc_stochRsiOversold && stochRsi.stochRSI >= params.qsc_stochRsiOversold) { score += 2; checks.push(`✅ StochRSI crossed up from oversold`); } else { checks.push(`❌ StochRSI not crossing up from oversold`); }
        if (macd.histogram > 0) { score++; checks.push(`✅ MACD is Bullish`); } else { checks.push(`❌ MACD not Bullish`); }
        if (supertrend.trend === 'bullish') { score++; checks.push(`✅ Supertrend is Bullish`); } else { checks.push(`❌ Supertrend not Bullish`); }

        if (score >= params.qsc_trendScoreThreshold) {
            const metConditions = checks.filter(c => c.startsWith('✅'));
            return { signal: 'BUY', reasons: [regimeReason, `Score ${score} >= ${params.qsc_trendScoreThreshold}`, ...metConditions] };
        }
        return { signal: 'HOLD', reasons: [regimeReason, `Score ${score} < ${params.qsc_trendScoreThreshold}`, ...checks] };

    } else if (regime === 'BearishTrend') {
        if (prevStochRsi.stochRSI > params.qsc_stochRsiOverbought && stochRsi.stochRSI <= params.qsc_stochRsiOverbought) { score += 2; checks.push(`✅ StochRSI crossed down from overbought`); } else { checks.push(`❌ StochRSI not crossing down from overbought`); }
        if (macd.histogram < 0) { score++; checks.push(`✅ MACD is Bearish`); } else { checks.push(`❌ MACD not Bearish`); }
        if (supertrend.trend === 'bearish') { score++; checks.push(`✅ Supertrend is Bearish`); } else { checks.push(`❌ Supertrend not Bearish`); }
        
        if (score >= params.qsc_trendScoreThreshold) {
            const metConditions = checks.filter(c => c.startsWith('✅'));
            return { signal: 'SELL', reasons: [regimeReason, `Score ${score} >= ${params.qsc_trendScoreThreshold}`, ...metConditions] };
        }
        return { signal: 'HOLD', reasons: [regimeReason, `Score ${score} < ${params.qsc_trendScoreThreshold}`, ...checks] };
    
    } else { // Ranging
        let buyScore = 0;
        const buyChecks: string[] = [];
        if (currentPrice < bb.lower) { buyScore = 2; buyChecks.push(`✅ Price below Lower BB`); } else { buyChecks.push(`❌ Price not below Lower BB`); }
        if (stochRsi.stochRSI < params.qsc_stochRsiOversold) { buyScore++; buyChecks.push(`✅ StochRSI is Oversold`); } else { buyChecks.push(`❌ StochRSI not Oversold`); }

        if (buyScore >= params.qsc_rangeScoreThreshold) {
             const metConditions = buyChecks.filter(c => c.startsWith('✅'));
            return { signal: 'BUY', reasons: [regimeReason, `Range Buy score ${buyScore} >= ${params.qsc_rangeScoreThreshold}`, ...metConditions] };
        }

        let sellScore = 0;
        const sellChecks: string[] = [];
        if (currentPrice > bb.upper) { sellScore = 2; sellChecks.push(`✅ Price above Upper BB`); } else { sellChecks.push(`❌ Price not above Upper BB`); }
        if (stochRsi.stochRSI > params.qsc_stochRsiOverbought) { sellScore++; sellChecks.push(`✅ StochRSI is Overbought`); } else { sellChecks.push(`❌ StochRSI not Overbought`); }
        
        if (sellScore >= params.qsc_rangeScoreThreshold) {
            const metConditions = sellChecks.filter(c => c.startsWith('✅'));
            return { signal: 'SELL', reasons: [regimeReason, `Range Sell score ${sellScore} >= ${params.qsc_rangeScoreThreshold}`, ...metConditions] };
        }
        
        return { signal: 'HOLD', reasons: [regimeReason, `Awaiting Range entry...`, ...buyChecks, ...sellChecks]};
    }
};


// --- Main Signal Dispatcher ---
export const getTradingSignal = async (
    agent: Agent,
    klines: Kline[],
    timeFrame: string,
    params: AgentParams = {}
): Promise<TradeSignal> => {
    if (klines.length < 200 && ![2, 4, 6, 9].includes(agent.id)) { 
        return { signal: 'HOLD', reasons: [`Need at least 200 klines for full analysis (have ${klines.length}).`] };
    }
    
    const timeframeAdaptiveParams = constants.TIMEFRAME_ADAPTIVE_SETTINGS[timeFrame] || {};
    const finalParams = { ...constants.DEFAULT_AGENT_PARAMS, ...timeframeAdaptiveParams, ...params };

    switch (agent.id) {
        case 1:
            return getMomentumMasterSignal(klines, finalParams);
        case 2:
            return getTrendRiderSignal(klines, finalParams);
        case 4:
        case 6: // Profit Locker uses Scalping Expert's entry logic
            return getScalpingExpertSignal(klines, finalParams);
        case 5:
            return { signal: 'HOLD', reasons: ['Agent "Market Phase Adaptor" is not yet implemented.'] };
        case 7:
             return { signal: 'HOLD', reasons: ['Agent "Market Structure Maven" is not yet implemented.'] };
        case 8:
             return { signal: 'HOLD', reasons: ['Agent "Institutional Scalper" is not yet implemented.'] };
        case 9:
            return getQuantumScalperSignal(klines, finalParams);
        default:
            return { signal: 'HOLD', reasons: ['Agent not found.'] };
    }
};

/**
 * Calculates initial "smart" Stop Loss and Take Profit targets based on market volatility (ATR).
 * Includes "whipsaw protection" to ensure the stop is never too tight.
 * Now also returns partial TP and trail start info for supported agents.
 */
export const getInitialAgentTargets = (
    klines: Kline[],
    entryPrice: number,
    direction: 'LONG' | 'SHORT',
    timeFrame: string,
    params: Required<AgentParams>,
    agentId: number
): {
    stopLossPrice: number;
    takeProfitPrice: number;
    partialTps?: { price: number; hit: boolean; sizeFraction: number }[];
    trailStartPrice?: number;
} => {
    const isLong = direction === 'LONG';
    const atrResult = ATR.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: klines.map(k => k.close), period: params.atrPeriod });
    const atr = getLast(atrResult);

    let atrStopLossPrice: number;
    let takeProfitPrice: number;

    const atrConfig = TIMEFRAME_ATR_CONFIG[timeFrame] || { atrMultiplier: 2.0, riskRewardRatio: 1.5 };

    const defaultStopDistance = (typeof atr === 'number' && atr > 0) ? (atr * atrConfig.atrMultiplier) : (entryPrice * 0.02);
    const defaultProfitDistance = defaultStopDistance * atrConfig.riskRewardRatio;
    
    atrStopLossPrice = isLong ? entryPrice - defaultStopDistance : entryPrice + defaultStopDistance;
    takeProfitPrice = isLong ? entryPrice + defaultProfitDistance : entryPrice - (defaultProfitDistance);
    
    // --- Whipsaw Protection (applied to all) ---
    const minStopDistance = entryPrice * (MIN_STOP_LOSS_PERCENT / 100);
    let finalStopLossPrice = isLong ? Math.min(atrStopLossPrice, entryPrice - minStopDistance) : Math.max(atrStopLossPrice, entryPrice + minStopDistance);

    // --- Agent-Specific Logic ---
    // Agent 9 (Quantum Scalper): Custom SL, distant TP
    if (agentId === 9) {
        const stopDistance = (typeof atr === 'number' && atr > 0) ? (atr * params.qsc_atrMultiplier) : (entryPrice * 0.02);
        const qscStopLossPrice = isLong ? entryPrice - stopDistance : entryPrice + stopDistance;
        finalStopLossPrice = isLong ? Math.min(qscStopLossPrice, entryPrice - minStopDistance) : Math.max(qscStopLossPrice, entryPrice + minStopDistance);
        takeProfitPrice = isLong ? entryPrice + (stopDistance * 100) : entryPrice - (stopDistance * 100); // Distant TP
    }
    // Agent 4 & 6 (Scalping/Locker): Partial TPs
    else if (agentId === 4 || agentId === 6) {
        if (typeof atr === 'number' && atr > 0) {
            const atrMultipliers = [0.5, 1.0, 1.5];
            const partialTps = atrMultipliers.map(mult => ({
                price: isLong ? entryPrice + (atr * mult) : entryPrice - (atr * mult),
                hit: false,
                sizeFraction: 0.25
            }));
            const trailStartPrice = partialTps[2].price;
            takeProfitPrice = trailStartPrice; // The final effective TP is the last partial TP

            return { stopLossPrice: finalStopLossPrice, takeProfitPrice, partialTps, trailStartPrice };
        }
    }

    // Default R:R adjustment if whipsaw protection was tighter
    if (finalStopLossPrice !== atrStopLossPrice) {
        const finalRiskDistance = Math.abs(entryPrice - finalStopLossPrice);
        const adjustedProfitDistance = finalRiskDistance * atrConfig.riskRewardRatio;
        takeProfitPrice = isLong ? entryPrice + adjustedProfitDistance : entryPrice - adjustedProfitDistance;
    }

    return { stopLossPrice: finalStopLossPrice, takeProfitPrice };
};

/**
 * Actively checks for signs of trend weakness after a profitable trade.
 * @returns A veto decision and the reasons for it.
 */
export const analyzeTrendExhaustion = (
    klines: Kline[],
    direction: 'LONG' | 'SHORT',
): { veto: boolean; reasons: string[] } => {
    const lookback = 3;
    if (klines.length < 20) {
        return { veto: false, reasons: [] };
    }

    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);

    const macdValues = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const macdHistograms = macdValues.map(m => m.histogram).filter((h): h is number => h !== undefined);
    
    const validVolumes = volumes.filter(v => v > 0);
    if (validVolumes.length < 20) {
         return { veto: false, reasons: ['Not enough volume data for exhaustion check.'] };
    }
    const volumeSma = SMA.calculate({ period: 20, values: volumes });

    if (macdHistograms.length < lookback || volumeSma.length < lookback) {
        return { veto: false, reasons: [] };
    }

    const recentMacd = macdHistograms.slice(-lookback);
    const lastKline = klines[klines.length - 1];
    const prevKline = klines[klines.length - 2];
    const lastVolume = volumes[volumes.length - 1];
    const avgVolume = volumeSma[volumeSma.length - 1];

    let exhaustionScore = 0;
    const reasons: string[] = [];

    // Check 1: Fading Momentum (MACD Histogram)
    if (direction === 'LONG') {
        const isMacdFading = recentMacd[lookback - 1] < recentMacd[lookback - 2];
        if (isMacdFading && macdHistograms[macdHistograms.length-1] > 0) {
            exhaustionScore++;
            reasons.push('Fading MACD momentum');
        }
    } else { // SHORT
        const isMacdRising = recentMacd[lookback - 1] > recentMacd[lookback - 2];
        if (isMacdRising && macdHistograms[macdHistograms.length-1] < 0) {
            exhaustionScore++;
            reasons.push('Fading MACD momentum');
        }
    }

    // Check 2: Reversal Price Action
    if (direction === 'LONG' && lastKline.close < lastKline.open) { // Red candle
        exhaustionScore++;
        reasons.push('Reversal price action');
    } else if (direction === 'SHORT' && lastKline.close > lastKline.open) { // Green candle
        exhaustionScore++;
        reasons.push('Reversal price action');
    }

    // Check 3: Declining Volume
    if (lastVolume < avgVolume) {
        exhaustionScore++;
        reasons.push('Declining volume');
    }

    const veto = exhaustionScore >= 2;
    return { veto, reasons: veto ? reasons : [] };
};


// --- Proactive Trade Management ---

/**
 * [NEW] Implements the partial take-profit and trailing stop logic for agents 4 and 6.
 */
const getAtrTpTrailSignal = (
    position: Position,
    klines: Kline[],
    livePrice: number,
    params: Required<AgentParams>
): TradeManagementSignal => {
    if (!position.partialTps || typeof position.trailStartPrice !== 'number') {
        return { reasons: ['Position not configured for partial TPs.'] };
    }

    const isLong = position.direction === 'LONG';

    // 1. Check for partial TP hits
    for (let i = 0; i < position.partialTps.length; i++) {
        const tp = position.partialTps[i];
        if (!tp.hit) {
            const priceConditionMet = isLong ? livePrice >= tp.price : livePrice <= tp.price;
            if (priceConditionMet) {
                return {
                    partialClose: {
                        tpIndex: i,
                        reason: `Partial Take Profit ${i + 1} hit at ${tp.price.toFixed(position.pricePrecision)}`,
                    },
                    reasons: [`Triggering partial close for TP${i + 1}.`],
                };
            }
            // If we haven't hit this TP, we can't hit subsequent ones yet.
            // This ensures we take profits in order.
            break; 
        }
    }

    // 2. Check for trailing stop activation on the final portion of the trade
    const trailConditionMet = isLong ? livePrice >= position.trailStartPrice : livePrice <= position.trailStartPrice;

    if (trailConditionMet) {
        const atr = getLast(ATR.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: klines.map(k => k.close), period: params.atrPeriod }));
        if (typeof atr === 'number' && atr > 0) {
            const trailDistance = atr * 0.5;
            const newStopLoss = isLong ? livePrice - trailDistance : livePrice + trailDistance;
            
            const isImprovement = (isLong && newStopLoss > position.stopLossPrice) || (!isLong && newStopLoss < position.stopLossPrice);
            if (isImprovement) {
                return {
                    newStopLoss,
                    reasons: [`Trailing stop activated/updated to ${newStopLoss.toFixed(position.pricePrecision)}.`]
                };
            }
        }
    }

    return { reasons: ['Holding position, no partial TP or trailing conditions met.'] };
};

/**
 * [NEW] A centralized, robust function to protect profits based on a minimum gross PNL target.
 * This is now the core logic for the "Profit Locker" agent and a safety feature for the "Quantum Scalper".
 */
const getMinimumGrossProfitProtectionSignal = (
    position: Position,
    livePrice: number,
    botConfig: BotConfig,
    currentStopLoss: number
): { newStopLoss?: number; reason?: string } => {
    if (botConfig.minimumGrossProfit <= 0) return {};

    const isLong = position.direction === 'LONG';
    const grossPnl = (livePrice - position.entryPrice) * position.size * (isLong ? 1 : -1);

    if (grossPnl >= botConfig.minimumGrossProfit) {
        const priceChangeForProfit = botConfig.minimumGrossProfit / position.size;

        const profitProtectStopLoss = isLong
            ? position.entryPrice + priceChangeForProfit
            : position.entryPrice - priceChangeForProfit;

        const isImprovement = (isLong && profitProtectStopLoss > currentStopLoss) || (!isLong && profitProtectStopLoss < currentStopLoss);
        if (isImprovement) {
            return {
                newStopLoss: profitProtectStopLoss,
                reason: `Profit protection active (Gross PNL ~$${grossPnl.toFixed(2)} > Target $${botConfig.minimumGrossProfit})`,
            };
        }
    }
    return {};
};


const getQuantumScalperTrailSignal = (
    position: Position,
    klines: Kline[],
    livePrice: number,
    botConfig: BotConfig,
    params: Required<AgentParams>
): TradeManagementSignal => {
    const reasons: string[] = [];
    const isLong = position.direction === 'LONG';
    let finalNewStopLoss: number | undefined = undefined;

    // Part 1: PSAR Trailing Stop (Primary Trail)
    const psarResult = PSAR.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), step: params.qsc_psarStep, max: params.qsc_psarMax });
    const psarStopLoss = (psarResult.length >= 2) ? psarResult[psarResult.length - 2] : undefined;

    if (psarStopLoss) {
        const isPsarImprovement = (isLong && psarStopLoss > position.stopLossPrice) || (!isLong && psarStopLoss < position.stopLossPrice);
        if (isPsarImprovement) {
            finalNewStopLoss = psarStopLoss;
            reasons.push(`PSAR trail updated to ${psarStopLoss.toFixed(position.pricePrecision)}.`);
        }
    }

    // Part 2: Minimum Profit Protection (Safety Net) [Uses new centralized function]
    const currentSLForCheck = finalNewStopLoss ?? position.stopLossPrice;
    const profitProtectResult = getMinimumGrossProfitProtectionSignal(position, livePrice, botConfig, currentSLForCheck);

    if (profitProtectResult.newStopLoss) {
        // If the profit protection SL is tighter than the PSAR SL, use it instead.
        const isTighter = (isLong && profitProtectResult.newStopLoss > (finalNewStopLoss ?? -Infinity)) || (!isLong && profitProtectResult.newStopLoss < (finalNewStopLoss ?? Infinity));
        if (isTighter) {
            finalNewStopLoss = profitProtectResult.newStopLoss;
            // Replace the PSAR reason with the more important profit lock reason.
            if(reasons.some(r => r.startsWith('PSAR'))) reasons.shift();
            reasons.unshift(profitProtectResult.reason!);
        }
    }

    if (finalNewStopLoss !== undefined) {
        const isFinalImprovement = (isLong && finalNewStopLoss > position.stopLossPrice) || (!isLong && finalNewStopLoss < position.stopLossPrice);
        if (isFinalImprovement) {
             return { newStopLoss: finalNewStopLoss, reasons };
        }
    }

    return { reasons: ['Holding current stop. No profitable trail update available.'] };
};

export const getTradeManagementSignal = async (
    position: Position,
    klines: Kline[],
    livePrice: number,
    botConfig: BotConfig
): Promise<TradeManagementSignal> => {
    
    const positionDirection = position.direction;
    const finalParams = { ...constants.DEFAULT_AGENT_PARAMS, ...botConfig.agentParams };

    // --- Priority 1: Check for signal reversal to close position ---
    // Agent 9 (Quantum Scalper) is excluded because its PSAR trail is its primary exit signal.
    // All other agents will now close on a reversal signal.
    if (![9].includes(botConfig.agent.id)) {
        const latestSignal = await getTradingSignal(botConfig.agent, klines, botConfig.timeFrame, botConfig.agentParams);
        
        if (
            (positionDirection === 'LONG' && latestSignal.signal === 'SELL') ||
            (positionDirection === 'SHORT' && latestSignal.signal === 'BUY')
        ) {
            return {
                closePosition: true,
                reasons: [`Signal reversed to ${latestSignal.signal}. Closing position.`]
            };
        }
    }

    // --- Priority 2: Agent-specific trailing logic ---
    if (!botConfig.isStopLossLocked) {
        switch(botConfig.agent.id) {
            case 4: // Scalping Expert
            case 6: // Profit Locker
                return getAtrTpTrailSignal(position, klines, livePrice, finalParams);
            case 9: // Quantum Scalper
                return getQuantumScalperTrailSignal(position, klines, livePrice, botConfig, finalParams);
        }
    }
    
    // --- Default: No action needed ---
    return {
        reasons: ["Holding initial targets."],
    };
};
