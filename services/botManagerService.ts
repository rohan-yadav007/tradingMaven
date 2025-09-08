

import { RunningBot, BotConfig, BotStatus, TradeSignal, Kline, BotLogEntry, Position, LiveTicker, LogType, RiskMode, TradingMode, BinanceOrderResponse, TradeManagementSignal, AgentParams, MarketDataContext } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getMultiStageProfitSecureSignal, getAgentExitSignal, getInitialAgentTargets, validateTradeProfitability, getSupervisorSignal, getMandatoryBreakevenSignal, getProfitSpikeSignal, getAggressiveRangeTrailSignal, captureMarketContext } from './localAgentService';
import { DEFAULT_AGENT_PARAMS, TIME_FRAMES, TAKER_FEE_RATE, CHAMELEON_TIMEFRAME_SETTINGS, MIN_PROFIT_BUFFER_MULTIPLIER } from '../constants';
import { telegramBotService } from './telegramBotService';

const MAX_LOG_ENTRIES = 100;
const RECONNECT_DELAY = 5000; // 5 seconds
let nextRequestId = 1;

// --- WebSocket Manager (Proxy Version) ---
class WebSocketManager {
    private ws: WebSocket | null = null;
    private subscriptions = new Map<string, Function[]>();
    private getUrl: () => string;
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private isConnected = false;
    private isConnecting = false;

    constructor(getUrl: () => string) {
        this.getUrl = getUrl;
    }

    private connect() {
        if (this.isConnecting || this.isConnected) return;
        this.isConnecting = true;

        const url = `${this.getUrl()}/stream`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            this.isConnected = true;
            this.isConnecting = false;
            const streamsToSubscribe = Array.from(this.subscriptions.keys());
            if (streamsToSubscribe.length > 0) {
                this.sendSubscriptionMessage('SUBSCRIBE', streamsToSubscribe);
            }
        };

        this.ws.onmessage = (event) => {
            let message;
            try {
                message = JSON.parse(event.data);
            } catch (error) {
                console.error('[WS Manager] Error parsing JSON message:', error, event.data);
                return;
            }

            if (message.stream && message.data) {
                const callbacks = this.subscriptions.get(message.stream);
                if (callbacks) {
                    callbacks.forEach(cb => {
                        try { cb(message.data); } catch (error) { console.error(`[WS Manager] Error in callback for stream ${message.stream}:`, error); }
                    });
                }
            }
        };

        this.ws.onerror = (error) => {
            console.error(`[WS Manager] WebSocket error on connection to ${url}:`, error);
        };

        this.ws.onclose = () => {
            this.isConnected = false;
            this.isConnecting = false;
            if (this.subscriptions.size > 0) {
                this.reconnectTimeout = setTimeout(() => this.connect(), RECONNECT_DELAY);
            }
        };
    }

    private sendSubscriptionMessage(method: 'SUBSCRIBE' | 'UNSUBSCRIBE', params: string[]) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }
        this.ws.send(JSON.stringify({ method, params, id: nextRequestId++ }));
    }

    public subscribe(streamName: string, callback: Function) {
        let callbacks = this.subscriptions.get(streamName);
        if (!callbacks) {
            callbacks = [];
            this.subscriptions.set(streamName, callbacks);
            if (this.isConnected) {
                this.sendSubscriptionMessage('SUBSCRIBE', [streamName]);
            }
        }
        if (!callbacks.includes(callback)) {
            callbacks.push(callback);
        }
        if (!this.isConnected && !this.isConnecting) {
            this.connect();
        }
    }

    public unsubscribe(streamName: string, callback: Function) {
        const callbacks = this.subscriptions.get(streamName);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index > -1) callbacks.splice(index, 1);
            if (callbacks.length === 0) {
                this.subscriptions.delete(streamName);
                if (this.isConnected) {
                    this.sendSubscriptionMessage('UNSUBSCRIBE', [streamName]);
                }
            }
        }
    }

    public disconnect() {
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
        }
        this.subscriptions.clear();
        this.isConnected = false;
        this.isConnecting = false;
    }
}


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
    onClosePosition: (position: Position, exitReason: string, exitPrice: number) => void;
}

