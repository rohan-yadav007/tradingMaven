// services/botManagerService.ts

import { RunningBot, BotConfig, BotStatus, TradeSignal, Kline, BotLogEntry, Position, LiveTicker, LogType, TradingMode, MarketDataContext, AgentParams } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getMultiStageProfitSecureSignal, getAgentExitSignal, getInitialAgentTargets, validateTradeProfitability, getTradeGuardianSignal, getMandatoryBreakevenSignal, getProfitSpikeSignal, getAggressiveRangeTrailSignal, captureMarketContext, getAdaptiveTakeProfit } from './localAgentService';
import { TIME_FRAMES, getMicroTimeframe } from '../constants';
import { telegramBotService } from './telegramBotService';
import { WebSocketManager } from './webSocketManager';
import { sharedKlineService } from './sharedKlineService';
import * as constants from '../constants';
// FIX: Added getAstraXRegimeAndDirection to resolve a missing import error.
import { getLowerConfluenceTimeframes, getAstraXRegimeAndDirection } from './agents/astrax';

const MAX_LOG_ENTRIES = 100;

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

export interface BotHandlers {
    onExecuteTrade: (
        signal: TradeSignal, 
        botId: string,
        executionDetails: {
            agentStopLoss: number,
            slReason: 'Agent Logic' | 'Hard Cap',
            entryContext: MarketDataContext,
        }
    ) => Promise<void>;
    onClosePosition: (position: Position, exitReason: string, exitPrice?: number) => void;
}

class BotInstance {
    public bot: RunningBot;
    public klines: Kline[] = [];
    private onUpdate: (bot: RunningBot) => void;
    private handlers: BotHandlers;
    public subscriptions: { type: 'ticker' | 'kline', pair: string, timeFrame?: string, mode: TradingMode, callback: Function }[] = [];
    private executing = false;
    private initialSignalIgnored: boolean = false;

    constructor(config: BotConfig, onUpdate: (bot: RunningBot) => void, handlers: BotHandlers) {
        this.bot = {
            id: `bot-${Date.now()}-${config.pair.replace('/', '')}`,
            config,
            status: BotStatus.Starting,
            log: [{ timestamp: new Date(), message: `Bot created for ${config.pair} on ${config.timeFrame}.`, type: LogType.Info }],
            analysis: null,
            openPositionId: null,
            openPosition: null,
            closedTradesCount: 0,
            totalPnl: 0,
            wins: 0,
            losses: 0,
            totalGrossProfit: 0,
            totalGrossLoss: 0,
            lastProfitableTradeDirection: null,
            accumulatedActiveMs: 0,
            lastResumeTimestamp: null,
            klinesLoaded: 0,
            livePrice: 0,
            lastAnalysisTimestamp: null,
            lastPriceUpdateTimestamp: null,
        };
        this.onUpdate = onUpdate;
        this.handlers = handlers;
    }

    public async initialize(initialKlines: Kline[]) {
        this.addLog('Initializing with historical data...', LogType.Info);
        this.klines = initialKlines;
        this.bot.klinesLoaded = this.klines.length;
        this.addLog(`Initialized with ${this.klines.length} ${this.bot.config.timeFrame} klines.`, LogType.Success);
        
        if (this.bot.config.agent.id === 20) { // Supertrend Flipper
            this.addLog(`Flip strategy enabled. Awaiting first trend change to enter.`, LogType.Info);
        }
    
        this.addLog("Performing initial analysis on startup.", LogType.Info);
        const executeOnStart = this.bot.config.entryTiming === 'immediate';
        await this.runAnalysis({ execute: executeOnStart, reason: 'Initial Analysis' });
        
        if (this.bot.status === BotStatus.Starting) {
            this.updateState({ 
                status: BotStatus.Monitoring, 
                lastResumeTimestamp: Date.now(),
            });
        }
        
        this.onUpdate(this.bot); // Ensure final state is rendered
    }    

    public updateState(partialState: Partial<RunningBot>) {
        this.bot = { ...this.bot, ...partialState };
        this.onUpdate(this.bot);
    }

    addLog(message: string, type: LogType = LogType.Info) {
        const newLogEntry: BotLogEntry = { timestamp: new Date(), message, type };
        const newLog = [newLogEntry, ...this.bot.log].slice(0, MAX_LOG_ENTRIES);
        this.updateState({ log: newLog });
    }
    
