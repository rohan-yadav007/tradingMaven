
import { RunningBot, BotConfig, BotStatus, TradeSignal, Kline, BotLogEntry, Position, LiveTicker, LogType } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getTradeManagementSignal } from './localAgentService';
import { BOT_COOLDOWN_CANDLES } from '../constants';

const MAX_LOG_ENTRIES = 50;
const MANAGEMENT_TIMEFRAME = '1m'; // Use 1m as the data source for management klines
const TICK_INTERVAL_MS = 60 * 1000; // The bot's core "heartbeat", now 1 minute to sync with backtesting

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
    onExecuteTrade: (signal: TradeSignal, botId: string) => void;
    onClosePosition: (position: Position, exitReason: string, exitPrice: number) => void;
    onUpdatePositionTargets: (positionId: number, newTargets: { tp?: number; sl?: number; }) => void;
}

class BotInstance {
    public bot: RunningBot;
    private klines: Kline[] = []; // Main timeframe klines
    private managementKlines: Kline[] = []; // 1m klines for management ticks
    private onUpdate: () => void;
    private handlersRef: React.RefObject<BotHandlers>;
    private tickInterval: number | null = null;
    
    constructor(
        config: BotConfig,
        onUpdate: () => void,
        handlersRef: React.RefObject<BotHandlers>
    ) {
        this.bot = {
            id: `bot-${Date.now()}-${config.pair.replace('/', '')}`,
            config,
            status: BotStatus.Starting,
            analysis: null,
            log: [{ timestamp: new Date(), message: `Bot created for ${config.pair} on ${config.timeFrame}.`, type: LogType.Info }],
            openPositionId: null,
            openPosition: null,
            closedTradesCount: 0,
            totalPnl: 0,
            cooldownUntil: null,
            accumulatedActiveMs: 0,
            lastResumeTimestamp: Date.now(),
            klinesLoaded: 0,
        };
        this.onUpdate = onUpdate;
        this.handlersRef = handlersRef;
    }

    public async initialize(initialKlines: Kline[], initialMgmtKlines: Kline[]) {
        this.addLog('Initializing with historical data...', LogType.Info);
        this.klines = initialKlines;
        this.managementKlines = initialMgmtKlines;
        this.bot.klinesLoaded = this.klines.length;
        this.addLog(`Initialized with ${this.klines.length} ${this.bot.config.timeFrame} klines.`, LogType.Success);
        
        this.bot.status = BotStatus.Monitoring;
        this.startTickInterval();
        this.onUpdate();
    }
    
    addLog(message: string, type: LogType = LogType.Info) {
        const newLog: BotLogEntry = { timestamp: new Date(), message, type };
        this.bot.log = [newLog, ...this.bot.log].slice(0, MAX_LOG_ENTRIES);
        this.onUpdate();
    }
    
    public updateLivePrice(price: number, tickerData: LiveTicker) {
        this.bot.livePrice = price;
        this.bot.liveTicker = tickerData;

        if (this.bot.status === BotStatus.PositionOpen && this.bot.openPosition && this.handlersRef.current) {
            const position = this.bot.openPosition;
            const isLong = position.direction === 'LONG';
            
            if ((isLong && price >= position.takeProfitPrice) || (!isLong && price <= position.takeProfitPrice)) {
                this.addLog(`Take Profit triggered at ${price}. Closing position.`, LogType.Success);
                this.bot.status = BotStatus.ExecutingTrade;
                this.handlersRef.current.onClosePosition(position, 'Take Profit Hit', price);
            }
            else if ((isLong && price <= position.stopLossPrice) || (!isLong && price >= position.stopLossPrice)) {
                this.addLog(`Stop Loss triggered at ${price}. Closing position.`, LogType.Success);
                this.bot.status = BotStatus.ExecutingTrade;
                this.handlersRef.current.onClosePosition(position, 'Stop Loss Hit', price);
            }
        }
        
        this.onUpdate();
    }

    public updateKlines(newKline: Kline) {
        const lastKline = this.klines[this.klines.length - 1];
        if (lastKline && newKline.time === lastKline.time) {
            this.klines[this.klines.length - 1] = newKline;
        } else {
            this.klines = [...this.klines.slice(1), newKline];
        }
        this.bot.klinesLoaded = this.klines.length;
    }

