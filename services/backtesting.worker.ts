


import { Kline, BotConfig, BacktestResult, Trade, AgentParams, Position, RiskMode, TradingMode, OptimizationResultItem } from '../types';
import { getTradingSignal, getInitialAgentTargets, getAgentExitSignal, getMultiStageProfitSecureSignal, validateTradeProfitability, getSupervisorSignal, getMandatoryBreakevenSignal, getProfitSpikeSignal, getAggressiveRangeTrailSignal, captureMarketContext, getAdaptiveTakeProfit } from './localAgentService';
import * as constants from '../constants';
import { getDynamicEntryVeto } from './vetoService';

// --- Worker-local Helper Functions ---

const getLast = <T>(arr: T[] | undefined): T | undefined => arr && arr.length > 0 ? arr[arr.length - 1] : undefined;

const getTimeframeDuration = (timeframe: string): number => {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(-1, 1), 10);
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

function calculateResults(trades: Trade[], equityCurve: number[], startingCapital: number): BacktestResult {
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
    const totalDurationMs = trades.reduce((acc, trade) => acc + (new Date(trade.exitTime).getTime() - new Date(trade.entryTime).getTime()), 0);
    const averageTradeDuration = formatDuration(totalTrades > 0 ? totalDurationMs / totalTrades : 0);
    const returns = trades.map(t => t.pnl / t.investmentAmount);
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
    const trades: Trade[] = [];
    const equityCurve: number[] = [];
    const STARTING_CAPITAL = 10000;
    let equity = STARTING_CAPITAL;
    const minCandles = 200;

    const targetTimeframeKlines = aggregateKlines(klines, config.timeFrame);

    if (targetTimeframeKlines.length < minCandles) {
        return calculateResults([], [], STARTING_CAPITAL);
    }

    const closePosition = (exitPrice: number, exitReason: string, exitTime: number, klinesForContext: Kline[], htfKlinesForContext?: Kline[]): boolean => {
        if (!openPosition) return false;
        const isLong = openPosition.direction === 'LONG';
        const grossPnl = (exitPrice - openPosition.entryPrice) * openPosition.size * (isLong ? 1 : -1);
        const entryValue = openPosition.entryPrice * openPosition.size;
        const exitValue = exitPrice * openPosition.size;
        const fees = (entryValue + exitValue) * openPosition.takerFeeRate;
        const netPnl = grossPnl - fees;
        equity += netPnl;

        // MFE/MAE calculation
        const mfePrice = openPosition.peakPrice ?? openPosition.entryPrice;
        const maePrice = openPosition.troughPrice ?? openPosition.entryPrice;
        const mfe = Math.abs(mfePrice - openPosition.entryPrice) * openPosition.size;
        const mae = Math.abs(maePrice - openPosition.entryPrice) * openPosition.size;
        
        const exitContext = captureMarketContext(klinesForContext, htfKlinesForContext);

        const finalTrade: Trade = {
            ...openPosition,
            id: trades.length + 1, // Override the ID to be sequential for the backtest
            exitPrice,
            exitTime: new Date(exitTime).toISOString(),
            pnl: netPnl,
            exitReason,
            mfe,
            mae,
            exitContext,
        };
        
        trades.push(finalTrade);
        openPosition = null;

        return true;
    };

    for (let i = minCandles; i < targetTimeframeKlines.length; i++) {
        const historySlice = targetTimeframeKlines.slice(0, i + 1);
        const currentCandle = targetTimeframeKlines[i]; // This is the candle we are simulating
        const htfHistorySlice = allHtfKlines ? allHtfKlines.filter(k => k.time <= currentCandle.time) : undefined;
        let hasTradedInThisCandle = false;

        // --- MANAGE OPEN POSITION ---
        if (openPosition) {
            const isLong = openPosition.direction === 'LONG';
            let positionState: SimulatedPosition = { ...openPosition };
            
            // 1. Check for Adaptive TP update based on the state BEFORE this candle
            const adaptiveTpSignal = getAdaptiveTakeProfit(positionState, historySlice.slice(0, -1), currentCandle.open);
            if (adaptiveTpSignal.newTakeProfit) {
                const newTp = adaptiveTpSignal.newTakeProfit;
                const isTighter = isLong ? newTp < positionState.takeProfitPrice : newTp > positionState.takeProfitPrice;
                if (isTighter) {
                    positionState.takeProfitPrice = newTp;
                }
            }

            // 2. Update trailing stops based on the candle's open price
            const candleOpenPrice = currentCandle.open;
            const stopCandidates: { price: number; reason: Position['activeStopLossReason']; newState?: Partial<Position> }[] = [
                { price: positionState.stopLossPrice, reason: positionState.activeStopLossReason }
            ];
             if (config.invalidationSensitivity !== 'low') {
                const spikeSignal = getProfitSpikeSignal(positionState, candleOpenPrice);
                if (spikeSignal.newStopLoss) stopCandidates.push({ price: spikeSignal.newStopLoss, reason: 'Profit Secure', newState: spikeSignal.newState });
            }
             const aggressiveTrailSignal = getAggressiveRangeTrailSignal(positionState, candleOpenPrice);
            if (aggressiveTrailSignal.newStopLoss) stopCandidates.push({ price: aggressiveTrailSignal.newStopLoss, reason: 'Profit Secure', newState: aggressiveTrailSignal.newState });

            if (config.isBreakevenTrailEnabled) {
                const breakevenSignal = getMandatoryBreakevenSignal(positionState, candleOpenPrice);
                if (breakevenSignal.newStopLoss) stopCandidates.push({ price: breakevenSignal.newStopLoss, reason: 'Breakeven', newState: breakevenSignal.newState });
            }
            if (config.isUniversalProfitTrailEnabled) {
                const profitSecureSignal = getMultiStageProfitSecureSignal(positionState, candleOpenPrice);
                if (profitSecureSignal.newStopLoss) stopCandidates.push({ price: profitSecureSignal.newStopLoss, reason: 'Profit Secure', newState: profitSecureSignal.newState });
            }
            if (config.isAgentTrailEnabled) {
                const agentTrailSignal = getAgentExitSignal(positionState, historySlice.slice(0, -1), candleOpenPrice, config);
                if (agentTrailSignal.newStopLoss) {
                    stopCandidates.push({ price: agentTrailSignal.newStopLoss, reason: 'Agent Trail', newState: agentTrailSignal.newState });
                }
            }

            let bestCandidate = stopCandidates[0];
            for (const candidate of stopCandidates) {
                const isValid = isLong ? candidate.price < candleOpenPrice : candidate.price > candleOpenPrice;
                const isTighter = isLong ? candidate.price > bestCandidate.price : candidate.price < bestCandidate.price;
                if (isValid && isTighter) bestCandidate = candidate;
            }
            if (bestCandidate.price !== positionState.stopLossPrice) {
                if (bestCandidate.newState) positionState = { ...positionState, ...(bestCandidate.newState as Partial<Position>) };
                positionState.stopLossPrice = bestCandidate.price;
                positionState.activeStopLossReason = bestCandidate.reason;
            }
            openPosition = positionState;
            
            // 3. Simulate candle's price path (low -> high or high -> low)
            const stopReason = openPosition.activeStopLossReason.includes('Trail') || openPosition.activeStopLossReason.includes('Secure') || openPosition.activeStopLossReason === 'Breakeven' ? 'Trailing Stop Hit' : 'Stop Loss Hit';
            
            const pricePath = isLong 
                ? [currentCandle.low, currentCandle.high]
                : [currentCandle.high, currentCandle.low];

            for (const pricePoint of pricePath) {
                if (!openPosition) break;
                if (isLong) {
                    if (pricePoint <= openPosition.stopLossPrice) { hasTradedInThisCandle = closePosition(openPosition.stopLossPrice, stopReason, currentCandle.time, historySlice, htfHistorySlice); break; }
                    if (pricePoint >= openPosition.takeProfitPrice) { hasTradedInThisCandle = closePosition(openPosition.takeProfitPrice, 'Take Profit Hit', currentCandle.time, historySlice, htfHistorySlice); break; }
                } else {
                    if (pricePoint >= openPosition.stopLossPrice) { hasTradedInThisCandle = closePosition(openPosition.stopLossPrice, stopReason, currentCandle.time, historySlice, htfHistorySlice); break; }
                    if (pricePoint <= openPosition.takeProfitPrice) { hasTradedInThisCandle = closePosition(openPosition.takeProfitPrice, 'Take Profit Hit', currentCandle.time, historySlice, htfHistorySlice); break; }
                }
            }
            if (hasTradedInThisCandle) { equityCurve.push(equity); continue; }
            
            // 4. Update position state at candle close
            openPosition.candlesSinceEntry!++;
            if (isLong) {
                openPosition.peakPrice = Math.max(openPosition.peakPrice!, currentCandle.high);
                openPosition.troughPrice = Math.min(openPosition.troughPrice!, currentCandle.low);
            } else {
                openPosition.peakPrice = Math.min(openPosition.peakPrice!, currentCandle.low);
                openPosition.troughPrice = Math.max(openPosition.troughPrice!, currentCandle.high);
            }

            const { score, reasons } = await getSupervisorSignal(openPosition, historySlice, config, htfHistorySlice);
            openPosition.invalidationScore = score;
            
            const sensitivityThreshold = { low: 80, medium: 65, high: 50 }[config.invalidationSensitivity];

            if (score >= sensitivityThreshold) {
                const reason = `Supervisor Exit: Thesis Invalidated (Score: ${score}).`;
                hasTradedInThisCandle = closePosition(currentCandle.close, reason, currentCandle.time, historySlice, htfHistorySlice);
                if (hasTradedInThisCandle) {
                    equityCurve.push(equity);
                    continue;
                }
            }
        }
        
        // --- CHECK FOR NEW ENTRY ---
        if (!openPosition && !hasTradedInThisCandle) {
            const signal = await getTradingSignal(config.agent, historySlice, config, htfHistorySlice);
            
            if (signal.signal !== 'HOLD') {
                const entryPrice = currentCandle.close;
                
                // --- SIMULATE DYNAMIC ENTRY VETO ---
                if (config.isMomentumConcordanceEnabled) {
                    const oneMinKlinesIndex = klines.findIndex(k => k.time >= currentCandle.time);
                    if (oneMinKlinesIndex !== -1) {
                        const microKlinesSlice = klines.slice(Math.max(0, oneMinKlinesIndex - 20), oneMinKlinesIndex + 1);
                        const vetoCheck = await getDynamicEntryVeto(historySlice, entryPrice, signal.signal, config, microKlinesSlice);
                        if (vetoCheck.veto) {
                            equityCurve.push(equity);
                            continue; // Vetoed, skip to next candle
                        }
                    }
                }
                // --- END VETO SIMULATION ---

                const isLong = signal.signal === 'BUY';
                const { stopLossPrice, takeProfitPrice, slReason, agentStopLoss } = getInitialAgentTargets(historySlice, entryPrice, isLong ? 'LONG' : 'SHORT', config);
                
                if (validateTradeProfitability(entryPrice, stopLossPrice, takeProfitPrice, isLong ? 'LONG' : 'SHORT', config).isValid) {
                    const posVal = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
                    const size = posVal / entryPrice;

                    if (config.isInitialRiskVetoEnabled) {
                        const initialRiskInDollars = Math.abs(entryPrice - agentStopLoss) * size;
                        const maxAllowedRiskInDollars = config.investmentAmount * (config.maxMarginLossPercent / 100);
                        if (initialRiskInDollars > maxAllowedRiskInDollars) {
                            equityCurve.push(equity);
                            continue;
                        }
                    }

                    if (size > 0) {
                        const risk = Math.abs(entryPrice - agentStopLoss);
                        const reward = Math.abs(takeProfitPrice - entryPrice);
                        const initialRiskRewardRatio = risk > 0 ? reward / risk : 0;
                        const botConfigSnapshot = {
                            isHtfConfirmationEnabled: config.isHtfConfirmationEnabled,
                            isUniversalProfitTrailEnabled: config.isUniversalProfitTrailEnabled,
                            isMinRrEnabled: config.isMinRrEnabled,
                            invalidationSensitivity: config.invalidationSensitivity,
                            isAgentTrailEnabled: config.isAgentTrailEnabled,
                            isBreakevenTrailEnabled: config.isBreakevenTrailEnabled,
                            isMarketCohesionEnabled: config.isMarketCohesionEnabled,
                            isVwapConfirmationEnabled: config.isVwapConfirmationEnabled,
                            isBtcConfirmationEnabled: config.isBtcConfirmationEnabled,
                            btcConfirmationThreshold: config.btcConfirmationThreshold,
                            isVolumeFilterEnabled: config.isVolumeFilterEnabled,
                            isAdxFilterEnabled: config.isAdxFilterEnabled,
                            isExhaustionFilterEnabled: config.isExhaustionFilterEnabled,
                            isSmcVetoEnabled: config.isSmcVetoEnabled,
                            isSrAnalysisEnabled: config.isSrAnalysisEnabled,
                            isCandlestickConfirmationEnabled: config.isCandlestickConfirmationEnabled,
                            isMarketStructureVetoEnabled: config.isMarketStructureVetoEnabled,
                            htfTimeFrame: config.htfTimeFrame,
                            entryTiming: config.entryTiming,
                            isAdaptiveTpEnabled: config.isAdaptiveTpEnabled,
                            aggressiveTrailMode: config.aggressiveTrailMode,
                            isInitialRiskVetoEnabled: config.isInitialRiskVetoEnabled,
                            isMarketBreadthFilterEnabled: config.isMarketBreadthFilterEnabled,
                            isLiquidationFilterEnabled: config.isLiquidationFilterEnabled,
                            isConfirmationCandleEnabled: config.isConfirmationCandleEnabled,
// FIX: Property 'isMomentumConcordanceEnabled' is missing in type '{ isHtfConfirmationEnabled: boolean; isUniversalProfitTrailEnabled: boolean; isMinRrEnabled: boolean; invalidationSensitivity: "low" | "medium" | "high"; isAgentTrailEnabled: boolean; ... 13 more ...; isInitialRiskVetoEnabled: boolean; }' but required in type 'BotConfigSnapshot'.
                            isMomentumConcordanceEnabled: config.isMomentumConcordanceEnabled,
                        };
                        const entryContext = captureMarketContext(historySlice, htfHistorySlice);

                        openPosition = {
                            id: currentCandle.time,
                            orderId: null,
                            botId: 'backtest',
                            pair: config.pair, mode: config.mode, executionMode: 'paper', direction: isLong ? 'LONG' : 'SHORT',
                            entryPrice, size, investmentAmount: config.investmentAmount, leverage: config.leverage, entryTime: new Date(currentCandle.time).toISOString(),
                            entryReason: signal.reasons.join(' '), agentName: config.agent.name, takeProfitPrice: takeProfitPrice,
                            stopLossPrice, initialStopLossPrice: agentStopLoss, initialTakeProfitPrice: takeProfitPrice,
                            pricePrecision: config.pricePrecision, timeFrame: config.timeFrame, marginType: config.marginType,
                            initialStopLossReason: slReason,
                            activeStopLossReason: slReason, isBreakevenSet: false, profitLockTier: 0,
                            profitSpikeTier: 0, aggressiveTrailTier: 0,
                            peakPrice: entryPrice, troughPrice: entryPrice, proactiveLossCheckTriggered: false, candlesSinceEntry: 0,
                            hasBeenProfitable: false, takerFeeRate: config.takerFeeRate,
                            initialRiskInPrice: Math.abs(entryPrice - agentStopLoss),
                            initialRiskRewardRatio,
                            agentParamsSnapshot: config.agentParams,
                            botConfigSnapshot,
                            entryContext
                        };
                    }
                }
            }
        }
        
        let currentPnl = openPosition ? (currentCandle.close - openPosition.entryPrice) * openPosition.size * (openPosition.direction === 'LONG' ? 1 : -1) : 0;
        equityCurve.push(equity + currentPnl);
    }
    
    if (openPosition) {
        closePosition(targetTimeframeKlines[targetTimeframeKlines.length - 1].close, 'End of backtest', targetTimeframeKlines[targetTimeframeKlines.length - 1].time, targetTimeframeKlines, allHtfKlines);
    }
    
    return calculateResults(trades, equityCurve, STARTING_CAPITAL);
}

