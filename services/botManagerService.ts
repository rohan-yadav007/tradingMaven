import { RunningBot, BotConfig, BotStatus, TradeSignal, Kline, BotLogEntry, Position, LiveTicker, LogType, RiskMode, TradingMode, BinanceOrderResponse } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getUniversalProfitTrailSignal, getAgentExitSignal, getInitialAgentTargets, validateTradeProfitability } from './localAgentService';
import { DEFAULT_AGENT_PARAMS, MAX_STOP_LOSS_PERCENT_OF_INVESTMENT, TIME_FRAMES } from '../constants';
import { telegramBotService } from './telegramBotService';

const MAX_LOG_ENTRIES = 100;
const RECONNECT_DELAY = 5000; // 5 seconds
let nextRequestId = 1;

// --- New WebSocket Manager for Combined Streams ---
class WebSocketManager {
    private ws: WebSocket | null = null;
    private subscriptions = new Map<string, Function[]>();
    private getUrl: () => string;
    private reconnectTimeout: number | null = null;
    private isConnected = false;
    private isConnecting = false;
    private pendingSubscriptions: string[] = [];

    constructor(getUrl: () => string) {
        this.getUrl = getUrl;
    }

    private connect() {
        if (this.isConnecting || this.isConnected) return;
        this.isConnecting = true;

        const url = `${this.getUrl()}/stream`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log(`[WS Manager] Connected to ${url}`);
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
                        try {
                            cb(message.data);
                        } catch (error) {
                            console.error(`[WS Manager] Error in callback for stream ${message.stream}:`, error);
                        }
                    });
                }
            }
        };

        this.ws.onerror = (error) => {
            console.error(`[WS Manager] WebSocket error on connection to ${url}:`, error);
        };

        this.ws.onclose = () => {
            console.log(`[WS Manager] Disconnected from ${url}`);
            this.isConnected = false;
            this.isConnecting = false;
            if (this.subscriptions.size > 0) { // Only reconnect if there are active subscriptions
                this.reconnectTimeout = window.setTimeout(() => this.connect(), RECONNECT_DELAY);
            }
        };
    }

    private sendSubscriptionMessage(method: 'SUBSCRIBE' | 'UNSUBSCRIBE', params: string[]) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn(`[WS Manager] WS not open, cannot send ${method} message.`);
            return;
        }
        this.ws.send(JSON.stringify({
            method,
            params,
            id: nextRequestId++,
        }));
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
            if (index > -1) {
                callbacks.splice(index, 1);
            }

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
            slReason: 'Agent Logic' | 'Hard Cap'
        }
    ) => Promise<void>;
    onClosePosition: (position: Position, exitReason: string, exitPrice: number) => void;
}

class BotInstance {
    public bot: RunningBot;
    public klines: Kline[] = []; // Main timeframe klines
    private onUpdate: () => void;
    private handlers: BotHandlers;
    public subscriptions: { type: 'ticker' | 'kline', pair: string, timeFrame?: string, mode: TradingMode, callback: Function }[] = [];

    constructor(
        config: BotConfig,
        onUpdate: () => void,
        handlers: BotHandlers
    ) {
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

        this.bot.status = BotStatus.Monitoring;
        this.bot.lastResumeTimestamp = Date.now(); // Start tracking uptime

        this.addLog("Performing initial analysis on startup.", LogType.Info);
        await this.runAnalysis();

        this.onUpdate();
    }

    addLog(message: string, type: LogType = LogType.Info) {
        const newLog: BotLogEntry = { timestamp: new Date(), message, type };
        this.bot.log = [newLog, ...this.bot.log].slice(0, MAX_LOG_ENTRIES);
        this.onUpdate();
    }

