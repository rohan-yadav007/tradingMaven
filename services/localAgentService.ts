import { TradingMode, type Agent, type TradeSignal, type Kline, type AgentParams, type Position, type ADXOutput, type MACDOutput, type BollingerBandsOutput, type StochasticRSIOutput, type TradeManagementSignal, type BotConfig, VortexIndicatorOutput, SentinelAnalysis, KSTOutput, type IchimokuCloudOutput, MarketDataContext } from '../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV, IchimokuCloud, KST, abandonedbaby, bearishengulfingpattern, bullishengulfingpattern, darkcloudcover, downsidetasukigap, dragonflydoji, gravestonedoji, bullishharami, bearishharami, bullishharamicross, bearishharamicross, hammerpattern, hangingman, morningdojistar, morningstar, piercingline, shootingstar, threeblackcrows, threewhitesoldiers, eveningdojistar, eveningstar } from 'technicalindicators';
import * as constants from '../constants';
import * as binanceService from './binanceService';
import { btcConfirmationService } from './btcConfirmationService';

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
const { TIMEFRAME_ATR_CONFIG, MIN_PROFIT_BUFFER_MULTIPLIER } = constants;

const isObvTrending = (obvValues: number[], direction: 'bullish' | 'bearish', period: number = 20): boolean => {
    if (obvValues.length < period) return false;
    const obvSma = SMA.calculate({ period, values: obvValues });
    const lastObv = getLast(obvValues);
    const lastSma = getLast(obvSma);
    if (lastObv === undefined || lastSma === undefined) return false;
    return direction === 'bullish' ? lastObv > lastSma : lastObv < lastSma;
};

/**
 * Calculates the Volume-Weighted Average Price (VWAP) for a series of klines, resetting daily.
 * @param klines - The historical klines.
 * @returns An array of VWAP values corresponding to each kline.
 */
function calculateVwap(klines: Kline[]): (number | undefined)[] {
    if (klines.length === 0) return [];

    const vwapValues: (number | undefined)[] = new Array(klines.length).fill(undefined);
    let cumulativeTpVol = 0;
    let cumulativeVol = 0;
    let lastDay = -1;

    for (let i = 0; i < klines.length; i++) {
        const kline = klines[i];
        const klineDate = new Date(kline.time);
        const currentDay = klineDate.getUTCDate();

        // Reset on a new day (UTC)
        if (lastDay !== -1 && currentDay !== lastDay) {
            cumulativeTpVol = 0;
            cumulativeVol = 0;
        }
        lastDay = currentDay;

        const typicalPrice = (kline.high + kline.low + kline.close) / 3;
        const volume = kline.volume || 0;
        
        cumulativeTpVol += typicalPrice * volume;
        cumulativeVol += volume;

        if (cumulativeVol > 0) {
            vwapValues[i] = cumulativeTpVol / cumulativeVol;
        }
    }
    return vwapValues;
}


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
    const timeframeSettings: Partial<AgentParams> = constants.getAgentTimeframeSettings(agent.id, timeFrame);
    
    finalParams = { ...finalParams, ...timeframeSettings };

    // Apply user-specific overrides last
    finalParams = { ...finalParams, ...agentParams };
    
    // Return a new config object with the finalized params
    return { ...config, agentParams: finalParams };
}

/**
 * A final safety check to prevent entering a trade if the last few candles show
 * a strong, contradictory reversal pattern.
 * @param klines - The historical klines.
 * @param signalDirection - The direction of the proposed trade ('BUY' or 'SELL').
 * @returns An object indicating if the trade should be vetoed and why.
 */
function isLastCandleContradictory(
    klines: Kline[],
    signalDirection: 'BUY' | 'SELL'
): { veto: boolean; reason: string } {
    if (klines.length < 3) { // Minimum for some patterns
        return { veto: false, reason: '' };
    }

    const input = {
        open: klines.map(k => k.open),
        high: klines.map(k => k.high),
        low: klines.map(k => k.low),
        close: klines.map(k => k.close),
    };

    // Check for SELL signal against bullish reversal patterns
    if (signalDirection === 'SELL') {
        const bullishReversalPatterns: Record<string, (input: any) => boolean[]> = {
            'Bullish Engulfing': bullishengulfingpattern,
            'Hammer Pattern': hammerpattern,
            'Dragonfly Doji': dragonflydoji,
            'Piercing Line': piercingline,
            'Morning Star': morningstar,
        };

        for (const [name, patternFunc] of Object.entries(bullishReversalPatterns)) {
            try {
                const results = patternFunc(input);
                if (getLast(results)) {
                    return { veto: true, reason: `❌ VETO: Strong bullish reversal pattern (${name}) detected.` };
                }
            } catch (e) {
                // Ignore errors from insufficient data for a pattern
            }
        }
    }

    // Check for BUY signal against bearish reversal patterns
    if (signalDirection === 'BUY') {
        const bearishReversalPatterns: Record<string, (input: any) => boolean[]> = {
            'Bearish Engulfing': bearishengulfingpattern,
            'Hanging Man': hangingman,
            'Gravestone Doji': gravestonedoji,
            'Shooting Star': shootingstar,
            'Dark Cloud Cover': darkcloudcover,
            'Evening Star': eveningstar,
        };

        for (const [name, patternFunc] of Object.entries(bearishReversalPatterns)) {
            try {
                const results = patternFunc(input);
                if (getLast(results)) {
                    return { veto: true, reason: `❌ VETO: Strong bearish reversal pattern (${name}) detected.` };
                }
            } catch (e) {
                // Ignore errors from insufficient data for a pattern
            }
        }
    }

    return { veto: false, reason: '' };
}

function calculateHeikinAshi(klines: Kline[]): Kline[] {
    if (klines.length === 0) return [];

    const haKlines: Kline[] = [];

    const firstKline = klines[0];
    haKlines.push({
        time: firstKline.time,
        open: (firstKline.open + firstKline.close) / 2,
        high: firstKline.high,
        low: firstKline.low,
        close: (firstKline.open + firstKline.high + firstKline.low + firstKline.close) / 4,
        volume: firstKline.volume,
        isFinal: firstKline.isFinal,
    });

    for (let i = 1; i < klines.length; i++) {
        const kline = klines[i];
        const prevHaKline = haKlines[i-1];

        const haClose = (kline.open + kline.high + kline.low + kline.close) / 4;
        const haOpen = (prevHaKline.open + prevHaKline.close) / 2;
        const haHigh = Math.max(kline.high, haOpen, haClose);
        const haLow = Math.min(kline.low, haOpen, haClose);
        
        haKlines.push({
            time: kline.time,
            open: haOpen,
            high: haHigh,
            low: haLow,
            close: haClose,
            volume: kline.volume,
            isFinal: kline.isFinal,
        });
    }

    return haKlines;
}

function isMarketCohesive(
    heikinAshiKlines: Kline[],
    direction: 'BUY' | 'SELL',
    timeframe: string,
    candleLookback: number
): { cohesive: boolean; reason: string } {
    if (heikinAshiKlines.length < candleLookback) {
        return { cohesive: true, reason: 'Insufficient HA klines for cohesion check.' };
    }

    const relevantKlines = heikinAshiKlines.slice(-candleLookback);
    const wickTolerance = 0.10;

    const isKlinePerfectlyCohesive = (ha: Kline, dir: 'BUY' | 'SELL'): boolean => {
        const bodySize = Math.abs(ha.close - ha.open);
        if (bodySize === 0) return false; // A doji is not cohesive

        if (dir === 'BUY') {
            const lowerWick = ha.open - ha.low;
            // Must be a green candle with virtually no lower wick
            return ha.close > ha.open && lowerWick <= bodySize * wickTolerance;
        } else { // SELL
            const upperWick = ha.high - ha.open;
            // Must be a red candle with virtually no upper wick
            return ha.close < ha.open && upperWick <= bodySize * wickTolerance;
        }
    };

    // Strict Rule for all timeframes: ALL of the last N candles must be perfectly cohesive.
    const allCandlesCohesive = relevantKlines.every(k => isKlinePerfectlyCohesive(k, direction));
    if (allCandlesCohesive) {
        return { cohesive: true, reason: `✅ HA Cohesion: Passed` };
    } else {
        return { cohesive: false, reason: `❌ VETO: Market lacks cohesion.` };
    }
}

/**
 * Captures a snapshot of the market's technical indicators for a given set of klines.
 * Can also capture a higher timeframe context if htfKlines are provided.
 * @param klines - The primary timeframe klines.
 * @param htfKlines - Optional higher timeframe klines.
 * @returns A MarketDataContext object with calculated indicators.
 */
