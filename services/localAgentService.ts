import type { Agent, TradeSignal, Kline, AgentParams, Position, ADXOutput, MACDOutput, BollingerBandsOutput, StochasticRSIOutput, TradeManagementSignal } from '../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR } from 'technicalindicators';
import { TIMEFRAME_ADAPTIVE_SETTINGS, DEFAULT_AGENT_PARAMS } from '../constants';


const getLast = <T>(arr: T[] | undefined): T | undefined => arr && arr.length > 0 ? arr[arr.length - 1] : undefined;


// --- Agent 1: Momentum Master ---
const getMomentumMasterSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    if (klines.length < params.mom_emaSlowPeriod) {
        return { signal: 'HOLD', reasons: [`Not enough klines for Momentum Master analysis (need ${params.mom_emaSlowPeriod}).`] };
    }
    const reasons: string[] = [];
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);

    // Calculate indicators dynamically using params
    const adx = getLast(ADX.calculate({ close: closes, high: highs, low: lows, period: params.adxPeriod })) as ADXOutput | undefined;
    const macd = getLast(MACD.calculate({ values: closes, fastPeriod: params.macdFastPeriod, slowPeriod: params.macdSlowPeriod, signalPeriod: params.macdSignalPeriod, SimpleMAOscillator: false, SimpleMASignal: false })) as MACDOutput | undefined;
    const rsi = getLast(RSI.calculate({ period: params.rsiPeriod, values: closes }));
    const emaFast = getLast(EMA.calculate({ period: params.mom_emaFastPeriod, values: closes }));
    const emaSlow = getLast(EMA.calculate({ period: params.mom_emaSlowPeriod, values: closes }));

    if (!adx || !macd || macd.histogram === undefined || typeof rsi !== 'number' || !emaFast || !emaSlow) {
        return { signal: 'HOLD', reasons: ["Could not calculate all momentum indicators."] };
    }

    if (adx.adx < params.adxTrendThreshold) {
        return { signal: 'HOLD', reasons: [`Market is not trending (ADX: ${adx.adx.toFixed(1)} < ${params.adxTrendThreshold}). Momentum signals are unreliable.`] };
    }

    let signal: TradeSignal['signal'] = 'HOLD';
    const isBullish = adx.pdi > adx.mdi && macd.histogram > 0 && rsi > params.mom_rsiThresholdBullish && emaFast > emaSlow;
    const isBearish = adx.pdi < adx.mdi && macd.histogram < 0 && rsi < params.mom_rsiThresholdBearish && emaFast < emaSlow;

    if (isBullish) {
        signal = 'BUY';
        reasons.push(`Strong bullish trend detected (ADX: ${adx.adx.toFixed(1)}).`);
        reasons.push(`Positive momentum (MACD > 0, RSI: ${rsi.toFixed(1)} > ${params.mom_rsiThresholdBullish}).`);
        reasons.push(`Uptrend confirmed (EMA ${params.mom_emaFastPeriod} > ${params.mom_emaSlowPeriod}).`);
    } else if (isBearish) {
        signal = 'SELL';
        reasons.push(`Strong bearish trend detected (ADX: ${adx.adx.toFixed(1)}).`);
        reasons.push(`Negative momentum (MACD < 0, RSI: ${rsi.toFixed(1)} < ${params.mom_rsiThresholdBearish}).`);
        reasons.push(`Downtrend confirmed (EMA ${params.mom_emaFastPeriod} < ${params.mom_emaSlowPeriod}).`);
    } else {
        reasons.push(`Market is trending, but momentum signals are not aligned.`);
    }

    return { signal, reasons };
};

