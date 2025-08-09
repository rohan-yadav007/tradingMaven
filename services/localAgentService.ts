
import type { Agent, TradeSignal, Kline, AgentParams, Position, ADXOutput, MACDOutput, BollingerBandsOutput, StochasticRSIOutput, TradeManagementSignal, BotConfig } from '../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV } from 'technicalindicators';
import * as constants from '../constants';
import { calculateSupportResistance } from './chartAnalysisService';

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

    const checks: string[] = [];
    
    // Bullish Entry
    const isUptrendContext = emaFast > emaSlow;
    checks.push(isUptrendContext ? `✅ Trend Context: Bullish (EMA Fast > Slow)` : `❌ Trend Context: Not Bullish`);
    const isPullbackRsiBullish = rsi > 50 && rsi < 70;
    checks.push(isPullbackRsiBullish ? `✅ RSI in bullish pullback zone (${rsi.toFixed(1)})` : `❌ RSI not in bullish pullback zone (${rsi.toFixed(1)})`);
    const macdIsRising = macd.histogram > prevMacd.histogram;
    checks.push(macdIsRising ? `✅ MACD histogram rising` : `❌ MACD histogram not rising`);
    const isTrendingAdx = adx.adx > params.adxTrendThreshold;
    checks.push(isTrendingAdx ? `✅ ADX confirms trend (${adx.adx.toFixed(1)})` : `❌ ADX trend is weak (${adx.adx.toFixed(1)})`);

    if (isUptrendContext && isTrendingAdx && isPullbackRsiBullish && macdIsRising) {
        return { signal: 'BUY', reasons: checks };
    }
    
    // Bearish Entry
    const isDowntrendContext = emaFast < emaSlow;
    checks.push(isDowntrendContext ? `✅ Trend Context: Bearish (EMA Fast < Slow)` : `❌ Trend Context: Not Bearish`);
    const isPullbackRsiBearish = rsi < 50 && rsi > 30;
    checks.push(isPullbackRsiBearish ? `✅ RSI in bearish pullback zone (${rsi.toFixed(1)})` : `❌ RSI not in bearish pullback zone (${rsi.toFixed(1)})`);
    const macdIsFalling = macd.histogram < prevMacd.histogram;
    checks.push(macdIsFalling ? `✅ MACD histogram falling` : `❌ MACD histogram not falling`);

    if (isDowntrendContext && isTrendingAdx && isPullbackRsiBearish && macdIsFalling) {
        return { signal: 'SELL', reasons: checks };
    }

    // Return the checks for the current trend context for better analysis preview
    return { signal: 'HOLD', reasons: isUptrendContext ? checks.slice(0, 4) : checks.slice(4) };
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
    
    // Bullish Entry
    const isUptrend = emaFast > emaSlow;
    const isDowntrend = emaFast < emaSlow;
    
    if (isUptrend) {
        checks.push('✅ Uptrend Context (Fast EMA > Slow EMA)');
        const hasMomentum = rsi > params.tr_rsiMomentumBullish;
        checks.push(hasMomentum ? `✅ Bullish Momentum (RSI: ${rsi.toFixed(1)} > ${params.tr_rsiMomentumBullish})` : `❌ Lacks Bullish Momentum (RSI: ${rsi.toFixed(1)})`);
        const isBreakout = currentPrice > highestSince;
        checks.push(isBreakout ? `✅ Price breaking out above recent highs` : `❌ Price not breaking out`);
        if (isTrending && hasMomentum && isBreakout) {
            return { signal: 'BUY', reasons: checks };
        }
    } else if (isDowntrend) {
        checks.push('✅ Downtrend Context (Fast EMA < Slow EMA)');
        const hasMomentum = rsi < params.tr_rsiMomentumBearish;
        checks.push(hasMomentum ? `✅ Bearish Momentum (RSI: ${rsi.toFixed(1)} < ${params.tr_rsiMomentumBearish})` : `❌ Lacks Bearish Momentum (RSI: ${rsi.toFixed(1)})`);
        const isBreakout = currentPrice < lowestSince;
        checks.push(isBreakout ? `✅ Price breaking down below recent lows` : `❌ Price not breaking down`);
        if (isTrending && hasMomentum && isBreakout) {
             return { signal: 'SELL', reasons: checks };
         }
    } else {
        checks.push('❌ Neutral Trend Context');
    }

    return { signal: 'HOLD', reasons: checks };
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