    public updateManagementKlines(newKline: Kline) {
        const lastKline = this.managementKlines[this.managementKlines.length - 1];
        if (lastKline && newKline.time === lastKline.time) {
            this.managementKlines[this.managementKlines.length - 1] = newKline;
        } else {
            this.managementKlines = [...this.managementKlines.slice(1), newKline];
        }
    }
    
    private async tick() {
        const { status, openPosition, cooldownUntil } = this.bot;

        if ([BotStatus.Paused, BotStatus.Stopped, BotStatus.Error, BotStatus.Starting, BotStatus.Stopping].includes(status)) {
            this.onUpdate(); 
            return;
        }

        // --- POSITION OPEN LOGIC ---
        if (status === BotStatus.PositionOpen && openPosition && this.bot.livePrice) {
            this.bot.analysis = { signal: 'HOLD', reasons: ['In an active position.'] };
            const { isStopLossLocked, isTakeProfitLocked } = this.bot.config;
            
            const managementSignal = await getTradeManagementSignal(openPosition, this.managementKlines, this.bot.livePrice);

            const pnl = (this.bot.livePrice - openPosition.entryPrice) * openPosition.size * (openPosition.direction === 'LONG' ? 1 : -1) * openPosition.leverage;
            const newStatusLog = managementSignal.reasons[0] || 'Awaiting management signal...';
            const isAction = newStatusLog.startsWith('Proactive Action:');

            const logMessage = isAction 
                ? `${newStatusLog} | PNL: $${pnl.toFixed(2)}`
                : `Management Status (PNL: $${pnl.toFixed(2)}): ${newStatusLog}`;
            this.addLog(logMessage, isAction ? LogType.Action : LogType.Status);
            
            const updates: { sl?: number; tp?: number } = {};
            if (managementSignal.newStopLoss && !isStopLossLocked) {
                updates.sl = managementSignal.newStopLoss;
            }
            if (managementSignal.newTakeProfit && !isTakeProfitLocked) {
                updates.tp = managementSignal.newTakeProfit;
            }

            if (Object.keys(updates).length > 0 && this.handlersRef.current) {
                this.handlersRef.current.onUpdatePositionTargets(openPosition.id, updates);
            }

        // --- NO POSITION LOGIC ---
        } else if (status === BotStatus.Monitoring || status === BotStatus.Cooldown) {
            if (cooldownUntil && Date.now() < cooldownUntil) {
                if (status === BotStatus.Monitoring) this.bot.status = BotStatus.Cooldown;
                this.onUpdate();
                return; 
            }
            if (status === BotStatus.Cooldown) {
                this.addLog('Cooldown period finished. Resuming market monitoring.', LogType.Info);
                this.bot.status = BotStatus.Monitoring;
                this.bot.cooldownUntil = null;
                this.bot.lastResumeTimestamp = Date.now();
            }

            if (this.bot.status === BotStatus.Monitoring && this.handlersRef.current) {
                 const signal = await getTradingSignal(this.bot.config.agent, this.klines, this.bot.config.timeFrame, this.bot.config.agentParams);
                 this.bot.analysis = signal;

                 if(signal.signal !== 'HOLD') {
                    const reasonsText = signal.reasons.join('\n- ');
                    this.addLog(`Entry signal: ${signal.signal}.\nReasons:\n- ${reasonsText}`, LogType.Info);
                    this.bot.status = BotStatus.ExecutingTrade;
                    this.handlersRef.current.onExecuteTrade(signal, this.bot.id);
                 }
            }
        }

        this.onUpdate();
    }
    
    onPositionClosed(pnl: number) {
        if (this.bot.openPositionId === null) {
            return;
        }
        
        this.bot.openPositionId = null;
        this.bot.openPosition = null;
        this.bot.closedTradesCount = (this.bot.closedTradesCount || 0) + 1;
        this.bot.totalPnl = (this.bot.totalPnl || 0) + pnl;
        
        if (this.bot.lastResumeTimestamp) {
            this.bot.accumulatedActiveMs += Date.now() - this.bot.lastResumeTimestamp;
        }
        this.bot.lastResumeTimestamp = null;

        this.bot.status = BotStatus.Cooldown;
        const timeframeMs = getTimeframeMilliseconds(this.bot.config.timeFrame);
        const cooldownMs = BOT_COOLDOWN_CANDLES * timeframeMs;
        this.bot.cooldownUntil = Date.now() + cooldownMs;

        const cooldownMinutes = cooldownMs / 60000;
        this.addLog(`Position closed with PNL: ${pnl.toFixed(4)}. Bot in cooldown for ${BOT_COOLDOWN_CANDLES} candles (~${cooldownMinutes.toFixed(1)} mins).`, LogType.Success);
        this.onUpdate();
    }