// --- Agent 2: Volatility Voyager ---
const getVolatilityVoyagerSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const reasons: string[] = [];
    const closes = klines.map(k => k.close);
    const currentPrice = getLast(closes);
    
    const bbValues = BollingerBands.calculate({ period: params.vol_bbPeriod, stdDev: params.vol_bbStdDev, values: closes }) as BollingerBandsOutput[];
    const bb = getLast(bbValues);
    const stochRsiInput = { rsiPeriod: params.vol_stochRsiRsiPeriod, stochasticPeriod: params.vol_stochRsiStochasticPeriod, kPeriod: params.vol_stochRsiKPeriod, dPeriod: params.vol_stochRsiDPeriod, values: closes };
    const stochRsi = getLast(StochasticRSI.calculate(stochRsiInput)) as StochasticRSIOutput | undefined;
    const emaTrend = getLast(EMA.calculate({ period: params.vol_emaTrendPeriod, values: closes }));

    if (!currentPrice || !bb || !stochRsi || typeof stochRsi.k !== 'number' || !emaTrend || bbValues.length < 50) return { signal: 'HOLD', reasons: ["Could not calculate all volatility indicators."] };
    
    const bbwHistory = bbValues.map(b => b.middle > 0 ? (b.upper - b.lower) / b.middle : 0).filter(v => v > 0);
    const lookbackPeriod = 50;
    if (bbwHistory.length < lookbackPeriod) return { signal: 'HOLD', reasons: ["Not enough data for BBW squeeze check."] };
    
    const currentBbw = bbwHistory[bbwHistory.length - 1];
    const minBbwInPeriod = Math.min(...bbwHistory.slice(-lookbackPeriod));
    const isInSqueeze = currentBbw <= minBbwInPeriod * 1.15;

    if (!isInSqueeze) {
         return { signal: 'HOLD', reasons: [`No BBW squeeze detected. Awaiting volatility contraction.`] };
    }
    reasons.push(`BBW Squeeze detected (potential for breakout).`);

    let signal: TradeSignal['signal'] = 'HOLD';
    const isBreakoutBuy = currentPrice > bb.upper && stochRsi.k > params.vol_stochRsiUpperThreshold && currentPrice > emaTrend;
    const isBreakoutSell = currentPrice < bb.lower && stochRsi.k < params.vol_stochRsiLowerThreshold && currentPrice < emaTrend;

    if (isBreakoutBuy) {
        signal = 'BUY';
        reasons.push(`Price broke above upper Bollinger Band post-squeeze.`);
        reasons.push(`Momentum confirmed (StochRSI.k: ${stochRsi.k.toFixed(1)} > ${params.vol_stochRsiUpperThreshold}).`);
        reasons.push(`Trend confirmed (Price > EMA ${params.vol_emaTrendPeriod}).`);
    } else if (isBreakoutSell) {
        signal = 'SELL';
        reasons.push(`Price broke below lower Bollinger Band post-squeeze.`);
        reasons.push(`Momentum confirmed (StochRSI.k: ${stochRsi.k.toFixed(1)} < ${params.vol_stochRsiLowerThreshold}).`);
         reasons.push(`Trend confirmed (Price < EMA ${params.vol_emaTrendPeriod}).`);
    } else {
        reasons.push(`Squeeze is on, but awaiting breakout from bands.`);
    }

    return { signal, reasons };
};

// --- Agent 3: Trend Surfer ---
const getTrendSurferSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const reasons: string[] = [];
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const currentPrice = getLast(closes);
    
    const emaFast = getLast(EMA.calculate({ period: params.trend_emaFastPeriod, values: closes }));
    const emaSlow = getLast(EMA.calculate({ period: params.trend_emaSlowPeriod, values: closes }));
    const adx = getLast(ADX.calculate({ close: closes, high: highs, low: lows, period: params.adxPeriod })) as ADXOutput | undefined;
    const psar = getLast(PSAR.calculate({ high: highs, low: lows, step: params.psarStep, max: params.psarMax }));

    if (!currentPrice || !emaFast || !emaSlow || !adx || typeof psar !== 'number') return { signal: 'HOLD', reasons: ["Could not calculate all trend indicators."] };

    if (adx.adx < params.trend_adxThreshold) {
        return { signal: 'HOLD', reasons: [`Market is not trending (ADX: ${adx.adx.toFixed(1)} < ${params.trend_adxThreshold}). Trend Surfer is idle.`] };
    }

    let signal: TradeSignal['signal'] = 'HOLD';
    const isBullish = emaFast > emaSlow && currentPrice > psar;
    const isBearish = emaFast < emaSlow && currentPrice < psar;

    if (isBullish) {
        signal = 'BUY';
        reasons.push(`Long-term uptrend confirmed (EMA ${params.trend_emaFastPeriod} > ${params.trend_emaSlowPeriod}).`);
        reasons.push(`Price is above Parabolic SAR, confirming buy signal.`);
    } else if (isBearish) {
        signal = 'SELL';
        reasons.push(`Long-term downtrend confirmed (EMA ${params.trend_emaFastPeriod} < ${params.trend_emaSlowPeriod}).`);
        reasons.push(`Price is below Parabolic SAR, confirming sell signal.`);
    } else {
        reasons.push(`Market is trending, but entry signals (PSAR) are not aligned with long-term EMA direction.`);
    }
    
    return { signal, reasons };
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


