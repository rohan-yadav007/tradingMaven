


import { Kline, BotConfig, BacktestResult, SimulatedTrade, AgentParams, Position, OptimizationResultItem, RiskMode } from '../types';
import { getTradingSignal, getTradeManagementSignal } from './localAgentService';
import { BOT_COOLDOWN_CANDLES } from '../constants';

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

// High-fidelity backtesting engine that mirrors the live bot's tick-based logic
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
    
    // Create a map for quick lookups of main timeframe candles
    const mainKlineMap = new Map<number, Kline>();
    mainKlines.forEach(k => mainKlineMap.set(k.time, k));

    // This tracks the index of the *last closed* main timeframe candle
    let currentMainKlineIndex = -1;
    
    for (let i = 0; i < managementKlines.length; i++) {
        const mgmtKline = managementKlines[i];

        // --- 1. CHECK FOR EXITS (highest priority) ---
        if (openPosition) {
            const { direction, takeProfitPrice, stopLossPrice } = openPosition;
            const isLong = direction === 'LONG';
            let exitReason = '';
            let exitPrice = 0;

            // Check for intra-candle SL/TP hit
            if (isLong) {
                if (mgmtKline.high >= takeProfitPrice) { exitPrice = takeProfitPrice; exitReason = 'Take Profit Hit'; } 
                else if (mgmtKline.low <= stopLossPrice) { exitPrice = stopLossPrice; exitReason = 'Stop Loss Hit'; }
            } else { // SHORT
                if (mgmtKline.low <= takeProfitPrice) { exitPrice = takeProfitPrice; exitReason = 'Take Profit Hit'; } 
                else if (mgmtKline.high >= stopLossPrice) { exitPrice = stopLossPrice; exitReason = 'Stop Loss Hit'; }
            }
            
            // Force close at the very end of the simulation if still open
            if (i === managementKlines.length - 1 && exitPrice === 0) {
                exitPrice = mgmtKline.close;
                exitReason = 'End of backtest';
            }

            if (exitPrice > 0) {
                const pnl = (exitPrice - openPosition.entryPrice) * openPosition.size * (isLong ? 1 : -1) * openPosition.leverage;
                equity += pnl;

                trades.push({
                    id: trades.length + 1,
                    pair: openPosition.pair,
                    direction: openPosition.direction,
                    entryPrice: openPosition.entryPrice,
                    exitPrice: exitPrice,
                    entryTime: openPosition.entryTime,
                    exitTime: mgmtKline.time,
                    size: openPosition.size,
                    investedAmount: openPosition.entryPrice * openPosition.size,
                    pnl,
                    exitReason,
                    entryReason: openPosition.entryReason,
                });
                
                // Set cooldown based on the timestamp of the 1m candle where the exit occurred
                const timeframeMs = mainKlines[1].time - mainKlines[0].time;
                cooldownUntilTimestamp = mgmtKline.time + (BOT_COOLDOWN_CANDLES * timeframeMs);
                
                openPosition = null;
            }
        }
        
        // --- 2. CHECK FOR PROACTIVE MANAGEMENT ---
        if (openPosition) {
             const tempPositionForSignal: Position = {
                ...openPosition,
                id: trades.length + 1,
                botId: 'backtest-sim',
                orderId: null,
                entryTime: new Date(openPosition.entryTime),
             };
             // Simulate using the current 1m kline data available up to this point
             const mgmtSignal = await getTradeManagementSignal(tempPositionForSignal, managementKlines.slice(0, i + 1), mgmtKline.close);
             if (mgmtSignal.newStopLoss && !config.isStopLossLocked) {
                openPosition.stopLossPrice = mgmtSignal.newStopLoss;
             }
             if (mgmtSignal.newTakeProfit && !config.isTakeProfitLocked) {
                openPosition.takeProfitPrice = mgmtSignal.newTakeProfit;
             }
        }
        
        // --- 3. CHECK FOR ENTRIES (on every tick/1m candle) ---
        
        // Update the current main kline index if this 1m candle corresponds to the close of a main candle
        if (mainKlineMap.has(mgmtKline.time)) {
             currentMainKlineIndex = mainKlines.findIndex(k => k.time === mgmtKline.time);
        }

        if (!openPosition && currentMainKlineIndex >= 199 && mgmtKline.time > cooldownUntilTimestamp) {
             // We have enough data and are not in cooldown, let's analyze
             const relevantMainKlines = mainKlines.slice(0, currentMainKlineIndex + 1);
             const signal = await getTradingSignal(config.agent, relevantMainKlines, config.timeFrame, config.agentParams);
             
            if (signal.signal !== 'HOLD') {
                // Assume entry on the next tick, which we simulate as the next 1m candle's open price
                const entryPrice = managementKlines[i + 1]?.open ?? mgmtKline.close; 
                if (!entryPrice) continue; // Cannot enter if we are at the last candle

                const isLong = signal.signal === 'BUY';

                if (config.investmentAmount > 0 && entryPrice > 0) {
                    const tradeSize = config.investmentAmount / entryPrice;

                    let stopLossPrice: number;
                    if (config.stopLossMode === RiskMode.Percent) {
                        const slAmount = config.investmentAmount * (config.stopLossValue / 100);
                        const priceChange = slAmount / tradeSize;
                        stopLossPrice = isLong ? entryPrice - priceChange : entryPrice + priceChange;
                    } else { // Amount
                        const priceChange = config.stopLossValue / tradeSize;
                        stopLossPrice = isLong ? entryPrice - priceChange : entryPrice + priceChange;
                    }

                    let takeProfitPrice: number;
                    if (config.takeProfitMode === RiskMode.Percent) {
                        const tpAmount = config.investmentAmount * (config.takeProfitValue / 100);
                        const priceChange = tpAmount / tradeSize;
                        takeProfitPrice = isLong ? entryPrice + priceChange : entryPrice - priceChange;
                    } else { // Amount
                        const priceChange = config.takeProfitValue / tradeSize;
                        takeProfitPrice = isLong ? entryPrice + priceChange : entryPrice - priceChange;
                    }
                    
                    if (tradeSize > 0) {
                         openPosition = {
                            pair: config.pair,
                            mode: config.mode,
                            executionMode: config.executionMode,
                            direction: isLong ? 'LONG' : 'SHORT',
                            entryPrice,
                            size: tradeSize,
                            leverage: config.leverage,
                            entryTime: mgmtKline.time,
                            entryReason: signal.reasons.join(' '),
                            agentName: config.agent.name,
                            takeProfitPrice,
                            stopLossPrice,
                            pricePrecision: 2, // Assuming 2 for backtest display
                            timeFrame: config.timeFrame,
                        };
                    }
                }
             }
        }
        
        // Update equity curve at the end of each 1-minute candle
        let currentPnl = 0;
        if(openPosition) {
            currentPnl = (mgmtKline.close - openPosition.entryPrice) * openPosition.size * (openPosition.direction === 'LONG' ? 1 : -1) * openPosition.leverage;
        }
        equityCurve.push(equity + currentPnl);
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


// --- Parameter Optimization Engine ---

type ParamRange = { start: number; end: number; step: number; };

const AGENT_LOGIC_OPTIMIZATION_CONFIG: Record<number, Partial<Record<keyof AgentParams, ParamRange>>> = {
    1: { // Momentum Master
        adxTrendThreshold: { start: 20, end: 30, step: 2 },
        mom_rsiThresholdBullish: { start: 55, end: 65, step: 2 },
        mom_rsiThresholdBearish: { start: 35, end: 45, step: 2 },
        mom_emaFastPeriod: { start: 10, end: 30, step: 5 },
        mom_emaSlowPeriod: { start: 40, end: 60, step: 5 },
    },
    2: { // Volatility Voyager
        vol_bbPeriod: { start: 18, end: 22, step: 2 },
        vol_bbStdDev: { start: 1.8, end: 2.5, step: 0.1 },
        vol_stochRsiUpperThreshold: { start: 65, end: 75, step: 5 },
        vol_stochRsiLowerThreshold: { start: 25, end: 35, step: 5 },
    },
    3: { // Trend Surfer
        trend_adxThreshold: { start: 18, end: 25, step: 2 },
        psarStep: { start: 0.015, end: 0.025, step: 0.005 },
        psarMax: { start: 0.15, end: 0.25, step: 0.05 },
    },
    4: { // Scalping Expert
        scalp_superTrendPeriod: { start: 8, end: 12, step: 2 },
        scalp_superTrendMultiplier: { start: 2.5, end: 3.5, step: 0.5 },
        scalp_scoreThreshold: { start: 12, end: 18, step: 2 },
    },
    5: { // Smart Agent
        smart_superTrendMultiplier: { start: 2.5, end: 4, step: 0.5 },
        smart_confidenceThreshold: { start: 0.6, end: 0.85, step: 0.05 },
        smart_rsiBuyThreshold: { start: 55, end: 65, step: 5 },
        smart_rsiSellThreshold: { start: 35, end: 45, step: 5 },
    },
    6: { // Profit Locker (same as Smart Agent)
        smart_superTrendMultiplier: { start: 2.5, end: 4, step: 0.5 },
        smart_confidenceThreshold: { start: 0.6, end: 0.85, step: 0.05 },
    },
    7: { // Market Structure Maven
        msm_htfEmaPeriod: { start: 150, end: 300, step: 50 },
        msm_swingPointLookback: { start: 3, end: 7, step: 1 },
    },
    8: { // Institutional Scalper
        inst_lookbackPeriod: { start: 3, end: 10, step: 1 },
        inst_powerCandleMultiplier: { start: 1.2, end: 2.0, step: 0.2 },
    },
};

// Risk management is now user-defined, so we don't optimize it.
const RISK_OPTIMIZATION_CONFIG: Partial<Record<keyof AgentParams, ParamRange>> = {};


export function runOptimization(
    mainKlines: Kline[],
    managementKlines: Kline[],
    baseConfig: BotConfig,
    onProgress: (progress: { percent: number; result: OptimizationResultItem | null }) => void
): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const agentId = baseConfig.agent.id;
            const agentLogicParams = AGENT_LOGIC_OPTIMIZATION_CONFIG[agentId] || {};
            
            const paramRanges = { ...agentLogicParams, ...RISK_OPTIMIZATION_CONFIG };
            const paramKeys = Object.keys(paramRanges) as (keyof AgentParams)[];

            if (paramKeys.length === 0) {
                console.log(`No optimizable parameters for agent "${baseConfig.agent.name}". Running single backtest as fallback.`);
                runBacktest(mainKlines, managementKlines, baseConfig).then(result => {
                    onProgress({ percent: 100, result: { params: baseConfig.agentParams || {}, result } });
                    resolve();
                }).catch(reject);
                return;
            }

            const generateCombinations = (index: number, currentParams: AgentParams): AgentParams[] => {
                if (index === paramKeys.length) return [currentParams];
                const key = paramKeys[index];
                const range = paramRanges[key]!;
                const combinations: AgentParams[] = [];
                for (let value = range.start; value <= range.end; value += range.step) {
                    const precision = (range.step.toString().split('.')[1] || '').length;
                    const nextParams = { ...currentParams, [key]: Number(value.toFixed(precision)) };
                    combinations.push(...generateCombinations(index + 1, nextParams));
                }
                return combinations;
            };

            const initialParams = { ...(baseConfig.agentParams || {}) };
            
            const paramCombinations = generateCombinations(0, initialParams);
            const totalCombinations = paramCombinations.length;

            if (totalCombinations === 0) {
                onProgress({ percent: 100, result: null });
                return resolve();
            }

            let i = 0;
            const processChunk = async () => {
                try {
                    const params = paramCombinations[i];
                    if (!params) return;

                    const testConfig = { ...baseConfig, agentParams: params };
                    const result = await runBacktest(mainKlines, managementKlines, testConfig);
                    const optimizationResult = { params, result };
                    
                    const percent = Math.round(((i + 1) / totalCombinations) * 100);
                    onProgress({ percent, result: optimizationResult });

                    i++;
                    if (i < totalCombinations) {
                        setTimeout(processChunk, 0);
                    } else {
                        resolve();
                    }
                } catch(e) {
                    reject(e);
                }
            };

            processChunk();
        } catch (e) {
            reject(e);
        }
    });
}