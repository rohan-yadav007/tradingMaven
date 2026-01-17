
// services/botManagerService.ts

import { RunningBot, BotConfig, BotStatus, TradeSignal, Kline, BotLogEntry, Position, LiveTicker, LogType, TradingMode, MarketDataContext, AgentParams, TradeManagementSignal } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getMultiStageProfitSecureSignal, getAgentExitSignal, getInitialAgentTargets, validateTradeProfitability, getTradeGuardianSignal, getMandatoryBreakevenSignal, getProfitSpikeSignal, getAggressiveRangeTrailSignal, captureMarketContext, getAdaptiveTakeProfit } from './localAgentService';
import { TIME_FRAMES, getMicroTimeframe } from '../constants';
import { telegramBotService } from './telegramBotService';
import { WebSocketManager } from './webSocketManager';
import { sharedKlineService } from './sharedKlineService';
import * as constants from '../constants';
import { getConfluenceTimeframes, getAstraXRegimeAndDirection } from './agents/astrax';
import { getOmegaSignal, SovereignManagementEngine, logFailedOmegaSetup } from './agents/omega';
import { orderBookService } from './orderBookService';
import { historyService } from './historyService';
import { spotWsManager, futuresWsManager } from './wsRegistry';

const MAX_LOG_ENTRIES = 100;

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

export class BotInstance {
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
    public subscriptionCleanups: Function[] = [];
    
    private executing = false;
    private isInitialized: boolean = false;
    private lastManagementTimestamp = 0;
    private lastClosedTradeTimestamp = 0;
    private lastTradeWasLoss = false;
    private matrixReadyLogged = false;

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
    
    private isMatrixReady(): boolean {
        const requiredTfs = ['1m', '5m', '15m', '1h', '4h'];
        const missing = requiredTfs.filter(tf => {
            const data = this.astraXKlinesMap.get(tf);
            return !data || data.length < 100;
        });

        if (missing.length > 0) {
            return false;
        }
        
        if (!this.matrixReadyLogged) {
            this.addLog("✅ Omega Matrix Fully Synchronized (4H/1H/15m/5m/1m)", LogType.Success);
            this.matrixReadyLogged = true;
        }
        return true;
    }
    
    public onMatrixKlineUpdate = async (timeframe: string, newKline: Kline) => {
        const existing = this.astraXKlinesMap.get(timeframe);
        if (existing) {
            const last = existing[existing.length - 1];
            if (last && newKline.time === last.time) {
                existing[existing.length - 1] = newKline;
            } else if (!last || newKline.time > last.time) {
                existing.push(newKline);
                if (existing.length > 501) existing.shift();
            }
        }

        if (this.bot.openPosition && timeframe === this.bot.config.timeFrame && newKline.isFinal) {
             const pos = this.bot.openPosition;
             this.updateState({
                 openPosition: { ...pos, candlesSinceEntry: pos.candlesSinceEntry + 1 }
             }, false);
        }

        const isMatrixAgent = this.bot.config.agent.id === 25;
        const isTriggerTF = timeframe === '5m' || timeframe === '1m';

        if (isMatrixAgent && isTriggerTF && newKline.isFinal && this.bot.status === BotStatus.Monitoring && !this.bot.openPosition) {
            if (this.executing) return;
            this.executing = true;
            try {
                await this.runAnalysis({ execute: true, reason: `Matrix ${timeframe} Pulse` });
            } finally {
                this.executing = false;
            }
        }
    }