    private getAnalysisDependencies(): { pair: string, timeframe: string, mode: TradingMode }[] {
        const { config } = this.bot;
        const dependencies: { pair: string, timeframe: string, mode: TradingMode }[] = [];

        dependencies.push({ pair: config.pair, timeframe: config.timeFrame, mode: config.mode });

        if (config.isHtfConfirmationEnabled) {
            const htf = config.htfTimeFrame === 'auto'
                ? TIME_FRAMES[TIME_FRAMES.indexOf(config.timeFrame) + 1]
                : config.htfTimeFrame;
            if (htf) {
                dependencies.push({ pair: config.pair, timeframe: htf, mode: config.mode });
            }
        }
        
        if (config.isMomentumConcordanceEnabled) {
             dependencies.push({ pair: config.pair, timeframe: '1m', mode: config.mode });
             const microTf = getMicroTimeframe(config.timeFrame);
             if (microTf !== '1m' && !dependencies.some(d => d.timeframe === microTf)) {
                dependencies.push({ pair: config.pair, timeframe: microTf, mode: config.mode });
             }
        }

        if (config.isBtcCorrelationVetoEnabled) {
            dependencies.push({ pair: 'ETH/BTC', timeframe: config.timeFrame, mode: TradingMode.Spot });
        }
        
        if (config.agent.id === 19) {
            const astraxTfs = getLowerConfluenceTimeframes(config.timeFrame);
            astraxTfs.forEach(tf => {
                if (!dependencies.some(d => d.pair === config.pair && d.timeframe === tf)) {
                    dependencies.push({ pair: config.pair, timeframe: tf, mode: config.mode });
                }
            });
        }

        return dependencies;
    }

    public async runAnalysis(options: { execute: boolean, reason: string, klinesOverride?: Kline[] }) {
        const klinesToUse = options.klinesOverride || this.klines;
        if (klinesToUse.length < 50 && this.bot.config.agent.id !== 19) return;

        try {
            let klinesForAnalysis = klinesToUse;

            // Preview logic should only run for immediate mode, when no override is given
            if (!options.klinesOverride && this.bot.config.entryTiming === 'immediate' && this.bot.livePrice && klinesToUse.length > 0) {
                const lastKline = klinesToUse[klinesToUse.length - 1];
                if (!lastKline.isFinal) {
                    const previewKline: Kline = {
                        ...lastKline,
                        high: Math.max(lastKline.high, this.bot.livePrice),
                        low: Math.min(lastKline.low, this.bot.livePrice),
                        close: this.bot.livePrice,
                        isFinal: false,
                    };
                    klinesForAnalysis = [...klinesToUse.slice(0, -1), previewKline];
                }
            }

            let htfKlines: Kline[] | undefined;
            if (this.bot.config.isHtfConfirmationEnabled) {
                try {
                    const htf = this.bot.config.htfTimeFrame === 'auto' 
                        ? TIME_FRAMES[TIME_FRAMES.indexOf(this.bot.config.timeFrame) + 1] 
                        : this.bot.config.htfTimeFrame;
                    if (htf) htfKlines = await sharedKlineService.getData(this.bot.config.pair, htf, this.bot.config.mode);
                } catch(e) { this.addLog(`Warning: could not fetch HTF klines: ${e}`, LogType.Error); }
            }
            
            let ltfKlines: Kline[] | undefined;
            if (this.bot.config.isMomentumConcordanceEnabled) {
                try {
                    const ltfTimeframe = getMicroTimeframe(this.bot.config.timeFrame);
                    ltfKlines = await sharedKlineService.getData(this.bot.config.pair, ltfTimeframe, this.bot.config.mode);
                } catch (e) { this.addLog(`Could not fetch LTF data for concordance check: ${e instanceof Error ? e.message : String(e)}`, LogType.Error); }
            }

            let immediateKlines: Kline[] | undefined;
            if (this.bot.config.isMomentumConcordanceEnabled) {
                try { immediateKlines = await sharedKlineService.getData(this.bot.config.pair, '1m', this.bot.config.mode);
                } catch (e) { this.addLog(`Could not fetch immediate (1m) data: ${e instanceof Error ? e.message : String(e)}`, LogType.Error); }
            }
            
            let ethBtcKlines: Kline[] | undefined;
            if (this.bot.config.isBtcCorrelationVetoEnabled) {
                try { ethBtcKlines = await sharedKlineService.getData('ETH/BTC', this.bot.config.timeFrame, TradingMode.Spot);
                } catch (e) { this.addLog(`Could not fetch ETH/BTC data: ${e instanceof Error ? e.message : String(e)}`, LogType.Error); }
            }
            
            const signal = await getTradingSignal(this.bot.config.agent, klinesForAnalysis, this.bot.config, htfKlines, immediateKlines, ltfKlines, ethBtcKlines, this.bot.livePrice);
            
            this.updateState({ analysis: signal });

            if (options.execute && signal.signal !== 'HOLD') {
                const isFlipper = this.bot.config.agent.id === 20;
    
                if (this.bot.openPosition) {
                    // Position is open, only flipper agent can take action here
                    if (isFlipper) {
                        const currentPosition = this.bot.openPosition!;
                        const isOpposite = (signal.signal === 'BUY' && currentPosition.direction === 'SHORT') || (signal.signal === 'SELL' && currentPosition.direction === 'LONG');
                        if (isOpposite) {
                            this.addLog(`Flip Signal: ${signal.signal}. Closing current ${currentPosition.direction}.`, LogType.Action);
                            this.updateState({ status: BotStatus.FlipPending });
                            this.handlers.onClosePosition(currentPosition, `Flip to ${signal.signal}`);
                        }
                    }
                } else { // No position is open
                    if (this.bot.status === BotStatus.Monitoring || this.bot.status === BotStatus.Starting) {
                        if (isFlipper && !this.initialSignalIgnored) {
                            this.addLog(`Ignoring first Supertrend signal (${signal.signal}). Bot is now armed.`, LogType.Info);
                            this.initialSignalIgnored = true;
                            // Update analysis to HOLD to prevent accidental execution by other logic paths
                            this.updateState({ analysis: { ...signal, signal: 'HOLD', reasons: [`ℹ️ First signal ignored.`] } });
                        } else {
                            this.updateState({ status: BotStatus.ExecutingTrade });
                            await this.executeTrade(signal, klinesForAnalysis);
                        }
                    }
                }
            } else if (signal.signal === 'HOLD' && !this.bot.openPosition && this.bot.config.entryTiming === 'onNextCandle') {
                this.addLog(`Analysis Result (Reason: ${options.reason}): HOLD`, LogType.Info);
                const titleLine = `Analysis Result: HOLD`;
                const reasonLines = signal.reasons.map(reason => {
                    let logType = LogType.Info;
                    if (reason.startsWith('✅')) logType = LogType.Success;
                    else if (reason.startsWith('❌')) logType = LogType.Error;
                    else if (reason.startsWith('⚠️')) logType = LogType.Status;
                    
                    const message = `- ${reason.substring(2).trim()}`;
                    return { message, logType };
                });
                
                this.addLog(titleLine, LogType.Info);
                reasonLines.forEach(line => this.addLog(line.message, line.logType));
            }

        } catch (error) {
            this.addLog(`Error during analysis: ${error}`, LogType.Error);
            this.updateState({ analysis: { signal: 'HOLD', reasons: [`Analysis Error: ${error}`] } });
        }
    }
    