// --- Agent 4: Scalping Expert (New V2 Logic) ---
const getScalpingExpertV2Signal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.se_emaSlowPeriod!, params.se_bbPeriod!, params.se_macdSlowPeriod! + params.se_macdSignalPeriod!);
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`Need ${minKlines} klines for Scalping Expert.`] };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const currentPrice = closes[closes.length - 1];

    const allChecks: { condition: boolean, message: string }[] = [];

    // --- Volatility Filter ---
    const atr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: params.se_atrPeriod! }));
    if (typeof atr !== 'number' || atr <= 0) {
        return { signal: 'HOLD', reasons: ['Calculating ATR...'] };
    }
    const atrPercentage = (atr / currentPrice) * 100;
    allChecks.push({ condition: atrPercentage >= params.se_atrVolatilityThreshold!, message: `Volatility OK (ATR ${atrPercentage.toFixed(2)}% >= ${params.se_atrVolatilityThreshold!}%)` });

    if (atrPercentage < params.se_atrVolatilityThreshold!) {
        return { signal: 'HOLD', reasons: allChecks.map(c => `${c.condition ? '✅' : '❌'} ${c.message}`) };
    }

    // --- Indicator Calculations ---
    const emaFast = getLast(EMA.calculate({ period: params.se_emaFastPeriod!, values: closes }));
    const emaSlow = getLast(EMA.calculate({ period: params.se_emaSlowPeriod!, values: closes }));
    const macdValues = MACD.calculate({ values: closes, fastPeriod: params.se_macdFastPeriod!, slowPeriod: params.se_macdSlowPeriod!, signalPeriod: params.se_macdSignalPeriod!, SimpleMAOscillator: false, SimpleMASignal: false });
    const macd = getLast(macdValues);
    const rsiValues = RSI.calculate({ period: params.se_rsiPeriod!, values: closes });
    const rsi = getLast(rsiValues);
    const prevRsi = rsiValues.length > 1 ? rsiValues[rsiValues.length - 2] : undefined;
    const bb = getLast(BollingerBands.calculate({ period: params.se_bbPeriod!, stdDev: params.se_bbStdDev!, values: closes }));

    if (typeof emaFast !== 'number' || typeof emaSlow !== 'number' || !macd || !macd.MACD || !macd.signal || typeof rsi !== 'number' || typeof prevRsi !== 'number' || !bb) {
        return { signal: 'HOLD', reasons: ["Calculating indicators..."] };
    }
    
    const formattedReasons = () => allChecks.map(c => `${c.condition ? '✅' : '❌'} ${c.message}`);

    // --- Long Entry Conditions ---
    const isUptrend = emaFast > emaSlow;
    allChecks.push({ condition: isUptrend, message: `Trend: EMA Bullish Cross` });
    const isMacdBullish = macd.MACD > macd.signal;
    allChecks.push({ condition: isMacdBullish, message: `Momentum: MACD Bullish` });
    const isRsiRisingFromPullback = rsi > prevRsi && rsi < 50;
    allChecks.push({ condition: isRsiRisingFromPullback, message: `Pullback: RSI rising in lower half` });
    const isNearLowerBB = currentPrice <= bb.middle;
    allChecks.push({ condition: isNearLowerBB, message: `Volatility: Price in lower BB half` });

    if (isUptrend && isMacdBullish && isRsiRisingFromPullback && isNearLowerBB) {
        return { signal: 'BUY', reasons: formattedReasons() };
    }

    // --- Short Entry Conditions ---
    const isDowntrend = emaFast < emaSlow;
    allChecks[1] = { condition: isDowntrend, message: `Trend: EMA Bearish Cross` };
    const isMacdBearish = macd.MACD < macd.signal;
    allChecks[2] = { condition: isMacdBearish, message: `Momentum: MACD Bearish` };
    const isRsiFallingFromPullback = rsi < prevRsi && rsi > 50;
    allChecks[3] = { condition: isRsiFallingFromPullback, message: `Pullback: RSI falling in upper half` };
    const isNearUpperBB = currentPrice >= bb.middle;
    allChecks[4] = { condition: isNearUpperBB, message: `Volatility: Price in upper BB half` };

    if (isDowntrend && isMacdBearish && isRsiFallingFromPullback && isNearUpperBB) {
        return { signal: 'SELL', reasons: formattedReasons() };
    }

    return { signal: 'HOLD', reasons: formattedReasons() };
}