export function captureMarketContext(klines: Kline[], htfKlines?: Kline[]): Partial<MarketDataContext> {
    const context: Partial<MarketDataContext> = {};

    const calculateIndicators = (k: Kline[]): Partial<Omit<MarketDataContext, 'htf_trend'>> => {
        if (k.length < 2) return {};
        
        const closes = k.map(c => c.close);
        const highs = k.map(c => c.high);
        const lows = k.map(c => c.low);
        const volumes = k.map(c => c.volume || 0);

        const result: Partial<MarketDataContext> = {};
        if (k.length >= 14) {
             result.rsi14 = getLast(RSI.calculate({ period: 14, values: closes }));
             result.adx14 = getLast(ADX.calculate({ period: 14, high: highs, low: lows, close: closes }));
             result.atr14 = getLast(ATR.calculate({ period: 14, high: highs, low: lows, close: closes }));
             result.stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 }));
             const vi14 = VortexIndicator.calculate({ period: 14, high: highs, low: lows, close: closes });
             if(getLast(vi14.pdi) !== undefined && getLast(vi14.ndi) !== undefined) {
                result.vi14 = { pdi: getLast(vi14.pdi)!, ndi: getLast(vi14.ndi)! };
             }
        }
         if (k.length >= 20) {
             result.bb20_2 = getLast(BollingerBands.calculate({ period: 20, stdDev: 2, values: closes }));
             result.volumeSma20 = getLast(SMA.calculate({ period: 20, values: volumes }));
             const obv = OBV.calculate({ close: closes, volume: volumes });
             result.obvTrend = isObvTrending(obv, 'bullish') ? 'bullish' : isObvTrending(obv, 'bearish') ? 'bearish' : 'neutral';
         }
         if (k.length >= 26) {
             result.macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }));
         }
         if (k.length >= 9) result.ema9 = getLast(EMA.calculate({ period: 9, values: closes }));
         if (k.length >= 21) result.ema21 = getLast(EMA.calculate({ period: 21, values: closes }));
         if (k.length >= 50) result.ema50 = getLast(EMA.calculate({ period: 50, values: closes }));
         if (k.length >= 200) result.ema200 = getLast(EMA.calculate({ period: 200, values: closes }));
         if (k.length >= 50) result.sma50 = getLast(SMA.calculate({ period: 50, values: closes }));
         if (k.length >= 200) result.sma200 = getLast(SMA.calculate({ period: 200, values: closes }));
         result.ichiCloud = getLast(IchimokuCloud.calculate({ conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26, high: highs, low: lows }));
         result.lastCandlePattern = recognizeCandlestickPattern(k[k.length - 1], k[k.length - 2]);
         result.vwap = getLast(calculateVwap(k));
         result.lastVolume = getLast(volumes);
         result.lastClose = getLast(closes);

        return result;
    };

    Object.assign(context, calculateIndicators(klines));

    if (htfKlines && htfKlines.length > 0) {
        const htfContextRaw = calculateIndicators(htfKlines);
        for (const key in htfContextRaw) {
            (context as any)[`htf_${key}`] = (htfContextRaw as any)[key];
        }
        if(htfKlines.length >= 200) {
            const lastHtfClose = getLast(htfKlines.map(c => c.close))!;
            const htfEma50 = getLast(EMA.calculate({ period: 50, values: htfKlines.map(c => c.close) }))!;
            const htfEma200 = getLast(EMA.calculate({ period: 200, values: htfKlines.map(c => c.close) }))!;
            if (lastHtfClose > htfEma50 && htfEma50 > htfEma200) {
                context.htf_trend = 'bullish';
            } else if (lastHtfClose < htfEma50 && htfEma50 < htfEma200) {
                context.htf_trend = 'bearish';
            } else {
                context.htf_trend = 'neutral';
            }
        }
    }
    return context;
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
    const currentAtr = getLast(atrValues) || (entryPrice * 0.01);

    // Default Fallback SL
    const fallbackStop = () => {
        const timeframeConfig = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];
        const atrMultiplier = timeframeConfig.atrMultiplier;
        return isLong ? entryPrice - (currentAtr * atrMultiplier) : entryPrice + (currentAtr * atrMultiplier);
    }

    switch (agent.id) {
        case 9: // Quantum Scalper: Context-aware SL (Trending vs. Ranging).
            const adxValues = ADX.calculate({ high: highs, low: lows, close: closes, period: params.qsc_adxPeriod });
            const adx = getLast(adxValues);
            if (!adx) { agentStopLoss = fallbackStop(); break; }
            
            const isTrending = adx.adx > params.qsc_adxThreshold;
            if (isTrending) { 
                const psarInput = { high: highs, low: lows, step: params.qsc_psarStep, max: params.qsc_psarMax };
                const psar = getLast(PSAR.calculate(psarInput));

                const stInput = { high: highs, low: lows, close: closes, period: params.qsc_superTrendPeriod, multiplier: params.qsc_superTrendMultiplier };
                const st = getLast(Supertrend.calculate(stInput));

                let psarCandidate: number | undefined;
                if (psar && ((isLong && psar < entryPrice) || (!isLong && psar > entryPrice))) {
                    psarCandidate = psar;
                }

                let stCandidate: number | undefined;
                if (st && ((isLong && st < entryPrice) || (!isLong && st > entryPrice))) {
                    stCandidate = st;
                }

                if (psarCandidate && stCandidate) {
                    // Both are valid, pick the one that gives a tighter stop (better R:R)
                    agentStopLoss = isLong ? Math.max(psarCandidate, stCandidate) : Math.min(psarCandidate, stCandidate);
                } else if (stCandidate) {
                    agentStopLoss = stCandidate;
                } else if (psarCandidate) {
                    agentStopLoss = psarCandidate;
                } else {
                    agentStopLoss = fallbackStop();
                }
            } else { // Use BB for ranging/reversion SL
                const bbValues = BollingerBands.calculate({ period: params.qsc_bbPeriod, stdDev: params.qsc_bbStdDev, values: closes });
                const bb = getLast(bbValues);
                if (!bb) { agentStopLoss = fallbackStop(); break; }
                agentStopLoss = isLong ? bb.lower - currentAtr * 0.2 : bb.upper + currentAtr * 0.2;
            }
            break;
            
        case 16: // Ichimoku Trend Rider
            const ichi_params_ch = {
                high: highs, low: lows,
                conversionPeriod: params.ichi_conversionPeriod, basePeriod: params.ichi_basePeriod,
                spanPeriod: params.ichi_laggingSpanPeriod, displacement: params.ichi_displacement
            };
            const ichi = getLast(IchimokuCloud.calculate(ichi_params_ch));
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

    const maxLossInDollars = config.investmentAmount * (config.maxMarginLossPercent / 100);
    const positionValue = mode === TradingMode.USDSM_Futures ? config.investmentAmount * leverage : config.investmentAmount;
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


    // --- Step 4: Calculate Take Profit based on R:R ---
    const stopLossDistance = Math.abs(entryPrice - finalStopLoss);
    let suggestedTakeProfit: number;
    
    const timeframeConfig = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];
    let riskRewardRatio = timeframeConfig.riskRewardRatio;

    if (agent.id === 13) {
        riskRewardRatio = 4;
    }
    suggestedTakeProfit = isLong ? entryPrice + (stopLossDistance * riskRewardRatio) : entryPrice - (stopLossDistance * riskRewardRatio);


    // --- Step 5: CRITICAL FINAL SAFETY CHECKS ---
    let finalTakeProfit = suggestedTakeProfit;

    if (positionSize > 0) {
        const roundTripFee = positionValue * config.takerFeeRate * 2;
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
        const fallbackRr = TIMEFRAME_ATR_CONFIG[timeFrame]?.riskRewardRatio || 2.0;
        finalTakeProfit = isLong ? entryPrice + (finalSlDistance * fallbackRr) : entryPrice - (finalSlDistance * fallbackRr);
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
 * A hyper-reactive, tick-based system to secure profits on sudden spikes.
 * It monitors PNL as a percentage of initial investment and aggressively trails the stop loss
 * by locking in a percentage of the *current unrealized PNL*.
 * @param position The current open position.
 * @param currentPrice The live price tick.
 * @returns A TradeManagementSignal with a potential new stop loss if a profit spike is detected.
 */
export function getProfitSpikeSignal(
    position: Position,
    currentPrice: number
): TradeManagementSignal {
    const { 
        entryPrice, 
        stopLossPrice, 
        direction, 
        investmentAmount, 
        size, 
        profitSpikeTier = 0
    } = position;

    if (!investmentAmount || investmentAmount <= 0 || !size || size <= 0) {
        return { reasons: [] };
    }

    const isLong = direction === 'LONG';
    const currentPnl = (currentPrice - entryPrice) * size * (isLong ? 1 : -1);

    if (currentPnl <= 0) {
        return { reasons: [] };
    }

    const pnlPercentage = (currentPnl / investmentAmount) * 100;

    // Tiers based on PNL % of initial investment, but locking in a % of *current* profit.
    const tiers = [
        { triggerPercent: 600, lockPercent: 0.80, tier: 4 }, // At 600% gain, lock 80% of it
        { triggerPercent: 400, lockPercent: 0.70, tier: 3 }, // At 400% gain, lock 70% of it
        { triggerPercent: 200, lockPercent: 0.60, tier: 2 }, // At 200% gain, lock 60% of it
        { triggerPercent: 100, lockPercent: 0.50, tier: 1 }, // At 100% gain, lock 50% of it
    ];

    const applicableTier = tiers.find(t => pnlPercentage >= t.triggerPercent && profitSpikeTier < t.tier);

    if (applicableTier) {
        // Calculate PNL to lock based on *current* profit
        const lockedPnlDollars = currentPnl * applicableTier.lockPercent;
        
        const lockedPnlInPrice = lockedPnlDollars / size;
        
        const newStopLoss = entryPrice + (lockedPnlInPrice * (isLong ? 1 : -1));

        if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
            return {
                newStopLoss,
                reasons: [`Spike Protector: Locked ${(applicableTier.lockPercent * 100).toFixed(0)}% of profit at ${pnlPercentage.toFixed(0)}% gain.`],
                newState: { profitSpikeTier: applicableTier.tier },
                activeStopLossReason: 'Profit Secure'
            };
        }
    }

    return { reasons: [] };
}