    public async updateLivePrice(price: number, tickerData: LiveTicker) {
        const expectedPair = this.bot.config.pair.replace('/', '').toLowerCase();
        if (tickerData.pair.toLowerCase() !== expectedPair) return;
    
        this.updateState({ livePrice: price, liveTicker: tickerData, lastPriceUpdateTimestamp: Date.now() });
    
        if (this.bot.openPosition) {
            await this.managePositionOnTick(price);
            this.checkPriceBoundaries(price);
        } else if (this.bot.status === BotStatus.Monitoring) {
            const { config } = this.bot;
            // Merge defaults with user overrides to get effective params for the check.
            const params = { ...constants.DEFAULT_AGENT_PARAMS, ...config.agentParams };

            const isAstraXOnNextCandle = config.agent.id === 19 && config.entryTiming === 'onNextCandle';
            const isImmediateMode = config.entryTiming === 'immediate';
            
            // AstraX should only run on ticks if it's in scalp mode or conviction mode with scalp fallback enabled.
            const isAstraXScalpPossible = isAstraXOnNextCandle && 
                (params.astraX_executionMode === 'scalp' || params.astraX_scalp_enabledInChop);

            if (isImmediateMode || isAstraXScalpPossible) {
                const now = Date.now();
                const lastAnalysis = this.bot.lastAnalysisTimestamp || 0;
                if (now - lastAnalysis >= 1000) { // Throttle to prevent overwhelming on rapid ticks
                    if (this.executing) {
                        return; // Don't even update timestamp if busy, let it retry later
                    }
                    this.updateState({ lastAnalysisTimestamp: now });
                    this.executing = true;
                    try {
                        const reason = isAstraXScalpPossible 
                            ? "AstraX Scalp Check (On Tick)" 
                            : "Immediate Entry Check (On Tick)";
                        await this.runAnalysis({ execute: true, reason });
                    } finally {
                        this.executing = false;
                    }
                }
            }
        }
    }

