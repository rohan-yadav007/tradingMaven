
// services/botManagerService.ts

import { RunningBot, BotConfig, BotStatus, TradeSignal, Kline, BotLogEntry, Position, LiveTicker, LogType, TradingMode, MarketDataContext, AgentParams } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getMultiStageProfitSecureSignal, getAgentExitSignal, getInitialAgentTargets, validateTradeProfitability, getTradeGuardianSignal, getMandatoryBreakevenSignal, getProfitSpikeSignal, getAggressiveRangeTrailSignal, captureMarketContext, getAdaptiveTakeProfit } from './localAgentService';
import { TIME_FRAMES, getMicroTimeframe } from '../constants';
import { telegramBotService } from './telegramBotService';
import { WebSocketManager } from './webSocketManager';
import { sharedKlineService } from './sharedKlineService';
import * as constants from '../constants';
import { getConfluenceTimeframes, getAstraXRegimeAndDirection } from './agents/astrax';
import { getOmegaSignal, SovereignManagementEngine } from './agents/omega';
import { orderBookService } from './orderBookService';
import { historyService } from './historyService';

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
            slReason: 'Agent Logic' | 'Hard Cap' | 'Noise Floor',
            entryContext: MarketDataContext,
            convictionSizeMultiplier?: number
        }
    ) => Promise<void>;
    onClosePosition: (position: Position, exitReason: string, exitPrice?: number) => void;
}

class BotInstance {
    public bot: RunningBot;
    public klines: Kline[] = [];
    
    public btcKlines: Kline[] | undefined;
    public htfKlines: Kline[] | undefined;
    public ltfKlines: Kline[] | undefined;
    public immediateKlines: Kline[] | undefined;
    public ethBtcKlines: Kline[] | undefined;
    public astraXKlinesMap: Map<string, Kline[]> = new Map();

    private onUpdate: (bot: RunningBot, isStructural: boolean) => void;
    public handlers: BotHandlers;
    public subscriptions: { type: 'ticker' | 'kline', pair: string, timeFrame?: string, mode: TradingMode, callback: Function }[] = [];
    private executing = false;
    private isInitialized: boolean = false;
    private lastManagementTimestamp = 0;
    private lastClosedTradeTimestamp = 0; // Churn protection