// --- Agent 4: Scalping Expert ---
function getScalpingAgentSignal(klines: Kline[], params: Required<AgentParams>): TradeSignal {
    const reasons: string[] = [];
    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes);

    const macdInput = { values: closes, fastPeriod: params.macdFastPeriod, slowPeriod: params.macdSlowPeriod, signalPeriod: params.macdSignalPeriod, SimpleMAOscillator: false, SimpleMASignal: false };
    const macdValues = MACD.calculate(macdInput) as MACDOutput[];
    const macd = getLast(macdValues);
    const prevMacd = macdValues.length > 1 ? macdValues[macdValues.length - 2] : undefined;
    const rsi = getLast(RSI.calculate({ period: params.scalp_rsiPeriod, values: closes }));
    const bb = getLast(BollingerBands.calculate({ period: params.scalp_bbPeriod, stdDev: params.scalp_bbStdDev, values: closes })) as BollingerBandsOutput | undefined;
    const st = calculateSuperTrend(klines, params.scalp_superTrendPeriod, params.scalp_superTrendMultiplier);
    const volumeSma = getLast(SMA.calculate({ period: params.scalp_volumeSmaPeriod, values: volumes }));
    const currentVolume = getLast(volumes);
    const ema5 = getLast(EMA.calculate({ period: params.scalp_emaFastPeriod, values: closes }));
    const ema20 = getLast(EMA.calculate({ period: params.scalp_emaSlowPeriod, values: closes }));

    if (!currentPrice || !ema5 || !ema20 || !macd || !prevMacd || typeof rsi !== 'number' || !bb || !st || typeof volumeSma !== 'number' || typeof currentVolume !== 'number') {
        return { signal: 'HOLD', reasons: ["Could not calculate all required indicators for scalping."] };
    }
    if (macd.MACD === undefined || macd.signal === undefined || prevMacd.MACD === undefined || prevMacd.signal === undefined) return { signal: 'HOLD', reasons: ["Invalid MACD data."] };
    
    let buyScore = 0, sellScore = 0;

    if (st.trend === 'bullish') { buyScore += 5; reasons.push(`(B+5) SuperTrend is bullish.`); }
    if (st.trend === 'bearish') { sellScore += 5; reasons.push(`(S+5) SuperTrend is bearish.`); }
    if (ema5 > ema20) { buyScore += 5; reasons.push(`(B+5) Bullish EMA Crossover (${params.scalp_emaFastPeriod}/${params.scalp_emaSlowPeriod}).`); }
    if (ema5 < ema20) { sellScore += 5; reasons.push(`(S+5) Bearish EMA Crossover (${params.scalp_emaFastPeriod}/${params.scalp_emaSlowPeriod}).`); }
    if (prevMacd.MACD < prevMacd.signal && macd.MACD > macd.signal) { buyScore += 3; reasons.push(`(B+3) Bullish MACD Crossover.`); }
    if (prevMacd.MACD > prevMacd.signal && macd.MACD < macd.signal) { sellScore += 3; reasons.push(`(S+3) Bearish MACD Crossover.`); }
    if (rsi < params.scalp_rsiBuyThreshold) { buyScore += 4; reasons.push(`(B+4) RSI is oversold (${rsi.toFixed(1)} < ${params.scalp_rsiBuyThreshold}).`); }
    if (rsi > params.scalp_rsiSellThreshold) { sellScore += 4; reasons.push(`(S+4) RSI is overbought (${rsi.toFixed(1)} > ${params.scalp_rsiSellThreshold}).`); }
    if (currentPrice <= bb.lower) { buyScore += 4; reasons.push(`(B+4) Price at lower Bollinger Band.`); }
    if (currentPrice >= bb.upper) { sellScore += 4; reasons.push(`(S+4) Price at upper Bollinger Band.`); }
    if (currentVolume > volumeSma * 1.5) { buyScore += 2; sellScore += 2; reasons.push(`(B+2 S+2) Volume spike confirms momentum.`); }

    let signal: TradeSignal['signal'] = 'HOLD';
    if (buyScore >= params.scalp_scoreThreshold) signal = 'BUY';
    else if (sellScore >= params.scalp_scoreThreshold) signal = 'SELL';
    else reasons.push('No strong entry signal found. Strict conditions not met.');

    return { signal, reasons };
}

