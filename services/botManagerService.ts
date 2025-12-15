
// services/botManagerService.ts

import { RunningBot, BotConfig, BotStatus, TradeSignal, Kline, BotLogEntry, Position, LiveTicker, LogType, TradingMode, MarketDataContext, AgentParams } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getMultiStageProfitSecureSignal, getAgentExitSignal, getInitialAgentTargets, validateTradeProfitability, getTradeGuardianSignal, getMandatoryBreakevenSignal, getProfitSpikeSignal, getAggressiveRangeTrailSignal, captureMarketContext, getAdaptiveTakeProfit } from './localAgentService';
import { TIME_FRAMES, getMicroTimeframe } from '../constants';
import { telegramBotService } from './telegramBotService';
import { WebSocketManager } from './webSocketManager';
import { sharedKlineService } from './sharedKlineService';
import * as constants from '../constants';
import { getConfluenceTimeframes, getAstraXRegimeAndDirection } from './agents/astrax';

const MAX_LOG_ENTRIES = 100;

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
    onClosePosition: (position: Position, exitReason: string, exitPrice?: number) => void;
}

class BotInstance {
    public bot: RunningBot;
    public klines: Kline[] = [];
    
    // --- Data Dependencies (Shared Pool References) ---
    public btcKlines: Kline[] | undefined;
    public htfKlines: Kline[] | undefined;
    public ltfKlines: Kline[] | undefined;
    public immediateKlines: Kline[] | undefined;
    public ethBtcKlines: Kline[] | undefined;
    public astraXKlinesMap: Map<string, Kline[]> = new Map();

    private onUpdate: (bot: RunningBot) => void;
    public handlers: BotHandlers;
    public subscriptions: { type: 'ticker' | 'kline', pair: string, timeFrame?: string, mode: TradingMode, callback: Function }[] = [];
    private executing = false;
    private isInitialized: boolean = false;

    constructor(config: BotConfig, onUpdate: (bot: RunningBot) => void, handlers: BotHandlers) {
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
        this.addLog('Initializing with historical data...', LogType.Info);
        this.klines = initialKlines;
        this.bot.klinesLoaded = this.klines.length;
        this.addLog(`Initialized with ${this.klines.length} ${this.bot.config.timeFrame} klines.`, LogType.Success);
        
        const entryMode = this.bot.config.entryTiming === 'immediate' ? 'Immediate (Tick-based)' : 'On Candle Close';
        this.addLog(`Entry Timing Mode: ${entryMode}`, LogType.Info);

        if ([20, 21].includes(this.bot.config.agent.id) && this.bot.config.entryTiming !== 'immediate') {
             this.addLog(`Flipper agent active. Awaiting first live trend change to enter.`, LogType.Info);
        }
    
        this.isInitialized = false; // Mark that we are in the startup phase
        
        // Perform initial analysis mainly for UI preview, execute only if Immediate
        const executeOnStart = this.bot.config.entryTiming === 'immediate';
        if (executeOnStart) {
             this.addLog("Performing initial analysis (Immediate Mode).", LogType.Info);
        }
        
        await this.runAnalysis({ execute: executeOnStart, reason: 'Initial Analysis' });
        
        this.isInitialized = true; // Mark startup phase as complete

        if (this.bot.status === BotStatus.Starting) {
            this.updateState({ 
                status: BotStatus.Monitoring, 
                lastResumeTimestamp: binanceService.getSyncedNow(),
            });
        }
        
        this.onUpdate(this.bot); // Ensure final state is rendered
    }    

    public updateState = (partialState: Partial<RunningBot>) => {
        this.bot = { ...this.bot, ...partialState };
        this.onUpdate(this.bot);
    }

    addLog = (message: string, type: LogType = LogType.Info) => {
        const newLogEntry: BotLogEntry = { timestamp: new Date(binanceService.getSyncedNow()), message, type };
        const newLog = [newLogEntry, ...this.bot.log].slice(0, MAX_LOG_ENTRIES);
        this.updateState({ log: newLog });
    }
    
