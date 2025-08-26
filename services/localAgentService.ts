import { TradingMode, type Agent, type TradeSignal, type Kline, type AgentParams, type Position, type ADXOutput, type MACDOutput, type BollingerBandsOutput, type StochasticRSIOutput, type TradeManagementSignal, type BotConfig, VortexIndicatorOutput, SentinelAnalysis, KSTOutput, type IchimokuCloudOutput, MarketDataContext } from '../types';
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV, VWAP, IchimokuCloud, KST, abandonedbaby, bearishengulfingpattern, bullishengulfingpattern, darkcloudcover, downsidetasukigap, dragonflydoji, gravestonedoji, bullishharami, bearishharami, bullishharamicross, bearishharamicross, hammerpattern, hangingman, morningdojistar, morningstar, eveningdojistar, eveningstar, piercingline, shootingstar, threeblackcrows, threewhitesoldiers } from 'technicalindicators';
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
const { TIMEFRAME_ATR_CONFIG, MIN_PROFIT_BUFFER_MULTIPLIER } = constants;

const isObvTrending = (obvValues: number[], direction: 'bullish' | 'bearish', period: number = 5): boolean => {
    if (obvValues.length < period + 1) return false;
    const obvSma = SMA.calculate({ period, values: obvValues });
    const lastSma = getLast(obvSma);
    const prevSma = getPenultimate(obvSma);
    if (lastSma === undefined || prevSma === undefined) return false;
    return direction === 'bullish' ? lastSma > prevSma : lastSma < prevSma;
};

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
        case 18: timeframeSettings = constants.CANDLESTICK_PROPHET_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
    }
    
    finalParams = { ...finalParams, ...timeframeSettings };

    // Apply user-specific overrides last
    finalParams = { ...finalParams, ...agentParams };
    
    // Return a new config object with the finalized params
    return { ...config, agentParams: finalParams };
}

const bullishPatterns = { 'Bullish Engulfing': bullishengulfingpattern, 'Dragonfly Doji': dragonflydoji, 'Bullish Harami': bullishharami, 'Bullish Harami Cross': bullishharamicross, 'Hammer': hammerpattern, 'Morning Doji Star': morningdojistar, 'Morning Star': morningstar, 'Piercing Line': piercingline, 'Three White Soldiers': threewhitesoldiers };
const bearishPatterns = { 'Abandoned Baby': abandonedbaby, 'Bearish Engulfing': bearishengulfingpattern, 'Dark Cloud Cover': darkcloudcover, 'Downside Tasuki Gap': downsidetasukigap, 'Gravestone Doji': gravestonedoji, 'Bearish Harami': bearishharami, 'Bearish Harami Cross': bearishharamicross, 'Hanging Man': hangingman, 'Evening Doji Star': eveningdojistar, 'Evening Star': eveningstar, 'Shooting Star': shootingstar, 'Three Black Crows': threeblackcrows };

function findLastCandlestickPattern(klines: Kline[], direction: 'LONG' | 'SHORT'): { patternInfo: { name: string; index: number; low: number; high: number } | null } {
    const patternsToCheck = direction === 'LONG' ? bullishPatterns : bearishPatterns;
    const opens = klines.map(k => k.open);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const closes = klines.map(k => k.close);
    
    for (let i = klines.length - 1; i >= Math.max(0, klines.length - 3); i--) {
        const tempInput = { open: opens.slice(0, i + 1), high: highs.slice(0, i + 1), low: lows.slice(0, i + 1), close: closes.slice(0, i + 1) };
        for (const [name, patternFunc] of Object.entries(patternsToCheck)) {
            try {
                if (getLast(patternFunc(tempInput))) {
                    const multiCandlePatterns: Record<string, number> = { 'Morning Star': 3, 'Evening Star': 3, 'Three White Soldiers': 3, 'Three Black Crows': 3, 'Bullish Engulfing': 2, 'Bearish Engulfing': 2 };
                    const patternLength = multiCandlePatterns[name] || 1;
                    const patternCandles = klines.slice(Math.max(0, i - patternLength + 1), i + 1);
                    
                    const patternLow = Math.min(...patternCandles.map(c => c.low));
                    const patternHigh = Math.max(...patternCandles.map(c => c.high));
                    
                    return { patternInfo: { name, index: i, low: patternLow, high: patternHigh } };
                }
            } catch (e) { /* Ignore errors from insufficient data for a pattern */ }
        }
    }
    return { patternInfo: null };
}

