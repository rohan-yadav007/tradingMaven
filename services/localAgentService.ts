import { TradingMode, type Agent, type TradeSignal, type Kline, type AgentParams, type Position, type ADXOutput, type MACDOutput, type BollingerBandsOutput, type StochasticRSIOutput, type TradeManagementSignal, type BotConfig, VortexIndicatorOutput, SentinelAnalysis, KSTOutput, type IchimokuCloudOutput, MarketDataContext } from '../types';
// FIX: Import missing candlestick pattern indicators 'eveningdojistar' and 'eveningstar' to resolve reference errors.
import { EMA, RSI, MACD, BollingerBands, ATR, SMA, ADX, StochasticRSI, PSAR, OBV, IchimokuCloud, KST, abandonedbaby, bearishengulfingpattern, bullishengulfingpattern, darkcloudcover, downsidetasukigap, dragonflydoji, gravestonedoji, bullishharami, bearishharami, bullishharamicross, bearishharamicross, hammerpattern, hangingman, morningdojistar, morningstar, piercingline, shootingstar, threeblackcrows, threewhitesoldiers, eveningdojistar, eveningstar } from 'technicalindicators';
import * as constants from '../constants';

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
        case 9:  timeframeSettings = constants.QUANTUM_SCALPER_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 11: timeframeSettings = constants.HISTORIC_EXPERT_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 13: timeframeSettings = constants.CHAMELEON_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 14: timeframeSettings = constants.SENTINEL_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        // FIX: Add case for Ichimoku Trend Rider agent to apply timeframe-specific settings.
        case 16: timeframeSettings = constants.ICHIMOKU_TREND_RIDER_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
    }
    
    finalParams = { ...finalParams, ...timeframeSettings };

    // Apply user-specific overrides last
    finalParams = { ...finalParams, ...agentParams };
    
    // Return a new config object with the finalized params
    return { ...config, agentParams: finalParams };
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

    const lowerTimeframes = ['1m', '3m', '5m'];
    const isLowerTimeframe = lowerTimeframes.includes(timeframe);

    if (isLowerTimeframe) {
        // Relaxed Rule: At least ONE of the last N candles is perfectly cohesive.
        const hasCohesiveCandle = relevantKlines.some(k => isKlinePerfectlyCohesive(k, direction));
        if (hasCohesiveCandle) {
            return { cohesive: true, reason: `✅ HA Cohesion: Passed (Relaxed TF Rule)` };
        } else {
            return { cohesive: false, reason: `❌ VETO: Market lacks cohesion on low timeframe.` };
        }
    } else {
        // Strict Rule: ALL of the last N candles must be perfectly cohesive.
        const allCandlesCohesive = relevantKlines.every(k => isKlinePerfectlyCohesive(k, direction));
        if (allCandlesCohesive) {
            return { cohesive: true, reason: `✅ HA Cohesion: Passed (Strict TF Rule)` };
        } else {
            return { cohesive: false, reason: `❌ VETO: Market lacks cohesion on high timeframe.` };
        }
    }
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
                // FIX: Cast result of technical indicator to its correct type.
                const bb = getLast(BollingerBands.calculate({ period: params.qsc_bbPeriod!, stdDev: params.qsc_bbStdDev!, values: closes })) as BollingerBandsOutput;
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
 * NEW: An aggressive profit-locking system that activates after the price has moved 50%
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
                newState: { aggressiveTrailTier: 1, activeStopLossReason: 'Profit Secure' }
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
        case 9: // Quantum Scalper: PSAR-based trailing stop
            let step = params.qsc_psarStep;
            let max = params.qsc_psarMax;
            
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
    
    // FIX: Ensure the agent trail respects the breakeven point as a minimum floor.
    if (position.isBreakevenSet && newStopLoss !== undefined) {
        // Recalculate the breakeven price to ensure accuracy.
        const feeRate = position.takerFeeRate;
        const breakevenPrice = isLong
            ? position.entryPrice * (1 + feeRate) / (1 - feeRate)
            : position.entryPrice * (1 - feeRate) / (1 + feeRate);

        // The agent's trail cannot suggest a stop that is worse than the established breakeven point.
        if (isLong) {
            newStopLoss = Math.max(newStopLoss, breakevenPrice);
        } else {
            newStopLoss = Math.min(newStopLoss, breakevenPrice);
        }
        reasons.push('Agent Trail active post-breakeven.');
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

// --- Agent 9: Quantum Scalper (V4 - AI Enhanced) ---
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
    let reasons: string[] = [];

    // --- 1. Volatility & Volume Filters ---
    const bbForWidth = BollingerBands.calculate({ period: params.qsc_bbPeriod, stdDev: params.qsc_bbStdDev, values: closes });
    const lastBbForWidth = getLast(bbForWidth) as BollingerBandsOutput;
    const bbWidth = (lastBbForWidth.upper - lastBbForWidth.lower) / lastBbForWidth.middle;
    if (bbWidth < params.qsc_bbwSqueezeThreshold) {
        return { signal: 'HOLD', reasons: [`ℹ️ Standby: Low volatility squeeze detected (BBW: ${bbWidth.toFixed(4)})`] };
    }
    const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes }))! as number;
    const lastVolume = getLast(volumes)!;
    if (lastVolume > volumeSma * params.qsc_volumeExhaustionMultiplier!) {
        return { signal: 'HOLD', reasons: [`❌ VETO: Potential volume exhaustion detected (Volume > ${params.qsc_volumeExhaustionMultiplier}x Avg).`] };
    }
    
    // --- 2. Regime Filter & AI Gatekeepers ---
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.adxPeriod }))! as ADXOutput;
    const isTrending = adx.adx > params.qsc_adxThreshold;
    reasons.push(isTrending ? `✅ Strong Trend (ADX > ${params.qsc_adxThreshold})` : `❌ Weak Trend (ADX < ${params.qsc_adxThreshold})`);

    if (isTrending) {
        const macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false })) as MACDOutput;
        const rsi = getLast(RSI.calculate({ period: 14, values: closes })) as number;
        const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput;
        const isBullishSignal = adx.pdi > adx.mdi;
        const isBearishSignal = adx.mdi > adx.pdi;

        let direction: 'BUY' | 'SELL' | null = null;
        const aiGates = { htf: false, macd: false, rsi: false, stochRsi: false, bb: false, adxDi: false, candle: false };

        if (isBullishSignal) {
            aiGates.htf = !config.isHtfConfirmationEnabled || (htfContext?.htf_trend === 'bullish' && (htfContext?.htf_rsi14 ?? 0) > 50);
            aiGates.macd = macd.histogram! > 0.0001;
            aiGates.rsi = rsi > params.qsc_rsiBuyThreshold;
            aiGates.stochRsi = stochRsi.k > 60;
            aiGates.bb = lastBbForWidth.pb > 0.65;
            aiGates.adxDi = (adx.pdi / adx.mdi) > 1.3;
            aiGates.candle = !isLastCandleContradictory(klines, 'BUY').veto;
            if (Object.values(aiGates).every(v => v)) direction = 'BUY';
        } else if (isBearishSignal) {
            aiGates.htf = !config.isHtfConfirmationEnabled || (htfContext?.htf_trend === 'bearish' && (htfContext?.htf_rsi14 ?? 100) < 50);
            aiGates.macd = macd.histogram! < -0.0001;
            aiGates.rsi = rsi < params.qsc_rsiSellThreshold;
            aiGates.stochRsi = stochRsi.k < 40;
            aiGates.bb = lastBbForWidth.pb < 0.35;
            aiGates.adxDi = (adx.mdi / adx.pdi) > 1.3;
            aiGates.candle = !isLastCandleContradictory(klines, 'SELL').veto;
            if (Object.values(aiGates).every(v => v)) direction = 'SELL';
        }

        reasons.push(aiGates.htf ? `✅ HTF Confirmed` : `❌ HTF Misaligned`);
        reasons.push(aiGates.macd ? `✅ MACD Confirmed` : `❌ MACD Misaligned`);
        reasons.push(aiGates.rsi ? `✅ RSI Confirmed` : `❌ RSI Misaligned`);
        reasons.push(aiGates.stochRsi ? `✅ StochRSI Confirmed` : `❌ StochRSI Misaligned`);
        reasons.push(aiGates.bb ? `✅ BB%B Confirmed` : `❌ BB%B Misaligned`);
        reasons.push(aiGates.adxDi ? `✅ DI Spread Confirmed` : `❌ DI Spread Weak`);
        reasons.push(aiGates.candle ? `✅ Candle OK` : `❌ Contradictory Candle`);

        if (!direction) return { signal: 'HOLD', reasons };
        reasons.push('✅ AI Gates Passed');

        // --- 3. Original Quantum Scalper Scoring Logic (as final confirmation) ---
        const ichi_params = {
            high: highs, low: lows,
            conversionPeriod: params.qsc_ichi_conversionPeriod, basePeriod: params.qsc_ichi_basePeriod,
            spanPeriod: params.qsc_ichi_laggingSpanPeriod, displacement: params.qsc_ichi_displacement
        };
        const ichi = getLast(IchimokuCloud.calculate(ichi_params)) as IchimokuCloudOutput | undefined;
        const isPriceAboveKumo = ichi && ichi.spanA && ichi.spanB && currentPrice > ichi.spanA && currentPrice > ichi.spanB;
        const isPriceBelowKumo = ichi && ichi.spanA && ichi.spanB && currentPrice < ichi.spanA && currentPrice < ichi.spanB;
        
        let score = 0;
        const SCORE_WEIGHTS = { ICHIMOKU: 40, SUPERTREND: 30, VI: 30 };
        const stValues = Supertrend.calculate({ high: highs, low: lows, close: closes, period: params.qsc_superTrendPeriod, multiplier: params.qsc_superTrendMultiplier });
        const lastSt = getLast(stValues) as number | undefined;
        const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod });

        if (direction === 'BUY' && isPriceAboveKumo) {
            score += SCORE_WEIGHTS.ICHIMOKU;
            if (lastSt && currentPrice > lastSt) score += SCORE_WEIGHTS.SUPERTREND;
            if (getLast(vi.pdi)! > getLast(vi.ndi)!) score += SCORE_WEIGHTS.VI;
        } else if (direction === 'SELL' && isPriceBelowKumo) {
            score += SCORE_WEIGHTS.ICHIMOKU;
            if (lastSt && currentPrice < lastSt) score += SCORE_WEIGHTS.SUPERTREND;
            if (getLast(vi.ndi)! > getLast(vi.pdi)!) score += SCORE_WEIGHTS.VI;
        }
        
        reasons.push(`ℹ️ Final Score: ${score}%`);
        if (score >= params.qsc_trendScoreThreshold) {
            return { signal: direction, reasons };
        }

    } else { // --- Ranging Logic (Remains unchanged) ---
        const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: params.qsc_stochRsiPeriod, stochasticPeriod: params.qsc_stochRsiPeriod, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput;
        const bb = getLast(bbForWidth) as BollingerBandsOutput;
        const isPriceOversold = lastKline.low < bb.lower && lastKline.close > bb.lower;
        const isStochOversold = stochRsi.stochRSI < params.qsc_stochRsiOversold;
        if (isPriceOversold && isStochOversold) return { signal: 'BUY', reasons: [`✅ Price rejected lower BB`, `✅ StochRSI oversold`] };
        
        const isPriceOverbought = lastKline.high > bb.upper && lastKline.close < bb.upper;
        const isStochOverbought = stochRsi.stochRSI > params.qsc_stochRsiOverbought;
        if (isPriceOverbought && isStochOverbought) return { signal: 'SELL', reasons: [`✅ Price rejected upper BB`, `✅ StochRSI overbought`] };
    }

    return { signal: 'HOLD', reasons };
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
    const currentPrice = getLast(closes)!;
    const lastKline = klines[klines.length - 1];
    const reasons: string[] = [];

    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.adxPeriod }))! as ADXOutput;
    const isTrending = adx.adx > params.he_adxTrendThreshold;
    reasons.push(isTrending ? `✅ Trend Active (ADX > ${params.he_adxTrendThreshold})` : `❌ Chop Zone (ADX < ${params.he_adxTrendThreshold})`);
    if (!isTrending) return { signal: 'HOLD', reasons };

    const atr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: params.atrPeriod }))! as number;
    const candleRange = lastKline.high - lastKline.low;
    const isNotExhaustion = candleRange < atr * 3;
    reasons.push(isNotExhaustion ? `✅ Normal Volatility` : `❌ High Volatility (Exhaustion Risk)`);
    if (!isNotExhaustion) return { signal: 'HOLD', reasons };
    
    const trendSma = getLast(SMA.calculate({ period: params.he_trendSmaPeriod, values: closes }))! as number;
    const isBullishTrend = currentPrice > trendSma;
    reasons.push(isBullishTrend ? `✅ Trend: Bullish` : `✅ Trend: Bearish`);

    const pullbackEma = getLast(EMA.calculate({ period: params.he_fastEmaPeriod, values: closes }))! as number;
    const bullishPullback = isBullishTrend && lastKline.low <= pullbackEma && lastKline.close > pullbackEma;
    const bearishPullback = !isBullishTrend && lastKline.high >= pullbackEma && lastKline.close < pullbackEma;
    reasons.push(bullishPullback || bearishPullback ? '✅ Entry: Pullback to EMA' : '❌ Entry: No pullback');

    const rsi = getLast(RSI.calculate({ period: params.he_rsiPeriod, values: closes }))! as number;
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

    const trendEma = getLast(EMA.calculate({ period: params.ch_trendEmaPeriod!, values: closes }))! as number;
    const isMacroBullish = currentPrice > trendEma;
    const isMacroBearish = currentPrice < trendEma;
    
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.adxPeriod }))! as ADXOutput;
    const isTrending = adx.adx > params.ch_adxThreshold!;

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
    
    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');

    reasons.push(isMacroBullish ? `✅ Trend: Bullish` : isMacroBearish ? `✅ Trend: Bearish` : `❌ Trend: Neutral`);
    reasons.push(isTrending ? `✅ Regime: Trending (ADX ${adx.adx.toFixed(1)})` : `❌ Regime: Ranging`);

    if (isMacroBullish && isTrending) {
        reasons.push(kstBullishCross ? `✅ KST: Bullish Cross` : `❌ KST: No Bullish Cross`);
        reasons.push(isKstBullishBias ? `✅ KST > 0 (Bullish Bias)` : `❌ KST: Not in Bullish Territory`);
        reasons.push(isObvBullish ? `✅ Volume: Bullish Flow` : `❌ Volume: Not Bullish`);
        if (kstBullishCross && isKstBullishBias && isObvBullish) {
            return { signal: 'BUY', reasons };
        }
    }
    
    if (isMacroBearish && isTrending) {
        reasons.push(kstBearishCross ? `✅ KST: Bearish Cross` : `❌ KST: No Bearish Cross`);
        reasons.push(isKstBearishBias ? `✅ KST < 0 (Bearish Bias)` : `❌ KST: Not in Bearish Territory`);
        reasons.push(isObvBearish ? `✅ Volume: Bearish Flow` : `❌ Volume: Not Bearish`);
        if (kstBearishCross && isKstBearishBias && isObvBearish) {
            return { signal: 'SELL', reasons };
        }
    }

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
    
    const ema50 = getLast(EMA.calculate({ period: 50, values: closes }))! as number;
    const ema200 = getLast(EMA.calculate({ period: 200, values: closes }))! as number;
    const macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }))! as MACDOutput;
    const prevMacd = getPenultimate(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }))! as MACDOutput;
    const rsi = getLast(RSI.calculate({ values: closes, period: 14 }))! as number;
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: 14 }))! as ADXOutput;
    const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod }) as VortexIndicatorOutput;
    const last_vi_plus = getLast(vi.pdi)!;
    const last_vi_minus = getLast(vi.ndi)!;
    const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes }))! as number;
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
    
    // HTF Alignment Veto
    if (config.isHtfConfirmationEnabled && htfContext) {
        if (htfContext.htf_trend === 'bearish') bullTrend -= 50; // Heavy penalty
        if (htfContext.htf_trend === 'bullish') bearTrend -= 50; // Heavy penalty
    }

    const finalBullishScore = Math.max(0, bullTrend + bullMomentum + bullConfirm);
    const finalBearishScore = Math.max(0, bearTrend + bearMomentum + bearConfirm);

    const sentinelAnalysis: SentinelAnalysis = {
        bullish: { total: finalBullishScore, trend: (bullTrend / trendMax) * 100, momentum: (bullMomentum / momentumMax) * 100, confirmation: (bullConfirm / confirmMax) * 100 },
        bearish: { total: finalBearishScore, trend: (bearTrend / trendMax) * 100, momentum: (bearMomentum / momentumMax) * 100, confirmation: (bearConfirm / confirmMax) * 100 }
    };

    const reasons: string[] = [];
    const threshold = params.sentinel_scoreThreshold!;

    if (config.isHtfConfirmationEnabled && htfContext?.htf_trend) {
        reasons.push(htfContext.htf_trend === 'bullish' && finalBullishScore > finalBearishScore ? `✅ HTF Aligned Bullish` : htfContext.htf_trend === 'bearish' && finalBearishScore > finalBullishScore ? `✅ HTF Aligned Bearish` : `❌ HTF Misaligned`);
    }

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