// --- Agent 5 & 6: Smart Agent & Profit Locker (shared entry logic) ---
function getSmartAgentSignal(klines: Kline[], params: Required<AgentParams>): TradeSignal {
    const reasons: string[] = [];
    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes);
    
    const st = calculateSuperTrend(klines, params.smart_superTrendPeriod, params.smart_superTrendMultiplier);
    const ema9 = getLast(EMA.calculate({ period: params.smart_emaFastPeriod, values: closes }));
    const ema20 = getLast(EMA.calculate({ period: params.smart_emaSlowPeriod, values: closes }));
    const rsi = getLast(RSI.calculate({ period: params.smart_rsiPeriod, values: closes }));
    const macdInput = { values: closes, fastPeriod: params.macdFastPeriod, slowPeriod: params.macdSlowPeriod, signalPeriod: params.macdSignalPeriod, SimpleMAOscillator: false, SimpleMASignal: false };
    const macdValues = MACD.calculate(macdInput) as MACDOutput[];
    const macd = getLast(macdValues);
    const prevMacd = macdValues.length > 1 ? macdValues[macdValues.length - 2] : undefined;
    const currentVolume = getLast(volumes);
    const volumeSma = getLast(SMA.calculate({ period: params.smart_volumeSmaPeriod, values: volumes }));

    if(!currentPrice || !st || !ema9 || !ema20 || typeof rsi !== 'number' || !macd || !prevMacd || macd.MACD === undefined || macd.signal === undefined || prevMacd.MACD === undefined || prevMacd.signal === undefined || typeof currentVolume !== 'number' || typeof volumeSma !== 'number') {
        return { signal: 'HOLD', reasons: ["Not enough data for Smart Agent analysis."] };
    }

    let score = 0;
    const MAX_SCORE = 29;
    
    if (st.trend === 'bullish') { score += 10; reasons.push("(+10) SuperTrend is bullish."); } 
    else { score -= 10; reasons.push("(-10) SuperTrend is bearish."); }

    if (ema9 > ema20) { score += 7; reasons.push(`(+7) Short-term momentum is bullish (EMA ${params.smart_emaFastPeriod} > ${params.smart_emaSlowPeriod}).`); } 
    else { score -= 7; reasons.push(`(-7) Short-term momentum is bearish (EMA ${params.smart_emaFastPeriod} < ${params.smart_emaSlowPeriod}).`); }
  
    if (prevMacd.MACD < prevMacd.signal && macd.MACD > macd.signal) { score += 5; reasons.push("(+5) Bullish MACD crossover detected."); }
    else if (prevMacd.MACD > prevMacd.signal && macd.MACD < macd.signal) { score -= 5; reasons.push("(-5) Bearish MACD crossover detected."); }

    if (rsi > params.smart_rsiBuyThreshold) { score += 4; reasons.push(`(+4) RSI (${rsi.toFixed(1)} > ${params.smart_rsiBuyThreshold}) shows bullish momentum.`); } 
    else if (rsi < params.smart_rsiSellThreshold) { score -= 4; reasons.push(`(-4) RSI (${rsi.toFixed(1)} < ${params.smart_rsiSellThreshold}) shows bearish momentum.`); } 
    else { reasons.push(`(0) RSI (${rsi.toFixed(1)}) is neutral.`); }

    if (currentVolume > volumeSma * 1.5) {
        if (score > 0) { score += 3; reasons.push("(+3) Volume spike confirms bullish bias."); }
        if (score < 0) { score -= 3; reasons.push("(-3) Volume spike confirms bearish bias."); }
    }
    
    const confidence = score / MAX_SCORE;
    reasons.push(`Final Confidence Score: ${confidence.toFixed(2)}`);

    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (confidence >= params.smart_confidenceThreshold) action = 'BUY';
    else if (confidence <= -params.smart_confidenceThreshold) action = 'SELL';
  
    if (action === 'HOLD') reasons.push("Confidence threshold not met. Holding position.");
    return { signal: action, reasons };
}