    public runAnalysis = async (options: { execute: boolean, reason: string, klinesOverride?: Kline[] }) => {
        const klinesToUse = options.klinesOverride || this.klines;
        if (klinesToUse.length < 50 && this.bot.config.agent.id !== 19) return;

        try {
            let klinesForAnalysis = klinesToUse;

            // Preview logic should only run for immediate mode, when no override is given
            // This constructs a "virtual" candle using the current live price to allow mid-candle signals
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
            
            this.updateState({ analysis: signal });
            
            const isFlipper = [20, 21].includes(this.bot.config.agent.id);

            // Gatekeeper for flipper agents on startup with 'onNextCandle' mode.
            if (
                isFlipper &&
                this.bot.config.entryTiming === 'onNextCandle' &&
                !this.isInitialized && // Crucially, check if this is the startup analysis
                signal.signal !== 'HOLD'
            ) {
                this.addLog(`Ignoring startup signal (${signal.signal}) to await first live flip.`, LogType.Info);
                return; // Do not proceed to execution logic
            }

            if (options.execute && signal.signal !== 'HOLD') {
                if (this.bot.openPosition) {
                    // Position is open, only flipper agent can take action here
                    if (isFlipper) {
                        const currentPosition = this.bot.openPosition!;
                        const isOpposite = (signal.signal === 'BUY' && currentPosition.direction === 'SHORT') || (signal.signal === 'SELL' && currentPosition.direction === 'LONG');
                        if (isOpposite) {
                            this.addLog(`Flip Signal: ${signal.signal}. Closing current ${currentPosition.direction}.`, LogType.Action);
                            this.updateState({ status: BotStatus.FlipPending });
                            this.handlers.onClosePosition(currentPosition, `Flip to ${signal.signal}`);
                        }
                    }
                } else { // No position is open
                    if (this.bot.status === BotStatus.Monitoring || this.bot.status === BotStatus.Starting) {
                        this.updateState({ status: BotStatus.ExecutingTrade });
                        await this.executeTrade(signal, klinesForAnalysis);
                    }
                }
            } else if (signal.signal === 'HOLD' && !this.bot.openPosition && this.bot.config.entryTiming === 'onNextCandle') {
                // Verbose logging for "On Candle Close" mode so the user knows it ran.
                this.addLog(`Candle Closed. Analysis Result: HOLD`, LogType.Info);
            }

        } catch (error) {
            this.addLog(`Error during analysis: ${error}`, LogType.Error);
            this.updateState({ analysis: { signal: 'HOLD', reasons: [`Analysis Error: ${error}`] } });
        }
    }
    
    public updateLivePrice = async (price: number, tickerData: LiveTicker) => {
        const expectedPair = this.bot.config.pair.replace('/', '').toLowerCase();
        if (tickerData.pair.toLowerCase() !== expectedPair) return;
    
        this.updateState({ livePrice: price, liveTicker: tickerData, lastPriceUpdateTimestamp: binanceService.getSyncedNow() });
    
        if (this.bot.openPosition) {
            await this.managePositionOnTick(price);
            this.checkPriceBoundaries(price);
        } else if (this.bot.status === BotStatus.Monitoring) {
            const { config } = this.bot;
            
            // STRICT ENFORCEMENT: Only run tick-based entry analysis if 'Immediate Entry' is selected.
            // This ensures we respect the user's wish to wait for candle close.
            if (config.entryTiming === 'immediate') {
                const now = binanceService.getSyncedNow();
                const lastAnalysis = this.bot.lastAnalysisTimestamp || 0;
                if (now - lastAnalysis >= 1000) { // Throttle to prevent overwhelming on rapid ticks
                    if (this.executing) {
                        return; // Don't even update timestamp if busy, let it retry later
                    }
                    this.updateState({ lastAnalysisTimestamp: now });
                    this.executing = true;
                    try {
                        await this.runAnalysis({ execute: true, reason: "Immediate Entry Check (On Tick)" });
                    } finally {
                        this.executing = false;
                    }
                }
            }
        }
    }

