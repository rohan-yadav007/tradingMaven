
// services/backtesting.worker.ts

import { Kline, BotConfig, BacktestResult, OptimizationResultItem, Trade, AgentParams, Position, TradingMode, Agent, TradeSignal } from '../types';
import { getInitialAgentTargets, getAgentExitSignal, getMultiStageProfitSecureSignal, validateTradeProfitability, getTradeGuardianSignal, getMandatoryBreakevenSignal, getProfitSpikeSignal, getAggressiveRangeTrailSignal, getAdaptiveTakeProfit } from './riskManagementService';
import * as constants from '../constants';
import { ATR } from 'technicalindicators';
import { getQuantumScalperSignal } from './agents/quantumScalper';
import { getHistoricExpertSignal } from './agents/historicExpert';
import { getChameleonSignal } from './agents/chameleon';
import { getTheSentinelSignal } from './agents/sentinel';
import { getIchimokuTrendRiderSignal } from './agents/ichimokuTrendRider';
import { getMomentumSwingTraderSignal } from './agents/momentumSwingTrader';
import { getTheConductorSignal } from './agents/conductor';
import { getAstraXSignal, getConfluenceTimeframes } from './agents/astrax';
import { getSupertrendFlipperSignal } from './agents/supertrendFlipper';
import { getPivotPointSupertrendSignal } from './agents/pivotPointSupertrend';
import { applyTimeframeSettings, captureMarketContext, calculateHeikinAshi, isMarketCohesive, analyzeMicroMarketStructure } from './agents/agentUtils';
import { Supertrend } from './agents/agentUtils';
import { calculateSupportResistance } from './chartAnalysisService';
import { detectSmcReversalPattern } from './vetoService';

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
    const seconds = Math.floor(totalSeconds % 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
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
    btcKlines?: Kline[]
): Promise<TradeSignal> {
    const config = applyTimeframeSettings(originalConfig);
    const params = config.agentParams as Required<AgentParams>;
    const reasons: string[] = [];

    const htfContext = htfKlines && htfKlines.length > 0 ? captureMarketContext([], htfKlines) : undefined;

    let agentSignal: TradeSignal;

    if (agent.id === 19) {
        // Ensure map exists for AstraX and handles serialization edge cases
        let map = astraXKlinesMap;
        if (map && !(map instanceof Map)) {
            // If it comes across as a plain object, reconstruct it
            map = new Map(Object.entries(map));
        }
        if (!map) map = new Map<string, Kline[]>();
        
        // If the map is empty (e.g. in basic backtest without aggregation setup), fallback to single TF
        if (!map.has(config.timeFrame)) {
            map.set(config.timeFrame, klines);
        }
        agentSignal = await getAstraXSignal(config, map, immediateKlines, livePrice, undefined, ltfKlines, btcKlines);
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
            default: agentSignal = { signal: 'HOLD', reasons: ['Agent not found'] };
        }
    }
    
    reasons.push(...agentSignal.reasons);

    if (agentSignal.signal === 'HOLD') {
        return agentSignal;
    }

    const lastKline = klines[klines.length-1];
    const currentPrice = livePrice || lastKline?.close;
    if (!currentPrice || currentPrice <= 0) {
        return { signal: 'HOLD', reasons: ['Could not get current price for validation.'] };
    }

    if (!lastKline) return { signal: 'HOLD', reasons: ['No kline data for filters.'] };

    if (config.isSrAnalysisEnabled) {
        const srLevels = calculateSupportResistance(klines);
        const currentAtr = (getLast(ATR.calculate({ high: klines.map(k=>k.high), low: klines.map(k=>k.low), close: klines.map(k=>k.close), period: 14 })) as number | undefined) || 0;
        const buffer = currentAtr * params.veto_srZoneAtrBuffer;
        
        if (agentSignal.signal === 'BUY') {
            const nextResistance = srLevels.resistances.find(r => r.price > currentPrice);
            if (nextResistance && (nextResistance.price - currentPrice) < buffer) {
                return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Entry is too close to a resistance zone.`] };
            }
        } else { // SELL
            const nextSupport = srLevels.supports.find(s => s.price < currentPrice);
            if (nextSupport && (currentPrice - nextSupport.price) < buffer) {
                return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Entry is too close to a support zone.`] };
            }
        }
        reasons.push('✅ S/R Zone: Clear');
    }

    if (config.isMomentumConcordanceEnabled && agent.id !== 19) {
        // Veto 1: Candle Position Veto (Anti-Chase)
        const candleRange = lastKline.high - lastKline.low;
        if (candleRange > 0) {
            const closePosition = (lastKline.close - lastKline.low) / candleRange;
            if (agentSignal.signal === 'BUY' && closePosition > params.veto_candlePositionVeto_long) {
                return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Price is too high in candle range (>${(params.veto_candlePositionVeto_long * 100).toFixed(0)}%).`] };
            }
            if (agentSignal.signal === 'SELL' && closePosition < params.veto_candlePositionVeto_short) {
                return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Price is too low in candle range (<${(params.veto_candlePositionVeto_short * 100).toFixed(0)}%).`] };
            }
            reasons.push('✅ Candle Position: OK');
        }

        // Veto 2: Micro-Timeframe Momentum Confirmation
        const microStructure = ltfKlines ? analyzeMicroMarketStructure(ltfKlines) : null;
        if (microStructure) {
            if (agentSignal.signal === 'BUY' && microStructure === 'descending') {
                return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Micro-timeframe momentum is bearish.`] };
            }
            if (agentSignal.signal === 'SELL' && microStructure === 'ascending') {
                return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Micro-timeframe momentum is bullish.`] };
            }
            reasons.push(`✅ Micro-Momentum: Confirmed (${microStructure})`);
        }
    }

    if (config.isMarketCohesionEnabled) {
        const haKlines = calculateHeikinAshi(klines);
        const cohesionCheck = isMarketCohesive(haKlines, agentSignal.signal, config.timeFrame, 2);
        if (!cohesionCheck.cohesive) return { signal: 'HOLD', reasons: [...reasons, cohesionCheck.reason] };
        reasons.push(cohesionCheck.reason);
    }
    
    if (config.isSupertrendConfirmationEnabled) {
        const stParams = {
            period: constants.DEFAULT_AGENT_PARAMS.qsc_superTrendPeriod,
            multiplier: constants.DEFAULT_AGENT_PARAMS.qsc_superTrendMultiplier
        };
        const supertrendValues = Supertrend.calculate({
            high: klines.map(k => k.high),
            low: klines.map(k => k.low),
            close: klines.map(k => k.close),
            period: stParams.period,
            multiplier: stParams.multiplier
        });
        const lastSupertrend = getLast(supertrendValues) as number | undefined;

        if (lastSupertrend) {
            if (agentSignal.signal === 'BUY' && currentPrice < lastSupertrend) {
                return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Price is below Supertrend.`] };
            }
            if (agentSignal.signal === 'SELL' && currentPrice > lastSupertrend) {
                return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Price is above Supertrend.`] };
            }
            reasons.push('✅ Supertrend: Confirmed');
        } else {
            reasons.push('⚠️ Supertrend: Could not calculate.');
        }
    }

    const { stopLossPrice, takeProfitPrice, agentStopLoss } = getInitialAgentTargets(klines, currentPrice, agentSignal.signal === 'BUY' ? 'LONG' : 'SHORT', config, agentSignal.tradeType);
    const profitabilityValidation = validateTradeProfitability(currentPrice, agentStopLoss, takeProfitPrice, agentSignal.signal === 'BUY' ? 'LONG' : 'SHORT', config);
    if (!profitabilityValidation.isValid) {
        return { signal: 'HOLD', reasons: [...reasons, profitabilityValidation.reason] };
    }
    reasons.push(profitabilityValidation.reason);

    return { 
        ...agentSignal, 
        reasons,
        stopLossPrice: stopLossPrice,
        takeProfitPrice: takeProfitPrice
    };
}


