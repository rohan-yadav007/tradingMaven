
import { Kline, BotConfig, BacktestResult, SimulatedTrade, AgentParams, Position, RiskMode, TradingMode } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getTradeManagementSignal, getInitialAgentTargets, analyzeTrendExhaustion } from './localAgentService';
import * as constants from '../constants';

interface SimulatedPosition extends Omit<Position, 'id' | 'entryTime' | 'botId' | 'orderId' | 'exitReason' | 'pnl' | 'exitTime'> {
    entryTime: number; // Use timestamp for easier comparison
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

// High-Fidelity Backtesting Engine
export async function runBacktest(
    mainKlines: Kline[],
    managementKlines: Kline[],
    config: BotConfig
): Promise<BacktestResult> {
    
    let openPosition: SimulatedPosition | null = null;
    const trades: SimulatedTrade[] = [];
    const equityCurve: number[] = [];
    const STARTING_CAPITAL = 10000;
    let equity = STARTING_CAPITAL;
    let managementKlineIndex = 0;

    let inPostProfitAnalysis = false;
    let lastProfitableDirection: 'LONG' | 'SHORT' | null = null;
    
    const minCandles = 200;
    if (mainKlines.length < minCandles) {
        return {
            trades: [], totalPnl: 0, winRate: 0, totalTrades: 0, wins: 0, losses: 0, breakEvens: 0, maxDrawdown: 0, profitFactor: 0, sharpeRatio: 0, averageTradeDuration: 'N/A'
        };
    }
    
    for (let i = minCandles; i < mainKlines.length; i++) {
        const entrySignalCandle = mainKlines[i-1];
        const historySlice = mainKlines.slice(0, i);

        if (openPosition) {
            const isLong = openPosition.direction === 'LONG';
            
            while (managementKlineIndex < managementKlines.length && managementKlines[managementKlineIndex].time <= entrySignalCandle.time) {
                const managementCandle = managementKlines[managementKlineIndex];
                
                let exitPrice: number | undefined;
                let exitReason: string | undefined;
                
                if (isLong) {
                    if (managementCandle.high >= openPosition.takeProfitPrice) {
                        exitPrice = openPosition.takeProfitPrice;
                        exitReason = 'Take Profit Hit';
                    } else if (managementCandle.low <= openPosition.stopLossPrice) {
                        const realisticExitPrice = managementCandle.open < openPosition.stopLossPrice ? managementCandle.open : openPosition.stopLossPrice;
                        const pnlWithSlippage = (realisticExitPrice - openPosition.entryPrice) * openPosition.size;
                        const maxLossAmount = config.investmentAmount * (constants.MAX_STOP_LOSS_PERCENT_OF_INVESTMENT / 100);

                        if (Math.abs(pnlWithSlippage) > maxLossAmount) {
                            exitPrice = openPosition.entryPrice - (maxLossAmount / openPosition.size);
                            exitReason = `Stop Loss Hit (Slippage Capped)`;
                        } else {
                            exitPrice = realisticExitPrice;
                            exitReason = 'Stop Loss Hit';
                        }
                    }
                } else { // SHORT
                    if (managementCandle.low <= openPosition.takeProfitPrice) {
                        exitPrice = openPosition.takeProfitPrice;
                        exitReason = 'Take Profit Hit';
                    } else if (managementCandle.high >= openPosition.stopLossPrice) {
                        const realisticExitPrice = managementCandle.open > openPosition.stopLossPrice ? managementCandle.open : openPosition.stopLossPrice;
                        const pnlWithSlippage = (realisticExitPrice - openPosition.entryPrice) * openPosition.size * -1;
                        const maxLossAmount = config.investmentAmount * (constants.MAX_STOP_LOSS_PERCENT_OF_INVESTMENT / 100);

                        if (pnlWithSlippage < -maxLossAmount) {
                            exitPrice = openPosition.entryPrice + (maxLossAmount / openPosition.size);
                            exitReason = 'Stop Loss Hit (Slippage Capped)';
                        } else {
                            exitPrice = realisticExitPrice;
                            exitReason = 'Stop Loss Hit';
                        }
                    }
                }

                if (exitPrice !== undefined && exitReason !== undefined) {
                    const pnl = (exitPrice - openPosition.entryPrice) * openPosition.size * (isLong ? 1 : -1);
                    equity += pnl;

                    const closedTrade: SimulatedTrade = {
                        id: trades.length + 1, pair: openPosition.pair, direction: openPosition.direction,
                        entryPrice: openPosition.entryPrice, exitPrice: exitPrice, entryTime: openPosition.entryTime,
                        exitTime: managementCandle.time, size: openPosition.size, investedAmount: config.investmentAmount, pnl,
                        exitReason, entryReason: openPosition.entryReason
                    };
                    trades.push(closedTrade);
                    
                    if (config.isCooldownEnabled && pnl > 0) {
                        inPostProfitAnalysis = true;
                        lastProfitableDirection = closedTrade.direction;
                    }

                    openPosition = null;
                    break;
                }

                 if (openPosition) { // Check if position still open before trailing
                    const mgmtHistorySlice = managementKlines.slice(0, managementKlineIndex + 1);
                    const livePriceForTrail = isLong ? managementCandle.high : managementCandle.low;
                    
                    const tempPositionForSignal: Position = { ...openPosition, id: 0, botId: 'sim', orderId: null, entryTime: new Date(openPosition.entryTime) };

                    const mgmtSignal = await getTradeManagementSignal(tempPositionForSignal, mgmtHistorySlice, livePriceForTrail, config);

                    if (mgmtSignal.newStopLoss) openPosition.stopLossPrice = mgmtSignal.newStopLoss;
                    if (mgmtSignal.newTakeProfit) openPosition.takeProfitPrice = mgmtSignal.newTakeProfit;
                }
                
                managementKlineIndex++;
            }
        } else {
            while (managementKlineIndex < managementKlines.length && managementKlines[managementKlineIndex].time <= entrySignalCandle.time) {
                managementKlineIndex++;
            }
        }
        
        if (!openPosition) {
            const signal = await getTradingSignal(config.agent, historySlice, config.timeFrame, config.agentParams);
             
            if (signal.signal !== 'HOLD') {
                let canProceed = true;

                if (inPostProfitAnalysis) {
                    const signalDirection = signal.signal === 'BUY' ? 'LONG' : 'SHORT';
                    if (signalDirection === lastProfitableDirection) {
                        const { veto } = analyzeTrendExhaustion(historySlice, signalDirection);
                        if (veto) canProceed = false;
                    }
                    inPostProfitAnalysis = false; 
                    lastProfitableDirection = null;
                }

                if (canProceed) {
                    const entryPrice = mainKlines[i].open; 
                    const isLong = signal.signal === 'BUY';

                    if (config.investmentAmount > 0 && entryPrice > 0) {
                        const agentTargets = getInitialAgentTargets(historySlice, entryPrice, isLong ? 'LONG' : 'SHORT', config.timeFrame, { ...constants.DEFAULT_AGENT_PARAMS, ...config.agentParams }, config.agent.id);
                        
                        let stopLossPrice = agentTargets.stopLossPrice;
                        
                        let takeProfitPrice = agentTargets.takeProfitPrice;
                        if (config.isTakeProfitLocked && !agentTargets.partialTps) {
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
                            const maxLossAmount = config.investmentAmount * (constants.MAX_STOP_LOSS_PERCENT_OF_INVESTMENT / 100);
                            const hardCapStopLossPrice = isLong ? entryPrice - (maxLossAmount / tradeSizeForCap) : entryPrice + (maxLossAmount / tradeSizeForCap);
                            stopLossPrice = isLong ? Math.max(stopLossPrice, hardCapStopLossPrice) : Math.min(stopLossPrice, hardCapStopLossPrice);
                        }

                        const positionValue = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
                        const tradeSize = positionValue / entryPrice;
                        
                        if (tradeSize > 0) {
                            openPosition = {
                                pair: config.pair, mode: config.mode, executionMode: config.executionMode, direction: isLong ? 'LONG' : 'SHORT',
                                entryPrice, size: tradeSize, leverage: config.leverage, entryTime: entrySignalCandle.time,
                                entryReason: signal.reasons.join(' '), agentName: config.agent.name, takeProfitPrice,
                                stopLossPrice,
                                initialStopLossPrice: stopLossPrice, // Store for R:R trailing
                                initialTakeProfitPrice: takeProfitPrice,
                                pricePrecision: config.pricePrecision, timeFrame: config.timeFrame,
                                initialSize: tradeSize,
                                partialTps: agentTargets.partialTps,
                                trailStartPrice: agentTargets.trailStartPrice,
                                marginType: config.marginType,
                            };
                        }
                    }
                }
            } else {
                if (inPostProfitAnalysis) {
                    inPostProfitAnalysis = false;
                    lastProfitableDirection = null;
                }
            }
        }
        
        let currentPnl = 0;
        if(openPosition) {
            currentPnl = (entrySignalCandle.close - openPosition.entryPrice) * openPosition.size * (openPosition.direction === 'LONG' ? 1 : -1);
        }
        equityCurve.push(equity + currentPnl);
    }
    
    if (openPosition) {
        const lastKline = managementKlines[managementKlines.length - 1] || mainKlines[mainKlines.length - 1];
        const exitPrice = lastKline.close;
        const pnl = (exitPrice - openPosition.entryPrice) * openPosition.size * (openPosition.direction === 'LONG' ? 1 : -1);

        trades.push({
            id: trades.length + 1, pair: openPosition.pair, direction: openPosition.direction,
            entryPrice: openPosition.entryPrice, exitPrice, entryTime: openPosition.entryTime, exitTime: lastKline.time,
            size: openPosition.size, pnl, investedAmount: config.investmentAmount,
            exitReason: 'End of backtest', entryReason: openPosition.entryReason,
        });
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