    pause() {
        if ([BotStatus.Monitoring, BotStatus.ExecutingTrade, BotStatus.PositionOpen, BotStatus.Cooldown].includes(this.bot.status)) {
            this.stopTickInterval();
            
            if (this.bot.lastResumeTimestamp) {
                this.bot.accumulatedActiveMs += Date.now() - this.bot.lastResumeTimestamp;
            }
            this.bot.lastResumeTimestamp = null;
            
            this.bot.status = BotStatus.Paused;
            this.bot.cooldownUntil = null;
            this.addLog('Bot paused. All bot activity is halted.', LogType.Info);
            this.onUpdate();
        }
    }

    resume() {
        if (this.bot.status === BotStatus.Paused) {
            this.bot.lastResumeTimestamp = Date.now();
            this.bot.status = this.bot.openPosition ? BotStatus.PositionOpen : BotStatus.Monitoring;
            this.bot.analysis = null;
            
            this.startTickInterval();

            this.addLog('Bot resumed.', LogType.Info);
            this.onUpdate();
            this.tick();
        }
    }

    updateConfig(partialConfig: Partial<BotConfig>) {
        const oldConfig = { ...this.bot.config };
        this.bot.config = { ...this.bot.config, ...partialConfig };

        if (oldConfig.isStopLossLocked !== this.bot.config.isStopLossLocked) {
            this.addLog(`Stop Loss management set to: ${this.bot.config.isStopLossLocked ? 'Locked' : 'Unlocked'}.`, LogType.Action);
        }
        if (oldConfig.isTakeProfitLocked !== this.bot.config.isTakeProfitLocked) {
            this.addLog(`Take Profit management set to: ${this.bot.config.isTakeProfitLocked ? 'Locked' : 'Unlocked'}.`, LogType.Action);
        }
        this.onUpdate();
    }

    updateState(newState: Partial<RunningBot>) {
        const wasInPosition = !!this.bot.openPosition;
        this.bot = { ...this.bot, ...newState };
        const isNowInPosition = !!this.bot.openPosition;

        if (isNowInPosition && !wasInPosition) {
             this.addLog(`Position open. Proactive management checks will run every ${TICK_INTERVAL_MS/1000}s.`, LogType.Info);
             if (this.bot.openPosition) {
                 this.bot.livePrice = this.bot.openPosition.entryPrice;
             }
        }
        this.onUpdate();
    }

    stop() {
        this.stopTickInterval();
        this.bot.cooldownUntil = null;
        if (this.bot.lastResumeTimestamp) {
            this.bot.accumulatedActiveMs += Date.now() - this.bot.lastResumeTimestamp;
        }
        this.bot.lastResumeTimestamp = null;
        this.bot.status = BotStatus.Stopping;
        this.addLog('Bot stopping...', LogType.Info);
        this.bot.status = BotStatus.Stopped;
        this.addLog('Bot stopped manually.', LogType.Info);
        this.onUpdate();
    }
    
    private startTickInterval() {
        this.stopTickInterval();
        this.tickInterval = window.setInterval(() => {
            this.tick();
        }, TICK_INTERVAL_MS);
    }

    private stopTickInterval() {
        if (this.tickInterval) {
            window.clearInterval(this.tickInterval);
            this.tickInterval = null;
        }
    }
}


class BotManager {
    private bots: Map<string, BotInstance> = new Map();
    private onBotsUpdate: (bots: RunningBot[]) => void = () => {};
    private tickerSubscriptions: Map<string, { ws: WebSocket; subscribers: Set<string> }> = new Map();
    private klineSubscriptions: Map<string, { ws: WebSocket; subscribers: Set<string> }> = new Map();
    private klineDataCache: Map<string, Kline[]> = new Map();
    private klineUiCallbacks: Map<string, Set<(kline: Kline) => void>> = new Map();