// --- Agent 7: Market Structure Maven (CORRECTED LOGIC) ---
const findSwingPoints = (klines: Kline[], lookback: number): { highs: { price: number, index: number }[], lows: { price: number, index: number }[] } => {
    const swingHighs: { price: number, index: number }[] = [];
    const swingLows: { price: number, index: number }[] = [];

    for (let i = lookback; i < klines.length - lookback; i++) {
        let isSwingHigh = true;
        let isSwingLow = true;

        for (let j = 1; j <= lookback; j++) {
            if (klines[i].high <= klines[i - j].high || klines[i].high < klines[i + j].high) {
                isSwingHigh = false;
            }
            if (klines[i].low >= klines[i - j].low || klines[i].low > klines[i + j].low) {
                isSwingLow = false;
            }
        }

        if (isSwingHigh) {
            swingHighs.push({ price: klines[i].high, index: i });
        }
        if (isSwingLow) {
            swingLows.push({ price: klines[i].low, index: i });
        }
    }
    return { highs: swingHighs, lows: swingLows };
};

const getMarketStructureMavenSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const reasons: string[] = [];
    const lookback = params.msm_swingPointLookback; 
    if (klines.length < params.msm_htfEmaPeriod || klines.length < 60) {
        return { signal: 'HOLD', reasons: ["Not enough historical data for analysis."] };
    }

    const closes = klines.map(k => k.close);
    const currentPrice = getLast(closes);
    const currentCandle = getLast(klines);

    if (!currentPrice || !currentCandle) {
        return { signal: 'HOLD', reasons: ["No current price data."] };
    }

    const htfEma = getLast(EMA.calculate({ period: params.msm_htfEmaPeriod, values: closes }));
    if (typeof htfEma !== 'number') return { signal: 'HOLD', reasons: ["Calculating HTF Bias..."] };
    const bias = currentPrice > htfEma ? 'BULLISH' : 'BEARISH';
    reasons.push(`Directional Bias is ${bias} (Price vs EMA ${params.msm_htfEmaPeriod})`);

    const structuralKlines = klines.slice(-60); 
    const swingPoints = findSwingPoints(structuralKlines, lookback);
    
    const recentSwingHighs = [...swingPoints.highs].reverse();
    const recentSwingLows = [...swingPoints.lows].reverse();

    let signal: TradeSignal['signal'] = 'HOLD';
    
    if (bias === 'BULLISH' && recentSwingLows.length > 1 && recentSwingHighs.length > 0) {
        const lastSwingLow = recentSwingLows[0];
        const prevSwingLowToSweep = recentSwingLows[1];
        const boSLevelHigh = recentSwingHighs.find(h => h.index > prevSwingLowToSweep.index && h.index < lastSwingLow.index);
        
        if (boSLevelHigh) {
            const candleIndexSweepingStart = structuralKlines.findIndex(k => k.low < prevSwingLowToSweep.price);
            const hasSweptLow = candleIndexSweepingStart !== -1;
            const hasBrokenStructure = currentCandle.close > boSLevelHigh.price;

            if (hasSweptLow) {
                reasons.push(`Liquidity swept below previous swing low at ${prevSwingLowToSweep.price.toFixed(4)}.`);
            }
            if (hasBrokenStructure && hasSweptLow) {
                signal = 'BUY';
                reasons.push(`Bullish Market Structure Shift confirmed by break of BoS level ${boSLevelHigh.price.toFixed(4)}.`);
            }
        }
    }
    
    if (bias === 'BEARISH' && recentSwingHighs.length > 1 && recentSwingLows.length > 0) {
        const lastSwingHigh = recentSwingHighs[0];
        const prevSwingHighToSweep = recentSwingHighs[1];
        const boSLevelLow = recentSwingLows.find(l => l.index > prevSwingHighToSweep.index && l.index < lastSwingHigh.index);

        if (boSLevelLow) {
            const candleIndexSweepingStart = structuralKlines.findIndex(k => k.high > prevSwingHighToSweep.price);
            const hasSweptHigh = candleIndexSweepingStart !== -1;
            const hasBrokenStructure = currentCandle.close < boSLevelLow.price;
            
            if (hasSweptHigh) {
                reasons.push(`Liquidity swept above previous swing high at ${prevSwingHighToSweep.price.toFixed(4)}.`);
            }
            if (hasBrokenStructure && hasSweptHigh) {
                signal = 'SELL';
                reasons.push(`Bearish Market Structure Shift confirmed by break of BoS level ${boSLevelLow.price.toFixed(4)}.`);
            }
        }
    }

    if (signal === 'HOLD') {
        reasons.push("Awaiting valid market structure shift setup.");
    }
    return { signal, reasons };
};

