

import { Kline, BotConfig, BacktestResult, SimulatedTrade, AgentParams, Position, RiskMode, TradingMode } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getTradeManagementSignal, getInitialAgentTargets } from './localAgentService';
import * as constants from '../constants';

interface SimulatedPosition extends Omit<Position, 'id' | 'entryTime' | 'botId' | 'orderId'> {
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
    let cooldownUntilTimestamp = -1; 
    let managementKlineIndex = 0;
    
    const minCandles = 200;
    if (mainKlines.length < minCandles) {
        return {
            trades: [], totalPnl: 0, winRate: 0, totalTrades: 0, wins: 0, losses: 0, breakEvens: 0, maxDrawdown: 0, profitFactor: 0, sharpeRatio: 0, averageTradeDuration: 'N/A'
        };
    }
    
    for (let i = minCandles; i < mainKlines.length; i++) {
        const entrySignalCandle = mainKlines[i-1]; // The main TF candle that just closed
        const historySlice = mainKlines.slice(0, i);

        // --- MANAGE OPEN POSITION using 1m klines up to the current main candle's close time ---
        if (openPosition) {
            const isLong = openPosition.direction === 'LONG';
            
            while (managementKlineIndex < managementKlines.length && managementKlines[managementKlineIndex].time <= entrySignalCandle.time) {
                const managementCandle = managementKlines[managementKlineIndex];
                
                // 1. Check for SL/TP hit
                let exitPrice = 0;
                let exitReason = '';
                if (isLong) {
                    if (managementCandle.high >= openPosition.takeProfitPrice) { exitPrice = openPosition.takeProfitPrice; exitReason = 'Take Profit Hit'; } 
                    else if (managementCandle.low <= openPosition.stopLossPrice) { exitPrice = openPosition.stopLossPrice; exitReason = 'Stop Loss Hit'; }
                } else { // SHORT
                    if (managementCandle.low <= openPosition.takeProfitPrice) { exitPrice = openPosition.takeProfitPrice; exitReason = 'Take Profit Hit'; } 
                    else if (managementCandle.high >= openPosition.stopLossPrice) { exitPrice = openPosition.stopLossPrice; exitReason = 'Stop Loss Hit'; }
                }

                if (exitPrice > 0) {
                    const pnl = (exitPrice - openPosition.entryPrice) * openPosition.size * (isLong ? 1 : -1);
                    equity += pnl;

                    trades.push({
                        id: trades.length + 1,
                        pair: openPosition.pair,
                        direction: openPosition.direction,
                        entryPrice: openPosition.entryPrice,
                        exitPrice: exitPrice,
                        entryTime: openPosition.entryTime,
                        exitTime: managementCandle.time,
                        size: openPosition.size,
                        investedAmount: config.investmentAmount,
                        pnl,
                        exitReason,
                        entryReason: openPosition.entryReason,
                    });
                    
                    if (config.isCooldownEnabled) {
                        const timeframeMs = mainKlines[1].time - mainKlines[0].time;
                        cooldownUntilTimestamp = managementCandle.time + (constants.BOT_COOLDOWN_CANDLES * timeframeMs);
                    } else {
                        // If cooldown is disabled, simulate a 5-second delay before re-evaluating
                        cooldownUntilTimestamp = managementCandle.time + 5000;
                    }
                    openPosition = null;
                    break; // Exit the management kline loop
                }

                // 2. Proactive management on each 1m candle close
                if (!config.isStopLossLocked || !config.isTakeProfitLocked) {
                    const tempPositionForSignal: Position = { ...openPosition, id: 0, botId: 'sim', orderId: null, entryTime: new Date(openPosition.entryTime) };
                    const mgmtHistorySlice = managementKlines.slice(0, managementKlineIndex + 1);
                    const mgmtSignal = await getTradeManagementSignal(tempPositionForSignal, mgmtHistorySlice, managementCandle.close, config);

                    if (mgmtSignal.newStopLoss && !config.isStopLossLocked) openPosition.stopLossPrice = mgmtSignal.newStopLoss;
                    if (mgmtSignal.newTakeProfit && !config.isTakeProfitLocked) openPosition.takeProfitPrice = mgmtSignal.newTakeProfit;
                }
                
                managementKlineIndex++;
            }
        } else {
            // If no position, just advance the management kline index
            while (managementKlineIndex < managementKlines.length && managementKlines[managementKlineIndex].time <= entrySignalCandle.time) {
                managementKlineIndex++;
            }
        }
        
        // --- CHECK FOR ENTRIES (if no position and not in cooldown) ---
        if (!openPosition && entrySignalCandle.time > cooldownUntilTimestamp) {
            const signal = await getTradingSignal(config.agent, historySlice, config.timeFrame, config.agentParams);
             
            if (signal.signal !== 'HOLD') {
                const entryPrice = mainKlines[i].open; 
                const isLong = signal.signal === 'BUY';

                if (config.investmentAmount > 0 && entryPrice > 0) {
                    const isFutures = config.mode === TradingMode.USDSM_Futures;
                    const positionValue = isFutures ? config.investmentAmount * config.leverage : config.investmentAmount;
                    const tradeSize = positionValue / entryPrice;

                    // --- TARGET CALCULATION (3-LAYER SYSTEM) ---
                    // LAYER 1: USER-DEFINED SL
                    let userStopLossPrice: number;
                    if (config.stopLossMode === RiskMode.Percent) {
                        const lossAmount = config.investmentAmount * (config.stopLossValue / 100);
                        userStopLossPrice = isLong ? entryPrice - (lossAmount / tradeSize) : entryPrice + (lossAmount / tradeSize);
                    } else { // Amount
                        userStopLossPrice = isLong ? entryPrice - (config.stopLossValue / tradeSize) : entryPrice + (config.stopLossValue / tradeSize);
                    }

                    // LAYER 2: AGENT'S SMART (ATR) SL
                    const agentTargets = getInitialAgentTargets(historySlice, entryPrice, isLong ? 'LONG' : 'SHORT', config.timeFrame, { ...constants.DEFAULT_AGENT_PARAMS, ...config.agentParams });
                    const agentStopLossPrice = agentTargets.stopLossPrice;
                    
                    // LAYER 3: HARD CAP SAFETY NET SL
                    const maxLossAmount = config.investmentAmount * (constants.MAX_STOP_LOSS_PERCENT_OF_INVESTMENT / 100);
                    const hardCapStopLossPrice = isLong ? entryPrice - (maxLossAmount / tradeSize) : entryPrice + (maxLossAmount / tradeSize);
                    
                    // Determine primary SL based on whether it's locked
                    const primaryStopLoss = config.isStopLossLocked ? userStopLossPrice : agentStopLossPrice;
                    
                    // FINAL STOP LOSS: The tightest (safest) of the primary SL and the hard cap.
                    let stopLossPrice: number;
                    if (isLong) {
                        stopLossPrice = Math.max(primaryStopLoss, hardCapStopLossPrice);
                    } else { // SHORT
                        stopLossPrice = Math.min(primaryStopLoss, hardCapStopLossPrice);
                    }
                    
                    // TAKE PROFIT
                    let takeProfitPrice: number;
                    if (config.isTakeProfitLocked) {
                        if (config.takeProfitMode === RiskMode.Percent) {
                            const profitAmount = config.investmentAmount * (config.takeProfitValue / 100);
                            takeProfitPrice = isLong ? entryPrice + (profitAmount / tradeSize) : entryPrice - (profitAmount / tradeSize);
                        } else { // Amount
                            takeProfitPrice = isLong ? entryPrice + (config.takeProfitValue / tradeSize) : entryPrice - (config.takeProfitValue / tradeSize);
                        }
                    } else {
                         // Maintain the agent's R:R, but adjusted for the final (potentially capped) stop loss
                        const finalRiskDistance = Math.abs(entryPrice - stopLossPrice);
                        const agentRiskDistance = Math.abs(entryPrice - agentTargets.stopLossPrice);
                        const agentProfitDistance = Math.abs(agentTargets.takeProfitPrice - entryPrice);
                        const riskRewardRatio = agentRiskDistance > 0 ? agentProfitDistance / agentRiskDistance : 1.5;
                        const finalProfitDistance = finalRiskDistance * riskRewardRatio;
                        takeProfitPrice = isLong ? entryPrice + finalProfitDistance : entryPrice - finalProfitDistance;
                    }
                    
                    if (tradeSize > 0) {
                        openPosition = {
                            pair: config.pair, mode: config.mode, executionMode: config.executionMode, direction: isLong ? 'LONG' : 'SHORT',
                            entryPrice, size: tradeSize, leverage: config.leverage, entryTime: entrySignalCandle.time,
                            entryReason: signal.reasons.join(' '), agentName: config.agent.name, takeProfitPrice,
                            stopLossPrice, pricePrecision: config.pricePrecision, timeFrame: config.timeFrame,
                        };
                    }
                }
            }
        }
        
        let currentPnl = 0;
        if(openPosition) {
            currentPnl = (entrySignalCandle.close - openPosition.entryPrice) * openPosition.size * (openPosition.direction === 'LONG' ? 1 : -1);
        }
        equityCurve.push(equity + currentPnl);
    }
    
    // Force close at the very end if still open
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

    // Sharpe Ratio Calculation
    const returns = trades.map(t => t.pnl / (t.investedAmount || startingCapital));
    const avgReturn = returns.length > 0 ? returns.reduce((sum, r) => sum + r, 0) / returns.length : 0;
    const stdDev = returns.length > 0 ? Math.sqrt(returns.map(r => Math.pow(r - avgReturn, 2)).reduce((sum, r) => sum + r, 0) / returns.length) : 0;
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

    const totalDurationMs = trades.reduce((sum, trade) => sum + (trade.exitTime - trade.entryTime), 0);
    const averageTradeDuration = totalTrades > 0 ? formatDuration(totalDurationMs / totalTrades) : 'N/A';

    return {
        trades: trades.sort((a,b) => b.exitTime - a.exitTime),
        totalPnl,
        winRate,
        totalTrades,
        wins,
        losses,
        breakEvens,
        maxDrawdown,
        profitFactor,
        sharpeRatio,
        averageTradeDuration,
    };
}