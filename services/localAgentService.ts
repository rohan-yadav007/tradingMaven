
import type { Agent, TradeSignal, Kline, AgentParams, Position, ADXOutput, MACDOutput, BollingerBandsOutput, StochasticRSIOutput, TradeManagementSignal, BotConfig } from '../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR } from 'technicalindicators';
import * as constants from '../constants';


const getLast = <T>(arr: T[] | undefined): T | undefined => arr && arr.length > 0 ? arr[arr.length - 1] : undefined;

const quantile = (arr: number[], q: number): number => {
    const sorted = [...arr].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
        return sorted[base];
    }
};

// --- Agent 1: Momentum Master (Upgraded) ---
const getMomentumMasterSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    if (klines.length < params.mom_emaSlowPeriod) {
        return { signal: 'HOLD', reasons: [`Not enough klines for Momentum Master analysis (need ${params.mom_emaSlowPeriod}).`] };
    }
    const reasons: string[] = [];
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);

    // Calculate indicators
    const adx = getLast(ADX.calculate({ close: closes, high: highs, low: lows, period: params.adxPeriod })) as ADXOutput | undefined;
    const macdValues = MACD.calculate({ values: closes, fastPeriod: params.macdFastPeriod, slowPeriod: params.macdSlowPeriod, signalPeriod: params.macdSignalPeriod, SimpleMAOscillator: false, SimpleMASignal: false }) as MACDOutput[];
    const macd = getLast(macdValues);
    const macdHistogram = macdValues.map(m => m.histogram).filter((h): h is number => h !== undefined);
    const rsi = getLast(RSI.calculate({ period: params.rsiPeriod, values: closes }));
    const emaFast = getLast(EMA.calculate({ period: params.mom_emaFastPeriod, values: closes }));
    const emaSlow = getLast(EMA.calculate({ period: params.mom_emaSlowPeriod, values: closes }));
    const volumeSma = getLast(SMA.calculate({ period: params.mom_volumeSmaPeriod, values: volumes }));
    const currentVolume = getLast(volumes);
    
    if (!adx || !macd || typeof macd.histogram !== 'number' || typeof rsi !== 'number' || typeof emaFast !== 'number' || typeof emaSlow !== 'number' || typeof volumeSma !== 'number' || typeof currentVolume !== 'number') {
        return { signal: 'HOLD', reasons: ["Could not calculate all momentum indicators."] };
    }

    if (adx.adx < params.adxTrendThreshold) {
        return { signal: 'HOLD', reasons: [`Market is not trending (ADX: ${adx.adx.toFixed(1)} < ${params.adxTrendThreshold}).`] };
    }
    reasons.push(`Market is trending (ADX: ${adx.adx.toFixed(1)}).`);

    // --- Confirmation Logic ---
    const hasVolumeConfirmation = currentVolume > volumeSma * params.mom_volumeMultiplier;
    const macdIsRising = macdHistogram.length >= 3 && macdHistogram.slice(-3).every((v, i, arr) => i === 0 || v > arr[i-1]);
    const macdIsFalling = macdHistogram.length >= 3 && macdHistogram.slice(-3).every((v, i, arr) => i === 0 || v < arr[i-1]);

    let signal: TradeSignal['signal'] = 'HOLD';
    const isBullish = adx.pdi > adx.mdi && macd.histogram > 0 && rsi > params.mom_rsiThresholdBullish && emaFast > emaSlow;
    const isBearish = adx.pdi < adx.mdi && macd.histogram < 0 && rsi < params.mom_rsiThresholdBearish && emaFast < emaSlow;

    if (isBullish) {
        reasons.push(`Primary bullish signals aligned (EMA Crossover, MACD > 0, RSI > ${params.mom_rsiThresholdBullish}).`);
        if (hasVolumeConfirmation) reasons.push(`Confirmation: Volume spike detected.`);
        if (macdIsRising) reasons.push(`Confirmation: MACD histogram is rising.`);
        
        if (hasVolumeConfirmation && macdIsRising) {
            signal = 'BUY';
            reasons.push(`All confirmations met. Executing BUY.`);
        } else {
            reasons.push(`Awaiting full confirmation (Volume/MACD Slope).`);
        }
    } else if (isBearish) {
        reasons.push(`Primary bearish signals aligned (EMA Crossover, MACD < 0, RSI < ${params.mom_rsiThresholdBearish}).`);
        if (hasVolumeConfirmation) reasons.push(`Confirmation: Volume spike detected.`);
        if (macdIsFalling) reasons.push(`Confirmation: MACD histogram is falling.`);
        
        if (hasVolumeConfirmation && macdIsFalling) {
            signal = 'SELL';
            reasons.push(`All confirmations met. Executing SELL.`);
        } else {
            reasons.push(`Awaiting full confirmation (Volume/MACD Slope).`);
        }
    } else {
        reasons.push(`Trend detected, but momentum signals are not aligned.`);
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


// --- Agent 4: Scalping Expert (Score-based) ---
function getScalpingExpertSignal(klines: Kline[], params: Required<AgentParams>): TradeSignal {
    const minKlines = Math.max(params.scalp_emaPeriod, params.scalp_superTrendPeriod, params.scalp_rsiPeriod) + params.scalp_stochRsiPeriod;
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`Need ${minKlines} klines for Scalping Expert.`] };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const currentPrice = closes[closes.length - 1];

    // Indicators
    const ema = getLast(EMA.calculate({ period: params.scalp_emaPeriod, values: closes }));
    const st = calculateSuperTrend(klines, params.scalp_superTrendPeriod, params.scalp_superTrendMultiplier);
    const psar = getLast(PSAR.calculate({ high: highs, low: lows, step: params.scalp_psarStep, max: params.scalp_psarMax }));
    
    const stochRsiInput = {
        values: closes,
        rsiPeriod: params.scalp_rsiPeriod,
        stochasticPeriod: params.scalp_stochRsiPeriod,
        kPeriod: 3,
        dPeriod: 3,
    };
    const stochRsiResult = StochasticRSI.calculate(stochRsiInput);
    const stochRsi = getLast(stochRsiResult);

    if (typeof ema !== 'number' || !st || typeof psar !== 'number' || !stochRsi) {
        return { signal: 'HOLD', reasons: ["Calculating indicators..."] };
    }

    const reasons: string[] = [];
    let score = 0;

    // --- BUY SCORE ---
    if (currentPrice > ema) { score++; reasons.push(`Price > EMA(${params.scalp_emaPeriod})`); }
    if (st.trend === 'bullish') { score++; reasons.push('SuperTrend is bullish'); }
    if (currentPrice > psar) { score++; reasons.push('PSAR is below price'); }
    if (stochRsi.stochRSI < params.scalp_stochRsiOversold) { score += 2; reasons.push(`StochRSI is oversold (${stochRsi.stochRSI.toFixed(1)}) - Strong Signal`); }

    if (score >= params.scalp_scoreThreshold) {
        return { signal: 'BUY', reasons: [`Buy score of ${score} reached threshold of ${params.scalp_scoreThreshold}.`, ...reasons] };
    }

    // --- SELL SCORE ---
    score = 0;
    reasons.length = 0; // Clear reasons for sell check
    if (currentPrice < ema) { score++; reasons.push(`Price < EMA(${params.scalp_emaPeriod})`); }
    if (st.trend === 'bearish') { score++; reasons.push('SuperTrend is bearish'); }
    if (currentPrice < psar) { score++; reasons.push('PSAR is above price'); }
    if (stochRsi.stochRSI > params.scalp_stochRsiOverbought) { score += 2; reasons.push(`StochRSI is overbought (${stochRsi.stochRSI.toFixed(1)}) - Strong Signal`); }
    
    if (score >= params.scalp_scoreThreshold) {
        return { signal: 'SELL', reasons: [`Sell score of ${score} reached threshold of ${params.scalp_scoreThreshold}.`, ...reasons] };
    }

    return { signal: 'HOLD', reasons: ["Score threshold not met for entry."] };
}