class BotInstance {
    public bot: RunningBot;
    public klines: Kline[] = [];
    private onUpdate: () => void;
    private handlers: BotHandlers;
    public subscriptions: { type: 'ticker' | 'kline', pair: string, timeFrame?: string, mode: TradingMode, callback: Function }[] = [];
    private managementInterval: ReturnType<typeof setTimeout> | null = null;

    constructor(config: BotConfig, onUpdate: () => void, handlers: BotHandlers) {
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

        this.updateState({ status: BotStatus.Monitoring, lastResumeTimestamp: Date.now() });

        this.addLog("Performing initial analysis on startup.", LogType.Info);
        const executeOnStart = this.bot.config.entryTiming === 'immediate';
        await this.runAnalysis({ execute: executeOnStart });
        
        this.startManagementLoop();
        this.onUpdate();
    }

    public updateState(partialState: Partial<RunningBot>) {
        this.bot = { ...this.bot, ...partialState };
        this.onUpdate();
    }

    addLog(message: string, type: LogType = LogType.Info) {
        const newLog: BotLogEntry = { timestamp: new Date(), message, type };
        // Use updateState to ensure immutable update
        this.updateState({ log: [newLog, ...this.bot.log].slice(0, MAX_LOG_ENTRIES) });
    }

    public startManagementLoop() {
        if (this.managementInterval) {
            clearTimeout(this.managementInterval);
            this.managementInterval = null;
        }
    
        const scheduleNextRun = () => {
            if ([BotStatus.Paused, BotStatus.Stopping, BotStatus.Stopped, BotStatus.Error].includes(this.bot.status)) {
                return;
            }
    
            const intervalSeconds = this.bot.config.refreshInterval ?? 10;
            
            this.managementInterval = setTimeout(async () => {
                try {
                    if (![BotStatus.Paused, BotStatus.Stopping, BotStatus.Stopped, BotStatus.Error].includes(this.bot.status)) {
                        await this.runPeriodicManagement();
                    }
                } catch (e) {
                    const errorMessage = e instanceof Error ? e.message : String(e);
                    this.addLog(`Error in periodic management loop: ${errorMessage}`, LogType.Error);
                } finally {
                    scheduleNextRun();
                }
            }, intervalSeconds * 1000);
        };
        
        scheduleNextRun();
        const intervalSeconds = this.bot.config.refreshInterval ?? 10;
        this.addLog(`Periodic analysis loop started (${intervalSeconds}s interval).`, LogType.Info);
    }
    
    public stopManagementLoop() {
        if (this.managementInterval) {
            clearTimeout(this.managementInterval);
            this.managementInterval = null;
            this.addLog("Management loop stopped.", LogType.Info);
        }
    }
    
    public async runPeriodicManagement() {
        if ([BotStatus.Paused, BotStatus.Stopped, BotStatus.Error, BotStatus.ExecutingTrade].includes(this.bot.status)) {
            return;
        }
        if (this.klines.length < 50) return;

        const isLookingForEntry = !this.bot.openPosition && this.bot.status === BotStatus.Monitoring;
        const shouldExecute = isLookingForEntry && this.bot.config.entryTiming === 'immediate';

        await this.runAnalysis({ execute: shouldExecute });
    }

