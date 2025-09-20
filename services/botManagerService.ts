import { RunningBot, BotConfig, BotStatus, TradeSignal, Kline, BotLogEntry, Position, LiveTicker, LogType, TradingMode, MarketDataContext } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getMultiStageProfitSecureSignal, getAgentExitSignal, getInitialAgentTargets, validateTradeProfitability, getSupervisorSignal, getMandatoryBreakevenSignal, getProfitSpikeSignal, getAggressiveRangeTrailSignal, captureMarketContext, getAdaptiveTakeProfit } from './localAgentService';
import { TIME_FRAMES, getMicroTimeframe } from '../constants';
import { telegramBotService } from './telegramBotService';
import { getDynamicEntryVeto } from './vetoService';

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
    private executing = false;

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
    
            const intervalSeconds = this.bot.config.refreshInterval ?? 60;
            
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
        const intervalSeconds = this.bot.config.refreshInterval ?? 60;
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
            // Run preview only
            await this.runAnalysis({ execute: false });
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
            this.bot.lastAnalysisTimestamp = Date.now();
            
            // Create a real-time "preview" kline array for analysis, identical to the UI's approach.
            // This ensures the data used for analysis and execution is perfectly synchronized.
            let klinesForAnalysis = this.klines;
            if (this.bot.livePrice && this.klines.length > 0) {
                const lastKline = this.klines[this.klines.length - 1];
                const previewKline: Kline = {
                    ...lastKline,
                    high: Math.max(lastKline.high, this.bot.livePrice),
                    low: Math.min(lastKline.low, this.bot.livePrice),
                    close: this.bot.livePrice,
                    isFinal: false,
                };
                klinesForAnalysis = [...this.klines.slice(0, -1), previewKline];
            }
            
            let htfKlines: Kline[] | undefined;
            if (this.bot.config.isHtfConfirmationEnabled) {
                try {
                    const htf = this.bot.config.htfTimeFrame === 'auto' 
                        ? TIME_FRAMES[TIME_FRAMES.indexOf(this.bot.config.timeFrame) + 1] 
                        : this.bot.config.htfTimeFrame;
                    if (htf) htfKlines = await binanceService.fetchKlines(this.bot.config.pair.replace('/', ''), htf, { limit: 205, mode: this.bot.config.mode });
                } catch(e) { this.addLog(`Warning: could not fetch HTF klines: ${e}`, LogType.Error); }
            }
            
            const signal = await getTradingSignal(this.bot.config.agent, klinesForAnalysis, this.bot.config, htfKlines);
            this.updateState({ analysis: signal });

            const isForEntry = !this.bot.openPosition && this.bot.status === BotStatus.Monitoring;
            const isForManagement = !!this.bot.openPosition;
            
            if (isForEntry && options.execute) {
                if (signal.signal !== 'HOLD') {
                    if (this.executing) { this.addLog('Execution already in process', LogType.Info); return; }
                    this.executing = true;
                    try {
                        // --- DYNAMIC ENTRY VETO (PRE-FLIGHT CHECK) ---
                        if (this.bot.config.isMomentumConcordanceEnabled) {
                            this.addLog('Performing Momentum Concordance check...', LogType.Info);
                            const livePriceForVeto = this.bot.livePrice || 0;
                            const microTf = getMicroTimeframe(this.bot.config.timeFrame);
                            let microKlines: Kline[] | undefined;
                            try {
                                microKlines = await binanceService.fetchKlines(this.bot.config.pair.replace('/',''), microTf, { limit: 100, mode: this.bot.config.mode });
                            } catch (e) {
                                this.addLog(`Could not fetch ${microTf} data for veto check: ${e instanceof Error ? e.message : String(e)}`, LogType.Error);
                                microKlines = undefined;
                            }
                            
                            const vetoCheck = getDynamicEntryVeto(klinesForAnalysis, livePriceForVeto, signal.signal, this.bot.config, microKlines, microTf);
                            
                            this.addLog(vetoCheck.reason, vetoCheck.veto ? LogType.Error : LogType.Success);
                            
                            if (vetoCheck.veto) {
                                this.updateState({ analysis: { ...signal, signal: 'HOLD', reasons: [vetoCheck.reason, ...signal.reasons] } });
                                return; 
                            }
                        }
                        // --- END OF VETO BLOCK ---

                        this.updateState({ status: BotStatus.ExecutingTrade });
                        await this.executeTrade(signal, klinesForAnalysis, htfKlines);
                    } finally {
                        this.executing = false;
                    }
                } else {
                    const primaryReason = signal.reasons.find(r => r.startsWith('❌') || r.startsWith('ℹ️')) || "Conditions not met.";
                    this.addLog(`Analysis: HOLD. ${primaryReason.substring(2)}`, LogType.Info);
                }
            } else if (isForManagement) {
                const { score, reasons } = await getSupervisorSignal(this.bot.openPosition!, klinesForAnalysis, this.bot.config, htfKlines);

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
        }
    }

    public async onMainKlineUpdate(newKline: Kline) {
        const lastKline = this.klines.length > 0 ? this.klines[this.klines.length - 1] : null;
        const previousLastKline = lastKline ? { ...lastKline } : null;

        if (lastKline && newKline.time === lastKline.time) {
            this.klines[this.klines.length - 1] = newKline;
        } else if (!lastKline || newKline.time > lastKline.time) {
            this.klines.push(newKline);
            if (this.klines.length > 500) this.klines.shift();
        }
        this.updateState({ klinesLoaded: this.klines.length });
        
        if (newKline.isFinal && previousLastKline && newKline.time > previousLastKline.time) {
            if (this.bot.openPosition) {
                const candlesSinceEntry = (this.bot.openPosition.candlesSinceEntry || 0) + 1;
                this.updateState({
                    openPosition: { ...this.bot.openPosition, candlesSinceEntry }
                });

                // Post-Entry Confirmation Candle Check
                if (this.bot.config.isConfirmationCandleEnabled && candlesSinceEntry === 1) {
                    // The "entry candle" is the one that was active when the trade was placed.
                    // Since `newKline` is the first full candle AFTER entry, the entry candle is the one before it.
                    const entryCandle = this.klines[this.klines.length - 2];
                    if (entryCandle) {
                         const isLong = this.bot.openPosition.direction === 'LONG';
                         // Check if the confirmation candle is a strong reversal (e.g., closes below the low of the entry candle for a long)
                         const isContradictory = isLong ? newKline.close < entryCandle.low : newKline.close > entryCandle.high;
                         if (isContradictory) {
                             this.addLog('Confirmation candle failed. Closing position.', LogType.Action);
                             this.handlers.onClosePosition(this.bot.openPosition, 'Confirmation Failed', newKline.close);
                             return; // Exit early to avoid redundant analysis
                         }
                    }
                }
                
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
        
        const validation = validateTradeProfitability(currentPrice, agentStopLoss, takeProfitPrice, isLong ? 'LONG' : 'SHORT', this.bot.config);
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

        // Apply any changes so far to the local state for subsequent logic
        positionState = { ...positionState, ...changes };
        let hasChanges = Object.keys(changes).length > 0;
    
        // --- Step 1: Check for Adaptive Take Profit update ---
        const adaptiveTpSignal = getAdaptiveTakeProfit(positionState, this.klines, currentPrice);
        if (adaptiveTpSignal.newTakeProfit) {
            const newTp = adaptiveTpSignal.newTakeProfit;
            const isTighter = isLong ? newTp < positionState.takeProfitPrice : newTp > positionState.takeProfitPrice;
            const isExtension = isLong ? newTp > positionState.takeProfitPrice : newTp < positionState.takeProfitPrice;

            if (isTighter || isExtension) {
                positionState.takeProfitPrice = newTp;
                if(adaptiveTpSignal.newState) positionState = { ...positionState, ...adaptiveTpSignal.newState };
                this.addLog(`${adaptiveTpSignal.reason} New TP: ${newTp.toFixed(this.bot.config.pricePrecision)}`, LogType.Info);
                hasChanges = true;
            }
        }
    
        // --- Step 2: Gather all potential stop-loss candidates ---
        const stopCandidates: { price: number; reason: Position['activeStopLossReason']; newState?: Partial<Position> }[] = [];
    
        // Candidate from Agent Trail
        if (this.bot.config.isAgentTrailEnabled) {
            const lastFinalKline = [...this.klines].reverse().find(k => k.isFinal);
            if (lastFinalKline) {
                const previewKline: Kline = { ...lastFinalKline, high: Math.max(lastFinalKline.high, currentPrice), low: Math.min(lastFinalKline.low, currentPrice), close: currentPrice, isFinal: false };
                const previewKlines = [...this.klines.slice(0, -1), previewKline];
                const agentTrailSignal = getAgentExitSignal(positionState, previewKlines, currentPrice, this.bot.config);
                if (agentTrailSignal.newStopLoss !== undefined) {
                     stopCandidates.push({
                        price: agentTrailSignal.newStopLoss,
                        reason: agentTrailSignal.activeStopLossReason || 'Agent Trail',
                        newState: agentTrailSignal.newState
                    });
                }
            }
        }
        
        // Other candidates
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
    
        // --- Step 3: Evaluate candidates to find the best valid one ---
        let bestCandidate: { price: number; reason: Position['activeStopLossReason']; newState?: Partial<Position> } = { 
            price: positionState.stopLossPrice, 
            reason: positionState.activeStopLossReason, 
        };
        
        for (const candidate of stopCandidates) {
            // A valid stop must be on the correct side of the current price to be protective.
            const isValid = isLong ? candidate.price < currentPrice : candidate.price > currentPrice;
            // A better stop is tighter (higher for long, lower for short).
            const isTighter = isLong ? candidate.price > bestCandidate.price : candidate.price < bestCandidate.price;
            
            if (isValid && isTighter) {
                bestCandidate = candidate;
            }
        }
    
        if (bestCandidate.price !== positionState.stopLossPrice) {
            positionState.stopLossPrice = bestCandidate.price;
            positionState.activeStopLossReason = bestCandidate.reason;
            if (bestCandidate.newState) positionState = { ...positionState, ...bestCandidate.newState };
            this.addLog(`SL moved to ${bestCandidate.price.toFixed(this.bot.config.pricePrecision)} by ${bestCandidate.reason}.`, LogType.Action);
            hasChanges = true;
        }
    
        if (hasChanges) {
            this.updateState({ openPosition: positionState });
        }
    }
}

class BotManagerService {
    private bots = new Map<string, BotInstance>();
    private handlers: BotHandlers | null = null;
    private onBotsListUpdate: (() => void) | null = null;
    private spotWsManager: WebSocketManager;
    private futuresWsManager: WebSocketManager;

    constructor() {
        this.spotWsManager = new WebSocketManager(() => '/proxy-spot-ws');
        this.futuresWsManager = new WebSocketManager(() => '/proxy-futures-ws');
        telegramBotService.register(this);
    }

    public setHandlers(handlers: BotHandlers, onBotsListUpdate: () => void) {
        this.handlers = handlers;
        this.onBotsListUpdate = onBotsListUpdate;
    }

    public getRunningBots(): RunningBot[] {
        return Array.from(this.bots.values()).map(instance => instance.bot).sort((a, b) => a.id.localeCompare(b.id));
    }

    public getBot(botId: string): BotInstance | undefined {
        return this.bots.get(botId);
    }
    
    private notifyUpdate() {
        if (this.onBotsListUpdate) {
            this.onBotsListUpdate();
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
        const onUpdate = () => this.notifyUpdate();
        const newBotInstance = new BotInstance(config, onUpdate, this.handlers);
        this.bots.set(newBotInstance.bot.id, newBotInstance);
        this.notifyUpdate();

        this.initializeBot(newBotInstance);
        
        return newBotInstance.bot;
    }

    private async initializeBot(botInstance: BotInstance) {
        const { config } = botInstance.bot;
        try {
            const klines = await binanceService.fetchKlines(
                config.pair.replace('/', ''),
                config.timeFrame,
                { limit: 500, mode: config.mode }
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
            bot.stopManagementLoop();
            const accumulatedActiveMs = bot.bot.accumulatedActiveMs + (Date.now() - (bot.bot.lastResumeTimestamp || Date.now()));
            bot.updateState({ status: BotStatus.Paused, lastResumeTimestamp: null, accumulatedActiveMs });
            bot.addLog('Bot paused by user.', LogType.Status);
        }
    };

    public resumeBot = (botId: string) => {
        const bot = this.bots.get(botId);
        if (bot && bot.bot.status === BotStatus.Paused) {
            bot.startManagementLoop();
            bot.updateState({ status: BotStatus.Monitoring, lastResumeTimestamp: Date.now() });
            bot.addLog('Bot resumed by user.', LogType.Status);
        }
    };

    public stopBot = async (botId: string) => {
        const bot = this.bots.get(botId);
        if (!bot) return;

        bot.stopManagementLoop();
        bot.updateState({ status: BotStatus.Stopping });
        bot.addLog('Stopping bot...', LogType.Status);

        if (bot.bot.openPosition) {
            bot.addLog('Closing open position before stopping...', LogType.Action);
            try {
                await this.handlers?.onClosePosition(bot.bot.openPosition, 'Bot Stopped', bot.bot.livePrice || 0);
            } catch (e) {
                bot.addLog(`Could not close open position: ${e}`, LogType.Error);
            }
        }
        
        const accumulatedActiveMs = bot.bot.accumulatedActiveMs + (Date.now() - (bot.bot.lastResumeTimestamp || Date.now()));
        bot.updateState({ status: BotStatus.Stopped, lastResumeTimestamp: null, accumulatedActiveMs });
        this.unsubscribeFromBotData(bot);
        bot.addLog('Bot stopped.', LogType.Status);
    };

    public deleteBot = (botId: string) => {
        const bot = this.bots.get(botId);
        if (bot && (bot.bot.status === BotStatus.Stopped || bot.bot.status === BotStatus.Error)) {
            this.unsubscribeFromBotData(bot);
            this.bots.delete(botId);
            this.notifyUpdate();
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
            if(partialConfig.refreshInterval) {
                bot.stopManagementLoop();
                bot.startManagementLoop();
            }
            this.refreshBotAnalysis(botId);
        }
    }

    public refreshBotAnalysis = (botId: string) => {
        const bot = this.bots.get(botId);
        if (bot && bot.bot.status !== BotStatus.Paused) {
            bot.addLog("Manual analysis refresh triggered.", LogType.Info);
            bot.runAnalysis({ execute: false });
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
