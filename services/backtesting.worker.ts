

import { Kline, BotConfig, BacktestResult, SimulatedTrade, AgentParams, Position, RiskMode, TradingMode, OptimizationResultItem } from '../types';
import { getTradingSignal, getInitialAgentTargets, getAgentExitSignal, getMultiStageProfitSecureSignal, validateTradeProfitability, getSupervisorSignal, getMandatoryBreakevenSignal } from './localAgentService';
import * as constants from '../constants';

// --- Worker-local Helper Functions ---

const getLast = <T>(arr: T[] | undefined): T | undefined => arr && arr.length > 0 ? arr[arr.length - 1] : undefined;

const getTimeframeDuration = (timeframe: string): number => {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1), 10);
    if (isNaN(value)) return 0;
    switch (unit) {
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return 0;
    }
};

function aggregateKlines(klines: Kline[], timeframe: string): Kline[] {
    const timeframeMs = getTimeframeDuration(timeframe);
    // If target timeframe is 1m or less, no aggregation needed as source is 1m
    if (timeframeMs <= 60000) return klines;

    const aggregated: Kline[] = [];
    if (klines.length === 0) return [];

    let currentAggKline: Kline | null = null;

    for (const kline of klines) {
        const timeframeStart = Math.floor(kline.time / timeframeMs) * timeframeMs;

        if (!currentAggKline || timeframeStart !== currentAggKline.time) {
            if (currentAggKline) {
                aggregated.push(currentAggKline);
            }
            currentAggKline = {
                time: timeframeStart,
                open: kline.open,
                high: kline.high,
                low: kline.low,
                close: kline.close,
                volume: kline.volume || 0,
                isFinal: true,
            };
        } else {
            currentAggKline.high = Math.max(currentAggKline.high, kline.high);
            currentAggKline.low = Math.min(currentAggKline.low, kline.low);
            currentAggKline.close = kline.close;
            currentAggKline.volume = (currentAggKline.volume || 0) + (kline.volume || 0);
        }
    }

    if (currentAggKline) {
        aggregated.push(currentAggKline);
    }
    return aggregated;
}


type SimulatedPosition = Position;