    private async runAnalysis() {
        try {
            if (this.bot.openPosition || ![BotStatus.Monitoring].includes(this.bot.status)) {
                return;
            }

            if (this.klines.length < 50) { // Ensure enough data for indicators
                this.addLog('Analysis skipped: insufficient kline data.', LogType.Info);
                return;
            }

            if (this.handlers) {
                this.addLog('Performing analysis on new completed kline.', LogType.Action);

                let htfKlines: Kline[] | undefined = undefined;
                if (this.bot.config.isHtfConfirmationEnabled) {
                    try {
                        const htf = this.bot.config.htfTimeFrame === 'auto' 
                            ? TIME_FRAMES[TIME_FRAMES.indexOf(this.bot.config.timeFrame) + 1] 
                            : this.bot.config.htfTimeFrame;
                        
                        if (htf) {
                            this.addLog(`Fetching ${htf} data for trend confirmation...`, LogType.Info);
                            htfKlines = await binanceService.fetchKlines(this.bot.config.pair.replace('/', ''), htf, { limit: 205, mode: this.bot.config.mode }); 
                        }
                    } catch (e) {
                        this.addLog(`Warning: Could not fetch HTF klines: ${e}`, LogType.Error);
                    }
                }

                const signal = await getTradingSignal(this.bot.config.agent, this.klines, this.bot.config, htfKlines);
                this.bot.analysis = signal;

                if (signal.signal !== 'HOLD') {
                    this.updateState({ status: BotStatus.ExecutingTrade });
                    await this.executeTrade(signal);
                } else {
                    const primaryReason = signal.reasons.find(r => r.startsWith('❌') || r.startsWith('ℹ️')) || "Conditions not met.";
                    this.addLog(`Analysis: HOLD. ${primaryReason.substring(2)}`, LogType.Info);
                }
            }
        } catch (error) {
            this.addLog(`Error during analysis: ${error}`, LogType.Error);
        } finally {
            this.onUpdate();
        }
    }

    public updateLivePrice(price: number, tickerData: LiveTicker) {
        const expectedPair = this.bot.config.pair.replace('/', '').toLowerCase();
        if (tickerData.pair.toLowerCase() !== expectedPair) {
            return;
        }

        this.bot.livePrice = price;
        this.bot.liveTicker = tickerData;
        this.bot.lastPriceUpdateTimestamp = Date.now();
        
        if (this.bot.openPosition) {
            this.checkPriceBoundaries(price);
            this.proactiveTradeManagement(price);
        }

        const isEligibleForPreview = [BotStatus.Monitoring].includes(this.bot.status);
        if (isEligibleForPreview && this.klines.length > 0 && !this.bot.openPosition) {
            
            const lastFinalKline = this.klines[this.klines.length - 1];
            const previewKline: Kline = {
                ...lastFinalKline,
                high: Math.max(lastFinalKline.high, price),
                low: Math.min(lastFinalKline.low, price),
                close: price,
                isFinal: false
            };
            const previewKlines = [...this.klines.slice(0, -1), previewKline];
            
            getTradingSignal(this.bot.config.agent, previewKlines, this.bot.config)
                .then(signal => {
                    if ([BotStatus.Monitoring].includes(this.bot.status)) {
                        this.bot.analysis = signal;
                        this.onUpdate();
                    }
                }).catch(e => { /* Silently fail for UI preview */ });
        }

        this.onUpdate();
    }

    public onMainKlineUpdate(newKline: Kline) {
        const lastKline = this.klines.length > 0 ? this.klines[this.klines.length - 1] : null;

        if (lastKline && newKline.time === lastKline.time) {
            this.klines[this.klines.length - 1] = newKline;
        } else if (!lastKline || newKline.time > lastKline.time) {
            this.klines.push(newKline);
            if (this.klines.length > 500) this.klines.shift();
        }
        this.bot.klinesLoaded = this.klines.length;
        
        if (newKline.isFinal) {
            this.bot.lastAnalysisTimestamp = new Date().getTime();
            if (this.bot.openPosition) {
                this.addLog(`Final kline on ${this.bot.config.timeFrame}. Managing open position.`, LogType.Info);
                this.managePositionOnKlineClose();
            } else if ([BotStatus.Monitoring].includes(this.bot.status)) {
                 this.addLog(`Final kline on ${this.bot.config.timeFrame}. Running analysis for new entry.`, LogType.Info);
                 this.runAnalysis();
            }
        }
        
        this.onUpdate();
    }