    init(onBotsUpdate: (bots: RunningBot[]) => void) {
        this.onBotsUpdate = onBotsUpdate;
    }

    private notifyUpdate() {
        const botArray = Array.from(this.bots.values()).map(instance => instance.bot);
        this.onBotsUpdate(botArray);
    }

    private subscribeBotToTicker(instance: BotInstance) {
        const pairSymbol = instance.bot.config.pair.replace('/', '').toLowerCase();
        const existing = this.tickerSubscriptions.get(pairSymbol);

        if (existing) {
            existing.subscribers.add(instance.bot.id);
        } else {
            const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${pairSymbol}@ticker`);
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.c) {
                    const livePrice = parseFloat(data.c);
                    const tickerData: LiveTicker = { pair: data.s, closePrice: livePrice, highPrice: parseFloat(data.h), lowPrice: parseFloat(data.l), volume: parseFloat(data.v), quoteVolume: parseFloat(data.q) };
                    this.tickerSubscriptions.get(pairSymbol)?.subscribers.forEach(botId => {
                        this.bots.get(botId)?.updateLivePrice(livePrice, tickerData);
                    });
                }
            };
            this.tickerSubscriptions.set(pairSymbol, { ws, subscribers: new Set([instance.bot.id]) });
        }
    }

    private unsubscribeBotFromTicker(instance: BotInstance) {
        const pairSymbol = instance.bot.config.pair.replace('/', '').toLowerCase();
        const subscription = this.tickerSubscriptions.get(pairSymbol);
        if (subscription) {
            subscription.subscribers.delete(instance.bot.id);
            if (subscription.subscribers.size === 0) {
                subscription.ws.close();
                this.tickerSubscriptions.delete(pairSymbol);
            }
        }
    }
    
    private subscribeBotToKlines(instance: BotInstance) {
        const { pair, timeFrame } = instance.bot.config;
        const pairSymbol = pair.replace('/', '').toLowerCase();
        
        const subscribeTo = (tf: string, isManagement: boolean) => {
            const subKey = `${pairSymbol}_${tf}`;
            const existing = this.klineSubscriptions.get(subKey);

            if (existing) {
                existing.subscribers.add(instance.bot.id);
            } else {
                const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${pairSymbol}@kline_${tf}`);
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    const k = data.k;
                    const newKline: Kline = { time: k.t, open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c), volume: parseFloat(k.v), isFinal: k.x };

                    // Propagate to subscribed bots
                    this.klineSubscriptions.get(subKey)?.subscribers.forEach(botId => {
                        const bot = this.bots.get(botId);
                        if (bot) {
                            if (isManagement) bot.updateManagementKlines(newKline);
                            else bot.updateKlines(newKline);
                        }
                    });
                    
