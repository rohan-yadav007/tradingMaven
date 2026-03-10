
// services/backtesting.worker.ts

import { Kline, BotConfig, BacktestResult, AgentParams, Position, Agent, TradeSignal, OrderBookAnalysis, BitcoinState, OpenInterestKline, LongShortRatio, Trade, SetupTypeStats } from '../types';
import { getInitialAgentTargets, getAgentExitSignal, getMultiStageProfitSecureSignal, validateTradeProfitability, getTradeGuardianSignal, getMandatoryBreakevenSignal, getProfitSpikeSignal, getAggressiveRangeTrailSignal, getTPProportionalLockSignal } from './riskManagementService';
import { ATR } from 'technicalindicators';
import { getQuantumScalperSignal } from './agents/quantumScalper';
import { getHistoricExpertSignal } from './agents/historicExpert';
import { getChameleonSignal } from './agents/chameleon';
import { getTheSentinelSignal } from './agents/sentinel';
import { getIchimokuTrendRiderSignal } from './agents/ichimokuTrendRider';
import { getMomentumSwingTraderSignal } from './agents/momentumSwingTrader';
import { getTheConductorSignal } from './agents/conductor';
import { getAstraXSignal } from './agents/astrax';
import { getSupertrendFlipperSignal } from './agents/supertrendFlipper';
import { getPivotPointSupertrendSignal } from './agents/pivotPointSupertrend';
import { getMatrixStrategistSignal } from './agents/matrixStrategist';
import { getOmegaSignal, SovereignManagementEngine } from './agents/omega';
import { getApexSignal, ApexManagementEngine } from './agents/apex';
import { UniversalSignalModel } from './trainingService';
import { applyTimeframeSettings, captureMarketContext, analyzeBitcoinState } from './agents/agentUtils';

// --- Worker-local Helper Functions ---

const getLast = <T>(arr: T[] | undefined): T | undefined => arr && arr.length > 0 ? arr[arr.length - 1] : undefined;

function getTimeframeMs(tf: string): number {
    const unit = tf.slice(-1);
    const value = parseInt(tf.slice(0, -1), 10);
    switch (unit) {
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return 60 * 1000;
    }
}

async function runFullAnalysisInWorker(
    agent: Agent,
    klines: Kline[],
    originalConfig: BotConfig,
    htfKlines?: Kline[],
    immediateKlines?: Kline[],
    ltfKlines?: Kline[],
    ethBtcKlines?: Kline[],
    livePrice?: number,
    astraXKlinesMap?: Map<string, Kline[]>,
    btcKlines?: Kline[],
    orderBookAnalysis?: OrderBookAnalysis,
    openInterestHistory?: OpenInterestKline[],
    lsRatioHistory?: LongShortRatio[],
    timestamp?: number,
    universalModel?: UniversalSignalModel | null,
    fundingRate?: number | null
): Promise<TradeSignal> {
    const config = applyTimeframeSettings(originalConfig);
    const params = config.agentParams as Required<AgentParams>;

    const htfContext = htfKlines && htfKlines.length > 0 ? captureMarketContext([], htfKlines, params, config.timeFrame) : undefined;
    
    // Derived Bitcoin State for Gravity Engines (Omega & AstraX)
    const btcState: BitcoinState = btcKlines ? analyzeBitcoinState(btcKlines) : { 
        state: 'NEUTRAL', 
        trend: 'neutral', 
        momentum: 'neutral', 
        rejection: 'none', 
        reason: 'BTC context unavailable' 
    };

    let agentSignal: TradeSignal;

    if (agent.id === 26) {
        let map = astraXKlinesMap || new Map<string, Kline[]>();
        if (!map.has(config.timeFrame)) map.set(config.timeFrame, klines);
        agentSignal = await getApexSignal(config, map, btcState, openInterestHistory, lsRatioHistory, timestamp, universalModel, fundingRate);
    } else if (agent.id === 25) {
        let map = astraXKlinesMap || new Map<string, Kline[]>();
        if (!map.has(config.timeFrame)) map.set(config.timeFrame, klines);
        agentSignal = await getOmegaSignal(config, map, btcState, openInterestHistory, lsRatioHistory, timestamp, universalModel);
    } else if (agent.id === 19) {
        let map = astraXKlinesMap || new Map<string, Kline[]>();
        if (!map.has(config.timeFrame)) map.set(config.timeFrame, klines);
        agentSignal = await getAstraXSignal(config, map, immediateKlines, livePrice, undefined, ltfKlines, btcKlines, orderBookAnalysis, ethBtcKlines);
    } else if (agent.id === 22) {
        agentSignal = getMatrixStrategistSignal(klines, config, astraXKlinesMap);
    } else {
        switch (agent.id) {
            case 9: agentSignal = getQuantumScalperSignal(klines, config, htfContext); break;
            case 11: agentSignal = getHistoricExpertSignal(klines, config, htfContext); break; 
            case 13: agentSignal = getChameleonSignal(klines, config, htfContext); break;
            case 14: agentSignal = getTheSentinelSignal(klines, config, htfContext); break;
            case 16: agentSignal = getIchimokuTrendRiderSignal(klines, config, htfContext); break;
            case 17: agentSignal = getMomentumSwingTraderSignal(klines, config, htfContext); break;
            case 18: agentSignal = getTheConductorSignal(klines, config, htfContext, ltfKlines); break;
            case 20: agentSignal = getSupertrendFlipperSignal(klines, config); break;
            case 21: agentSignal = getPivotPointSupertrendSignal(klines, config); break;
            default: agentSignal = { signal: 'HOLD', reasons: ['Unknown Agent'] };
        }
    }

    return agentSignal;
}