// --- Agent 8: Institutional Scalper (CORRECTED LOGIC) ---
const getInstitutionalScalperSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const lookbackPeriod = params.inst_lookbackPeriod;
    if (klines.length < lookbackPeriod + 2) {
        return { signal: 'HOLD', reasons: [`Need at least ${lookbackPeriod + 2} klines for analysis.`] };
    }

    const reasons: string[] = [];
    const currentCandle = klines[klines.length - 1];
    const prevCandle = klines[klines.length - 2];
    
    // Lookback candles should be before the previous candle, as the previous candle is part of the setup
    const lookbackCandles = klines.slice(klines.length - 2 - lookbackPeriod, klines.length - 2);

    if (!currentCandle || !prevCandle || lookbackCandles.length < lookbackPeriod) {
        return { signal: 'HOLD', reasons: ['Not enough candles for lookback.'] };
    }

    // --- BUY SETUP ---
    const isBullishEngulfing = currentCandle.close > currentCandle.open && 
                               prevCandle.close < prevCandle.open &&
                               currentCandle.close > prevCandle.open && 
                               currentCandle.open < prevCandle.close;

    if (isBullishEngulfing) {
        reasons.push('Bullish engulfing candle detected.');
        
        const lookbackLow = Math.min(...lookbackCandles.map(k => k.low));
        // A sweep can happen on the previous candle (the red one) or the current one (the green one)
        const hasSwept = prevCandle.low < lookbackLow || currentCandle.low < lookbackLow;
        
        if (hasSwept) {
            reasons.push(`Liquidity grab below ${lookbackPeriod}-candle low of ${lookbackLow.toFixed(4)}.`);
            
            const currentBody = currentCandle.close - currentCandle.open;
            const prevBody = prevCandle.open - prevCandle.close;
            const isPowerCandle = currentBody > prevBody * params.inst_powerCandleMultiplier;

            if (isPowerCandle) {
                reasons.push(`Power candle confirmed (body > ${params.inst_powerCandleMultiplier}x previous).`);
                return { signal: 'BUY', reasons };
            } else {
                reasons.push('HOLD: Confirmation failed. Not a power candle.');
                return { signal: 'HOLD', reasons };
            }
        } else {
            reasons.push('HOLD: Confirmation failed. No liquidity grab.');
            return { signal: 'HOLD', reasons };
        }
    }

    // --- SELL SETUP ---
    const isBearishEngulfing = currentCandle.close < currentCandle.open && 
                               prevCandle.close > prevCandle.open &&
                               currentCandle.close < prevCandle.open && 
                               currentCandle.open > prevCandle.close;

    if (isBearishEngulfing) {
        reasons.push('Bearish engulfing candle detected.');
        
        const lookbackHigh = Math.max(...lookbackCandles.map(k => k.high));
        // A sweep can happen on the previous candle (the green one) or the current one (the red one)
        const hasSwept = prevCandle.high > lookbackHigh || currentCandle.high > lookbackHigh;

        if (hasSwept) {
            reasons.push(`Liquidity grab above ${lookbackPeriod}-candle high of ${lookbackHigh.toFixed(4)}.`);
            
            const currentBody = currentCandle.open - currentCandle.close;
            const prevBody = prevCandle.close - prevCandle.open;
            const isPowerCandle = currentBody > prevBody * params.inst_powerCandleMultiplier;

            if (isPowerCandle) {
                reasons.push(`Power candle confirmed (body > ${params.inst_powerCandleMultiplier}x previous).`);
                return { signal: 'SELL', reasons };
            } else {
                reasons.push('HOLD: Confirmation failed. Not a power candle.');
                return { signal: 'HOLD', reasons };
            }
        } else {
            reasons.push('HOLD: Confirmation failed. No liquidity grab.');
            return { signal: 'HOLD', reasons };
        }
    }
    
    // If no engulfing pattern was found at all
    return { signal: 'HOLD', reasons: ['Waiting for a clear engulfing pattern to form.'] };
};


