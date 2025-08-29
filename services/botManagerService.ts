import { RunningBot, BotConfig, BotStatus, TradeSignal, Kline, BotLogEntry, Position, LiveTicker, LogType, RiskMode, TradingMode, BinanceOrderResponse, TradeManagementSignal, AgentParams } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getMultiStageProfitSecureSignal, getAgentExitSignal, getInitialAgentTargets, validateTradeProfitability, getSupervisorSignal, getMandatoryBreakevenSignal, getProfitSpikeSignal, getAdaptiveTakeProfit, getAggressiveRangeTrailSignal } from './localAgentService';
import { DEFAULT_AGENT_PARAMS, TIME_FRAMES, TAKER_FEE_RATE, CHAMELEON_TIMEFRAME_SETTINGS, MIN_PROFIT_BUFFER_MULTIPLIER } from '../constants';
import { telegramBotService } from './telegramBotService';

const MAX_LOG_ENTRIES = 100;
const RECONNECT_DELAY = 5000; // 5 seconds
let nextRequestId = 1;

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
    public isFlippingPosition = false;
    private managementInterval: number | null = null;

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
        const executeOnStart = this.bot.config.entryTiming === 'immediate';
        await this.runAnalysis(false, { execute: executeOnStart });
        
        this.startManagementLoop();

        this.onUpdate();
    }

    addLog(message: string, type: LogType = LogType.Info) {
        const newLog: BotLogEntry = { timestamp: new Date(), message, type };
        this.bot.log = [newLog, ...this.bot.log].slice(0, MAX_LOG_ENTRIES);
        this.onUpdate();
    }

    public startManagementLoop() {
        if (this.managementInterval) {
            window.clearTimeout(this.managementInterval);
            this.managementInterval = null;
        }
    
        const scheduleNextRun = () => {
            if ([BotStatus.Paused, BotStatus.Stopping, BotStatus.Stopped, BotStatus.Error].includes(this.bot.status)) {
                return;
            }
    
            const intervalSeconds = this.bot.config.refreshInterval ?? 30;
            const now = new Date();
            const currentSeconds = now.getSeconds();
            const currentMilliseconds = now.getMilliseconds();
            
            const secondsIntoInterval = currentSeconds % intervalSeconds;
            let msToWait = (intervalSeconds - secondsIntoInterval) * 1000 - currentMilliseconds;
    
            if (msToWait < 0) {
                msToWait += intervalSeconds * 1000;
            }
    
            this.managementInterval = window.setTimeout(async () => {
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
            }, msToWait);
        };
        
        scheduleNextRun();
        const intervalSeconds = this.bot.config.refreshInterval ?? 30;
        this.addLog(`Aligned management loop started (${intervalSeconds}s interval).`, LogType.Info);
    }
    
    public stopManagementLoop() {
        if (this.managementInterval) {
            window.clearTimeout(this.managementInterval);
            this.managementInterval = null;
            this.addLog("Management loop stopped.", LogType.Info);
        }
    }

    public async runPeriodicManagement() {
        if ([BotStatus.Paused, BotStatus.Stopped, BotStatus.Error, BotStatus.ExecutingTrade].includes(this.bot.status)) {
            return;
        }
        if (this.klines.length < 50 || !this.bot.livePrice || this.bot.livePrice <= 0) {
            return;
        }
        
        const lastFinalKline = this.klines[this.klines.length - 1];
        const previewKline: Kline = {
            ...lastFinalKline,
            high: Math.max(lastFinalKline.high, this.bot.livePrice),
            low: Math.min(lastFinalKline.low, this.bot.livePrice),
            close: this.bot.livePrice,
            isFinal: false,
        };
        const klinesForAnalysis = [...this.klines.slice(0, -1), previewKline];

        if (this.bot.config.entryTiming === 'immediate' && this.bot.status === BotStatus.Monitoring) {
            await this.runAnalysis(false, { execute: true }, klinesForAnalysis);
        } else {
            await this.refreshAnalysisPreview(klinesForAnalysis);
        }
    
        if (this.bot.openPosition) {
            await this.managePositionOnPeriodicAnalysis(klinesForAnalysis);
        }
    }

    public async refreshAnalysisPreview(klinesOverride?: Kline[]) {
        const klinesToUse = klinesOverride || this.klines;
        if (klinesToUse.length < 50) {
            return;
        }
        this.addLog('Refreshing analysis preview...', LogType.Info);

        let htfKlines: Kline[] | undefined = undefined;
        try {
            if (this.bot.config.isHtfConfirmationEnabled) {
                const htf = this.bot.config.htfTimeFrame === 'auto'
                    ? TIME_FRAMES[TIME_FRAMES.indexOf(this.bot.config.timeFrame) + 1]
                    : this.bot.config.htfTimeFrame;

                if (htf) {
                    htfKlines = await binanceService.fetchKlines(this.bot.config.pair.replace('/', ''), htf, { limit: 205, mode: this.bot.config.mode });
                }
            }
        } catch (e) {
            this.addLog(`Warning: Could not fetch HTF klines for preview: ${e}`, LogType.Error);
        }

        const signal = await getTradingSignal(this.bot.config.agent, klinesToUse, this.bot.config, htfKlines);
        this.updateState({ analysis: signal });
        this.onUpdate();
    }

    public async runAnalysis(isFlipAttempt: boolean = false, options: { execute: boolean } = { execute: true }, klinesOverride?: Kline[]) {
        const klinesToUse = klinesOverride || this.klines;
        try {
            if (this.bot.openPosition || (!isFlipAttempt && ![BotStatus.Monitoring].includes(this.bot.status))) {
                return;
            }

            if (klinesToUse.length < 50) {
                this.addLog('Analysis skipped: insufficient kline data.', LogType.Info);
                return;
            }

            if (this.handlers) {
                this.addLog(isFlipAttempt ? 'Analysis for position flip...' : 'Performing entry analysis...', LogType.Action);

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

                const signal = await getTradingSignal(this.bot.config.agent, klinesToUse, this.bot.config, htfKlines);
                this.bot.analysis = signal;

                if (signal.signal !== 'HOLD') {
                    if (isFlipAttempt) {
                        const flipDirection = this.bot.openPosition?.direction === 'LONG' ? 'SELL' : 'BUY';
                        if (signal.signal !== flipDirection) {
                            this.addLog(`Flip aborted: new signal (${signal.signal}) does not oppose current position.`, LogType.Info);
                            this.isFlippingPosition = false;
                            return;
                        }
                    }
                    
                    if (options.execute) {
                        this.updateState({ status: BotStatus.ExecutingTrade });
                        await this.executeTrade(signal, klinesToUse);
                    } else {
                        this.addLog(`Initial analysis found a ${signal.signal} signal. Waiting for the current candle to close before taking action.`, LogType.Info);
                    }
                } else {
                    const primaryReason = signal.reasons.find(r => r.startsWith('❌') || r.startsWith('ℹ️')) || "Conditions not met.";
                    this.addLog(`Analysis: HOLD. ${primaryReason.substring(2)}`, LogType.Info);
                }
            }
        } catch (error) {
            this.addLog(`Error during analysis: ${error}`, LogType.Error);
        } finally {
            if (isFlipAttempt) this.isFlippingPosition = false;
            this.onUpdate();
        }
    }

    public async updateLivePrice(price: number, tickerData: LiveTicker) {
        const expectedPair = this.bot.config.pair.replace('/', '').toLowerCase();
        if (tickerData.pair.toLowerCase() !== expectedPair) {
            return;
        }

        this.bot.livePrice = price;
        this.bot.liveTicker = tickerData;
        this.bot.lastPriceUpdateTimestamp = Date.now();
        
        if (this.bot.openPosition) {
            this.checkPriceBoundaries(price);
            await this.managePositionOnTick(price);
        }

        this.onUpdate();
    }

    public async onMainKlineUpdate(newKline: Kline) {
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
                if(this.bot.openPosition.candlesSinceEntry !== undefined) {
                    const newPosition = { ...this.bot.openPosition, candlesSinceEntry: this.bot.openPosition.candlesSinceEntry + 1 };
                    this.updateState({openPosition: newPosition});
                }
            }
            if (this.bot.config.entryTiming === 'onNextCandle' && this.bot.status === BotStatus.Monitoring) {
                this.addLog(`New ${this.bot.config.timeFrame} candle closed. Running entry analysis...`, LogType.Info);
                await this.runAnalysis();
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
    
    public notifyTradeExecutionFailed(reason: string) {
        this.addLog(`Trade execution failed: ${reason}`, LogType.Error);
        this.updateState({ status: BotStatus.Monitoring });
    }

    private async executeTrade(signal: TradeSignal, klinesForAnalysis: Kline[]) {
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
        
        const isLong = signal.signal === 'BUY';
        const { config } = this.bot;

        const { stopLossPrice, takeProfitPrice, slReason, agentStopLoss } = getInitialAgentTargets(klinesForAnalysis, currentPrice, isLong ? 'LONG' : 'SHORT', config);
        
        let finalTp = takeProfitPrice;
        
        const positionValue = config.investmentAmount * (config.mode === TradingMode.USDSM_Futures ? config.leverage : 1);
        const tradeSize = positionValue / currentPrice;
        if (tradeSize > 0) {
            const roundTripFee = positionValue * TAKER_FEE_RATE * 2;
            const feeInPrice = roundTripFee / tradeSize;
            const minProfitDistance = feeInPrice * MIN_PROFIT_BUFFER_MULTIPLIER;
            const rewardDistance = Math.abs(finalTp - currentPrice);

            if (rewardDistance < minProfitDistance) {
                const originalTp = finalTp;
                finalTp = isLong ? currentPrice + minProfitDistance : currentPrice - minProfitDistance;
                this.addLog(`TP target of ${originalTp.toFixed(config.pricePrecision)} was within fee zone. Adjusted to ${finalTp.toFixed(config.pricePrecision)}.`, LogType.Info);
            }
        }
        
        const validation = validateTradeProfitability(currentPrice, stopLossPrice, finalTp, signal.signal === 'BUY' ? 'LONG' : 'SHORT', this.bot.config);
        if (!validation.isValid) {
            this.notifyTradeExecutionFailed(validation.reason);
            return;
        }

        this.addLog(`Executing ${signal.signal} at ~${currentPrice.toFixed(this.bot.config.pricePrecision)}. SL: ${stopLossPrice.toFixed(this.bot.config.pricePrecision)} (${slReason}), TP: ${finalTp.toFixed(this.bot.config.pricePrecision)}`, LogType.Action);
        this.addLog(validation.reason, LogType.Success);

        const execSignal: TradeSignal = {
            ...signal,
            entryPrice: currentPrice,
            takeProfitPrice: finalTp,
            stopLossPrice: stopLossPrice,
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
            onClosePosition(openPosition, openPosition.activeStopLossReason.includes('Trail') || openPosition.activeStopLossReason.includes('Secure') || openPosition.activeStopLossReason === 'Breakeven' ? 'Trailing Stop Hit' : 'Stop Loss Hit', openPosition.stopLossPrice);
        } else if (tpCondition) {
            onClosePosition(openPosition, 'Take Profit Hit', openPosition.takeProfitPrice);
        }
    }

    private async managePositionOnTick(currentPrice: number) {
        if (!this.bot.openPosition || !this.handlers) return;
    
        let positionState: Position = { ...this.bot.openPosition };
        const isLong = positionState.direction === 'LONG';
        let hasChanged = false;
    
        // --- 1. Live P&L and MFE/MAE tracking ---
        const isInProfit = isLong ? currentPrice > positionState.entryPrice : currentPrice < positionState.entryPrice;
        if (!positionState.hasBeenProfitable && isInProfit) {
            positionState.hasBeenProfitable = true;
            hasChanged = true;
        }
        const currentPeak = positionState.peakPrice ?? positionState.entryPrice;
        if ((isLong && currentPrice > currentPeak) || (!isLong && currentPrice < currentPeak)) {
            positionState.peakPrice = currentPrice;
            hasChanged = true;
        }
        const currentTrough = positionState.troughPrice ?? positionState.entryPrice;
        if ((isLong && currentPrice < currentTrough) || (!isLong && currentPrice > currentTrough)) {
            positionState.troughPrice = currentPrice;
            hasChanged = true;
        }
    
        // --- 2. Candidate Stop-Loss Collection ---
        // This is where all independent systems propose a stop loss.
        
        // The current SL is our baseline candidate.
        const stopCandidates: { price: number; reason: Position['activeStopLossReason']; newState?: Partial<Position> }[] = [
            { price: positionState.stopLossPrice, reason: positionState.activeStopLossReason }
        ];

        // Candidate A: Spike Protector
        if (this.bot.config.isInvalidationCheckEnabled) {
            const spikeSignal = getProfitSpikeSignal(positionState, currentPrice);
            if (spikeSignal.newStopLoss) {
                stopCandidates.push({ price: spikeSignal.newStopLoss, reason: 'Profit Secure', newState: spikeSignal.newState });
            }
        }
        
        // Candidate B: Mandatory Breakeven
        const breakevenSignal = getMandatoryBreakevenSignal(positionState, currentPrice);
        if (breakevenSignal.newStopLoss) {
            stopCandidates.push({ price: breakevenSignal.newStopLoss, reason: 'Breakeven', newState: breakevenSignal.newState });
        }
        
        // Candidate C: Universal Profit Trail
        if (this.bot.config.isUniversalProfitTrailEnabled) {
            const profitSecureSignal = getMultiStageProfitSecureSignal(positionState, currentPrice);
            if (profitSecureSignal.newStopLoss) {
                stopCandidates.push({ price: profitSecureSignal.newStopLoss, reason: 'Profit Secure', newState: profitSecureSignal.newState });
            }
        }

        // Candidate D: Agent's Native Trail
        const lastFinalKline = this.klines.length > 0 ? this.klines[this.klines.length - 1] : undefined;
        if (lastFinalKline) {
            const previewKline: Kline = {
                ...lastFinalKline,
                high: Math.max(lastFinalKline.high, currentPrice),
                low: Math.min(lastFinalKline.low, currentPrice),
                close: currentPrice,
                isFinal: false,
            };
            const klinesForAnalysis = [...this.klines.slice(0, -1), previewKline];
            const agentTrailSignal = getAgentExitSignal(positionState, klinesForAnalysis, currentPrice, this.bot.config);
            if (agentTrailSignal.newStopLoss) {
                stopCandidates.push({ price: agentTrailSignal.newStopLoss, reason: 'Agent Trail', newState: agentTrailSignal.newState });
            }
        }

        // Candidate E: NEW Aggressive Range Trail
        const aggressiveTrailSignal = getAggressiveRangeTrailSignal(positionState, currentPrice);
        if (aggressiveTrailSignal.newStopLoss) {
            stopCandidates.push({ price: aggressiveTrailSignal.newStopLoss, reason: 'Profit Secure', newState: aggressiveTrailSignal.newState });
        }
        
        // --- 3. Selection: The Tightest Stop Wins ---
        let bestCandidate = stopCandidates[0];
        for (const candidate of stopCandidates) {
            // Check if the candidate is valid (not crossing the current price)
            const isValid = isLong ? candidate.price < currentPrice : candidate.price > currentPrice;
            // Check if it's tighter (more protective) than the current best
            const isTighter = isLong ? candidate.price > bestCandidate.price : candidate.price < bestCandidate.price;

            if (isValid && isTighter) {
                bestCandidate = candidate;
            }
        }
    
        // --- 4. Application ---
        if (bestCandidate.price !== positionState.stopLossPrice) {
            const previousSL = positionState.stopLossPrice;
            // Apply the state changes from the winning candidate
            if (bestCandidate.newState) {
                positionState = { ...positionState, ...(bestCandidate.newState as Partial<Position>) };
            }
            // Set the new stop loss and reason
            positionState.stopLossPrice = bestCandidate.price;
            positionState.activeStopLossReason = bestCandidate.reason;
            hasChanged = true;
            this.addLog(`SL updated from ${previousSL.toFixed(this.bot.config.pricePrecision)} to ${bestCandidate.price.toFixed(this.bot.config.pricePrecision)}. Reason: ${bestCandidate.reason}.`, LogType.Info);
        }
        
        if (hasChanged) {
            this.updateState({ openPosition: positionState });
        }
    }

    private async managePositionOnPeriodicAnalysis(klinesForAnalysis: Kline[]) {
        const { openPosition, config } = this.bot;
        if (!openPosition || !this.handlers) return;

        const currentPrice = this.bot.livePrice || klinesForAnalysis[klinesForAnalysis.length - 1]?.close;
        if (!currentPrice) return;

        let htfKlines: Kline[] | undefined = undefined;
        if (config.isHtfConfirmationEnabled) {
            try {
                const htf = config.htfTimeFrame === 'auto' 
                    ? TIME_FRAMES[TIME_FRAMES.indexOf(config.timeFrame) + 1] 
                    : config.htfTimeFrame;
                
                if (htf) {
                    htfKlines = await binanceService.fetchKlines(config.pair.replace('/', ''), htf, { limit: 205, mode: config.mode });
                }
            } catch (e) {
                this.addLog(`Warning: Could not fetch HTF for management loop: ${e}`, LogType.Error);
            }
        }

        // --- Supervisor Check (Proactive Exit & Invalidation) ---
        if (config.isInvalidationCheckEnabled) {
            const supervisorSignal = await getSupervisorSignal(openPosition, klinesForAnalysis, config, htfKlines);
            if (supervisorSignal.action === 'close') {
                this.addLog(supervisorSignal.reason, LogType.Action);
                this.handlers.onClosePosition(openPosition, supervisorSignal.reason, currentPrice);
                return; // Exit early if the position is closed
            }
        }

        // --- Adaptive Take Profit (Proactive Target Adjustment) ---
        if (openPosition) {
            const adaptiveTpSignal = getAdaptiveTakeProfit(openPosition, klinesForAnalysis, config, htfKlines);
            if (adaptiveTpSignal.newTakeProfit && adaptiveTpSignal.newTakeProfit !== openPosition.takeProfitPrice) {
                const updatedPosition: Position = {
                    ...openPosition,
                    takeProfitPrice: adaptiveTpSignal.newTakeProfit
                };
                this.updateState({ openPosition: updatedPosition });
                this.addLog(`${adaptiveTpSignal.reason} New TP: ${adaptiveTpSignal.newTakeProfit.toFixed(config.pricePrecision)}`, LogType.Action);
            }
        }
    }
}