function formatDuration(ms: number): string {
    if (ms < 0) return '0s';
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function generateParamCombinations(ranges: Record<string, (number | boolean)[]>): AgentParams[] {
    const keys = Object.keys(ranges) as (keyof AgentParams)[];
    if (keys.length === 0) return [{}];

    const combinations: AgentParams[] = [];
    const recurse = (index: number, currentParams: AgentParams) => {
        if (index === keys.length) {
            combinations.push(currentParams);
            return;
        }
        const key = keys[index];
        const values = ranges[key]!;
        for (const value of values) {
            recurse(index + 1, { ...currentParams, [key]: value });
        }
    };
    recurse(0, {});
    return combinations;
}

function calculateResults(trades: SimulatedTrade[], equityCurve: number[], startingCapital: number): BacktestResult {
    const totalTrades = trades.length;
    if (totalTrades === 0) {
        return { trades: [], totalPnl: 0, winRate: 0, totalTrades: 0, wins: 0, losses: 0, breakEvens: 0, maxDrawdown: 0, profitFactor: 0, sharpeRatio: 0, averageTradeDuration: 'N/A' };
    }
    let wins = 0, losses = 0, breakEvens = 0, grossProfit = 0, grossLoss = 0, totalPnl = 0;
    for (const trade of trades) {
        totalPnl += trade.pnl;
        if (trade.pnl > 0) { wins++; grossProfit += trade.pnl; } 
        else if (trade.pnl < 0) { losses++; grossLoss += trade.pnl; } 
        else { breakEvens++; }
    }
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const profitFactor = Math.abs(grossLoss) > 0 ? grossProfit / Math.abs(grossLoss) : Infinity;
    let peakEquity = -Infinity, maxDrawdown = 0;
    for (const equity of equityCurve) {
        if (equity > peakEquity) peakEquity = equity;
        const drawdown = peakEquity - equity;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    const totalDurationMs = trades.reduce((acc, trade) => acc + (trade.exitTime - trade.entryTime), 0);
    const averageTradeDuration = formatDuration(totalTrades > 0 ? totalDurationMs / totalTrades : 0);
    const returns = trades.map(t => t.pnl / t.investedAmount);
    const avgReturn = returns.reduce((acc, r) => acc + r, 0) / returns.length;
    const stdDev = Math.sqrt(returns.map(r => Math.pow(r - avgReturn, 2)).reduce((acc, v) => acc + v, 0) / returns.length);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
    return { trades, totalPnl, winRate, totalTrades, wins, losses, breakEvens, maxDrawdown, profitFactor, sharpeRatio, averageTradeDuration };
}


// --- Core Logic (Now accepts pre-fetched HTF klines) ---

async function runBacktest(
    // klines are always 1m data
    klines: Kline[],
    config: BotConfig,
    allHtfKlines?: Kline[]
): Promise<BacktestResult> {
    let openPosition: SimulatedPosition | null = null;
    const trades: SimulatedTrade[] = [];
    const equityCurve: number[] = [];
    const STARTING_CAPITAL = 10000;
    let equity = STARTING_CAPITAL;
    const minCandles = 200;
    let cooldownUntil: { time: number; direction: 'LONG' | 'SHORT'; } | null = null;

    const targetTimeframeKlines = aggregateKlines(klines, config.timeFrame);

    if (targetTimeframeKlines.length < minCandles) {
        return calculateResults([], [], STARTING_CAPITAL);
    }

    const closePosition = (exitPrice: number, exitReason: string, exitTime: number): boolean => {
        if (!openPosition) return false;
        const isLong = openPosition.direction === 'LONG';
        const grossPnl = (exitPrice - openPosition.entryPrice) * openPosition.size * (isLong ? 1 : -1);
        const entryValue = openPosition.entryPrice * openPosition.size;
        const exitValue = exitPrice * openPosition.size;
        const fees = (entryValue + exitValue) * openPosition.takerFeeRate;
        const netPnl = grossPnl - fees;
        equity += netPnl;
        const closedDirection = openPosition.direction;
        trades.push({
            id: trades.length + 1, pair: openPosition.pair, direction: openPosition.direction,
            entryPrice: openPosition.entryPrice, exitPrice, entryTime: new Date(openPosition.entryTime).getTime(), exitTime,
            size: openPosition.size, investedAmount: config.investmentAmount, pnl: netPnl, exitReason,
            entryReason: openPosition.entryReason
        });
        openPosition = null;

        if (config.isCooldownEnabled) {
            const params = { ...constants.DEFAULT_AGENT_PARAMS, ...config.agentParams };
            const cooldownCandles = params.cooldownCandles;
            const timeframeMs = getTimeframeDuration(config.timeFrame);
            const cooldownEndTime = exitTime + (cooldownCandles * timeframeMs);
            cooldownUntil = { time: cooldownEndTime, direction: closedDirection };
        }

        return true;
    };

    for (let i = minCandles; i < targetTimeframeKlines.length; i++) {
        const historySlice = targetTimeframeKlines.slice(0, i + 1);
        const currentCandle = targetTimeframeKlines[i]; // This is the candle we are simulating
        let hasTradedInThisCandle = false;

        if (cooldownUntil && currentCandle.time >= cooldownUntil.time) {
            cooldownUntil = null;
        }

        // --- MANAGE OPEN POSITION ---
        if (openPosition) {
            const isLong = openPosition.direction === 'LONG';
            const stopReason = openPosition.activeStopLossReason.includes('Trail') || openPosition.activeStopLossReason.includes('Secure') || openPosition.activeStopLossReason === 'Breakeven' ? 'Trailing Stop Hit' : 'Stop Loss Hit';
            
            const pricePath = currentCandle.open < currentCandle.close 
                ? [currentCandle.open, currentCandle.high, currentCandle.low, currentCandle.close] 
                : [currentCandle.open, currentCandle.low, currentCandle.high, currentCandle.close];

            for (const pricePoint of pricePath) {
                if (!openPosition) break;
                if (isLong) {
                    if (pricePoint <= openPosition.stopLossPrice) { hasTradedInThisCandle = closePosition(openPosition.stopLossPrice, stopReason, currentCandle.time); break; }
                    if (pricePoint >= openPosition.takeProfitPrice) { hasTradedInThisCandle = closePosition(openPosition.takeProfitPrice, 'Take Profit Hit', currentCandle.time); break; }
                } else {
                    if (pricePoint >= openPosition.stopLossPrice) { hasTradedInThisCandle = closePosition(openPosition.stopLossPrice, stopReason, currentCandle.time); break; }
                    if (pricePoint <= openPosition.takeProfitPrice) { hasTradedInThisCandle = closePosition(openPosition.takeProfitPrice, 'Take Profit Hit', currentCandle.time); break; }
                }
            }
            if (hasTradedInThisCandle) { equityCurve.push(equity); continue; }

            // --- ON-CANDLE-CLOSE MANAGEMENT ---
            openPosition.candlesSinceEntry!++;
            const currentPrice = currentCandle.close;

            // Tier 3: Emergency Brake
            if (config.isInvalidationCheckEnabled) {
                const htfHistorySlice = allHtfKlines ? allHtfKlines.filter(k => k.time <= currentCandle.time) : undefined;
                const invalidationSignal = await getSupervisorSignal(openPosition, historySlice, config, htfHistorySlice);
                if (invalidationSignal.action === 'close') {
                    hasTradedInThisCandle = closePosition(currentPrice, invalidationSignal.reason, currentCandle.time);
                    if (hasTradedInThisCandle) { equityCurve.push(equity); continue; }
                }
            }
            
            let updatedPosition = { ...openPosition };
            
            const potentialStops: { price: number; reason: Position['activeStopLossReason']; newState?: any }[] = [];
            potentialStops.push({ price: updatedPosition.stopLossPrice, reason: updatedPosition.activeStopLossReason });

            // Tier 0: Mandatory Breakeven (NON-NEGOTIABLE)
            const mandatoryBreakevenSignal = getMandatoryBreakevenSignal(updatedPosition, currentPrice);
            if (mandatoryBreakevenSignal.newStopLoss) {
                potentialStops.push({
                    price: mandatoryBreakevenSignal.newStopLoss,
                    reason: 'Breakeven',
                    newState: mandatoryBreakevenSignal.newState
                });
            }

            if (config.isUniversalProfitTrailEnabled) {
                const signal = getMultiStageProfitSecureSignal(updatedPosition, currentPrice);
                if (signal.newStopLoss) {
                    potentialStops.push({ price: signal.newStopLoss, reason: 'Profit Secure', newState: signal.newState });
                }
            }

            const agentTrailSignal = getAgentExitSignal(updatedPosition, historySlice, currentPrice, config);
            if (agentTrailSignal.newStopLoss) {
                potentialStops.push({ price: agentTrailSignal.newStopLoss, reason: 'Agent Trail' });
            }

            let bestStop = potentialStops[0];
            for (let i = 1; i < potentialStops.length; i++) {
                const candidate = potentialStops[i];
                if ((isLong && candidate.price > bestStop.price) || (!isLong && candidate.price < bestStop.price)) {
                    bestStop = candidate;
                }
            }

            if (bestStop.price !== updatedPosition.stopLossPrice) {
                const isValid = isLong ? bestStop.price < currentPrice : bestStop.price > currentPrice;
                if (isValid) {
                    updatedPosition.stopLossPrice = bestStop.price;
                    updatedPosition.activeStopLossReason = bestStop.reason;
                    if (bestStop.newState) {
                        updatedPosition = { ...updatedPosition, ...bestStop.newState };
                    }
                }
            }

            if (config.isTrailingTakeProfitEnabled) {
                const targets = getInitialAgentTargets(historySlice, currentPrice, isLong ? 'LONG' : 'SHORT', config);
                if ((isLong && targets.takeProfitPrice > updatedPosition.takeProfitPrice) || (!isLong && targets.takeProfitPrice < updatedPosition.takeProfitPrice)) {
                    updatedPosition.takeProfitPrice = targets.takeProfitPrice;
                }
            }
            openPosition = updatedPosition;
        }
        
        // --- CHECK FOR NEW ENTRY ---
        if (!openPosition && !hasTradedInThisCandle) {
            const htfHistorySlice = allHtfKlines ? allHtfKlines.filter(k => k.time <= currentCandle.time) : undefined;
            const signal = await getTradingSignal(config.agent, historySlice, config, htfHistorySlice);
            
            let isVetoedByCooldown = false;
            if (signal.signal !== 'HOLD' && cooldownUntil) {
                const signalDirection = signal.signal === 'BUY' ? 'LONG' : 'SHORT';
                if (signalDirection === cooldownUntil.direction) {
                    isVetoedByCooldown = true;
                }
            }

            if (signal.signal !== 'HOLD' && !isVetoedByCooldown) {
                const entryPrice = currentCandle.close;
                const isLong = signal.signal === 'BUY';
                
                const { stopLossPrice, takeProfitPrice, slReason, agentStopLoss } = getInitialAgentTargets(historySlice, entryPrice, isLong ? 'LONG' : 'SHORT', config);
                let finalTp = takeProfitPrice;

                if (config.isTakeProfitLocked && config.agent.id !== 13) {
                    const posVal = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
                    const size = posVal / entryPrice;
                    if(config.takeProfitMode === RiskMode.Percent) {
                        const pnl = config.investmentAmount * (config.takeProfitValue / 100);
                        finalTp = isLong ? entryPrice + (pnl / size) : entryPrice - (pnl / size);
                    } else {
                        finalTp = isLong ? entryPrice + (config.takeProfitValue / size) : entryPrice - (config.takeProfitValue / size);
                    }
                }
                
                if (validateTradeProfitability(entryPrice, stopLossPrice, finalTp, isLong ? 'LONG' : 'SHORT', config).isValid) {
                    const posVal = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
                    const size = posVal / entryPrice;
                    if (size > 0) {
                        openPosition = {
                            id: currentCandle.time,
                            orderId: null,
                            botId: 'backtest',
                            pair: config.pair, mode: config.mode, executionMode: config.executionMode, direction: isLong ? 'LONG' : 'SHORT',
                            entryPrice, size, investmentAmount: config.investmentAmount, leverage: config.leverage, entryTime: new Date(currentCandle.time).toISOString(),
                            entryReason: signal.reasons.join(' '), agentName: config.agent.name, takeProfitPrice: finalTp,
                            stopLossPrice, initialStopLossPrice: agentStopLoss, initialTakeProfitPrice: takeProfitPrice,
                            pricePrecision: config.pricePrecision, timeFrame: config.timeFrame, marginType: config.marginType,
                            activeStopLossReason: slReason, isBreakevenSet: false, profitLockTier: 0,
                            peakPrice: entryPrice, proactiveLossCheckTriggered: false, candlesSinceEntry: 0,
                            hasBeenProfitable: false, takerFeeRate: config.takerFeeRate,
                            initialRiskInPrice: Math.abs(entryPrice - agentStopLoss),
                        };
                    }
                }
            }
        }
        
        let currentPnl = openPosition ? (currentCandle.close - openPosition.entryPrice) * openPosition.size * (openPosition.direction === 'LONG' ? 1 : -1) : 0;
        equityCurve.push(equity + currentPnl);
    }
    
    if (openPosition) {
        closePosition(targetTimeframeKlines[targetTimeframeKlines.length - 1].close, 'End of backtest', targetTimeframeKlines[targetTimeframeKlines.length - 1].time);
    }
    
    return calculateResults(trades, equityCurve, STARTING_CAPITAL);
}


async function runOptimization(
    klines: Kline[],
    baseConfig: BotConfig,
    id: number,
    allHtfKlines?: Kline[]
): Promise<OptimizationResultItem[]> {
    const { agent } = baseConfig;
    let paramRanges: Record<string, (number | boolean)[]> = {};
    switch (agent.id) {
        case 7: paramRanges = { msm_htfEmaPeriod: [50, 80, 120], msm_swingPointLookback: [5, 10, 15], isCandleConfirmationEnabled: [false, true] }; break;
        case 9: paramRanges = { qsc_adxThreshold: [22, 25, 28], viPeriod: [10, 14, 20], qsc_vwapDeviationPercent: [0.1, 0.2, 0.35] }; break;
        case 11: paramRanges = { he_trendSmaPeriod: [20, 30, 40], he_fastEmaPeriod: [7, 9, 12], he_slowEmaPeriod: [20, 25], he_rsiPeriod: [10, 14], he_rsiMidline: [48, 50, 52] }; break;
        case 13: paramRanges = { ichi_conversionPeriod: [7, 9, 12], ichi_basePeriod: [22, 26, 30], viPeriod: [10, 14, 20] }; break;
        case 16: paramRanges = { ichi_conversionPeriod: [7, 9, 12], ichi_basePeriod: [22, 26, 30] }; break;
        case 14: paramRanges = { sentinel_scoreThreshold: [65, 70, 75], viPeriod: [10, 14, 20] }; break;
        case 15: paramRanges = { vwap_emaTrendPeriod: [100, 150, 200], vwap_proximityPercent: [0.1, 0.2, 0.3] }; break;
        case 17: // The Detonator
            paramRanges = {
                det_rsi_thresh: [52, 55, 60],
                det_vol_mult: [1.5, 2.0, 2.5],
                det_sl_atr_mult: [0.9, 1.2, 1.5],
                det_rr_mult: [1.6, 2.0, 2.5],
                det_bb_margin_pct: [0.05, 0.08, 0.12],
            };
            break;
        default: throw new Error(`Agent "${agent.name}" does not support optimization.`);
    }
    const paramCombinations = generateParamCombinations(paramRanges);
    if (paramCombinations.length > 250) throw new Error(`Too many combinations (${paramCombinations.length}).`);
    const results: OptimizationResultItem[] = [];
    for (let i = 0; i < paramCombinations.length; i++) {
        const testConfig: BotConfig = { ...baseConfig, agentParams: paramCombinations[i] };
        const result = await runBacktest(klines, testConfig, allHtfKlines);
        results.push({ params: paramCombinations[i], result });
        self.postMessage({ type: 'progress', id, progress: { percent: ((i + 1) / paramCombinations.length) * 100, combinations: paramCombinations.length } });
    }
    return results.filter(item => item.result.totalTrades > 0).sort((a, b) => b.result.profitFactor - a.result.profitFactor || b.result.totalPnl - b.result.totalPnl);
}


// --- Worker Message Handler ---
self.onmessage = async (event: MessageEvent) => {
    const { type, payload, id } = event.data;
    try {
        if (type === 'runBacktest') {
            const { klines, config, htfKlines } = payload;
            const result = await runBacktest(klines, config, htfKlines);
            self.postMessage({ type: 'result', id, payload: result });
        } else if (type === 'runOptimization') {
            const { klines, config, htfKlines } = payload;
            const results = await runOptimization(klines, config, id, htfKlines);
            self.postMessage({ type: 'result', id, payload: results });
        }
    } catch (error) {
        self.postMessage({ type: 'error', id, error: error instanceof Error ? error.message : 'An unknown worker error occurred' });
    }
};