    public async onMainKlineUpdate(newKline: Kline) {
        const lastKline = this.klines.length > 0 ? this.klines[this.klines.length - 1] : null;
    
        let isNewCandle = false;
        let closedCandle: Kline | null = null;
    
        if (lastKline && newKline.time === lastKline.time) {
            this.klines[this.klines.length - 1] = newKline;
        } else if (!lastKline || newKline.time > lastKline.time) {
            closedCandle = lastKline;
            this.klines.push(newKline);
            isNewCandle = true;
            if (this.klines.length > 501) this.klines.shift();
        }
        this.updateState({ klinesLoaded: this.klines.length });
    
        if (isNewCandle && closedCandle && this.bot.config.entryTiming === 'onNextCandle' && this.bot.status === BotStatus.Monitoring && !this.bot.openPosition) {
            if (this.executing) {
                this.addLog('Analysis for new candle skipped, previous execution still in process.', LogType.Info);
                return;
            }
            this.executing = true;
            try {
                const klinesForAnalysis = this.klines.slice(0, -1);
                this.addLog(`New candle started. Re-analyzing closed candle: ${new Date(closedCandle.time).toISOString()}`, LogType.Info);
                
                await this.runAnalysis({
                    execute: true,
                    reason: `Closed Candle Analysis`,
                    klinesOverride: klinesForAnalysis
                });
            } finally {
                this.executing = false;
            }
        }
    
        if (newKline.isFinal && this.bot.openPosition) {
            const openPosition = this.bot.openPosition;
            const candlesSinceEntry = (openPosition.candlesSinceEntry || 0) + 1;
            this.updateState({
                openPosition: { ...openPosition, candlesSinceEntry }
            });

             if (openPosition.tradeType === 'scalp' && this.bot.config.agent.id === 19) {
                this.addLog("Re-evaluating open scalp trade for conviction promotion...", LogType.Info);
                const { config } = this.bot;
                
                const analyticalTimeframes = getLowerConfluenceTimeframes(config.timeFrame);
                
                const klinePromises = analyticalTimeframes.map(tf => 
                    sharedKlineService.getData(config.pair, tf, config.mode)
                );
                const allFetchedKlines = await Promise.all(klinePromises);
                
                const klinesMap = new Map<string, Kline[]>();
                analyticalTimeframes.forEach((tf, index) => {
                    klinesMap.set(tf, allFetchedKlines[index]);
                });

                const { regime, direction: convictionDirection } = getAstraXRegimeAndDirection(config, klinesMap, analyticalTimeframes);
                const isLong = openPosition.direction === 'LONG';
                const convictionMatches = (isLong && convictionDirection === 'bullish') || (!isLong && convictionDirection === 'bearish');

                if (regime !== 'Choppy Market' && convictionMatches) {
                    this.addLog(`PROMOTION TRIGGERED: Market shifted to ${regime}. Upgrading scalp to conviction trade.`, LogType.Success);
                    const { stopLossPrice, takeProfitPrice } = getInitialAgentTargets(this.klines, openPosition.entryPrice, openPosition.direction, config);
                    const newState: Partial<Position> = {
                        tradeType: 'conviction', promotedFrom: 'scalp', takeProfitPrice, stopLossPrice,
                        profitLockTier: 0, aggressiveTrailTier: 0,
                    };
                    this.updateState({ openPosition: { ...openPosition, ...newState } });
                    this.addLog(`New Targets -> SL: ${stopLossPrice.toFixed(config.pricePrecision)}, TP: ${takeProfitPrice.toFixed(config.pricePrecision)}`, LogType.Action);
                }
            }

            if (this.bot.config.isConfirmationCandleEnabled && candlesSinceEntry === 1) {
                const entryCandle = this.klines.length > 2 ? this.klines[this.klines.length - 3] : null;
                const confirmationCandle = this.klines.length > 1 ? this.klines[this.klines.length - 2] : null;
                if (entryCandle && confirmationCandle) {
                    const isLong = openPosition.direction === 'LONG';
                    const isContradictory = isLong ? confirmationCandle.close < entryCandle.low : confirmationCandle.close > entryCandle.high;
                    if (isContradictory) {
                        this.addLog('Confirmation candle failed. Closing position.', LogType.Action);
                        this.handlers.onClosePosition(openPosition, 'Confirmation Failed', confirmationCandle.close);
                        return;
                    }
                }
            }

            if (this.bot.openPosition) {
                await this.runAnalysis({ execute: true, reason: "Position Management (New Candle)" });
            }
        }
    }

    private async getInitialPriceReliably(): Promise<number | null> {
        if (this.bot.livePrice) return this.bot.livePrice;
        const { config } = this.bot;
        const formattedPair = config.pair.replace('/', '');
        try {
            return config.mode === TradingMode.USDSM_Futures
                ? await binanceService.fetchFuturesTickerPrice(formattedPair)
                : await binanceService.fetchTickerPrice(formattedPair);
        } catch (e) {
            this.addLog(`Could not fetch price reliably: ${e}`, LogType.Error);
            return this.klines.length > 0 ? this.klines[this.klines.length - 1].close : null;
        }
    }
    
    public notifyTradeExecutionFailed(reason: string) {
        this.addLog(`Trade execution failed: ${reason}`, LogType.Error);
        this.updateState({ status: BotStatus.Monitoring });
    }

    private async executeTrade(signal: TradeSignal, klinesForExecution: Kline[]) {
        const currentPrice = await this.getInitialPriceReliably();
        if (!currentPrice) {
            this.notifyTradeExecutionFailed("Could not determine a valid entry price.");
            return;
        }
        
        const isLong = signal.signal === 'BUY';
        const { config } = this.bot;
        const { stopLossPrice, takeProfitPrice, slReason, agentStopLoss } = getInitialAgentTargets(klinesForExecution, currentPrice, isLong ? 'LONG' : 'SHORT', config);
        
        const validation = validateTradeProfitability(currentPrice, agentStopLoss, takeProfitPrice, isLong ? 'LONG' : 'SHORT', this.bot.config);
        if (!validation.isValid) {
            this.notifyTradeExecutionFailed(validation.reason);
            return;
        }

        this.addLog(`Executing ${signal.signal} at ~${currentPrice.toFixed(config.pricePrecision)}. SL: ${stopLossPrice.toFixed(config.pricePrecision)} (${slReason}), TP: ${takeProfitPrice.toFixed(config.pricePrecision)}`, LogType.Action);
        this.addLog(validation.reason, LogType.Success);

        const execSignal: TradeSignal = { ...signal, entryPrice: currentPrice, takeProfitPrice, stopLossPrice };
        const entryContext = captureMarketContext(klinesForExecution);
        
        await this.handlers.onExecuteTrade(execSignal, this.bot.id, { agentStopLoss, slReason, entryContext });
    }