/**
 * NEW: A final safety check to prevent entering a trade if the last few candles show
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
    const currentAtr = (getLast(atrValues) as number) || (entryPrice * 0.01);

    // Default Fallback SL
    const fallbackStop = () => {
        const timeframeConfig = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];
        const atrMultiplier = timeframeConfig.atrMultiplier;
        return isLong ? entryPrice - (currentAtr * atrMultiplier) : entryPrice + (currentAtr * atrMultiplier);
    }

    switch (agent.id) {
        case 7: // Market Structure Maven
        case 11: // Historic Expert
            const srLookback = agent.id === 7 ? params.msm_swingPointLookback : 10;
            const { supports, resistances } = calculateSupportResistance(klines, srLookback);
            if (isLong) {
                const protectiveSupports = supports.filter(s => s < entryPrice);
                if (protectiveSupports.length > 0) {
                    const relevantSupport = Math.max(...protectiveSupports); // Closest support below entry
                    agentStopLoss = relevantSupport - currentAtr * 0.25;
                } else {
                    agentStopLoss = fallbackStop();
                }
            } else { // SHORT
                const protectiveResistances = resistances.filter(r => r > entryPrice);
                if (protectiveResistances.length > 0) {
                    const relevantResistance = Math.min(...protectiveResistances); // Closest resistance above entry
                    agentStopLoss = relevantResistance + currentAtr * 0.25;
                } else {
                    agentStopLoss = fallbackStop();
                }
            }
            break;

        case 9: // Quantum Scalper: Context-aware SL (Trending vs. Ranging).
            const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.qsc_adxPeriod! }))! as ADXOutput;
            const isTrending = adx.adx > params.qsc_adxThreshold!;
            if (isTrending) { 
                const psarInput = { high: highs, low: lows, step: params.qsc_psarStep, max: params.qsc_psarMax };
                const psar = getLast(PSAR.calculate(psarInput)) as number | undefined;

                const stInput = { high: highs, low: lows, close: closes, period: params.qsc_superTrendPeriod, multiplier: params.qsc_superTrendMultiplier };
                const st = getLast(Supertrend.calculate(stInput)) as number | undefined;

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
                const bb = getLast(BollingerBands.calculate({ period: params.qsc_bbPeriod!, stdDev: params.qsc_bbStdDev!, values: closes }))!;
                agentStopLoss = isLong ? bb.lower - currentAtr * 0.2 : bb.upper + currentAtr * 0.2;
            }
            break;
            
        case 16: // Ichimoku Trend Rider
            const ichi_params_ch = {
                high: highs, low: lows,
                conversionPeriod: params.ichi_conversionPeriod, basePeriod: params.ichi_basePeriod,
                spanPeriod: params.ichi_laggingSpanPeriod, displacement: params.ichi_displacement
            };
            const ichi = getLast(IchimokuCloud.calculate(ichi_params_ch)) as IchimokuCloudOutput | undefined;
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

        case 15: // Institutional Flow Tracer: SL is placed just beyond the low/high of the confirmation candle.
            const lastKline = klines[klines.length - 1];
            if (lastKline) {
                agentStopLoss = isLong ? lastKline.low - currentAtr * 0.2 : lastKline.high + currentAtr * 0.2;
            } else {
                agentStopLoss = fallbackStop();
            }
            break;
        
        case 17: // The Detonator: SL at recent swing high/low.
            const detSwingLookback = 10;
            const { supports: det_supports, resistances: det_resistances } = calculateSupportResistance(klines, detSwingLookback);
             if (isLong) {
                const protectiveSupports = det_supports.filter(s => s < entryPrice);
                if (protectiveSupports.length > 0) {
                    agentStopLoss = Math.max(...protectiveSupports) - currentAtr * 0.1; // Tighter buffer for breakout
                } else {
                    agentStopLoss = fallbackStop();
                }
            } else { // SHORT
                const protectiveResistances = det_resistances.filter(r => r > entryPrice);
                if (protectiveResistances.length > 0) {
                    agentStopLoss = Math.min(...protectiveResistances) + currentAtr * 0.1; // Tighter buffer for breakout
                } else {
                    agentStopLoss = fallbackStop();
                }
            }
            break;
        
        case 18: // Candlestick Prophet
            const { patternInfo } = findLastCandlestickPattern(klines, direction);
            if (patternInfo) {
                 const buffer = currentAtr * 0.1;
                 agentStopLoss = isLong ? patternInfo.low - buffer : patternInfo.high + buffer;
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

    const maxLossInDollars = investmentAmount * (constants.MAX_MARGIN_LOSS_PERCENT / 100);
    const positionValue = mode === TradingMode.USDSM_Futures ? investmentAmount * leverage : investmentAmount;
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


    // --- Step 4: Calculate Take Profit based on Market Structure first, then R:R ---
    const stopLossDistance = Math.abs(entryPrice - finalStopLoss);
    let suggestedTakeProfit: number | null = null;
    
    // --- Primary: S/R Based Take Profit ---
    const srTpLookback = params.msm_swingPointLookback || 15; // Use a reasonable default
    const { supports: tp_supports, resistances: tp_resistances } = calculateSupportResistance(klines, srTpLookback);

    if (isLong && tp_resistances.length > 0) {
        const potentialTps = tp_resistances.filter(r => r > entryPrice);
        if (potentialTps.length > 0) {
            const potentialTp = Math.min(...potentialTps); // Closest resistance
            const bufferedTp = potentialTp * 0.999; // Buffer to avoid front-running
            const rewardDistance = Math.abs(bufferedTp - entryPrice);
            const rrRatio = stopLossDistance > 0 ? rewardDistance / stopLossDistance : Infinity;
            if (rrRatio >= constants.MIN_RISK_REWARD_RATIO) {
                suggestedTakeProfit = bufferedTp;
            }
        }
    } else if (!isLong && tp_supports.length > 0) {
        const potentialTps = tp_supports.filter(s => s < entryPrice);
        if (potentialTps.length > 0) {
            const potentialTp = Math.max(...potentialTps); // Closest support
            const bufferedTp = potentialTp * 1.001; // Buffer
            const rewardDistance = Math.abs(bufferedTp - entryPrice);
            const rrRatio = stopLossDistance > 0 ? rewardDistance / stopLossDistance : Infinity;
            if (rrRatio >= constants.MIN_RISK_REWARD_RATIO) {
                suggestedTakeProfit = bufferedTp;
            }
        }
    }

    // --- Fallback: R:R Based Take Profit ---
    if (suggestedTakeProfit === null) {
        const timeframeConfig = TIMEFRAME_ATR_CONFIG[timeFrame] || TIMEFRAME_ATR_CONFIG['5m'];
        let riskRewardRatio = timeframeConfig.riskRewardRatio;

        if (agent.id === 13) {
            riskRewardRatio = 4;
        } else if (agent.id === 17) {
            riskRewardRatio = params.det_rr_mult;
        }
        suggestedTakeProfit = isLong ? entryPrice + (stopLossDistance * riskRewardRatio) : entryPrice - (stopLossDistance * riskRewardRatio);
    }


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
 * NEW: A hyper-reactive, tick-based system to secure profits on sudden spikes.
 * It monitors PNL as a percentage of initial investment and aggressively trails the stop loss.
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
        profitSpikeTier = 0 // Default to 0 if not present
    } = position;

    // This logic only applies if we have the investment amount and size.
    if (!investmentAmount || investmentAmount <= 0 || !size || size <= 0) {
        return { reasons: [] };
    }

    const isLong = direction === 'LONG';
    const currentPnl = (currentPrice - entryPrice) * size * (isLong ? 1 : -1);

    // No PNL or in a loss, no action needed.
    if (currentPnl <= 0) {
        return { reasons: [] };
    }

    const pnlPercentage = (currentPnl / investmentAmount) * 100;

    const tiers = [
        { triggerPercent: 100, lockPercent: 80, tier: 3 },
        { triggerPercent: 60, lockPercent: 45, tier: 2 },
        { triggerPercent: 30, lockPercent: 20, tier: 1 },
    ];

    // Find the highest applicable tier that hasn't been triggered yet.
    const applicableTier = tiers.find(t => pnlPercentage >= t.triggerPercent && profitSpikeTier < t.tier);

    if (applicableTier) {
        // Calculate the PNL to lock in, based on the initial investment.
        const lockedPnlDollars = investmentAmount * (applicableTier.lockPercent / 100);
        
        // Convert the locked PNL back to a price difference.
        const lockedPnlInPrice = lockedPnlDollars / size;
        
        const newStopLoss = entryPrice + (lockedPnlInPrice * (isLong ? 1 : -1));

        // Only update if the new stop loss is an improvement.
        if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
            return {
                newStopLoss,
                reasons: [`Spike Protector: Locked ${applicableTier.lockPercent}% profit at ${pnlPercentage.toFixed(1)}% gain.`],
                // Important: Also update the activeStopLossReason to ensure it's reflected in the UI
                newState: { profitSpikeTier: applicableTier.tier, activeStopLossReason: 'Profit Secure' }
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
                newState: { isBreakevenSet: true, profitLockTier: 3 }
            };
        }
    }

    return { reasons: [] };
}


/**
 * A multi-stage, fee-multiple-based profit-locking mechanism that runs after breakeven is secured.
 * Moves SL to lock in profits at (N-1)x fee-multiple milestones for every N >= 4 profit tier reached.
 * This is controlled by the "Universal Profit Trail" toggle.
 * @param position - The current open position.
 * @param currentPrice - The live price tick.
 * @returns A TradeManagementSignal with a potential new stop loss.
 */
