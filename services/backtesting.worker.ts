// services/backtesting.worker.ts



import { Kline, BotConfig, BacktestResult, Trade, AgentParams, Position, TradingMode, OptimizationResultItem } from '../types';
import { getTradingSignal, getInitialAgentTargets, getAgentExitSignal, getMultiStageProfitSecureSignal, validateTradeProfitability, getTradeGuardianSignal, getMandatoryBreakevenSignal, getProfitSpikeSignal, getAggressiveRangeTrailSignal, captureMarketContext, getAdaptiveTakeProfit } from './localAgentService';
import * as constants from '../constants';
import * as binanceService from './binanceService';

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
    if (timeframeMs <= 60000) return klines; // Source is 1m, no aggregation needed for 1m.

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
                isFinal: true, // In aggregation, we assume they are final until proven otherwise
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

function generateParamCombinations(ranges: Record<string, (number | boolean | string)[]>): AgentParams[] {
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
    allMicroKlines: Kline[],
    config: BotConfig,
    allHtfKlines?: Kline[],
    allEthBtcKlines?: Kline[],
): Promise<BacktestResult> {
    
    // --- Initialization ---
    let openPosition: SimulatedPosition | null = null;
    const trades: Trade[] = [];
    const equityCurve: number[] = [];
    const STARTING_CAPITAL = 10000;
    let equity = STARTING_CAPITAL;
    const minMainCandles = 200;
    
    const mainTimeframeMs = getTimeframeDuration(config.timeFrame);
    
    const mainTimeframeKlines: Kline[] = [];
    let currentAggKline: Kline | null = null;

    const closePosition = (exitPrice: number, exitReason: string, exitTime: number, klinesForContext: Kline[], htfKlinesForContext?: Kline[]): void => {
        if (!openPosition) return;
        const isLong = openPosition.direction === 'LONG';
        const grossPnl = (exitPrice - openPosition.entryPrice) * openPosition.size * (isLong ? 1 : -1);
        const entryValue = openPosition.entryPrice * openPosition.size;
        const exitValue = exitPrice * openPosition.size;
        const fees = (entryValue + exitValue) * openPosition.takerFeeRate;
        const netPnl = grossPnl - fees;
        equity += netPnl;
        const mfePrice = openPosition.peakPrice ?? openPosition.entryPrice;
        const maePrice = openPosition.troughPrice ?? openPosition.entryPrice;
        const mfe = Math.abs(mfePrice - openPosition.entryPrice) * openPosition.size;
        const mae = Math.abs(maePrice - openPosition.entryPrice) * openPosition.size;
        const exitContext = captureMarketContext(klinesForContext, htfKlinesForContext);

        const finalTrade: Trade = {
            ...openPosition,
            id: trades.length + 1,
            exitPrice,
            exitTime: new Date(exitTime).toISOString(),
            pnl: netPnl,
            exitReason,
            mfe,
            mae,
            exitContext,
            hasBeenProfitable: netPnl > 0,
        };
        trades.push(finalTrade);
        openPosition = null;
    };

    // --- Main Simulation Loop ---
    for (let i = 1; i < allMicroKlines.length; i++) {
        const microKline = allMicroKlines[i];
        const currentPrice = microKline.close;
        const currentTime = microKline.time;

        // --- PHASE 1: CANDLE & STATE AGGREGATION ---
        const timeframeStart = Math.floor(microKline.time / mainTimeframeMs) * mainTimeframeMs;
        let isNewMainCandle = false;

        if (!currentAggKline || timeframeStart !== currentAggKline.time) {
            if (currentAggKline) {
                mainTimeframeKlines.push({ ...currentAggKline, isFinal: true });
                if (mainTimeframeKlines.length > minMainCandles + 50) { 
                    mainTimeframeKlines.shift();
                }
            }
            isNewMainCandle = true;
            currentAggKline = {
                time: timeframeStart, open: microKline.open, high: microKline.high, low: microKline.low,
                close: microKline.close, volume: microKline.volume || 0, isFinal: false,
            };
        } else {
            currentAggKline.high = Math.max(currentAggKline.high, microKline.high);
            currentAggKline.low = Math.min(currentAggKline.low, microKline.low); // CRITICAL FIX: Was 'kline.low' which is undefined.
            currentAggKline.close = microKline.close;
            currentAggKline.volume = (currentAggKline.volume || 0) + (microKline.volume || 0);
        }
        
        const currentMainTimeframeView = [...mainTimeframeKlines, currentAggKline];
        if (currentMainTimeframeView.length < minMainCandles) {
            equityCurve.push(equity);
            continue; // Not enough history yet
        }

        const htfHistorySlice = allHtfKlines ? allHtfKlines.filter(k => k.time <= currentTime) : undefined;
        const ethBtcHistorySlice = allEthBtcKlines ? allEthBtcKlines.filter(k => k.time <= currentTime) : undefined;

        // --- PHASE 2: POSITION MANAGEMENT ---
        if (openPosition) {
            const isLong = openPosition.direction === 'LONG';
            
            // 2a. Check for immediate SL/TP hit on the 1-minute candle's range
            let exitReason: string | null = null;
            let exitPrice: number | null = null;

            if (isLong) {
                if (microKline.low <= openPosition.stopLossPrice) { exitPrice = openPosition.stopLossPrice; exitReason = 'Stop Loss Hit'; }
                else if (microKline.high >= openPosition.takeProfitPrice) { exitPrice = openPosition.takeProfitPrice; exitReason = 'Take Profit Hit'; }
            } else { // SHORT
                if (microKline.high >= openPosition.stopLossPrice) { exitPrice = openPosition.stopLossPrice; exitReason = 'Stop Loss Hit'; }
                else if (microKline.low <= openPosition.takeProfitPrice) { exitPrice = openPosition.takeProfitPrice; exitReason = 'Take Profit Hit'; }
            }
            
            if (exitReason && exitPrice !== null) {
                if(exitReason === 'Stop Loss Hit' && (openPosition.activeStopLossReason.includes('Trail') || openPosition.activeStopLossReason.includes('Secure') || openPosition.activeStopLossReason === 'Breakeven')) {
                    exitReason = 'Trailing Stop Hit';
                }
                closePosition(exitPrice, exitReason, currentTime, currentMainTimeframeView, htfHistorySlice);
            } else {
                 // 2b. If not closed, run on-tick trailing and state management logic
                let positionState = { ...openPosition };
                positionState.peakPrice = isLong ? Math.max(positionState.peakPrice, currentPrice) : Math.min(positionState.peakPrice, currentPrice);
                positionState.troughPrice = isLong ? Math.min(positionState.troughPrice, currentPrice) : Math.max(positionState.troughPrice, currentPrice);
                if(isNewMainCandle) { positionState.candlesSinceEntry++; }

                // Gather all potential new stop losses from various trailing mechanisms
                const stopCandidates: { price: number; reason: Position['activeStopLossReason']; newState?: Partial<Position> }[] = [ { price: positionState.stopLossPrice, reason: positionState.activeStopLossReason } ];
                
                if (config.invalidationSensitivity !== 'low') { const spikeSignal = getProfitSpikeSignal(positionState, currentPrice); if (spikeSignal.newStopLoss) stopCandidates.push({ price: spikeSignal.newStopLoss, reason: 'Profit Secure', newState: spikeSignal.newState }); }
                const aggressiveTrailSignal = getAggressiveRangeTrailSignal(positionState, currentPrice); if (aggressiveTrailSignal.newStopLoss) stopCandidates.push({ price: aggressiveTrailSignal.newStopLoss, reason: 'Profit Secure', newState: aggressiveTrailSignal.newState });
                if (config.isBreakevenTrailEnabled) { const breakevenSignal = getMandatoryBreakevenSignal(positionState, currentPrice); if (breakevenSignal.newStopLoss) stopCandidates.push({ price: breakevenSignal.newStopLoss, reason: 'Breakeven', newState: breakevenSignal.newState }); }
                if (config.isUniversalProfitTrailEnabled) { const profitSecureSignal = getMultiStageProfitSecureSignal(positionState, currentPrice); if (profitSecureSignal.newStopLoss) stopCandidates.push({ price: profitSecureSignal.newStopLoss, reason: 'Profit Secure', newState: profitSecureSignal.newState }); }
                if (config.isAgentTrailEnabled) { const agentTrailSignal = getAgentExitSignal(positionState, currentMainTimeframeView, currentPrice, config); if (agentTrailSignal.newStopLoss) stopCandidates.push({ price: agentTrailSignal.newStopLoss, reason: 'Agent Trail', newState: agentTrailSignal.newState }); }
                
                // Determine the best (tightest valid) stop loss from all candidates
                let bestCandidate = stopCandidates[0];
                for (const candidate of stopCandidates) {
                    const isValid = isLong ? candidate.price < currentPrice : candidate.price > currentPrice;
                    const isTighter = isLong ? candidate.price > bestCandidate.price : candidate.price < bestCandidate.price;
                    if (isValid && isTighter) bestCandidate = candidate;
                }

                // Apply the new state if it has changed
                if (bestCandidate.price !== positionState.stopLossPrice) {
                    if (bestCandidate.newState) positionState = { ...positionState, ...(bestCandidate.newState as Partial<Position>) };
                    positionState.stopLossPrice = bestCandidate.price;
                    positionState.activeStopLossReason = bestCandidate.reason;
                }
                openPosition = positionState;
            }
        }

        // --- PHASE 3: ENTRY LOGIC ---
        if (!openPosition) {
            const shouldCheckForEntry = (config.entryTiming === 'immediate') || (config.entryTiming === 'onNextCandle' && isNewMainCandle);

            if (shouldCheckForEntry) {
                const microTimeframe = constants.getMicroTimeframe(config.timeFrame);
                let ltfKlines: Kline[] | undefined;
                 if (config.isMomentumConcordanceEnabled || config.agent.id === 14) {
                    ltfKlines = aggregateKlines(allMicroKlines.slice(0, i + 1), microTimeframe);
                }

                const signal = await getTradingSignal(config.agent, currentMainTimeframeView, config, htfHistorySlice, allMicroKlines.slice(0, i + 1), ltfKlines, ethBtcHistorySlice, currentPrice);
                
                if (signal.signal !== 'HOLD') {
                    const isLong = signal.signal === 'BUY';
                    const { stopLossPrice, takeProfitPrice, slReason, agentStopLoss } = getInitialAgentTargets(currentMainTimeframeView, currentPrice, isLong ? 'LONG' : 'SHORT', config);
                    
                    if (validateTradeProfitability(currentPrice, agentStopLoss, takeProfitPrice, isLong ? 'LONG' : 'SHORT', config).isValid) {
                        const posVal = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
                        const size = posVal / currentPrice;

                        const initialRiskInDollars = Math.abs(currentPrice - agentStopLoss) * size;
                        const maxAllowedRiskInDollars = config.investmentAmount * (config.maxMarginLossPercent / 100);

                        if (!config.isInitialRiskVetoEnabled || initialRiskInDollars <= maxAllowedRiskInDollars) {
                             const risk = Math.abs(currentPrice - agentStopLoss);
                             const reward = Math.abs(takeProfitPrice - currentPrice);
                             const initialRiskRewardRatio = risk > 0 ? reward / risk : 0;
                             const entryContext = captureMarketContext(currentMainTimeframeView, htfHistorySlice);

                            openPosition = {
                                id: currentTime, botId: 'backtest', orderId: null, pair: config.pair, mode: config.mode,
                                executionMode: 'paper', direction: isLong ? 'LONG' : 'SHORT', entryPrice: currentPrice,
                                size, investmentAmount: config.investmentAmount, leverage: config.leverage,
                                entryTime: new Date(currentTime).toISOString(), entryReason: signal.reasons.join(' '),
                                agentName: config.agent.name, takeProfitPrice, stopLossPrice,
                                initialTakeProfitPrice: takeProfitPrice, initialStopLossPrice: agentStopLoss,
                                pricePrecision: config.pricePrecision, timeFrame: config.timeFrame, marginType: config.marginType,
                                initialStopLossReason: slReason, activeStopLossReason: slReason, isBreakevenSet: false,
                                profitLockTier: 0, profitSpikeTier: 0, aggressiveTrailTier: 0, peakPrice: currentPrice,
                                troughPrice: currentPrice, proactiveLossCheckTriggered: false, candlesSinceEntry: 0,
                                hasBeenProfitable: false, takerFeeRate: config.takerFeeRate,
                                initialRiskInPrice: Math.abs(currentPrice - agentStopLoss),
                                initialRiskRewardRatio, agentParamsSnapshot: config.agentParams,
                                botConfigSnapshot: {
                                    isHtfConfirmationEnabled: config.isHtfConfirmationEnabled,
                                    isUniversalProfitTrailEnabled: config.isUniversalProfitTrailEnabled,
                                    isMinRrEnabled: config.isMinRrEnabled,
                                    invalidationSensitivity: config.invalidationSensitivity,
                                    isAgentTrailEnabled: config.isAgentTrailEnabled,
                                    isBreakevenTrailEnabled: config.isBreakevenTrailEnabled,
                                    isMarketCohesionEnabled: config.isMarketCohesionEnabled,
                                    isVwapConfirmationEnabled: config.isVwapConfirmationEnabled,
                                    isBtcConfirmationEnabled: config.isBtcConfirmationEnabled,
                                    isBtcCorrelationVetoEnabled: config.isBtcCorrelationVetoEnabled,
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
                                    isMomentumConcordanceEnabled: config.isMomentumConcordanceEnabled,
                                    finalEntryFailSafe: config.finalEntryFailSafe,
                                }, entryContext, entryAtr: entryContext.atr14,
                            };
                        }
                    }
                }
            }
        }
        
        // --- 4. Update Equity Curve ---
        let currentPnl = openPosition ? (currentPrice - openPosition.entryPrice) * openPosition.size * (openPosition.direction === 'LONG' ? 1 : -1) : 0;
        equityCurve.push(equity + currentPnl);
    }
    
    // --- 5. Finalize ---
    if (openPosition) {
        const lastKline = getLast(allMicroKlines)!;
        const lastHistory = [...mainTimeframeKlines, currentAggKline!];
        const lastHtfHistory = allHtfKlines ? allHtfKlines.filter(k => k.time <= lastKline.time) : undefined;
        closePosition(lastKline.close, 'End of backtest', lastKline.time, lastHistory, lastHtfHistory);
    }
    
    return calculateResults(trades, equityCurve, STARTING_CAPITAL);
}


