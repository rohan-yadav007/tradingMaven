
// services/botManagerService.ts

import { RunningBot, BotConfig, BotStatus, TradeSignal, Kline, BotLogEntry, Position, LiveTicker, LogType, TradingMode, MarketDataContext, AgentParams, TradeManagementSignal } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getMultiStageProfitSecureSignal, getAgentExitSignal, getTradeGuardianSignal, getMandatoryBreakevenSignal, getProfitSpikeSignal, getAggressiveRangeTrailSignal, getTPProportionalLockSignal, captureMarketContext } from './localAgentService';
import { TIME_FRAMES } from '../constants';
import * as constants from '../constants';
import { getOmegaSignal, SovereignManagementEngine, logFailedOmegaSetup } from './agents/omega';
import { ApexManagementEngine } from './agents/apex';
import { spotWsManager, futuresWsManager } from './wsRegistry';
import { tapeReadingService } from './tapeReadingService';
import { calculateWinProbability } from './predictiveModel';

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
                lastResumeTimestamp: Date.now(),
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

        const isMatrixAgent = this.bot.config.agent.id === 25 || this.bot.config.agent.id === 26;
        // Omega/Apex Execution Trigger: 5m Candle Close
        const isExecutionTf = timeframe === '5m';

        if (isMatrixAgent && isExecutionTf && newKline.isFinal && this.bot.status === BotStatus.Monitoring && !this.bot.openPosition) {
            if (this.executing) return;
            this.executing = true;
            try {
                // IMPORTANT: Execute is TRUE on 5m close for Omega
                await this.runAnalysis({ execute: true, reason: `Matrix ${timeframe} Close Analysis` });
            } finally {
                this.executing = false;
            }
        }
    }

    public runAnalysis = async (options: { execute: boolean, reason: string, klinesOverride?: Kline[] }) => {
        const isMatrixAgent = this.bot.config.agent.id === 25 || this.bot.config.agent.id === 26 || this.bot.config.agent.id === 19;
        
        if (isMatrixAgent && !this.isMatrixReady()) {
            return;
        }

        const klinesToUse = options.klinesOverride || this.klines;
        const minLen = (this.bot.config.agent.id === 19 || this.bot.config.agent.id === 25 || this.bot.config.agent.id === 26) ? 1 : 50;
        if (klinesToUse.length < minLen) return;

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
            
            this.updateState({ 
                analysis: signal,
                omegaJitActive: signal.isOmegaSetupReady,
                omegaJitDirection: signal.omegaSetupDirection,
                omegaJitZone: signal.omegaSetupZone
            }, false);
            
            if (options.execute && signal.signal !== 'HOLD') {
                const now = binanceService.getSyncedNow();
                const COOLDOWN_MS = 5 * 60 * 1000;
                
                if (!this.bot.openPosition && (now - this.lastClosedTradeTimestamp < COOLDOWN_MS)) {
                    if (this.lastTradeWasLoss) return;
                    let isHighConviction = false;
                    if ((this.bot.config.agent.id === 25 || this.bot.config.agent.id === 26) && (signal.omegaAnalysis?.conviction ?? 0) >= 80) isHighConviction = true;
                    else if ((signal.astraXAnalysis?.conviction ?? 0) >= 80) isHighConviction = true;
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
            let posUpdated = false;
            let newPeak = pos.peakPrice, newTrough = pos.troughPrice;
            if (pos.direction === 'LONG') {
                if (price > pos.peakPrice) { newPeak = price; posUpdated = true; }
                if (price < pos.troughPrice) { newTrough = price; posUpdated = true; }
            } else {
                if (price < pos.peakPrice) { newPeak = price; posUpdated = true; }
                if (price > pos.troughPrice) { newTrough = price; posUpdated = true; }
            }
            if (posUpdated) updatePayload.openPosition = { ...pos, peakPrice: newPeak, troughPrice: newTrough };
        }
        this.updateState(updatePayload, false);

        if (this.bot.omegaJitActive && !this.bot.openPosition && this.bot.status === BotStatus.Monitoring) {
            const dir = this.bot.omegaJitDirection;
            const zone = this.bot.omegaJitZone;
            let triggerSpark = false;
            if (zone) {
                if (dir === 'LONG' && price >= zone.low && price <= zone.high * 1.002) triggerSpark = true;
                if (dir === 'SHORT' && price <= zone.high && price >= zone.low * 0.998) triggerSpark = true;
            }
            if (triggerSpark) {
                this.addLog(`V14 JIT Pulse: Momentum Spark triggered at ${price}`, LogType.Action);
                this.runAnalysis({ execute: true, reason: 'Omega JIT Tick' });
            }
        }

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
            
            // Capture forecast regardless of SL update
            if (sig.forecast) {
                updates.managementForecast = sig.forecast;
            }

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

        if (position.agentId === 26) {
             const apexSignal = ApexManagementEngine.manage(position, currentPrice, this.klines, this.astraXKlinesMap);
             if (apexSignal.action === 'close') {
                 this.handlers.onClosePosition(position, apexSignal.reasons[0] || 'Apex Management', currentPrice);
                 return;
             }
             applyUpdate(apexSignal);
             this.updateWinProbability(currentPrice);
             return;
        }
        if (position.agentId === 25) {
             const omegaSignal = SovereignManagementEngine.manage(position, currentPrice, this.klines, this.astraXKlinesMap);
             if (omegaSignal.action === 'close') {
                 this.handlers.onClosePosition(position, omegaSignal.reasons[0] || 'Omega Management', currentPrice);
                 return;
             }
             applyUpdate(omegaSignal);
             this.updateWinProbability(currentPrice);
             return;
        }

        const guardianSignal = getTradeGuardianSignal(position, this.klines, this.immediateKlines, currentPrice, this.btcKlines);
        if (guardianSignal.action === 'close') {
            this.handlers.onClosePosition(position, guardianSignal.reason || 'Trade Guardian Exit', currentPrice);
            return;
        }
        const spikeSignal = getProfitSpikeSignal(position, currentPrice);
        const managementSignal = getAgentExitSignal(position, this.klines, currentPrice, this.bot.config);

        // TP-bound positions: use TP-proportional locking (replaces R-tier + breakeven + aggressive trail)
        // No-TP positions: fall back to the R-tier ratchet system
        const profitSignal = position.takeProfitPrice
            ? getTPProportionalLockSignal(position, currentPrice)
            : (() => {
                const ag = getAggressiveRangeTrailSignal(position, currentPrice);
                if (ag.newStopLoss) return ag;
                const sec = getMultiStageProfitSecureSignal(position, currentPrice, this.klines);
                if (sec.newStopLoss) return sec;
                return getMandatoryBreakevenSignal(position, currentPrice);
            })();

        if (spikeSignal.newStopLoss) applyUpdate(spikeSignal);
        else if (profitSignal.newStopLoss) applyUpdate(profitSignal);
        else if (managementSignal.newStopLoss) applyUpdate(managementSignal);

        this.updateWinProbability(currentPrice);
    }

    private updateWinProbability = (currentPrice: number): boolean => {
        if (!this.bot.openPosition) return false;
        const history = this.bot.probabilityHistory ?? [];
        const result = calculateWinProbability(this.bot.openPosition, currentPrice, this.klines, history);
        const newHistory = [...history, result.probability].slice(-50);

        // Track consecutive low-probability ticks for early exit logic
        const prevLowTicks = this.bot.consecutiveLowProbabilityTicks ?? 0;
        const isLowProb = result.probability < 25;
        const consecutiveLowProbabilityTicks = isLowProb ? prevLowTicks + 1 : 0;

        this.updateState({
            winProbability: result.probability,
            winProbabilityFactors: result.factors,
            probabilityHistory: newHistory,
            consecutiveLowProbabilityTicks,
        }, false);

        // --- Proactive Early Exit: model signals deterioration ---
        // Trigger if: model says exit AND probability stayed low for 5+ consecutive ticks
        if (result.shouldEarlyExit && consecutiveLowProbabilityTicks >= 5) {
            const pos = this.bot.openPosition;
            const pnlR = (pos.direction === 'LONG'
                ? currentPrice - pos.entryPrice
                : pos.entryPrice - currentPrice) / pos.initialRiskInPrice;

            // Only exit if in drawdown territory (don't cut winners)
            if (pnlR < -0.15) {
                this.handlers.onClosePosition(pos, `Predictive Exit: ${result.earlyExitReason || 'Low win probability sustained.'}`, currentPrice);
                return true; // position closed
            }
        }
        return false;
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
            if ((this.bot.config.agent.id === 25 || this.bot.config.agent.id === 26) && pos.setupType) logFailedOmegaSetup(pos.pair, pos.initialStopLossPrice, pos.setupType, pos.direction);
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
        
        // Start Tape Reading if applicable
        if (config.agent.id === 25 || config.agent.id === 26) { // Omega/Apex use Tape
            tapeReadingService.subscribe(config.pair, config.mode);
            instance.subscriptionCleanups.push(() => tapeReadingService.unsubscribe(config.pair, config.mode));
        }
        
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
            if (instance.bot.config.agent.id === 25 || instance.bot.config.agent.id === 26 || instance.bot.config.agent.id === 19) {
                const tfs = ['1m', '5m', '15m', '1h', '4h', '1d'];
                instance.astraXKlinesMap.set(timeFrame, klines);
                const missingTfs = tfs.filter(tf => tf !== timeFrame);
                await Promise.all(missingTfs.map(async (tf) => {
                    const data = await binanceService.fetchKlines(formattedPair, tf, { limit: 200, mode });
                    instance.astraXKlinesMap.set(tf, data);
                }));
            }
            // Load BTC correlation klines for Omega (agent 25)
            if ((instance.bot.config.agent.id === 25 || instance.bot.config.agent.id === 26) && formattedPair !== 'BTCUSDT') {
                const btcMode = mode === TradingMode.USDSM_Futures ? TradingMode.USDSM_Futures : TradingMode.Spot;
                instance.btcKlines = await binanceService.fetchKlines('BTCUSDT', '1h', { limit: 200, mode: btcMode });
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
                const k: Kline = { time: data.k.t, open: parseFloat(data.k.o), high: parseFloat(data.k.h), low: parseFloat(data.k.l), close: parseFloat(data.k.c), volume: parseFloat(data.k.v), takerBuyVolume: parseFloat(data.k.V), isFinal: data.k.x };
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
            if (k.isFinal && instance.bot.config.agent.id !== 25 && instance.bot.config.agent.id !== 26) instance.runAnalysis({ execute: true, reason: 'Candle Close' });
        });
        if (instance.bot.config.agent.id === 25 || instance.bot.config.agent.id === 26 || instance.bot.config.agent.id === 19) {
            ['1m', '5m', '15m', '1h', '4h', '1d'].forEach(tf => {
                if (tf !== timeFrame) subscribeKline(tf, (k) => instance.onMatrixKlineUpdate(tf, k));
            });
        }
        // Subscribe to BTC 1h updates for Omega/Apex context
        if ((instance.bot.config.agent.id === 25 || instance.bot.config.agent.id === 26) && formattedPair !== 'BTCUSDT') {
            const wsManager = mode === TradingMode.USDSM_Futures ? futuresWsManager : spotWsManager;
            const btcStream = 'btcusdt@kline_1h';
            const btcHandler = (data: any) => {
                const k: Kline = { time: data.k.t, open: parseFloat(data.k.o), high: parseFloat(data.k.h), low: parseFloat(data.k.l), close: parseFloat(data.k.c), volume: parseFloat(data.k.v), takerBuyVolume: parseFloat(data.k.V), isFinal: data.k.x };
                if (!instance.btcKlines) instance.btcKlines = [];
                const last = instance.btcKlines[instance.btcKlines.length - 1];
                if (last && k.time === last.time) instance.btcKlines[instance.btcKlines.length - 1] = k;
                else { instance.btcKlines.push(k); if (instance.btcKlines.length > 250) instance.btcKlines.shift(); }
            };
            wsManager.subscribe(btcStream, btcHandler);
            instance.subscriptionCleanups.push(() => wsManager.unsubscribe(btcStream, btcHandler));
        }
        // Ensure the ticker WS stream is started for this pair so updateLivePrice fires for all bots.
        // The WS handler updates all matching bots directly; no external callback is needed here.
        if (!this.tickerSubscriptions.has(formattedPair.toLowerCase())) {
            const sentinelCallback = () => {};
            this.subscribeToTickerUpdates(formattedPair, mode, sentinelCallback);
            instance.subscriptionCleanups.push(() => this.unsubscribeFromTickerUpdates(formattedPair, mode, sentinelCallback));
        }
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
            const newStats = { closedTradesCount: instance.bot.closedTradesCount + 1, wins: instance.bot.wins + (pnl > 0 ? 1 : 0), losses: instance.bot.losses + (pnl <= 0 ? 1 : 0), totalPnl: instance.bot.totalPnl + pnl, openPosition: null, openPositionId: null, status: BotStatus.Monitoring, lastProfitableTradeDirection: pnl > 0 ? instance.bot.openPosition?.direction || null : null, omegaJitActive: false };
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

    /** Called when a universal model is deployed — immediately refreshes analysis for all idle Omega bots
     *  so the model score shows up in the AI Analysis panel without waiting for the next candle close. */
    public requestImmediateOmegaAnalysis() {
        this.bots.forEach(instance => {
            if (
                (instance.bot.config.agent.id === 25 || instance.bot.config.agent.id === 26) &&
                instance.bot.status === BotStatus.Monitoring &&
                !instance.bot.openPosition
            ) {
                // execute=false: just refresh the display, don't enter trades
                instance.runAnalysis({ execute: false, reason: 'Model Deployed — Refresh' });
            }
        });
    }
}

export const botManagerService = new BotManagerService();