class BotManagerService {
    private bots = new Map<string, BotInstance>();
    private spotWsManager = new WebSocketManager(() => '/proxy-spot-ws');
    private futuresWsManager = new WebSocketManager(() => '/proxy-futures-ws');
    private handlers: BotHandlers | null = null;
    private onBotListUpdate: (() => void) | null = null;
    
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
        
        // Asynchronously initialize the bot with k-line data
        this.initializeBot(newBotInstance);

        this.onBotUpdate();
        return newBotInstance.bot;
    }

    private async initializeBot(botInstance: BotInstance) {
        try {
            const { config } = botInstance.bot;
            const klines = await binanceService.fetchKlines(
                config.pair.replace('/', ''),
                config.timeFrame,
                { limit: 205, mode: config.mode }
            );
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
            
            if (type === 'ticker') {
                wsManager.unsubscribe(`${formattedPair}@ticker`, callback);
            } else if (type === 'kline') {
                wsManager.unsubscribe(`${formattedPair}@kline_${timeFrame}`, callback);
            }
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
            bot.updateState({ 
                status: BotStatus.Paused, 
                accumulatedActiveMs: bot.bot.accumulatedActiveMs + activeTime,
                lastResumeTimestamp: null
            });
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
                bot.addLog('Stopping bot with open position, closing now...', LogType.Action);
                this.handlers.onClosePosition(bot.bot.openPosition, 'Bot Stopped', bot.bot.livePrice || 0);
            }

            const activeTime = bot.bot.lastResumeTimestamp ? Date.now() - bot.bot.lastResumeTimestamp : 0;
            bot.updateState({ 
                status: BotStatus.Stopped,
                accumulatedActiveMs: bot.bot.accumulatedActiveMs + activeTime,
                lastResumeTimestamp: null
            });
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
    
    addBotLog = (botId: string, message: string, type: LogType = LogType.Info) => {
        this.bots.get(botId)?.addLog(message, type);
    }
    
    updateBotState = (botId: string, partialState: Partial<RunningBot>) => {
        this.bots.get(botId)?.updateState(partialState);
    }

    notifyPositionClosed = (botId: string, pnl: number) => {
        const bot = this.bots.get(botId);
        if (bot) {
            const closedPositionDirection = bot.bot.openPosition?.direction || null;
            const isWin = pnl >= 0;
            const newTotalPnl = bot.bot.totalPnl + pnl;
            const newWins = bot.bot.wins + (isWin ? 1 : 0);
            const newLosses = bot.bot.losses + (isWin ? 0 : 1);
            
            bot.updateState({
                openPosition: null,
                openPositionId: null,
                status: BotStatus.Monitoring,
                totalPnl: newTotalPnl,
                wins: newWins,
                losses: newLosses,
                closedTradesCount: bot.bot.closedTradesCount + 1,
                lastProfitableTradeDirection: isWin ? closedPositionDirection : bot.bot.lastProfitableTradeDirection,
            });
            bot.addLog(`Position closed. Net PNL: $${pnl.toFixed(2)}.`, isWin ? LogType.Success : LogType.Error);
        }
    }

    notifyTradeExecutionFailed = (botId: string, reason: string) => {
        const bot = this.bots.get(botId);
        if (bot) {
            bot.notifyTradeExecutionFailed(reason);
        }
    }
    
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
            bot.refreshAnalysisPreview();
        }
    }
}


const botManagerService = new BotManagerService();
telegramBotService.register(botManagerService);
export { botManagerService };