// --- Agent 16: Ichimoku Trend Rider (Upgraded with OBV) ---
const getIchimokuTrendRiderSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = params.ichi_basePeriod + params.ichi_displacement;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data (${klines.length}/${minKlines}).`] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    const prevPrice = getPenultimate(closes)!;
    let reasons: string[] = [];

    const ichi_params = { high: highs, low: lows, conversionPeriod: params.ichi_conversionPeriod, basePeriod: params.ichi_basePeriod, spanPeriod: params.ichi_laggingSpanPeriod, displacement: params.ichi_displacement };
    const ichiValues = IchimokuCloud.calculate(ichi_params) as IchimokuCloudOutput[];
    const lastIchi = getLast(ichiValues);
    const prevIchi = getPenultimate(ichiValues);
    if (!lastIchi || !prevIchi || !lastIchi.spanA || !lastIchi.spanB || !prevIchi.spanA || !prevIchi.spanB) {
        return { signal: 'HOLD', reasons: ['ℹ️ Ichimoku Cloud not yet formed.'] };
    }
    
    const isPriceAboveKumo = currentPrice > lastIchi.spanA && currentPrice > lastIchi.spanB;
    const isPriceBelowKumo = currentPrice < lastIchi.spanA && currentPrice < lastIchi.spanB;
    const bullishTkCross = prevIchi.conversion < prevIchi.base && lastIchi.conversion > lastIchi.base;
    const bearishTkCross = prevIchi.conversion > prevIchi.base && lastIchi.conversion < lastIchi.base;

    const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod }) as VortexIndicatorOutput;
    const isViBullish = getLast(vi.pdi)! > getLast(vi.ndi)!;
    const isViBearish = getLast(vi.ndi)! > getLast(vi.pdi)!;
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
        const rrRatio = risk > 0 ? reward / risk : 0;

        if (rrRatio < constants.MIN_RISK_REWARD_RATIO) {
            return { isValid: false, reason: `❌ VETO: Final Risk/Reward ratio (${rrRatio.toFixed(2)}) is below the system minimum of ${constants.MIN_RISK_REWARD_RATIO}.` };
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

    // HTF logic is not implemented yet, so return empty for now.
    
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
        case 9:  signal = getQuantumScalperSignal(klines, config, htfContext); break;
        case 11: signal = getHistoricExpertSignal(klines, config, htfContext); break;
        case 13: signal = getChameleonSignal(klines, config, htfContext); break;
        case 14: signal = getTheSentinelSignal(klines, config, htfContext); break;
        case 16: signal = getIchimokuTrendRiderSignal(klines, config, htfContext); break;
        default: signal = { signal: 'HOLD', reasons: ['Agent not found'] }; break;
    }

    if (signal.signal === 'HOLD') {
        return signal;
    }
    
    const lastKline = getLast(klines)!;
    const entryPrice = lastKline.close;
    const isLong = signal.signal === 'BUY';

    if (config.isMarketCohesionEnabled) {
        const heikinAshiKlines = calculateHeikinAshi(klines);
        const lookback = (config.agentParams as Required<AgentParams>).qsc_marketCohesionCandles || 2;
        const cohesionCheck = isMarketCohesive(heikinAshiKlines, signal.signal, config.timeFrame, lookback);
        if (!cohesionCheck.cohesive) {
            signal.reasons.push(cohesionCheck.reason);
            return { ...signal, signal: 'HOLD' };
        }
        signal.reasons.push(cohesionCheck.reason);
    }

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
            if (isObvTrending(obv, 'bullish')) context.obvTrend = 'bullish';
            else if (isObvTrending(obv, 'bearish')) context.obvTrend = 'bearish';
            else context.obvTrend = 'neutral';
            const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: 14 });
            context.vi14 = { pdi: getLast(vi.pdi)!, ndi: getLast(vi.ndi)! };
            context.ichiCloud = getLast(IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 }));
            context.lastCandlePattern = recognizeCandlestickPattern(klines[klines.length - 1], klines[klines.length - 2]);
        }
        
        if (htfKlines && htfKlines.length >= 50) {
            const htfCloses = htfKlines.map(k => k.close);
            const htfHighs = htfKlines.map(k => k.high);
            const htfLows = htfKlines.map(k => k.low);
            const htfVolumes = htfKlines.map(k => k.volume || 0);

            context.htf_rsi14 = getLast(RSI.calculate({ period: 14, values: htfCloses }));
            context.htf_stochRsi = getLast(StochasticRSI.calculate({ values: htfCloses, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 }));
            context.htf_ema9 = getLast(EMA.calculate({ period: 9, values: htfCloses }));
            context.htf_ema21 = getLast(EMA.calculate({ period: 21, values: htfCloses }));
            context.htf_ema50 = getLast(EMA.calculate({ period: 50, values: htfCloses }));
            context.htf_ema200 = getLast(EMA.calculate({ period: 200, values: htfCloses }));
            context.htf_macd = getLast(MACD.calculate({ values: htfCloses, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }));
            context.htf_adx14 = getLast(ADX.calculate({ high: htfHighs, low: htfLows, close: htfCloses, period: 14 }));
            const htfObv = OBV.calculate({ close: htfCloses, volume: htfVolumes });
            if (isObvTrending(htfObv, 'bullish')) context.htf_obvTrend = 'bullish';
            else if (isObvTrending(htfObv, 'bearish')) context.htf_obvTrend = 'bearish';
            else context.htf_obvTrend = 'neutral';
            const htfVi = VortexIndicator.calculate({ high: htfHighs, low: htfLows, close: htfCloses, period: 14 });
            context.htf_vi14 = { pdi: getLast(htfVi.pdi)!, ndi: getLast(htfVi.ndi)! };

            const htfEma50 = context.htf_ema50;
            const htfEma200 = context.htf_ema200;
            const htfLastClose = getLast(htfCloses);
            if(htfEma50 && htfEma200 && htfLastClose) {
                if (htfLastClose > htfEma50 && htfEma50 > htfEma200) context.htf_trend = 'bullish';
                else if (htfLastClose < htfEma50 && htfEma50 < htfEma200) context.htf_trend = 'bearish';
                else context.htf_trend = 'neutral';
            }
        }
    } catch (e) {
        // In a backtest or live environment, we don't want to crash, just return what we have.
        console.warn("Could not calculate full market context:", e);
    }
    
    return context;
}