    private checkPriceBoundaries(price: number) {
        const { openPosition } = this.bot;
        if (!openPosition) return;
        const isLong = openPosition.direction === 'LONG';
        
        const slCondition = isLong ? price <= openPosition.stopLossPrice : price >= openPosition.stopLossPrice;
        const tpCondition = isLong ? price >= openPosition.takeProfitPrice : price <= openPosition.takeProfitPrice;
        
        if (slCondition) {
            const reason = openPosition.activeStopLossReason.includes('Trail') || openPosition.activeStopLossReason.includes('Secure') || openPosition.activeStopLossReason === 'Breakeven' ? 'Trailing Stop Hit' : 'Stop Loss Hit';
            this.handlers.onClosePosition(openPosition, reason, openPosition.stopLossPrice);
        } else if (tpCondition) {
            this.handlers.onClosePosition(openPosition, 'Take Profit Hit', price);
        }
    }

    private async managePositionOnTick(currentPrice: number) {
        if (!this.bot.openPosition) return;

        const guardianConfig = this.bot.openPosition.botConfigSnapshot;
        if (guardianConfig?.isTradeGuardianEnabled) {
            try {
                const microTf = getMicroTimeframe(this.bot.config.timeFrame);
                const microKlines = await sharedKlineService.getData(this.bot.config.pair, microTf, this.bot.config.mode);
                 const guardianSignal = getTradeGuardianSignal(this.bot.openPosition, this.klines, microKlines, currentPrice);
                if (guardianSignal.action === 'close') {
                    this.addLog(guardianSignal.reason!, LogType.Action);
                    if(this.bot.livePrice) {
                        this.handlers.onClosePosition(this.bot.openPosition, guardianSignal.reason!, this.bot.livePrice);
                    }
                    return;
                }
            } catch (e) {
                 this.addLog(`Error in Trade Guardian: ${e instanceof Error ? e.message : String(e)}`, LogType.Error);
            }
        }
    
        let positionState: Position = { ...this.bot.openPosition };
        const isLong = positionState.direction === 'LONG';
        let changes: Partial<Position> = {};
    
        const peak = positionState.peakPrice ?? positionState.entryPrice;
        if ((isLong && currentPrice > peak) || (!isLong && currentPrice < peak)) {
            changes.peakPrice = currentPrice;
        }
        const trough = positionState.troughPrice ?? positionState.entryPrice;
        if ((isLong && currentPrice < trough) || (!isLong && currentPrice > trough)) {
            changes.troughPrice = currentPrice;
        }

        if (!positionState.hasBeenProfitable) {
            const feeRate = positionState.takerFeeRate || constants.TAKER_FEE_RATE;
            const breakevenPriceLong = positionState.entryPrice * (1 + feeRate) / (1 - feeRate);
            const breakevenPriceShort = positionState.entryPrice * (1 - feeRate) / (1 + feeRate);
            const isNetProfitable = isLong 
                ? currentPrice > breakevenPriceLong 
                : currentPrice < breakevenPriceShort;
            if (isNetProfitable) {
                changes.hasBeenProfitable = true;
            }
        }

        positionState = { ...positionState, ...changes };
        let hasChanges = Object.keys(changes).length > 0;
    
        const adaptiveTpSignal = getAdaptiveTakeProfit(positionState, this.klines, currentPrice);
        let adaptiveTpTakeProfitApplied = false;

        if (adaptiveTpSignal.newTakeProfit) {
            const newTp = adaptiveTpSignal.newTakeProfit;
            const takeProfitPrice = positionState.takeProfitPrice;
            const isTighter = isLong ? newTp < takeProfitPrice : newTp > takeProfitPrice;
            const isExtension = isLong ? newTp > takeProfitPrice : newTp < takeProfitPrice;

            if (isTighter || isExtension) {
                positionState.takeProfitPrice = newTp;
                if (adaptiveTpSignal.newState) positionState = { ...positionState, ...adaptiveTpSignal.newState };
                hasChanges = true;
                adaptiveTpTakeProfitApplied = true;
            }
        }
    
        const stopCandidates: { price: number; reason: Position['activeStopLossReason']; newState?: Partial<Position> }[] = [];
    
        if (adaptiveTpSignal.newStopLoss && adaptiveTpSignal.activeStopLossReason) {
            stopCandidates.push({
                price: adaptiveTpSignal.newStopLoss,
                reason: adaptiveTpSignal.activeStopLossReason,
                newState: adaptiveTpSignal.newState
            });
        }
    
        if (this.bot.config.isAgentTrailEnabled) {
            const stableKlines = [...this.klines];
            const lastKline = stableKlines.length > 0 ? stableKlines[stableKlines.length - 1] : null;
            
            if (lastKline && !lastKline.isFinal) {
                stableKlines.pop();
            }

            const agentTrailSignal = getAgentExitSignal(positionState, stableKlines, currentPrice, this.bot.config);
            if (agentTrailSignal.newStopLoss !== undefined) {
                 stopCandidates.push({
                    price: agentTrailSignal.newStopLoss,
                    reason: agentTrailSignal.activeStopLossReason || 'Agent Trail',
                    newState: agentTrailSignal.newState
                });
            }
        }
        
        if (this.bot.config.invalidationSensitivity !== 'low') {
             const spikeSignal = getProfitSpikeSignal(positionState, currentPrice);
             if (spikeSignal.newStopLoss) stopCandidates.push({ price: spikeSignal.newStopLoss, reason: 'Profit Secure', newState: spikeSignal.newState });
        }
         const aggressiveTrailSignal = getAggressiveRangeTrailSignal(positionState, currentPrice);
        if (aggressiveTrailSignal.newStopLoss) stopCandidates.push({ price: aggressiveTrailSignal.newStopLoss, reason: 'Profit Secure', newState: aggressiveTrailSignal.newState });
        if (this.bot.config.isBreakevenTrailEnabled) {
            const breakevenSignal = getMandatoryBreakevenSignal(positionState, currentPrice);
            if (breakevenSignal.newStopLoss) stopCandidates.push({ price: breakevenSignal.newStopLoss, reason: 'Breakeven', newState: breakevenSignal.newState });
        }
        if (this.bot.config.isUniversalProfitTrailEnabled) {
            const profitSecureSignal = getMultiStageProfitSecureSignal(positionState, currentPrice);
            if (profitSecureSignal.newStopLoss) stopCandidates.push({ price: profitSecureSignal.newStopLoss, reason: 'Profit Secure', newState: profitSecureSignal.newState });
        }
    
        let bestCandidate: { price: number; reason: Position['activeStopLossReason']; newState?: Partial<Position> } = { 
            price: positionState.stopLossPrice, 
            reason: positionState.activeStopLossReason, 
        };
        
        for (const candidate of stopCandidates) {
            const isValid = isLong ? candidate.price < currentPrice : candidate.price > currentPrice;
            const isTighter = isLong ? candidate.price > bestCandidate.price : candidate.price < bestCandidate.price;
            
            if (isValid && isTighter) {
                bestCandidate = candidate;
            }
        }
    
        if (bestCandidate.price !== positionState.stopLossPrice) {
            let logMessage = `SL moved to ${bestCandidate.price.toFixed(this.bot.config.pricePrecision)} by ${bestCandidate.reason}.`;
            if (adaptiveTpSignal.newStopLoss && bestCandidate.price === adaptiveTpSignal.newStopLoss && adaptiveTpSignal.reason) {
                logMessage = adaptiveTpSignal.reason;
            }
            this.addLog(logMessage, LogType.Action);

            positionState.stopLossPrice = bestCandidate.price;
            positionState.activeStopLossReason = bestCandidate.reason;
            if (bestCandidate.newState) positionState = { ...positionState, ...bestCandidate.newState };
            hasChanges = true;
        } else if (adaptiveTpTakeProfitApplied && !adaptiveTpSignal.newStopLoss) {
             this.addLog(`${adaptiveTpSignal.reason} New TP: ${positionState.takeProfitPrice.toFixed(this.bot.config.pricePrecision)}`, LogType.Info);
        }
    
        if (hasChanges) {
            this.updateState({ openPosition: positionState });
        }
    }
}