// --- Agent 5 & 6: Market Phase Adaptor (NEW) ---
type MarketPhase = 'TRENDING' | 'RANGING' | 'CHOPPY';
const getMarketPhaseAdaptorSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const minKlineLength = Math.max(params.adxPeriod, params.mpa_rangeBBPeriod, params.mpa_trendEmaSlow) + 1;
    if (klines.length < minKlineLength) {
        return { signal: 'HOLD', reasons: [`Need ${minKlineLength} klines for Market Phase analysis.`] };
    }
    
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const currentPrice = closes[closes.length - 1];

    // --- Phase Detection Indicators ---
    const adx = getLast(ADX.calculate({ close: closes, high: highs, low: lows, period: params.adxPeriod })) as ADXOutput | undefined;
    const bbValues = BollingerBands.calculate({ period: params.mpa_rangeBBPeriod, stdDev: params.mpa_rangeBBStdDev, values: closes }) as BollingerBandsOutput[];
    const currentBB = getLast(bbValues);
    const bbWidth = currentBB ? (currentBB.upper - currentBB.lower) / currentBB.middle : undefined;

    if (!adx || !currentBB || typeof bbWidth !== 'number') {
        return { signal: 'HOLD', reasons: ['Calculating phase detection indicators...'] };
    }
    
    // --- Phase Logic ---
    let phase: MarketPhase = 'CHOPPY';
    if (adx.adx > params.mpa_adxTrend) {
        phase = 'TRENDING';
    } else if (adx.adx < params.mpa_adxChop && bbWidth < params.mpa_bbwSqueeze) {
        phase = 'RANGING';
    }
    
    // --- Strategy Selection ---
    switch (phase) {
        case 'TRENDING': {
            const emaFast = getLast(EMA.calculate({ period: params.mpa_trendEmaFast, values: closes }));
            const emaSlow = getLast(EMA.calculate({ period: params.mpa_trendEmaSlow, values: closes }));
            const prevEmaFast = EMA.calculate({ period: params.mpa_trendEmaFast, values: closes })[closes.length - 2];

            if (typeof emaFast !== 'number' || typeof emaSlow !== 'number' || typeof prevEmaFast !== 'number') {
                return { signal: 'HOLD', reasons: ['Calculating trend indicators...'] };
            }
            
            const uptrend = adx.pdi > adx.mdi && currentPrice > emaSlow;
            const downtrend = adx.mdi > adx.pdi && currentPrice < emaSlow;
            
            if (uptrend && currentPrice < emaFast && prevEmaFast > emaFast) {
                return { signal: 'BUY', reasons: [`Phase: TRENDING`, `Detected pullback to fast EMA in an uptrend.`] };
            }
            if (downtrend && currentPrice > emaFast && prevEmaFast < emaFast) {
                return { signal: 'SELL', reasons: [`Phase: TRENDING`, `Detected pullback to fast EMA in a downtrend.`] };
            }
            return { signal: 'HOLD', reasons: [`Phase: TRENDING`, `Awaiting pullback to EMA ${params.mpa_trendEmaFast}.`] };
        }
        case 'RANGING': {
            const rsi = getLast(RSI.calculate({ period: params.rsiPeriod, values: closes }));
            if (typeof rsi !== 'number') {
                return { signal: 'HOLD', reasons: ['Calculating ranging indicators...'] };
            }
            if (currentPrice < currentBB.lower && rsi < params.mpa_rangeRsiOversold) {
                return { signal: 'BUY', reasons: [`Phase: RANGING`, `Price at lower Bollinger Band with RSI (${rsi.toFixed(1)}) confirmation.`] };
            }
            if (currentPrice > currentBB.upper && rsi > params.mpa_rangeRsiOverbought) {
                return { signal: 'SELL', reasons: [`Phase: RANGING`, `Price at upper Bollinger Band with RSI (${rsi.toFixed(1)}) confirmation.`] };
            }
            return { signal: 'HOLD', reasons: [`Phase: RANGING`, `Awaiting price to touch band extremes.`] };
        }
        case 'CHOPPY':
        default:
            return { signal: 'HOLD', reasons: [`Phase: CHOPPY / Indecisive`, `Market is unpredictable. Staying out to preserve capital.`] };
    }
};