    public updateState(partialState: Partial<RunningBot>) {
        this.bot = { ...this.bot, ...partialState };
        this.onUpdate();
    }

    private async getInitialPriceReliably(): Promise<number | null> {
        if (this.bot.livePrice) return this.bot.livePrice;

        const { config } = this.bot;
        const formattedPair = config.pair.replace('/', '');

        try {
            const price = config.mode === TradingMode.USDSM_Futures
                ? await binanceService.fetchFuturesTickerPrice(formattedPair)
                : await binanceService.fetchTickerPrice(formattedPair);
            return price;
        } catch (e) {
            this.addLog(`Could not fetch price reliably: ${e}`, LogType.Error);
            if (this.klines.length > 0) {
                return this.klines[this.klines.length - 1].close;
            }
            return null;
        }
    }

    private async executeTrade(signal: TradeSignal) {
        if (!this.handlers?.onExecuteTrade) {
            this.addLog("Execution handler not available.", LogType.Error);
            this.updateState({ status: BotStatus.Monitoring });
            return;
        }

        const currentPrice = await this.getInitialPriceReliably();
        if (!currentPrice) {
            this.notifyTradeExecutionFailed("Could not determine a valid entry price.");
            return;
        }

        const agentTargets = getInitialAgentTargets(this.klines, currentPrice, signal.signal === 'BUY' ? 'LONG' : 'SHORT', this.bot.config.timeFrame, { ...DEFAULT_AGENT_PARAMS, ...this.bot.config.agentParams }, this.bot.config.agent.id);

        let finalTp = agentTargets.takeProfitPrice;
        if (this.bot.config.isTakeProfitLocked) {
            const positionValue = this.bot.config.mode === TradingMode.USDSM_Futures ? this.bot.config.investmentAmount * this.bot.config.leverage : this.bot.config.investmentAmount;
            const tradeSize = positionValue / currentPrice;
            if (this.bot.config.takeProfitMode === RiskMode.Percent) {
                const profitAmount = this.bot.config.investmentAmount * (this.bot.config.takeProfitValue / 100);
                finalTp = signal.signal === 'BUY' ? currentPrice + (profitAmount / tradeSize) : currentPrice - (profitAmount / tradeSize);
            } else {
                finalTp = signal.signal === 'BUY' ? currentPrice + (this.bot.config.takeProfitValue / tradeSize) : currentPrice - (this.bot.config.takeProfitValue / tradeSize);
            }
        }
        
        const agentStopLoss = agentTargets.stopLossPrice;
        let finalSl = agentStopLoss;
        let slReason: 'Agent Logic' | 'Hard Cap' = 'Agent Logic';

        const positionValueForCap = this.bot.config.mode === TradingMode.USDSM_Futures ? this.bot.config.investmentAmount * this.bot.config.leverage : this.bot.config.investmentAmount;
        const tradeSizeForCap = positionValueForCap / currentPrice;

        if (tradeSizeForCap > 0) {
            let maxLossAmount = this.bot.config.investmentAmount * (MAX_STOP_LOSS_PERCENT_OF_INVESTMENT / 100);
            if (this.bot.config.mode === TradingMode.USDSM_Futures) {
                maxLossAmount *= this.bot.config.leverage;
            }

            const hardCapStopLossPrice = signal.signal === 'BUY' 
                ? currentPrice - (maxLossAmount / tradeSizeForCap) 
                : currentPrice + (maxLossAmount / tradeSizeForCap);

            const isLong = signal.signal === 'BUY';
            const tighterSl = isLong
                ? Math.max(finalSl, hardCapStopLossPrice)
                : Math.min(finalSl, hardCapStopLossPrice);

            if (tighterSl !== finalSl) {
                slReason = 'Hard Cap';
            }
            finalSl = tighterSl;
        }

        const validation = validateTradeProfitability(currentPrice, finalSl, finalTp, signal.signal === 'BUY' ? 'LONG' : 'SHORT', this.bot.config);
        if (!validation.isValid) {
            this.notifyTradeExecutionFailed(validation.reason);
            return;
        }

        this.addLog(`Executing ${signal.signal} at ~${currentPrice.toFixed(this.bot.config.pricePrecision)}. SL: ${finalSl.toFixed(this.bot.config.pricePrecision)} (${slReason}), TP: ${finalTp.toFixed(this.bot.config.pricePrecision)}`, LogType.Action);
        this.addLog(validation.reason, LogType.Success);

        const execSignal: TradeSignal = {
            ...signal,
            entryPrice: currentPrice,
            takeProfitPrice: finalTp,
            stopLossPrice: finalSl,
        };
        
        this.handlers.onExecuteTrade(
            execSignal, 
            this.bot.id,
            { agentStopLoss, slReason }
        );
    }