/**
 * A non-negotiable safety mechanism that moves the Stop Loss to a fee-adjusted breakeven
 * point once the trade's profit reaches 3x the estimated round-trip trading fee.
 * This is a mandatory rule for all agents to secure trades early.
 * @param position - The current open position.
 * @param currentPrice - The live price tick.
 * @returns A TradeManagementSignal with a potential new stop loss if the breakeven condition is met.
 */
export function getMandatoryBreakevenSignal(
    position: Position,
    currentPrice: number
): TradeManagementSignal {
    const { entryPrice, stopLossPrice, direction, isBreakevenSet, size, takerFeeRate } = position;

    // Rule applies only once, before any other profit locking.
    if (isBreakevenSet) {
        return { reasons: [] };
    }

    const isLong = direction === 'LONG';
    
    // --- Direct Dollar-Based Calculation ---
    const currentPnlDollars = (currentPrice - entryPrice) * size * (isLong ? 1 : -1);
    
    // Not in profit, no action needed.
    if (currentPnlDollars <= 0) {
        return { reasons: [] };
    }
    
    const positionValueDollars = entryPrice * size;
    const roundTripFeeDollars = positionValueDollars * takerFeeRate * 2;

    // Check if the PNL is at least 3x the round-trip fee.
    if (roundTripFeeDollars > 0 && currentPnlDollars >= (roundTripFeeDollars * 3)) {
        // Breakeven stop loss is the exact price needed to exit with zero PNL after fees.
        const feeRate = takerFeeRate;
        const breakevenStop = isLong
            ? entryPrice * (1 + feeRate) / (1 - feeRate)
            : entryPrice * (1 - feeRate) / (1 + feeRate);

        // Only update if the new breakeven stop is better (tighter) than the current one.
        if ((isLong && breakevenStop > stopLossPrice) || (!isLong && breakevenStop < stopLossPrice)) {
            return {
                newStopLoss: breakevenStop,
                reasons: [`Profit Secure: Breakeven set at 3x fee gain.`],
                newState: { isBreakevenSet: true, profitLockTier: 3 },
                activeStopLossReason: 'Breakeven'
            };
        }
    }

    return { reasons: [] };
}


/**
 * A multi-stage, fee-multiple-based profit-locking mechanism that can run independently.
 * Moves SL to breakeven at 3x fee gain, then locks in (N-1)x fee-multiple milestones for every N >= 4 profit tier reached.
 * This is controlled by the "Universal Profit Trail" toggle.
 * @param position - The current open position.
 * @param currentPrice - The live price tick.
 * @returns A TradeManagementSignal with a potential new stop loss.
 */
export function getMultiStageProfitSecureSignal(
    position: Position,
    currentPrice: number
): TradeManagementSignal {
    const { entryPrice, stopLossPrice, direction, profitLockTier, size, takerFeeRate } = position;

    const isLong = direction === 'LONG';
    const currentPnlDollars = (currentPrice - entryPrice) * size * (isLong ? 1 : -1);

    if (currentPnlDollars <= 0) {
        return { reasons: [] };
    }

    const positionValueDollars = entryPrice * size;
    const roundTripFeeDollars = positionValueDollars * takerFeeRate * 2;

    if (roundTripFeeDollars <= 0) {
        return { reasons: [] };
    }

    const currentFeeMultiple = currentPnlDollars / roundTripFeeDollars;
    const triggerFeeMultiple = Math.floor(currentFeeMultiple);

    if (triggerFeeMultiple <= profitLockTier) {
        return { reasons: [] };
    }

    // Handle the first profit lock (breakeven equivalent) if it hasn't been done
    if (triggerFeeMultiple >= 3 && profitLockTier < 3) {
        const feeRate = takerFeeRate;
        const breakevenStop = isLong
            ? entryPrice * (1 + feeRate) / (1 - feeRate)
            : entryPrice * (1 - feeRate) / (1 + feeRate);

        if ((isLong && breakevenStop > stopLossPrice) || (!isLong && breakevenStop < stopLossPrice)) {
            return {
                newStopLoss: breakevenStop,
                reasons: [`Universal Trail: Breakeven set at 3x fee gain.`],
                newState: { isBreakevenSet: true, profitLockTier: 3 },
                activeStopLossReason: 'Breakeven'
            };
        }
    }
    
    // Handle subsequent profit locks (N-1) for N >= 4
    if (triggerFeeMultiple > profitLockTier && triggerFeeMultiple >= 4) {
        const lockFeeMultiple = triggerFeeMultiple - 1;
        const lockedPnlDollars = roundTripFeeDollars * lockFeeMultiple;
        const lockedPnlInPrice = lockedPnlDollars / size;
        const newStopLoss = entryPrice + (lockedPnlInPrice * (isLong ? 1 : -1));

        if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
            const reason = `Universal Trail: Tier ${triggerFeeMultiple - 3} activated at ${triggerFeeMultiple}x fee gain.`;
            return {
                newStopLoss,
                reasons: [reason],
                newState: { profitLockTier: triggerFeeMultiple },
                activeStopLossReason: 'Profit Secure'
            };
        }
    }

    return { reasons: [] };
}

/**
 * An aggressive profit-locking system that activates after the price has moved 50%
 * of the distance from the current Stop Loss to the Take Profit target.
 * It trails the price tightly to secure gains as it approaches the TP.
 * @param position - The current open position.
 * @param currentPrice - The live price tick.
 * @returns A TradeManagementSignal with a potential new stop loss.
 */
export function getAggressiveRangeTrailSignal(
    position: Position,
    currentPrice: number
): TradeManagementSignal {
    const { 
        entryPrice, 
        stopLossPrice,
        takeProfitPrice,
        direction, 
    } = position;

    const isLong = direction === 'LONG';
    
    // Total distance from the *current* stop loss to the take profit
    const slToTpDistance = Math.abs(takeProfitPrice - stopLossPrice);
    if (slToTpDistance <= 1e-9) { // Avoid division by zero
        return { reasons: [] };
    }

    // How far the price has moved from the stop loss towards the take profit
    const progressFromSl = isLong ? (currentPrice - stopLossPrice) : (stopLossPrice - currentPrice);

    // Trigger when price moves 50% of the way from SL to TP
    const triggerDistance = slToTpDistance * 0.5;

    if (progressFromSl > triggerDistance) {
        // Once triggered, it trails aggressively.
        // The trail distance will be 25% of the total SL-to-TP range.
        const trailDistance = slToTpDistance * 0.25;
        const newStopLoss = isLong ? currentPrice - trailDistance : currentPrice + trailDistance;
        
        // Only update if the new stop loss is an improvement.
        if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
            return {
                newStopLoss,
                reasons: [`Aggressive Trail: Price >50% to TP, trailing SL.`],
                newState: { aggressiveTrailTier: 1 },
                activeStopLossReason: 'Profit Secure'
            };
        }
    }

    return { reasons: [] };
}