async function runOptimization(
    klines: Kline[],
    baseConfig: BotConfig,
    onProgress: (progress: { percent: number; combinations: number }) => void,
    htfKlines?: Kline[],
    ethBtcKlines?: Kline[]
): Promise<OptimizationResultItem[]> {
    const agentId = baseConfig.agent.id;
    let paramRanges: Record<string, (number | boolean | string)[]> = {};

    if (agentId === 9) { // Quantum Scalper
        paramRanges = {
            qsc_adxThreshold: [22, 25, 28],
            qsc_trendScoreThreshold: [70, 75, 80],
            qsc_entryMode: ['breakout', 'pullback'],
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
            sentinel_entryThreshold: [70, 78, 85],
            sentinel_swingLookback: [5, 8, 12],
            sentinel_structureWeight: [40, 50, 60],
            sentinel_momentumWeight: [25, 30, 35],
            sentinel_contextWeight: [15, 20, 25]
        };
    } else if (agentId === 17) { // Momentum Swing Trader
        paramRanges = {
            mst_emaFastPeriod: [40, 50, 60],
            mst_emaSlowPeriod: [150, 200, 250],
        };
    } else if (agentId === 18) { // The Conductor
         paramRanges = {
            conductor_convictionThreshold: [65, 75, 85],
            conductor_swingLookback: [5, 8, 12],
            conductor_structureWeight: [30, 40, 50],
            conductor_momentumWeight: [20, 30, 40],
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
        const result = await runBacktest(klines, configWithParams, htfKlines, ethBtcKlines);
        
        if (result.totalPnl > 0 && result.totalTrades > 2) {
            results.push({ params, result });
        }
        
        completed++;
        onProgress({ percent: (completed / combinations.length) * 100, combinations: combinations.length });
    }

    results.sort((a, b) => {
        const scoreA = a.result.totalPnl * (a.result.sharpeRatio || 0.1);
        const scoreB = b.result.totalPnl * (b.result.sharpeRatio || 0.1);
        return scoreB - scoreA;
    });

    return results.slice(0, 20);
}

self.onmessage = async (event: MessageEvent) => {
    const { type, id, payload } = event.data;

    const onProgress = (progress: any) => {
        self.postMessage({ type: 'progress', id, progress });
    };

    try {
        if (type === 'runBacktest' || type === 'runOptimization') {
            let allEthBtcKlines: Kline[] | undefined;
            if (payload.config.isBtcCorrelationVetoEnabled) {
                const startTime = payload.klines[0].time;
                const endTime = payload.klines[payload.klines.length - 1].time;
                allEthBtcKlines = await binanceService.fetchFullKlines('ETHBTC', '1m', startTime, endTime, TradingMode.Spot);
            }

            if (type === 'runBacktest') {
                const result = await runBacktest(payload.klines, payload.config, payload.htfKlines, allEthBtcKlines);
                self.postMessage({ type: 'result', id, payload: result });
            } else { // runOptimization
                const result = await runOptimization(payload.klines, payload.config, onProgress, payload.htfKlines, allEthBtcKlines);
                self.postMessage({ type: 'result', id, payload: result });
            }
        }
    } catch (e: any) {
        self.postMessage({ type: 'error', id, error: e.message });
    }
};