    constructor(config: BotConfig, onUpdate: (bot: RunningBot, isStructural: boolean) => void, handlers: BotHandlers) {
        this.bot = {
            id: `bot-${Date.now()}-${config.pair.replace('/', '')}`,
            config,
            status: BotStatus.Starting,
            log: [{ timestamp: new Date(binanceService.getSyncedNow()), message: `Bot created for ${config.pair} on ${config.timeFrame}.`, type: LogType.Info }],
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

    public initialize = async (initialKlines: Kline[]) => {
        this.addLog('Initializing predator matrix...', LogType.Info);
        this.klines = initialKlines;
        this.bot.klinesLoaded = this.klines.length;
        
        const entryMode = this.bot.config.entryTiming === 'immediate' ? 'Tick-based' : 'Candle Close';
        this.addLog(`Predator Mode: ${entryMode}`, LogType.Info);

        this.isInitialized = false; 
        
        const executeOnStart = this.bot.config.entryTiming === 'immediate';
        await this.runAnalysis({ execute: executeOnStart, reason: 'Boot Matrix' });
        
        this.isInitialized = true; 

        if (this.bot.status === BotStatus.Starting) {
            this.updateState({ 
                status: BotStatus.Monitoring, 
                lastResumeTimestamp: binanceService.getSyncedNow(),
            }, true);
        }
    }    

    public updateState = (partialState: Partial<RunningBot>, isStructural: boolean = false) => {
        this.bot = { ...this.bot, ...partialState };
        this.onUpdate(this.bot, isStructural);
    }

    addLog = (message: string, type: LogType = LogType.Info) => {
        const newLogEntry: BotLogEntry = { timestamp: new Date(binanceService.getSyncedNow()), message, type };
        const newLog = [newLogEntry, ...this.bot.log].slice(0, MAX_LOG_ENTRIES);
        this.updateState({ log: newLog }, false);
    }
    
    public runAnalysis = async (options: { execute: boolean, reason: string, klinesOverride?: Kline[] }) => {
        const klinesToUse = options.klinesOverride || this.klines;
        if (klinesToUse.length < 50 && this.bot.config.agent.id !== 19 && this.bot.config.agent.id !== 25) return;

        // V2.0: Churn Protection
        // If a trade was closed within the last 15 minutes, only allow entry if conviction is higher.
        const now = binanceService.getSyncedNow();
        if (options.execute && !this.bot.openPosition && (now - this.lastClosedTradeTimestamp < 15 * 60 * 1000)) {
            const waitMin = Math.ceil((15 * 60 * 1000 - (now - this.lastClosedTradeTimestamp)) / 60000);
            this.addLog(`Churn Veto: Cooldown active for ${waitMin}m to prevent over-trading.`, LogType.Info);
            return;
        }

        try {
            let klinesForAnalysis = klinesToUse;

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

            const signal = await getTradingSignal(
                this.bot.config.agent, 
                klinesForAnalysis, 
                this.bot.config, 
                this.htfKlines, 
                this.immediateKlines, 
                this.ltfKlines, 
                this.ethBtcKlines, 
                this.bot.livePrice,
                this.astraXKlinesMap,
                this.btcKlines
            );
            
            this.updateState({ analysis: signal }, false);
            
            if (options.execute && signal.signal !== 'HOLD') {
                if (this.bot.openPosition) {
                    const isFlipper = [20, 21].includes(this.bot.config.agent.id);
                    if (isFlipper) {
                        const currentPosition = this.bot.openPosition!;
                        const isOpposite = (signal.signal === 'BUY' && currentPosition.direction === 'SHORT') || (signal.signal === 'SELL' && currentPosition.direction === 'LONG');
                        if (isOpposite) {
                            this.updateState({ status: BotStatus.FlipPending }, true);
                            this.handlers.onClosePosition(currentPosition, `Flip: ${signal.signal}`);
                        }
                    }
                } else { 
                    if (this.bot.status === BotStatus.Monitoring || this.bot.status === BotStatus.Starting) {
                        this.updateState({ status: BotStatus.ExecutingTrade }, true);
                        await this.executeTrade(signal, klinesForAnalysis);
                    }
                }
            }
        } catch (error) {
            this.addLog(`Analysis Matrix Error: ${error}`, LogType.Error);
        }
    }
    
    public updateLivePrice = async (price: number, tickerData: LiveTicker) => {
        const expectedPair = this.bot.config.pair.replace('/', '').toLowerCase();
        if (tickerData.pair.toLowerCase() !== expectedPair) return;
    
        const now = binanceService.getSyncedNow();
        const lastUpdate = this.bot.lastPriceUpdateTimestamp || 0;
        if (now - lastUpdate < 100) return;

        this.updateState({ livePrice: price, liveTicker: tickerData, lastPriceUpdateTimestamp: now }, false);

        if (this.bot.openPosition) {
            if (now - this.lastManagementTimestamp >= 500) {
                this.lastManagementTimestamp = now;
                await this.managePositionOnTick(price);
                this.checkPriceBoundaries(price);
            }
        } else if (this.bot.status === BotStatus.Monitoring) {
            if (this.bot.config.entryTiming === 'immediate') {
                const lastAnalysis = this.bot.lastAnalysisTimestamp || 0;
                if (now - lastAnalysis >= 2000) { 
                    if (this.executing) return; 
                    this.updateState({ lastAnalysisTimestamp: now }, false);
                    this.executing = true;
                    try {
                        await this.runAnalysis({ execute: true, reason: "Tick-Handshake" });
                    } finally {
                        this.executing = false;
                    }
                }
            }
        }
    }

    public onMainKlineUpdate = async (newKline: Kline) => {
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
    
        if (isNewCandle && closedCandle && this.bot.config.entryTiming === 'onNextCandle' && this.bot.status === BotStatus.Monitoring && !this.bot.openPosition) {
            if (this.executing) return;
            this.executing = true;
            try {
                await this.runAnalysis({ execute: true, reason: `Closed Matrix`, klinesOverride: this.klines.slice(0, -1) });
            } finally {
                this.executing = false;
            }
        }
    
        if (newKline.isFinal && this.bot.openPosition) {
            const openPosition = this.bot.openPosition;
            const candlesSinceEntry = (openPosition.candlesSinceEntry || 0) + 1;
            this.updateState({ openPosition: { ...openPosition, candlesSinceEntry } }, false);
            await this.runAnalysis({ execute: true, reason: "Matrix Management" });
        }
    }

    private async getInitialPriceReliably(): Promise<number | null> {
        if (this.bot.livePrice) return this.bot.livePrice;
        const formattedPair = this.bot.config.pair.replace('/', '');
        try {
            return this.bot.config.mode === TradingMode.USDSM_Futures
                ? await binanceService.fetchFuturesTickerPrice(formattedPair)
                : await binanceService.fetchTickerPrice(formattedPair);
        } catch (e) { return this.klines.length > 0 ? this.klines[this.klines.length - 1].close : null; }
    }
    
    public notifyTradeExecutionFailed = (reason: string) => {
        this.addLog(`Execution Aborted: ${reason}`, LogType.Error);
        this.updateState({ status: BotStatus.Monitoring }, true);
    }

    private async executeTrade(signal: TradeSignal, klinesForExecution: Kline[]) {
        const currentPrice = await this.getInitialPriceReliably();
        if (!currentPrice) {
            this.notifyTradeExecutionFailed("Price Sync Failure");
            return;
        }
        
        const isLong = signal.signal === 'BUY';
        const { config } = this.bot;
        
        // For Omega (Agent 25), the signal ALREADY provides calculated SL/TP based on 5x Fee Law.
        // We override the default risk logic with the signal's values.
        const stopLossPrice = signal.stopLossPrice ?? 0;
        const takeProfitPrice = signal.takeProfitPrice ?? 0;
        const agentStopLoss = stopLossPrice;
        const slReason = 'Agent Logic';

        // Perform final profitability check just in case, but Omega should have already vetoed it.
        const validation = validateTradeProfitability(currentPrice, agentStopLoss, takeProfitPrice, isLong ? 'LONG' : 'SHORT', config);
        if (!validation.isValid && config.agent.id !== 20) { 
            this.notifyTradeExecutionFailed(validation.reason);
            return;
        }

        let convictionMultiplier = 1.0;
        // V3 Omega: Uses signal.omegaAnalysis?.sizing.multiplier if available
        if (config.agent.id === 25 && signal.omegaAnalysis?.sizing?.multiplier) {
            convictionMultiplier = signal.omegaAnalysis.sizing.multiplier;
        } else if (config.isDynamicSizingEnabled && signal.omegaAnalysis?.conviction) {
            const score = signal.omegaAnalysis.conviction;
            convictionMultiplier = score >= 90 ? 1.0 : score >= 80 ? 0.75 : 0.50;
        }

        this.addLog(`Executing ${signal.signal}. SL: ${stopLossPrice.toFixed(config.pricePrecision)} (${slReason}).`, LogType.Action);

        const execSignal: TradeSignal = { ...signal, entryPrice: currentPrice, takeProfitPrice, stopLossPrice };
        const entryContext = captureMarketContext(klinesForExecution, undefined, config.agentParams);
        
        await this.handlers.onExecuteTrade(execSignal, this.bot.id, { 
            agentStopLoss, slReason, entryContext, convictionSizeMultiplier: convictionMultiplier
        });
    }

    private checkPriceBoundaries(price: number) {
        const { openPosition } = this.bot;
        if (!openPosition) return;
        const isLong = openPosition.direction === 'LONG';
        const slCondition = isLong ? price <= openPosition.stopLossPrice : price >= openPosition.stopLossPrice;
        const tpCondition = isLong ? price >= openPosition.takeProfitPrice : price <= openPosition.takeProfitPrice;
        
        if (slCondition) {
            this.handlers.onClosePosition(openPosition, 'Stop Loss Hit', openPosition.stopLossPrice);
        } else if (tpCondition) {
            this.handlers.onClosePosition(openPosition, 'Take Profit Hit', price);
        }
    }

    private async managePositionOnTick(currentPrice: number) {
        if (!this.bot.openPosition) return;
        if ([20, 21].includes(this.bot.config.agent.id)) return;
    
        const guardianConfig = this.bot.openPosition.botConfigSnapshot;
        if (guardianConfig?.isTradeGuardianEnabled) {
            const guardianSignal = getTradeGuardianSignal(this.bot.openPosition, this.klines, this.immediateKlines, currentPrice, this.btcKlines);
            if (guardianSignal.action === 'close') {
                this.addLog(guardianSignal.reason!, LogType.Action);
                this.handlers.onClosePosition(this.bot.openPosition, guardianSignal.reason!, currentPrice);
                return;
            }
        }
    
        let positionState: Position = { ...this.bot.openPosition };
        const isLong = positionState.direction === 'LONG';
        let changes: Partial<Position> = {};
    
        const peak = positionState.peakPrice ?? positionState.entryPrice;
        if ((isLong && currentPrice > peak) || (!isLong && currentPrice < peak)) changes.peakPrice = currentPrice;
        const trough = positionState.troughPrice ?? positionState.entryPrice;
        if ((isLong && currentPrice < trough) || (!isLong && currentPrice > trough)) changes.troughPrice = currentPrice;

        positionState = { ...positionState, ...changes };
        let hasChanges = Object.keys(changes).length > 0;
    
        const stopCandidates: { price: number; reason: Position['activeStopLossReason']; newState?: Partial<Position> }[] = [];
    
        // OMEGA SOVEREIGN BRAIN (V3.0)
        if (this.bot.config.agent.id === 25) {
            const omegaBrainSignal = SovereignManagementEngine.manage(positionState, currentPrice, this.klines, this.astraXKlinesMap);
            if (omegaBrainSignal.newStopLoss) stopCandidates.push({ price: omegaBrainSignal.newStopLoss, reason: omegaBrainSignal.activeStopLossReason || 'Sovereign Ratchet' });
        }
    
        if (this.bot.config.isAgentTrailEnabled) {
            const agentTrailSignal = getAgentExitSignal(positionState, this.klines, currentPrice, this.bot.config);
            if (agentTrailSignal.newStopLoss !== undefined) stopCandidates.push({ price: agentTrailSignal.newStopLoss, reason: agentTrailSignal.activeStopLossReason || 'Agent Trail' });
        }
        
        if (this.bot.config.isUniversalProfitTrailEnabled) {
            const profitSecureSignal = getMultiStageProfitSecureSignal(positionState, currentPrice);
            if (profitSecureSignal.newStopLoss) stopCandidates.push({ price: profitSecureSignal.newStopLoss, reason: 'Profit Secure', newState: profitSecureSignal.newState });
        }
    
        let bestCandidate = { price: positionState.stopLossPrice, reason: positionState.activeStopLossReason };
        for (const candidate of stopCandidates) {
            const isValid = isLong ? candidate.price < currentPrice : candidate.price > currentPrice;
            const isTighter = isLong ? candidate.price > bestCandidate.price : candidate.price < bestCandidate.price;
            if (isValid && isTighter) bestCandidate = candidate;
        }
    
        if (bestCandidate.price !== positionState.stopLossPrice) {
            positionState.stopLossPrice = bestCandidate.price;
            positionState.activeStopLossReason = bestCandidate.reason;
            hasChanges = true;
        }
    
        if (hasChanges) this.updateState({ openPosition: positionState }, false);
    }

    public onPositionClosed = () => {
        this.lastClosedTradeTimestamp = binanceService.getSyncedNow();
    }
}

class BotManagerService {
    private bots: Map<string, BotInstance> = new Map();
    private onBotListChange: (() => void) | null = null;
    private handlers: BotHandlers | null = null;
    private tickerSubscriptions: Map<string, Function[]> = new Map();
    private wsManagerSpot: WebSocketManager;
    private wsManagerFutures: WebSocketManager;
    private botUpdateSubscribers: Map<string, ((bot: RunningBot) => void)[]> = new Map();
    
    private dailyLossLimit: number = 0; 
    private circuitBreakerInterval: ReturnType<typeof setInterval> | null = null;

    constructor() {
        this.wsManagerSpot = new WebSocketManager(() => '/proxy-spot-ws');
        this.wsManagerFutures = new WebSocketManager(() => '/proxy-futures-ws');
        this.circuitBreakerInterval = setInterval(() => this.checkCircuitBreaker(), 5000);
    }
    
    public setDailyLossLimit(limit: number) { this.dailyLossLimit = limit; }
    
    private checkCircuitBreaker() {
        if (this.dailyLossLimit <= 0) return;
        const realizedPnlToday = historyService.getDailyRealizedPnl();
        let unrealizedPnlTotal = 0;
        this.bots.forEach(bot => {
            const pos = bot.bot.openPosition;
            if (pos && bot.bot.livePrice) {
                const isLong = pos.direction === 'LONG';
                unrealizedPnlTotal += (bot.bot.livePrice - pos.entryPrice) * pos.size * (isLong ? 1 : -1);
            }
        });
        if (realizedPnlToday + unrealizedPnlTotal < -this.dailyLossLimit) this.triggerCircuitBreaker();
    }

    private triggerCircuitBreaker() {
        this.bots.forEach(bot => {
            if (bot.bot.openPosition && bot.bot.livePrice) this.handlers?.onClosePosition(bot.bot.openPosition, '🚨 CIRCUIT BREAKER', bot.bot.livePrice);
        });
        this.stopAllBots();
    }

    public setHandlers(handlers: BotHandlers) { this.handlers = handlers; }
    public setOnBotListChange(callback: (() => void) | null) { this.onBotListChange = callback; }
    private notifyBotListChange() { if (this.onBotListChange) this.onBotListChange(); }
    private notifyBotUpdate(bot: RunningBot) {
        const subscribers = this.botUpdateSubscribers.get(bot.id);
        if (subscribers) subscribers.forEach(cb => cb(bot));
    }

    public startBot = (config: BotConfig): RunningBot => {
        const onUpdate = (updatedBot: RunningBot, isStructural: boolean) => { 
            this.notifyBotUpdate(updatedBot); 
            if (isStructural) this.notifyBotListChange(); 
        };
        const botInstance = new BotInstance(config, onUpdate, this.handlers!);
        this.bots.set(botInstance.bot.id, botInstance);
        this.initializeBot(botInstance);
        this.notifyBotListChange();
        return botInstance.bot;
    }

    private async initializeBot(botInstance: BotInstance) {
        const { config } = botInstance.bot;
        try {
            const klines = await sharedKlineService.getData(config.pair, config.timeFrame, config.mode);
            this.subscribeToKlines(botInstance);
            const tickerCallback = (data: any) => botInstance.updateLivePrice(parseFloat(data.c), { pair: data.s, closePrice: parseFloat(data.c), highPrice: parseFloat(data.h), lowPrice: parseFloat(data.k || data.l), volume: parseFloat(data.v), quoteVolume: parseFloat(data.q) });
            this.subscribeToTickerUpdates(config.pair, config.mode, tickerCallback);
            botInstance.subscriptions.push({ type: 'ticker', pair: config.pair, mode: config.mode, callback: tickerCallback });
            orderBookService.subscribe(config.pair, config.mode);
            
            // --- OMEGA V3: FORCE ALL TIMEFRAMES ---
            if (config.agent.id === 25) {
                const matrixTfs = ['1m', '5m', '15m', '1h', '4h', '1d'];
                await Promise.all(matrixTfs.map(async (tf) => { 
                    try { 
                        // Don't subscribe to the main TF again if it's already there
                        if (tf !== config.timeFrame) {
                            const data = await sharedKlineService.getData(config.pair, tf, config.mode); 
                            botInstance.astraXKlinesMap.set(tf, data); 
                        }
                    } catch(e) {} 
                }));
                // Also explicitly set map for main TF
                botInstance.astraXKlinesMap.set(config.timeFrame, klines);
            }

            if (config.isHtfConfirmationEnabled) {
                const htf = config.htfTimeFrame === 'auto' ? TIME_FRAMES[TIME_FRAMES.indexOf(config.timeFrame) + 1] : config.htfTimeFrame;
                if (htf) try { botInstance.htfKlines = await sharedKlineService.getData(config.pair, htf, config.mode); } catch(e) {}
            }
            await botInstance.initialize(klines);
        } catch (e) { botInstance.updateState({ status: BotStatus.Error }, true); }
    }

    private subscribeToKlines(botInstance: BotInstance) {
        const { config } = botInstance.bot;
        const stream = `${config.pair.replace('/', '').toLowerCase()}@kline_${config.timeFrame}`;
        const ws = config.mode === TradingMode.USDSM_Futures ? this.wsManagerFutures : this.wsManagerSpot;
        const cb = (data: any) => botInstance.onMainKlineUpdate({ time: data.k.t, open: parseFloat(data.k.o), high: parseFloat(data.k.h), low: parseFloat(data.k.l), close: parseFloat(data.k.c), volume: parseFloat(data.k.v), isFinal: data.k.x });
        ws.subscribe(stream, cb);
        botInstance.subscriptions.push({ type: 'kline', pair: config.pair, timeFrame: config.timeFrame, mode: config.mode, callback: cb });
    }

    public stopBot = (botId: string) => { const bot = this.bots.get(botId); if (bot) { bot.updateState({ status: BotStatus.Stopped }, true); this.cleanupBotSubscriptions(bot); } }
    public pauseBot = (botId: string) => { const bot = this.bots.get(botId); if (bot) bot.updateState({ status: BotStatus.Paused }, true); }
    public resumeBot = (botId: string) => { const bot = this.bots.get(botId); if (bot) bot.updateState({ status: BotStatus.Monitoring, lastResumeTimestamp: Date.now() }, true); }
    public deleteBot = (botId: string) => { const bot = this.bots.get(botId); if (bot) { this.cleanupBotSubscriptions(bot); this.bots.delete(botId); this.notifyBotListChange(); } }

    private cleanupBotSubscriptions(bot: BotInstance) {
        bot.subscriptions.forEach(sub => {
            const ws = sub.mode === TradingMode.USDSM_Futures ? this.wsManagerFutures : this.wsManagerSpot;
            if (sub.type === 'kline') ws.unsubscribe(`${sub.pair.replace('/', '').toLowerCase()}@kline_${sub.timeFrame}`, sub.callback);
            else if (sub.type === 'ticker') this.unsubscribeFromTickerUpdates(sub.pair, sub.mode, sub.callback);
        });
        const { config } = bot.bot;
        orderBookService.unsubscribe(config.pair, config.mode);
        sharedKlineService.releaseData(config.pair, config.timeFrame, config.mode);
        bot.astraXKlinesMap.forEach((_, tf) => sharedKlineService.releaseData(config.pair, tf, config.mode));
    }

    public getRunningBots(): RunningBot[] { return Array.from(this.bots.values()).map(b => b.bot); }
    public getBot(botId: string): BotInstance | undefined { return this.bots.get(botId); }
    public updateBotConfig = (botId: string, partial: Partial<BotConfig>) => { const bot = this.bots.get(botId); if (bot) bot.updateState({ config: { ...bot.bot.config, ...partial } }, true); }
    public refreshBotAnalysis = (botId: string) => { const bot = this.bots.get(botId); if (bot) bot.runAnalysis({ execute: false, reason: "Manual Refresh" }); }
    public stopAllBots() { this.bots.forEach(bot => this.stopBot(bot.bot.id)); this.wsManagerSpot.disconnect(); this.wsManagerFutures.disconnect(); }

    public subscribeToTickerUpdates(pair: string, mode: TradingMode, callback: Function) {
        const ws = mode === TradingMode.USDSM_Futures ? this.wsManagerFutures : this.wsManagerSpot;
        const stream = `${pair.replace('/', '').toLowerCase()}@ticker`;
        let cbs = this.tickerSubscriptions.get(stream);
        if (!cbs) { cbs = []; this.tickerSubscriptions.set(stream, cbs); ws.subscribe(stream, (data: any) => { const list = this.tickerSubscriptions.get(stream); if (list) list.forEach(cb => cb(data)); }); }
        cbs.push(callback);
    }

    public unsubscribeFromTickerUpdates(pair: string, mode: TradingMode, callback: Function) {
        const stream = `${pair.replace('/', '').toLowerCase()}@ticker`;
        const cbs = this.tickerSubscriptions.get(stream);
        if (cbs) { const i = cbs.indexOf(callback); if (i > -1) cbs.splice(i, 1); if (cbs.length === 0) this.tickerSubscriptions.delete(stream); }
    }
    
    public subscribeToBotUpdates(botId: string, callback: (bot: RunningBot) => void) {
        let subs = this.botUpdateSubscribers.get(botId);
        if (!subs) { subs = []; this.botUpdateSubscribers.set(botId, subs); }
        subs.push(callback);
    }

    public unsubscribeFromBotUpdates(botId: string, callback: (bot: RunningBot) => void) {
        const subs = this.botUpdateSubscribers.get(botId);
        if (subs) { const i = subs.indexOf(callback); if (i > -1) subs.splice(i, 1); }
    }

    public addBotLog(botId: string, message: string, type: LogType) { const bot = this.bots.get(botId); if (bot) bot.addLog(message, type); }
    public updateBotState(botId: string, state: Partial<RunningBot>) { const bot = this.bots.get(botId); if (bot) bot.updateState(state, true); }

    public notifyPositionClosed(botId: string, netPnl: number) {
        const bot = this.bots.get(botId);
        if (bot) {
            const isWin = netPnl > 0;
            bot.updateState({
                status: BotStatus.Monitoring, openPosition: null, openPositionId: null,
                totalPnl: bot.bot.totalPnl + netPnl, wins: bot.bot.wins + (isWin ? 1 : 0), losses: bot.bot.losses + (isWin ? 0 : 1),
                closedTradesCount: bot.bot.closedTradesCount + 1,
            }, true);
            bot.onPositionClosed();
            bot.addLog(`Closed. PNL: ${netPnl.toFixed(2)}`, isWin ? LogType.Success : LogType.Info);
        }
    }

    public notifyTradeExecutionFailed(botId: string, reason: string) { const bot = this.bots.get(botId); if (bot) bot.notifyTradeExecutionFailed(reason); }
}

export const botManagerService = new BotManagerService();
telegramBotService.register(botManagerService);