    public async runAnalysis(options: { execute: boolean } = { execute: true }) {
        if (this.klines.length < 50) return;

        try {
            const isForEntry = !this.bot.openPosition && this.bot.status === BotStatus.Monitoring;
            const isForManagement = !!this.bot.openPosition;
            
            this.bot.lastAnalysisTimestamp = Date.now();
            
            let htfKlines: Kline[] | undefined;
            if (this.bot.config.isHtfConfirmationEnabled) {
                try {
                    const htf = this.bot.config.htfTimeFrame === 'auto' 
                        ? TIME_FRAMES[TIME_FRAMES.indexOf(this.bot.config.timeFrame) + 1] 
                        : this.bot.config.htfTimeFrame;
                    if (htf) htfKlines = await binanceService.fetchKlines(this.bot.config.pair.replace('/', ''), htf, { limit: 205, mode: this.bot.config.mode });
                } catch(e) { this.addLog(`Warning: could not fetch HTF klines: ${e}`, LogType.Error); }
            }
            
            if (isForEntry && options.execute) {
                const signal = await getTradingSignal(this.bot.config.agent, this.klines, this.bot.config, htfKlines);
                this.updateState({ analysis: signal });

                if (signal.signal !== 'HOLD') {
                    this.updateState({ status: BotStatus.ExecutingTrade });
                    await this.executeTrade(signal, this.klines, htfKlines);
                } else {
                    const primaryReason = signal.reasons.find(r => r.startsWith('❌') || r.startsWith('ℹ️')) || "Conditions not met.";
                    this.addLog(`Analysis: HOLD. ${primaryReason.substring(2)}`, LogType.Info);
                }
            } else if (isForManagement) {
                const { score, reasons } = await getSupervisorSignal(this.bot.openPosition!, this.klines, this.bot.config, htfKlines);

                this.updateState({
                    openPosition: { ...this.bot.openPosition!, invalidationScore: score }
                });

                const sensitivityThreshold = {
                    low: 80,
                    medium: 65,
                    high: 50
                }[this.bot.config.invalidationSensitivity];

                if (score >= sensitivityThreshold) {
                    const reason = `Supervisor Exit: Thesis Invalidated (Score: ${score} >= ${sensitivityThreshold}). Reasons: ${reasons.join(' ')}`;
                    this.addLog(reason, LogType.Action);
                    this.handlers.onClosePosition(this.bot.openPosition!, reason, this.bot.livePrice || 0);
                    return;
                }

            } else { // It's for preview
                const signal = await getTradingSignal(this.bot.config.agent, this.klines, this.bot.config, htfKlines);
                this.updateState({ analysis: signal });
            }
        } catch (error) {
            this.addLog(`Error during analysis: ${error}`, LogType.Error);
        }
    }
    
    public async updateLivePrice(price: number, tickerData: LiveTicker) {
        const expectedPair = this.bot.config.pair.replace('/', '').toLowerCase();
        if (tickerData.pair.toLowerCase() !== expectedPair) return;

        this.updateState({ livePrice: price, liveTicker: tickerData, lastPriceUpdateTimestamp: Date.now() });
        
        if (this.bot.openPosition) {
            await this.managePositionOnTick(price);
            this.checkPriceBoundaries(price);
        }
    }