export function getMultiStageProfitSecureSignal(
    position: Position,
    currentPrice: number
): TradeManagementSignal {
    const { entryPrice, stopLossPrice, direction, isBreakevenSet, profitLockTier, size, takerFeeRate } = position;

    // This logic only applies after mandatory breakeven has been set.
    if (!isBreakevenSet) {
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

    // Cannot calculate fee multiples if fee is zero.
    if (roundTripFeeDollars <= 0) {
        return { reasons: [] };
    }

    const currentFeeMultiple = currentPnlDollars / roundTripFeeDollars;
    
    // Dynamic (N)x -> (N-1)x fee-multiple based profit lock (for N >= 4 after 3x breakeven)
    const startingTier = 4;
    if (currentFeeMultiple >= startingTier) {
        const triggerFeeMultiple = Math.floor(currentFeeMultiple); // This is our 'N'
        
        if (triggerFeeMultiple > profitLockTier) {
            const lockFeeMultiple = triggerFeeMultiple - 1; // This is 'N-1'
            
            // Calculate the locked-in PNL in dollars
            const lockedPnlDollars = roundTripFeeDollars * lockFeeMultiple;
            
            // Convert the locked-in PNL back to a price difference
            const lockedPnlInPrice = lockedPnlDollars / size;
            
            const newStopLoss = entryPrice + (lockedPnlInPrice * (isLong ? 1 : -1));

            if ((isLong && newStopLoss > stopLossPrice) || (!isLong && newStopLoss < stopLossPrice)) {
                const reason = `Profit Secure: Tier ${triggerFeeMultiple - 3} activated at ${triggerFeeMultiple}x fee gain.`;
                return {
                    newStopLoss,
                    reasons: [reason],
                    newState: { profitLockTier: triggerFeeMultiple } // Update the tier to the new trigger level
                };
            }
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
    // The agent's native trailing stop is always active from the moment a position is opened.
    // It competes with other stop-loss systems (initial SL, breakeven, profit secure),
    // and the bot manager will always choose the tightest, most protective stop.
    // We only need to return the raw indicator value; the manager handles the comparison logic.

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
    // Ensure initialRisk is not zero to avoid division by zero
    const currentRR = (initialRiskInPrice > 1e-9 && currentProfitInPrice > 0) ? currentProfitInPrice / initialRiskInPrice : 0;
    
    // Timeframe-aware R:R thresholds for accelerating the trail
    const isLowTimeframe = ['1m', '3m', '5m'].includes(position.timeFrame);
    const rrThresholds = isLowTimeframe
        ? { high: 1.5, hyper: 2.5, max: 4 } // More aggressive for scalps
        : { high: 2, hyper: 4, max: 6 }; // Standard for longer trades
    
    let profitVelocity = 1; // 1x Velocity: Normal speed
    if (currentRR > rrThresholds.max) {
        profitVelocity = 4; // 4x Velocity: Maximum
    } else if (currentRR > rrThresholds.hyper) {
        profitVelocity = 3; // 3x Velocity: Hyper speed
    } else if (currentRR > rrThresholds.high) {
        profitVelocity = 2; // 2x Velocity: High speed
    }


    switch (agent.id) {
        case 7: // Market Structure Maven
        case 18: // Candlestick Prophet (uses S/R for trailing)
            const srLookback = params.msm_swingPointLookback;
            const { supports, resistances } = calculateSupportResistance(klines, srLookback);
            if (isLong) {
                const protectiveSupports = supports.filter(s => s < currentPrice);
                if (protectiveSupports.length > 0) newStopLoss = Math.max(...protectiveSupports);
            } else { // SHORT
                const protectiveResistances = resistances.filter(r => r > currentPrice);
                if (protectiveResistances.length > 0) newStopLoss = Math.min(...protectiveResistances);
            }
            if (newStopLoss) reasons.push('Agent S/R Trail');
            break;

        case 9: // Quantum Scalper: PSAR-based trailing stop
        case 17: // The Detonator: Also uses aggressive PSAR trailing for breakouts
            let step = agent.id === 9 ? params.qsc_psarStep : params.scalp_psarStep;
            let max = agent.id === 9 ? params.qsc_psarMax : params.scalp_psarMax;
            
            if (profitVelocity > 1) {
                step *= profitVelocity;
                max *= profitVelocity;
                reasons.push(`Agent Trail: Profit Velocity active (${profitVelocity}x)`);
            } else {
                 reasons.push('Agent PSAR Trail');
            }
            
            const psarInput = { high: klines.map(k => k.high), low: klines.map(k => k.low), step, max };
            if (psarInput.high.length >= 2) {
                const psar = PSAR.calculate(psarInput);
                newStopLoss = getLast(psar) as number | undefined;
            }
            break;

        case 11: // Historic Expert
        case 13: // The Chameleon
            const baseEmaPeriod = agent.id === 11 ? params.he_slowEmaPeriod : params.ch_slowEmaPeriod!;
            const fastEmaPeriod = agent.id === 11 ? params.he_fastEmaPeriod : params.ch_fastEmaPeriod!;

            // Make the EMA faster by dividing the period, but don't let it get faster than the agent's fastest EMA setting.
            const trailEmaPeriod = Math.max(fastEmaPeriod, Math.round(baseEmaPeriod / profitVelocity));

            if (profitVelocity > 1) {
                reasons.push(`Agent Trail: Profit Velocity active (${profitVelocity}x speed)`);
            } else {
                reasons.push('Agent EMA Trail');
            }
            newStopLoss = getLast(EMA.calculate({ period: trailEmaPeriod, values: closes }));
            break;

        case 14: // The Sentinel
            const baseMultiplier = 3;
            // Make the ST tighter by dividing the multiplier, but don't let it go below a safe minimum (e.g., 1).
            const trailMultiplier = Math.max(1, baseMultiplier / profitVelocity);
            
            if (profitVelocity > 1) {
                reasons.push(`Agent Trail: Profit Velocity active (${profitVelocity}x speed)`);
            } else {
                reasons.push('Agent Supertrend Trail');
            }

            newStopLoss = getLast(Supertrend.calculate({ high: highs, low: lows, close: closes, period: 10, multiplier: trailMultiplier }));
            break;

        case 15: // Institutional Flow Tracer
            newStopLoss = getLast(VWAP.calculate({ high: highs, low: lows, close: closes, volume: klines.map(k => k.volume || 0) }));
             if (newStopLoss) reasons.push('Agent VWAP Trail');
            break;

        case 16: // Ichimoku Trend Rider
            const ichi_params = {
                high: klines.map(k => k.high), low: klines.map(k => k.low),
                conversionPeriod: params.ichi_conversionPeriod,
                basePeriod: params.ichi_basePeriod,
                spanPeriod: params.ichi_laggingSpanPeriod,
                displacement: params.ichi_displacement
            };
            const ichiValues = IchimokuCloud.calculate(ichi_params) as IchimokuCloudOutput[];
            const lastIchi = getLast(ichiValues);
            if(lastIchi) {
                newStopLoss = isLong ? lastIchi.spanA : lastIchi.spanB;
                if(newStopLoss) reasons.push('Agent Ichimoku Cloud Trail');
            }
            break;

        default:
            break;
    }

    return { newStopLoss, action, reasons };
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

// --- Agent 7: Market Structure Maven (Upgraded with Vortex Indicator Confirmation) ---
const getMarketStructureMavenSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = Math.max(params.msm_htfEmaPeriod, params.atrPeriod, params.viPeriod, params.obvPeriod, 20);
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };

    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    const lastKline = klines[klines.length - 1];
    const prevKline = klines[klines.length - 2];
    const reasons: string[] = [];

    const emaBias = getLast(EMA.calculate({ period: params.msm_htfEmaPeriod, values: closes }))! as number;
    const isBullishBias = currentPrice > emaBias;
    reasons.push(isBullishBias ? `✅ Trend Bias: Bullish` : `✅ Trend Bias: Bearish`);
    
    const vi = VortexIndicator.calculate({ high: klines.map(k=>k.high), low: klines.map(k=>k.low), close: closes, period: params.viPeriod }) as VortexIndicatorOutput;
    const last_vi_plus = getLast(vi.pdi)!;
    const last_vi_minus = getLast(vi.ndi)!;
    const isViBullish = last_vi_plus > last_vi_minus;
    const isViBearish = last_vi_minus > last_vi_plus;

    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');

    const { supports, resistances } = calculateSupportResistance(klines, params.msm_swingPointLookback);
    const atr = getLast(ATR.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes, period: params.atrPeriod }))! as number;
    const proximityZone = atr * 0.5;
    const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes }))! as number;
    const lastVolume = getLast(volumes)!;

    if (isBullishBias && supports.length > 0) {
        const closestSupport = supports.find(s => s < currentPrice) || supports[0];
        if (Math.abs(currentPrice - closestSupport) <= proximityZone) {
            reasons.push(`✅ Price in support zone`);
            reasons.push(isViBullish ? `✅ VI Momentum: Bullish` : `❌ VI Momentum: Not Bullish`);
            reasons.push(isObvBullish ? `✅ OBV Confirmation: Bullish` : `❌ OBV Confirmation: Not Bullish`);
            if (params.isCandleConfirmationEnabled) {
                const pattern = recognizeCandlestickPattern(lastKline, prevKline);
                const hasConfirmationCandle = pattern?.type === 'bullish';
                const hasConfirmationVolume = lastVolume > volumeSma;
                reasons.push(hasConfirmationCandle ? `✅ Confirmed by ${pattern.name}` : `❌ Awaiting bullish candle`);
                reasons.push(hasConfirmationVolume ? `✅ Confirmation volume is strong` : `❌ Awaiting strong volume`);
                if (isViBullish && hasConfirmationCandle && hasConfirmationVolume && isObvBullish) return { signal: 'BUY', reasons };
            } else {
                const isLowVolume = lastVolume < volumeSma;
                reasons.push(isLowVolume ? `✅ Low volume pullback detected` : `❌ Awaiting low volume pullback`);
                if (isViBullish && isLowVolume && isObvBullish) return { signal: 'BUY', reasons };
            }
        }
    }

    if (!isBullishBias && resistances.length > 0) {
        const closestResistance = resistances.find(r => r > currentPrice) || resistances[0];
        if (Math.abs(currentPrice - closestResistance) <= proximityZone) {
            reasons.push(`✅ Price in resistance zone`);
            reasons.push(isViBearish ? `✅ VI Momentum: Bearish` : `❌ VI Momentum: Not Bearish`);
            reasons.push(isObvBearish ? `✅ OBV Confirmation: Bearish` : `❌ OBV Confirmation: Not Bearish`);
             if (params.isCandleConfirmationEnabled) {
                const pattern = recognizeCandlestickPattern(lastKline, prevKline);
                const hasConfirmationCandle = pattern?.type === 'bearish';
                const hasConfirmationVolume = lastVolume > volumeSma;
                reasons.push(hasConfirmationCandle ? `✅ Confirmed by ${pattern.name}` : `❌ Awaiting bearish candle`);
                reasons.push(hasConfirmationVolume ? `✅ Confirmation volume is strong` : `❌ Awaiting strong volume`);
                if (isViBearish && hasConfirmationCandle && hasConfirmationVolume && isObvBearish) return { signal: 'SELL', reasons };
            } else {
                const isLowVolume = lastVolume < volumeSma;
                reasons.push(isLowVolume ? `✅ Low volume pullback detected` : `❌ Awaiting low volume pullback`);
                if (isViBearish && isLowVolume && isObvBearish) return { signal: 'SELL', reasons };
            }
        }
    }

    return { signal: 'HOLD', reasons };
};