// --- Backtesting Loop with MTF & Sentiment Support ---

async function runBacktestInWorker(
    klines: Kline[],
    config: BotConfig,
    htfKlines?: Kline[],
    matrixMap?: Map<string, Kline[]>,
    openInterestHistory?: OpenInterestKline[],
    lsRatioHistory?: LongShortRatio[],
    universalModel?: UniversalSignalModel | null,
    onProgress?: (percent: number) => void
): Promise<BacktestResult> {
    const trades: Trade[] = [];
    let position: Position | null = null;
    let balance = config.investmentAmount; // Not simulating compound growth in this version
    let wins = 0, losses = 0;
    
    // Sort all input arrays by time to ensure synchronization
    const sortedKlines = [...klines].sort((a, b) => a.time - b.time);
    const sortedHtf = htfKlines ? [...htfKlines].sort((a, b) => a.time - b.time) : undefined;
    const sortedOi = openInterestHistory ? [...openInterestHistory].sort((a, b) => a.timestamp - b.timestamp) : undefined;
    const sortedLs = lsRatioHistory ? [...lsRatioHistory].sort((a, b) => a.timestamp - b.timestamp) : undefined;
    
    // Prepare Matrix Map cursors if needed
    const matrixData: { [key: string]: Kline[] } = {};
    if (matrixMap) {
        matrixMap.forEach((data, tf) => {
            matrixData[tf] = [...data].sort((a, b) => a.time - b.time);
        });
    }

    // For Omega: extract BTC 1h klines from matrixMap if the pair is not BTCUSDT
    const isBtcPair = config.pair.replace('/', '').toUpperCase() === 'BTCUSDT';
    const btcMatrixData = (!isBtcPair && matrixData['1h']) ? matrixData['1h'] : undefined;

    const minCandles = 200;
    if (sortedKlines.length < minCandles) return { trades: [], totalPnl: 0, winRate: 0, totalTrades: 0, wins: 0, losses: 0, breakEvens: 0, maxDrawdown: 0, profitFactor: 0, sharpeRatio: 0, averageTradeDuration: '0s' };

    // TF-aligned evaluation: only call the agent signal at configured TF candle boundaries.
    // This mirrors live trading — a 5m agent only fires once per 5m close, not every 1m tick.
    // Prevents consecutive re-entries when the same BOS/sweep condition persists across multiple 1m candles.
    const tfMs = getTimeframeMs(config.timeFrame);
    let lastEvalTfIndex = -1;
    const totalIterations = sortedKlines.length - minCandles;

    for (let i = minCandles; i < sortedKlines.length; i++) {
        const currentKline = sortedKlines[i];
        const currentTime = currentKline.time;
        const currentPrice = currentKline.close;

        // Report progress every 500 candles
        if (onProgress && i % 500 === 0) {
            onProgress(Math.round(((i - minCandles) / totalIterations) * 100));
        }

        // 1. Synchronize Data for this timestep
        const klinesSlice = sortedKlines.slice(0, i + 1);
        
        const htfSlice = sortedHtf ? sortedHtf.filter(k => k.time <= currentTime) : undefined;
        // Filter OI/LS data available *up to* this candle time
        const oiSlice = sortedOi ? sortedOi.filter(d => d.timestamp <= currentTime) : undefined;
        const lsSlice = sortedLs ? sortedLs.filter(d => d.timestamp <= currentTime) : undefined;
        
        let currentMatrixMap: Map<string, Kline[]> | undefined = undefined;
        if (matrixMap) {
            currentMatrixMap = new Map();
            Object.keys(matrixData).forEach(tf => {
                const availableData = matrixData[tf].filter(k => k.time <= currentTime);
                if (availableData.length > 0) currentMatrixMap!.set(tf, availableData);
            });
        }

        // 2. Manage Open Position
        if (position) {
            position.candlesSinceEntry++;
            
            // Emulate Tick Updates (High/Low checks within the candle)
            const isLong = position.direction === 'LONG';
            
            // Check Stop Loss / Take Profit on Wick
            const hitTp = isLong ? currentKline.high >= position.takeProfitPrice : currentKline.low <= position.takeProfitPrice;
            const hitSl = isLong ? currentKline.low <= position.stopLossPrice : currentKline.high >= position.stopLossPrice;
            
            let exitPrice = 0;
            let exitReason = '';
            let closed = false;

            if (hitTp && hitSl) {
                // Ambiguous case in 1m candle (both hit), assume Stop Loss usually
                exitPrice = position.stopLossPrice;
                exitReason = `Stop Loss (Wick Volatility)`;
                closed = true;
            } else if (hitTp) {
                exitPrice = position.takeProfitPrice;
                exitReason = 'Take Profit';
                closed = true;
            } else if (hitSl) {
                exitPrice = position.stopLossPrice;
                exitReason = `Stop Loss (${position.activeStopLossReason})`;
                closed = true;
            } else {
                // Dynamic Management Logic (Sovereign Engine / Guardian)
                let mgmtSignal: any;
                if (position.agentId === 26) {
                    mgmtSignal = ApexManagementEngine.manage(position, currentPrice, klinesSlice, currentMatrixMap);
                    if (mgmtSignal.action === 'close') {
                        exitPrice = currentPrice;
                        exitReason = mgmtSignal.reasons[0];
                        closed = true;
                    } else {
                        if (mgmtSignal.newStopLoss && ((isLong && mgmtSignal.newStopLoss > position.stopLossPrice) || (!isLong && mgmtSignal.newStopLoss < position.stopLossPrice))) {
                            position.stopLossPrice = mgmtSignal.newStopLoss;
                            position.activeStopLossReason = mgmtSignal.activeStopLossReason || position.activeStopLossReason;
                        }
                        if (mgmtSignal.newState) Object.assign(position, mgmtSignal.newState);
                    }
                } else if (position.agentId === 25) {
                    mgmtSignal = SovereignManagementEngine.manage(position, currentPrice, klinesSlice, currentMatrixMap);
                    if (mgmtSignal.action === 'close') {
                        exitPrice = currentPrice;
                        exitReason = mgmtSignal.reasons[0];
                        closed = true;
                    } else {
                        if (mgmtSignal.newStopLoss && ((isLong && mgmtSignal.newStopLoss > position.stopLossPrice) || (!isLong && mgmtSignal.newStopLoss < position.stopLossPrice))) {
                            position.stopLossPrice = mgmtSignal.newStopLoss;
                            position.activeStopLossReason = mgmtSignal.activeStopLossReason || position.activeStopLossReason;
                        }
                        if (mgmtSignal.newState) Object.assign(position, mgmtSignal.newState);
                    }
                } else {
                    const guardian = getTradeGuardianSignal(position, klinesSlice, undefined, currentPrice, undefined);
                    if (guardian.action === 'close') {
                        exitPrice = currentPrice;
                        exitReason = guardian.reason || 'Trade Guardian';
                        closed = true;
                    } else {
                        const profitSig = position.takeProfitPrice
                            ? getTPProportionalLockSignal(position, currentPrice)
                            : (() => {
                                const ag = getAggressiveRangeTrailSignal(position, currentPrice);
                                if (ag.newStopLoss) return ag;
                                const sec = getMultiStageProfitSecureSignal(position, currentPrice);
                                if (sec.newStopLoss) return sec;
                                return getMandatoryBreakevenSignal(position, currentPrice);
                            })();

                        const strategies = [
                            getProfitSpikeSignal(position, currentPrice),
                            profitSig,
                            getAgentExitSignal(position, klinesSlice, currentPrice, config)
                        ];

                        for (const sig of strategies) {
                            if (sig.newStopLoss && ((isLong && sig.newStopLoss > position.stopLossPrice) || (!isLong && sig.newStopLoss < position.stopLossPrice))) {
                                position.stopLossPrice = sig.newStopLoss;
                                position.activeStopLossReason = sig.activeStopLossReason || position.activeStopLossReason;
                                if (sig.newState) Object.assign(position, sig.newState);
                            }
                        }
                    }
                }
            }

            if (closed) {
                const grossPnl = (exitPrice - position.entryPrice) * position.size * (isLong ? 1 : -1);
                const fees = (position.entryPrice + exitPrice) * position.size * config.takerFeeRate;
                const netPnl = grossPnl - fees;

                trades.push({
                    ...position,
                    exitPrice,
                    exitTime: new Date(currentTime).toISOString(),
                    pnl: netPnl,
                    exitReason
                } as Trade);

                if (netPnl > 0) wins++;
                else losses++;
                position = null;
            }
        }

        // 3. Entry Logic — TF-aligned: only evaluate at configured timeframe candle boundaries.
        // e.g. a 5m agent fires once per 5-minute close, not on every 1m tick.
        const currentTfIndex = Math.floor(currentTime / tfMs);
        if (!position && currentTfIndex > lastEvalTfIndex) {
            lastEvalTfIndex = currentTfIndex;
            // Run Analysis
            const signal = await runFullAnalysisInWorker(
                config.agent,
                klinesSlice,
                config,
                htfSlice,
                undefined, // immediateKlines
                undefined, // ltfKlines
                undefined, // ethBtc
                currentPrice,
                currentMatrixMap,
                btcMatrixData ? btcMatrixData.filter(k => k.time <= currentTime) : undefined,
                undefined, // OrderBook
                oiSlice,
                lsSlice,
                currentTime, // candle timestamp for session filter
                universalModel
            );

            if (signal.signal === 'BUY' || signal.signal === 'SELL') {
                const targets = getInitialAgentTargets(klinesSlice, currentPrice, signal.signal === 'BUY' ? 'LONG' : 'SHORT', config, signal.tradeType, signal.stopLossPrice, signal.takeProfitPrice);
                
                // Validate Trade
                const validation = validateTradeProfitability(currentPrice, targets.stopLossPrice, targets.takeProfitPrice, signal.signal === 'BUY' ? 'LONG' : 'SHORT', config);
                
                if (validation.isValid) {
                    const size = (config.investmentAmount * config.leverage) / currentPrice;
                    position = {
                        id: i,
                        botId: 'backtest',
                        agentId: config.agent.id,
                        pair: config.pair,
                        direction: signal.signal === 'BUY' ? 'LONG' : 'SHORT',
                        entryPrice: currentPrice,
                        size,
                        investmentAmount: config.investmentAmount,
                        leverage: config.leverage,
                        takeProfitPrice: targets.takeProfitPrice,
                        stopLossPrice: targets.stopLossPrice,
                        initialStopLossPrice: targets.stopLossPrice,
                        initialTakeProfitPrice: targets.takeProfitPrice,
                        initialRiskInPrice: Math.abs(currentPrice - targets.stopLossPrice),
                        activeStopLossReason: targets.slReason,
                        initialStopLossReason: targets.slReason,
                        pricePrecision: config.pricePrecision,
                        timeFrame: config.timeFrame,
                        candlesSinceEntry: 0,
                        takerFeeRate: config.takerFeeRate,
                        peakPrice: currentPrice,
                        troughPrice: currentPrice,
                        profitLockTier: 0,
                        isBreakevenSet: false,
                        profitSpikeTier: 0,
                        aggressiveTrailTier: 0,
                        tpLockStage: 0,
                        agentParamsSnapshot: config.agentParams,
                        botConfigSnapshot: config,
                        entryReason: signal.reasons.join(', '),
                        entryTime: new Date(currentTime).toISOString(),
                        setupType: signal.setupType,
                        invalidationPrice: signal.invalidationPrice,
                        conviction: signal.omegaAnalysis?.conviction,
                        // Store omegaMetadata in entryContext so ApexManagementEngine can read entryConviction
                        // for conviction-based patience (otherwise it defaults to 65 for all trades).
                        entryContext: signal.omegaMetadata
                            ? { omega_metadata: { entryConviction: signal.omegaMetadata.entryConviction } }
                            : undefined,
                    } as unknown as Position; // Cast to Position (ignoring some runtime-only props)
                }
            }
        }
    }

    const totalPnl = trades.reduce((acc, t) => acc + t.pnl, 0);
    const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

    // Calculate Drawdown
    let maxDrawdown = 0;
    let peakBalance = 0;
    let runningBalance = 0;
    trades.forEach(t => {
        runningBalance += t.pnl;
        if (runningBalance > peakBalance) peakBalance = runningBalance;
        const dd = peakBalance - runningBalance;
        if (dd > maxDrawdown) maxDrawdown = dd;
    });

    // Profit Factor: Gross Profit / Gross Loss
    const grossProfit = trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
    const grossLoss = Math.abs(trades.filter(t => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0));
    const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 1) : grossProfit / grossLoss;

    // Sharpe Ratio (annualised, using per-trade returns vs 0 risk-free rate)
    let sharpeRatio = 0;
    if (trades.length > 1) {
        const returns = trades.map(t => t.pnl / t.investmentAmount);
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1);
        const stdDev = Math.sqrt(variance);
        if (stdDev > 0) sharpeRatio = parseFloat(((mean / stdDev) * Math.sqrt(252)).toFixed(2));
    }

    // ── SETUP TYPE EDGE BREAKDOWN ─────────────────────────────────────────────
    // Groups all trades by setupType and computes per-setup win rate, avg PnL,
    // expectancy, and profit factor — so you can identify which setups have real edge.
    const setupMap = new Map<string, Trade[]>();
    trades.forEach(t => {
        const key = t.setupType || 'Unknown';
        if (!setupMap.has(key)) setupMap.set(key, []);
        setupMap.get(key)!.push(t);
    });

    const setupBreakdown: SetupTypeStats[] = [];
    setupMap.forEach((setupTrades, setupType) => {
        const setupWins = setupTrades.filter(t => t.pnl > 0);
        const setupLosses = setupTrades.filter(t => t.pnl <= 0);
        const wr = setupTrades.length > 0 ? setupWins.length / setupTrades.length : 0;
        const avgWin = setupWins.length > 0 ? setupWins.reduce((a, t) => a + t.pnl, 0) / setupWins.length : 0;
        const avgLoss = setupLosses.length > 0 ? Math.abs(setupLosses.reduce((a, t) => a + t.pnl, 0) / setupLosses.length) : 0;
        const gProfit = setupWins.reduce((a, t) => a + t.pnl, 0);
        const gLoss = Math.abs(setupLosses.reduce((a, t) => a + t.pnl, 0));
        setupBreakdown.push({
            setupType,
            count: setupTrades.length,
            wins: setupWins.length,
            losses: setupLosses.length,
            winRate: wr * 100,
            totalPnl: setupTrades.reduce((a, t) => a + t.pnl, 0),
            avgPnl: setupTrades.reduce((a, t) => a + t.pnl, 0) / setupTrades.length,
            avgWin,
            avgLoss,
            expectancy: avgWin * wr - avgLoss * (1 - wr),
            profitFactor: gLoss === 0 ? (gProfit > 0 ? Infinity : 1) : gProfit / gLoss,
        });
    });
    setupBreakdown.sort((a, b) => b.expectancy - a.expectancy);

    return {
        trades: trades.sort((a,b) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime()),
        totalPnl,
        winRate,
        totalTrades: trades.length,
        wins,
        losses,
        breakEvens: 0,
        maxDrawdown,
        profitFactor,
        sharpeRatio,
        averageTradeDuration: 'N/A',
        setupBreakdown,
    };
}