// --- Agent 6: Profit Locker (uses the old score-based scalping logic for entry) ---
function getProfitLockerSignal(klines: Kline[], params: Required<AgentParams>): TradeSignal {
    const minKlines = Math.max(params.scalp_emaPeriod, params.scalp_superTrendPeriod, params.scalp_rsiPeriod, params.scalp_obvLookback) + params.scalp_stochRsiPeriod;
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`Need ${minKlines} klines for Profit Locker.`] };
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

    let buyScore = 0;
    const buyChecks: string[] = [];
    buyChecks.push(currentPrice > ema ? `✅ Price > EMA` : `❌ Price < EMA`); if (currentPrice > ema) buyScore++;
    buyChecks.push(st.trend === 'bullish' ? `✅ Supertrend is Bullish` : `❌ Supertrend is Bearish`); if (st.trend === 'bullish') buyScore++;
    buyChecks.push(currentPrice > psar ? `✅ PSAR confirms uptrend` : `❌ PSAR does not confirm uptrend`); if (currentPrice > psar) buyScore++;
    buyChecks.push(prevStochRsi.stochRSI < params.scalp_stochRsiOversold && stochRsi.stochRSI >= params.scalp_stochRsiOversold ? `✅ StochRSI pullback entry (+2)` : `❌ No StochRSI pullback entry`); if (prevStochRsi.stochRSI < params.scalp_stochRsiOversold && stochRsi.stochRSI >= params.scalp_stochRsiOversold) buyScore += 2;
    buyChecks.push(divergence.bullish ? `✅ Bullish OBV Divergence (+${params.scalp_obvScore}pts)` : `❌ No Bullish OBV Divergence`); if (divergence.bullish) buyScore += params.scalp_obvScore;

    if (buyScore >= params.scalp_scoreThreshold) {
        return { signal: 'BUY', reasons: [`ℹ️ Buy score ${buyScore} >= ${params.scalp_scoreThreshold}.`, ...buyChecks] };
    }

    let sellScore = 0;
    const sellChecks: string[] = [];
    sellChecks.push(currentPrice < ema ? '✅ Price < EMA' : '❌ Price > EMA'); if (currentPrice < ema) sellScore++;
    sellChecks.push(st.trend === 'bearish' ? '✅ Supertrend is Bearish' : '❌ Supertrend is Bullish'); if (st.trend === 'bearish') sellScore++;
    sellChecks.push(currentPrice < psar ? '✅ PSAR confirms downtrend' : '❌ PSAR not confirming downtrend'); if (currentPrice < psar) sellScore++;
    sellChecks.push(prevStochRsi.stochRSI > params.scalp_stochRsiOverbought && stochRsi.stochRSI <= params.scalp_stochRsiOverbought ? `✅ StochRSI pullback entry (+2)` : `❌ No StochRSI pullback entry`); if (prevStochRsi.stochRSI > params.scalp_stochRsiOverbought && stochRsi.stochRSI <= params.scalp_stochRsiOverbought) sellScore += 2;
    sellChecks.push(divergence.bearish ? `✅ Bearish OBV Divergence (+${params.scalp_obvScore}pts)` : `❌ No Bearish OBV Divergence`); if (divergence.bearish) sellScore += params.scalp_obvScore;

    if (sellScore >= params.scalp_scoreThreshold) {
        return { signal: 'SELL', reasons: [`ℹ️ Sell score ${sellScore} >= ${params.scalp_scoreThreshold}.`, ...sellChecks] };
    }

    return { signal: 'HOLD', reasons: [`ℹ️ Awaiting Signal (Buy: ${buyScore}/${params.scalp_scoreThreshold}, Sell: ${sellScore}/${params.scalp_scoreThreshold})`, ...buyChecks, ...sellChecks] };
}