// --- Agent 7: Market Structure Maven ---
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
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes);
    const currentCandle = getLast(klines);
    const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes }));

    if (typeof currentPrice !== 'number' || !currentCandle || typeof volumeSma !== 'number' || typeof currentCandle.volume !== 'number') {
        return { signal: 'HOLD', reasons: ["No current price or volume data."] };
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
    
    const hasVolumeOnBoS = currentCandle.volume > volumeSma;

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
                if (hasVolumeOnBoS) {
                    signal = 'BUY';
                    reasons.push(`Bullish MSS confirmed by break of BoS level ${boSLevelHigh.price.toFixed(4)} with volume.`);
                } else {
                    reasons.push(`Market Structure Shift detected, but awaiting volume confirmation.`);
                }
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
                if (hasVolumeOnBoS) {
                    signal = 'SELL';
                    reasons.push(`Bearish MSS confirmed by break of BoS level ${boSLevelLow.price.toFixed(4)} with volume.`);
                } else {
                    reasons.push(`Market Structure Shift detected, but awaiting volume confirmation.`);
                }
            }
        }
    }

    if (signal === 'HOLD' && reasons.length <= 1) {
        reasons.push("Awaiting valid market structure shift setup.");
    }
    return { signal, reasons };
};

// --- Agent 8: Institutional Scalper ---
const getInstitutionalScalperSignal = (klines: Kline[], params: Required<AgentParams>): TradeSignal => {
    const lookbackPeriod = params.inst_lookbackPeriod;
    if (klines.length < lookbackPeriod + 2) {
        return { signal: 'HOLD', reasons: [`Need at least ${lookbackPeriod + 2} klines for analysis.`] };
    }

    const reasons: string[] = [];
    const currentCandle = klines[klines.length - 1];
    const prevCandle = klines[klines.length - 2];
    const lookbackCandles = klines.slice(klines.length - 2 - lookbackPeriod, klines.length - 2);
    
    const volumes = klines.map(k => k.volume || 0);
    const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes }));
    const currentVolume = currentCandle.volume || 0;

    if (!currentCandle || !prevCandle || lookbackCandles.length < lookbackPeriod || typeof volumeSma !== 'number' || typeof currentVolume !== 'number') {
        return { signal: 'HOLD', reasons: ['Not enough candles or volume data for lookback.'] };
    }
    
    const hasVolumeSpike = currentVolume > volumeSma * 2;

    // --- BUY SETUP ---
    const isBullishEngulfing = currentCandle.close > currentCandle.open && 
                               prevCandle.close < prevCandle.open &&
                               currentCandle.close > prevCandle.open && 
                               currentCandle.open < prevCandle.close;

    if (isBullishEngulfing) {
        reasons.push('Bullish engulfing candle detected.');
        const lookbackLow = Math.min(...lookbackCandles.map(k => k.low));
        const hasSwept = prevCandle.low < lookbackLow || currentCandle.low < lookbackLow;
        
        if (hasSwept) {
            reasons.push(`Liquidity grab below ${lookbackPeriod}-candle low of ${lookbackLow.toFixed(4)}.`);
            
            const body = currentCandle.close - currentCandle.open;
            const upperWick = currentCandle.high - currentCandle.close;
            const lowerWick = currentCandle.open - currentCandle.low;
            const isImbalanced = body > (upperWick + lowerWick) * params.inst_powerCandleMultiplier;

            if (isImbalanced) {
                reasons.push(`Imbalance confirmed (body > ${params.inst_powerCandleMultiplier}x total wick length).`);
                if (hasVolumeSpike) {
                    reasons.push(`Volume spike confirmed (Vol > 2x average).`);
                    return { signal: 'BUY', reasons };
                } else {
                     reasons.push('HOLD: Awaiting volume spike confirmation.');
                     return { signal: 'HOLD', reasons };
                }
            }
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
        const hasSwept = prevCandle.high > lookbackHigh || currentCandle.high > lookbackHigh;

        if (hasSwept) {
            reasons.push(`Liquidity grab above ${lookbackPeriod}-candle high of ${lookbackHigh.toFixed(4)}.`);
            
            const body = currentCandle.open - currentCandle.close;
            const upperWick = currentCandle.high - currentCandle.open;
            const lowerWick = currentCandle.close - currentCandle.low;
            const isImbalanced = body > (upperWick + lowerWick) * params.inst_powerCandleMultiplier;

            if (isImbalanced) {
                reasons.push(`Imbalance confirmed (body > ${params.inst_powerCandleMultiplier}x total wick length).`);
                 if (hasVolumeSpike) {
                    reasons.push(`Volume spike confirmed (Vol > 2x average).`);
                    return { signal: 'SELL', reasons };
                } else {
                     reasons.push('HOLD: Awaiting volume spike confirmation.');
                     return { signal: 'HOLD', reasons };
                }
            }
        }
    }
    
    return { signal: 'HOLD', reasons: ['Waiting for a clear liquidity sweep and engulfing pattern.'] };
};