    public async onMainKlineUpdate(newKline: Kline) {
        const lastKline = this.klines.length > 0 ? this.klines[this.klines.length - 1] : null;

        if (lastKline && newKline.time === lastKline.time) {
            this.klines[this.klines.length - 1] = newKline;
        } else if (!lastKline || newKline.time > lastKline.time) {
            this.klines.push(newKline);
            if (this.klines.length > 500) this.klines.shift();
        }
        this.updateState({ klinesLoaded: this.klines.length });
        
        if (newKline.isFinal) {
            if (this.bot.openPosition) {
                this.updateState({
                    openPosition: { ...this.bot.openPosition, candlesSinceEntry: (this.bot.openPosition.candlesSinceEntry || 0) + 1 }
                });
                // CRITICAL FIX: Run management analysis on candle close to catch invalidations immediately.
                this.addLog(`New candle closed. Running management analysis...`, LogType.Info);
                await this.runAnalysis({ execute: false });
            }
            if (this.bot.config.entryTiming === 'onNextCandle' && this.bot.status === BotStatus.Monitoring) {
                this.addLog(`New ${this.bot.config.timeFrame} candle closed. Running entry analysis...`, LogType.Info);
                await this.runAnalysis({ execute: true });
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

    private async executeTrade(signal: TradeSignal, klinesForAnalysis: Kline[], htfKlines?: Kline[]) {
        const currentPrice = await this.getInitialPriceReliably();
        if (!currentPrice) {
            this.notifyTradeExecutionFailed("Could not determine a valid entry price.");
            return;
        }
        
        const isLong = signal.signal === 'BUY';
        const { config } = this.bot;
        const { stopLossPrice, takeProfitPrice, slReason, agentStopLoss } = getInitialAgentTargets(klinesForAnalysis, currentPrice, isLong ? 'LONG' : 'SHORT', config);
        
        const validation = validateTradeProfitability(currentPrice, stopLossPrice, takeProfitPrice, isLong ? 'LONG' : 'SHORT', this.bot.config);
        if (!validation.isValid) {
            this.notifyTradeExecutionFailed(validation.reason);
            return;
        }

        this.addLog(`Executing ${signal.signal} at ~${currentPrice.toFixed(config.pricePrecision)}. SL: ${stopLossPrice.toFixed(config.pricePrecision)} (${slReason}), TP: ${takeProfitPrice.toFixed(config.pricePrecision)}`, LogType.Action);
        this.addLog(validation.reason, LogType.Success);

        const execSignal: TradeSignal = { ...signal, entryPrice: currentPrice, takeProfitPrice, stopLossPrice };
        const entryContext = captureMarketContext(klinesForAnalysis, htfKlines);
        
        this.handlers.onExecuteTrade(execSignal, this.bot.id, { agentStopLoss, slReason, entryContext });
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
    
        let positionState: Position = { ...this.bot.openPosition };
        const isLong = positionState.direction === 'LONG';
        let changes: Partial<Position> = {};
    
        // Track MFE/MAE and profit status
        const isInProfit = isLong ? currentPrice > positionState.entryPrice : currentPrice < positionState.entryPrice;
        if (!positionState.hasBeenProfitable && isInProfit) changes.hasBeenProfitable = true;
        const peak = positionState.peakPrice ?? positionState.entryPrice;
        if ((isLong && currentPrice > peak) || (!isLong && currentPrice < peak)) changes.peakPrice = currentPrice;
        const trough = positionState.troughPrice ?? positionState.entryPrice;
        if ((isLong && currentPrice < trough) || (!isLong && currentPrice > trough)) changes.troughPrice = currentPrice;
    
        // --- LOGIC REFACTOR: Correctly prioritize Agent Trail ---
    
        // 1. Establish the baseline Stop Loss from the Agent Trail if enabled
        let baselineStop = positionState.stopLossPrice;
        let baselineReason = positionState.activeStopLossReason;
        let baselineNewState: Partial<Position> | undefined = undefined;
    
        if (this.bot.config.isAgentTrailEnabled) {
            const lastFinalKline = this.klines[this.klines.length - 1];
            if (lastFinalKline) {
                const previewKline: Kline = { ...lastFinalKline, high: Math.max(lastFinalKline.high, currentPrice), low: Math.min(lastFinalKline.low, currentPrice), close: currentPrice, isFinal: false };
                const klinesForAnalysis = [...this.klines.slice(0, -1), previewKline];
                const agentTrailSignal = getAgentExitSignal(positionState, klinesForAnalysis, currentPrice, this.bot.config);
                
                if (agentTrailSignal.newStopLoss) {
                    const newAgentSL = agentTrailSignal.newStopLoss;
                    const isValid = isLong ? newAgentSL < currentPrice : newAgentSL > currentPrice;
                    const isImprovement = isLong ? newAgentSL > baselineStop : newAgentSL < baselineStop;
                    
                    // The Agent Trail can move the SL, even wider, as long as it's an improvement over the last known value
                    if (isValid && isImprovement) {
                        baselineStop = newAgentSL;
                        baselineReason = 'Agent Trail';
                        baselineNewState = agentTrailSignal.newState;
                    }
                }
            }
        }
    
        // 2. Now, check if profit-locking mechanisms can provide an even TIGHTER stop loss
        const profitLockCandidates: { price: number; reason: Position['activeStopLossReason']; newState?: Partial<Position> }[] = [
            { price: baselineStop, reason: baselineReason, newState: baselineNewState }
        ];
    
        // The Proactive Exit system is now controlled by the sensitivity level.
        // Higher sensitivity enables more aggressive trailing like spike protection.
        if (this.bot.config.invalidationSensitivity !== 'low') {
            const spikeSignal = getProfitSpikeSignal(positionState, currentPrice);
            if (spikeSignal.newStopLoss) profitLockCandidates.push({ price: spikeSignal.newStopLoss, reason: 'Profit Secure', newState: spikeSignal.newState });
            
            const aggressiveTrailSignal = getAggressiveRangeTrailSignal(positionState, currentPrice);
            if (aggressiveTrailSignal.newStopLoss) profitLockCandidates.push({ price: aggressiveTrailSignal.newStopLoss, reason: 'Profit Secure', newState: aggressiveTrailSignal.newState });
        }
        if (this.bot.config.isBreakevenTrailEnabled) {
            const breakevenSignal = getMandatoryBreakevenSignal(positionState, currentPrice);
            if (breakevenSignal.newStopLoss) profitLockCandidates.push({ price: breakevenSignal.newStopLoss, reason: 'Breakeven', newState: breakevenSignal.newState });
        }
        if (this.bot.config.isUniversalProfitTrailEnabled) {
            const profitSecureSignal = getMultiStageProfitSecureSignal(positionState, currentPrice);
            if (profitSecureSignal.newStopLoss) profitLockCandidates.push({ price: profitSecureSignal.newStopLoss, reason: 'Profit Secure', newState: profitSecureSignal.newState });
        }
    
        // 3. Find the best (tightest) valid stop loss among all candidates
        let bestCandidate = profitLockCandidates[0];
        for (const candidate of profitLockCandidates) {
            const isValid = isLong ? candidate.price < currentPrice : candidate.price > currentPrice;
            const isTighter = isLong ? candidate.price > bestCandidate.price : candidate.price < bestCandidate.price;
            if (isValid && isTighter) {
                bestCandidate = candidate;
            }
        }
    
        // 4. Apply the final, best stop loss if it's different from the original
        if (bestCandidate.price !== positionState.stopLossPrice) {
            const previousSL = positionState.stopLossPrice;
            if (bestCandidate.newState) changes = { ...changes, ...(bestCandidate.newState as Partial<Position>) };
            changes.stopLossPrice = bestCandidate.price;
            changes.activeStopLossReason = bestCandidate.reason;
            this.addLog(`SL updated from ${previousSL.toFixed(this.bot.config.pricePrecision)} to ${bestCandidate.price.toFixed(this.bot.config.pricePrecision)}. Reason: ${bestCandidate.reason}.`, LogType.Info);
        }
        
        // 5. Update the bot's state with all accumulated changes
        if (Object.keys(changes).length > 0) {
            this.updateState({ openPosition: { ...this.bot.openPosition!, ...changes } });
        }
    }
}


class BotManagerService {
    private bots = new Map<string, BotInstance>();
    private spotWsManager = new WebSocketManager(() => '/proxy-spot-ws');
    private futuresWsManager = new WebSocketManager(() => '/proxy-futures-ws');
    private handlers: BotHandlers | null = null;
    private onBotListUpdate: (() => void) | null = null;
    
    constructor() {
        telegramBotService.register(this);
    }

    setHandlers(handlers: BotHandlers, onBotListUpdate: () => void) {
        this.handlers = handlers;
        this.onBotListUpdate = onBotListUpdate;
    }

    public getBot(botId: string): BotInstance | undefined {
        return this.bots.get(botId);
    }
    
    private onBotUpdate = () => {
        if (this.onBotListUpdate) this.onBotListUpdate();
    }

    getRunningBots(): RunningBot[] {
        return Array.from(this.bots.values()).map(instance => instance.bot).sort((a,b) => b.id.localeCompare(a.id));
    }

    startBot(config: BotConfig): RunningBot {
        const newBotInstance = new BotInstance(config, this.onBotUpdate, this.handlers!);
        this.bots.set(newBotInstance.bot.id, newBotInstance);
        this.initializeBot(newBotInstance);
        this.onBotUpdate();
        return newBotInstance.bot;
    }

    private async initializeBot(botInstance: BotInstance) {
        try {
            const { config } = botInstance.bot;
            const klines = await binanceService.fetchKlines(config.pair.replace('/', ''), config.timeFrame, { limit: 500, mode: config.mode });
            await botInstance.initialize(klines);
            this.subscribeBotToStreams(botInstance);
        } catch (error) {
            botInstance.addLog(`Failed to initialize bot: ${error}`, LogType.Error);
            botInstance.updateState({ status: BotStatus.Error });
        }
    }

    private subscribeBotToStreams(bot: BotInstance) {
        const { pair, timeFrame, mode } = bot.bot.config;
        const formattedPair = pair.replace('/', '').toLowerCase();
        const wsManager = mode === TradingMode.USDSM_Futures ? this.futuresWsManager : this.spotWsManager;

        const tickerStream = `${formattedPair}@ticker`;
        const tickerCallback = (data: any) => bot.updateLivePrice(parseFloat(data.c), { pair: data.s, closePrice: parseFloat(data.c), highPrice: parseFloat(data.h), lowPrice: parseFloat(data.l), volume: parseFloat(data.v), quoteVolume: parseFloat(data.q) });
        wsManager.subscribe(tickerStream, tickerCallback);
        bot.subscriptions.push({ type: 'ticker', pair, mode, callback: tickerCallback });

        const klineStream = `${formattedPair}@kline_${timeFrame}`;
        const klineCallback = (data: any) => bot.onMainKlineUpdate({ time: data.k.t, open: parseFloat(data.k.o), high: parseFloat(data.k.h), low: parseFloat(data.k.l), close: parseFloat(data.k.c), volume: parseFloat(data.k.v), isFinal: data.k.x });
        wsManager.subscribe(klineStream, klineCallback);
        bot.subscriptions.push({ type: 'kline', pair, timeFrame, mode, callback: klineCallback });

        bot.addLog(`Subscribed to ${pair} ticker and ${timeFrame} kline streams.`, LogType.Success);
    }

    private unsubscribeBotFromStreams(bot: BotInstance) {
        bot.subscriptions.forEach(sub => {
            const { type, pair, timeFrame, mode, callback } = sub;
            const formattedPair = pair.replace('/', '').toLowerCase();
            const wsManager = mode === TradingMode.USDSM_Futures ? this.futuresWsManager : this.spotWsManager;
            if (type === 'ticker') wsManager.unsubscribe(`${formattedPair}@ticker`, callback);
            else if (type === 'kline') wsManager.unsubscribe(`${formattedPair}@kline_${timeFrame}`, callback);
        });
        bot.subscriptions = [];
        bot.addLog(`Unsubscribed from all streams.`, LogType.Info);
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

    pauseBot = (botId: string) => {
        const bot = this.bots.get(botId);
        if (bot && bot.bot.status !== BotStatus.Paused) {
            bot.stopManagementLoop();
            const activeTime = bot.bot.lastResumeTimestamp ? Date.now() - bot.bot.lastResumeTimestamp : 0;
            bot.updateState({ status: BotStatus.Paused, accumulatedActiveMs: bot.bot.accumulatedActiveMs + activeTime, lastResumeTimestamp: null });
            bot.addLog('Bot paused.', LogType.Status);
        }
    }

    resumeBot = (botId: string) => {
        const bot = this.bots.get(botId);
        if (bot && bot.bot.status === BotStatus.Paused) {
            bot.startManagementLoop();
            bot.updateState({ status: BotStatus.Monitoring, lastResumeTimestamp: Date.now() });
            bot.addLog('Bot resumed.', LogType.Status);
        }
    }

    stopBot = (botId: string) => {
        const bot = this.bots.get(botId);
        if (bot) {
            bot.stopManagementLoop();
            this.unsubscribeBotFromStreams(bot);
            if (bot.bot.openPosition && this.handlers) {
                this.handlers.onClosePosition(bot.bot.openPosition, 'Bot Stopped', bot.bot.livePrice || 0);
            }
            const activeTime = bot.bot.lastResumeTimestamp ? Date.now() - bot.bot.lastResumeTimestamp : 0;
            bot.updateState({ status: BotStatus.Stopped, accumulatedActiveMs: bot.bot.accumulatedActiveMs + activeTime, lastResumeTimestamp: null });
            bot.addLog('Bot stopped.', LogType.Status);
        }
    }

    deleteBot = (botId: string) => {
        const bot = this.bots.get(botId);
        if (bot && (bot.bot.status === BotStatus.Stopped || bot.bot.status === BotStatus.Error)) {
            this.bots.delete(botId);
            this.onBotUpdate();
        }
    }
    
    stopAllBots = () => {
        this.bots.forEach(bot => this.stopBot(bot.bot.id));
        this.spotWsManager.disconnect();
        this.futuresWsManager.disconnect();
    }
    
    addBotLog = (botId: string, message: string, type: LogType = LogType.Info) => this.bots.get(botId)?.addLog(message, type);
    updateBotState = (botId: string, partialState: Partial<RunningBot>) => this.bots.get(botId)?.updateState(partialState);

    notifyPositionClosed = (botId: string, pnl: number) => {
        const bot = this.bots.get(botId);
        if (bot) {
            const isWin = pnl >= 0;
            bot.updateState({
                openPosition: null, openPositionId: null, status: BotStatus.Monitoring,
                totalPnl: bot.bot.totalPnl + pnl,
                wins: bot.bot.wins + (isWin ? 1 : 0),
                losses: bot.bot.losses + (isWin ? 0 : 1),
                closedTradesCount: bot.bot.closedTradesCount + 1,
                lastProfitableTradeDirection: isWin ? bot.bot.openPosition?.direction || null : bot.bot.lastProfitableTradeDirection,
            });
            bot.addLog(`Position closed. Net PNL: $${pnl.toFixed(2)}.`, isWin ? LogType.Success : LogType.Error);
        }
    }

    notifyTradeExecutionFailed = (botId: string, reason: string) => this.bots.get(botId)?.notifyTradeExecutionFailed(reason);
    
    updateBotConfig = (botId: string, partialConfig: Partial<BotConfig>) => {
        const bot = this.bots.get(botId);
        if (bot) {
            const newConfig = { ...bot.bot.config, ...partialConfig };
            bot.updateState({ config: newConfig });
            bot.addLog(`Configuration updated: ${Object.keys(partialConfig).join(', ')}.`, LogType.Info);
            if (partialConfig.refreshInterval !== undefined) {
                bot.stopManagementLoop();
                bot.startManagementLoop();
            }
        }
    }
    
    refreshBotAnalysis = (botId: string) => {
        const bot = this.bots.get(botId);
        if (bot) {
            bot.addLog("Manual analysis refresh triggered.", LogType.Info);
            bot.runAnalysis({ execute: false });
        }
    }
}

export const botManagerService = new BotManagerService();