// --- Agent 7: Market Structure Maven [NEW] ---
const getMarketStructureMavenSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlines = Math.max(params.msm_htfEmaPeriod, params.msm_swingPointLookback * 2 + 1);
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`Need ${minKlines} klines for Market Structure Maven.`] };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const currentPrice = closes[closes.length - 1];
    const lastCandle = klines[klines.length - 1];

    // Trend Bias
    const htfEma = getLast(EMA.calculate({ period: params.msm_htfEmaPeriod, values: closes }));
    if (typeof htfEma !== 'number') {
        return { signal: 'HOLD', reasons: ['Calculating bias EMA...'] };
    }

    const checks: string[] = [];
    const isBullishBias = currentPrice > htfEma;
    const isBearishBias = currentPrice < htfEma;
    checks.push(isBullishBias ? `✅ Bias: Bullish (Price > ${params.msm_htfEmaPeriod} EMA)` : `❌ Bias: Not Bullish`);

    if (isBullishBias) {
        const pivots = findPivotsGeneric(lows, params.msm_swingPointLookback);
        const recentSwingLows = pivots.lows.filter(p => p.index > klines.length - 50);
        const lastSwingLow = recentSwingLows.pop()?.value;
        checks.push(lastSwingLow ? `ℹ️ Last swing low at ${lastSwingLow.toFixed(2)}` : `❌ No recent swing lows found`);
        if (lastSwingLow) {
            const pullbackLookback = 3;
            const recentLowsSlice = lows.slice(-pullbackLookback);
            const priceTouchedSupport = recentLowsSlice.some(l => Math.abs(l - lastSwingLow) / lastSwingLow < 0.005);
            checks.push(priceTouchedSupport ? `✅ Pullback: Price recently touched support` : `❌ Pullback: Price has not touched support`);
            const isConfirmationCandle = lastCandle.close > lastCandle.open;
            checks.push(isConfirmationCandle ? `✅ Confirmation: Last candle was bullish` : `❌ Confirmation: Awaiting bullish candle`);
            if (priceTouchedSupport && isConfirmationCandle) {
                return { signal: 'BUY', reasons: checks };
            }
        }
    } else if (isBearishBias) {
        checks[0] = `✅ Bias: Bearish (Price < ${params.msm_htfEmaPeriod} EMA)`;
        const pivots = findPivotsGeneric(highs, params.msm_swingPointLookback);
        const recentSwingHighs = pivots.highs.filter(p => p.index > klines.length - 50);
        const lastSwingHigh = recentSwingHighs.pop()?.value;
        checks.push(lastSwingHigh ? `ℹ️ Last swing high at ${lastSwingHigh.toFixed(2)}` : `❌ No recent swing highs found`);
        if (lastSwingHigh) {
            const pullbackLookback = 3;
            const recentHighsSlice = highs.slice(-pullbackLookback);
            const priceTouchedResistance = recentHighsSlice.some(h => Math.abs(h - lastSwingHigh) / lastSwingHigh < 0.005);
            checks.push(priceTouchedResistance ? `✅ Pullback: Price recently touched resistance` : `❌ Pullback: Price has not touched resistance`);
            const isConfirmationCandle = lastCandle.close < lastCandle.open;
            checks.push(isConfirmationCandle ? `✅ Confirmation: Last candle was bearish` : `❌ Confirmation: Awaiting bearish candle`);
            if (priceTouchedResistance && isConfirmationCandle) {
                return { signal: 'SELL', reasons: checks };
            }
        }
    }

    return { signal: 'HOLD', reasons: checks };
};

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

    const adxResult = getLast(ADX.calculate({ close: closes, high: highs, low: lows, period: params.qsc_adxPeriod })) as ADXOutput | undefined;
    const emaFast = getLast(EMA.calculate({ period: params.qsc_fastEmaPeriod, values: closes }));
    const emaSlow = getLast(EMA.calculate({ period: params.qsc_slowEmaPeriod, values: closes }));
    const bb = getLast(BollingerBands.calculate({ period: params.qsc_bbPeriod, stdDev: params.qsc_bbStdDev, values: closes }));
    const stochRsiResult = StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: params.qsc_stochRsiPeriod, kPeriod: 3, dPeriod: 3 });
    const stochRsi = getLast(stochRsiResult);
    const prevStochRsi = stochRsiResult.length > 1 ? stochRsiResult[stochRsiResult.length - 2] : undefined;
    const macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }));
    const supertrend = calculateSuperTrend(klines, params.qsc_superTrendPeriod, params.qsc_superTrendMultiplier);

    if (!adxResult || !emaFast || !emaSlow || !bb || !stochRsi || !prevStochRsi || !macd || typeof macd.histogram !== 'number' || !supertrend) {
        return { signal: 'HOLD', reasons: ['Calculating indicators...'] };
    }

    let regime: 'BullishTrend' | 'BearishTrend' | 'Ranging' = 'Ranging';
    if (adxResult.adx > params.qsc_adxThreshold) {
        if (emaFast > emaSlow && adxResult.pdi > adxResult.mdi) regime = 'BullishTrend';
        else if (emaFast < emaSlow && adxResult.mdi > adxResult.pdi) regime = 'BearishTrend';
    }
    
    const checks: string[] = [`ℹ️ Regime: ${regime} (ADX ${adxResult.adx.toFixed(1)})`];
    
    if (regime === 'BullishTrend') {
        let score = 0;
        if (prevStochRsi.stochRSI < params.qsc_stochRsiOversold && stochRsi.stochRSI >= params.qsc_stochRsiOversold) { score += 2; checks.push(`✅ StochRSI crossed up from oversold`); } else { checks.push(`❌ StochRSI not crossing up from oversold`); }
        if (macd.histogram > 0) { score++; checks.push(`✅ MACD is Bullish`); } else { checks.push(`❌ MACD not Bullish`); }
        if (supertrend.trend === 'bullish') { score++; checks.push(`✅ Supertrend is Bullish`); } else { checks.push(`❌ Supertrend not Bullish`); }
        if (score >= params.qsc_trendScoreThreshold) return { signal: 'BUY', reasons: [`ℹ️ Trend Buy Score: ${score}/${params.qsc_trendScoreThreshold}`, ...checks] };
    } else if (regime === 'BearishTrend') {
        let score = 0;
        if (prevStochRsi.stochRSI > params.qsc_stochRsiOverbought && stochRsi.stochRSI <= params.qsc_stochRsiOverbought) { score += 2; checks.push(`✅ StochRSI crossed down from overbought`); } else { checks.push(`❌ StochRSI not crossing down from overbought`); }
        if (macd.histogram < 0) { score++; checks.push(`✅ MACD is Bearish`); } else { checks.push(`❌ MACD not Bearish`); }
        if (supertrend.trend === 'bearish') { score++; checks.push(`✅ Supertrend is Bearish`); } else { checks.push(`❌ Supertrend not Bullish`); }
        if (score >= params.qsc_trendScoreThreshold) return { signal: 'SELL', reasons: [`ℹ️ Trend Sell Score: ${score}/${params.qsc_trendScoreThreshold}`, ...checks] };
    } else { // Ranging
        let buyScore = 0;
        const buyChecks: string[] = [];
        if (currentPrice < bb.lower) { buyScore = 2; buyChecks.push(`✅ Price below Lower BB`); } else { buyChecks.push(`❌ Price not below Lower BB`); }
        if (stochRsi.stochRSI < params.qsc_stochRsiOversold) { buyScore++; buyChecks.push(`✅ StochRSI is Oversold`); } else { buyChecks.push(`❌ StochRSI not Oversold`); }
        if (buyScore >= params.qsc_rangeScoreThreshold) return { signal: 'BUY', reasons: [`ℹ️ Range Buy Score: ${buyScore}/${params.qsc_rangeScoreThreshold}`, ...checks, ...buyChecks] };

        let sellScore = 0;
        const sellChecks: string[] = [];
        if (currentPrice > bb.upper) { sellScore = 2; sellChecks.push(`✅ Price above Upper BB`); } else { sellChecks.push(`❌ Price not above Upper BB`); }
        if (stochRsi.stochRSI > params.qsc_stochRsiOverbought) { sellScore++; sellChecks.push(`✅ StochRSI is Overbought`); } else { sellChecks.push(`❌ StochRSI not Overbought`); }
        if (sellScore >= params.qsc_rangeScoreThreshold) return { signal: 'SELL', reasons: [`ℹ️ Range Sell Score: ${sellScore}/${params.qsc_rangeScoreThreshold}`, ...checks, ...sellChecks] };
    }

    return { signal: 'HOLD', reasons: checks };
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
            return getScalpingExpertV2Signal(klines, finalParams);
        case 6: // Profit Locker uses the old score-based scalping logic for entry
            return getProfitLockerSignal(klines, finalParams);
        case 7:
            return getMarketStructureMavenSignal(klines, finalParams);
        case 9:
            return getQuantumScalperSignal(klines, finalParams);
        default:
            return { signal: 'HOLD', reasons: [`Agent (ID: ${agent.id}) not found or is disabled.`] };
    }
};

