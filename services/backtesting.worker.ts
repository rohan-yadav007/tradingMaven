import { Kline, BotConfig, BacktestResult, SimulatedTrade, AgentParams, Position, RiskMode, TradingMode, OptimizationResultItem } from '../types';
import { getTradingSignal, getInitialAgentTargets, getAgentExitSignal } from './localAgentService';
import * as constants from '../constants';
import { ATR } from 'technicalindicators';

// --- Worker-local Helper Functions ---

const getLast = <T>(arr: T[] | undefined): T | undefined => arr && arr.length > 0 ? arr[arr.length - 1] : undefined;

interface SimulatedPosition extends Omit<Position, 'id' | 'entryTime' | 'botId' | 'orderId' | 'exitReason' | 'pnl' | 'exitTime' | 'activeStopLossReason' | 'isBreakevenSet' | 'proactiveLossCheckTriggered' | 'profitLockTier' | 'peakPrice'> {
    entryTime: number; 
    activeStopLossReason: 'Agent Logic' | 'Hard Cap' | 'Profit Secure' | 'Agent Trail' | 'Breakeven';
    isBreakevenSet: boolean;
    profitLockTier: number;
    peakPrice: number;
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

function validateTradeProfitability(
    entryPrice: number,
    stopLossPrice: number,
    takeProfitPrice: number,
    direction: 'LONG' | 'SHORT',
    config: BotConfig,
    klines: Kline[]
): { isValid: boolean, reason: string } {
    const riskDistance = Math.abs(entryPrice - stopLossPrice);
    const rewardDistance = Math.abs(takeProfitPrice - entryPrice);

    // 1. Minimum Volatility-Adjusted Risk Distance (NEW CHECK)
    const atrPeriod = constants.DEFAULT_AGENT_PARAMS.atrPeriod;
    if (klines.length > atrPeriod) {
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        const closes = klines.map(k => k.close);
        const currentAtr = (ATR.calculate({ high: highs, low: lows, close: closes, period: atrPeriod }).pop()) || 0;

        if (currentAtr > 0) {
            const minRiskDistance = currentAtr * constants.MIN_ATR_SL_BUFFER_MULTIPLIER;
            if (riskDistance < minRiskDistance) {
                return {
                    isValid: false,
                    reason: `❌ VETO: Stop loss is too tight for current volatility (Risk: ${riskDistance.toFixed(config.pricePrecision)} < Min Required: ${minRiskDistance.toFixed(config.pricePrecision)}).`
                };
            }
        }
    }

    // 2. Risk-to-Reward Check
    if (config.isMinRrEnabled) {
        if (riskDistance <= 0) {
            return { isValid: false, reason: '❌ VETO: Risk distance is zero.' };
        }
        const rrRatio = rewardDistance / riskDistance;
        if (rrRatio < constants.MIN_RISK_REWARD_RATIO) {
            return {
                isValid: false,
                reason: `❌ VETO: R:R Ratio of ${rrRatio.toFixed(2)}:1 is below the minimum of ${constants.MIN_RISK_REWARD_RATIO}:1.`
            };
        }
    }

    // 3. Fee-Awareness Check
    const positionValue = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
    const tradeSize = positionValue / entryPrice;
    if (tradeSize <= 0) return { isValid: true, reason: '' };
    const roundTripFee = positionValue * constants.TAKER_FEE_RATE * 2;
    const feeInPrice = roundTripFee / tradeSize;
    const minProfitDistance = feeInPrice * constants.MIN_PROFIT_BUFFER_MULTIPLIER;
    if (rewardDistance < minProfitDistance) {
        return {
            isValid: false,
            reason: `❌ VETO: Profit target is within the fee zone (Target: ${rewardDistance.toFixed(config.pricePrecision)}, Min Required: ${minProfitDistance.toFixed(config.pricePrecision)}).`
        };
    }
    return { isValid: true, reason: `✅ Profitability checks passed.` };
}

// --- Core Logic (Now accepts pre-fetched HTF klines) ---

async function runBacktest(
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

    if (klines.length < minCandles) {
        return calculateResults([], [], STARTING_CAPITAL);
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
        trades.push({
            id: trades.length + 1, pair: openPosition.pair, direction: openPosition.direction,
            entryPrice: openPosition.entryPrice, exitPrice, entryTime: openPosition.entryTime, exitTime,
            size: openPosition.size, investedAmount: config.investmentAmount, pnl: netPnl, exitReason,
            entryReason: openPosition.entryReason
        });
        openPosition = null;
        return true;
    };

    for (let i = minCandles; i < klines.length; i++) {
        const currentCandle = klines[i - 1];
        const historySlice = klines.slice(0, i);
        let hasTradedInThisCandle = false;

        if (openPosition) {
            const isLong = openPosition.direction === 'LONG';
            
            // Update peak price
            if (isLong) {
                openPosition.peakPrice = Math.max(openPosition.peakPrice, currentCandle.high);
            } else {
                openPosition.peakPrice = Math.min(openPosition.peakPrice, currentCandle.low);
            }

            // Universal Profit Trail Logic
            if (config.isUniversalProfitTrailEnabled) {
                const positionValue = openPosition.entryPrice * openPosition.size;
                const roundTripFee = positionValue * constants.TAKER_FEE_RATE * 2;
                const feeInPrice = roundTripFee > 0 ? (roundTripFee / openPosition.size) : 0;
                
                if (feeInPrice > 0) {
                     const highProfitInPrice = (currentCandle.high - openPosition.entryPrice) * (isLong ? 1 : -1);
                     const lowProfitInPrice = (currentCandle.low - openPosition.entryPrice) * (isLong ? 1 : -1);
                     const peakProfitInCandle = Math.max(highProfitInPrice, lowProfitInPrice);

                    if (peakProfitInCandle > 0) {
                        // 1. Breakeven check
                        if (!openPosition.isBreakevenSet && peakProfitInCandle > feeInPrice) {
                             const breakevenStop = openPosition.entryPrice + (feeInPrice * (isLong ? 1 : -1));
                             if ((isLong && breakevenStop > openPosition.stopLossPrice) || (!isLong && breakevenStop < openPosition.stopLossPrice)) {
                                 openPosition.stopLossPrice = breakevenStop;
                                 openPosition.activeStopLossReason = 'Breakeven';
                                 openPosition.isBreakevenSet = true;
                                 openPosition.profitLockTier = 1;
                             }
                        }

                        // --- NEW DYNAMIC (N)x -> (N-1)x LOGIC ---
                        const peakFeeMultiple = peakProfitInCandle / feeInPrice;

                        if (peakFeeMultiple >= 2) {
                            const triggerFeeMultiple = Math.floor(peakFeeMultiple); // This is our 'N'
                            const lockFeeMultiple = triggerFeeMultiple - 1; // This is 'N-1'
    
                            // Only trigger if we've reached a new integer multiple, and it's higher than the current tier
                            if (triggerFeeMultiple > openPosition.profitLockTier) {
                                const newStop = openPosition.entryPrice + (feeInPrice * lockFeeMultiple * (isLong ? 1 : -1));
                                
                                // Ratchet Check
                                if ((isLong && newStop > openPosition.stopLossPrice) || (!isLong && newStop < openPosition.stopLossPrice)) {
                                    openPosition.stopLossPrice = newStop;
                                    openPosition.activeStopLossReason = 'Profit Secure';
                                    openPosition.profitLockTier = triggerFeeMultiple;
                                    openPosition.isBreakevenSet = true;
                                }
                            }
                        }
                    }
                }
            }
            
            const stopReason = openPosition.activeStopLossReason.includes('Trail') || openPosition.activeStopLossReason.includes('Secure') || openPosition.activeStopLossReason === 'Breakeven' ? 'Trailing Stop Hit' : 'Stop Loss Hit';
            if (isLong) {
                if (currentCandle.low <= openPosition.stopLossPrice) hasTradedInThisCandle = closePosition(openPosition.stopLossPrice, stopReason, currentCandle.time);
                else if (currentCandle.high >= openPosition.takeProfitPrice) hasTradedInThisCandle = closePosition(openPosition.takeProfitPrice, 'Take Profit Hit', currentCandle.time);
            } else {
                if (currentCandle.high >= openPosition.stopLossPrice) hasTradedInThisCandle = closePosition(openPosition.stopLossPrice, stopReason, currentCandle.time);
                else if (currentCandle.low <= openPosition.takeProfitPrice) hasTradedInThisCandle = closePosition(openPosition.takeProfitPrice, 'Take Profit Hit', currentCandle.time);
            }

            if (openPosition) {
                const tempPos: Position = { ...openPosition, id: 0, botId: 'sim', orderId: null, entryTime: new Date(openPosition.entryTime), proactiveLossCheckTriggered: false };
                 if (config.agent.id === 13) {
                     // Simplified Chameleon logic for backtesting (candle-based ATR trail)
                     const finalParams = { ...constants.DEFAULT_AGENT_PARAMS, ...config.agentParams };
                     const { ch_atrPeriod, ch_volatilityMultiplier } = finalParams;
                     if (historySlice.length > ch_atrPeriod && ch_volatilityMultiplier) {
                         const atr = getLast(ATR.calculate({ high: historySlice.map(k => k.high), low: historySlice.map(k => k.low), close: historySlice.map(k => k.close), period: ch_atrPeriod }))!;
                         const atrStopOffset = atr * ch_volatilityMultiplier;
                         const newStop = isLong ? openPosition.peakPrice - atrStopOffset : openPosition.peakPrice + atrStopOffset;
                         if ((isLong && newStop > openPosition.stopLossPrice) || (!isLong && newStop < openPosition.stopLossPrice)) {
                             openPosition.stopLossPrice = newStop;
                             openPosition.activeStopLossReason = 'Agent Trail';
                         }
                     }
                } else if (!config.isUniversalProfitTrailEnabled) {
                     const slSignal = getAgentExitSignal(tempPos, historySlice, currentCandle.close, config);
                     if (slSignal.closePosition) {
                         hasTradedInThisCandle = closePosition(currentCandle.close, `Agent Exit: ${slSignal.reasons.join(' ')}`, currentCandle.time);
                     } else if (slSignal.newStopLoss) {
                         if ((isLong && slSignal.newStopLoss > openPosition.stopLossPrice) || (!isLong && slSignal.newStopLoss < openPosition.stopLossPrice)) {
                             openPosition.stopLossPrice = slSignal.newStopLoss; openPosition.activeStopLossReason = 'Agent Trail';
                         }
                     }
                }
                if (openPosition && config.isTrailingTakeProfitEnabled) {
                    const isInProfit = isLong ? currentCandle.close > openPosition.entryPrice : currentCandle.close < openPosition.entryPrice;
                    if (isInProfit) {
                        const targets = getInitialAgentTargets(historySlice, currentCandle.close, isLong ? 'LONG' : 'SHORT', config.timeFrame, { ...constants.DEFAULT_AGENT_PARAMS, ...config.agentParams }, config.agent.id);
                        if ((isLong && targets.takeProfitPrice > openPosition.takeProfitPrice) || (!isLong && targets.takeProfitPrice < openPosition.takeProfitPrice)) {
                            openPosition.takeProfitPrice = targets.takeProfitPrice;
                        }
                    }
                }
            }
        }
        
        if (!openPosition && !hasTradedInThisCandle) {
            const htfHistorySlice = allHtfKlines ? allHtfKlines.filter(k => k.time <= currentCandle.time) : undefined;
            const signal = await getTradingSignal(config.agent, historySlice, config, htfHistorySlice);
            if (signal.signal !== 'HOLD') {
                const entryPrice = klines[i].open;
                const isLong = signal.signal === 'BUY';
                if (config.investmentAmount > 0 && entryPrice > 0) {
                    const agentTargets = getInitialAgentTargets(historySlice, entryPrice, isLong ? 'LONG' : 'SHORT', config.timeFrame, { ...constants.DEFAULT_AGENT_PARAMS, ...config.agentParams }, config.agent.id);
                    let { stopLossPrice, takeProfitPrice } = agentTargets;
                    let slReason: 'Agent Logic' | 'Hard Cap' = 'Agent Logic';
                    if (config.isTakeProfitLocked) {
                        const posVal = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
                        const size = posVal / entryPrice;
                        if(config.takeProfitMode === RiskMode.Percent) {
                            const pnl = config.investmentAmount * (config.takeProfitValue / 100);
                            takeProfitPrice = isLong ? entryPrice + (pnl / size) : entryPrice - (pnl / size);
                        } else {
                            takeProfitPrice = isLong ? entryPrice + (config.takeProfitValue / size) : entryPrice - (config.takeProfitValue / size);
                        }
                    }
                    const posValForCap = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
                    const sizeForCap = posValForCap / entryPrice;
                    if (sizeForCap > 0) {
                        // Corrected Logic: Max loss is based on investment (margin), not notional.
                        const maxLossOnMargin = config.investmentAmount * (constants.MAX_STOP_LOSS_PERCENT_OF_INVESTMENT / 100);
                        const hardCapSl = isLong ? entryPrice - (maxLossOnMargin / sizeForCap) : entryPrice + (maxLossOnMargin / sizeForCap);
                        const tighterSl = isLong ? Math.max(stopLossPrice, hardCapSl) : Math.min(stopLossPrice, hardCapSl);
                        if (tighterSl !== stopLossPrice) slReason = 'Hard Cap';
                        stopLossPrice = tighterSl;
                    }
                    if (!validateTradeProfitability(entryPrice, stopLossPrice, takeProfitPrice, isLong ? 'LONG' : 'SHORT', config, historySlice).isValid) continue;
                    const posVal = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
                    const size = posVal / entryPrice;
                    if (size > 0) {
                        openPosition = {
                            pair: config.pair, mode: config.mode, executionMode: config.executionMode, direction: isLong ? 'LONG' : 'SHORT',
                            entryPrice, size, leverage: config.leverage, entryTime: currentCandle.time,
                            entryReason: signal.reasons.join(' '), agentName: config.agent.name, takeProfitPrice,
                            stopLossPrice, initialStopLossPrice: agentTargets.stopLossPrice, initialTakeProfitPrice: takeProfitPrice,
                            pricePrecision: config.pricePrecision, timeFrame: config.timeFrame, marginType: config.marginType,
                            activeStopLossReason: slReason,
                            isBreakevenSet: false,
                            profitLockTier: 0,
                            peakPrice: entryPrice,
                        };
                    }
                }
            }
        }
        let currentPnl = openPosition ? (currentCandle.close - openPosition.entryPrice) * openPosition.size * (openPosition.direction === 'LONG' ? 1 : -1) : 0;
        equityCurve.push(equity + currentPnl);
    }
    if (openPosition) closePosition(klines[klines.length - 1].close, 'End of backtest', klines[klines.length - 1].time);
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
        case 9: paramRanges = { qsc_adxThreshold: [22, 25, 28], qsc_fastEmaPeriod: [9, 12], qsc_slowEmaPeriod: [21, 25], qsc_stochRsiOversold: [20, 30], qsc_psarStep: [0.02, 0.03] }; break;
        case 11: paramRanges = { he_trendSmaPeriod: [20, 30, 40], he_fastEmaPeriod: [7, 9, 12], he_slowEmaPeriod: [20, 25], he_rsiPeriod: [10, 14], he_rsiMidline: [48, 50, 52] }; break;
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
    return results.filter(item => item.result.totalTrades > 0).sort((a, b) => b.result.profitFactor - a.result.profitFactor || b.result.totalPnl - a.result.totalPnl);
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