    public onMainKlineUpdate = async (newKline: Kline) => {
        const lastKline = this.klines.length > 0 ? this.klines[this.klines.length - 1] : null;
    
        let isNewCandle = false;
        let closedCandle: Kline | null = null;
    
        if (lastKline && newKline.time === lastKline.time) {
            this.klines[this.klines.length - 1] = newKline;
        } else if (!lastKline || newKline.time > lastKline.time) {
            closedCandle = lastKline; // The one that just finished
            this.klines.push(newKline);
            isNewCandle = true;
            if (this.klines.length > 501) this.klines.shift();
        }
        this.updateState({ klinesLoaded: this.klines.length });
    
        // This block handles "Wait for Candle Close" logic.
        if (isNewCandle && closedCandle && this.bot.config.entryTiming === 'onNextCandle' && this.bot.status === BotStatus.Monitoring && !this.bot.openPosition) {
            if (this.executing) {
                this.addLog('Analysis for new candle skipped, previous execution still in process.', LogType.Info);
                return;
            }
            this.executing = true;
            try {
                // We analyze based on the candle that JUST closed.
                const klinesForAnalysis = this.klines.slice(0, -1);
                
                this.addLog(`Candle Closed (${new Date(closedCandle.time).toLocaleTimeString()}). Running Analysis...`, LogType.Info);
                
                await this.runAnalysis({
                    execute: true,
                    reason: `Closed Candle Analysis`,
                    klinesOverride: klinesForAnalysis
                });
            } finally {
                this.executing = false;
            }
        }
    
        if (newKline.isFinal && this.bot.openPosition) {
            const openPosition = this.bot.openPosition;
            const candlesSinceEntry = (openPosition.candlesSinceEntry || 0) + 1;
            this.updateState({
                openPosition: { ...openPosition, candlesSinceEntry }
            });

             if (openPosition.tradeType === 'scalp' && this.bot.config.agent.id === 19) {
                // AstraX Promotion Logic
                const { config } = this.bot;
                const analyticalTimeframes = getConfluenceTimeframes(config.timeFrame);
                // Use stored references for promotion check as well
                const klinesMap = new Map<string, Kline[]>();
                
                const { regime, direction: convictionDirection } = getAstraXRegimeAndDirection(config, this.astraXKlinesMap, analyticalTimeframes);
                const isLong = openPosition.direction === 'LONG';
                const convictionMatches = (isLong && convictionDirection === 'bullish') || (!isLong && convictionDirection === 'bearish');

                if (regime !== 'Choppy Market' && convictionMatches) {
                    this.addLog(`PROMOTION TRIGGERED: Market shifted to ${regime}. Upgrading scalp to conviction trade.`, LogType.Success);
                    const { stopLossPrice, takeProfitPrice } = getInitialAgentTargets(this.klines, openPosition.entryPrice, openPosition.direction, config, 'conviction');
                    const newState: Partial<Position> = {
                        tradeType: 'conviction', promotedFrom: 'scalp', takeProfitPrice, stopLossPrice,
                        profitLockTier: 0, aggressiveTrailTier: 0,
                    };
                    this.updateState({ openPosition: { ...openPosition, ...newState } });
                    this.addLog(`New Targets -> SL: ${stopLossPrice.toFixed(config.pricePrecision)}, TP: ${takeProfitPrice.toFixed(config.pricePrecision)}`, LogType.Action);
                }
            }

            if (this.bot.config.isConfirmationCandleEnabled && candlesSinceEntry === 1) {
                const entryCandle = this.klines.length > 2 ? this.klines[this.klines.length - 3] : null;
                const confirmationCandle = this.klines.length > 1 ? this.klines[this.klines.length - 2] : null;
                if (entryCandle && confirmationCandle) {
                    const isLong = openPosition.direction === 'LONG';
                    const isContradictory = isLong ? confirmationCandle.close < entryCandle.low : confirmationCandle.close > entryCandle.high;
                    if (isContradictory) {
                        this.addLog('Confirmation candle failed. Closing position.', LogType.Action);
                        this.handlers.onClosePosition(openPosition, 'Confirmation Failed', confirmationCandle.close);
                        return;
                    }
                }
            }

            if (this.bot.openPosition) {
                await this.runAnalysis({ execute: true, reason: "Position Management (New Candle)" });
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
    
    public notifyTradeExecutionFailed = (reason: string) => {
        this.addLog(`Trade execution failed: ${reason}`, LogType.Error);
        this.updateState({ status: BotStatus.Monitoring });
    }

    private async executeTrade(signal: TradeSignal, klinesForExecution: Kline[]) {
        const currentPrice = await this.getInitialPriceReliably();
        if (!currentPrice) {
            this.notifyTradeExecutionFailed("Could not determine a valid entry price.");
            return;
        }
        
        const isLong = signal.signal === 'BUY';
        const { config } = this.bot;
        const { stopLossPrice, takeProfitPrice, slReason, agentStopLoss } = getInitialAgentTargets(klinesForExecution, currentPrice, isLong ? 'LONG' : 'SHORT', config, signal.tradeType, signal.stopLossPrice);
        
        const validation = validateTradeProfitability(currentPrice, agentStopLoss, takeProfitPrice, isLong ? 'LONG' : 'SHORT', config);
        if (!validation.isValid && config.agent.id !== 20) { // Bypass validation for flipper agent
            this.notifyTradeExecutionFailed(validation.reason);
            return;
        }

        this.addLog(`Executing ${signal.signal} (${signal.tradeType || 'default'}) at ~${currentPrice.toFixed(config.pricePrecision)}. SL: ${stopLossPrice.toFixed(config.pricePrecision)} (${slReason}), TP: ${takeProfitPrice.toFixed(config.pricePrecision)}`, LogType.Action);
        if (config.agent.id !== 20) {
            this.addLog(validation.reason, LogType.Success);
        }

        const execSignal: TradeSignal = { ...signal, entryPrice: currentPrice, takeProfitPrice, stopLossPrice };
        const entryContext = captureMarketContext(klinesForExecution, undefined, config.agentParams);
        
        await this.handlers.onExecuteTrade(execSignal, this.bot.id, { agentStopLoss, slReason, entryContext });
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

        // For Supertrend Flipper agents, exits are ONLY handled by flip signals from runAnalysis.
        // Bypass all tick-based trailing logic (Trade Guardian, profit trails, etc.).
        if ([20, 21].includes(this.bot.config.agent.id)) {
            return;
        }
    
        const guardianConfig = this.bot.openPosition.botConfigSnapshot;
        if (guardianConfig?.isTradeGuardianEnabled) {
            try {
                // Use stored reference if available, otherwise fallback (should be available if initialized)
                if (this.immediateKlines) {
                    // FIX: Pass BTC Klines to Guardian for tide check
                    const guardianSignal = getTradeGuardianSignal(
                        this.bot.openPosition, 
                        this.klines, 
                        this.immediateKlines, 
                        currentPrice, 
                        this.btcKlines // Pass BTC Data
                    );
                    if (guardianSignal.action === 'close') {
                        this.addLog(guardianSignal.reason!, LogType.Action);
                        if(this.bot.livePrice) {
                            this.handlers.onClosePosition(this.bot.openPosition, guardianSignal.reason!, this.bot.livePrice);
                        }
                        return;
                    }
                }
            } catch (e) {
                 this.addLog(`Error in Trade Guardian: ${e instanceof Error ? e.message : String(e)}`, LogType.Error);
            }
        }
    
        let positionState: Position = { ...this.bot.openPosition };
        const isLong = positionState.direction === 'LONG';
        let changes: Partial<Position> = {};
    
        const peak = positionState.peakPrice ?? positionState.entryPrice;
        if ((isLong && currentPrice > peak) || (!isLong && currentPrice < peak)) {
            changes.peakPrice = currentPrice;
        }
        const trough = positionState.troughPrice ?? positionState.entryPrice;
        if ((isLong && currentPrice < trough) || (!isLong && currentPrice > trough)) {
            changes.troughPrice = currentPrice;
        }

        if (!positionState.hasBeenProfitable) {
            const feeRate = positionState.takerFeeRate || constants.TAKER_FEE_RATE;
            const breakevenPriceLong = positionState.entryPrice * (1 + feeRate) / (1 - feeRate);
            const breakevenPriceShort = positionState.entryPrice * (1 - feeRate) / (1 + feeRate);
            const isNetProfitable = isLong 
                ? currentPrice > breakevenPriceLong 
                : currentPrice < breakevenPriceShort;
            if (isNetProfitable) {
                changes.hasBeenProfitable = true;
            }
        }

        positionState = { ...positionState, ...changes };
        let hasChanges = Object.keys(changes).length > 0;
    
        const adaptiveTpSignal = getAdaptiveTakeProfit(positionState, this.klines, currentPrice);
        let adaptiveTpTakeProfitApplied = false;

        if (adaptiveTpSignal.newTakeProfit) {
            const newTp = adaptiveTpSignal.newTakeProfit;
            const takeProfitPrice = positionState.takeProfitPrice;
            const isTighter = isLong ? newTp < takeProfitPrice : newTp > takeProfitPrice;
            const isExtension = isLong ? newTp > takeProfitPrice : newTp < takeProfitPrice;

            if (isTighter || isExtension) {
                positionState.takeProfitPrice = newTp;
                if (adaptiveTpSignal.newState) positionState = { ...positionState, ...adaptiveTpSignal.newState };
                hasChanges = true;
                adaptiveTpTakeProfitApplied = true;
            }
        }
    
        const stopCandidates: { price: number; reason: Position['activeStopLossReason']; newState?: Partial<Position> }[] = [];
    
        if (adaptiveTpSignal.newStopLoss && adaptiveTpSignal.activeStopLossReason) {
            stopCandidates.push({
                price: adaptiveTpSignal.newStopLoss,
                reason: adaptiveTpSignal.activeStopLossReason,
                newState: adaptiveTpSignal.newState
            });
        }
    
        if (this.bot.config.isAgentTrailEnabled) {
            const stableKlines = [...this.klines];
            const lastKline = stableKlines.length > 0 ? stableKlines[stableKlines.length - 1] : null;
            
            if (lastKline && !lastKline.isFinal) {
                stableKlines.pop();
            }

            const agentTrailSignal = getAgentExitSignal(positionState, stableKlines, currentPrice, this.bot.config);
            if (agentTrailSignal.newStopLoss !== undefined) {
                 stopCandidates.push({
                    price: agentTrailSignal.newStopLoss,
                    reason: agentTrailSignal.activeStopLossReason || 'Agent Trail',
                    newState: agentTrailSignal.newState
                });
            }
        }
        
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
    
        let bestCandidate: { price: number; reason: Position['activeStopLossReason']; newState?: Partial<Position> } = { 
            price: positionState.stopLossPrice, 
            reason: positionState.activeStopLossReason, 
        };
        
        for (const candidate of stopCandidates) {
            const isValid = isLong ? candidate.price < currentPrice : candidate.price > currentPrice;
            const isTighter = isLong ? candidate.price > bestCandidate.price : candidate.price < bestCandidate.price;
            
            if (isValid && isTighter) {
                bestCandidate = candidate;
            }
        }
    
        if (bestCandidate.price !== positionState.stopLossPrice) {
            let logMessage = `SL moved to ${bestCandidate.price.toFixed(this.bot.config.pricePrecision)} by ${bestCandidate.reason}.`;
            if (adaptiveTpSignal.newStopLoss && bestCandidate.price === adaptiveTpSignal.newStopLoss && adaptiveTpSignal.reason) {
                logMessage = adaptiveTpSignal.reason;
            }
            this.addLog(logMessage, LogType.Action);

            positionState.stopLossPrice = bestCandidate.price;
            positionState.activeStopLossReason = bestCandidate.reason;
            if (bestCandidate.newState) positionState = { ...positionState, ...bestCandidate.newState };
            hasChanges = true;
        } else if (adaptiveTpTakeProfitApplied && !adaptiveTpSignal.newStopLoss) {
             this.addLog(`${adaptiveTpSignal.reason} New TP: ${positionState.takeProfitPrice.toFixed(this.bot.config.pricePrecision)}`, LogType.Info);
        }
    
        if (hasChanges) {
            this.updateState({ openPosition: positionState });
        }
    }
}

class BotManagerService {
    private bots: Map<string, BotInstance> = new Map();
    private onBotListChange: (() => void) | null = null;
    private handlers: BotHandlers | null = null;
    private tickerSubscriptions: Map<string, Function[]> = new Map();
    private wsManagerSpot: WebSocketManager;
    private wsManagerFutures: WebSocketManager;
    private botUpdateSubscribers: Map<string, ((bot: RunningBot) => void)[]> = new Map();

    constructor() {
        this.wsManagerSpot = new WebSocketManager(() => '/proxy-spot-ws');
        this.wsManagerFutures = new WebSocketManager(() => '/proxy-futures-ws');
    }

    public setHandlers(handlers: BotHandlers) {
        this.handlers = handlers;
    }

    public setOnBotListChange(callback: (() => void) | null) {
        this.onBotListChange = callback;
    }

    private notifyBotListChange() {
        if (this.onBotListChange) this.onBotListChange();
    }

    private notifyBotUpdate(bot: RunningBot) {
        const subscribers = this.botUpdateSubscribers.get(bot.id);
        if (subscribers) {
            subscribers.forEach(cb => cb(bot));
        }
    }

    public startBot = (config: BotConfig): RunningBot => {
        if (!this.handlers) {
            throw new Error("Bot handlers not set. Cannot start bot.");
        }

        const onUpdate = (updatedBot: RunningBot) => {
            this.notifyBotUpdate(updatedBot);
            this.notifyBotListChange(); 
        };

        const botInstance = new BotInstance(config, onUpdate, this.handlers);
        this.bots.set(botInstance.bot.id, botInstance);
        
        this.initializeBot(botInstance);
        
        this.notifyBotListChange();
        return botInstance.bot;
    }

    private async acquireBtcData(timeframe: string, primaryMode: TradingMode): Promise<Kline[]> {
        try {
            // Try Futures first (High volume/liquidity)
            return await sharedKlineService.getData('BTC/USDT', timeframe, TradingMode.USDSM_Futures);
        } catch (error) {
            console.warn('BTC Futures data unavailable, attempting fallback to Spot.', error);
            try {
                // Fallback to Spot
                return await sharedKlineService.getData('BTC/USDT', timeframe, TradingMode.Spot);
            } catch (fallbackError) {
                console.error('BTC Data completely unavailable.', fallbackError);
                throw new Error('BTC Data Unavailable');
            }
        }
    }

    private async initializeBot(botInstance: BotInstance) {
        const { config } = botInstance.bot;
        
        try {
            // 1. Initial Data Fetch (Primary Pair)
            const klines = await sharedKlineService.getData(config.pair, config.timeFrame, config.mode);
            
            // 2. Subscribe to klines (Primary Pair)
            this.subscribeToKlines(botInstance);

            // 3. Subscribe to Ticker for live price updates
            const tickerCallback = (data: any) => {
                 const price = parseFloat(data.c);
                 const ticker: LiveTicker = {
                    pair: data.s,
                    closePrice: price,
                    highPrice: parseFloat(data.h),
                    lowPrice: parseFloat(data.l),
                    volume: parseFloat(data.v),
                    quoteVolume: parseFloat(data.q)
                };
                botInstance.updateLivePrice(price, ticker);
            };
            this.subscribeToTickerUpdates(config.pair, config.mode, tickerCallback);
            botInstance.subscriptions.push({ type: 'ticker', pair: config.pair, mode: config.mode, callback: tickerCallback });
            
            // 4. Acquire Dependencies (Shared Pool)
            // BTC Data (for AstraX or BTC Confirmation)
            if (config.isBtcConfirmationEnabled || config.agent.id === 19) {
                try {
                    botInstance.btcKlines = await this.acquireBtcData(config.timeFrame, config.mode);
                } catch (e) {
                    botInstance.addLog(`Warning: BTC Data acquisition failed: ${e}`, LogType.Error);
                }
            }

            // HTF Data
            if (config.isHtfConfirmationEnabled) {
                const htf = config.htfTimeFrame === 'auto' 
                    ? TIME_FRAMES[TIME_FRAMES.indexOf(config.timeFrame) + 1] 
                    : config.htfTimeFrame;
                if (htf) {
                    try {
                        botInstance.htfKlines = await sharedKlineService.getData(config.pair, htf, config.mode);
                    } catch(e) {
                        botInstance.addLog(`Warning: HTF data failed: ${e}`, LogType.Error);
                    }
                }
            }

            // LTF / Immediate Data
            if (config.isMomentumConcordanceEnabled || config.agent.id === 19) {
                const ltfTimeframe = getMicroTimeframe(config.timeFrame);
                try {
                    botInstance.ltfKlines = await sharedKlineService.getData(config.pair, ltfTimeframe, config.mode);
                    if (ltfTimeframe !== '1m') {
                        botInstance.immediateKlines = await sharedKlineService.getData(config.pair, '1m', config.mode);
                    } else {
                        botInstance.immediateKlines = botInstance.ltfKlines;
                    }
                } catch(e) {
                    botInstance.addLog(`Warning: LTF data failed: ${e}`, LogType.Error);
                }
            }
            
            // ETH/BTC Correlation
            if (config.isBtcCorrelationVetoEnabled) {
                try {
                    botInstance.ethBtcKlines = await sharedKlineService.getData('ETH/BTC', config.timeFrame, TradingMode.Spot);
                } catch(e) {
                    botInstance.addLog(`Warning: ETH/BTC data failed: ${e}`, LogType.Error);
                }
            }

            // AstraX Confluence Maps
            if (config.agent.id === 19) {
                const astraxTfs = getConfluenceTimeframes(config.timeFrame);
                await Promise.all(astraxTfs.map(async (tf) => {
                    try {
                        const data = await sharedKlineService.getData(config.pair, tf, config.mode);
                        botInstance.astraXKlinesMap.set(tf, data);
                    } catch(e) {
                        botInstance.addLog(`Warning: AstraX TF ${tf} data failed: ${e}`, LogType.Error);
                    }
                }));
            }

            // 5. Start the Bot Logic
            await botInstance.initialize(klines);

        } catch (e) {
            botInstance.addLog(`Initialization failed: ${e}`, LogType.Error);
            botInstance.updateState({ status: BotStatus.Error });
        }
    }

    private subscribeToKlines(botInstance: BotInstance) {
        const { config } = botInstance.bot;
        const pair = config.pair.replace('/', '').toLowerCase();
        const streamName = `${pair}@kline_${config.timeFrame}`;
        const wsManager = config.mode === TradingMode.USDSM_Futures ? this.wsManagerFutures : this.wsManagerSpot;

        const callback = (data: any) => {
            const kline: Kline = {
                time: data.k.t, open: parseFloat(data.k.o), high: parseFloat(data.k.h),
                low: parseFloat(data.k.l), close: parseFloat(data.k.c), volume: parseFloat(data.k.v),
                isFinal: data.k.x
            };
            botInstance.onMainKlineUpdate(kline);
        };

        wsManager.subscribe(streamName, callback);
        botInstance.subscriptions.push({ type: 'kline', pair: config.pair, timeFrame: config.timeFrame, mode: config.mode, callback });
    }

    public stopBot = (botId: string) => {
        const botInstance = this.bots.get(botId);
        if (botInstance) {
            botInstance.updateState({ status: BotStatus.Stopped });
            this.cleanupBotSubscriptions(botInstance);
            botInstance.addLog("Bot stopped by user.", LogType.Info);
        }
    }

    public pauseBot = (botId: string) => {
        const botInstance = this.bots.get(botId);
        if (botInstance) {
            botInstance.updateState({ status: BotStatus.Paused });
            botInstance.addLog("Bot paused by user.", LogType.Info);
        }
    }

    public resumeBot = (botId: string) => {
        const botInstance = this.bots.get(botId);
        if (botInstance) {
            botInstance.updateState({ status: BotStatus.Monitoring, lastResumeTimestamp: Date.now() });
            botInstance.addLog("Bot resumed by user.", LogType.Info);
        }
    }

    public deleteBot = (botId: string) => {
        const botInstance = this.bots.get(botId);
        if (botInstance) {
            this.cleanupBotSubscriptions(botInstance);
            this.bots.delete(botId);
            this.notifyBotListChange();
        }
    }

    private cleanupBotSubscriptions(botInstance: BotInstance) {
        // 1. WS Unsubscriptions
        botInstance.subscriptions.forEach(sub => {
            const wsManager = sub.mode === TradingMode.USDSM_Futures ? this.wsManagerFutures : this.wsManagerSpot;
            const pair = sub.pair.replace('/', '').toLowerCase();
            
            if (sub.type === 'kline') {
                const streamName = `${pair}@kline_${sub.timeFrame}`;
                wsManager.unsubscribe(streamName, sub.callback);
            } else if (sub.type === 'ticker') {
                this.unsubscribeFromTickerUpdates(sub.pair, sub.mode, sub.callback);
            }
        });
        
        const { config } = botInstance.bot;
        
        // 2. Release Data Dependencies
        sharedKlineService.releaseData(config.pair, config.timeFrame, config.mode);
        
        if (botInstance.htfKlines) {
            const htf = config.htfTimeFrame === 'auto' 
                ? TIME_FRAMES[TIME_FRAMES.indexOf(config.timeFrame) + 1] 
                : config.htfTimeFrame;
            if(htf) sharedKlineService.releaseData(config.pair, htf, config.mode);
        }

        if (botInstance.btcKlines) {
             // We don't track which mode BTC was acquired with (spot vs futures) in instance yet, assume config mode for now or check data.
             // For simplicity, release both potential sources since releaseData is safe if key doesn't exist/count is 0.
             sharedKlineService.releaseData('BTC/USDT', config.timeFrame, TradingMode.USDSM_Futures);
             sharedKlineService.releaseData('BTC/USDT', config.timeFrame, TradingMode.Spot);
        }

        if (botInstance.ltfKlines) {
             const ltf = getMicroTimeframe(config.timeFrame);
             sharedKlineService.releaseData(config.pair, ltf, config.mode);
        }
        
        if (botInstance.immediateKlines) {
             sharedKlineService.releaseData(config.pair, '1m', config.mode);
        }

        if (botInstance.ethBtcKlines) {
             sharedKlineService.releaseData('ETH/BTC', config.timeFrame, TradingMode.Spot);
        }

        botInstance.astraXKlinesMap.forEach((_, tf) => {
            sharedKlineService.releaseData(config.pair, tf, config.mode);
        });
        
        // Clear references
        botInstance.btcKlines = undefined;
        botInstance.htfKlines = undefined;
        botInstance.ltfKlines = undefined;
        botInstance.immediateKlines = undefined;
        botInstance.ethBtcKlines = undefined;
        botInstance.astraXKlinesMap.clear();
    }

    public getRunningBots(): RunningBot[] {
        return Array.from(this.bots.values()).map(b => b.bot);
    }

    public getBot(botId: string): BotInstance | undefined {
        return this.bots.get(botId);
    }

    public updateBotConfig = (botId: string, partialConfig: Partial<BotConfig>) => {
        const botInstance = this.bots.get(botId);
        if (botInstance) {
            botInstance.updateState({ config: { ...botInstance.bot.config, ...partialConfig } });
            botInstance.addLog(`Configuration updated: ${Object.keys(partialConfig).join(', ')}`, LogType.Info);
        }
    }

    public refreshBotAnalysis = (botId: string) => {
        const botInstance = this.bots.get(botId);
        if (botInstance) {
            botInstance.runAnalysis({ execute: false, reason: "Manual Refresh" });
        }
    }

    public stopAllBots() {
        this.bots.forEach(bot => this.stopBot(bot.bot.id));
        this.wsManagerSpot.disconnect();
        this.wsManagerFutures.disconnect();
    }

    public subscribeToTickerUpdates(pair: string, mode: TradingMode, callback: Function) {
        const wsManager = mode === TradingMode.USDSM_Futures ? this.wsManagerFutures : this.wsManagerSpot;
        const symbol = pair.replace('/', '').toLowerCase();
        const streamName = `${symbol}@ticker`;

        let callbacks = this.tickerSubscriptions.get(streamName);
        if (!callbacks) {
            callbacks = [];
            this.tickerSubscriptions.set(streamName, callbacks);
            
            // Centralized subscription to WS
            wsManager.subscribe(streamName, (data: any) => {
                const cbs = this.tickerSubscriptions.get(streamName);
                if (cbs) cbs.forEach(cb => cb(data));
            });
        }
        callbacks.push(callback);
    }

    public unsubscribeFromTickerUpdates(pair: string, mode: TradingMode, callback: Function) {
        const symbol = pair.replace('/', '').toLowerCase();
        const streamName = `${symbol}@ticker`;
        const callbacks = this.tickerSubscriptions.get(streamName);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index > -1) callbacks.splice(index, 1);
            if (callbacks.length === 0) {
                this.tickerSubscriptions.delete(streamName);
            }
        }
    }
    
    // --- New Public Methods for UI Charting ---
    
    public subscribeToKlineUpdates(pair: string, timeFrame: string, mode: TradingMode, callback: Function) {
        const wsManager = mode === TradingMode.USDSM_Futures ? this.wsManagerFutures : this.wsManagerSpot;
        const symbol = pair.replace('/', '').toLowerCase();
        const streamName = `${symbol}@kline_${timeFrame}`;
        
        // Subscribe the callback to the WebSocket manager
        wsManager.subscribe(streamName, (data: any) => {
            callback(data);
        });
    }

    public unsubscribeFromKlineUpdates(pair: string, timeFrame: string, mode: TradingMode, callback: Function) {
        const wsManager = mode === TradingMode.USDSM_Futures ? this.wsManagerFutures : this.wsManagerSpot;
        const symbol = pair.replace('/', '').toLowerCase();
        const streamName = `${symbol}@kline_${timeFrame}`;
        
        // Unsubscribe the callback
        wsManager.unsubscribe(streamName, (data: any) => {
            callback(data);
        });
    }
    
    public subscribeToBotUpdates(botId: string, callback: (bot: RunningBot) => void) {
        let subs = this.botUpdateSubscribers.get(botId);
        if (!subs) {
            subs = [];
            this.botUpdateSubscribers.set(botId, subs);
        }
        subs.push(callback);
    }

    public unsubscribeFromBotUpdates(botId: string, callback: (bot: RunningBot) => void) {
        const subs = this.botUpdateSubscribers.get(botId);
        if (subs) {
            const index = subs.indexOf(callback);
            if (index > -1) subs.splice(index, 1);
        }
    }

    public addBotLog(botId: string, message: string, type: LogType) {
        const bot = this.bots.get(botId);
        if (bot) bot.addLog(message, type);
    }

    public updateBotState(botId: string, state: Partial<RunningBot>) {
        const bot = this.bots.get(botId);
        if (bot) bot.updateState(state);
    }

    public notifyPositionClosed(botId: string, netPnl: number) {
        const botInstance = this.bots.get(botId);
        if (botInstance) {
            const newTotalPnl = botInstance.bot.totalPnl + netPnl;
            const isWin = netPnl > 0;
            botInstance.updateState({
                status: BotStatus.Monitoring,
                openPosition: null,
                openPositionId: null,
                totalPnl: newTotalPnl,
                wins: botInstance.bot.wins + (isWin ? 1 : 0),
                losses: botInstance.bot.losses + (isWin ? 0 : 1),
                closedTradesCount: botInstance.bot.closedTradesCount + 1,
                totalGrossProfit: botInstance.bot.totalGrossProfit + (isWin ? netPnl : 0),
                totalGrossLoss: botInstance.bot.totalGrossLoss + (isWin ? 0 : Math.abs(netPnl)),
                lastProfitableTradeDirection: isWin ? botInstance.bot.openPosition?.direction || null : botInstance.bot.lastProfitableTradeDirection
            });
            botInstance.addLog(`Position closed. PNL: ${netPnl.toFixed(2)}`, isWin ? LogType.Success : LogType.Info);
        }
    }

    public notifyTradeExecutionFailed(botId: string, reason: string) {
        const botInstance = this.bots.get(botId);
        if (botInstance) {
            botInstance.notifyTradeExecutionFailed(reason);
        }
    }
}

export const botManagerService = new BotManagerService();
telegramBotService.register(botManagerService);