class BotManagerService {
    private bots = new Map<string, BotInstance>();
    private handlers: BotHandlers | null = null;
    private onBotListChange: (() => void) | null = null;
    private botUpdateSubscribers = new Map<string, Set<(bot: RunningBot) => void>>();
    private spotWsManager: WebSocketManager;
    private futuresWsManager: WebSocketManager;

    constructor() {
        this.spotWsManager = new WebSocketManager(() => '/proxy-spot-ws');
        this.futuresWsManager = new WebSocketManager(() => '/proxy-futures-ws');
        telegramBotService.register(this);
    }

    public setHandlers(handlers: BotHandlers) {
        this.handlers = handlers;
    }

    public setOnBotListChange(callback: (() => void) | null) {
        this.onBotListChange = callback;
    }

    public subscribeToBotUpdates(botId: string, callback: (bot: RunningBot) => void) {
        if (!this.botUpdateSubscribers.has(botId)) {
            this.botUpdateSubscribers.set(botId, new Set());
        }
        this.botUpdateSubscribers.get(botId)!.add(callback);
    }

    public unsubscribeFromBotUpdates(botId: string, callback: (bot: RunningBot) => void) {
        const subscribers = this.botUpdateSubscribers.get(botId);
        if (subscribers) {
            subscribers.delete(callback);
            if (subscribers.size === 0) {
                this.botUpdateSubscribers.delete(botId);
            }
        }
    }

    public getRunningBots(): RunningBot[] {
        return Array.from(this.bots.values()).map(instance => instance.bot).sort((a, b) => a.id.localeCompare(b.id));
    }

    public getBot(botId: string): BotInstance | undefined {
        return this.bots.get(botId);
    }
    
    private notifyStructuralChange() {
        if (this.onBotListChange) {
            this.onBotListChange();
        }
    }
    
    public addBotLog(botId: string, message: string, type: LogType) {
        const bot = this.bots.get(botId);
        if (bot) {
            bot.addLog(message, type);
        }
    }