/**
 * Calculates a potential new Stop Loss based on agent-specific, indicator-based logic (e.g., PSAR).
 * The agent's only job is to report the current value of its trailing indicator.
 * The manager loop is responsible for deciding if it's a valid and better stop loss.
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

    // --- Profit Velocity Engine ---
    const initialRiskInPrice = position.initialRiskInPrice;
    const currentProfitInPrice = isLong ? currentPrice - position.entryPrice : position.entryPrice - currentPrice;
    const currentRR = (initialRiskInPrice > 1e-9 && currentProfitInPrice > 0) ? currentProfitInPrice / initialRiskInPrice : 0;
    
    const isLowTimeframe = ['1m', '3m', '5m'].includes(position.timeFrame);
    const rrThresholds = isLowTimeframe
        ? { high: 1.5, hyper: 2.5, max: 4 }
        : { high: 2, hyper: 4, max: 6 }; 
    
    let profitVelocity = 1;
    if (currentRR > rrThresholds.max) profitVelocity = 4;
    else if (currentRR > rrThresholds.hyper) profitVelocity = 3;
    else if (currentRR > rrThresholds.high) profitVelocity = 2;

    switch (agent.id) {
        case 9: // Quantum Scalper: PSAR-based trailing stop with ATR buffer
            let step = params.qsc_psarStep;
            let max = params.qsc_psarMax;
            
            if (profitVelocity > 1) {
                step *= profitVelocity;
                max *= profitVelocity;
                reasons.push(`Agent Trail: Profit Velocity active (${profitVelocity}x)`);
            } else {
                 reasons.push('Agent PSAR Trail');
            }
            
            const psarInput = { high: highs, low: lows, step, max };
            if (psarInput.high.length >= 2) {
                const psar = getLast(PSAR.calculate(psarInput));
                if (psar) {
                    // Add a small ATR buffer to prevent overly tight stops
                    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
                    const lastAtr = getLast(atrValues) || 0;
                    const buffer = lastAtr * 0.1; // 10% of ATR as a buffer
                    newStopLoss = isLong ? psar - buffer : psar + buffer;
                }
            }
            break;

        case 11: 
        case 13: 
            const baseEmaPeriod = agent.id === 11 ? params.he_slowEmaPeriod : params.ch_slowEmaPeriod;
            const fastEmaPeriod = agent.id === 11 ? params.he_fastEmaPeriod : params.ch_fastEmaPeriod;
            const trailEmaPeriod = Math.max(fastEmaPeriod, Math.round(baseEmaPeriod / profitVelocity));
            if (profitVelocity > 1) reasons.push(`Agent Trail: Profit Velocity active (${profitVelocity}x speed)`);
            else reasons.push('Agent EMA Trail');
            newStopLoss = getLast(EMA.calculate({ period: trailEmaPeriod, values: closes }));
            break;

        case 14: 
            const baseMultiplier = 3;
            const trailMultiplier = Math.max(1, baseMultiplier / profitVelocity);
            if (profitVelocity > 1) reasons.push(`Agent Trail: Profit Velocity active (${profitVelocity}x speed)`);
            else reasons.push('Agent Supertrend Trail');
            newStopLoss = getLast(Supertrend.calculate({ high: highs, low: lows, close: closes, period: 10, multiplier: trailMultiplier }));
            break;

        case 16:
            const ichi_params = { high: highs, low: lows, conversionPeriod: params.ichi_conversionPeriod, basePeriod: params.ichi_basePeriod, spanPeriod: params.ichi_laggingSpanPeriod, displacement: params.ichi_displacement };
            const ichiValues = IchimokuCloud.calculate(ichi_params);
            const lastIchi = getLast(ichiValues);
            if(lastIchi) {
                newStopLoss = isLong ? lastIchi.spanA : lastIchi.spanB;
                if(newStopLoss) reasons.push('Agent Ichimoku Cloud Trail');
            }
            break;

        default:
            break;
    }
    
    if (position.isBreakevenSet && newStopLoss !== undefined) {
        const feeRate = position.takerFeeRate;
        const breakevenPrice = isLong
            ? position.entryPrice * (1 + feeRate) / (1 + feeRate)
            : position.entryPrice * (1 - feeRate) / (1 + feeRate);
        if (isLong) newStopLoss = Math.max(newStopLoss, breakevenPrice);
        else newStopLoss = Math.min(newStopLoss, breakevenPrice);
        reasons.push('Agent Trail active post-breakeven.');
    }

    return { newStopLoss, action, reasons, activeStopLossReason: 'Agent Trail' };
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

// --- Agent 9: Quantum Scalper (REFACTORED with Weighted Scoring) ---
const getQuantumScalperSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = 50;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data (${klines.length}/${minKlines})`] };
    
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);
    const lastKline = klines[klines.length - 1];
    let reasons: string[] = [];

    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.adxPeriod }));
    const bbValues = BollingerBands.calculate({ period: params.qsc_bbPeriod, stdDev: params.qsc_bbStdDev, values: closes });
    const bb = getLast(bbValues);
    const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 }));
    
    if (!adx || !bb || !stochRsi) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for core indicators.`] };
    }
    
    const bbWidth = (bb.upper - bb.lower) / bb.middle;
    if (bbWidth < params.qsc_bbwSqueezeThreshold) {
        return { signal: 'HOLD', reasons: [`ℹ️ Standby: Low volatility squeeze detected (BBW: ${bbWidth.toFixed(4)})`] };
    }
    
    const isTrending = !config.isAdxFilterEnabled || adx.adx > params.qsc_adxThreshold;
    
    if (isTrending) {
        if (config.isAdxFilterEnabled) {
            reasons.push(`ℹ️ Regime: Trending (ADX ${adx.adx.toFixed(1)})`);
        } else {
            reasons.push('ℹ️ Regime: Trending (ADX Filter Disabled)');
        }
        let bullScore = 0;
        let bearScore = 0;
        
        // --- TREND SCORING (Max 40) ---
        if (adx.pdi > adx.mdi) { bullScore += 25; reasons.push(`✅ Trend: Bullish DI`); }
        else if (adx.mdi > adx.pdi) { bearScore += 25; reasons.push(`✅ Trend: Bearish DI`); }
        if (config.isHtfConfirmationEnabled && htfContext?.htf_trend) {
            if (htfContext.htf_trend === 'bullish') { bullScore += 15; reasons.push(`✅ HTF Trend: Confirmed Bullish`); }
            if (htfContext.htf_trend === 'bearish') { bearScore += 15; reasons.push(`✅ HTF Trend: Confirmed Bearish`); }
        } else {
            bullScore += 5; bearScore += 5;
        }

        // --- MOMENTUM SCORING (Max 40) ---
        const rsiValues = RSI.calculate({ period: 14, values: closes });
        const lastRsi = getLast(rsiValues);
        if (!lastRsi) return { signal: 'HOLD', reasons: ['ℹ️ Cannot calculate RSI for momentum.'] };
        
        const rsiSellThreshold = 100 - params.qsc_rsiMomentumThreshold;
        if (lastRsi > params.qsc_rsiMomentumThreshold) {
            bullScore += 20; reasons.push(`✅ Momentum: Breakout Buy (RSI > ${params.qsc_rsiMomentumThreshold})`);
        } else if (lastRsi < rsiSellThreshold) {
            bearScore += 20; reasons.push(`✅ Momentum: Breakout Sell (RSI < ${rsiSellThreshold})`);
        }
        
        if (stochRsi.k > stochRsi.d && stochRsi.k > 50) { bullScore += 20; reasons.push(`✅ Momentum: StochRSI Bullish`); }
        else if (stochRsi.k < stochRsi.d && stochRsi.k < 50) { bearScore += 20; reasons.push(`✅ Momentum: StochRSI Bearish`); }
        else if (stochRsi.k < stochRsi.d && stochRsi.k > 50) { bullScore -= 15; reasons.push(`❌ Momentum: StochRSI Bearish Crossover`); }
        else if (stochRsi.k > stochRsi.d && stochRsi.k < 50) { bearScore -= 15; reasons.push(`❌ Momentum: StochRSI Bullish Crossover`); }
        
        // --- CONFIRMATION SCORING (Max 20) ---
        const macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }));
        if (!macd || macd.histogram === undefined) return { signal: 'HOLD', reasons: ['ℹ️ Cannot calculate MACD for confirmation.'] };

        
        // LOGIC FIX: Penalize contradictory signals
        if (macd.histogram > 0) { // Bullish histogram
            bullScore += 10; reasons.push(`✅ Confirmation: MACD Bullish`);
            bearScore -= 10; // PENALTY for shorting a bullish MACD
        } else if (macd.histogram < 0) { // Bearish histogram
            bearScore += 10; reasons.push(`✅ Confirmation: MACD Bearish`);
            bullScore -= 10; // PENALTY for longing a bearish MACD
        }

        if (bb.pb > 0.55) { bullScore += 10; reasons.push(`✅ Confirmation: Price in Upper BB`); }
        else if (bb.pb < 0.45) { bearScore += 10; reasons.push(`✅ Confirmation: Price in Lower BB`); }
        
        reasons.push(`ℹ️ Score: Bull ${bullScore} vs Bear ${bearScore}`);

        if (bullScore >= params.qsc_trendScoreThreshold && bullScore > bearScore) {
            return { signal: 'BUY', reasons };
        }
        if (bearScore >= params.qsc_trendScoreThreshold && bearScore > bullScore) {
            return { signal: 'SELL', reasons };
        }
        
        if (bullScore > bearScore) {
            reasons.push(`❌ Conviction: Bullish score of ${bullScore} did not meet threshold of ${params.qsc_trendScoreThreshold}.`);
        } else if (bearScore > bullScore) {
            reasons.push(`❌ Conviction: Bearish score of ${bearScore} did not meet threshold of ${params.qsc_trendScoreThreshold}.`);
        } else {
            reasons.push(`ℹ️ Conviction: Scores are tied or too low to enter.`);
        }
        
        return { signal: 'HOLD', reasons };

    } else { // Ranging / Mean Reversion Logic
        reasons.push(`ℹ️ Regime: Ranging (ADX ${adx.adx.toFixed(1)})`);

        const isAtLowerBB = lastKline.low <= bb.lower;
        const isAtUpperBB = lastKline.high >= bb.upper;
        const isStochOversoldBullish = stochRsi.k < params.qsc_stochRsiOversold && stochRsi.k > stochRsi.d;
        const isStochOverboughtBearish = stochRsi.k > params.qsc_stochRsiOverbought && stochRsi.k < stochRsi.d;

        if (isAtLowerBB) {
            reasons.push(`✅ Pattern: Price is at lower BB extreme.`);
            if (isStochOversoldBullish) {
                reasons.push(`✅ Confirmation: StochRSI is oversold & crossing up.`);
                return { signal: 'BUY', reasons };
            } else {
                reasons.push(`❌ Confirmation: StochRSI is not oversold or not crossing up.`);
            }
        }

        if (isAtUpperBB) {
            reasons.push(`✅ Pattern: Price is at upper BB extreme.`);
            if (isStochOverboughtBearish) {
                reasons.push(`✅ Confirmation: StochRSI is overbought & crossing down.`);
                return { signal: 'SELL', reasons };
            } else {
                reasons.push(`❌ Confirmation: StochRSI is not overbought or not crossing down.`);
            }
        }
        
        if (!isAtLowerBB && !isAtUpperBB) {
            reasons.push(`ℹ️ Standby: Price is not at Bollinger Band extremes for a reversal.`);
        }
        
        return { signal: 'HOLD', reasons };
    }
};


// --- Agent 11: Historic Expert (REFACTORED to Pullback Strategy) ---
const getHistoricExpertSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = Math.max(params.he_trendSmaPeriod, params.he_fastEmaPeriod, params.he_rsiPeriod, params.adxPeriod, params.obvPeriod);
    if (klines.length < minKlines + 1) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const lastKline = getLast(klines);
    const reasons: string[] = [];

    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.adxPeriod }));
    const atr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: params.atrPeriod }));
    const trendSma = getLast(SMA.calculate({ period: params.he_trendSmaPeriod, values: closes }));
    const pullbackEma = getLast(EMA.calculate({ period: params.he_fastEmaPeriod, values: closes }));
    const rsi = getLast(RSI.calculate({ period: params.he_rsiPeriod, values: closes }));

    if (!lastKline || !adx || !atr || !trendSma || !pullbackEma || !rsi) {
        return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data for indicators.'] };
    }
    const currentPrice = lastKline.close;

    const isTrending = !config.isAdxFilterEnabled || adx.adx > params.he_adxTrendThreshold;
    reasons.push(config.isAdxFilterEnabled ? (isTrending ? `✅ Trend Active (ADX > ${params.he_adxTrendThreshold})` : `❌ Chop Zone (ADX < ${params.he_adxTrendThreshold})`) : '✅ Trend Active (ADX Filter Disabled)');
    if (!isTrending) return { signal: 'HOLD', reasons };
    
    const candleRange = lastKline.high - lastKline.low;
    const isNotExhaustion = candleRange < atr * 3;
    reasons.push(isNotExhaustion ? `✅ Normal Volatility` : `❌ High Volatility (Exhaustion Risk)`);
    if (!isNotExhaustion) return { signal: 'HOLD', reasons };
    
    const isBullishTrend = currentPrice > trendSma;
    reasons.push(isBullishTrend ? `✅ Trend: Bullish` : `✅ Trend: Bearish`);

    const bullishPullback = isBullishTrend && lastKline.low <= pullbackEma && lastKline.close > pullbackEma;
    const bearishPullback = !isBullishTrend && lastKline.high >= pullbackEma && lastKline.close < pullbackEma;
    reasons.push(bullishPullback || bearishPullback ? '✅ Entry: Pullback to EMA' : '❌ Entry: No pullback');

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
        if (rsiIsBearish && isObvBearish) return { signal: 'SELL', reasons };
    }
    
    return { signal: 'HOLD', reasons };
};

// --- Agent 13: The Chameleon (REVERTED to EMA Crossover Flip Strategy) ---
const getChameleonSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = Math.max(
        params.ch_trendEmaPeriod,
        params.ch_slowEmaPeriod,
        params.adxPeriod
    );
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data for analysis.'] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const reasons: string[] = [];

    const trendEma = getLast(EMA.calculate({ period: params.ch_trendEmaPeriod, values: closes }));
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.adxPeriod }));
    const fastEmaValues = EMA.calculate({ period: params.ch_fastEmaPeriod, values: closes });
    const slowEmaValues = EMA.calculate({ period: params.ch_slowEmaPeriod, values: closes });
    const lastFastEma = getLast(fastEmaValues);
    const prevFastEma = getPenultimate(fastEmaValues);
    const lastSlowEma = getLast(slowEmaValues);
    const prevSlowEma = getPenultimate(slowEmaValues);
    const currentPrice = getLast(closes);
    
    if(!trendEma || !adx || !lastFastEma || !prevFastEma || !lastSlowEma || !prevSlowEma || !currentPrice) {
         return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data for indicators.'] };
    }

    const isMacroBullish = currentPrice > trendEma;
    const isMacroBearish = currentPrice < trendEma;
    
    const isTrending = !config.isAdxFilterEnabled || adx.adx > params.ch_adxThreshold;

    const bullishCross = prevFastEma < prevSlowEma && lastFastEma > lastSlowEma;
    const bearishCross = prevFastEma > prevSlowEma && lastFastEma < lastSlowEma;
    
    reasons.push(isMacroBullish ? `✅ Trend: Bullish` : isMacroBearish ? `✅ Trend: Bearish` : `❌ Trend: Neutral`);
    if (config.isAdxFilterEnabled) {
        reasons.push(isTrending ? `✅ Regime: Trending (ADX ${adx.adx.toFixed(1)})` : `❌ Regime: Ranging`);
    } else {
        reasons.push('✅ Regime: Trending (ADX Filter Disabled)');
    }

    if (isMacroBullish && isTrending) {
        reasons.push(bullishCross ? `✅ EMA: Bullish Cross` : `❌ EMA: No Bullish Cross`);
        if (bullishCross) {
            return { signal: 'BUY', reasons };
        }
    }
    
    if (isMacroBearish && isTrending) {
        reasons.push(bearishCross ? `✅ EMA: Bearish Cross` : `❌ EMA: No Bearish Cross`);
        if (bearishCross) {
            return { signal: 'SELL', reasons };
        }
    }

    return { signal: 'HOLD', reasons };
};


// --- Agent 14: The Sentinel (REFACTORED with Mutually Exclusive Scoring) ---
const getTheSentinelSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = 200;
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for The Sentinel (${klines.length}/${minKlines} candles).`] };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes);
    const ema50 = getLast(EMA.calculate({ period: 50, values: closes }));
    const ema200 = getLast(EMA.calculate({ period: 200, values: closes }));
    const macdValues = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const macd = getLast(macdValues);
    const prevMacd = getPenultimate(macdValues);
    const rsi = getLast(RSI.calculate({ values: closes, period: 14 }));
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: 14 }));
    const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod });
    const last_vi_plus = getLast(vi.pdi);
    const last_vi_minus = getLast(vi.ndi);
    
    if (!currentPrice || !ema50 || !ema200 || !macd || !prevMacd || !rsi || !adx || last_vi_plus === undefined || last_vi_minus === undefined) {
         return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for core indicators.`] };
    }

    const obv = OBV.calculate({ close: closes, volume: volumes });

    let bullish = { trend: 0, momentum: 0, confirmation: 0 };
    let bearish = { trend: 0, momentum: 0, confirmation: 0 };
    const reasons: string[] = [];

    // --- Trend Score (Max 40) ---
    if (currentPrice > ema200) bullish.trend += 15; else bearish.trend += 15;
    if (ema50 > ema200) bullish.trend += 10; else bearish.trend += 10;
    if (adx.adx > 22) {
        if (adx.pdi > adx.mdi) bullish.trend += 15;
        else if (adx.mdi > adx.pdi) bearish.trend += 15;
    }

    // --- Momentum Score (Max 40) ---
    if (macd.histogram! > 0 && macd.histogram! > (prevMacd.histogram || 0)) bullish.momentum += 15;
    else if (macd.histogram! < 0 && macd.histogram! < (prevMacd.histogram || 0)) bearish.momentum += 15;
    if (rsi > 55) bullish.momentum += 10;
    else if (rsi < 45) bearish.momentum += 10;
    if (last_vi_plus > last_vi_minus) bullish.momentum += 15;
    else if (last_vi_minus > last_vi_plus) bearish.momentum += 15;

    // --- Confirmation Score (Max 20) ---
    if (isObvTrending(obv, 'bullish')) bullish.confirmation += 20;
    else if (isObvTrending(obv, 'bearish')) bearish.confirmation += 20;

    let totalBull = bullish.trend + bullish.momentum + bullish.confirmation;
    let totalBear = bearish.trend + bearish.momentum + bearish.confirmation;
    
    // HTF Alignment Veto
    if (config.isHtfConfirmationEnabled && htfContext?.htf_trend) {
        reasons.push(`ℹ️ HTF Trend is ${htfContext.htf_trend}.`);
        if (htfContext.htf_trend !== 'bullish' && htfContext.htf_trend !== 'neutral') {
             reasons.push(`❌ VETO: HTF is not bullish.`);
             totalBull = 0;
        }
        if (htfContext.htf_trend !== 'bearish' && htfContext.htf_trend !== 'neutral') {
            reasons.push(`❌ VETO: HTF is not bearish.`);
            totalBear = 0;
        }
    }

    const sentinelAnalysis: SentinelAnalysis = {
        bullish: { total: totalBull, trend: bullish.trend, momentum: bullish.momentum, confirmation: bullish.confirmation },
        bearish: { total: totalBear, trend: bearish.trend, momentum: bearish.momentum, confirmation: bearish.confirmation }
    };

    const threshold = params.sentinel_scoreThreshold;
    
    if (totalBull >= threshold && totalBull > totalBear) {
        reasons.unshift(`✅ Bullish score meets threshold.`);
        reasons.push(`ℹ️ Final Score: Bull ${totalBull.toFixed(0)} vs Bear ${totalBear.toFixed(0)}`);
        return { signal: 'BUY', reasons, sentinelAnalysis };
    }
    
    if (totalBear > totalBull && totalBear >= threshold) {
        reasons.unshift(`✅ Bearish score meets threshold.`);
        reasons.push(`ℹ️ Final Score: Bull ${totalBull.toFixed(0)} vs Bear ${totalBear.toFixed(0)}`);
        return { signal: 'SELL', reasons, sentinelAnalysis };
    }

    // Add explicit reasons for HOLD
    if (totalBull > totalBear) {
        if (totalBull < threshold) {
            reasons.unshift(`❌ Conviction: Bullish score of ${totalBull.toFixed(0)} did not meet threshold of ${threshold}.`);
        }
    } else if (totalBear > totalBull) {
        if (totalBear < threshold) {
            reasons.unshift(`❌ Conviction: Bearish score of ${totalBear.toFixed(0)} did not meet threshold of ${threshold}.`);
        }
    } else {
        reasons.unshift(`ℹ️ Conviction: Scores are tied or too low for a signal.`);
    }

    reasons.push(`ℹ️ Final Score: Bull ${totalBull.toFixed(0)} vs Bear ${totalBear.toFixed(0)}`);
    return { signal: 'HOLD', reasons, sentinelAnalysis };
};

// --- Agent 16: Ichimoku Trend Rider (Upgraded with OBV) ---
const getIchimokuTrendRiderSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = params.ichi_basePeriod + params.ichi_displacement;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data (${klines.length}/${minKlines}).`] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes);
    const prevPrice = getPenultimate(closes);
    let reasons: string[] = [];

    const ichi_params = { high: highs, low: lows, conversionPeriod: params.ichi_conversionPeriod, basePeriod: params.ichi_basePeriod, spanPeriod: params.ichi_laggingSpanPeriod, displacement: params.ichi_displacement };
    const ichiValues = IchimokuCloud.calculate(ichi_params);
    const lastIchi = getLast(ichiValues);
    const prevIchi = getPenultimate(ichiValues);
    
    if (!currentPrice || !prevPrice || !lastIchi || !prevIchi || !lastIchi.spanA || !lastIchi.spanB || !prevIchi.spanA || !prevIchi.spanB) {
        return { signal: 'HOLD', reasons: ['ℹ️ Ichimoku Cloud not yet formed.'] };
    }
    
    const isPriceAboveKumo = currentPrice > lastIchi.spanA && currentPrice > lastIchi.spanB;
    const isPriceBelowKumo = currentPrice < lastIchi.spanA && currentPrice < lastIchi.spanB;
    const bullishTkCross = prevIchi.conversion < prevIchi.base && lastIchi.conversion > lastIchi.base;
    const bearishTkCross = prevIchi.conversion > prevIchi.base && lastIchi.conversion < lastIchi.base;

    const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod });
    const lastViPdi = getLast(vi.pdi);
    const lastViNdi = getLast(vi.ndi);

    if (lastViPdi === undefined || lastViNdi === undefined) return { signal: 'HOLD', reasons: ['ℹ️ VI data unavailable.'] };
    
    const isViBullish = lastViPdi > lastViNdi;
    const isViBearish = lastViNdi > lastViPdi;
    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');
    
    // Pullback Entry Logic
    if (isPriceAboveKumo && bullishTkCross) {
        reasons.push(`✅ Entry Type: Pullback (TK Cross)`);
        reasons.push(isViBullish ? `✅ VI Confirmed` : `❌ VI Not Bullish`);
        reasons.push(isObvBullish ? `✅ OBV Confirmed` : `❌ OBV Not Bullish`);
        if (isViBullish && isObvBullish) return { signal: 'BUY', reasons };
    }
    if (isPriceBelowKumo && bearishTkCross) {
        reasons.push(`✅ Entry Type: Pullback (TK Cross)`);
        reasons.push(isViBearish ? `✅ VI Confirmed` : `❌ VI Not Bearish`);
        reasons.push(isObvBearish ? `✅ OBV Confirmed` : `❌ OBV Not Bearish`);
        if (isViBearish && isObvBearish) return { signal: 'SELL', reasons };
    }

    // Breakout Entry Logic (if pullback fails)
    reasons = []; // Reset reasons for breakout logic
    const isBullishKumo = lastIchi.spanA > lastIchi.spanB;
    const prevCloudTop = Math.max(prevIchi.spanA, prevIchi.spanB);
    const lastCloudTop = Math.max(lastIchi.spanA, lastIchi.spanB);
    const bullishBreakout = prevPrice < prevCloudTop && currentPrice > lastCloudTop;
    const chikouPriceTargetIndex = klines.length - 1 - params.ichi_displacement;

    if (bullishBreakout && chikouPriceTargetIndex >= 0) {
        const chikouIsBullish = currentPrice > closes[chikouPriceTargetIndex];
        reasons.push(`✅ Entry Type: Kumo Breakout`);
        reasons.push(chikouIsBullish ? `✅ Lagging Span Confirmed` : `❌ Lagging Span`);
        reasons.push(isViBullish ? `✅ VI Confirmed` : `❌ VI Not Bullish`);
        reasons.push(isObvBullish ? `✅ OBV Confirmed` : `❌ OBV Not Bullish`);
        if (chikouIsBullish && isBullishKumo && isViBullish && isObvBullish) return { signal: 'BUY', reasons };
    }
    
    const prevCloudBottom = Math.min(prevIchi.spanA, prevIchi.spanB);
    const lastCloudBottom = Math.min(lastIchi.spanA, lastIchi.spanB);
    const bearishBreakout = prevPrice > prevCloudBottom && currentPrice < lastCloudBottom;
     if (bearishBreakout && chikouPriceTargetIndex >= 0) {
        const chikouIsBearish = currentPrice < closes[chikouPriceTargetIndex];
        reasons.push(`✅ Entry Type: Kumo Breakout`);
        reasons.push(chikouIsBearish ? `✅ Lagging Span Confirmed` : `❌ Lagging Span`);
        reasons.push(isViBearish ? `✅ VI Confirmed` : `❌ VI Not Bearish`);
        reasons.push(isObvBearish ? `✅ OBV Confirmed` : `❌ OBV Not Bearish`);
        if (chikouIsBearish && !isBullishKumo && isViBearish && isObvBearish) return { signal: 'SELL', reasons };
    }
    
    return { signal: 'HOLD', reasons: ['ℹ️ No valid Ichimoku signal.'] };
};

export const validateTradeProfitability = (
    entryPrice: number,
    finalStopLossPrice: number,
    agentStopLossPrice: number,
    takeProfitPrice: number,
    direction: 'LONG' | 'SHORT',
    config: BotConfig
): { isValid: boolean, reason: string } => {
    const isLong = direction === 'LONG';

    // Check 1: Stop Loss and Take Profit are on the correct side of the entry price
    if ((isLong && (finalStopLossPrice >= entryPrice || takeProfitPrice <= entryPrice)) ||
        (!isLong && (finalStopLossPrice <= entryPrice || takeProfitPrice >= entryPrice))) {
        return { isValid: false, reason: "❌ VETO: SL/TP targets are on the wrong side of the entry price." };
    }

    // Check 2: The trade must be profitable enough to cover fees.
    const positionValue = config.investmentAmount * (config.mode === TradingMode.USDSM_Futures ? config.leverage : 1);
    const tradeSize = positionValue / entryPrice;
    if (tradeSize > 0) {
        const roundTripFee = positionValue * config.takerFeeRate * 2;
        const feeInPrice = roundTripFee / tradeSize;
        const minProfitDistance = feeInPrice * constants.MIN_PROFIT_BUFFER_MULTIPLIER;
        const rewardDistance = Math.abs(takeProfitPrice - entryPrice);
        if (rewardDistance < minProfitDistance) {
            return { isValid: false, reason: `❌ VETO: Take Profit ($${takeProfitPrice.toFixed(config.pricePrecision)}) is within the minimum profit zone required to cover fees.` };
        }
    }

    // Check 3: Enforce Minimum Risk/Reward if enabled.
    if (config.isMinRrEnabled) {
        // CRITICAL FIX: Use agent's intended stop loss for R:R calculation, not the hard cap.
        const risk = Math.abs(entryPrice - agentStopLossPrice);
        const reward = Math.abs(takeProfitPrice - entryPrice);
        const rrRatio = risk > 0 ? reward / risk : 0;

        if (rrRatio < constants.MIN_RISK_REWARD_RATIO) {
            return { isValid: false, reason: `❌ VETO: Agent's R:R (${rrRatio.toFixed(2)}) is below the system minimum of ${constants.MIN_RISK_REWARD_RATIO}.` };
        }
        return { isValid: true, reason: `✅ R:R Veto: Passed (${rrRatio.toFixed(2)}:1)` };
    }

    return { isValid: true, reason: `✅ Profitability checks passed.` };
};

export async function getSupervisorSignal(
    position: Position,
    klines: Kline[],
    originalConfig: BotConfig,
    htfKlines?: Kline[]
): Promise<{ action: 'hold' | 'close'; reason: string }> {
    const config = applyTimeframeSettings(originalConfig);
    const { agent } = config;

    if ((position.candlesSinceEntry || 0) < 3) {
        return { action: 'hold', reason: '' };
    }
    
    // Fading Momentum Check: The most critical part of this system.
    // If a trade has become profitable but the underlying momentum has completely died,
    // it's a strong signal to exit and protect profits/minimize loss.
    const currentContext = captureMarketContext(klines, htfKlines);
    const currentRsi = currentContext.rsi14;

    if (position.hasBeenProfitable && currentRsi) {
        const isLong = position.direction === 'LONG';
        if (isLong && currentRsi < 48) { // RSI drops below neutral, bullish momentum is gone
            return { action: 'close', reason: `Supervisor Exit: Bullish momentum faded (RSI dropped to ${currentRsi.toFixed(1)})` };
        }
        if (!isLong && currentRsi > 52) { // RSI rises above neutral, bearish momentum is gone
            return { action: 'close', reason: `Supervisor Exit: Bearish momentum faded (RSI rose to ${currentRsi.toFixed(1)})` };
        }
    }

    // Agent Re-analysis: Check if the original entry thesis is still valid.
    if (config.isReanalysisEnabled) {
        let htfContext: MarketDataContext | undefined;
        if (config.isHtfConfirmationEnabled && htfKlines && htfKlines.length > 50) {
            htfContext = captureMarketContext([], htfKlines);
        }

        let rawSignal: TradeSignal;
        switch (agent.id) {
            case 9:  rawSignal = getQuantumScalperSignal(klines, config, htfContext); break;
            case 11: rawSignal = getHistoricExpertSignal(klines, config, htfContext); break;
            case 13: rawSignal = getChameleonSignal(klines, config, htfContext); break;
            case 14: rawSignal = getTheSentinelSignal(klines, config, htfContext); break;
            case 16: rawSignal = getIchimokuTrendRiderSignal(klines, config, htfContext); break;
            default: rawSignal = { signal: 'HOLD', reasons: ['Agent not found for re-analysis'] }; break;
        }
        
        const isLong = position.direction === 'LONG';
        const requiredSignal = isLong ? 'BUY' : 'SELL';
        
        if (rawSignal.signal !== requiredSignal) {
             const reason = rawSignal.signal === 'HOLD'
                ? 'Supervisor Exit: Trade thesis invalidated (entry conditions no longer met).'
                : 'Supervisor Exit: Trade thesis invalidated (signal flipped).';
             return { action: 'close', reason };
        }
    }

    return { action: 'hold', reason: '' };
}

export function getAdaptiveTakeProfit(
    position: Position,
    klines: Kline[],
    config: BotConfig,
    htfKlines?: Kline[]
): { newTakeProfit?: number; reason?: string } {
    const { direction, takeProfitPrice, entryPrice } = position;

    if (!config.isHtfConfirmationEnabled || config.isTakeProfitLocked) {
        return {};
    }
    
    return {};
}

/**
 * A universal gatekeeper to prevent entering trades when the trend is likely exhausted.
 * Uses StochRSI to identify overbought/oversold conditions.
 */