// --- Main Signal Dispatcher ---
export const getTradingSignal = async (
    agent: Agent,
    klines: Kline[],
    timeFrame: string,
    params: AgentParams = {}
): Promise<TradeSignal> => {
    if (klines.length < 200 && ![4, 5, 6, 8].includes(agent.id)) { // New agents have their own checks
        return { signal: 'HOLD', reasons: [`Need at least 200 klines for full analysis (have ${klines.length}).`] };
    }
    
    const timeframeAdaptiveParams = constants.TIMEFRAME_ADAPTIVE_SETTINGS[timeFrame] || {};
    const finalParams = { ...constants.DEFAULT_AGENT_PARAMS, ...timeframeAdaptiveParams, ...params };

    switch (agent.id) {
        case 1:
            return getMomentumMasterSignal(klines, finalParams);
        case 4:
            return getScalpingExpertSignal(klines, finalParams);
        case 5: // Market Phase Adaptor
            return getMarketPhaseAdaptorSignal(klines, finalParams);
        case 6: // Profit Locker now uses Scalping Expert's entry logic
            return getScalpingExpertSignal(klines, finalParams);
        case 7:
            return getMarketStructureMavenSignal(klines, finalParams);
        case 8:
            return getInstitutionalScalperSignal(klines, finalParams);
        default:
            return { signal: 'HOLD', reasons: ['Agent not found.'] };
    }
};