    private checkPriceBoundaries(livePrice: number) {
        const { openPosition } = this.bot;
        if (!openPosition || !this.handlers) return;

        const { onClosePosition } = this.handlers;
        const isLong = openPosition.direction === 'LONG';
        
        const slCondition = isLong ? livePrice <= openPosition.stopLossPrice : livePrice >= openPosition.stopLossPrice;
        const tpCondition = isLong ? livePrice >= openPosition.takeProfitPrice : livePrice <= openPosition.takeProfitPrice;

        if (slCondition) {
            onClosePosition(openPosition, openPosition.activeStopLossReason === 'Universal Trail' || openPosition.activeStopLossReason === 'Agent Trail' ? 'Trailing Stop Hit' : 'Stop Loss Hit', openPosition.stopLossPrice);
        } else if (tpCondition) {
            onClosePosition(openPosition, 'Take Profit Hit', openPosition.takeProfitPrice);
        }
    }

    private async proactiveTradeManagement(currentPrice: number) {
        const { openPosition, config } = this.bot;
        if (!openPosition || !this.handlers || !config.isUniversalProfitTrailEnabled) {
            return;
        }
    
        const mgmtSignal = getUniversalProfitTrailSignal(openPosition, currentPrice, config);
    
        if (mgmtSignal.newStopLoss && mgmtSignal.newStopLoss !== openPosition.stopLossPrice) {
            const isLong = openPosition.direction === 'LONG';
            if ((isLong && mgmtSignal.newStopLoss > openPosition.stopLossPrice) || (!isLong && mgmtSignal.newStopLoss < openPosition.stopLossPrice)) {
                this.addLog(`Proactive trail updated SL to ${mgmtSignal.newStopLoss.toFixed(config.pricePrecision)}. Reason: ${mgmtSignal.reasons.join(' ')}`, LogType.Info);
                const newPositionState: Position = { 
                    ...this.bot.openPosition!, 
                    stopLossPrice: mgmtSignal.newStopLoss,
                    activeStopLossReason: 'Universal Trail' 
                };
                this.updateState({ openPosition: newPositionState });
            }
        }
    }

