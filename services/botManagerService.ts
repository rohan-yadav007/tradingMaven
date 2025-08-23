
import { RunningBot, BotConfig, BotStatus, TradeSignal, Kline, BotLogEntry, Position, LiveTicker, LogType, RiskMode, TradingMode, BinanceOrderResponse, ChameleonAgentState, TradeManagementSignal, AgentParams } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getMultiStageProfitSecureSignal, getAgentExitSignal, getInitialAgentTargets, validateTradeProfitability, getChameleonManagementSignal, getChameleonStrategicUpdate, checkMomentumFadingSignal, checkLossMinimizationSignal } from './localAgentService';
import { DEFAULT_AGENT_PARAMS, MAX_STOP_LOSS_PERCENT_OF_INVESTMENT, TIME_FRAMES, TAKER_FEE_RATE, CHAMELEON_TIMEFRAME_SETTINGS, MIN_PROFIT_BUFFER_MULTIPLIER } from '../constants';
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
    private lastTickAnalysisTime: number = 0;

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
            agentState: undefined,
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
        await this.runAnalysis();

        this.onUpdate();
    }

    addLog(message: string, type: LogType = LogType.Info) {
        const newLog: BotLogEntry = { timestamp: new Date(), message, type };
        this.bot.log = [newLog, ...this.bot.log].slice(0, MAX_LOG_ENTRIES);
        this.onUpdate();
    }

    public async runAnalysis(isFlipAttempt: boolean = false, klinesOverride?: Kline[]) {
        try {
            const klinesForAnalysis = klinesOverride || this.klines;
            if (this.bot.openPosition || (!isFlipAttempt && ![BotStatus.Monitoring].includes(this.bot.status))) {
                return;
            }

            if (klinesForAnalysis.length < 50) { // Ensure enough data for indicators
                this.addLog('Analysis skipped: insufficient kline data.', LogType.Info);
                return;
            }

            if (this.handlers) {
                this.addLog(isFlipAttempt ? 'Analysis for position flip...' : 'Performing analysis on new completed kline.', LogType.Action);

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

                const signal = await getTradingSignal(this.bot.config.agent, klinesForAnalysis, this.bot.config, htfKlines);
                this.bot.analysis = signal;

                if (signal.signal !== 'HOLD') {
                    const { cooldownUntil } = this.bot;
                    const currentCandleTime = klinesForAnalysis[klinesForAnalysis.length - 1].time;
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
                        this.updateState({ status: BotStatus.ExecutingTrade });
                        await this.executeTrade(signal, klinesForAnalysis);
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

    private async runChameleonTickAnalysis(klinesForAnalysis: Kline[]) {
        // Check if an analysis is already running to prevent race conditions
        if (this.bot.status === BotStatus.ExecutingTrade) return;
        
        // Run a preview signal check without fetching HTF klines yet.
        const previewConfig = { ...this.bot.config, isHtfConfirmationEnabled: false, isInvalidationCheckEnabled: false };
        const previewSignal = await getTradingSignal(this.bot.config.agent, klinesForAnalysis, previewConfig);

        // If the local-only preview signal is a buy/sell, proceed with the full analysis which includes HTF fetching.
        if (previewSignal.signal !== 'HOLD') {
            this.addLog(`Tick-based signal detected: ${previewSignal.signal}. Running full analysis...`, LogType.Info);
            // The main `runAnalysis` function will handle fetching HTF data and executing the trade.
            await this.runAnalysis(false, klinesForAnalysis); 
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
            await this.managePositionOnTick(price);
            this.checkPriceBoundaries(price);
        }

        // Always update the analysis for UI preview purposes, regardless of bot status (as long as it's receiving ticks)
        if (this.klines.length > 0) {
            const lastFinalKline = this.klines[this.klines.length - 1];
            const previewKline: Kline = {
                ...lastFinalKline,
                high: Math.max(lastFinalKline.high, price),
                low: Math.min(lastFinalKline.low, price),
                close: price,
                isFinal: false,
            };
            const previewKlines = [...this.klines.slice(0, -1), previewKline];

            // Run getTradingSignal for the preview. This is a read-only operation.
            getTradingSignal(this.bot.config.agent, previewKlines, this.bot.config)
                .then(signal => {
                    // Update the analysis property on the bot state for the UI to consume.
                    // No status check is needed here as this is purely for display and doesn't trigger actions.
                    this.bot.analysis = signal;
                    this.onUpdate(); // Trigger a UI update
                }).catch(e => {
                    // It's a preview, so we can fail silently in the console without crashing.
                    console.error(`[Bot ${this.bot.id}] Analysis preview failed:`, e);
                });
        }

        // Tick-based analysis for Chameleon Agent
        if (this.bot.config.agent.id === 13 && this.bot.status === BotStatus.Monitoring && this.klines.length > 50) {
            const now = Date.now();
            // Throttle to prevent excessive checks (e.g., once per second)
            if (now - this.lastTickAnalysisTime > 1000) {
                this.lastTickAnalysisTime = now;
                
                const lastFinalKline = this.klines[this.klines.length - 1];
                const previewKline: Kline = {
                    ...lastFinalKline,
                    high: Math.max(lastFinalKline.high, price),
                    low: Math.min(lastFinalKline.low, price),
                    close: price,
                    isFinal: false
                };
                const klinesForAnalysis = [...this.klines.slice(0, -1), previewKline];
                
                this.runChameleonTickAnalysis(klinesForAnalysis);
            }
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
                // Update candle count for agent state
                if(this.bot.openPosition.candlesSinceEntry !== undefined) {
                    const newPosition = { ...this.bot.openPosition, candlesSinceEntry: this.bot.openPosition.candlesSinceEntry + 1 };
                    this.updateState({openPosition: newPosition});
                }
                this.updateAgentStrategicState(); // Update context for managers
                await this.managePositionOnKlineClose(); // Run candle-based managers
            } else if (this.bot.config.agent.id !== 13 && [BotStatus.Monitoring].includes(this.bot.status)) { // Exclude Chameleon from candle-close analysis
                 this.addLog(`Final kline on ${this.bot.config.timeFrame}. Running analysis for new entry.`, LogType.Info);
                 this.runAnalysis();
            }
        }
        
        this.onUpdate();
    }

    public updateState(partialState: Partial<RunningBot>) {
        // --- Logic to initialize Chameleon Agent State on new position ---
        if (partialState.openPosition && !this.bot.openPosition && this.bot.config.agent.id === 13) {
            if (this.klines.length >= 1) {
                const newPosition = partialState.openPosition;
                
                const strategicUpdate = getChameleonStrategicUpdate(this.klines, this.bot.config, newPosition);
                
                const initialState: ChameleonAgentState = {
                    ...strategicUpdate
                };
                partialState.agentState = initialState;
                this.addLog(`Chameleon state initialized.`);
            } else {
                this.addLog('Could not initialize Chameleon state: insufficient klines.', LogType.Error);
            }
        }

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
        const isInProfit = isLong ? currentPrice > updatedPosition.entryPrice : currentPrice < updatedPosition.entryPrice;

        // --- Update profitable state (one-way flag) ---
        if (!updatedPosition.hasBeenProfitable && isInProfit) {
            updatedPosition.hasBeenProfitable = true;
        }

        // --- Re-arm invalidation check if trade becomes profitable again ---
        if (isInProfit && updatedPosition.proactiveLossCheckTriggered) {
            updatedPosition.proactiveLossCheckTriggered = false;
            this.addLog('Trade is profitable. Re-arming invalidation check for future losses.', LogType.Info);
        }
        
        // --- Update peak price for trailing stops ---
        const isLongForPeak = updatedPosition.direction === 'LONG';
        const currentPeak = updatedPosition.peakPrice ?? updatedPosition.entryPrice;
        if ((isLongForPeak && currentPrice > currentPeak) || (!isLongForPeak && currentPrice < currentPeak)) {
            updatedPosition.peakPrice = currentPrice;
        }
        
        this.updateState({ openPosition: updatedPosition });
        // After state update, get the latest position object
        const openPosition = this.bot.openPosition!;
        const { config, agentState } = this.bot;
        
        // --- Proactive Exit & Invalidation on Tick ---
        if (config.isInvalidationCheckEnabled) {
            const lastFinalKline = this.klines[this.klines.length - 1];
            if (lastFinalKline) {
                const previewKline: Kline = {
                    ...lastFinalKline,
                    high: Math.max(lastFinalKline.high, currentPrice),
                    low: Math.min(lastFinalKline.low, currentPrice),
                    close: currentPrice,
                    isFinal: false,
                };
                const previewKlines = [...this.klines.slice(0, -1), previewKline];
                
                if (isInProfit) {
                    const momentumSignal = checkMomentumFadingSignal(openPosition, previewKlines, config);
                    if (momentumSignal.closePosition) {
                        this.addLog(`Proactive Profit Protection (Tick): ${momentumSignal.reason}`, LogType.Action);
                        this.handlers.onClosePosition(openPosition, momentumSignal.reason, currentPrice);
                        return; // Position closed, exit manager
                    }
                } else { // Is in loss
                    // Only trigger this check once per loss state to avoid spamming exits
                    if (!openPosition.proactiveLossCheckTriggered) {
                        const lossSignal = checkLossMinimizationSignal(openPosition, previewKlines, config);
                        if (lossSignal.closePosition) {
                            this.addLog(`Loss Minimization (Tick): ${lossSignal.reason}`, LogType.Action);
                            // Mark as triggered before closing
                            this.updateState({ openPosition: { ...openPosition, proactiveLossCheckTriggered: true } });
                            this.handlers.onClosePosition(openPosition, lossSignal.reason, currentPrice);
                            return; // Position closed, exit manager
                        }
                    }
                }
            }
        }

        // --- Proactive Exit/Flip Signals ---
        if (config.agent.id === 13) {
            const managementSignal = getChameleonManagementSignal(openPosition, currentPrice, agentState, config);
            if (managementSignal.action === 'flip') {
                this.isFlippingPosition = true;
                this.addLog(`Proactive FLIP triggered: ${managementSignal.reasons.join(' ')}`, LogType.Action);
                this.handlers.onClosePosition(openPosition, `Proactive Flip: ${managementSignal.reasons.join(' ')}`, currentPrice);
                return;
            }
            if (managementSignal.action === 'close') {
                this.addLog(`Proactive exit: ${managementSignal.reasons.join(' ')}`, LogType.Action);
                this.handlers.onClosePosition(openPosition, `Proactive Exit: ${managementSignal.reasons.join(' ')}`, currentPrice);
                return;
            }
        }

        // --- Stop-Loss Trailing Logic ---
        let bestNewStop = openPosition.stopLossPrice;
        let bestReason: Position['activeStopLossReason'] = openPosition.activeStopLossReason;
        let bestMgmtReason: string[] = [];
        let newState: any = null;
        
        // Source 1: Universal Profit Trail
        if (config.isUniversalProfitTrailEnabled) {
            const signal = getMultiStageProfitSecureSignal(openPosition, currentPrice);
            if (signal.newStopLoss && ((isLong && signal.newStopLoss > bestNewStop) || (!isLong && signal.newStopLoss < bestNewStop))) {
                bestNewStop = signal.newStopLoss;
                bestReason = (signal.newState?.profitLockTier && signal.newState.profitLockTier > 3) ? 'Profit Secure' : 'Breakeven';
                bestMgmtReason = signal.reasons;
                newState = { ...newState, ...signal.newState };
            }
        }
        // Source 2: Chameleon Agent Trail (only if Universal is OFF)
        else if (config.agent.id === 13) {
             const signal = getChameleonManagementSignal(openPosition, currentPrice, agentState, config);
             if (signal.newStopLoss && ((isLong && signal.newStopLoss > bestNewStop) || (!isLong && signal.newStopLoss < bestNewStop))) {
                bestNewStop = signal.newStopLoss;
                bestReason = 'Agent Trail';
                bestMgmtReason = signal.reasons;
                newState = { ...newState, ...signal.newState };
             }
        }
    
        // Apply the best (tightest) stop if an update was found
        if (bestNewStop !== openPosition.stopLossPrice) {
            const isValid = isLong ? bestNewStop < currentPrice : bestNewStop > currentPrice;
            if (isValid) {
                this.addLog(`Trail updated SL to ${bestNewStop.toFixed(config.pricePrecision)}. Reason: ${bestMgmtReason.join(' ')}`, LogType.Info);
                const newPositionState: Position = {
                    ...openPosition,
                    stopLossPrice: bestNewStop,
                    activeStopLossReason: bestReason,
                    ...(newState || {})
                };
                this.updateState({ openPosition: newPositionState });
            }
        }
    }

    private updateAgentStrategicState() {
        const { openPosition, config } = this.bot;
        if (!openPosition || this.klines.length < 50) return;
    
        if (config.agent.id === 13) {
            const strategicUpdate = getChameleonStrategicUpdate(this.klines, config, openPosition);
            
            const updatedAgentState: ChameleonAgentState = {
                ...(this.bot.agentState || {}),
                ...strategicUpdate,
            };
    
            this.bot.agentState = updatedAgentState;
            this.addLog(`Chameleon strategic context updated (RSI: ${this.bot.agentState.lastRsi.toFixed(1)})`, LogType.Info);
        }
    }

    private async managePositionOnKlineClose() {
        const { openPosition, config } = this.bot;
        if (!openPosition || !this.handlers) return;

        const currentPrice = this.bot.livePrice || this.klines[this.klines.length - 1]?.close;
        if (!currentPrice) return;

        let updatedPosition = { ...this.bot.openPosition! };
        let hasUpdate = false;
        
        const isLong = updatedPosition.direction === 'LONG';
        const isInProfit = isLong ? currentPrice > updatedPosition.entryPrice : currentPrice < updatedPosition.entryPrice;

        // --- Step 1: Handle Losing Trades ---
        if (!isInProfit) {
            // Only run agent-specific SL tightening on close. The aggressive exit is now on tick.
            const tightenSlSignal = getAgentExitSignal(updatedPosition, this.klines, currentPrice, config);
            if (tightenSlSignal.newStopLoss && ((isLong && tightenSlSignal.newStopLoss > updatedPosition.stopLossPrice) || (!isLong && tightenSlSignal.newStopLoss < updatedPosition.stopLossPrice))) {
                 updatedPosition.stopLossPrice = tightenSlSignal.newStopLoss;
                 updatedPosition.activeStopLossReason = 'Agent Trail';
                 hasUpdate = true;
                 this.addLog(`SL tightened on losing trade to ${updatedPosition.stopLossPrice.toFixed(config.pricePrecision)}.`, LogType.Info);
            }
        }
        // --- Step 2: Handle Profitable Trades ---
        else {
            // The aggressive exit on momentum fade is now on tick.
            // We only need to handle trailing SL/TP here.
            
            // Best-of-breed Trailing Stop Logic
            let bestNewStop = updatedPosition.stopLossPrice;
            let bestReason: Position['activeStopLossReason'] = updatedPosition.activeStopLossReason;
            
            // Source 1: Universal Profit Trail
            if (config.isUniversalProfitTrailEnabled) {
                const signal = getMultiStageProfitSecureSignal(updatedPosition, currentPrice);
                if (signal.newStopLoss && ((isLong && signal.newStopLoss > bestNewStop) || (!isLong && signal.newStopLoss < bestNewStop))) {
                    bestNewStop = signal.newStopLoss;
                    bestReason = (signal.newState?.profitLockTier && signal.newState.profitLockTier > 3) ? 'Profit Secure' : 'Breakeven';
                }
            }

            // Source 2: Agent-specific Trail
            const agentTrailSignal = getAgentExitSignal(updatedPosition, this.klines, currentPrice, config);
            if (agentTrailSignal.newStopLoss && ((isLong && agentTrailSignal.newStopLoss > bestNewStop) || (!isLong && agentTrailSignal.newStopLoss < bestNewStop))) {
                bestNewStop = agentTrailSignal.newStopLoss;
                bestReason = 'Agent Trail';
            }

            if (bestNewStop !== updatedPosition.stopLossPrice) {
                updatedPosition.stopLossPrice = bestNewStop;
                updatedPosition.activeStopLossReason = bestReason;
                hasUpdate = true;
                this.addLog(`Trailing SL (On Close) updated to ${bestNewStop.toFixed(config.pricePrecision)}. Reason: ${bestReason}.`, LogType.Info);
            }
            
            // Source 3: Trailing Take Profit
            if (config.isTrailingTakeProfitEnabled) {
                const targets = getInitialAgentTargets(this.klines, currentPrice, isLong ? 'LONG' : 'SHORT', config);
                if ((isLong && targets.takeProfitPrice > updatedPosition.takeProfitPrice) || (!isLong && targets.takeProfitPrice < updatedPosition.takeProfitPrice)) {
                    updatedPosition.takeProfitPrice = targets.takeProfitPrice;
                    hasUpdate = true;
                    this.addLog(`Trailing TP updated to ${updatedPosition.takeProfitPrice.toFixed(config.pricePrecision)}.`, LogType.Info);
                }
            }
        }

        if (hasUpdate) {
            this.updateState({ openPosition: updatedPosition });
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
            const newConfig = { ...botInstance.bot.config, ...partialConfig };
            botInstance.updateState({ config: newConfig });
            this.addBotLog(botId, `Configuration updated.`, LogType.Info);
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
                agentState: undefined,
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