self.onmessage = async (event: MessageEvent) => {
    const { type, payload, id } = event.data;
    try {
        if (type === 'runLiveAnalysis') {
            const result = await runFullAnalysisInWorker(
                payload.agent, payload.klines, payload.config, payload.htfKlines,
                payload.immediateKlines, payload.ltfKlines, payload.ethBtcKlines,
                payload.livePrice, payload.astraXKlinesMap, payload.btcKlines, payload.orderBookAnalysis,
                payload.openInterestHistory, payload.lsRatioHistory, undefined, payload.universalModel, payload.fundingRate
            );
            self.postMessage({ type: 'result', payload: result, id });
        } else if (type === 'runBacktest') {
             const result = await runBacktestInWorker(
                 payload.klines,
                 payload.config,
                 payload.htfKlines,
                 payload.astraXKlinesMap,
                 payload.openInterestHistory,
                 payload.lsRatioHistory,
                 payload.universalModel,
                 (percent: number) => self.postMessage({ type: 'progress', id, progress: { percent } })
             );
             self.postMessage({ type: 'result', payload: result, id });
        } else if (type === 'runOptimization') {
             // Optimization not fully updated with new loop yet, keeping placeholder for brevity unless requested
             const result = { trades: [], totalPnl: 0, winRate: 0, totalTrades: 0, wins: 0, losses: 0, breakEvens: 0, maxDrawdown: 0, profitFactor: 0, sharpeRatio: 0, averageTradeDuration: '0s' };
             self.postMessage({ type: 'result', payload: [ { params: payload.config.agentParams, result } ], id });
        }
    } catch (error) {
        self.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error), id });
    }
};