// --- Agent 9: Quantum Scalper (Upgraded with Volatility Filter, Ichimoku Gatekeeper, and Safer Reversals) ---
const getQuantumScalperSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = Math.max(params.qsc_ichi_basePeriod + params.qsc_ichi_displacement, 50);
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data (${klines.length}/${minKlines})`] };
    
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);
    const lastKline = klines[klines.length - 1];
    const currentPrice = lastKline.close;
    const reasons: string[] = [];

    // --- 0. HTF & OBV Gatekeepers (Centralized Checks) ---
    let htfIsConfluentBullish = !config.isHtfConfirmationEnabled; // Default to true if HTF is disabled
    let htfIsConfluentBearish = !config.isHtfConfirmationEnabled;
    if (config.isHtfConfirmationEnabled && htfContext) {
        const htfIsTrendBullish = htfContext.htf_trend === 'bullish';
        const htfIsMomentumBullish = htfContext.htf_obvTrend === 'bullish' || !!(htfContext.htf_vi14 && htfContext.htf_vi14.pdi > htfContext.htf_vi14.ndi);
        htfIsConfluentBullish = htfIsTrendBullish && htfIsMomentumBullish;
        
        const htfIsTrendBearish = htfContext.htf_trend === 'bearish';
        const htfIsMomentumBearish = htfContext.htf_obvTrend === 'bearish' || !!(htfContext.htf_vi14 && htfContext.htf_vi14.ndi > htfContext.htf_vi14.pdi);
        htfIsConfluentBearish = htfIsTrendBearish && htfIsMomentumBearish;
        reasons.push(htfIsConfluentBullish || htfIsConfluentBearish ? '✅ HTF Confirmation: Trend aligned.' : '❌ HTF Confirmation: Trend misaligned.');
    } else if (config.isHtfConfirmationEnabled && !htfContext) {
        reasons.push('❌ HTF Confirmation: Data unavailable.');
    }
    
    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');
    
    // --- 1. Volatility Filter ---
    const bbForWidth = BollingerBands.calculate({ period: params.qsc_bbPeriod, stdDev: params.qsc_bbStdDev, values: closes });
    const lastBbForWidth = getLast(bbForWidth)!;
    const bbWidth = (lastBbForWidth.upper - lastBbForWidth.lower) / lastBbForWidth.middle;
    if (bbWidth < params.qsc_bbwSqueezeThreshold) {
        return { signal: 'HOLD', reasons: [`ℹ️ Standby: Low volatility squeeze detected (BBW: ${bbWidth.toFixed(4)})`] };
    }
    
    // --- 2. Regime Filter ---
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.qsc_adxPeriod }))! as ADXOutput;
    const isTrending = adx.adx > params.qsc_adxThreshold;
    reasons.push(isTrending ? `ℹ️ Regime: Trending (ADX ${adx.adx.toFixed(1)})` : `ℹ️ Regime: Ranging (ADX ${adx.adx.toFixed(1)})`);

    if (isTrending) {
        // --- HTF Trend Strength Filter (Trending Regime Only) ---
        if (config.isHtfConfirmationEnabled && htfContext?.htf_adx14 && htfContext.htf_adx14.adx < 20) {
            reasons.push(`❌ VETO: Higher timeframe is not trending (ADX < 20).`);
            return { signal: 'HOLD', reasons };
        }
        if (config.isHtfConfirmationEnabled && htfContext?.htf_adx14) {
             reasons.push(`✅ HTF Trend Strength: OK (ADX ${htfContext.htf_adx14.adx.toFixed(1)})`);
        }
        
        const rsi = getLast(RSI.calculate({ period: 14, values: closes }))!;
        if (rsi >= params.qsc_rsiOverextendedLong) {
            reasons.push(`❌ VETO: Trend is overextended (RSI >= ${params.qsc_rsiOverextendedLong}).`);
            return { signal: 'HOLD', reasons };
        }
         if (rsi <= params.qsc_rsiOverextendedShort) {
            reasons.push(`❌ VETO: Trend is overextended (RSI <= ${params.qsc_rsiOverextendedShort}).`);
            return { signal: 'HOLD', reasons };
        }
        reasons.push(`✅ Trend Strength: Healthy (RSI ${rsi.toFixed(1)})`);
        
        const ichi_params = {
            high: highs, low: lows,
            conversionPeriod: params.qsc_ichi_conversionPeriod, basePeriod: params.qsc_ichi_basePeriod,
            spanPeriod: params.qsc_ichi_laggingSpanPeriod, displacement: params.qsc_ichi_displacement
        };
        const ichi = getLast(IchimokuCloud.calculate(ichi_params)) as IchimokuCloudOutput | undefined;
        const isPriceAboveKumo = ichi && ichi.spanA && ichi.spanB && currentPrice > ichi.spanA && currentPrice > ichi.spanB;
        const isPriceBelowKumo = ichi && ichi.spanA && ichi.spanB && currentPrice < ichi.spanA && currentPrice < ichi.spanB;
        
        if (isPriceAboveKumo) {
            if (config.isHtfConfirmationEnabled && !htfIsConfluentBullish) return { signal: 'HOLD', reasons };
            if (!isObvBullish) {
                reasons.push('❌ OBV: Lacks Bullish Flow');
                return { signal: 'HOLD', reasons };
            }
            reasons.push('✅ Ichimoku: Bullish Trend Confirmed');
            let bullishScore = 0;
            const stValues = Supertrend.calculate({ high: highs, low: lows, close: closes, period: params.qsc_superTrendPeriod, multiplier: params.qsc_superTrendMultiplier });
            const lastStValue = getLast(stValues);
            const isStBullish = lastStValue !== undefined && currentPrice > lastStValue;
            if(isStBullish) bullishScore++;
            reasons.push(isStBullish ? '✅ Supertrend: Bullish' : '❌ Supertrend: Not Bullish');

            const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod }) as VortexIndicatorOutput;
            const isViBullish = getLast(vi.pdi)! > getLast(vi.ndi)!;
            if(isViBullish) bullishScore++;
            reasons.push(isViBullish ? '✅ VI: Bullish Momentum' : '❌ VI: Lacks Bullish Momentum');
            
            reasons.push(isObvBullish ? '✅ OBV: Bullish Flow' : '❌ OBV: Lacks Bullish Flow');

            const isDirectionConcordant = adx.pdi > adx.mdi;
            if(isDirectionConcordant) bullishScore++;
            reasons.push(isDirectionConcordant ? '✅ ADX Concordance: Bullish' : '❌ ADX Concordance: Not Bullish');

            if (bullishScore >= params.qsc_trendScoreThreshold) return { signal: 'BUY', reasons };

        } else if (isPriceBelowKumo) {
            if (config.isHtfConfirmationEnabled && !htfIsConfluentBearish) return { signal: 'HOLD', reasons };
            if (!isObvBearish) {
                reasons.push('❌ OBV: Lacks Bearish Flow');
                return { signal: 'HOLD', reasons };
            }
            reasons.push('✅ Ichimoku: Bearish Trend Confirmed');
            let bearishScore = 0;
            const stValues = Supertrend.calculate({ high: highs, low: lows, close: closes, period: params.qsc_superTrendPeriod, multiplier: params.qsc_superTrendMultiplier });
            const lastStValue = getLast(stValues);
            const isStBearish = lastStValue !== undefined && currentPrice < lastStValue;
            if(isStBearish) bearishScore++;
            reasons.push(isStBearish ? '✅ Supertrend: Bearish' : '❌ Supertrend: Not Bearish');
            
            const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod }) as VortexIndicatorOutput;
            const isViBearish = getLast(vi.ndi)! > getLast(vi.pdi)!;
            if(isViBearish) bearishScore++;
            reasons.push(isViBearish ? '✅ VI: Bearish Momentum' : '❌ VI: Lacks Bearish Momentum');

            reasons.push(isObvBearish ? '✅ OBV: Bearish Flow' : '❌ OBV: Lacks Bearish Flow');

            const isDirectionConcordant = adx.mdi > adx.pdi;
            if(isDirectionConcordant) bearishScore++;
            reasons.push(isDirectionConcordant ? '✅ ADX Concordance: Bearish' : '❌ ADX Concordance: Not Bearish');

            if (bearishScore >= params.qsc_trendScoreThreshold) return { signal: 'SELL', reasons };
        } else {
             reasons.push('❌ Ichimoku: Price is inside Kumo (No Clear Trend)');
        }

    } else { // --- Ranging Logic ---
        const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: params.qsc_stochRsiPeriod, stochasticPeriod: params.qsc_stochRsiPeriod, kPeriod: 3, dPeriod: 3 }))!;
        const bb = getLast(bbForWidth)!;

        // Bullish Reversal Check
        const isPriceOversold = lastKline.low < bb.lower && lastKline.close > bb.lower;
        const isStochOversold = stochRsi.stochRSI < params.qsc_stochRsiOversold;
        const bullishCandleConfirmation = lastKline.close > lastKline.open;
        
        let bullishReasons: string[] = [...reasons];
        let bullishScore = 0;
        bullishReasons.push(isPriceOversold ? `✅ Price: Rejected Lower BB` : `❌ Price: No Lower BB Rejection`);
        if (isPriceOversold) bullishScore++;
        bullishReasons.push(isStochOversold ? `✅ StochRSI: Oversold` : `❌ StochRSI: Not Oversold`);
        if (isStochOversold) bullishScore++;
        bullishReasons.push(isObvBullish ? `✅ OBV > SMA: Bullish Volume` : `❌ OBV: Lacks Bullish Volume`);
        if (isObvBullish) bullishScore++;
        bullishReasons.push(bullishCandleConfirmation ? `✅ Price Action: Bullish Reversal Candle` : `❌ Price Action: No reversal confirmation`);
        if (bullishCandleConfirmation) bullishScore++;
        
        if (bullishScore >= params.qsc_rangeScoreThreshold) {
            if (config.isHtfConfirmationEnabled && !htfIsConfluentBullish) {
                return { signal: 'HOLD', reasons: bullishReasons };
            }
            if (!isObvBullish) {
                return { signal: 'HOLD', reasons: bullishReasons };
            }
            return { signal: 'BUY', reasons: bullishReasons };
        }
        
        // Bearish Reversal Check
        const isPriceOverbought = lastKline.high > bb.upper && lastKline.close < bb.upper;
        const isStochOverbought = stochRsi.stochRSI > params.qsc_stochRsiOverbought;
        const bearishCandleConfirmation = lastKline.close < lastKline.open;

        let bearishReasons: string[] = [...reasons];
        let bearishScore = 0;
        bearishReasons.push(isPriceOverbought ? `✅ Price: Rejected Upper BB` : `❌ Price: No Upper BB Rejection`);
        if (isPriceOverbought) bearishScore++;
        bearishReasons.push(isStochOverbought ? `✅ StochRSI: Overbought` : `❌ StochRSI: Not Overbought`);
        if (isStochOverbought) bearishScore++;
        bearishReasons.push(isObvBearish ? `✅ OBV < SMA: Bearish Volume` : `❌ OBV: Lacks Bearish Volume`);
        if (isObvBearish) bearishScore++;
        bearishReasons.push(bearishCandleConfirmation ? `✅ Price Action: Bearish Reversal Candle` : `❌ Price Action: No reversal confirmation`);
        if (bearishCandleConfirmation) bearishScore++;

        if (bearishScore >= params.qsc_rangeScoreThreshold) {
            if (config.isHtfConfirmationEnabled && !htfIsConfluentBearish) {
                return { signal: 'HOLD', reasons: bearishReasons };
            }
            if (!isObvBearish) {
                return { signal: 'HOLD', reasons: bearishReasons };
            }
            return { signal: 'SELL', reasons: bearishReasons };
        }
    }

    return { signal: 'HOLD', reasons };
};

// --- Agent 11: Historic Expert (REFACTORED to Pullback Strategy) ---
const getHistoricExpertSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = Math.max(params.he_trendSmaPeriod, params.he_fastEmaPeriod, params.he_rsiPeriod, params.adxPeriod, params.obvPeriod);
    if (klines.length < minKlines + 1) {
        return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    const lastKline = klines[klines.length - 1];
    const prevKline = klines[klines.length - 2];
    const reasons: string[] = [];

    const trendSma = getLast(SMA.calculate({ period: params.he_trendSmaPeriod, values: closes }))!;
    const isBullishTrend = currentPrice > trendSma;
    const isBearishTrend = currentPrice < trendSma;
    reasons.push(isBullishTrend ? `✅ Trend: Bullish (Price > ${params.he_trendSmaPeriod}-SMA)` : `✅ Trend: Bearish (Price < ${params.he_trendSmaPeriod}-SMA)`);

    const pullbackEma = getLast(EMA.calculate({ period: params.he_fastEmaPeriod, values: closes }))!;
    const bullishPullback = isBullishTrend && lastKline.low <= pullbackEma && lastKline.close > pullbackEma;
    const bearishPullback = isBearishTrend && lastKline.high >= pullbackEma && lastKline.close < pullbackEma;
    reasons.push(bullishPullback ? '✅ Entry: Bullish pullback to EMA' : bearishPullback ? '✅ Entry: Bearish pullback to EMA' : '❌ Entry: No pullback to EMA');

    const rsi = getLast(RSI.calculate({ period: params.he_rsiPeriod, values: closes }))!;
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
        if (isObvBearish && isObvBearish) return { signal: 'SELL', reasons };
    }
    
    return { signal: 'HOLD', reasons };
};

// --- Agent 13: The Chameleon (V6 - KST Momentum Flip Strategy with Zero-Line Confirmation) ---
const getChameleonSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = Math.max(
        params.ch_trendEmaPeriod!,
        params.ch_kst_rocPer4! + params.ch_kst_smaRocPer4!,
        params.adxPeriod
    ) + 5;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data for analysis.'] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];

    // 1. Trend Filter
    const trendEma = getLast(EMA.calculate({ period: params.ch_trendEmaPeriod!, values: closes }))!;
    const isMacroBullish = currentPrice > trendEma;
    const isMacroBearish = currentPrice < trendEma;
    
    // 2. Regime Filter
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.adxPeriod }))! as ADXOutput;
    const isTrending = adx.adx > params.ch_adxThreshold!;

    // 3. Primary Signal: KST with Zero-Line Confirmation
    const kstInput = {
        values: closes,
        ROCPer1: params.ch_kst_rocPer1!, ROCPer2: params.ch_kst_rocPer2!, ROCPer3: params.ch_kst_rocPer3!, ROCPer4: params.ch_kst_rocPer4!,
        SMAROCPer1: params.ch_kst_smaRocPer1!, SMAROCPer2: params.ch_kst_smaRocPer2!, SMAROCPer3: params.ch_kst_smaRocPer3!, SMAROCPer4: params.ch_kst_smaRocPer4!,
        signalPeriod: params.ch_kst_signalPeriod!,
    };
    const kstValues = KST.calculate(kstInput) as KSTOutput[];
    const lastKst = getLast(kstValues)!;
    const prevKst = getPenultimate(kstValues)!;
    const kstBullishCross = prevKst.kst < prevKst.signal && lastKst.kst > lastKst.signal;
    const kstBearishCross = prevKst.kst > prevKst.signal && lastKst.kst < lastKst.signal;
    const isKstBullishBias = lastKst.kst > 0;
    const isKstBearishBias = lastKst.kst < 0;

    // 4. Entry Trigger: Fast EMA Cross (Removed as KST cross is sufficient)
    
    // 5. Volume Confirmation
    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');

    // --- Bullish Logic ---
    reasons.push(isMacroBullish ? `✅ Trend: Bullish (Price > ${params.ch_trendEmaPeriod}-EMA)` : `❌ Trend: Not Bullish`);
    reasons.push(isTrending ? `✅ Regime: Trending (ADX ${adx.adx.toFixed(1)})` : `❌ Regime: Not Trending`);
    reasons.push(kstBullishCross ? `✅ KST: Bullish Cross` : `❌ KST: No Bullish Cross`);
    reasons.push(isKstBullishBias ? `✅ KST > 0 (Bullish Bias)` : `❌ KST: Not in Bullish Territory`);
    reasons.push(isObvBullish ? `✅ Volume: Bullish Flow` : `❌ Volume: Not Bullish`);

    if (isMacroBullish && isTrending && kstBullishCross && isKstBullishBias && isObvBullish) {
        return { signal: 'BUY', reasons };
    }

    // --- Bearish Logic ---
    reasons.push(isMacroBearish ? `✅ Trend: Bearish (Price < ${params.ch_trendEmaPeriod}-EMA)` : `❌ Trend: Not Bearish`);
    reasons.push(kstBearishCross ? `✅ KST: Bearish Cross` : `❌ KST: No Bearish Cross`);
    reasons.push(isKstBearishBias ? `✅ KST < 0 (Bearish Bias)` : `❌ KST: Not in Bearish Territory`);
    reasons.push(isObvBearish ? `✅ Volume: Bearish Flow` : `❌ Volume: Not Bearish`);
    
    if (isMacroBearish && isTrending && kstBearishCross && isKstBearishBias && isObvBearish) {
        return { signal: 'SELL', reasons };
    }

    reasons.push(`ℹ️ No valid KST signal detected.`);
    return { signal: 'HOLD', reasons };
};


// --- Agent 14: The Sentinel (Upgraded with OBV and re-weighted confirmation) ---
const getTheSentinelSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = 200;
    if (klines.length < minKlines) {
        const reasons = [`ℹ️ Insufficient data for The Sentinel (${klines.length}/${minKlines} candles).`];
        return { signal: 'HOLD', reasons };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    
    const ema50 = getLast(EMA.calculate({ period: 50, values: closes }))!;
    const ema200 = getLast(EMA.calculate({ period: 200, values: closes }))!;
    const macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }))!;
    const prevMacd = getPenultimate(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }))!;
    const rsi = getLast(RSI.calculate({ values: closes, period: 14 }))!;
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: 14 }))!;
    const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod }) as VortexIndicatorOutput;
    const last_vi_plus = getLast(vi.pdi)!;
    const last_vi_minus = getLast(vi.ndi)!;
    const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes }))!;
    const lastVolume = getLast(volumes)!;
    const obv = OBV.calculate({ close: closes, volume: volumes });

    let bullTrend = 0, bearTrend = 0;
    let bullMomentum = 0, bearMomentum = 0;
    let bullConfirm = 0, bearConfirm = 0;
    const trendMax = 35, momentumMax = 40, confirmMax = 25;

    if (last_vi_plus > last_vi_minus) bullTrend += 5; else bearTrend += 5;
    if (currentPrice > ema200) bullTrend += 25; else bearTrend += 25;
    if (ema50 > ema200) bullTrend += 5; else bearTrend += 5;
    if (adx.adx > 25) { if(adx.pdi > adx.mdi) bullTrend += 5; else bearTrend += 5; }

    if (macd.histogram! > 0 && macd.histogram! > (prevMacd.histogram || 0)) bullMomentum += 15;
    else if (macd.histogram! < 0 && macd.histogram! < (prevMacd.histogram || 0)) bearMomentum += 15;
    if (rsi > 55) bullMomentum += 15;
    else if (rsi < 45) bearMomentum += 15;
    if (isObvTrending(obv, 'bullish')) bullMomentum += 10;
    else if (isObvTrending(obv, 'bearish')) bearMomentum += 10;

    if (lastVolume > volumeSma) {
        if (bullTrend > bearTrend) bullConfirm += 25;
        if (bearTrend > bullTrend) bearConfirm += 25;
    }
    
    const finalBullishScore = bullTrend + bullMomentum + bullConfirm;
    const finalBearishScore = bearTrend + bearMomentum + bullConfirm;

    const sentinelAnalysis: SentinelAnalysis = {
        bullish: {
            total: finalBullishScore,
            trend: (bullTrend / trendMax) * 100,
            momentum: (bullMomentum / momentumMax) * 100,
            confirmation: (bullConfirm / confirmMax) * 100
        },
        bearish: {
            total: finalBearishScore,
            trend: (bearTrend / trendMax) * 100,
            momentum: (bearMomentum / momentumMax) * 100,
            confirmation: (bearConfirm / confirmMax) * 100
        }
    };

    const reasons: string[] = [];
    const threshold = params.sentinel_scoreThreshold!;

    if (finalBullishScore >= threshold && finalBullishScore > finalBearishScore) {
        reasons.push(`✅ Bullish score exceeds threshold of ${threshold}%.`);
        return { signal: 'BUY', reasons, sentinelAnalysis };
    }
    
    if (finalBearishScore >= threshold && finalBearishScore > finalBearishScore) {
        reasons.push(`✅ Bearish score exceeds threshold of ${threshold}%.`);
        return { signal: 'SELL', reasons, sentinelAnalysis };
    }

    reasons.push(`❌ Neither score has met the ${threshold}% threshold.`);
    return { signal: 'HOLD', reasons, sentinelAnalysis };
};

// --- Agent 15: Institutional Flow Tracer (Upgraded with OBV Confirmation) ---
const getInstitutionalFlowTracerSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = Math.max(params.vwap_emaTrendPeriod, params.rsiPeriod, params.obvPeriod);
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data (${klines.length}/${minKlines}).`] };

    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    const lastKline = klines[klines.length - 1];
    const prevKline = klines[klines.length - 2];
    const reasons: string[] = [];

    const vwap = getLast(VWAP.calculate({ high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes, volume: volumes }));
    if (!vwap) return { signal: 'HOLD', reasons: ['ℹ️ Could not calculate VWAP.'] };

    const emaTrend = getLast(EMA.calculate({ period: params.vwap_emaTrendPeriod, values: closes }))!;
    const isUptrend = currentPrice > emaTrend;
    reasons.push(isUptrend ? '✅ Trend: Bullish (Price > EMA)' : '✅ Trend: Bearish (Price < EMA)');

    const isNearVwap = Math.abs(currentPrice - vwap) / vwap < (params.vwap_proximityPercent / 100);
    const pattern = recognizeCandlestickPattern(lastKline, prevKline);
    const rsi = getLast(RSI.calculate({ period: params.rsiPeriod, values: closes }))!;
    const isMomentumBullish = rsi > 50;
    const isMomentumBearish = rsi < 50;

    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');

    if (isUptrend) {
        reasons.push(isNearVwap ? '✅ Price near VWAP' : '❌ Price not near VWAP');
        reasons.push(pattern?.type === 'bullish' ? `✅ Confirmed by ${pattern.name}` : '❌ Awaiting bullish candle at VWAP');
        reasons.push(isMomentumBullish ? `✅ RSI Momentum: Bullish (>50)` : `❌ RSI Momentum: Not Bullish`);
        reasons.push(isObvBullish ? `✅ OBV Flow: Bullish` : `❌ OBV Flow: Not Bullish`);
        if (isNearVwap && pattern?.type === 'bullish' && isMomentumBullish && isObvBullish) {
            return { signal: 'BUY', reasons };
        }
    }

    if (!isUptrend) {
        reasons.push(isNearVwap ? '✅ Price near VWAP' : '❌ Price not near VWAP');
        reasons.push(pattern?.type === 'bearish' ? `✅ Confirmed by ${pattern.name}` : '❌ Awaiting bearish candle at VWAP');
        reasons.push(isMomentumBearish ? `✅ RSI Momentum: Bearish (<50)` : `❌ RSI Momentum: Not Bearish`);
        reasons.push(isObvBearish ? `✅ OBV Flow: Bearish` : `❌ OBV Flow: Not Bearish`);
        if (isNearVwap && pattern?.type === 'bearish' && isMomentumBearish && isObvBearish) {
            return { signal: 'SELL', reasons };
        }
    }

    return { signal: 'HOLD', reasons };
};