/**
 * Calculates initial "smart" Stop Loss and Take Profit targets based on market volatility (ATR).
 * This is used when the user has not "locked" the SL/TP, allowing the agent to set a more
 * robust starting point that is less susceptible to market noise, especially with leverage.
 * This version incorporates a dynamic ATR multiplier based on the timeframe, as suggested by the user.
 */
export const getInitialAgentTargets = (
    klines: Kline[],
    entryPrice: number,
    direction: 'LONG' | 'SHORT',
    timeFrame: string,
    params: Required<AgentParams>
): { stopLossPrice: number, takeProfitPrice: number } => {
    // Timeframe-aware ATR multipliers, as suggested by user.
    const atrMultipliers = {
        '1m': 1,
        '3m': 1.2,
        '5m': 1.5,
        '15m': 1.8,
        '30m': 2.0,
        '1h': 2.2,
        '4h': 2.5,
        '1d': 3.0,
    };
    const atrMultiplier = atrMultipliers[timeFrame as keyof typeof atrMultipliers] || 2.0;
    const riskRewardRatio = 1.5; // Default RRR for smart targets

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);

    const atr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: params.atrPeriod }));

    if (typeof atr !== 'number' || atr === 0) {
        // Fallback to a simple 2% if ATR is not available
        const stopDistance = entryPrice * 0.02;
        const profitDistance = stopDistance * riskRewardRatio;
        const stopLossPrice = direction === 'LONG' ? entryPrice - stopDistance : entryPrice + profitDistance;
        const takeProfitPrice = direction === 'LONG' ? entryPrice + profitDistance : entryPrice - profitDistance;
        return { stopLossPrice, takeProfitPrice };
    }

    const stopDistance = atr * atrMultiplier;
    const profitDistance = stopDistance * riskRewardRatio;

    const stopLossPrice = direction === 'LONG' ? entryPrice - stopDistance : entryPrice + stopDistance;
    const takeProfitPrice = direction === 'LONG' ? entryPrice + profitDistance : entryPrice - profitDistance;

    return { stopLossPrice, takeProfitPrice };
};