    public updateBotState(botId: string, partialState: Partial<RunningBot>) {
        const bot = this.bots.get(botId);
        if (bot) {
            bot.updateState(partialState);
        }
    }
    
    public startBot(config: BotConfig): RunningBot {
        if (!this.handlers) {
            throw new Error("BotManagerService handlers not set. Call setHandlers first.");
        }

        const onUpdate = (updatedBot: RunningBot) => {
            const subscribers = this.botUpdateSubscribers.get(updatedBot.id);
            if (subscribers) {
                subscribers.forEach(cb => cb(updatedBot));
            }
        };

        const newBotInstance = new BotInstance(config, onUpdate, this.handlers);
        this.bots.set(newBotInstance.bot.id, newBotInstance);
        this.notifyStructuralChange();

        this.initializeBot(newBotInstance);
        
        return newBotInstance.bot;
    }

    private async initializeBot(botInstance: BotInstance) {
        const { config } = botInstance.bot;
        try {
            const klines = await binanceService.fetchKlines(
                config.pair.replace('/', ''),
                config.timeFrame,
                { limit: 501, mode: config.mode }
            );
            await botInstance.initialize(klines);
            this.subscribeToBotData(botInstance);
        } catch (error) {
            botInstance.addLog(`Failed to initialize bot: ${error}`, LogType.Error);
            botInstance.updateState({ status: BotStatus.Error, analysis: {signal: 'HOLD', reasons: [`Initialization failed.`]} });
        }
    }

    public pauseBot = (botId: string) => {
        const bot = this.bots.get(botId);
        if (bot && bot.bot.status !== BotStatus.Paused) {
            const accumulatedActiveMs = bot.bot.accumulatedActiveMs + (Date.now() - (bot.bot.lastResumeTimestamp || Date.now()));
            bot.updateState({ status: BotStatus.Paused, lastResumeTimestamp: null, accumulatedActiveMs });
            bot.addLog('Bot paused by user.', LogType.Status);
        }
    };

    public resumeBot = (botId: string) => {
        const bot = this.bots.get(botId);
        if (bot && bot.bot.status === BotStatus.Paused) {
            bot.updateState({ status: BotStatus.Monitoring, lastResumeTimestamp: Date.now() });
            bot.addLog('Bot resumed by user.', LogType.Status);
        }
    };

    public stopBot = async (botId: string) => {
        const bot = this.bots.get(botId);
        if (!bot) return;
    
        bot.updateState({ status: BotStatus.Stopping });
        bot.addLog('Stopping bot...', LogType.Status);
    
        if (bot.bot.openPosition) {
            bot.addLog('Closing open position before stopping...', LogType.Action);
            try {
                // Pass undefined; the handler will find the best available price.
                await this.handlers?.onClosePosition(bot.bot.openPosition, 'Bot Stopped', undefined);
            } catch (e) {
                bot.addLog(`Could not close open position: ${e}`, LogType.Error);
            }
        }
        
        this.releaseBotData(bot.bot.config);
        
        const accumulatedActiveMs = bot.bot.accumulatedActiveMs + (Date.now() - (bot.bot.lastResumeTimestamp || Date.now()));
        bot.updateState({ status: BotStatus.Stopped, lastResumeTimestamp: null, accumulatedActiveMs });
        this.unsubscribeFromBotData(bot);
        bot.addLog('Bot stopped.', LogType.Status);
    };

    public deleteBot = (botId: string) => {
        const bot = this.bots.get(botId);
        if (bot && (bot.bot.status === BotStatus.Stopped || bot.bot.status === BotStatus.Error)) {
            this.releaseBotData(bot.bot.config);
            this.unsubscribeFromBotData(bot);
            this.bots.delete(botId);
            this.notifyStructuralChange();
        } else if (bot) {
            bot.addLog("Cannot delete a running bot. Please stop it first.", LogType.Error);
        }
    };
    
    public updateBotConfig = (botId: string, partialConfig: Partial<BotConfig>) => {
        const bot = this.bots.get(botId);
        if (bot) {
            const newConfig = { ...bot.bot.config, ...partialConfig };
            bot.updateState({ config: newConfig });
            const changes = Object.keys(partialConfig).join(', ');
            bot.addLog(`Configuration updated: ${changes}`, LogType.Info);
            
            this.refreshBotAnalysis(botId);
        }
    }

    public refreshBotAnalysis = (botId: string) => {
        const bot = this.bots.get(botId);
        if (bot && bot.bot.status !== BotStatus.Paused) {
            bot.addLog("Manual analysis refresh triggered.", LogType.Info);
            bot.runAnalysis({ execute: false, reason: "Manual Refresh" });
        }
    };

    public stopAllBots() {
        this.bots.forEach(bot => this.stopBot(bot.bot.id));
        this.spotWsManager.disconnect();
        this.futuresWsManager.disconnect();
    }
    