// --- Agent 16: Ichimoku Trend Rider (Upgraded with OBV) ---
const getIchimokuTrendRiderSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = params.ichi_basePeriod + params.ichi_displacement;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for Ichimoku agent (${klines.length}/${minKlines}).`] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    const prevPrice = getPenultimate(closes)!;
    const reasons: string[] = [];

    const ichi_params = {
        high: highs, low: lows,
        conversionPeriod: params.ichi_conversionPeriod, basePeriod: params.ichi_basePeriod,
        spanPeriod: params.ichi_laggingSpanPeriod, displacement: params.ichi_displacement
    };
    const ichiValues = IchimokuCloud.calculate(ichi_params) as IchimokuCloudOutput[];
    const lastIchi = getLast(ichiValues);
    const prevIchi = getPenultimate(ichiValues);
    if (!lastIchi || !prevIchi || !lastIchi.spanA || !lastIchi.spanB || !prevIchi.spanA || !prevIchi.spanB) {
        return { signal: 'HOLD', reasons: ['ℹ️ Ichimoku Cloud not yet formed.'] };
    }

    const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod }) as VortexIndicatorOutput;
    const last_vi_plus = getLast(vi.pdi)!;
    const last_vi_minus = getLast(vi.ndi)!;
    const isViBullish = last_vi_plus > last_vi_minus;
    const isViBearish = last_vi_minus > last_vi_plus;

    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');

    const isBullishKumo = lastIchi.spanA > lastIchi.spanB;
    const prevCloudTop = Math.max(prevIchi.spanA, prevIchi.spanB);
    const lastCloudTop = Math.max(lastIchi.spanA, lastIchi.spanB);
    const bullishBreakout = prevPrice < prevCloudTop && currentPrice > lastCloudTop;
    reasons.push(bullishBreakout ? `✅ Kumo Breakout: Bullish` : `❌ No Bullish Kumo Breakout`);

    const chikouPriceTargetIndex = klines.length - 1 - params.ichi_displacement;
    if (chikouPriceTargetIndex >= 0) {
        const chikouIsBullish = currentPrice > closes[chikouPriceTargetIndex];
        reasons.push(chikouIsBullish ? `✅ Lagging Span: Bullish` : `❌ Lagging Span: Not Bullish`);
        reasons.push(isViBullish ? `✅ VI Confirmation: Bullish` : `❌ VI Confirmation: Not Bullish`);
        reasons.push(isObvBullish ? `✅ OBV Confirmation: Bullish` : `❌ OBV Confirmation: Not Bullish`);

        if (bullishBreakout && chikouIsBullish && isBullishKumo && isViBullish && isObvBullish) {
            reasons.push('✅ Future Kumo: Bullish');
            return { signal: 'BUY', reasons };
        }
    }
    
    const prevCloudBottom = Math.min(prevIchi.spanA, prevIchi.spanB);
    const lastCloudBottom = Math.min(lastIchi.spanA, lastIchi.spanB);
    const bearishBreakout = prevPrice > prevCloudBottom && currentPrice < lastCloudBottom;
    reasons.push(bearishBreakout ? `✅ Kumo Breakout: Bearish` : `❌ No Bearish Kumo Breakout`);
     if (chikouPriceTargetIndex >= 0) {
        const chikouIsBearish = currentPrice < closes[chikouPriceTargetIndex];
        reasons.push(chikouIsBearish ? `✅ Lagging Span: Bearish` : `❌ Lagging Span: Not Bearish`);
        reasons.push(isViBearish ? `✅ VI Confirmation: Bearish` : `❌ VI Confirmation: Not Bearish`);
        reasons.push(isObvBearish ? `✅ OBV Confirmation: Bearish` : `❌ OBV Confirmation: Not Bearish`);

        if (bearishBreakout && chikouIsBearish && !isBullishKumo && isViBearish && isObvBearish) {
            reasons.push('✅ Future Kumo: Bearish');
            return { signal: 'SELL', reasons };
        }
    }
    
    return { signal: 'HOLD', reasons };
};

// --- Agent 17: The Detonator (Upgraded with OBV Accumulation) ---
const getTheDetonatorSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = Math.max(
        params.det_bb1_len, params.det_bb2_len, params.det_bb3_len, 
        params.det_ema_slow_len, params.det_rsi_len, params.det_vol_len, params.det_atr_len, params.obvPeriod, 35
    );
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data.'] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const lastKline = klines[klines.length - 1];
    const currentPrice = lastKline.close;
    const reasons: string[] = [];

    const bb1 = getLast(BollingerBands.calculate({ period: params.det_bb1_len, stdDev: params.det_bb1_dev, values: closes }))!;
    const bb2 = getLast(BollingerBands.calculate({ period: params.det_bb2_len, stdDev: params.det_bb2_dev, values: closes }))!;
    const bb3 = getLast(BollingerBands.calculate({ period: params.det_bb3_len, stdDev: params.det_bb3_dev, values: closes }))!;
    const emaFast = getLast(EMA.calculate({ period: params.det_ema_fast_len, values: closes }))!;
    const emaSlow = getLast(EMA.calculate({ period: params.det_ema_slow_len, values: closes }))!;
    const rsi = getLast(RSI.calculate({ period: params.det_rsi_len, values: closes }))!;
    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');

    const bb_bull_count = (currentPrice > bb1.upper ? 1 : 0) + (currentPrice > bb2.upper ? 1 : 0) + (currentPrice > bb3.upper ? 1 : 0);
    const bb_bear_count = (currentPrice < bb1.lower ? 1 : 0) + (currentPrice < bb2.lower ? 1 : 0) + (currentPrice < bb3.lower ? 1 : 0);
    reasons.push(`ℹ️ BB Breakout Count: ${bb_bull_count} (Bull), ${bb_bear_count} (Bear)`);

    const trend_ok_long = emaFast > emaSlow && currentPrice > emaFast;
    const trend_ok_short = emaFast < emaSlow && currentPrice < emaFast;
    reasons.push(trend_ok_long ? `✅ Trend: Bullish` : trend_ok_short ? `✅ Trend: Bearish` : `❌ Trend: Sideways`);

    const rsi_ok_long = rsi >= params.det_rsi_thresh;
    const rsi_ok_short = rsi <= (100 - params.det_rsi_thresh);
    reasons.push(rsi_ok_long ? `✅ RSI > ${params.det_rsi_thresh}` : `❌ RSI not bullish`);
    reasons.push(rsi_ok_short ? `✅ RSI < ${100 - params.det_rsi_thresh}` : `❌ RSI not bearish`);
    
    const fake_break_long = bb_bull_count >= 2;
    const fake_break_short = bb_bear_count >= 2;

    if (fake_break_long && trend_ok_long && rsi_ok_long) {
        reasons.push(isObvBullish ? `✅ OBV Momentum: Confirmed Bullish Pressure` : `❌ OBV Momentum: Lacks Bullish Pressure`);
        if (isObvBullish) return { signal: 'BUY', reasons };
    }
    
    if (fake_break_short && trend_ok_short && rsi_ok_short) {
        reasons.push(isObvBearish ? `✅ OBV Momentum: Confirmed Bearish Pressure` : `❌ OBV Momentum: Lacks Bearish Pressure`);
        if (isObvBearish) return { signal: 'SELL', reasons };
    }

    return { signal: 'HOLD', reasons };
};

// --- Agent 18: Candlestick Prophet ---
const getCandlestickProphetSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = Math.max(params.csp_emaMomentumPeriod, params.obvPeriod, 20);
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data.'] };

    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];

    const emaMomentum = getLast(EMA.calculate({ period: params.csp_emaMomentumPeriod, values: closes }))!;
    const obv = OBV.calculate({ close: closes, volume: volumes });

    // Check for Bullish Patterns
    const { patternInfo: bullishPattern } = findLastCandlestickPattern(klines, 'LONG');
    if (bullishPattern) {
        reasons.push(`ℹ️ Bullish Pattern: ${bullishPattern.name} detected.`);
        const isMomentumConfirmed = currentPrice > emaMomentum;
        const isVolumeConfirmed = isObvTrending(obv, 'bullish');
        reasons.push(isMomentumConfirmed ? `✅ Momentum: Bullish (Price > EMA)` : `❌ Momentum: Not Bullish`);
        reasons.push(isVolumeConfirmed ? `✅ OBV Flow: Bullish` : `❌ OBV Flow: Not Bullish`);
        if (isMomentumConfirmed && isVolumeConfirmed) {
            return { signal: 'BUY', reasons };
        }
    }

    // Check for Bearish Patterns
    const { patternInfo: bearishPattern } = findLastCandlestickPattern(klines, 'SHORT');
    if (bearishPattern) {
        reasons.push(`ℹ️ Bearish Pattern: ${bearishPattern.name} detected.`);
        const isMomentumConfirmed = currentPrice < emaMomentum;
        const isVolumeConfirmed = isObvTrending(obv, 'bearish');
        reasons.push(isMomentumConfirmed ? `✅ Momentum: Bearish (Price < EMA)` : `❌ Momentum: Not Bearish`);
        reasons.push(isVolumeConfirmed ? `✅ OBV Flow: Bearish` : `❌ OBV Flow: Not Bearish`);
        if (isMomentumConfirmed && isVolumeConfirmed) {
            return { signal: 'SELL', reasons };
        }
    }

    return { signal: 'HOLD', reasons: ['ℹ️ No valid, confirmed candlestick pattern found.'] };
};

export const validateTradeProfitability = (
    entryPrice: number,
    stopLossPrice: number,
    takeProfitPrice: number,
    direction: 'LONG' | 'SHORT',
    config: BotConfig
): { isValid: boolean, reason: string } => {
    const isLong = direction === 'LONG';

    // Check 1: Stop Loss and Take Profit are on the correct side of the entry price
    if ((isLong && (stopLossPrice >= entryPrice || takeProfitPrice <= entryPrice)) ||
        (!isLong && (stopLossPrice <= entryPrice || takeProfitPrice >= entryPrice))) {
        return { isValid: false, reason: "❌ VETO: SL/TP targets are on the wrong side of the entry price." };
    }

    // Check 2: The trade must be profitable enough to cover fees.
    const positionValue = config.investmentAmount * (config.mode === TradingMode.USDSM_Futures ? config.leverage : 1);
    const tradeSize = positionValue / entryPrice;
    if (tradeSize > 0) {
        const roundTripFee = positionValue * config.takerFeeRate * 2;
        const feeInPrice = roundTripFee / tradeSize;
        const minProfitDistance = feeInPrice * MIN_PROFIT_BUFFER_MULTIPLIER;
        const rewardDistance = Math.abs(takeProfitPrice - entryPrice);
        if (rewardDistance < minProfitDistance) {
            return { isValid: false, reason: `❌ VETO: Take Profit ($${takeProfitPrice.toFixed(config.pricePrecision)}) is within the minimum profit zone required to cover fees.` };
        }
    }

    // Check 3: Enforce Minimum Risk/Reward if enabled.
    if (config.isMinRrEnabled) {
        const risk = Math.abs(entryPrice - stopLossPrice);
        const reward = Math.abs(takeProfitPrice - entryPrice);
        const rrRatio = risk > 0 ? reward / risk : Infinity;

        if (rrRatio < constants.MIN_RISK_REWARD_RATIO) {
            return { isValid: false, reason: `❌ VETO: Final Risk/Reward ratio (${rrRatio.toFixed(2)}) is below the system minimum of ${constants.MIN_RISK_REWARD_RATIO}.` };
        }
        return { isValid: true, reason: `✅ R:R Check Passed: ${rrRatio.toFixed(2)}:1` };
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

    const currentSignal = await getTradingSignal(agent, klines, config, htfKlines);
    
    const isLong = position.direction === 'LONG';
    const oppositeSignal = isLong ? 'SELL' : 'BUY';

    if (currentSignal.signal === oppositeSignal) {
        if (agent.id === 14 && currentSignal.sentinelAnalysis) {
             const oppositeScore = isLong ? currentSignal.sentinelAnalysis.bearish.total : currentSignal.sentinelAnalysis.bullish.total;
             if (oppositeScore >= (config.agentParams?.sentinel_scoreThreshold || 70)) {
                 return { action: 'close', reason: 'Supervisor Exit: Strong counter-signal detected.' };
             }
        } else if (agent.id !== 14) {
             return { action: 'close', reason: 'Supervisor Exit: Trade thesis invalidated (signal flipped).' };
        }
    }
    
    const lastKline = klines[klines.length - 1];
    const prevKline = klines[klines.length - 2];
    if (lastKline && prevKline) {
        const isBearishEngulfing = bearishengulfingpattern({open: [prevKline.open, lastKline.open], high: [prevKline.high, lastKline.high], low: [prevKline.low, lastKline.low], close: [prevKline.close, lastKline.close]})[1];
        if (isLong && isBearishEngulfing) {
            return { action: 'close', reason: 'Supervisor Exit: Bearish engulfing pattern formed.' };
        }
        const isBullishEngulfing = bullishengulfingpattern({open: [prevKline.open, lastKline.open], high: [prevKline.high, lastKline.high], low: [prevKline.low, lastKline.low], close: [prevKline.close, lastKline.close]})[1];
        if (!isLong && isBullishEngulfing) {
            return { action: 'close', reason: 'Supervisor Exit: Bullish engulfing pattern formed.' };
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

    // This logic only applies to HTF-confirmed trades where TP isn't locked by the user.
    if (!config.isHtfConfirmationEnabled || config.isTakeProfitLocked) {
        return {};
    }

    const isLong = direction === 'LONG';
    // Prioritize HTF market structure for ambitious targets
    const analysisKlines = htfKlines && htfKlines.length > 50 ? htfKlines : klines;

    // Use a wider lookback for more significant levels
    const { supports, resistances } = calculateSupportResistance(analysisKlines, 20);

    let newTakeProfit: number | undefined;

    if (isLong) {
        // Find the next resistance level *beyond* the current one.
        const potentialTps = resistances.filter(r => r > takeProfitPrice);
        if (potentialTps.length > 0) {
            // Target the closest one.
            newTakeProfit = Math.min(...potentialTps);
        }
    } else { // SHORT
        // Find the next support level *beyond* the current one.
        const potentialTps = supports.filter(s => s < takeProfitPrice);
        if (potentialTps.length > 0) {
            // Target the closest one.
            newTakeProfit = Math.max(...potentialTps);
        }
    }

    if (newTakeProfit) {
        const risk = position.initialRiskInPrice;
        const newReward = Math.abs(newTakeProfit - entryPrice);
        const newRr = risk > 0 ? newReward / risk : Infinity;
        const currentReward = Math.abs(takeProfitPrice - entryPrice);
        const currentRr = risk > 0 ? currentReward/risk : Infinity;

        // Only move the TP if the new target offers a significantly better R:R.
        if (newRr > currentRr + 0.5) { // e.g., move from 2R to at least 2.5R
            // Apply a small buffer to avoid front-running the level
            const bufferedTp = isLong ? newTakeProfit * 0.999 : newTakeProfit * 1.001;
            return {
                newTakeProfit: bufferedTp,
                reason: `Adaptive TP: HTF trend strong, aiming for next S/R level.`,
            };
        }
    }
    
    return {};
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
        case 7:  signal = getMarketStructureMavenSignal(klines, config, htfContext); break;
        case 9:  signal = getQuantumScalperSignal(klines, config, htfContext); break;
        case 11: signal = getHistoricExpertSignal(klines, config, htfContext); break;
        case 13: signal = getChameleonSignal(klines, config, htfContext); break;
        case 14: signal = getTheSentinelSignal(klines, config, htfContext); break;
        case 15: signal = getInstitutionalFlowTracerSignal(klines, config, htfContext); break;
        case 16: signal = getIchimokuTrendRiderSignal(klines, config, htfContext); break;
        case 17: signal = getTheDetonatorSignal(klines, config, htfContext); break;
        case 18: signal = getCandlestickProphetSignal(klines, config, htfContext); break;
        default: signal = { signal: 'HOLD', reasons: ['Agent not found'] }; break;
    }

    if (signal.signal === 'HOLD') {
        return signal;
    }
    
    const lastKline = getLast(klines)!;
    const entryPrice = lastKline.close;
    const isLong = signal.signal === 'BUY';

    if (config.isMinRrEnabled) {
        const { stopLossPrice, takeProfitPrice } = getInitialAgentTargets(klines, entryPrice, isLong ? 'LONG' : 'SHORT', config);
        const risk = Math.abs(entryPrice - stopLossPrice);
        const reward = Math.abs(takeProfitPrice - entryPrice);
        const rrRatio = risk > 0 ? reward / risk : 0;
        if (rrRatio < constants.MIN_RISK_REWARD_RATIO) {
            signal.reasons.push(`❌ VETO: Risk/Reward ratio (${rrRatio.toFixed(2)}) is below minimum of ${constants.MIN_RISK_REWARD_RATIO}.`);
            return { ...signal, signal: 'HOLD' };
        }
        signal.reasons.push(`✅ R:R Veto: Passed (${rrRatio.toFixed(2)}:1).`);
    }

    const contradictoryCandleVeto = isLastCandleContradictory(klines, signal.signal);
    if (contradictoryCandleVeto.veto) {
        signal.reasons.push(contradictoryCandleVeto.reason);
        return { ...signal, signal: 'HOLD' };
    }

    return signal;
};

export function captureMarketContext(klines: Kline[], htfKlines?: Kline[]): MarketDataContext {
    if (klines.length < 50 && (!htfKlines || htfKlines.length < 50)) {
        return {};
    }

    const context: MarketDataContext = {};

    try {
        if (klines.length >= 50) {
            const closes = klines.map(k => k.close);
            const highs = klines.map(k => k.high);
            const lows = klines.map(k => k.low);
            const volumes = klines.map(k => k.volume || 0);
            
            context.rsi14 = getLast(RSI.calculate({ period: 14, values: closes }));
            context.stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 }));
            context.ema9 = getLast(EMA.calculate({ period: 9, values: closes }));
            context.ema21 = getLast(EMA.calculate({ period: 21, values: closes }));
            context.ema50 = getLast(EMA.calculate({ period: 50, values: closes }));
            context.ema200 = getLast(EMA.calculate({ period: 200, values: closes }));
            context.sma50 = getLast(SMA.calculate({ period: 50, values: closes }));
            context.sma200 = getLast(SMA.calculate({ period: 200, values: closes }));
            context.macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }));
            context.adx14 = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: 14 }));
            context.atr14 = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }));
            context.bb20_2 = getLast(BollingerBands.calculate({ period: 20, stdDev: 2, values: closes }));
            context.volumeSma20 = getLast(SMA.calculate({ period: 20, values: volumes }));
            const obv = OBV.calculate({ close: closes, volume: volumes });
            context.obvTrend = isObvTrending(obv, 'bullish') ? 'bullish' : isObvTrending(obv, 'bearish') ? 'bearish' : 'neutral';
            const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: 14 });
            if(getLast(vi.pdi) !== undefined) context.vi14 = { pdi: getLast(vi.pdi)!, ndi: getLast(vi.ndi)! };
            context.ichiCloud = getLast(IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 }));
            context.lastCandlePattern = recognizeCandlestickPattern(klines[klines.length - 1], klines[klines.length - 2]);
        }

        // Higher Timeframe Context
        if (htfKlines && htfKlines.length > 50) {
            const htfCloses = htfKlines.map(k => k.close);
            const htfHighs = htfKlines.map(k => k.high);
            const htfLows = htfKlines.map(k => k.low);
            const htfVolumes = htfKlines.map(k => k.volume || 0);

            context.htf_stochRsi = getLast(StochasticRSI.calculate({ values: htfCloses, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 }));
            context.htf_rsi14 = getLast(RSI.calculate({ period: 14, values: htfCloses }));
            context.htf_ema9 = getLast(EMA.calculate({ period: 9, values: htfCloses }));
            context.htf_ema21 = getLast(EMA.calculate({ period: 21, values: htfCloses }));
            context.htf_ema50 = getLast(EMA.calculate({ period: 50, values: htfCloses }));
            context.htf_ema200 = getLast(EMA.calculate({ period: 200, values: htfCloses }));
            context.htf_macd = getLast(MACD.calculate({ values: htfCloses, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }));
            context.htf_adx14 = getLast(ADX.calculate({ high: htfHighs, low: htfLows, close: htfCloses, period: 14 }));
            const htfObv = OBV.calculate({ close: htfCloses, volume: htfVolumes });
            context.htf_obvTrend = isObvTrending(htfObv, 'bullish') ? 'bullish' : isObvTrending(htfObv, 'bearish') ? 'bearish' : 'neutral';
            const htfVi = VortexIndicator.calculate({ high: htfHighs, low: htfLows, close: htfCloses, period: 14 });
            if(getLast(htfVi.pdi) !== undefined) context.htf_vi14 = { pdi: getLast(htfVi.pdi)!, ndi: getLast(htfVi.ndi)! };
            const htfEma50 = getLast(EMA.calculate({ period: 50, values: htfCloses }));
            if (htfEma50) {
                 context.htf_trend = getLast(htfCloses)! > htfEma50 ? 'bullish' : 'bearish';
            }
        }
    } catch (e) {
        console.error("Error capturing market context:", e);
    }
    
    return context;
}