    private async managePositionOnKlineClose() {
        const { openPosition, config } = this.bot;
        if (!openPosition || !this.handlers) return;

        const currentPriceForManagement = this.bot.livePrice || this.klines[this.klines.length - 1]?.close;
        if (!currentPriceForManagement) return;

        let updatedPositionData: Partial<Position> = {};
        let hasUpdate = false;

        if (!config.isUniversalProfitTrailEnabled && this.klines.length > 5) {
            const slSignal = getAgentExitSignal(openPosition, this.klines, currentPriceForManagement, config);

            if (slSignal.closePosition) {
                this.addLog(`Agent exit triggered: ${slSignal.reasons.join(' ')}`, LogType.Action);
                this.handlers.onClosePosition(openPosition, `Agent Exit: ${slSignal.reasons.join(' ')}`, currentPriceForManagement);
                return;
            }
            
            if (slSignal.newStopLoss && slSignal.newStopLoss !== openPosition.stopLossPrice) {
                this.addLog(`Agent trailing stop updated to ${slSignal.newStopLoss.toFixed(config.pricePrecision)}. Reason: ${slSignal.reasons.join(' ')}`, LogType.Info);
                updatedPositionData.stopLossPrice = slSignal.newStopLoss;
                updatedPositionData.activeStopLossReason = 'Agent Trail';
                hasUpdate = true;
            } else {
                this.addLog(`Agent trail check: No improved SL found. Conditions not met for update.`, LogType.Info);
            }
        }

        if (config.isTrailingTakeProfitEnabled) {
            const isLong = openPosition.direction === 'LONG';
            const isInProfit = isLong ? currentPriceForManagement > openPosition.entryPrice : currentPriceForManagement < openPosition.entryPrice;

            if (isInProfit) {
                const agentTargets = getInitialAgentTargets(this.klines, currentPriceForManagement, isLong ? 'LONG' : 'SHORT', config.timeFrame, { ...DEFAULT_AGENT_PARAMS, ...config.agentParams }, config.agent.id);
                const newTp = agentTargets.takeProfitPrice;
                
                const currentTp = updatedPositionData.takeProfitPrice || openPosition.takeProfitPrice;
                const isTpImprovement = isLong ? newTp > currentTp : newTp < currentTp;

                if (isTpImprovement) {
                    this.addLog(`Trailing TP updated to ${newTp.toFixed(config.pricePrecision)}.`, LogType.Info);
                    updatedPositionData.takeProfitPrice = newTp;
                    hasUpdate = true;
                }
            }
        }

        if (hasUpdate) {
            const newPositionState: Position = { ...this.bot.openPosition!, ...updatedPositionData };
            this.updateState({ openPosition: newPositionState });
        }
    }


    public notifyTradeExecutionFailed(reason: string) {
        this.addLog(`Trade execution failed: ${reason}`, LogType.Error);
        this.updateState({ status: BotStatus.Monitoring });
        if (this.bot.config.executionMode === 'live') {
            telegramBotService.sendMessage(
`🚨 *LIVE TRADE FAILED* 🚨

Bot for *${this.bot.config.pair}* failed to execute a trade.

*Reason:* ${reason}

The bot is now back in monitoring mode. No action is required, but please review the bot's log.`
            );
        }
    }

    public stop() {
        if (this.bot.lastResumeTimestamp) {
            this.bot.accumulatedActiveMs += Date.now() - this.bot.lastResumeTimestamp;
            this.bot.lastResumeTimestamp = null;
        }
        this.updateState({ status: BotStatus.Stopped });
        this.addLog('Bot stopped.', LogType.Status);
    }

    public pause() {
        if (this.bot.status === BotStatus.Paused) return;
        if (this.bot.lastResumeTimestamp) {
            this.bot.accumulatedActiveMs += Date.now() - this.bot.lastResumeTimestamp;
            this.bot.lastResumeTimestamp = null;
        }
        this.updateState({ status: BotStatus.Paused });
        this.addLog('Bot paused.', LogType.Status);
    }

    public resume() {
        if (this.bot.status !== BotStatus.Paused) return;
        this.bot.lastResumeTimestamp = Date.now();
        this.updateState({ status: this.bot.openPosition ? BotStatus.PositionOpen : BotStatus.Monitoring });
        this.addLog('Bot resumed.', LogType.Status);
    }
}

class BotManagerService {
    private bots: Map<string, BotInstance> = new Map();
    private handlers: BotHandlers | null = null;
    private onUpdateCallback: (() => void) | null = null;

    // Combined stream managers
    private spotStreamManager: WebSocketManager;
    private futuresStreamManager: WebSocketManager;

    constructor() {
        this.spotStreamManager = new WebSocketManager(() => this.getWebSocketUrl(TradingMode.Spot));
        this.futuresStreamManager = new WebSocketManager(() => this.getWebSocketUrl(TradingMode.USDSM_Futures));
    }

    public setHandlers(handlers: BotHandlers, onUpdateCallback: () => void) {
        this.handlers = handlers;
        this.onUpdateCallback = onUpdateCallback;
    }
    