    public notifyPositionClosed(botId: string, pnl: number) {
        const bot = this.bots.get(botId);
        if (bot && bot.bot.openPosition) {
            const trade = { ...bot.bot.openPosition, pnl };
            const isWin = trade.pnl > 0;
            const wins = bot.bot.wins + (isWin ? 1 : 0);
            const losses = bot.bot.losses + (!isWin ? 1 : 0);

            bot.updateState({
                status: BotStatus.Monitoring,
                openPosition: null,
                openPositionId: null,
                closedTradesCount: bot.bot.closedTradesCount + 1,
                totalPnl: bot.bot.totalPnl + trade.pnl,
                wins,
                losses,
            });
            bot.addLog(`Position closed. PNL: $${pnl.toFixed(2)}. Resuming monitoring.`, isWin ? LogType.Success : LogType.Error);
        }
    }
    
    public notifyTradeExecutionFailed(botId: string, reason: string) {
        const bot = this.bots.get(botId);
        if (bot) {
            bot.notifyTradeExecutionFailed(reason);
        }
    }

    private releaseBotData(config: BotConfig) {
        if (config.isHtfConfirmationEnabled) {
            const htf = config.htfTimeFrame === 'auto' 
                ? TIME_FRAMES[TIME_FRAMES.indexOf(config.timeFrame) + 1] 
                : config.htfTimeFrame;
            if (htf) {
                sharedKlineService.releaseData(config.pair, htf, config.mode);
            }
        }
        const needsLtfData = config.isMomentumConcordanceEnabled || config.agent.id === 14;
        if (needsLtfData) {
            const ltfTimeframe = getMicroTimeframe(config.timeFrame);
            sharedKlineService.releaseData(config.pair, ltfTimeframe, config.mode);
        }
        if (config.agent.id === 14) {
            sharedKlineService.releaseData(config.pair, '1m', config.mode);
        }
        if (config.isBtcCorrelationVetoEnabled) {
            sharedKlineService.releaseData('ETH/BTC', config.timeFrame, TradingMode.Spot);
        }
    }

    private subscribeToBotData(botInstance: BotInstance) {
        const { pair, timeFrame, mode } = botInstance.bot.config;
        const formattedPair = pair.replace('/', '').toLowerCase();

        const tickerStream = `${formattedPair}@ticker`;
        const tickerCallback = (data: any) => {
             const ticker: LiveTicker = { pair: data.s, closePrice: parseFloat(data.c), highPrice: parseFloat(data.h), lowPrice: parseFloat(data.l), volume: parseFloat(data.v), quoteVolume: parseFloat(data.q) };
             botInstance.updateLivePrice(parseFloat(data.c), ticker);
        };
        this.subscribeToTickerUpdates(formattedPair, mode, tickerCallback);
        botInstance.subscriptions.push({ type: 'ticker', pair: formattedPair, mode, callback: tickerCallback });

        const klineStream = `${formattedPair}@kline_${timeFrame}`;
        const klineCallback = (data: any) => {
             const newKline: Kline = { time: data.k.t, open: parseFloat(data.k.o), high: parseFloat(data.k.h), low: parseFloat(data.k.l), close: parseFloat(data.k.c), volume: parseFloat(data.k.v), isFinal: data.k.x };
             botInstance.onMainKlineUpdate(newKline);
        };
        this.subscribeToKlineUpdates(formattedPair, timeFrame, mode, klineCallback);
        botInstance.subscriptions.push({ type: 'kline', pair: formattedPair, timeFrame, mode, callback: klineCallback });
    }

    private unsubscribeFromBotData(botInstance: BotInstance) {
        botInstance.subscriptions.forEach(sub => {
            if (sub.type === 'ticker') {
                this.unsubscribeFromTickerUpdates(sub.pair, sub.mode, sub.callback);
            } else if (sub.type === 'kline') {
                this.unsubscribeFromKlineUpdates(sub.pair, sub.timeFrame!, sub.mode, sub.callback);
            }
        });
        botInstance.subscriptions = [];
    }

    public subscribeToTickerUpdates(pair: string, mode: TradingMode, callback: Function) {
        const wsManager = mode === TradingMode.USDSM_Futures ? this.futuresWsManager : this.spotWsManager;
        wsManager.subscribe(`${pair.toLowerCase()}@ticker`, callback);
    }
    public unsubscribeFromTickerUpdates(pair: string, mode: TradingMode, callback: Function) {
        const wsManager = mode === TradingMode.USDSM_Futures ? this.futuresWsManager : this.spotWsManager;
        wsManager.unsubscribe(`${pair.toLowerCase()}@ticker`, callback);
    }
    public subscribeToKlineUpdates(pair: string, timeFrame: string, mode: TradingMode, callback: Function) {
        const wsManager = mode === TradingMode.USDSM_Futures ? this.futuresWsManager : this.spotWsManager;
        wsManager.subscribe(`${pair.toLowerCase()}@kline_${timeFrame}`, callback);
    }
    public unsubscribeFromKlineUpdates(pair: string, timeFrame: string, mode: TradingMode, callback: Function) {
        const wsManager = mode === TradingMode.USDSM_Futures ? this.futuresWsManager : this.spotWsManager;
        wsManager.unsubscribe(`${pair.toLowerCase()}@kline_${timeFrame}`, callback);
    }
}

export const botManagerService = new BotManagerService();