async function simulateBot(baseKlines: Kline[], config: BotConfig, htfKlines?: Kline[]): Promise<BacktestResult> {
    const trades: Trade[] = [];
    let openPosition: SimulatedPosition | null = null;
    let balance = config.investmentAmount;
    let peakBalance = balance;
    let maxDrawdown = 0;

    const aggregatedKlines = aggregateKlines(baseKlines, config.timeFrame);
    const htfAggregatedKlines = htfKlines ? aggregateKlines(htfKlines, config.htfTimeFrame === 'auto' ? constants.getHigherTimeframe(config.timeFrame) || config.timeFrame : config.htfTimeFrame) : undefined;

    // Preparation for AstraX in Backtesting
    const isAstraX = config.agent.id === 19;
    const astraxTfs = isAstraX ? getConfluenceTimeframes(config.timeFrame) : [];
    
    // We need to maintain aggregated histories for all required AstraX timeframes
    const astraxAggregatedData: Map<string, Kline[]> = new Map();
    // Pre-calculate aggregated arrays for efficiency if needed, or aggregate on the fly. 
    // For simplicity and correctness in avoiding look-ahead, we will slice the baseKlines up to 'i' and aggregate dynamically or
    // aggregate everything once and then slice. Aggregating everything once is safer provided we access strictly by timestamp <= current time.
    if (isAstraX) {
        astraxTfs.forEach(tf => {
            astraxAggregatedData.set(tf, aggregateKlines(baseKlines, tf));
        });
    }

    const getKlinesUntilTimestamp = (sourceKlines: Kline[], timestamp: number) => {
        // Binary search or simple filter? Filter is O(N), loop is O(N).
        // Given we iterate forward, we can optimize by maintaining an index, but simple filter is safer for now.
        // Optimization: Find index where time > timestamp, slice up to there.
        let idx = sourceKlines.findIndex(k => k.time > timestamp);
        if (idx === -1) return sourceKlines; // All klines are past
        return sourceKlines.slice(0, idx);
    };
    
    // Warm-up period for indicators
    const startIdx = 200;
    if (aggregatedKlines.length < startIdx) {
        throw new Error("Not enough kline data for a reliable backtest.");
    }

    for (let i = startIdx; i < aggregatedKlines.length; i++) {
        const currentKline = aggregatedKlines[i];
        const klinesForAnalysis = aggregatedKlines.slice(0, i + 1);
        const currentPrice = currentKline.close;
        const currentHtfKlines = htfAggregatedKlines ? getKlinesUntilTimestamp(htfAggregatedKlines, currentKline.time) : undefined;

        // --- POSITION MANAGEMENT ---
        if (openPosition) {
            let positionClosed = false;
            const isLong = openPosition.direction === 'LONG';
            const slHitPrice = isLong ? openPosition.stopLossPrice : currentKline.high;
            const tpHitPrice = isLong ? currentKline.high : openPosition.takeProfitPrice;

            // Check SL hit
            if ((isLong && currentKline.low <= openPosition.stopLossPrice) || (!isLong && currentKline.high >= openPosition.stopLossPrice)) {
                const exitPrice = openPosition.stopLossPrice;
                const pnl = (exitPrice - openPosition.entryPrice) * openPosition.size * (isLong ? 1 : -1);
                const newTrade: Trade = { ...openPosition, exitPrice, exitTime: new Date(currentKline.time).toISOString(), pnl, exitReason: 'Stop Loss Hit' };
                trades.push(newTrade);
                balance += pnl;
                openPosition = null;
                positionClosed = true;
            }
            // Check TP hit
            else if ((isLong && currentKline.high >= openPosition.takeProfitPrice) || (!isLong && currentKline.low <= openPosition.takeProfitPrice)) {
                const exitPrice = openPosition.takeProfitPrice;
                const pnl = (exitPrice - openPosition.entryPrice) * openPosition.size * (isLong ? 1 : -1);
                const newTrade: Trade = { ...openPosition, exitPrice, exitTime: new Date(currentKline.time).toISOString(), pnl, exitReason: 'Take Profit Hit' };
                trades.push(newTrade);
                balance += pnl;
                openPosition = null;
                positionClosed = true;
            }

            // If not closed by SL/TP, run trailing logic
            if (!positionClosed && openPosition) {
                 if (config.isTradeGuardianEnabled) {
                    const microKlines = baseKlines.filter(k => k.time <= currentKline.time && k.time > aggregatedKlines[i-1].time);
                    const guardianSignal = getTradeGuardianSignal(openPosition, klinesForAnalysis, microKlines, currentPrice);
                     if (guardianSignal.action === 'close') {
                        const pnl = (currentPrice - openPosition.entryPrice) * openPosition.size * (isLong ? 1 : -1);
                        const newTrade: Trade = { ...openPosition, exitPrice: currentPrice, exitTime: new Date(currentKline.time).toISOString(), pnl, exitReason: guardianSignal.reason || 'Trade Guardian' };
                        trades.push(newTrade);
                        balance += pnl;
                        openPosition = null;
                        positionClosed = true;
                    }
                }

                if (!positionClosed && openPosition) {
                    const managementSignals = [
                        getAgentExitSignal(openPosition, klinesForAnalysis, currentPrice, config),
                        getMultiStageProfitSecureSignal(openPosition, currentPrice),
                        getMandatoryBreakevenSignal(openPosition, currentPrice),
                        getProfitSpikeSignal(openPosition, currentPrice),
                        getAggressiveRangeTrailSignal(openPosition, currentPrice),
                    ];
    
                    let bestNewStop = isLong ? -Infinity : Infinity;
                    let bestReason: Position['activeStopLossReason'] = openPosition.activeStopLossReason;
    
                    for (const signal of managementSignals) {
                        if (signal.newStopLoss !== undefined) {
                            if ((isLong && signal.newStopLoss > bestNewStop) || (!isLong && signal.newStopLoss < bestNewStop)) {
                                bestNewStop = signal.newStopLoss;
                                bestReason = signal.activeStopLossReason || bestReason;
                            }
                        }
                    }
    
                    if (bestNewStop !== -Infinity && bestNewStop !== Infinity) {
                        openPosition.stopLossPrice = bestNewStop;
                        openPosition.activeStopLossReason = bestReason;
                    }
    
                    const adaptiveTpSignal = getAdaptiveTakeProfit(openPosition, klinesForAnalysis, currentPrice);
                    if (adaptiveTpSignal.newTakeProfit) {
                        openPosition.takeProfitPrice = adaptiveTpSignal.newTakeProfit;
                    }
                }
            }
        }

        // --- ENTRY LOGIC ---
        if (!openPosition) {
            // Build snapshot map for AstraX
            let snapshotMap: Map<string, Kline[]> | undefined;
            if (isAstraX) {
                snapshotMap = new Map();
                astraxTfs.forEach(tf => {
                    const fullHistory = astraxAggregatedData.get(tf);
                    if (fullHistory) {
                        snapshotMap!.set(tf, getKlinesUntilTimestamp(fullHistory, currentKline.time));
                    }
                });
            }

            const signal = await runFullAnalysisInWorker(config.agent, klinesForAnalysis, config, currentHtfKlines, undefined, undefined, undefined, currentPrice, snapshotMap);
            
            if (signal.signal !== 'HOLD') {
                const { stopLossPrice, takeProfitPrice, slReason, agentStopLoss } = getInitialAgentTargets(klinesForAnalysis, currentPrice, signal.signal === 'BUY' ? 'LONG' : 'SHORT', config, signal.tradeType);
                
                const validation = validateTradeProfitability(currentPrice, agentStopLoss, takeProfitPrice, signal.signal === 'BUY' ? 'LONG' : 'SHORT', config);

                if (validation.isValid) {
                    const positionValue = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
                    const size = positionValue / currentPrice;
                    const initialRiskRewardRatio = Math.abs(takeProfitPrice - currentPrice) / Math.abs(currentPrice - stopLossPrice);

                    openPosition = {
                        id: Date.now() + i,
                        botId: 'backtest',
                        agentId: config.agent.id, // Populate agentId
                        orderId: null,
                        pair: config.pair,
                        mode: config.mode,
                        executionMode: 'paper',
                        direction: signal.signal === 'BUY' ? 'LONG' : 'SHORT',
                        entryPrice: currentPrice,
                        size,
                        investmentAmount: config.investmentAmount,
                        leverage: config.leverage,
                        marginType: config.marginType,
                        entryTime: new Date(currentKline.time).toISOString(),
                        entryReason: signal.reasons.join('\n'),
                        agentName: config.agent.name,
                        takeProfitPrice: takeProfitPrice,
                        stopLossPrice: stopLossPrice,
                        initialTakeProfitPrice: takeProfitPrice,
                        initialStopLossPrice: agentStopLoss,
                        initialRiskInPrice: Math.abs(currentPrice - agentStopLoss),
                        initialStopLossReason: slReason,
                        activeStopLossReason: slReason,
                        pricePrecision: config.pricePrecision,
                        timeFrame: config.timeFrame,
                        isBreakevenSet: false,
                        profitLockTier: 0,
                        profitSpikeTier: 0,
                        aggressiveTrailTier: 0,
                        peakPrice: currentPrice,
                        troughPrice: currentPrice,
                        candlesSinceEntry: 0,
                        hasBeenProfitable: false,
                        takerFeeRate: config.takerFeeRate,
                        initialRiskRewardRatio,
                        proactiveLossCheckTriggered: false,
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
                            isSupertrendConfirmationEnabled: config.isSupertrendConfirmationEnabled,
                            htfTimeFrame: config.htfTimeFrame,
                            entryTiming: config.entryTiming,
                            isAdaptiveTpEnabled: config.isAdaptiveTpEnabled,
                            aggressiveTrailMode: config.aggressiveTrailMode,
                            isInitialRiskVetoEnabled: config.isInitialRiskVetoEnabled,
                            isMarketBreadthFilterEnabled: config.isMarketBreadthFilterEnabled,
                            isLiquidationFilterEnabled: config.isLiquidationFilterEnabled,
                            isConfirmationCandleEnabled: config.isConfirmationCandleEnabled,
                            isMomentumConcordanceEnabled: config.isMomentumConcordanceEnabled,
                            isTradeGuardianEnabled: config.isTradeGuardianEnabled,
                            finalEntryFailSafe: config.finalEntryFailSafe,
                            isHeikinAshiEnabled: config.isHeikinAshiEnabled,
                        },
                        entryContext: captureMarketContext(klinesForAnalysis, currentHtfKlines),
                        entryAtr: getLast(ATR.calculate({high: klinesForAnalysis.map(k=>k.high), low: klinesForAnalysis.map(k=>k.low), close: klinesForAnalysis.map(k=>k.close), period: 14})) as number | undefined,
                        tradeType: signal.tradeType,
                    };
                }
            }
        }
        
        peakBalance = Math.max(peakBalance, balance);
        const drawdown = (peakBalance - balance) / peakBalance;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    // Close any open position at the end of the backtest
    if (openPosition) {
        const exitPrice = getLast(aggregatedKlines)!.close;
        const pnl = (exitPrice - openPosition.entryPrice) * openPosition.size * (openPosition.direction === 'LONG' ? 1 : -1);
        const newTrade: Trade = { ...openPosition, exitPrice, exitTime: new Date(getLast(aggregatedKlines)!.time).toISOString(), pnl, exitReason: 'End of Backtest' };
        trades.push(newTrade);
        balance += pnl;
    }

    // --- FINAL METRICS CALCULATION ---
    const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
    const wins = trades.filter(t => t.pnl > 0).length;
    const losses = trades.filter(t => t.pnl < 0).length;
    const breakEvens = trades.length - wins - losses;
    const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
    const grossProfit = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

    const tradeDurations = trades.map(t => new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime());
    const averageTradeDurationMs = tradeDurations.length > 0 ? tradeDurations.reduce((a, b) => a + b, 0) / tradeDurations.length : 0;

    const pnlValues = trades.map(t => t.pnl);
    const avgPnl = totalPnl / trades.length || 0;
    const pnlStdDev = Math.sqrt(pnlValues.map(x => Math.pow(x - avgPnl, 2)).reduce((a, b) => a + b, 0) / trades.length) || 0;
    const sharpeRatio = pnlStdDev > 0 ? (avgPnl / pnlStdDev) * Math.sqrt(trades.length) : 0;

    return {
        trades,
        totalPnl,
        winRate,
        totalTrades: trades.length,
        wins,
        losses,
        breakEvens,
        maxDrawdown: maxDrawdown * 100,
        profitFactor,
        sharpeRatio,
        averageTradeDuration: formatDuration(averageTradeDurationMs),
    };
}