// --- Proactive Trade Management ---

/**
 * Implements a robust, percentage-based PNL trailing system.
 */
const getPercentageBasedTrailingSignal = (
    position: Position,
    livePrice: number,
    botConfig: BotConfig,
    agentName: string
): TradeManagementSignal => {
    const reasons: string[] = [];
    let newStopLoss: number | undefined;

    const isLong = position.direction === 'LONG';
    const pnl = (livePrice - position.entryPrice) * position.size * (isLong ? 1 : -1);

    if (pnl <= 0) {
        return { reasons: [`Position not in profit.`], newStopLoss: undefined, newTakeProfit: undefined };
    }

    const investmentAmount = botConfig.investmentAmount;
    if (investmentAmount <= 0) {
        return { reasons: ['Invalid investment amount in config.'], newStopLoss: undefined, newTakeProfit: undefined };
    }
    const pnlPercent = (pnl / investmentAmount) * 100;

    let proposedNewStopLoss: number | undefined;
    
    // --- Staged PNL Trailing ---
    // This logic is now shared and robust.
    if (pnlPercent >= 3.0) { // Stage 3: Aggressive Lock
        const profitToLock = pnl * 0.75; // Lock 75%
        proposedNewStopLoss = isLong ? position.entryPrice + (profitToLock / position.size) : position.entryPrice - (profitToLock / position.size);
        reasons.push(`Stage 3 Trail: PNL > 3.0%. Locking 75% of gains.`);
    } else if (pnlPercent >= 1.5) { // Stage 2: Profit Creep
        const profitToLock = pnl * 0.50; // Lock 50%
        proposedNewStopLoss = isLong ? position.entryPrice + (profitToLock / position.size) : position.entryPrice - (profitToLock / position.size);
        reasons.push(`Stage 2 Trail: PNL > 1.5%. Locking 50% of gains.`);
    } else if (pnlPercent >= 0.5) { // Stage 1: Breakeven
        proposedNewStopLoss = position.entryPrice;
        reasons.push(`Stage 1 Trail: PNL > 0.5%. Moving SL to Breakeven.`);
    }
    
    // --- Finalize and check if the proposed SL is an improvement ---
    if (proposedNewStopLoss !== undefined) {
        const isNewStopBetter = (isLong && proposedNewStopLoss > position.stopLossPrice) || (!isLong && proposedNewStopLoss < position.stopLossPrice);
        if (isNewStopBetter) {
            newStopLoss = proposedNewStopLoss;
        }
    }
    
    return { reasons, newStopLoss, newTakeProfit: undefined };
};


export const getTradeManagementSignal = async (
    position: Position,
    klines: Kline[],
    livePrice: number,
    botConfig: BotConfig
): Promise<TradeManagementSignal> => {
    
    // --- PNL-based trailing for Scalper/Locker agents ---
    if (position.agentName === 'Scalping Expert' || position.agentName === 'Profit Locker') {
        const pnlSignal = getPercentageBasedTrailingSignal(position, livePrice, botConfig, position.agentName);
        // Always return the full signal object, even if no action is taken.
        if (pnlSignal.newStopLoss) {
            return pnlSignal; 
        }
    }
    
    // Default response for all other agents or when no action is needed
    return {
        reasons: ["No specific management action for this agent. Holding initial targets."],
        newStopLoss: undefined,
        newTakeProfit: undefined,
    };
};