function getExhaustionFilterVeto(
    klines: Kline[],
    direction: 'BUY' | 'SELL',
    config: BotConfig,
): { veto: boolean; reason: string } {
    if (klines.length < 14) return { veto: false, reason: '' }; // Need enough data for StochRSI
    const closes = klines.map(k => k.close);
    const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 }));
    if (!stochRsi) return { veto: false, reason: '' };

    const isLong = direction === 'BUY';
    const OVERBOUGHT_THRESHOLD = 85;
    const OVERSOLD_THRESHOLD = 15;

    if (isLong && stochRsi.k > OVERBOUGHT_THRESHOLD) {
        return { veto: true, reason: `❌ VETO: Exhaustion risk detected (StochRSI K: ${stochRsi.k.toFixed(1)})` };
    }
    if (!isLong && stochRsi.k < OVERSOLD_THRESHOLD) {
        return { veto: true, reason: `❌ VETO: Exhaustion risk detected (StochRSI K: ${stochRsi.k.toFixed(1)})` };
    }

    return { veto: false, reason: '' };
}


/**
 * A universal gatekeeper to prevent entering trades when the trend is likely exhausted.
 */
function getMeanReversionVeto(
    klines: Kline[],
    direction: 'BUY' | 'SELL',
    config: BotConfig,
): { veto: boolean; reason: string } {
    const params = config.agentParams as Required<AgentParams>;
    const closes = klines.map(k => k.close);
    const lastRsi = getLast(RSI.calculate({ period: 14, values: closes }));
    if (lastRsi === undefined) return { veto: false, reason: '' };
    
    const isLong = direction === 'BUY';

    // Only apply this veto if the agent is Quantum Scalper, as it's tuned for it.
    if (config.agent.id === 9) {
        const isOverextended = isLong
            ? lastRsi > params.qsc_rsiOverextendedLong
            : lastRsi < params.qsc_rsiOverextendedShort;
        
        if (isOverextended) {
            return { veto: true, reason: `❌ VETO: Mean Reversion risk detected (RSI: ${lastRsi.toFixed(1)})` };
        }
    }
    return { veto: false, reason: '' };
}