// --- Main Signal Dispatcher ---
export const getTradingSignal = async (
    agent: Agent,
    klines: Kline[],
    timeFrame: string,
    params: AgentParams = {}
): Promise<TradeSignal> => {
    if (klines.length < 200 && agent.id !== 8) { // Institutional Scalper has its own check
        return { signal: 'HOLD', reasons: [`Need at least 200 klines for full analysis (have ${klines.length}).`] };
    }
    
    const timeframeAdaptiveParams = TIMEFRAME_ADAPTIVE_SETTINGS[timeFrame] || {};
    const finalParams = { ...DEFAULT_AGENT_PARAMS, ...timeframeAdaptiveParams, ...params };

    switch (agent.id) {
        case 1:
            return getMomentumMasterSignal(klines, finalParams);
        case 2:
            return getVolatilityVoyagerSignal(klines, finalParams);
        case 3:
            return getTrendSurferSignal(klines, finalParams);
        case 4:
            return getScalpingAgentSignal(klines, finalParams);
        case 5:
            return getSmartAgentSignal(klines, finalParams);
        case 6: // Profit Locker uses Smart Agent entry logic
            return getSmartAgentSignal(klines, finalParams);
        case 7:
            return getMarketStructureMavenSignal(klines, finalParams);
        case 8:
            return getInstitutionalScalperSignal(klines, finalParams);
        default:
            return { signal: 'HOLD', reasons: ['Agent not found.'] };
    }
};

// --- Proactive Trade Management ---
export const getTradeManagementSignal = async (
    position: Position,
    klines: Kline[], // Should be 1-minute klines for granularity
    livePrice: number
): Promise<TradeManagementSignal> => {
    const reasons: string[] = [];
    let newStopLoss: number | undefined = undefined;

    // --- Trailing Stop Loss Logic (SuperTrend) ---
    const isLong = position.direction === 'LONG';
    const isInProfit = isLong ? livePrice > position.entryPrice : livePrice < position.entryPrice;

    if (!isInProfit) {
        reasons.push('Position not yet in profit. Holding targets.');
        return { reasons };
    }

    const st = calculateSuperTrend(klines, 10, 3); // Standard ST params for 1m chart
    if (!st) {
        reasons.push('Calculating SuperTrend for management...');
        return { reasons };
    }
    
    let candidateStopLoss: number | undefined = undefined;

    if (isLong) {
        if (st.trend === 'bullish') {
            if (st.supertrend > position.stopLossPrice) {
                candidateStopLoss = st.supertrend;
                reasons.push(`Proactive Action: Trailing SL to ${candidateStopLoss.toFixed(position.pricePrecision)} based on bullish SuperTrend.`);
            } else {
                reasons.push(`Uptrend confirmed by SuperTrend. Holding current SL as it's more aggressive than ST value of ${st.supertrend.toFixed(position.pricePrecision)}.`);
            }
        } else {
            reasons.push(`SuperTrend flipped bearish. Holding SL and monitoring for exit conditions.`);
        }
    } else { // SHORT
        if (st.trend === 'bearish') {
            if (st.supertrend < position.stopLossPrice) {
                candidateStopLoss = st.supertrend;
                reasons.push(`Proactive Action: Trailing SL to ${candidateStopLoss.toFixed(position.pricePrecision)} based on bearish SuperTrend.`);
            } else {
                reasons.push(`Downtrend confirmed by SuperTrend. Holding current SL as it's more aggressive than ST value of ${st.supertrend.toFixed(position.pricePrecision)}.`);
            }
        } else {
            reasons.push(`SuperTrend flipped bullish. Holding SL and monitoring for exit conditions.`);
        }
    }

    // CRITICAL SAFETY CHECK: Ensure the new SL does not go past the liquidation price
    if (candidateStopLoss !== undefined && position.liquidationPrice && position.liquidationPrice > 0) {
        if (isLong) {
            if (candidateStopLoss < position.liquidationPrice) {
                // Adjust SL to be slightly safer than liquidation
                newStopLoss = position.liquidationPrice * 1.001; 
                reasons.push(`Safety Override: Adjusted SL from ${candidateStopLoss.toFixed(position.pricePrecision)} to ${newStopLoss.toFixed(position.pricePrecision)} to avoid liquidation.`);
            } else {
                newStopLoss = candidateStopLoss;
            }
        } else { // SHORT
            if (candidateStopLoss > position.liquidationPrice) {
                // Adjust SL to be slightly safer than liquidation
                newStopLoss = position.liquidationPrice * 0.999;
                reasons.push(`Safety Override: Adjusted SL from ${candidateStopLoss.toFixed(position.pricePrecision)} to ${newStopLoss.toFixed(position.pricePrecision)} to avoid liquidation.`);
            } else {
                newStopLoss = candidateStopLoss;
            }
        }
    } else if (candidateStopLoss !== undefined) {
        newStopLoss = candidateStopLoss;
    }


    return { reasons, newStopLoss };
};