    public runAnalysis = async (options: { execute: boolean, reason: string, klinesOverride?: Kline[] }) => {
        const isMatrixAgent = this.bot.config.agent.id === 25 || this.bot.config.agent.id === 19;
        
        if (isMatrixAgent && !this.isMatrixReady()) {
            return;
        }

        const klinesToUse = options.klinesOverride || this.klines;
        const minLen = (this.bot.config.agent.id === 19 || this.bot.config.agent.id === 25) ? 1 : 50;
        if (klinesToUse.length < minLen) return;

        try {
            let klinesForAnalysis = klinesToUse;
            if (!options.klinesOverride && this.bot.config.entryTiming === 'immediate' && this.bot.livePrice && klinesToUse.length > 0) {
                const lastKline = klinesToUse[klinesToUse.length - 1];
                if (this.bot.config.agent.id === 25) {
                    if (!lastKline.isFinal) {
                         klinesForAnalysis = klinesToUse.slice(0, -1);
                    }
                } 
                else if (!lastKline.isFinal) {
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
                const now = binanceService.getSyncedNow();
                const COOLDOWN_MS = 5 * 60 * 1000;
                
                if (!this.bot.openPosition && (now - this.lastClosedTradeTimestamp < COOLDOWN_MS)) {
                    if (this.lastTradeWasLoss) return;
                    let isHighConviction = false;
                    if (this.bot.config.agent.id === 25 && signal.omegaAnalysis?.conviction >= 80) isHighConviction = true;
                    else if (signal.astraXAnalysis?.conviction >= 80) isHighConviction = true;
                    if (!isHighConviction) return;
                }

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

        const updatePayload: Partial<RunningBot> = { livePrice: price, liveTicker: tickerData, lastPriceUpdateTimestamp: now };
        if (this.bot.openPosition) {
            const pos = this.bot.openPosition;
            let newPeak = pos.peakPrice, newTrough = pos.troughPrice, posUpdated = false;
            if (pos.direction === 'LONG') {
                if (price > newPeak) { newPeak = price; posUpdated = true; }
                if (price < newTrough) { newTrough = price; posUpdated = true; }
            } else {
                if (price < newPeak) { newPeak = price; posUpdated = true; }
                if (price > newTrough) { newTrough = price; posUpdated = true; }
            }
            if (posUpdated) updatePayload.openPosition = { ...pos, peakPrice: newPeak, troughPrice: newTrough };
        }
        this.updateState(updatePayload, false);
        if (this.bot.openPosition) {
            if (now - this.lastManagementTimestamp >= 500) {
                this.lastManagementTimestamp = now;
                await this.managePositionOnTick(price);
                this.checkPriceBoundaries(price);
            }
        }
    }

    public executeTrade = async (signal: TradeSignal, klinesForContext: Kline[]) => {
        if (!signal.entryPrice || !signal.stopLossPrice || !signal.takeProfitPrice) {
            this.addLog(`Cannot execute trade: Missing price targets.`, LogType.Error);
            this.updateState({ status: BotStatus.Monitoring }, true);
            return;
        }

        const slReason = 'Agent Logic'; 
        const entryContext = captureMarketContext(klinesForContext, this.htfKlines, this.bot.config.agentParams, this.bot.config.timeFrame);
        if (signal.omegaMetadata) entryContext.omega_metadata = signal.omegaMetadata;

        let convictionSizeMultiplier = 1.0;
        if (this.bot.config.isDynamicSizingEnabled) {
            if (signal.omegaAnalysis?.sizing?.multiplier) convictionSizeMultiplier = signal.omegaAnalysis.sizing.multiplier;
            else if (signal.astraXAnalysis) convictionSizeMultiplier = signal.astraXAnalysis.conviction / 100;
            else if (signal.conductorAnalysis) convictionSizeMultiplier = Math.max(signal.conductorAnalysis.bullish.total, signal.conductorAnalysis.bearish.total) / 100;
        }

        const executionDetails = {
            agentStopLoss: signal.stopLossPrice,
            slReason: slReason as 'Agent Logic' | 'Hard Cap' | 'Noise Floor',
            entryContext: entryContext as MarketDataContext,
            convictionSizeMultiplier
        };

        this.addLog(`Executing ${signal.signal} signal...`, LogType.Action);
        try {
            await this.handlers.onExecuteTrade(signal, this.bot.id, executionDetails);
        } catch (error) {
            this.addLog(`Trade execution failed: ${error}`, LogType.Error);
            this.updateState({ status: BotStatus.Monitoring }, true);
        }
    }

    public managePositionOnTick = async (currentPrice: number) => {
        if (!this.bot.openPosition) return;
        const position = this.bot.openPosition;
        const applyUpdate = (sig: TradeManagementSignal) => {
            let updates: Partial<Position> = {}, logReasons: string[] = [];
            if (sig.newStopLoss && ((position.direction === 'LONG' && sig.newStopLoss > position.stopLossPrice) || (position.direction === 'SHORT' && sig.newStopLoss < position.stopLossPrice))) {
                updates.stopLossPrice = sig.newStopLoss;
                updates.activeStopLossReason = sig.activeStopLossReason || position.activeStopLossReason;
                if (sig.newState) updates = { ...updates, ...sig.newState };
                logReasons.push(sig.reasons[0]);
            }
            if (sig.newTakeProfit && sig.newTakeProfit !== position.takeProfitPrice) {
                 updates.takeProfitPrice = sig.newTakeProfit;
                 const tpReason = sig.reasons.find(r => r.includes('TP') || r.includes('Horizon'));
                 if (tpReason) logReasons.push(tpReason);
            }
            if (Object.keys(updates).length > 0) {
                this.updateState({ openPosition: { ...position, ...updates } }, false);
                logReasons.forEach(r => this.addLog(r, LogType.Action));
            }
        };

        if (position.agentId === 25) {
             const omegaSignal = SovereignManagementEngine.manage(position, currentPrice, this.klines, this.astraXKlinesMap);
             if (omegaSignal.action === 'close') {
                 this.handlers.onClosePosition(position, omegaSignal.reasons[0] || 'Omega Management', currentPrice);
                 return;
             }
             applyUpdate(omegaSignal);
             return;
        }

        const guardianSignal = getTradeGuardianSignal(position, this.klines, this.immediateKlines, currentPrice, this.btcKlines);
        if (guardianSignal.action === 'close') {
            this.handlers.onClosePosition(position, guardianSignal.reason || 'Trade Guardian Exit', currentPrice);
            return;
        }
        const aggressiveSignal = getAggressiveRangeTrailSignal(position, currentPrice);
        const spikeSignal = getProfitSpikeSignal(position, currentPrice);
        const secureSignal = getMultiStageProfitSecureSignal(position, currentPrice);
        const breakevenSignal = getMandatoryBreakevenSignal(position, currentPrice);
        const managementSignal = getAgentExitSignal(position, this.klines, currentPrice, this.bot.config);

        if (aggressiveSignal.newStopLoss) applyUpdate(aggressiveSignal);
        else if (spikeSignal.newStopLoss) applyUpdate(spikeSignal);
        else if (secureSignal.newStopLoss) applyUpdate(secureSignal);
        else if (breakevenSignal.newStopLoss) applyUpdate(breakevenSignal);
        else if (managementSignal.newStopLoss) applyUpdate(managementSignal);
    }

    public checkPriceBoundaries = (currentPrice: number) => {
        if (!this.bot.openPosition) return;
        const pos = this.bot.openPosition;
        const isLong = pos.direction === 'LONG';
        const hitTP = isLong ? currentPrice >= pos.takeProfitPrice : currentPrice <= pos.takeProfitPrice;
        const hitSL = isLong ? currentPrice <= pos.stopLossPrice : currentPrice >= pos.stopLossPrice;
        if (hitTP) {
            this.handlers.onClosePosition(pos, 'Take Profit', currentPrice);
            this.lastTradeWasLoss = false;
            this.lastClosedTradeTimestamp = binanceService.getSyncedNow();
        } else if (hitSL) {
            this.handlers.onClosePosition(pos, `Stop Loss (${pos.activeStopLossReason})`, currentPrice);
            this.lastTradeWasLoss = true;
            this.lastClosedTradeTimestamp = binanceService.getSyncedNow();
            if (this.bot.config.agent.id === 25 && pos.setupType) logFailedOmegaSetup(pos.pair, pos.initialStopLossPrice, pos.setupType, pos.direction);
        }
    }
}

class BotManagerService {
    private bots: Map<string, BotInstance> = new Map();
    private handlers: BotHandlers | null = null;
    private listeners: Function[] = [];
    private botUpdateListeners: Map<string, Function[]> = new Map();
    private tickerSubscriptions = new Map<string, { modes: Set<TradingMode>, callbacks: ((ticker: LiveTicker) => void)[] }>();
    private dailyLossLimit: number = 0;

    public setHandlers(handlers: BotHandlers) { this.handlers = handlers; }
    public setDailyLossLimit(limit: number) { this.dailyLossLimit = limit; }

    public startBot(config: BotConfig): RunningBot {
        if (!this.handlers) throw new Error("BotHandlers not initialized");
        const notifyUpdate = (bot: RunningBot, isStructural: boolean) => {
            const botListeners = this.botUpdateListeners.get(bot.id);
            if (botListeners) botListeners.forEach(cb => cb(bot));
            if (isStructural) this.notifyListeners();
        };
        const instance = new BotInstance(config, notifyUpdate, this.handlers);
        this.bots.set(instance.bot.id, instance);
        this.notifyListeners();
        this.initializeBotData(instance);
        return instance.bot;
    }

    private async initializeBotData(instance: BotInstance) {
        try {
            const { pair, timeFrame, mode, isHtfConfirmationEnabled, htfTimeFrame } = instance.bot.config;
            const formattedPair = pair.replace('/', '');
            const klines = await binanceService.fetchKlines(formattedPair, timeFrame, { limit: 500, mode });
            if (isHtfConfirmationEnabled) {
                const htf = htfTimeFrame === 'auto' ? constants.getHigherTimeframe(timeFrame) : htfTimeFrame;
                if (htf) instance.htfKlines = await binanceService.fetchKlines(formattedPair, htf, { limit: 200, mode });
            }
            if (instance.bot.config.agent.id === 25 || instance.bot.config.agent.id === 19) {
                const tfs = ['1m', '5m', '15m', '1h', '4h', '1d']; 
                instance.astraXKlinesMap.set(timeFrame, klines);
                const missingTfs = tfs.filter(tf => tf !== timeFrame);
                await Promise.all(missingTfs.map(async (tf) => {
                    const data = await binanceService.fetchKlines(formattedPair, tf, { limit: 200, mode });
                    instance.astraXKlinesMap.set(tf, data);
                }));
            }
            this.setupDataSubscriptions(instance);
            await instance.initialize(klines);
        } catch (error) {
            instance.addLog(`Initialization failed: ${error}`, LogType.Error);
            instance.updateState({ status: BotStatus.Error }, true);
        }
    }

    private setupDataSubscriptions(instance: BotInstance) {
        const { pair, timeFrame, mode } = instance.bot.config;
        const formattedPair = pair.replace('/', '');
        const subscribeKline = (tf: string, callback: (k: Kline) => void) => {
            const wsManager = mode === TradingMode.USDSM_Futures ? futuresWsManager : spotWsManager;
            const stream = `${formattedPair.toLowerCase()}@kline_${tf}`;
            const handler = (data: any) => {
                const k: Kline = { time: data.k.t, open: parseFloat(data.k.o), high: parseFloat(data.k.h), low: parseFloat(data.k.l), close: parseFloat(data.k.c), volume: parseFloat(data.k.v), isFinal: data.k.x };
                callback(k);
            };
            wsManager.subscribe(stream, handler);
            instance.subscriptionCleanups.push(() => wsManager.unsubscribe(stream, handler));
        };
        subscribeKline(timeFrame, (k) => {
            const last = instance.klines[instance.klines.length - 1];
            if (last && k.time === last.time) instance.klines[instance.klines.length - 1] = k;
            else { instance.klines.push(k); if (instance.klines.length > 500) instance.klines.shift(); }
            instance.onMatrixKlineUpdate(timeFrame, k);
            if (k.isFinal && instance.bot.config.agent.id !== 25) instance.runAnalysis({ execute: true, reason: 'Candle Close' });
        });
        if (instance.bot.config.agent.id === 25 || instance.bot.config.agent.id === 19) {
            ['1m', '5m', '15m', '1h', '4h', '1d'].forEach(tf => {
                if (tf !== timeFrame) subscribeKline(tf, (k) => instance.onMatrixKlineUpdate(tf, k));
            });
        }
        const tickerCallback = () => {};
        this.subscribeToTickerUpdates(formattedPair, mode, tickerCallback);
        instance.subscriptionCleanups.push(() => this.unsubscribeFromTickerUpdates(formattedPair, mode, tickerCallback));
    }

    public stopBot(botId: string) {
        const instance = this.bots.get(botId);
        if (instance) {
            instance.subscriptionCleanups.forEach(cleanup => cleanup());
            instance.subscriptionCleanups = [];
            instance.updateState({ status: BotStatus.Stopped }, true);
        }
    }

    public deleteBot(botId: string) { this.stopBot(botId); this.bots.delete(botId); this.notifyListeners(); }
    public pauseBot(botId: string) { const instance = this.bots.get(botId); if (instance) instance.updateState({ status: BotStatus.Paused }, true); }
    public resumeBot(botId: string) { const instance = this.bots.get(botId); if (instance) instance.updateState({ status: BotStatus.Monitoring, lastResumeTimestamp: Date.now() }, true); }
    public updateBotConfig(botId: string, partialConfig: Partial<BotConfig>) {
        const instance = this.bots.get(botId);
        if (instance) {
            const newConfig = { ...instance.bot.config, ...partialConfig };
            instance.updateState({ config: newConfig }, false); 
            instance.addLog(`Configuration updated.`, LogType.Info);
        }
    }
    public refreshBotAnalysis(botId: string) { const instance = this.bots.get(botId); if (instance) instance.runAnalysis({ execute: false, reason: 'Manual Refresh' }); }
    public getBot(botId: string): BotInstance | undefined { return this.bots.get(botId); }
    public getRunningBots(): RunningBot[] { return Array.from(this.bots.values()).map(i => i.bot); }

    public subscribeToTickerUpdates(pair: string, mode: TradingMode, callback: (ticker: LiveTicker) => void) {
        const key = pair.toLowerCase(); 
        if (!this.tickerSubscriptions.has(key)) {
            this.tickerSubscriptions.set(key, { modes: new Set(), callbacks: [] });
            const wsManager = mode === TradingMode.USDSM_Futures ? futuresWsManager : spotWsManager;
            const stream = `${key}@ticker`; 
            wsManager.subscribe(stream, (data: any) => {
                const ticker: LiveTicker = { pair: key, closePrice: parseFloat(data.c), highPrice: parseFloat(data.h), lowPrice: parseFloat(data.l), volume: parseFloat(data.v), quoteVolume: parseFloat(data.q) };
                const sub = this.tickerSubscriptions.get(key);
                if (sub) {
                    sub.callbacks.forEach(cb => cb(ticker));
                    this.bots.forEach(instance => {
                        const botPair = instance.bot.config.pair.replace('/', '').toLowerCase();
                        if (botPair === key && !isNaN(ticker.closePrice)) instance.updateLivePrice(ticker.closePrice, ticker);
                    });
                }
            });
        }
        const sub = this.tickerSubscriptions.get(key)!;
        sub.modes.add(mode);
        sub.callbacks.push(callback);
    }

    public unsubscribeFromTickerUpdates(pair: string, mode: TradingMode, callback: (ticker: LiveTicker) => void) {
        const key = pair.toLowerCase();
        const sub = this.tickerSubscriptions.get(key);
        if (sub) {
            const index = sub.callbacks.indexOf(callback);
            if (index > -1) sub.callbacks.splice(index, 1);
            if (sub.callbacks.length === 0) {
                const wsManager = mode === TradingMode.USDSM_Futures ? futuresWsManager : spotWsManager;
                wsManager.unsubscribe(`${key}@ticker`, () => {}); 
                this.tickerSubscriptions.delete(key);
            }
        }
    }

    public setOnBotListChange(listener: (() => void) | null) { if (listener) this.listeners.push(listener); else this.listeners = []; }
    private notifyListeners() { this.listeners.forEach(cb => cb()); }
    public subscribeToBotUpdates(botId: string, callback: (bot: RunningBot) => void) {
        if (!this.botUpdateListeners.has(botId)) this.botUpdateListeners.set(botId, []);
        this.botUpdateListeners.get(botId)!.push(callback);
    }
    public unsubscribeFromBotUpdates(botId: string, callback: (bot: RunningBot) => void) {
        const listeners = this.botUpdateListeners.get(botId);
        if (listeners) {
            const index = listeners.indexOf(callback);
            if (index > -1) listeners.splice(index, 1);
        }
    }
    public notifyPositionClosed(botId: string, pnl: number) {
        const instance = this.bots.get(botId);
        if (instance) {
            const newStats = { closedTradesCount: instance.bot.closedTradesCount + 1, wins: instance.bot.wins + (pnl > 0 ? 1 : 0), losses: instance.bot.losses + (pnl <= 0 ? 1 : 0), totalPnl: instance.bot.totalPnl + pnl, openPosition: null, openPositionId: null, status: BotStatus.Monitoring, lastProfitableTradeDirection: pnl > 0 ? instance.bot.openPosition?.direction || null : null };
            instance.updateState(newStats, true);
            instance.addLog(`Trade closed. PNL: $${pnl.toFixed(2)}`, pnl > 0 ? LogType.Success : LogType.Error);
        }
    }
    public notifyTradeExecutionFailed(botId: string, reason: string) {
        const instance = this.bots.get(botId);
        if (instance) {
            instance.addLog(`Trade Execution Failed: ${reason}`, LogType.Error);
            instance.updateState({ status: BotStatus.Monitoring }, true); 
        }
    }
    public updateBotState(botId: string, partialState: Partial<RunningBot>) { const instance = this.bots.get(botId); if (instance) instance.updateState(partialState, true); }
    public addBotLog(botId: string, message: string, type: LogType) { const instance = this.bots.get(botId); if (instance) instance.addLog(message, type); }
    public stopAllBots() { this.bots.forEach(bot => this.stopBot(bot.bot.id)); }
}

export const botManagerService = new BotManagerService();
