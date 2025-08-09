
import { RunningBot, BotConfig, BotStatus, TradeSignal, Kline, BotLogEntry, Position, LiveTicker, LogType, RiskMode, TradingMode, BinanceOrderResponse } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getTradeManagementSignal, getInitialAgentTargets, analyzeTrendExhaustion } from './localAgentService';
import { DEFAULT_AGENT_PARAMS, MAX_STOP_LOSS_PERCENT_OF_INVESTMENT } from '../constants';

const MAX_LOG_ENTRIES = 100;
const RECONNECT_DELAY = 5000; // 5 seconds
const MASTER_TICK_INTERVAL_MS = 3000; // Unified tick interval (3 seconds)

const getTimeframeMilliseconds = (timeFrame: string): number => {
    const unit = timeFrame.slice(-1);
    const value = parseInt(timeFrame.slice(0, -1));
    if (isNaN(value)) return 60 * 1000; // Default to 1m

    switch (unit) {
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return 60 * 1000;
    }
};

export interface BotHandlers {
    onExecuteTrade: (signal: TradeSignal, botId: string) => Promise<void>;
    onClosePosition: (position: Position, exitReason: string, exitPrice: number) => void;
    onPartialClose: (position: Position, tpIndex: number) => Promise<void>;
}

class BotInstance {
    public bot: RunningBot;
    public klines: Kline[] = []; // Main timeframe klines
    private managementKlines: Kline[] = []; // 1-minute klines for open positions
    private onUpdate: () => void;
    private handlersRef: React.RefObject<BotHandlers>;
    private isTicking = false;
    private masterTimer: number | null = null;
    