/**
 * A universal gatekeeper to ensure trade entries align with higher timeframe momentum.
 */
function getHtfMomentumSyncVeto(
    direction: 'BUY' | 'SELL',
    htfContext: MarketDataContext | undefined,
    config: BotConfig,
): { veto: boolean; reason: string } {
    if (!config.isHtfConfirmationEnabled || !htfContext?.htf_stochRsi) {
        return { veto: false, reason: '' };
    }
    
    const params = config.agentParams as Required<AgentParams>;
    const htfStochRsi = htfContext.htf_stochRsi;
    const isLong = direction === 'BUY';

    const isHtfOverbought = htfStochRsi.k > params.qsc_stochRsiOverbought;
    const isHtfOversold = htfStochRsi.k < params.qsc_stochRsiOversold;

    if (isLong && isHtfOverbought) {
        return { veto: true, reason: `❌ VETO: HTF Momentum is overbought (StochRSI K: ${htfStochRsi.k.toFixed(1)})` };
    }
    if (!isLong && isHtfOversold) {
        return { veto: true, reason: `❌ VETO: HTF Momentum is oversold (StochRSI K: ${htfStochRsi.k.toFixed(1)})` };
    }

    return { veto: false, reason: '' };
}

function getBtcTrendScore(
    btcKlines: Kline[]
): { bullScore: number; bearScore: number } {
    if (btcKlines.length < 50) {
        return { bullScore: 50, bearScore: 50 }; // Neutral if not enough data
    }

    const closes = btcKlines.map(k => k.close);
    const highs = btcKlines.map(k => k.high);
    const lows = btcKlines.map(k => k.low);
    const currentPrice = getLast(closes)!;

    let bullScore = 0;
    let bearScore = 0;

    // 1. Trend Component (50 points) - EMA Alignment
    const ema21 = getLast(EMA.calculate({ period: 21, values: closes }))!;
    const ema50 = getLast(EMA.calculate({ period: 50, values: closes }))!;
    if (currentPrice > ema21 && ema21 > ema50) {
        bullScore += 50;
    } else if (currentPrice < ema21 && ema21 < ema50) {
        bearScore += 50;
    }

    // 2. Momentum Component (30 points) - MACD
    const macdValues = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const macd = getLast(macdValues)!;
    const prevMacd = getPenultimate(macdValues)!;
    if (macd.histogram! > 0 && macd.histogram! > (prevMacd.histogram || 0)) {
        bullScore += 30;
    } else if (macd.histogram! < 0 && macd.histogram! < (prevMacd.histogram || 0)) {
        bearScore += 30;
    }
    
    // 3. Strength Component (20 points) - ADX
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: 14 }))!;
    if (adx.adx > 20) { // Only score if trend has strength
        if (adx.pdi > adx.mdi) {
            bullScore += 20;
        } else if (adx.mdi > adx.pdi) {
            bearScore += 20;
        }
    }

    return { bullScore, bearScore };
}

