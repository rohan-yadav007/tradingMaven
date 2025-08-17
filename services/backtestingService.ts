
import { Kline, BotConfig, BacktestResult, SimulatedTrade, AgentParams, Position, RiskMode, TradingMode, OptimizationResultItem, TradeManagementSignal } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getUniversalProfitTrailSignal, getAgentExitSignal, getInitialAgentTargets, validateTradeProfitability } from './localAgentService';
import * as constants from '../constants';

interface SimulatedPosition extends Omit<Position, 'id' | 'entryTime' | 'botId' | 'orderId' | 'exitReason' | 'pnl' | 'exitTime' | 'activeStopLossReason'> {
    entryTime: number; // Use timestamp for easier comparison
    activeStopLossReason: 'Agent Logic' | 'Hard Cap' | 'Universal Trail' | 'Agent Trail';
}

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

/**
 * Helper to generate all possible combinations of parameters from given ranges.
 * @param ranges - A dictionary where keys are parameter names and values are arrays of numbers to test.
 * @returns An array of AgentParams objects, each representing a unique combination.
 */
function generateParamCombinations(ranges: Record<string, number[]>): AgentParams[] {
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


export async function runOptimization(
    klines: Kline[],
    baseConfig: BotConfig,
    onProgress: (progress: { percent: number; combinations: number }) => void
): Promise<OptimizationResultItem[]> {
    const { agent } = baseConfig;
    let paramRanges: Record<string, number[]> = {};

    // --- Reworked Optimization Parameter Ranges ---
    // These are wider and more strategic to find better results efficiently.
    switch (agent.id) {
        case 7: // Market Structure Maven
            paramRanges = {
                msm_htfEmaPeriod: [50, 75, 100, 125],
                msm_swingPointLookback: [5, 8, 12, 15],
            };
            break;
        case 9: // Quantum Scalper
             paramRanges = {
                qsc_trendScoreThreshold: [3, 4],
                qsc_adxThreshold: [22, 25, 28],
                qsc_adxChopBuffer: [2, 4],
                qsc_psarStep: [0.02, 0.03],
            };
            break;
        case 11: // Historic Expert
             paramRanges = {
                he_trendSmaPeriod: [20, 30],
                he_fastEmaPeriod: [7, 9, 12],
                he_slowEmaPeriod: [20, 25],
                he_rsiMidline: [48, 50, 52],
            };
            break;
        default:
            throw new Error(`Agent "${agent.name}" does not support optimization.`);
    }

    const paramCombinations = generateParamCombinations(paramRanges);
    if (paramCombinations.length > 200) { // Safety cap
        throw new Error(`Too many combinations to test (${paramCombinations.length}). Please narrow the parameter ranges.`);
    }

    const results: OptimizationResultItem[] = [];
    const totalCombinations = paramCombinations.length;

    for (let i = 0; i < totalCombinations; i++) {
        const params = paramCombinations[i];
        const testConfig: BotConfig = {
            ...baseConfig,
            agentParams: params,
        };
        
        const result = await runBacktest(klines, testConfig);
        results.push({ params, result });

        onProgress({
            percent: ((i + 1) / totalCombinations) * 100,
            combinations: totalCombinations
        });
        await new Promise(resolve => setTimeout(resolve, 0)); // Yield to allow UI updates
    }

    return results
        .filter(item => item.result.totalTrades > 0)
        .sort((a, b) => {
            if (b.result.profitFactor !== a.result.profitFactor) {
                return b.result.profitFactor - a.result.profitFactor;
            }
            return b.result.totalPnl - a.result.totalPnl;
        });
}


// High-Fidelity Backtesting Engine (Refactored for Single Kline Dataset)
export async function runBacktest(
    klines: Kline[],
    config: BotConfig
): Promise<BacktestResult> {
    
    let openPosition: SimulatedPosition | null = null;
    const trades: SimulatedTrade[] = [];
    const equityCurve: number[] = [];
    const STARTING_CAPITAL = 10000;
    let equity = STARTING_CAPITAL;

    const minCandles = 200;
    if (klines.length < minCandles) {
        return {
            trades: [], totalPnl: 0, winRate: 0, totalTrades: 0, wins: 0, losses: 0, breakEvens: 0, maxDrawdown: 0, profitFactor: 0, sharpeRatio: 0, averageTradeDuration: 'N/A'
        };
    }
    
    let allHtfKlines: Kline[] | undefined = undefined;
    if (config.isHtfConfirmationEnabled) {
        const htf = config.htfTimeFrame === 'auto' 
            ? constants.TIME_FRAMES[constants.TIME_FRAMES.indexOf(config.timeFrame) + 1] 
            : config.htfTimeFrame;

        if (htf) {
            const startTime = klines[0].time;
            const endTime = klines[klines.length - 1].time + getTimeframeDuration(config.timeFrame) - 1;
            allHtfKlines = await binanceService.fetchFullKlines(config.pair.replace('/', ''), htf, startTime, endTime, config.mode);
        }
    }

    const closePosition = (exitPrice: number, exitReason: string, exitTime: number): boolean => {
        if (!openPosition) return false;
        
        const isLong = openPosition.direction === 'LONG';
        const grossPnl = (exitPrice - openPosition.entryPrice) * openPosition.size * (isLong ? 1 : -1);
        const entryValue = openPosition.entryPrice * openPosition.size;
        const exitValue = exitPrice * openPosition.size;
        const fees = (entryValue + exitValue) * constants.TAKER_FEE_RATE;
        const netPnl = grossPnl - fees;
        equity += netPnl;

        const closedTrade: SimulatedTrade = {
            id: trades.length + 1, pair: openPosition.pair, direction: openPosition.direction,
            entryPrice: openPosition.entryPrice, exitPrice: exitPrice, entryTime: openPosition.entryTime,
            exitTime: exitTime, size: openPosition.size, investedAmount: config.investmentAmount, pnl: netPnl,
            exitReason, entryReason: openPosition.entryReason
        };
        trades.push(closedTrade);

        openPosition = null;
        return true;
    };


    for (let i = minCandles; i < klines.length; i++) {
        const currentCandle = klines[i - 1]; // The candle that just closed
        const historySlice = klines.slice(0, i);
        let hasTradedInThisCandle = false; // "One Trade Per Candle" Rule

        if (openPosition) {
            const isLong = openPosition.direction === 'LONG';
            const stopReason = openPosition.activeStopLossReason === 'Universal Trail' || openPosition.activeStopLossReason === 'Agent Trail' ? 'Trailing Stop Hit' : 'Stop Loss Hit';

            // Pessimistic, "Risk-First" Simulation Logic
            if (isLong) {
                if (currentCandle.low <= openPosition.stopLossPrice) {
                    hasTradedInThisCandle = closePosition(openPosition.stopLossPrice, stopReason, currentCandle.time);
                } else if (currentCandle.high >= openPosition.takeProfitPrice) {
                    hasTradedInThisCandle = closePosition(openPosition.takeProfitPrice, 'Take Profit Hit', currentCandle.time);
                }
            } else { // SHORT
                if (currentCandle.high >= openPosition.stopLossPrice) {
                    hasTradedInThisCandle = closePosition(openPosition.stopLossPrice, stopReason, currentCandle.time);
                } else if (currentCandle.low <= openPosition.takeProfitPrice) {
                    hasTradedInThisCandle = closePosition(openPosition.takeProfitPrice, 'Take Profit Hit', currentCandle.time);
                }
            }

            // If not closed by SL/TP, manage position on candle close
            if (openPosition) {
                const tempPositionForSignal: Position = { ...openPosition, id: 0, botId: 'sim', orderId: null, entryTime: new Date(openPosition.entryTime) };
                const currentPrice = currentCandle.close;

                // --- Candle-based SL Management ---
                if (!config.isUniversalProfitTrailEnabled) {
                    const slSignal = getAgentExitSignal(tempPositionForSignal, historySlice, currentPrice, config);
                    if (slSignal.closePosition) {
                        hasTradedInThisCandle = closePosition(currentPrice, `Agent Exit: ${slSignal.reasons.join(' ')}`, currentCandle.time);
                    } else if (slSignal.newStopLoss) {
                        const isLong = openPosition.direction === 'LONG';
                        if ((isLong && slSignal.newStopLoss > openPosition.stopLossPrice) || (!isLong && slSignal.newStopLoss < openPosition.stopLossPrice)) {
                            openPosition.stopLossPrice = slSignal.newStopLoss;
                            openPosition.activeStopLossReason = 'Agent Trail';
                        }
                    }
                }

                // --- Candle-based TP Management ---
                if (openPosition && config.isTrailingTakeProfitEnabled) { // Check openPosition again
                    const isLong = openPosition.direction === 'LONG';
                    const isInProfit = isLong ? currentPrice > openPosition.entryPrice : currentPrice < openPosition.entryPrice;
                    if (isInProfit) {
                        const targets = getInitialAgentTargets(historySlice, currentPrice, isLong ? 'LONG' : 'SHORT', config.timeFrame, { ...constants.DEFAULT_AGENT_PARAMS, ...config.agentParams }, config.agent.id);
                        const newTp = targets.takeProfitPrice;
                        if ((isLong && newTp > openPosition.takeProfitPrice) || (!isLong && newTp < openPosition.takeProfitPrice)) {
                            openPosition.takeProfitPrice = newTp;
                        }
                    }
                }
            }
        }
        
        if (!openPosition && !hasTradedInThisCandle) {
            let htfHistorySlice: Kline[] | undefined = undefined;
            if (allHtfKlines) {
                const currentCandleTime = historySlice[historySlice.length - 1].time;
                htfHistorySlice = allHtfKlines.filter(k => k.time <= currentCandleTime);
            }

            const signal = await getTradingSignal(config.agent, historySlice, config, htfHistorySlice);
             
            if (signal.signal !== 'HOLD') {
                const entryPrice = klines[i].open; // Enter on the open of the next candle
                const isLong = signal.signal === 'BUY';

                if (config.investmentAmount > 0 && entryPrice > 0) {
                    const agentTargets = getInitialAgentTargets(historySlice, entryPrice, isLong ? 'LONG' : 'SHORT', config.timeFrame, { ...constants.DEFAULT_AGENT_PARAMS, ...config.agentParams }, config.agent.id);
                    
                    let stopLossPrice = agentTargets.stopLossPrice;
                    let slReason: 'Agent Logic' | 'Hard Cap' = 'Agent Logic';
                    
                    let takeProfitPrice = agentTargets.takeProfitPrice;
                    if (config.isTakeProfitLocked) {
                       const positionValue = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
                       const tradeSize = positionValue / entryPrice;
                       if(config.takeProfitMode === RiskMode.Percent) {
                           const profitAmount = config.investmentAmount * (config.takeProfitValue / 100);
                           takeProfitPrice = isLong ? entryPrice + (profitAmount / tradeSize) : entryPrice - (profitAmount / tradeSize);
                       } else {
                           const takeProfitValue = config.takeProfitValue;
                           takeProfitPrice = isLong ? entryPrice + (takeProfitValue / tradeSize) : entryPrice - (takeProfitValue / tradeSize);
                       }
                    }
                    
                    const positionValueForCap = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
                    const tradeSizeForCap = positionValueForCap / entryPrice;
                    if (tradeSizeForCap > 0) {
                        let maxLossAmount = config.investmentAmount * (constants.MAX_STOP_LOSS_PERCENT_OF_INVESTMENT / 100);
                        if (config.mode === TradingMode.USDSM_Futures) {
                            maxLossAmount *= config.leverage;
                        }
                        const hardCapStopLossPrice = isLong ? entryPrice - (maxLossAmount / tradeSizeForCap) : entryPrice + (maxLossAmount / tradeSizeForCap);
                        
                        const tighterSl = isLong 
                            ? Math.max(stopLossPrice, hardCapStopLossPrice)
                            : Math.min(stopLossPrice, hardCapStopLossPrice);

                        if (tighterSl !== stopLossPrice) {
                            slReason = 'Hard Cap';
                        }
                        
                        stopLossPrice = tighterSl;
                    }

                    // --- UNIVERSAL PROFITABILITY GUARDRAIL (BACKTEST) ---
                    const validation = validateTradeProfitability(entryPrice, stopLossPrice, takeProfitPrice, isLong ? 'LONG' : 'SHORT', config);
                    if (!validation.isValid) {
                        continue; // Veto trade and move to next candle
                    }
                    // --- END GUARDRAIL ---

                    const positionValue = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
                    const tradeSize = positionValue / entryPrice;
                    
                    if (tradeSize > 0) {
                        openPosition = {
                            pair: config.pair, mode: config.mode, executionMode: config.executionMode, direction: isLong ? 'LONG' : 'SHORT',
                            entryPrice, size: tradeSize, leverage: config.leverage, entryTime: currentCandle.time,
                            entryReason: signal.reasons.join(' '), agentName: config.agent.name, takeProfitPrice,
                            stopLossPrice,
                            initialStopLossPrice: agentTargets.stopLossPrice,
                            initialTakeProfitPrice: takeProfitPrice,
                            pricePrecision: config.pricePrecision, timeFrame: config.timeFrame,
                            marginType: config.marginType,
                            activeStopLossReason: slReason,
                        };
                    }
                }
            }
        }
        
        let currentPnl = 0;
        if(openPosition) {
            currentPnl = (currentCandle.close - openPosition.entryPrice) * openPosition.size * (openPosition.direction === 'LONG' ? 1 : -1);
        }
        equityCurve.push(equity + currentPnl);
    }
    
    if (openPosition) {
        closePosition(klines[klines.length - 1].close, 'End of backtest', klines[klines.length - 1].time);
    }
    
    return calculateResults(trades, equityCurve, STARTING_CAPITAL);
}

function calculateResults(trades: SimulatedTrade[], equityCurve: number[], startingCapital: number): BacktestResult {
    const totalTrades = trades.length;

    if (totalTrades === 0) {
        return {
            trades: [], totalPnl: 0, winRate: 0, totalTrades: 0, wins: 0, losses: 0, breakEvens: 0, maxDrawdown: 0, profitFactor: 0, sharpeRatio: 0, averageTradeDuration: 'N/A'
        };
    }

    let wins = 0;
    let losses = 0;
    let breakEvens = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let totalPnl = 0;

    for (const trade of trades) {
        totalPnl += trade.pnl;
        if (trade.pnl > 0) {
            wins++;
            grossProfit += trade.pnl;
        } else if (trade.pnl < 0) {
            losses++;
            grossLoss += trade.pnl;
        } else {
            breakEvens++;
        }
    }
    
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const profitFactor = Math.abs(grossLoss) > 0 ? grossProfit / Math.abs(grossLoss) : Infinity;

    // Max Drawdown Calculation
    let peakEquity = -Infinity;
    let maxDrawdown = 0;
    for (const equity of equityCurve) {
        if (equity > peakEquity) {
            peakEquity = equity;
        }
        const drawdown = peakEquity - equity;
        if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
        }
    }

    const totalDurationMs = trades.reduce((acc, trade) => acc + (trade.exitTime - trade.entryTime), 0);
    const averageTradeDuration = formatDuration(totalTrades > 0 ? totalDurationMs / totalTrades : 0);

    const returns = trades.map(t => t.pnl / t.investedAmount);
    const avgReturn = returns.reduce((acc, r) => acc + r, 0) / returns.length;
    const stdDev = Math.sqrt(returns.map(r => Math.pow(r - avgReturn, 2)).reduce((acc, v) => acc + v, 0) / returns.length);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized for daily returns assumption (can be improved)
    
    return {
        trades, totalPnl, winRate, totalTrades, wins, losses, breakEvens, maxDrawdown, profitFactor, sharpeRatio, averageTradeDuration
    };
}