async function runOptimization(
    klines: Kline[],
    baseConfig: BotConfig,
    onProgress: (progress: { percent: number; combinations: number }) => void,
    htfKlines?: Kline[]
): Promise<OptimizationResultItem[]> {
    const agentId = baseConfig.agent.id;
    let paramRanges: Record<string, number[]> = {};

    // Define parameter ranges for optimization based on the selected agent
    if (agentId === 9) { // Quantum Scalper
        paramRanges = {
            qsc_adxThreshold: [20, 25, 30],
            qsc_stochRsiOversold: [20, 25, 30],
            qsc_stochRsiOverbought: [70, 75, 80],
            qsc_trendScoreThreshold: [70, 75, 80],
        };
    } else if (agentId === 11) { // Historic Expert
        paramRanges = {
            he_trendSmaPeriod: [30, 40, 50],
            he_fastEmaPeriod: [9, 12],
            he_slowEmaPeriod: [21, 26],
        };
    } else if (agentId === 13) { // The Chameleon
        paramRanges = {
            ch_adxThreshold: [20, 22, 25],
            ch_fastEmaPeriod: [9, 12],
            ch_slowEmaPeriod: [21, 26],
        };
    } else if (agentId === 14) { // The Sentinel
        paramRanges = {
            sentinel_scoreThreshold: [65, 70, 75, 80]
        };
    }

    const combinations = generateParamCombinations(paramRanges);
    const results: OptimizationResultItem[] = [];
    let completed = 0;

    for (const params of combinations) {
        const configWithParams: BotConfig = {
            ...baseConfig,
            agentParams: { ...baseConfig.agentParams, ...params },
        };
        const result = await runBacktest(klines, configWithParams, htfKlines);
        
        // Only include results with positive PNL and a reasonable number of trades
        if (result.totalPnl > 0 && result.totalTrades > 2) {
            results.push({ params, result });
        }
        
        completed++;
        onProgress({ percent: (completed / combinations.length) * 100, combinations: combinations.length });
    }

    results.sort((a, b) => {
        // Sort by a combination of PNL and Sharpe Ratio for more robust results
        const scoreA = a.result.totalPnl * (a.result.sharpeRatio || 0.1);
        const scoreB = b.result.totalPnl * (b.result.sharpeRatio || 0.1);
        return scoreB - scoreA;
    });

    return results.slice(0, 20); // Return top 20 best results
}

self.onmessage = async (event: MessageEvent) => {
    const { type, id, payload } = event.data;

    const onProgress = (progress: any) => {
        self.postMessage({ type: 'progress', id, progress });
    };

    try {
        if (type === 'runBacktest') {
            const result = await runBacktest(payload.klines, payload.config, payload.htfKlines);
            self.postMessage({ type: 'result', id, payload: result });
        } else if (type === 'runOptimization') {
            const result = await runOptimization(payload.klines, payload.config, onProgress, payload.htfKlines);
            self.postMessage({ type: 'result', id, payload: result });
        }
    } catch (e: any) {
        self.postMessage({ type: 'error', id, error: e.message });
    }
};