const runBacktestInWorker = async (id: number, payload: { klines: Kline[], config: BotConfig, htfKlines?: Kline[] }) => {
    try {
        const result = await simulateBot(payload.klines, payload.config, payload.htfKlines);
        postMessage({ type: 'result', id, payload: result });
    } catch (e: any) {
        postMessage({ type: 'error', id, error: e.message });
    }
};

const runLiveAnalysisInWorker = async (id: number, payload: { 
    agent: Agent, klines: Kline[], config: BotConfig, htfKlines?: Kline[], 
    immediateKlines?: Kline[], ltfKlines?: Kline[], ethBtcKlines?: Kline[], livePrice?: number,
    astraXKlinesMap?: Map<string, Kline[]>,
    btcKlines?: Kline[]
}) => {
    try {
        const { agent, klines, config, htfKlines, immediateKlines, ltfKlines, ethBtcKlines, livePrice, astraXKlinesMap, btcKlines } = payload;
        const result = await runFullAnalysisInWorker(agent, klines, config, htfKlines, immediateKlines, ltfKlines, ethBtcKlines, livePrice, astraXKlinesMap, btcKlines);
        postMessage({ type: 'result', id, payload: result });
    } catch (e: any) {
        postMessage({ type: 'error', id, error: e.message });
    }
};

const runOptimizationInWorker = (id: number, payload: { klines: Kline[], config: BotConfig, htfKlines?: Kline[] }) => {
    // This is a placeholder for a real optimization function.
    // A real implementation would generate parameter combinations and run simulateBot for each.
    // For now, it will just return an error.
    postMessage({ type: 'error', id, error: "Optimization feature not yet fully implemented in worker." });
};


self.onmessage = (event: MessageEvent) => {
    const { type, id, payload } = event.data;

    switch (type) {
        case 'runBacktest':
            runBacktestInWorker(id, payload);
            break;
        case 'runLiveAnalysis':
            runLiveAnalysisInWorker(id, payload);
            break;
        case 'runOptimization':
            runOptimizationInWorker(id, payload);
            break;
    }
};