/**
 * Calculates initial "smart" Stop Loss and Take Profit targets based on market volatility (ATR).
 * Includes "whipsaw protection" to ensure the stop is never too tight.
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

    if (![6, 9].includes(agentId)) { 
        const srLevels = calculateSupportResistance(klines, 15, 0.005);
        if (isLong && srLevels.resistances.length > 0) {
            const nextResistance = srLevels.resistances.find(r => r > entryPrice);
            if (nextResistance && nextResistance < takeProfitPrice) {
                takeProfitPrice = nextResistance;
            }
        } else if (!isLong && srLevels.supports.length > 0) {
            const nextSupport = [...srLevels.supports].reverse().find(s => s < entryPrice);
            if (nextSupport && nextSupport > takeProfitPrice) {
                takeProfitPrice = nextSupport;
            }
        }
    }
    
    const minStopDistance = entryPrice * (MIN_STOP_LOSS_PERCENT / 100);
    let finalStopLossPrice = isLong ? Math.min(atrStopLossPrice, entryPrice - minStopDistance) : Math.max(atrStopLossPrice, entryPrice + minStopDistance);

    if (agentId === 7) {
        const lookback = params.msm_swingPointLookback;
        let slLevel: number | undefined;

        if (isLong) {
            const pivots = findPivotsGeneric(klines.map(k => k.low), lookback);
            slLevel = pivots.lows.pop()?.value;
        } else {
            const pivots = findPivotsGeneric(klines.map(k => k.high), lookback);
            slLevel = pivots.highs.pop()?.value;
        }

        if (slLevel) {
            const buffer = entryPrice * 0.001;
            const structureSl = isLong ? slLevel - buffer : slLevel + buffer;
            finalStopLossPrice = isLong ? Math.min(finalStopLossPrice, structureSl) : Math.max(finalStopLossPrice, structureSl);
        }
    }
    else if (agentId === 9) {
        const stopDistance = (typeof atr === 'number' && atr > 0) ? (atr * params.qsc_atrMultiplier!) : (entryPrice * 0.02);
        const qscStopLossPrice = isLong ? entryPrice - stopDistance : entryPrice + stopDistance;
        finalStopLossPrice = isLong ? Math.min(qscStopLossPrice, entryPrice - minStopDistance) : Math.max(qscStopLossPrice, entryPrice + minStopDistance);
        takeProfitPrice = isLong ? entryPrice + (stopDistance * 100) : entryPrice - (stopDistance * 100);
    }
    else if (agentId === 6) {
        if (typeof atr === 'number' && atr > 0) {
            const atrMultipliers = [0.5, 1.0, 1.5];
            const partialTps = atrMultipliers.map(mult => ({
                price: isLong ? entryPrice + (atr * mult) : entryPrice - (atr * mult),
                hit: false,
                sizeFraction: 0.25
            }));
            const trailStartPrice = partialTps[2].price;
            takeProfitPrice = trailStartPrice;

            return { stopLossPrice: finalStopLossPrice, takeProfitPrice, partialTps, trailStartPrice };
        }
    }

    return { stopLossPrice: finalStopLossPrice, takeProfitPrice };
};

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
    const lastVolume = volumes[volumes.length - 1];
    const avgVolume = volumeSma[volumeSma.length - 1];

    let exhaustionScore = 0;
    const reasons: string[] = [];

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

    if (direction === 'LONG' && lastKline.close < lastKline.open) {
        exhaustionScore++;
        reasons.push('Reversal price action');
    } else if (direction === 'SHORT' && lastKline.close > lastKline.open) {
        exhaustionScore++;
        reasons.push('Reversal price action');
    }

    if (lastVolume < avgVolume) {
        exhaustionScore++;
        reasons.push('Declining volume');
    }

    const veto = exhaustionScore >= 2;
    return { veto, reasons: veto ? reasons : [] };
};

const getProfitLockAndTrailSignal = (
    position: Position,
    livePrice: number
): { newStopLoss?: number; newTakeProfit?: number; reason?: string } => {
    const { TAKER_FEE_RATE } = constants;
    const isLong = position.direction === 'LONG';
    const positionValue = position.entryPrice * position.size;
    
    const feeInQuote = positionValue * TAKER_FEE_RATE * 2; // For entry and exit
    
    const unrealizedPnl = (livePrice - position.entryPrice) * position.size * (isLong ? 1 : -1);

    if (unrealizedPnl > feeInQuote * 3) {
        const lockableProfit = unrealizedPnl - feeInQuote;
        const priceChangeForProfit = lockableProfit / position.size;

        const newStopLoss = isLong
            ? position.entryPrice + priceChangeForProfit
            : position.entryPrice - priceChangeForProfit;

        const isImprovement = (isLong && newStopLoss > position.stopLossPrice) || (!isLong && newStopLoss < position.stopLossPrice);
        if (isImprovement) {
            // Maintain R:R
            const initialRiskDistance = Math.abs(position.entryPrice - position.initialStopLossPrice);
            const initialRewardDistance = Math.abs(position.initialTakeProfitPrice - position.entryPrice);
            
            if (initialRiskDistance > 0) {
                const initialRR = initialRewardDistance / initialRiskDistance;
                const newRiskDistance = Math.abs(position.entryPrice - newStopLoss);
                const newRewardDistance = newRiskDistance * initialRR;
                const newTakeProfit = isLong 
                    ? position.entryPrice + newRewardDistance 
                    : position.entryPrice - newRewardDistance;
                
                return {
                    newStopLoss,
                    newTakeProfit,
                    reason: `Profit lock active. PNL ~$${unrealizedPnl.toFixed(2)} > 3x Fees.`,
                };
            }
        }
    }

    return {};
}

// --- Proactive Trade Management ---
export const getTradeManagementSignal = async (
    position: Position,
    klines: Kline[],
    livePrice: number,
    botConfig: BotConfig
): Promise<TradeManagementSignal> => {
    const finalParams = { ...constants.DEFAULT_AGENT_PARAMS, ...botConfig.agentParams };

    // --- PRIORITY 1: Universal Profit Locking (unconditional) ---
    const profitLockSignal = getProfitLockAndTrailSignal(position, livePrice);
    if (profitLockSignal.newStopLoss && profitLockSignal.newTakeProfit) {
        return {
            newStopLoss: profitLockSignal.newStopLoss,
            newTakeProfit: profitLockSignal.newTakeProfit,
            reasons: [profitLockSignal.reason!],
        };
    }

    // --- PRIORITY 2: Check for agent signal reversal to close position ---
    if (![4, 9].includes(botConfig.agent.id)) {
        const latestSignal = await getTradingSignal(botConfig.agent, klines, botConfig.timeFrame, botConfig.agentParams);
        if (
            (position.direction === 'LONG' && latestSignal.signal === 'SELL') ||
            (position.direction === 'SHORT' && latestSignal.signal === 'BUY')
        ) {
            return {
                closePosition: true,
                reasons: [`Signal reversed to ${latestSignal.signal}. Closing position.`],
            };
        }
    }

    // --- PRIORITY 3: Agent-specific trailing logic ---
    // This logic runs if the higher-priority signals didn't trigger.
    switch (botConfig.agent.id) {
        case 4: // Scalping Expert V2
            return getScalpingExpertV2ManagementSignal(position, klines, livePrice, finalParams);
        case 6: // Profit Locker (ATR TPs)
            return getAtrTpTrailSignal(position, klines, livePrice, finalParams);
        case 9: // Quantum Scalper
            return getQuantumScalperTrailSignal(position, klines, finalParams);
    }

    return { reasons: ["Holding initial targets."] };
};


const getScalpingExpertV2ManagementSignal = (
    position: Position,
    klines: Kline[],
    livePrice: number,
    params: Required<AgentParams>
): TradeManagementSignal => {
    const isLong = position.direction === 'LONG';
    const closes = klines.map(k => k.close);

    const macdValues = MACD.calculate({ values: closes, fastPeriod: params.se_macdFastPeriod!, slowPeriod: params.se_macdSlowPeriod!, signalPeriod: params.se_macdSignalPeriod!, SimpleMAOscillator: false, SimpleMASignal: false });
    if (macdValues.length >= 3) {
        const lastMacd = macdValues[macdValues.length - 1];
        const prevMacd = macdValues[macdValues.length - 2];
        if (isLong && lastMacd.histogram! > 0 && lastMacd.histogram! < prevMacd.histogram!) return { closePosition: true, reasons: ['MACD histogram momentum is fading.'] };
        if (!isLong && lastMacd.histogram! < 0 && lastMacd.histogram! > prevMacd.histogram!) return { closePosition: true, reasons: ['MACD histogram momentum is fading.'] };
    }

    const emaFast = getLast(EMA.calculate({ period: params.se_emaFastPeriod!, values: closes }));
    const emaSlow = getLast(EMA.calculate({ period: params.se_emaSlowPeriod!, values: closes }));
    if (typeof emaFast === 'number' && typeof emaSlow === 'number') {
        if (isLong && emaFast < emaSlow) return { closePosition: true, reasons: ['Bearish EMA cross occurred.'] };
        if (!isLong && emaFast > emaSlow) return { closePosition: true, reasons: ['Bullish EMA cross occurred.'] };
    }

    const atr = getLast(ATR.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes, period: params.se_atrPeriod! }));
    if (typeof atr === 'number' && atr > 0) {
        const trailDistance = atr * 1.5; 
        const newStopLoss = isLong ? livePrice - trailDistance : livePrice + trailDistance;
        const isImprovement = (isLong && newStopLoss > position.stopLossPrice) || (!isLong && newStopLoss < position.stopLossPrice);
        if (isImprovement) return { newStopLoss, reasons: [`ATR Trailing Stop updated to ${newStopLoss.toFixed(position.pricePrecision)}.`] };
    }

    return { reasons: ['Holding position, no exit conditions met.'] };
};

const getAtrTpTrailSignal = (
    position: Position,
    klines: Kline[],
    livePrice: number,
    params: Required<AgentParams>
): TradeManagementSignal => {
    if (!position.partialTps || typeof position.trailStartPrice !== 'number') return { reasons: ['Position not configured for partial TPs.'] };

    const isLong = position.direction === 'LONG';

    for (let i = 0; i < position.partialTps.length; i++) {
        const tp = position.partialTps[i];
        if (!tp.hit) {
            const priceConditionMet = isLong ? livePrice >= tp.price : livePrice <= tp.price;
            if (priceConditionMet) {
                return { partialClose: { tpIndex: i, reason: `Partial Take Profit ${i + 1} hit` }, reasons: [`Triggering partial close for TP${i + 1}.`] };
            }
            break; 
        }
    }

    const trailConditionMet = isLong ? livePrice >= position.trailStartPrice : livePrice <= position.trailStartPrice;
    if (trailConditionMet) {
        const atr = getLast(ATR.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: klines.map(k => k.close), period: params.atrPeriod }));
        if (typeof atr === 'number' && atr > 0) {
            const trailDistance = atr * 0.5;
            const newStopLoss = isLong ? livePrice - trailDistance : livePrice + trailDistance;
            const isImprovement = (isLong && newStopLoss > position.stopLossPrice) || (!isLong && newStopLoss < position.stopLossPrice);
            if (isImprovement) return { newStopLoss, reasons: [`Trailing stop activated/updated.`] };
        }
    }

    return { reasons: ['Holding position.'] };
};

const getQuantumScalperTrailSignal = (
    position: Position,
    klines: Kline[],
    params: Required<AgentParams>
): TradeManagementSignal => {
    const reasons: string[] = [];
    const isLong = position.direction === 'LONG';

    const psarResult = PSAR.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), step: params.qsc_psarStep!, max: params.qsc_psarMax! });
    const psarStopLoss = (psarResult.length >= 2) ? psarResult[psarResult.length - 2] : undefined;

    if (psarStopLoss) {
        const isImprovement = (isLong && psarStopLoss > position.stopLossPrice) || (!isLong && psarStopLoss < position.stopLossPrice);
        if (isImprovement) {
            return { newStopLoss: psarStopLoss, reasons: [`PSAR trail updated to ${psarStopLoss.toFixed(position.pricePrecision)}.`] };
        }
    }
    
    return { reasons: ['Holding current stop.'] };
};