/**
 * New Gatekeeper: Implements the Smart Money Concepts (SMC) reversal pattern veto.
 */
function getSmcVeto(
    klines: Kline[],
    direction: 'BUY' | 'SELL',
    config: BotConfig,
    rsiValues: number[],
    volumeSma: number | undefined,
): { veto: boolean; reason: string } {
    if (!config.isSmcVetoEnabled || klines.length < 50) {
        return { veto: false, reason: '' };
    }

    const params = config.agentParams as Required<AgentParams>;
    const isLongSignal = direction === 'BUY';
    const lookback = params.smc_divergenceLookback;
    
    // Find recent swing highs/lows
    const pivots: { index: number; price: number, type: 'high' | 'low' }[] = [];
    for (let i = lookback; i < klines.length - lookback; i++) {
        const window = klines.slice(i - lookback, i + 1 + lookback);
        const currentHigh = klines[i].high;
        const currentLow = klines[i].low;
        if (currentHigh === Math.max(...window.map(k => k.high))) pivots.push({ index: i, price: currentHigh, type: 'high'});
        if (currentLow === Math.min(...window.map(k => k.low))) pivots.push({ index: i, price: currentLow, type: 'low'});
    }

    const recentHighs = pivots.filter(p => p.type === 'high').slice(-2);
    const recentLows = pivots.filter(p => p.type === 'low').slice(-2);

    // --- Check for BEARISH Reversal (to VETO a BUY signal) ---
    if (isLongSignal && recentHighs.length === 2) {
        const [prevHigh, lastHigh] = recentHighs;
        const priceMakesHigherHigh = lastHigh.price > prevHigh.price;
        const rsiMakesLowerHigh = rsiValues[lastHigh.index] < rsiValues[prevHigh.index];
        
        if (priceMakesHigherHigh && rsiMakesLowerHigh) {
            // 1. Divergence confirmed. Now check for liquidity sweep.
            const sweepCandle = klines[lastHigh.index];
            const hasHighVolume = sweepCandle.volume! > (volumeSma || 0) * params.smc_volumeMultiplier;
            
            if (hasHighVolume) {
                 // 2. Liquidity sweep confirmed. Now check for CHoCH.
                 const minorLows = pivots.filter(p => p.type === 'low' && p.index > prevHigh.index && p.index < lastHigh.index);
                 if (minorLows.length > 0) {
                     const lastMinorLow = minorLows[minorLows.length - 1];
                     // Check if price has closed below that minor low since the last high
                     const candlesSinceHigh = klines.slice(lastHigh.index + 1);
                     const hasBrokenStructure = candlesSinceHigh.some(k => k.close < lastMinorLow.price);
                     if (hasBrokenStructure) {
                         return { veto: true, reason: `❌ VETO: Bearish SMC reversal pattern detected (Divergence + Sweep + CHoCH).` };
                     }
                 }
            }
        }
    }

    // --- Check for BULLISH Reversal (to VETO a SELL signal) ---
    if (!isLongSignal && recentLows.length === 2) {
        const [prevLow, lastLow] = recentLows;
        const priceMakesLowerLow = lastLow.price < prevLow.price;
        const rsiMakesHigherLow = rsiValues[lastLow.index] > rsiValues[prevLow.index];

        if (priceMakesLowerLow && rsiMakesHigherLow) {
            // 1. Divergence confirmed.
            const sweepCandle = klines[lastLow.index];
            const hasHighVolume = sweepCandle.volume! > (volumeSma || 0) * params.smc_volumeMultiplier;

            if (hasHighVolume) {
                // 2. Liquidity sweep confirmed.
                const minorHighs = pivots.filter(p => p.type === 'high' && p.index > prevLow.index && p.index < lastLow.index);
                if (minorHighs.length > 0) {
                    const lastMinorHigh = minorHighs[minorHighs.length - 1];
                    const candlesSinceLow = klines.slice(lastLow.index + 1);
                    const hasBrokenStructure = candlesSinceLow.some(k => k.close > lastMinorHigh.price);
                    if (hasBrokenStructure) {
                        return { veto: true, reason: `❌ VETO: Bullish SMC reversal pattern detected (Divergence + Sweep + CHoCH).` };
                    }
                }
            }
        }
    }

    return { veto: false, reason: '' };
}