    constructor(
        config: BotConfig,
        onUpdate: () => void,
        handlersRef: React.RefObject<BotHandlers>
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
            cooldownUntil: null,
            lastProfitableTradeDirection: null,
            accumulatedActiveMs: 0,
            lastResumeTimestamp: null,
            klinesLoaded: 0,
            lastAnalysisTimestamp: null,
            lastPriceUpdateTimestamp: null,
        };
        this.onUpdate = onUpdate;
        this.handlersRef = handlersRef;
    }

    public async initialize(initialKlines: Kline[]) {
        this.addLog('Initializing with historical data...', LogType.Info);
        this.klines = initialKlines;
        this.bot.klinesLoaded = this.klines.length;
        this.addLog(`Initialized with ${this.klines.length} ${this.bot.config.timeFrame} klines.`, LogType.Success);
        
        this.bot.status = BotStatus.Monitoring;
        this.bot.lastResumeTimestamp = Date.now(); // Start tracking uptime
        
        this.masterTimer = window.setInterval(() => this.tick(), MASTER_TICK_INTERVAL_MS);
        
        this.addLog("Performing initial analysis on startup.", LogType.Info);
        await this.runAnalysis(); 
        
        this.onUpdate();
    }
    
    addLog(message: string, type: LogType = LogType.Info) {
        const newLog: BotLogEntry = { timestamp: new Date(), message, type };
        this.bot.log = [newLog, ...this.bot.log].slice(0, MAX_LOG_ENTRIES);
        this.onUpdate();
    }

    private async runImmediateAnalysis() {
        if (this.bot.openPosition || ![BotStatus.Monitoring, BotStatus.PostProfitAnalysis].includes(this.bot.status)) return;
        
        if (this.klines.length === 0) {
            this.addLog('Analysis skipped: no klines available.', LogType.Info);
            return;
        }

        if (this.handlersRef.current) {
            this.addLog('Performing analysis on current market data.', LogType.Action);
            
            const livePrice = await this.getInitialPriceReliably();
            const analysisKlines = [...this.klines];
            if (livePrice) {
                const previewCandle = { ...analysisKlines[analysisKlines.length - 1], close: livePrice, isFinal: false };
                analysisKlines[analysisKlines.length-1] = previewCandle;
            }

            const signal = await getTradingSignal(this.bot.config.agent, analysisKlines, this.bot.config.timeFrame, this.bot.config.agentParams);
            this.bot.analysis = signal;

            if (signal.signal !== 'HOLD') {
                if (this.bot.status === BotStatus.PostProfitAnalysis && this.bot.lastProfitableTradeDirection) {
                    const signalDirection = signal.signal === 'BUY' ? 'LONG' : 'SHORT';
                    if (signalDirection === this.bot.lastProfitableTradeDirection) {
                        const { veto, reasons } = analyzeTrendExhaustion(analysisKlines, signalDirection);
                        if (veto) {
                            this.addLog(`VETO: Entry for ${signalDirection} signal ignored due to trend exhaustion. Reasons: ${reasons.join(' ')}`, LogType.Action);
                            this.updateState({ status: BotStatus.Monitoring, lastProfitableTradeDirection: null });
                            return;
                        } else {
                           this.addLog('Exhaustion check passed. Proceeding with trade.', LogType.Info);
                        }
                    }
                }
                
                this.updateState({ lastProfitableTradeDirection: null, status: BotStatus.ExecutingTrade });
                await this.executeTrade(signal);
            } else {
                if (this.bot.status === BotStatus.PostProfitAnalysis) {
                    this.updateState({ status: BotStatus.Monitoring, lastProfitableTradeDirection: null });
                }
                const primaryReason = signal.reasons[signal.reasons.length - 1] || "Conditions not met for a trade.";
                this.addLog(`Analysis: HOLD. ${primaryReason}`, LogType.Info);
            }
        }
    }

    public updateLivePrice(price: number, tickerData: LiveTicker) {
        const expectedPair = this.bot.config.pair.replace('/', '').toLowerCase();
        if (tickerData.pair.toLowerCase() !== expectedPair) {
            const errorMessage = `CRITICAL: Bot for ${expectedPair} received ticker data for ${tickerData.pair}. Data ignored.`;
            console.error(errorMessage);
            this.addLog(errorMessage, LogType.Error);
            return;
        }
        
        this.bot.livePrice = price;
        this.bot.liveTicker = tickerData;
        this.bot.lastPriceUpdateTimestamp = Date.now();
    
        const isEligibleForPreview = [BotStatus.Monitoring, BotStatus.Cooldown, BotStatus.PostProfitAnalysis].includes(this.bot.status);
        if (isEligibleForPreview && this.klines.length > 0 && !this.bot.openPosition) {
            const lastFinalKline = this.klines[this.klines.length - 1];
            const previewKline: Kline = { ...lastFinalKline, close: price, isFinal: false };
            const previewKlines = [...this.klines.slice(0, -1), previewKline];
            
            getTradingSignal(this.bot.config.agent, previewKlines, this.bot.config.timeFrame, this.bot.config.agentParams)
                .then(signal => {
                    if ([BotStatus.Monitoring, BotStatus.Cooldown, BotStatus.PostProfitAnalysis].includes(this.bot.status)) {
                        this.bot.analysis = signal;
                        this.onUpdate();
                    }
                }).catch(e => { /* Silently fail for preview */ });
        }
    
        this.onUpdate();
    }

    public onMainKlineUpdate(newKline: Kline) {
        const lastKline = this.klines.length > 0 ? this.klines[this.klines.length - 1] : null;
        if (lastKline && newKline.time === lastKline.time) {
            this.klines[this.klines.length - 1] = newKline;
        } else {
            this.klines.push(newKline);
            if(this.klines.length > 500) this.klines.shift();
        }
        this.bot.klinesLoaded = this.klines.length;
        this.bot.lastAnalysisTimestamp = new Date().getTime();
        this.onUpdate();
    }

    public onManagementKlineUpdate(newKline: Kline) {
        const lastKline = this.managementKlines.length > 0 ? this.managementKlines[this.managementKlines.length - 1] : null;
        if (lastKline && newKline.time === lastKline.time) {
            this.managementKlines[this.managementKlines.length - 1] = newKline;
        } else {
            this.managementKlines.push(newKline);
            if(this.managementKlines.length > 500) this.managementKlines.shift();
        }
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
        if (!this.handlersRef.current?.onExecuteTrade) {
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
        if (this.bot.config.isTakeProfitLocked && !agentTargets.partialTps) {
             const positionValue = this.bot.config.mode === TradingMode.USDSM_Futures ? this.bot.config.investmentAmount * this.bot.config.leverage : this.bot.config.investmentAmount;
             const tradeSize = positionValue / currentPrice;
             if(this.bot.config.takeProfitMode === RiskMode.Percent) {
                 const profitAmount = this.bot.config.investmentAmount * (this.bot.config.takeProfitValue / 100);
                 finalTp = signal.signal === 'BUY' ? currentPrice + (profitAmount / tradeSize) : currentPrice - (profitAmount / tradeSize);
             } else {
                 finalTp = signal.signal === 'BUY' ? currentPrice + (this.bot.config.takeProfitValue / tradeSize) : currentPrice - (this.bot.config.takeProfitValue / tradeSize);
             }
        }
        
        let finalSl = agentTargets.stopLossPrice;
        const positionValueForCap = this.bot.config.mode === TradingMode.USDSM_Futures ? this.bot.config.investmentAmount * this.bot.config.leverage : this.bot.config.investmentAmount;
        const tradeSizeForCap = positionValueForCap / currentPrice;
        if (tradeSizeForCap > 0) {
            const maxLossAmount = this.bot.config.investmentAmount * (MAX_STOP_LOSS_PERCENT_OF_INVESTMENT / 100);
            const hardCapStopLossPrice = signal.signal === 'BUY' ? currentPrice - (maxLossAmount / tradeSizeForCap) : currentPrice + (maxLossAmount / tradeSizeForCap);
            finalSl = signal.signal === 'BUY' ? Math.max(finalSl, hardCapStopLossPrice) : Math.min(finalSl, hardCapStopLossPrice);
        }

        this.addLog(`Executing ${signal.signal} at ~${currentPrice.toFixed(this.bot.config.pricePrecision)}. SL: ${finalSl.toFixed(this.bot.config.pricePrecision)}, TP: ${finalTp.toFixed(this.bot.config.pricePrecision)}`, LogType.Action);

        const execSignal: TradeSignal = {
            ...signal,
            entryPrice: currentPrice,
            takeProfitPrice: finalTp,
            stopLossPrice: finalSl,
            partialTps: agentTargets.partialTps,
            trailStartPrice: agentTargets.trailStartPrice,
        };

        this.handlersRef.current.onExecuteTrade(execSignal, this.bot.id);
    }

    private async runAnalysis() {
        if (this.isTicking) return;
        this.isTicking = true;
        
        try {
            await this.runImmediateAnalysis();
        } catch (error) {
            this.addLog(`Error during analysis: ${error}`, LogType.Error);
        } finally {
            this.isTicking = false;
            this.onUpdate();
        }
    }

    private async manageOpenPosition() {
        if (this.isTicking) return;
        this.isTicking = true;
        
        try {
            const { openPosition, livePrice, config } = this.bot;
            if (!openPosition || !livePrice || !this.handlersRef.current) return;

            const { onClosePosition, onPartialClose } = this.handlersRef.current;
            const isLong = openPosition.direction === 'LONG';
            
            const tpCondition = isLong ? livePrice >= openPosition.takeProfitPrice : livePrice <= openPosition.takeProfitPrice;
            const slCondition = isLong ? livePrice <= openPosition.stopLossPrice : livePrice >= openPosition.stopLossPrice;

            if (tpCondition && !openPosition.partialTps) {
                this.addLog(`Take profit triggered at ${openPosition.takeProfitPrice.toFixed(config.pricePrecision)}.`, LogType.Success);
                onClosePosition(openPosition, 'Take Profit Hit', openPosition.takeProfitPrice);
                return;
            }
            if (slCondition) {
                this.addLog(`Stop loss triggered at ${openPosition.stopLossPrice.toFixed(config.pricePrecision)}.`, LogType.Error);
                onClosePosition(openPosition, 'Stop Loss Hit', openPosition.stopLossPrice);
                return;
            }
            
            const mgmtHistorySlice = this.managementKlines.length > 0 ? this.managementKlines : this.klines;
            if (mgmtHistorySlice.length > 5 && !config.isTakeProfitLocked) {
                 const mgmtSignal = await getTradeManagementSignal(openPosition, mgmtHistorySlice, livePrice, config);
                 
                 if (mgmtSignal.closePosition) {
                     this.addLog(`Proactive exit triggered: ${mgmtSignal.reasons.join(' ')}`, LogType.Action);
                     onClosePosition(openPosition, `Proactive Exit: ${mgmtSignal.reasons.join(' ')}`, livePrice);
                     return;
                 }
                 if(mgmtSignal.partialClose && onPartialClose) {
                    onPartialClose(openPosition, mgmtSignal.partialClose.tpIndex);
                 }
                 if (mgmtSignal.newStopLoss && mgmtSignal.newStopLoss !== openPosition.stopLossPrice) {
                    this.addLog(`Trailing stop updated to ${mgmtSignal.newStopLoss.toFixed(config.pricePrecision)}. Reason: ${mgmtSignal.reasons.join(' ')}`, LogType.Info);
                    openPosition.stopLossPrice = mgmtSignal.newStopLoss;
                 }
                 if (mgmtSignal.newTakeProfit && mgmtSignal.newTakeProfit !== openPosition.takeProfitPrice) {
                    this.addLog(`Take profit updated to ${mgmtSignal.newTakeProfit.toFixed(config.pricePrecision)}. Reason: ${mgmtSignal.reasons.join(' ')}`, LogType.Info);
                    openPosition.takeProfitPrice = mgmtSignal.newTakeProfit;
                 }
            }
        } catch (error) {
             this.addLog(`Error managing position: ${error}`, LogType.Error);
        } finally {
            this.isTicking = false;
            this.onUpdate();
        }
    }
    
    private async tick() {
        if (this.bot.status === BotStatus.Paused || this.bot.status === BotStatus.Stopped || this.bot.status === BotStatus.Stopping) {
            return;
        }

        if (this.bot.status === BotStatus.Cooldown) {
            if (this.bot.cooldownUntil && Date.now() > this.bot.cooldownUntil) {
                this.addLog('Cooldown finished. Resuming monitoring.', LogType.Status);
                this.updateState({ status: BotStatus.Monitoring, cooldownUntil: null });
            }
            return;
        }

        if (this.bot.openPosition) {
            await this.manageOpenPosition();
        } else if ([BotStatus.Monitoring, BotStatus.PostProfitAnalysis].includes(this.bot.status)) {
            await this.runAnalysis();
        }
    }

    public notifyTradeExecutionFailed(reason: string) {
        this.addLog(`Trade execution failed: ${reason}`, LogType.Error);
        this.updateState({ status: BotStatus.Monitoring });
    }

    public stop() {
        if (this.masterTimer) {
            clearInterval(this.masterTimer);
            this.masterTimer = null;
        }
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
    private setRunningBotsState: ((bots: RunningBot[]) => void) | null = null;
    private tickerSubscriptions: Map<string, { ws: WebSocket | null, callbacks: Function[], mode: TradingMode }> = new Map();
    private klineSubscriptions: Map<string, { ws: WebSocket | null, callbacks: Function[], mode: TradingMode }> = new Map();

    init(setRunningBots: (bots: RunningBot[]) => void) {
        this.setRunningBotsState = setRunningBots;
        this.updateState();
    }
    
    private updateState() {
        if (this.setRunningBotsState) {
            const botArray = Array.from(this.bots.values()).map(instance => instance.bot).sort((a,b) => a.id > b.id ? -1 : 1);
            this.setRunningBotsState(botArray);
        }
    }

    private getWebSocketUrl(mode: TradingMode): string {
        const isProd = import.meta.env.PROD;
        if (isProd) {
            return mode === TradingMode.USDSM_Futures ? 'wss://fstream.binance.com' : 'wss://stream.binance.com:9443';
        }

        // For development, use a relative protocol to match the page's protocol (http -> ws, https -> wss)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host; // e.g., 'localhost:5173'
        const proxyPath = mode === TradingMode.USDSM_Futures ? '/proxy-futures-ws' : '/proxy-spot-ws';

        return `${protocol}//${host}${proxyPath}`;
    }

    public startBot(config: BotConfig, handlersRef: React.RefObject<BotHandlers>) {
        const instance = new BotInstance(config, () => this.updateState(), handlersRef);
        this.bots.set(instance.bot.id, instance);
        this.addBotLog(instance.bot.id, `Starting bot...`, LogType.Status);

        const formattedPair = config.pair.replace('/', '');
        binanceService.fetchKlines(formattedPair, config.timeFrame, { limit: 500 })
            .then(klines => {
                instance.initialize(klines);
                this.subscribeToKlineUpdates(formattedPair, config.timeFrame, config.mode, (kline: Kline) => instance.onMainKlineUpdate(kline));
                this.subscribeToKlineUpdates(formattedPair, '1m', config.mode, (kline: Kline) => instance.onManagementKlineUpdate(kline));
            })
            .catch(e => {
                this.addBotLog(instance.bot.id, `Failed to fetch initial klines: ${e}`, LogType.Error);
                instance.updateState({ status: BotStatus.Error });
            });

        this.subscribeToTickerUpdates(formattedPair, config.mode, (ticker: LiveTicker) => {
            instance.updateLivePrice(ticker.closePrice, ticker);
        });

        this.updateState();
    }
    
    private stopAndRemoveBot(botId: string) {
        const instance = this.bots.get(botId);
        if (instance) {
            instance.stop();
            const { pair, timeFrame, mode } = instance.bot.config;
            const formattedPair = pair.replace('/', '');
            // Here you would add logic to unsubscribe from streams if this is the last bot using them.
            // For simplicity in this example, we'll leave subscriptions open.
            this.bots.delete(botId);
        }
        this.updateState();
    }

    public stopBot(botId: string) {
        const bot = this.getBot(botId);
        if(bot) {
            bot.stop();
            this.updateState();
        }
    }
    
    public deleteBot(botId: string) {
        this.stopAndRemoveBot(botId);
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
        if(bot) {
            bot.bot.config = { ...bot.bot.config, ...partialConfig };
            bot.addLog("Configuration updated.", LogType.Info);
            this.updateState();
        }
    }

    public stopAllBots() {
        this.bots.forEach(bot => bot.stop());
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
            };

            if (bot.bot.config.isCooldownEnabled && isWin) {
                statusUpdate.status = BotStatus.PostProfitAnalysis;
                statusUpdate.lastProfitableTradeDirection = bot.bot.openPosition?.direction || null;
                bot.addLog(`Trade closed with profit. Entering post-profit analysis phase.`, LogType.Status);
            } else {
                statusUpdate.status = BotStatus.Monitoring;
                bot.addLog(`Trade closed. Resuming monitoring.`, LogType.Status);
            }
            
            bot.updateState(statusUpdate);
        }
    }
    
    public notifyPartialPositionClosed(botId: string, realizedPnl: number, closedSize: number, tpIndex: number) {
        const bot = this.getBot(botId);
        if (bot && bot.bot.openPosition && bot.bot.openPosition.partialTps) {
            bot.addLog(`Partial close for TP #${tpIndex + 1} successful. PNL: $${realizedPnl.toFixed(2)}`, LogType.Success);
            
            const newPosition = { ...bot.bot.openPosition };
            newPosition.size -= closedSize;
            newPosition.partialTps![tpIndex].hit = true;

            const statusUpdate: Partial<RunningBot> = {
                openPosition: newPosition,
                totalPnl: bot.bot.totalPnl + realizedPnl,
                // Partial PNL is added to gross profit/loss
                totalGrossProfit: bot.bot.totalGrossProfit + (realizedPnl > 0 ? realizedPnl : 0),
                totalGrossLoss: bot.bot.totalGrossLoss + (realizedPnl < 0 ? Math.abs(realizedPnl) : 0),
            };
            
            bot.updateState(statusUpdate);
        }
    }

    public notifyTradeExecutionFailed(botId: string, reason: string) {
        this.getBot(botId)?.notifyTradeExecutionFailed(reason);
    }
    
    // --- WebSocket Subscription Management ---

    public subscribeToTickerUpdates(pair: string, mode: TradingMode, callback: (ticker: LiveTicker) => void) {
        const streamName = `${pair.toLowerCase()}@ticker`;
        let sub = this.tickerSubscriptions.get(streamName);

        if (!sub) {
            sub = { ws: null, callbacks: [], mode };
            this.tickerSubscriptions.set(streamName, sub);
            this.connectTickerWebSocket(streamName, sub);
        }
        sub.callbacks.push(callback);
    }

    public unsubscribeFromTickerUpdates(pair: string, mode: TradingMode, callback: Function) {
        const streamName = `${pair.toLowerCase()}@ticker`;
        const sub = this.tickerSubscriptions.get(streamName);
        if (sub) {
            sub.callbacks = sub.callbacks.filter(cb => cb !== callback);
            if (sub.callbacks.length === 0) {
                sub.ws?.close();
                this.tickerSubscriptions.delete(streamName);
            }
        }
    }

    private connectTickerWebSocket(streamName: string, sub: { ws: WebSocket | null, callbacks: Function[], mode: TradingMode }) {
        const url = `${this.getWebSocketUrl(sub.mode)}/ws/${streamName}`;
        sub.ws = new WebSocket(url);

        sub.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            const ticker: LiveTicker = {
                pair: data.s,
                closePrice: parseFloat(data.c),
                highPrice: parseFloat(data.h),
                lowPrice: parseFloat(data.l),
                volume: parseFloat(data.v),
                quoteVolume: parseFloat(data.q)
            };
            sub.callbacks.forEach(cb => cb(ticker));
        };
        sub.ws.onerror = (err) => console.error(`Ticker WS Error for ${streamName}:`, err);
        sub.ws.onclose = () => {
            if (this.tickerSubscriptions.has(streamName)) setTimeout(() => this.connectTickerWebSocket(streamName, sub!), RECONNECT_DELAY);
        };
    }
    
    public subscribeToKlineUpdates(pair: string, timeFrame: string, mode: TradingMode, callback: (kline: Kline) => void) {
        const streamName = `${pair.toLowerCase()}@kline_${timeFrame}`;
        let sub = this.klineSubscriptions.get(streamName);
        if (!sub) {
            sub = { ws: null, callbacks: [], mode };
            this.klineSubscriptions.set(streamName, sub);
            this.connectKlineWebSocket(streamName, sub);
        }
        sub.callbacks.push(callback);
    }
    
    public unsubscribeFromKlineUpdates(pair: string, timeFrame: string, mode: TradingMode, callback: Function) {
        const streamName = `${pair.toLowerCase()}@kline_${timeFrame}`;
        const sub = this.klineSubscriptions.get(streamName);
        if (sub) {
            sub.callbacks = sub.callbacks.filter(cb => cb !== callback);
            if (sub.callbacks.length === 0) {
                sub.ws?.close();
                this.klineSubscriptions.delete(streamName);
            }
        }
    }

    private connectKlineWebSocket(streamName: string, sub: { ws: WebSocket | null, callbacks: Function[], mode: TradingMode }) {
        const url = `${this.getWebSocketUrl(sub.mode)}/ws/${streamName}`;
        sub.ws = new WebSocket(url);
        
        sub.ws.onmessage = (event) => {
            const data = JSON.parse(event.data).k;
            const kline: Kline = {
                time: data.t, open: parseFloat(data.o), high: parseFloat(data.h),
                low: parseFloat(data.l), close: parseFloat(data.c),
                volume: parseFloat(data.v), isFinal: data.x
            };
            sub.callbacks.forEach(cb => cb(kline));
        };
        sub.ws.onerror = (err) => console.error(`Kline WS Error for ${streamName}:`, err);
        sub.ws.onclose = () => {
            if (this.klineSubscriptions.has(streamName)) setTimeout(() => this.connectKlineWebSocket(streamName, sub!), RECONNECT_DELAY);
        };
    }
}

export const botManagerService = new BotManagerService();
