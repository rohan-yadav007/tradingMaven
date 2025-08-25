import { RunningBot, BotConfig, BotStatus, TradeSignal, Kline, BotLogEntry, Position, LiveTicker, LogType, RiskMode, TradingMode, BinanceOrderResponse, TradeManagementSignal, AgentParams } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getMultiStageProfitSecureSignal, getAgentExitSignal, getInitialAgentTargets, validateTradeProfitability, getSupervisorSignal, getMandatoryBreakevenSignal, getAdaptiveTakeProfit, getProfitSpikeSignal } from './localAgentService';
import { DEFAULT_AGENT_PARAMS, TIME_FRAMES, TAKER_FEE_RATE, CHAMELEON_TIMEFRAME_SETTINGS, MIN_PROFIT_BUFFER_MULTIPLIER } from '../constants';
import { telegramBotService } from './telegramBotService';

const MAX_LOG_ENTRIES = 100;
const RECONNECT_DELAY = 5000; // 5 seconds
let nextRequestId = 1;

const getTimeframeDuration = (timeframe: string): number => {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(-1), 10);
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
            cooldownUntil: undefined,
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
        await this.runAnalysis(false, { execute: false });
        
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
            // Guard to prevent rescheduling if the bot has been paused/stopped
            if ([BotStatus.Paused, BotStatus.Stopping, BotStatus.Stopped, BotStatus.Error].includes(this.bot.status)) {
                return;
            }
    
            const intervalSeconds = this.bot.config.refreshInterval ?? 30;
            const now = new Date();
            const currentSeconds = now.getSeconds();
            const currentMilliseconds = now.getMilliseconds();
            
            const secondsIntoInterval = currentSeconds % intervalSeconds;
            let msToWait = (intervalSeconds - secondsIntoInterval) * 1000 - currentMilliseconds;
    
            // If we missed the boundary, wait for the next one
            if (msToWait < 0) {
                msToWait += intervalSeconds * 1000;
            }
    
            this.managementInterval = window.setTimeout(async () => {
                try {
                    // Don't run if status changed while waiting for timeout
                    if (![BotStatus.Paused, BotStatus.Stopping, BotStatus.Stopped, BotStatus.Error].includes(this.bot.status)) {
                        await this.runPeriodicManagement();
                    }
                } catch (e) {
                    const errorMessage = e instanceof Error ? e.message : String(e);
                    this.addLog(`Error in periodic management loop: ${errorMessage}`, LogType.Error);
                } finally {
                    // ALWAYS reschedule the next run, even if the current one had an error.
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
    
        if (this.klines.length < 50) {
            // This log is too noisy for a periodic check.
            return;
        }
    
        if (!this.bot.livePrice || this.bot.livePrice <= 0) {
            // This log is also too noisy.
            return;
        }
        
        // Always refresh analysis preview for UI feedback, regardless of position status.
        await this.refreshAnalysisPreview();
    
        if (this.bot.openPosition) {
            const lastFinalKline = this.klines[this.klines.length - 1];
            const previewKline: Kline = {
                ...lastFinalKline,
                high: Math.max(lastFinalKline.high, this.bot.livePrice),
                low: Math.min(lastFinalKline.low, this.bot.livePrice),
                close: this.bot.livePrice,
                isFinal: false,
            };
            const klinesForAnalysis = [...this.klines.slice(0, -1), previewKline];
            await this.managePositionOnPeriodicAnalysis(klinesForAnalysis);
        }
    }

    public async runAnalysis(isFlipAttempt: boolean = false, options: { execute: boolean } = { execute: true }) {
        try {
            if (this.bot.openPosition || (!isFlipAttempt && ![BotStatus.Monitoring].includes(this.bot.status))) {
                return;
            }

            if (this.klines.length < 50) {
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

                const signal = await getTradingSignal(this.bot.config.agent, this.klines, this.bot.config, htfKlines);
                this.bot.analysis = signal;

                if (signal.signal !== 'HOLD') {
                    const { cooldownUntil } = this.bot;
                    const currentCandleTime = this.klines[this.klines.length - 1].time;
                    let isVetoed = false;

                    if (cooldownUntil) {
                        if (currentCandleTime < cooldownUntil.time) {
                            const signalDirection = signal.signal === 'BUY' ? 'LONG' : 'SHORT';
                            if (signalDirection === cooldownUntil.direction) {
                                const cooldownEndsDate = new Date(cooldownUntil.time + getTimeframeDuration(this.bot.config.timeFrame)).toLocaleTimeString();
                                this.addLog(`Trade VETOED: In cooldown for ${cooldownUntil.direction} trades until after candle closing at ${cooldownEndsDate}.`, LogType.Info);
                                isVetoed = true;
                            }
                        } else {
                            this.updateState({ cooldownUntil: undefined });
                            this.addLog('Trade cooldown has expired.', LogType.Info);
                        }
                    }
                    
                    if (!isVetoed) {
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
                            await this.executeTrade(signal, this.klines);
                        } else {
                            this.addLog(`Initial analysis found a ${signal.signal} signal. Waiting for the current candle to close before taking action.`, LogType.Info);
                        }
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
             // NEW: Trigger entry analysis on candle close
            if (this.bot.status === BotStatus.Monitoring) {
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
        if (this.bot.config.isTakeProfitLocked && this.bot.config.agent.id !== 13) {
            const positionValue = this.bot.config.mode === TradingMode.USDSM_Futures ? this.bot.config.investmentAmount * this.bot.config.leverage : this.bot.config.investmentAmount;
            const tradeSize = positionValue / currentPrice;
            if (this.bot.config.takeProfitMode === RiskMode.Percent) {
                const profitAmount = this.bot.config.investmentAmount * (this.bot.config.takeProfitValue / 100);
                finalTp = isLong ? currentPrice + (profitAmount / tradeSize) : currentPrice - (profitAmount / tradeSize);
            } else {
                finalTp = isLong ? currentPrice + (this.bot.config.takeProfitValue / tradeSize) : currentPrice - (this.bot.config.takeProfitValue / tradeSize);
            }
        }
        
        // --- Intelligent TP Adjustment (Fee Veto Fix) ---
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

        let updatedPosition = { ...this.bot.openPosition };
        const isLong = updatedPosition.direction === 'LONG';
        let hasUpdate = false;

        // --- Live P&L and MFE/MAE tracking ---
        const isInProfit = isLong ? currentPrice > updatedPosition.entryPrice : currentPrice < updatedPosition.entryPrice;
        if (!updatedPosition.hasBeenProfitable && isInProfit) {
            updatedPosition.hasBeenProfitable = true;
            hasUpdate = true;
        }
        const currentPeak = updatedPosition.peakPrice ?? updatedPosition.entryPrice;
        if ((isLong && currentPrice > currentPeak) || (!isLong && currentPrice < currentPeak)) {
            updatedPosition.peakPrice = currentPrice;
            hasUpdate = true;
        }
        const currentTrough = updatedPosition.troughPrice ?? updatedPosition.entryPrice;
        if ((isLong && currentPrice < currentTrough) || (!isLong && currentPrice > currentTrough)) {
            updatedPosition.troughPrice = currentPrice;
            hasUpdate = true;
        }

        // --- IMMEDIATE, PRICE-DRIVEN SL MANAGEMENT ---
        const potentialStops: { price: number; reason: Position['activeStopLossReason']; newState?: any }[] = [];
        potentialStops.push({ price: updatedPosition.stopLossPrice, reason: updatedPosition.activeStopLossReason });

        // NEW: Tier -1: Profit Spike Protector (Hyper-Reactive, NON-NEGOTIABLE)
        // Controlled by the "Proactive Exit & Invalidation" toggle for simplicity
        if (this.bot.config.isInvalidationCheckEnabled) {
            const spikeSignal = getProfitSpikeSignal(updatedPosition, currentPrice);
            if (spikeSignal.newStopLoss) {
                potentialStops.push({
                    price: spikeSignal.newStopLoss,
                    reason: 'Profit Secure', // Use a consistent reason for UI
                    newState: spikeSignal.newState
                });
            }
        }

        // Tier 0: Mandatory Breakeven (NON-NEGOTIABLE & IMMEDIATE)
        const mandatoryBreakevenSignal = getMandatoryBreakevenSignal(updatedPosition, currentPrice);
        if (mandatoryBreakevenSignal.newStopLoss) {
            potentialStops.push({
                price: mandatoryBreakevenSignal.newStopLoss,
                reason: 'Breakeven',
                newState: mandatoryBreakevenSignal.newState
            });
        }
        
        // --- EXPLICIT LOGIC: Universal Trail OR Agent Trail ---
        if (this.bot.config.isUniversalProfitTrailEnabled) {
            const profitSecureSignal = getMultiStageProfitSecureSignal(updatedPosition, currentPrice);
            if (profitSecureSignal.newStopLoss) {
                potentialStops.push({ 
                    price: profitSecureSignal.newStopLoss, 
                    reason: 'Profit Secure', 
                    newState: profitSecureSignal.newState 
                });
            }
        } else {
            // Universal trail is OFF, so only the agent's logic runs for trailing.
            const lastFinalKline = this.klines[this.klines.length - 1];
            if (lastFinalKline) {
                const previewKline: Kline = {
                    ...lastFinalKline,
                    high: Math.max(lastFinalKline.high, currentPrice),
                    low: Math.min(lastFinalKline.low, currentPrice),
                    close: currentPrice,
                    isFinal: false,
                };
                const klinesForAnalysis = [...this.klines.slice(0, -1), previewKline];
                const agentTrailSignal = getAgentExitSignal(updatedPosition, klinesForAnalysis, currentPrice, this.bot.config);
                if (agentTrailSignal.newStopLoss) {
                    potentialStops.push({ price: agentTrailSignal.newStopLoss, reason: 'Agent Trail' });
                }
            }
        }
        
        // Determine the best (tightest) valid stop loss from all candidates.
        let bestStop = potentialStops[0];
        for (let i = 1; i < potentialStops.length; i++) {
            const candidate = potentialStops[i];
            const isTighter = isLong ? candidate.price > bestStop.price : candidate.price < bestStop.price;
            if (isTighter) {
                bestStop = candidate;
            }
        }

        // Apply the best stop if it's an improvement and valid (not crossing the current price).
        if (bestStop.price !== updatedPosition.stopLossPrice) {
            const isValid = isLong ? bestStop.price < currentPrice : bestStop.price > currentPrice;
            if (isValid) {
                updatedPosition.stopLossPrice = bestStop.price;
                updatedPosition.activeStopLossReason = bestStop.reason;
                if (bestStop.newState) {
                    updatedPosition = { ...updatedPosition, ...bestStop.newState };
                }
                hasUpdate = true;
                this.addLog(`Trailing SL (Tick) updated to ${bestStop.price.toFixed(this.bot.config.pricePrecision)}. Reason: ${bestStop.reason}.`, LogType.Info);
            }
        }
        
        if (hasUpdate) {
            this.updateState({ openPosition: updatedPosition });
        }
    }

    private async managePositionOnPeriodicAnalysis(klinesForAnalysis: Kline[]) {
        const { openPosition, config } = this.bot;
        if (!openPosition || !this.handlers) return;

        const currentPrice = this.bot.livePrice || klinesForAnalysis[klinesForAnalysis.length - 1]?.close;
        if (!currentPrice) return;

        // --- Supervisor Check (Proactive Exit & Invalidation) ---
        if (config.isInvalidationCheckEnabled) {
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
                    this.addLog(`Warning: Could not fetch HTF klines for supervisor check: ${e}`, LogType.Error);
                }
            }

            const supervisorSignal = await getSupervisorSignal(openPosition, klinesForAnalysis, config, htfKlines); 
            if (supervisorSignal.action === 'close') {
                this.addLog(supervisorSignal.reason, LogType.Action);
                this.handlers.onClosePosition(openPosition, supervisorSignal.reason, currentPrice);
                return; // Exit, as position is being closed.
            }
        }
        
        let updatedPosition = { ...this.bot.openPosition! };
        let hasUpdate = false;
        
        // --- Adaptive Take Profit ---
        if (config.isTrailingTakeProfitEnabled) {
            let htfKlinesForTp: Kline[] | undefined = undefined;
            try {
                const htf = config.htfTimeFrame === 'auto'
                    ? TIME_FRAMES[TIME_FRAMES.indexOf(config.timeFrame) + 1]
                    : config.htfTimeFrame;

                if (htf) {
                    htfKlinesForTp = await binanceService.fetchKlines(
                        config.pair.replace('/', ''),
                        htf,
                        { limit: 205, mode: config.mode }
                    );
                }
            } catch (e) {
                this.addLog(`Warning: Could not fetch HTF klines for adaptive TP: ${e instanceof Error ? e.message : String(e)}`, LogType.Error);
            }
            
            // NOTE: We're calling this with `updatedPosition` which has the latest trailed SL
            const adaptiveTpSignal = getAdaptiveTakeProfit(updatedPosition, klinesForAnalysis, config, htfKlinesForTp);
            
            if (adaptiveTpSignal.newTakeProfit) {
                // Check if the change is significant to avoid tiny, noisy adjustments and logging.
                const changePercent = Math.abs(adaptiveTpSignal.newTakeProfit - updatedPosition.takeProfitPrice) / updatedPosition.takeProfitPrice;
                if (changePercent > 0.0005) { // 0.05% change threshold
                    updatedPosition.takeProfitPrice = adaptiveTpSignal.newTakeProfit;
                    hasUpdate = true;
                    this.addLog(adaptiveTpSignal.reason || `Adaptive TP updated to ${updatedPosition.takeProfitPrice.toFixed(config.pricePrecision)}.`, LogType.Info);
                }
            }
        }

        if (hasUpdate) {
            this.updateState({ openPosition: updatedPosition });
        }
    }

    public async refreshAnalysisPreview() {
        if (this.klines.length < 50 || !this.bot.livePrice) {
            // Log for skipping is now handled in the calling function.
            return;
        }
    
        try {
            const lastKline = this.klines[this.klines.length - 1];
            const previewKline: Kline = {
                ...lastKline,
                high: Math.max(lastKline.high, this.bot.livePrice),
                low: Math.min(lastKline.low, this.bot.livePrice),
                close: this.bot.livePrice,
                isFinal: false,
            };
            const klinesForAnalysis = [...this.klines.slice(0, -1), previewKline];
            
            let htfKlines: Kline[] | undefined = undefined;
            if (this.bot.config.isHtfConfirmationEnabled) {
                const htf = this.bot.config.htfTimeFrame === 'auto' 
                    ? TIME_FRAMES[TIME_FRAMES.indexOf(this.bot.config.timeFrame) + 1] 
                    : this.bot.config.htfTimeFrame;
                if (htf) {
                    htfKlines = await binanceService.fetchKlines(this.bot.config.pair.replace('/', ''), htf, { limit: 205, mode: this.bot.config.mode }); 
                }
            }
    
            const signal = await getTradingSignal(this.bot.config.agent, klinesForAnalysis, this.bot.config, htfKlines);
            this.updateState({ analysis: signal });
    
        } catch (error) {
            this.addLog(`Error refreshing analysis preview: ${error}`, LogType.Error);
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
        this.stopManagementLoop();
        if (this.bot.lastResumeTimestamp) {
            this.bot.accumulatedActiveMs += Date.now() - this.bot.lastResumeTimestamp;
            this.bot.lastResumeTimestamp = null;
        }
        this.updateState({ status: BotStatus.Stopped });
        this.addLog('Bot stopped.', LogType.Status);
    }

    public pause() {
        if (this.bot.status === BotStatus.Paused) return;
        this.stopManagementLoop();
        if (this.bot.lastResumeTimestamp) {
            this.bot.accumulatedActiveMs += Date.now() - this.bot.lastResumeTimestamp;
            this.bot.lastResumeTimestamp = null;
        }
        this.updateState({ status: BotStatus.Paused });
        this.addLog('Bot paused.', LogType.Status);
    }

    public resume() {
        if (this.bot.status !== BotStatus.Paused) return;
        this.startManagementLoop();
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
        const isProd = import.meta.env.PROD;
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

        // Fetch initial data and initialize
        binanceService.fetchKlines(formattedPair, config.timeFrame, { limit: 500, mode: config.mode })
            .then(klines => {
                instance.initialize(klines);
                
                // Now subscribe to live updates
                const streamManager = config.mode === TradingMode.USDSM_Futures ? this.futuresStreamManager : this.spotStreamManager;
                
                // Ticker subscription
                const tickerStreamName = `${formattedPair.toLowerCase()}@ticker`;
                const tickerCallback = (data: any) => {
                    const ticker: LiveTicker = {
                        pair: data.s,
                        closePrice: parseFloat(data.c),
                        highPrice: parseFloat(data.h),
                        lowPrice: parseFloat(data.l),
                        volume: parseFloat(data.v),
                        quoteVolume: parseFloat(data.q)
                    };
                    instance.updateLivePrice(ticker.closePrice, ticker);
                };
                streamManager.subscribe(tickerStreamName, tickerCallback);
                instance.subscriptions.push({ type: 'ticker', pair: formattedPair, mode: config.mode, callback: tickerCallback });

                // Kline subscription for the bot's timeframe
                const klineStreamName = `${formattedPair.toLowerCase()}@kline_${config.timeFrame}`;
                const klineCallback = (data: any) => {
                    const newKline: Kline = {
                        time: data.k.t,
                        open: parseFloat(data.k.o),
                        high: parseFloat(data.k.h),
                        low: parseFloat(data.k.l),
                        close: parseFloat(data.k.c),
                        volume: parseFloat(data.k.v),
                        isFinal: data.k.x
                    };
                    instance.onMainKlineUpdate(newKline);
                };
                streamManager.subscribe(klineStreamName, klineCallback);
                instance.subscriptions.push({ type: 'kline', pair: formattedPair, timeFrame: config.timeFrame, mode: config.mode, callback: klineCallback });
            })
            .catch(err => {
                this.addBotLog(instance.bot.id, `Failed to initialize with kline data: ${err}`, LogType.Error);
                instance.updateState({ status: BotStatus.Error, analysis: {signal: 'HOLD', reasons: [`Initialization Failed: ${err}`]}});
            });

        this.updateState();
        return instance.bot;
    }
    
    public getBot(botId: string): BotInstance | undefined {
        return this.bots.get(botId);
    }

    public addBotLog(botId: string, message: string, type: LogType) {
        this.bots.get(botId)?.addLog(message, type);
    }
    
    public updateBotState(botId: string, partialState: Partial<RunningBot>) {
        this.bots.get(botId)?.updateState(partialState);
    }
    
    public updateBotConfig = (botId: string, partialConfig: Partial<BotConfig>) => {
        const botInstance = this.bots.get(botId);
        if (botInstance) {
            const oldConfig = { ...botInstance.bot.config };
            const newConfig = { ...botInstance.bot.config, ...partialConfig };
            botInstance.updateState({ config: newConfig });
            this.addBotLog(botId, `Configuration updated.`, LogType.Info);

            // If the refresh interval was changed, restart the management loop to apply it.
            if (partialConfig.refreshInterval !== undefined && partialConfig.refreshInterval !== oldConfig.refreshInterval) {
                if (botInstance.bot.status !== BotStatus.Paused) {
                    this.addBotLog(botId, `Restarting management loop with new interval: ${partialConfig.refreshInterval}s`, LogType.Info);
                    botInstance.startManagementLoop();
                }
            }
        }
    }

    public refreshBotAnalysis = (botId: string) => {
        const botInstance = this.bots.get(botId);
        if (botInstance) {
            if (botInstance.bot.status === BotStatus.Monitoring) {
                botInstance.refreshAnalysisPreview();
            } 
            else if (botInstance.bot.openPosition) {
                this.addBotLog(botId, "Manual position management check triggered.", LogType.Info);
                botInstance.runPeriodicManagement();
            }
        }
    }

    public notifyPositionClosed(botId: string, pnl: number) {
        const bot = this.bots.get(botId);
        if (bot) {
            const isProfit = pnl >= 0;
            const openPositionDirection = bot.bot.openPosition?.direction || null;
            
            const { config } = bot.bot;
            let cooldownState: Partial<RunningBot> = {};
            if (config.isCooldownEnabled && bot.klines.length > 0 && openPositionDirection) {
                const params = { ...DEFAULT_AGENT_PARAMS, ...config.agentParams };
                const cooldownCandles = params.cooldownCandles;
                const timeframeMs = getTimeframeDuration(config.timeFrame);
                const lastKlineTime = bot.klines[bot.klines.length - 1].time;
                const cooldownEndTime = lastKlineTime + (cooldownCandles * timeframeMs);
                cooldownState.cooldownUntil = { time: cooldownEndTime, direction: openPositionDirection };
                const cooldownEndsDate = new Date(cooldownEndTime + timeframeMs).toLocaleTimeString();
                this.addBotLog(botId, `Cooldown enabled for ${openPositionDirection} trades until after candle closing at ${cooldownEndsDate}.`, LogType.Info);
            }

            bot.updateState({
                status: BotStatus.Monitoring,
                openPositionId: null,
                openPosition: null,
                closedTradesCount: bot.bot.closedTradesCount + 1,
                totalPnl: bot.bot.totalPnl + pnl,
                wins: bot.bot.wins + (isProfit ? 1 : 0),
                losses: bot.bot.losses + (isProfit ? 0 : 1),
                totalGrossProfit: bot.bot.totalGrossProfit + (pnl > 0 ? pnl : 0),
                totalGrossLoss: bot.bot.totalGrossLoss + (pnl < 0 ? Math.abs(pnl) : 0),
                lastProfitableTradeDirection: isProfit ? openPositionDirection : bot.bot.lastProfitableTradeDirection,
                ...cooldownState
            });
            this.addBotLog(botId, `Position closed. Net PNL: $${pnl.toFixed(2)}. Bot is now monitoring for new entries.`, isProfit ? LogType.Success : LogType.Error);
            
            // Handle Chameleon position flip
            if (bot.isFlippingPosition) {
                bot.addLog('Executing flip analysis...', LogType.Action);
                bot.runAnalysis(true); // isFlipAttempt = true
            }
        }
    }
    
    public notifyTradeExecutionFailed(botId: string, reason: string) {
        this.bots.get(botId)?.notifyTradeExecutionFailed(reason);
    }

    private unsubscribeBot(botId: string) {
        const instance = this.bots.get(botId);
        if (instance) {
            const streamManager = instance.bot.config.mode === TradingMode.USDSM_Futures ? this.futuresStreamManager : this.spotStreamManager;
            instance.subscriptions.forEach(sub => {
                let streamName = '';
                if (sub.type === 'ticker') {
                    streamName = `${sub.pair.toLowerCase()}@ticker`;
                } else if (sub.type === 'kline' && sub.timeFrame) {
                    streamName = `${sub.pair.toLowerCase()}@kline_${sub.timeFrame}`;
                }
                if (streamName) {
                    streamManager.unsubscribe(streamName, sub.callback);
                }
            });
            instance.subscriptions = [];
        }
    }

    public stopBot = (botId: string) => {
        const bot = this.bots.get(botId);
        if (bot) {
            if (bot.bot.openPosition && this.handlers) {
                this.addBotLog(botId, `Stopping bot with open position. Closing position first...`, LogType.Action);
                this.handlers.onClosePosition(bot.bot.openPosition, "Bot Stopped", bot.bot.livePrice || bot.bot.openPosition.entryPrice);
            }
            this.unsubscribeBot(botId);
            bot.stop();
        }
    }

    public pauseBot = (botId: string) => {
        this.bots.get(botId)?.pause();
    }
    
    public resumeBot = (botId: string) => {
        this.bots.get(botId)?.resume();
    }
    
    public deleteBot = (botId: string) => {
        const bot = this.bots.get(botId);
        if (bot && (bot.bot.status === BotStatus.Stopped || bot.bot.status === BotStatus.Error)) {
            this.bots.delete(botId);
            this.updateState();
        }
    }

    public updateKlines(pair: string, timeFrame: string, klines: Kline[]) {
        this.bots.forEach(bot => {
            if (bot.bot.config.pair === pair && bot.bot.config.timeFrame === timeFrame) {
                bot.klines = klines;
                bot.bot.klinesLoaded = klines.length;
                this.updateState();
            }
        });
    }

    public subscribeToTickerUpdates(pair: string, mode: TradingMode, callback: Function) {
        const streamManager = mode === TradingMode.USDSM_Futures ? this.futuresStreamManager : this.spotStreamManager;
        const streamName = `${pair.toLowerCase()}@ticker`;
        streamManager.subscribe(streamName, callback);
    }

    public unsubscribeFromTickerUpdates(pair: string, mode: TradingMode, callback: Function) {
        const streamManager = mode === TradingMode.USDSM_Futures ? this.futuresStreamManager : this.spotStreamManager;
        const streamName = `${pair.toLowerCase()}@ticker`;
        streamManager.unsubscribe(streamName, callback);
    }

    public subscribeToKlineUpdates(pair: string, timeFrame: string, mode: TradingMode, callback: Function) {
        const streamManager = mode === TradingMode.USDSM_Futures ? this.futuresStreamManager : this.spotStreamManager;
        const streamName = `${pair.toLowerCase()}@kline_${timeFrame}`;
        streamManager.subscribe(streamName, callback);
    }
    
    public unsubscribeFromKlineUpdates(pair: string, timeFrame: string, mode: TradingMode, callback: Function) {
        const streamManager = mode === TradingMode.USDSM_Futures ? this.futuresStreamManager : this.spotStreamManager;
        const streamName = `${pair.toLowerCase()}@kline_${timeFrame}`;
        streamManager.unsubscribe(streamName, callback);
    }

    public stopAllBots() {
        this.bots.forEach(bot => this.stopBot(bot.bot.id));
        this.spotStreamManager.disconnect();
        this.futuresStreamManager.disconnect();
    }
}

export const botManagerService = new BotManagerService();