                    // Propagate to UI subscribers
                    this.klineUiCallbacks.get(subKey)?.forEach(cb => cb(newKline));
                };
                this.klineSubscriptions.set(subKey, { ws, subscribers: new Set([instance.bot.id]) });
            }
        };

        subscribeTo(timeFrame, false);
        subscribeTo(MANAGEMENT_TIMEFRAME, true);
    }
    
    private unsubscribeBotFromKlines(instance: BotInstance) {
        const { pair, timeFrame } = instance.bot.config;
        const pairSymbol = pair.replace('/', '').toLowerCase();
        
        const unsubscribeFrom = (tf: string) => {
            const subKey = `${pairSymbol}_${tf}`;
            const subscription = this.klineSubscriptions.get(subKey);
            if (subscription) {
                subscription.subscribers.delete(instance.bot.id);
                if (subscription.subscribers.size === 0) {
                    subscription.ws.close();
                    this.klineSubscriptions.delete(subKey);
                    this.klineDataCache.delete(subKey);
                }
            }
        };

        unsubscribeFrom(timeFrame);
        unsubscribeFrom(MANAGEMENT_TIMEFRAME);
    }

    public subscribeToKlineUpdates(pairSymbol: string, timeFrame: string, callback: (kline: Kline) => void) {
        const subKey = `${pairSymbol}_${timeFrame}`;
        if (!this.klineUiCallbacks.has(subKey)) {
            this.klineUiCallbacks.set(subKey, new Set());
        }
        this.klineUiCallbacks.get(subKey)!.add(callback);
    }

    public unsubscribeFromKlineUpdates(pairSymbol: string, timeFrame: string, callback: (kline: Kline) => void) {
        const subKey = `${pairSymbol}_${timeFrame}`;
        this.klineUiCallbacks.get(subKey)?.delete(callback);
    }

    public updateKlines(pairSymbol: string, timeFrame: string, klines: Kline[]) {
        const subKey = `${pairSymbol}_${timeFrame}`;
        this.klineDataCache.set(subKey, klines);
    }

    async startBot(config: BotConfig, handlersRef: React.RefObject<BotHandlers>) {
        const instance = new BotInstance(config, () => this.notifyUpdate(), handlersRef);
        this.bots.set(instance.bot.id, instance);
        
        try {
            const formattedPair = config.pair.replace('/', '');
            const mainKlineKey = `${formattedPair}_${config.timeFrame}`;
            const mgmtKlineKey = `${formattedPair}_${MANAGEMENT_TIMEFRAME}`;

            const initialKlines = this.klineDataCache.get(mainKlineKey) || await binanceService.fetchKlines(formattedPair, config.timeFrame);
            const initialMgmtKlines = this.klineDataCache.get(mgmtKlineKey) || await binanceService.fetchKlines(formattedPair, MANAGEMENT_TIMEFRAME, { limit: 200 });

            this.klineDataCache.set(mainKlineKey, initialKlines);
            this.klineDataCache.set(mgmtKlineKey, initialMgmtKlines);

            await instance.initialize(initialKlines, initialMgmtKlines);
            
            this.subscribeBotToTicker(instance);
            this.subscribeBotToKlines(instance);
            this.notifyUpdate();
        } catch (error) {
            instance.addLog(`Failed to start bot: ${error instanceof Error ? error.message : 'Unknown error'}`, LogType.Error);
            instance.updateState({ status: BotStatus.Error });
        }
    }
    
    stopBot(botId: string) {
        const instance = this.bots.get(botId);
        if (instance) {
            instance.stop();
            this.unsubscribeBotFromTicker(instance);
            this.unsubscribeBotFromKlines(instance);
        }
    }

    pauseBot(botId: string) { this.bots.get(botId)?.pause(); }
    resumeBot(botId: string) { this.bots.get(botId)?.resume(); }

    deleteBot(botId: string) {
        const instance = this.bots.get(botId);
        if (instance) {
            if (instance.bot.status !== BotStatus.Stopped) instance.stop();
            this.unsubscribeBotFromTicker(instance);
            this.unsubscribeBotFromKlines(instance);
            this.bots.delete(botId);
            this.notifyUpdate();
        }
    }

    stopAllBots() {
        this.bots.forEach(instance => this.stopBot(instance.bot.id));
    }
    
    getBot(botId: string): RunningBot | undefined { return this.bots.get(botId)?.bot; }
    updateBotConfig(botId: string, partialConfig: Partial<BotConfig>) { this.bots.get(botId)?.updateConfig(partialConfig); }
    updateBotState(botId: string, newState: Partial<RunningBot>) { this.bots.get(botId)?.updateState(newState); }
    updateBotOpenPosition(botId: string, newPosition: Position) { this.bots.get(botId)?.updateState({ openPosition: newPosition }); }
    addBotLog(botId: string, message: string, type: LogType = LogType.Info) { this.bots.get(botId)?.addLog(message, type); }
    notifyPositionClosed(botId: string, pnl: number) { this.bots.get(botId)?.onPositionClosed(pnl); }

    waitForBotLivePrice(botId: string, timeoutMs: number = 5000): Promise<number | null> {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const checkPrice = () => {
                const bot = this.getBot(botId);
                if (bot?.livePrice && bot.livePrice > 0) {
                    resolve(bot.livePrice);
                } else if (Date.now() - startTime > timeoutMs) {
                    console.error(`Timeout waiting for live price for bot ${botId}`);
                    resolve(null);
                } else {
                    setTimeout(checkPrice, 100);
                }
            };
            checkPrice();
        });
    }
}

export const botManagerService = new BotManager();