    public getRunningBots(): RunningBot[] {
        return Array.from(this.bots.values()).map(instance => instance.bot).sort((a, b) => a.id > b.id ? -1 : 1);
    }

    private updateState() {
        if (this.onUpdateCallback) {
            this.onUpdateCallback();
        }
    }

    private getWebSocketUrl(mode: TradingMode): string {
        const isProd = import.meta.env?.PROD;
        if (isProd) {
            return mode === TradingMode.USDSM_Futures ? 'wss://fstream.binance.com' : 'wss://stream.binance.com';
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const proxyPath = mode === TradingMode.USDSM_Futures ? '/proxy-futures-ws' : '/proxy-spot-ws';

        return `${protocol}//${host}${proxyPath}`;
    }

    public startBot(config: BotConfig): RunningBot {
        if (!this.handlers) {
            throw new Error("BotManagerService handlers not set. Cannot start bot.");
        }
        const instance = new BotInstance(config, () => this.updateState(), this.handlers);
        this.bots.set(instance.bot.id, instance);
        this.addBotLog(instance.bot.id, `Starting bot...`, LogType.Status);

        const formattedPair = config.pair.replace('/', '');
        
        binanceService.fetchKlines(formattedPair, config.timeFrame, { limit: 500, mode: config.mode })
            .then(mainKlines => {
                instance.initialize(mainKlines);
                
                const mainKlineCallback = (data: any) => {
                    const kline: Kline = {
                        time: data.k.t, open: parseFloat(data.k.o), high: parseFloat(data.k.h),
                        low: parseFloat(data.k.l), close: parseFloat(data.k.c),
                        volume: parseFloat(data.k.v), isFinal: data.k.x
                    };
                    instance.onMainKlineUpdate(kline)
                };
                instance.subscriptions.push({ type: 'kline', pair: formattedPair.toLowerCase(), timeFrame: config.timeFrame, mode: config.mode, callback: mainKlineCallback });
                this.subscribeToKlineUpdates(formattedPair.toLowerCase(), config.timeFrame, config.mode, mainKlineCallback);
            })
            .catch(e => {
                this.addBotLog(instance.bot.id, `Failed to fetch initial klines: ${e}`, LogType.Error);
                instance.updateState({ status: BotStatus.Error });
            });

        const tickerCallback = (data: any) => {
            const ticker: LiveTicker = {
                pair: data.s, closePrice: parseFloat(data.c), highPrice: parseFloat(data.h),
                lowPrice: parseFloat(data.l), volume: parseFloat(data.v), quoteVolume: parseFloat(data.q)
            };
            instance.updateLivePrice(ticker.closePrice, ticker);
        };
        instance.subscriptions.push({ type: 'ticker', pair: formattedPair.toLowerCase(), mode: config.mode, callback: tickerCallback });
        this.subscribeToTickerUpdates(formattedPair.toLowerCase(), config.mode, tickerCallback);
        
        this.updateState();
        return instance.bot;
    }

    public stopBot(botId: string) {
        const bot = this.getBot(botId);
        if (bot) {
            bot.stop();
            this.updateState();
        }
    }

    public deleteBot(botId: string) {
        const instance = this.bots.get(botId);
        if (instance) {
            instance.subscriptions.forEach(sub => {
                if (sub.type === 'ticker') {
                    this.unsubscribeFromTickerUpdates(sub.pair, sub.mode, sub.callback);
                } else if (sub.type === 'kline' && sub.timeFrame) {
                    this.unsubscribeFromKlineUpdates(sub.pair, sub.timeFrame, sub.mode, sub.callback);
                }
            });
            instance.stop();
            this.bots.delete(botId);
        }
        this.updateState();
    }

    public pauseBot(botId: string) {
        this.getBot(botId)?.pause();
    }

    public resumeBot(botId: string) {
        this.getBot(botId)?.resume();
    }

    public getBot(botId: string): BotInstance | undefined {
        return this.bots.get(botId);
    }

    public addBotLog(botId: string, message: string, type: LogType) {
        this.getBot(botId)?.addLog(message, type);
    }

    public updateBotState(botId: string, partialState: Partial<RunningBot>) {
        this.getBot(botId)?.updateState(partialState);
    }

    public updateBotConfig(botId: string, partialConfig: Partial<BotConfig>) {
        const bot = this.getBot(botId);
        if (bot) {
            const oldConfig = bot.bot.config;
            const newConfig = { ...oldConfig, ...partialConfig };
            bot.bot.config = newConfig;

            if (bot.bot.openPosition) {
                 this.addBotLog(botId, "Configuration updated. Proactive management rules will apply on the next tick.", LogType.Info);
            } else {
                 this.addBotLog(botId, "Configuration updated.", LogType.Info);
            }
            this.updateState();
        }
    }

    public stopAllBots() {
        this.bots.forEach(bot => bot.stop());
        this.spotStreamManager.disconnect();
        this.futuresStreamManager.disconnect();
        this.updateState();
    }

    public updateKlines(pair: string, timeFrame: string, klines: Kline[]) {
        this.bots.forEach(bot => {
            if (bot.bot.config.pair.replace('/', '') === pair && bot.bot.config.timeFrame === timeFrame) {
                bot.klines = klines;
                bot.bot.klinesLoaded = klines.length;
                this.updateState();
            }
        });
    }

    public notifyPositionClosed(botId: string, pnl: number) {
        const bot = this.getBot(botId);
        if (bot) {
            const isWin = pnl >= 0;
            const statusUpdate: Partial<RunningBot> = {
                openPositionId: null,
                openPosition: null,
                closedTradesCount: bot.bot.closedTradesCount + 1,
                totalPnl: bot.bot.totalPnl + pnl,
                wins: bot.bot.wins + (isWin ? 1 : 0),
                losses: bot.bot.losses + (isWin ? 0 : 1),
                totalGrossProfit: bot.bot.totalGrossProfit + (pnl > 0 ? pnl : 0),
                totalGrossLoss: bot.bot.totalGrossLoss + (pnl < 0 ? Math.abs(pnl) : 0),
                status: BotStatus.Monitoring,
            };
            bot.addLog(`Trade closed. Resuming monitoring.`, LogType.Status);
            bot.updateState(statusUpdate);
        }
    }

    public notifyTradeExecutionFailed(botId: string, reason: string) {
        this.getBot(botId)?.notifyTradeExecutionFailed(reason);
    }

    // --- Public Subscription Methods (using WebSocketManager) ---

    public subscribeToTickerUpdates(pair: string, mode: TradingMode, callback: (data: any) => void) {
        const streamName = `${pair.toLowerCase()}@ticker`;
        const manager = mode === TradingMode.USDSM_Futures ? this.futuresStreamManager : this.spotStreamManager;
        manager.subscribe(streamName, callback);
    }

    public unsubscribeFromTickerUpdates(pair: string, mode: TradingMode, callback: Function) {
        const streamName = `${pair.toLowerCase()}@ticker`;
        const manager = mode === TradingMode.USDSM_Futures ? this.futuresStreamManager : this.spotStreamManager;
        manager.unsubscribe(streamName, callback);
    }

    public subscribeToKlineUpdates(pair: string, timeFrame: string, mode: TradingMode, callback: (data: any) => void) {
        const streamName = `${pair.toLowerCase()}@kline_${timeFrame}`;
        const manager = mode === TradingMode.USDSM_Futures ? this.futuresStreamManager : this.spotStreamManager;
        manager.subscribe(streamName, callback);
    }

    public unsubscribeFromKlineUpdates(pair: string, timeFrame: string, mode: TradingMode, callback: Function) {
        const streamName = `${pair.toLowerCase()}@kline_${timeFrame}`;
        const manager = mode === TradingMode.USDSM_Futures ? this.futuresStreamManager : this.spotStreamManager;
        manager.unsubscribe(streamName, callback);
    }
}

export const botManagerService = new BotManagerService();