export const getTradingSignal = async (
    agent: Agent,
    klines: Kline[],
    originalConfig: BotConfig,
    htfKlines?: Kline[]
): Promise<TradeSignal> => {
    const config = applyTimeframeSettings(originalConfig);

    let htfContext: MarketDataContext | undefined;
    if (config.isHtfConfirmationEnabled && htfKlines && htfKlines.length > 50) {
        htfContext = captureMarketContext([], htfKlines);
    }
    
    let signal: TradeSignal;

    switch (agent.id) {
        case 9:  signal = getQuantumScalperSignal(klines, config, htfContext); break;
        case 11: signal = getHistoricExpertSignal(klines, config, htfContext); break;
        case 13: signal = getChameleonSignal(klines, config, htfContext); break;
        case 14: signal = getTheSentinelSignal(klines, config, htfContext); break;
        case 16: signal = getIchimokuTrendRiderSignal(klines, config, htfContext); break;
        default: signal = { signal: 'HOLD', reasons: ['Agent not found'] };
    }

    if (signal.signal === 'HOLD') {
        return signal;
    }
    
    // --- SMC Reversal Veto Gatekeeper ---
    if (config.isSmcVetoEnabled) {
        const closes = klines.map(k => k.close);
        const volumes = klines.map(k => k.volume || 0);
        const rsiValues = RSI.calculate({ period: 14, values: closes });
        const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes }));
        const smcVeto = getSmcVeto(klines, signal.signal, config, rsiValues, volumeSma);
        if (smcVeto.veto) {
            signal.reasons.push(smcVeto.reason);
            return { ...signal, signal: 'HOLD' };
        }
        signal.reasons.push('✅ SMC Veto: Passed.');
    }

    // --- Exhaustion Filter Gatekeeper ---
    if (config.isExhaustionFilterEnabled) {
        const exhaustionVeto = getExhaustionFilterVeto(klines, signal.signal, config);
        if (exhaustionVeto.veto) {
            signal.reasons.push(exhaustionVeto.reason);
            return { ...signal, signal: 'HOLD' };
        }
        signal.reasons.push('✅ Exhaustion Filter: Passed.');
    }
    
    // --- BTC Trend Confirmation Gatekeeper ---
    if (config.isBtcConfirmationEnabled && !config.pair.startsWith('BTC/')) {
        try {
            const btcKlines = await btcConfirmationService.getDataForTimeframe(config.timeFrame);
            const { bullScore, bearScore } = getBtcTrendScore(btcKlines);
            const threshold = config.btcConfirmationThreshold ?? 60;

            if (signal.signal === 'BUY') {
                if (bullScore < threshold) {
                    signal.reasons.push(`❌ VETO: BTC trend is not bullish enough (Score: ${bullScore}, Threshold: ${threshold}).`);
                    return { ...signal, signal: 'HOLD' };
                }
                signal.reasons.push(`✅ BTC Trend: Confirmed Bullish (Score: ${bullScore}).`);
            }
            if (signal.signal === 'SELL') {
                if (bearScore < threshold) {
                    signal.reasons.push(`❌ VETO: BTC trend is not bearish enough (Score: ${bearScore}, Threshold: ${threshold}).`);
                    return { ...signal, signal: 'HOLD' };
                }
                 signal.reasons.push(`✅ BTC Trend: Confirmed Bearish (Score: ${bearScore}).`);
            }
        } catch (e) {
            console.warn("Could not fetch BTC klines for confirmation:", e);
            signal.reasons.push(`⚠️ BTC Trend: Could not confirm (API error).`);
        }
    }
    
    // --- ENTRY GATEKEEPER SYSTEM ---
    const marketContext = captureMarketContext(klines);
    const lastKline = getLast(klines);
    if (!lastKline) return { signal: 'HOLD', reasons: ['No kline data available.'] };

    const entryPrice = lastKline.close;
    const isLong = signal.signal === 'BUY';

    // Gatekeeper -1: Volume Veto
    if (config.isVolumeFilterEnabled) {
        if (marketContext.lastVolume && marketContext.volumeSma20 && marketContext.lastVolume < marketContext.volumeSma20) {
            signal.reasons.push('❌ VETO: Low entry volume.');
            return { ...signal, signal: 'HOLD' };
        }
        signal.reasons.push('✅ Volume: Passed.');
    }

    const reversionVeto = getMeanReversionVeto(klines, signal.signal, config);
    if (reversionVeto.veto) {
        signal.reasons.push(reversionVeto.reason);
        return { ...signal, signal: 'HOLD' };
    }

    const htfMomentumVeto = getHtfMomentumSyncVeto(signal.signal, htfContext, config);
    if (htfMomentumVeto.veto) {
        signal.reasons.push(htfMomentumVeto.reason);
        return { ...signal, signal: 'HOLD' };
    }

    if (config.isVwapConfirmationEnabled) {
        if (marketContext.vwap) {
            if (isLong && entryPrice < marketContext.vwap) {
                signal.reasons.push(`❌ VETO: Price is below daily VWAP.`);
                return { ...signal, signal: 'HOLD' };
            }
            if (!isLong && entryPrice > marketContext.vwap) {
                signal.reasons.push(`❌ VETO: Price is above daily VWAP.`);
                return { ...signal, signal: 'HOLD' };
            }
            signal.reasons.push(`✅ VWAP Confirmation: Passed.`);
        }
    }

    if (config.isHtfConfirmationEnabled && htfContext?.htf_trend) {
        signal.reasons.push(`ℹ️ HTF Trend is ${htfContext.htf_trend}.`);
        if (signal.signal === 'BUY' && htfContext.htf_trend === 'bearish') {
            signal.reasons.push(`❌ VETO: HTF is bearish.`);
            return { ...signal, signal: 'HOLD' };
        }
        if (signal.signal === 'SELL' && htfContext.htf_trend === 'bullish') {
            signal.reasons.push(`❌ VETO: HTF is bullish.`);
            return { ...signal, signal: 'HOLD' };
        }
        signal.reasons.push(`✅ HTF Confirmation: Passed.`);
    }

    const haKlines = calculateHeikinAshi(klines);
    const cohesionCheck = isMarketCohesive(haKlines, signal.signal, config.timeFrame, config.agentParams?.qsc_marketCohesionCandles ?? 2);
    if (config.isMarketCohesionEnabled && !cohesionCheck.cohesive) {
        signal.reasons.push(cohesionCheck.reason);
        return { ...signal, signal: 'HOLD' };
    }
     if(config.isMarketCohesionEnabled) signal.reasons.push(cohesionCheck.reason);

    const candleVeto = isLastCandleContradictory(klines, signal.signal);
    if (candleVeto.veto) {
        signal.reasons.push(candleVeto.reason);
        return { ...signal, signal: 'HOLD' };
    }

    return signal;
};