

import { RunningBot, BotConfig, BotStatus, TradeSignal, Kline, BotLogEntry, Position, LiveTicker, LogType, RiskMode, TradingMode, BinanceOrderResponse } from '../types';
import * as binanceService from './binanceService';
import { getTradingSignal, getTradeManagementSignal, getInitialAgentTargets } from './localAgentService';
import { BOT_COOLDOWN_CANDLES, DEFAULT_AGENT_PARAMS, MAX_STOP_LOSS_PERCENT_OF_INVESTMENT } from '../constants';

const MAX_LOG_ENTRIES = 100;
const RECONNECT_DELAY = 5000; // 5 seconds
const MANAGEMENT_INTERVAL_MS = 10000; // 10 seconds

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
}

class BotInstance {
    public bot: RunningBot;
    public klines: Kline[] = []; // Main timeframe klines
    private managementKlines: Kline[] = []; // 1-minute klines for open positions
    private onUpdate: () => void;
    private handlersRef: React.RefObject<BotHandlers>;
    private isTicking = false;
    private analysisTimer: number | null = null;
    private managementTimer: number | null = null;
    private isManagingScalperPosition = false;
    private lastTimerLogTimestamp: number | null = null;
    
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
            cooldownUntil: null,
            accumulatedActiveMs: 0,
            lastResumeTimestamp: null,
            klinesLoaded: 0,
            lastAnalysisTimestamp: null,
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
        this.analysisTimer = window.setInterval(() => this.timedTickCheck(), 5000); // Start watchdog timer
        this.tick(); // Perform initial analysis
        this.onUpdate();
    }
    
    addLog(message: string, type: LogType = LogType.Info) {
        const newLog: BotLogEntry = { timestamp: new Date(), message, type };
        this.bot.log = [newLog, ...this.bot.log].slice(0, MAX_LOG_ENTRIES);
        this.onUpdate();
    }

    private async proactiveManageScalperPosition(livePrice: number) {
        if (this.isManagingScalperPosition) return;
    
        if (!this.bot.openPosition || !this.handlersRef.current || this.bot.status !== BotStatus.PositionOpen) {
            return;
        }
    
        const { isStopLossLocked } = this.bot.config;
    
        if (isStopLossLocked) {
            return;
        }
        
        this.isManagingScalperPosition = true;
        try {
            const managementSignal = await getTradeManagementSignal(this.bot.openPosition, [], livePrice, this.bot.config);
    
            if (this.bot.openPosition && managementSignal.newStopLoss) {
                const isLong = this.bot.openPosition.direction === 'LONG';
                const isImprovement = (isLong && managementSignal.newStopLoss > this.bot.openPosition.stopLossPrice) ||
                                      (!isLong && managementSignal.newStopLoss < this.bot.openPosition.stopLossPrice);
    
                if (isImprovement) {
                    this.bot.openPosition.stopLossPrice = managementSignal.newStopLoss;
                    this.addLog(`Continuous Trail: SL updated to ${managementSignal.newStopLoss.toFixed(this.bot.openPosition.pricePrecision)}. Reason: ${managementSignal.reasons[0] || ''}`, LogType.Action);
                    this.onUpdate();
                }
            }
        } catch (error) {
             console.error(`Error during scalper position management for bot ${this.bot.id}:`, error);
        } finally {
            this.isManagingScalperPosition = false;
        }
    }
    
    public updateLivePrice(price: number, tickerData: LiveTicker) {
        this.bot.livePrice = price;
        this.bot.liveTicker = tickerData;

        // --- REAL-TIME SCALPER TRAILING STOP (Continuous, no-delay check) ---
        if (this.bot.openPosition && this.bot.status === BotStatus.PositionOpen && (this.bot.config.agent.name === 'Scalping Expert' || this.bot.config.agent.name === 'Profit Locker')) {
            this.proactiveManageScalperPosition(price);
        }

        // --- REAL-TIME EXIT CHECK ---
        // This is the primary exit mechanism for live trades.
        if (this.bot.openPosition && this.bot.status === BotStatus.PositionOpen && this.handlersRef.current?.onClosePosition) {
            const { direction, takeProfitPrice, stopLossPrice } = this.bot.openPosition;
            const isLong = direction === 'LONG';
            let exitPrice: number | null = null;
            let exitReason: string | null = null;

            // Check for Take Profit
            if ((isLong && price >= takeProfitPrice) || (!isLong && price <= takeProfitPrice)) {
                exitPrice = takeProfitPrice;
                exitReason = 'Take Profit Hit (Live)';
            } 
            // Check for Stop Loss
            else if ((isLong && price <= stopLossPrice) || (!isLong && price >= stopLossPrice)) {
                exitPrice = stopLossPrice;
                exitReason = 'Stop Loss Hit (Live)';
            }
            
            if (exitPrice !== null && exitReason !== null) {
                this.addLog(`${exitReason} triggered by live price. Closing position at target ${exitPrice}.`, LogType.Action);
                this.bot.status = BotStatus.ExecutingTrade;
                // Use the target price for closing, not the live price which could have slipped.
                this.handlersRef.current.onClosePosition(this.bot.openPosition, exitReason, exitPrice);
                // Return early as the position is now being closed. The final state update will be handled
                // by the onClosePosition -> notifyPositionClosed flow.
                return; 
            }
        }

        this.onUpdate();
    }

    public onMainKlineUpdate(newKline: Kline) {
        // Update the internal kline history
        const lastKline = this.klines[this.klines.length - 1];
        if (lastKline && newKline.time === lastKline.time) {
            this.klines[this.klines.length - 1] = newKline;
        } else {
            this.klines.push(newKline);
            if(this.klines.length > 2000) this.klines.shift(); // Prevent memory leak
        }
        this.bot.klinesLoaded = this.klines.length;

        // If the candle is final, it's the trigger for a new ENTRY analysis.
        if (newKline.isFinal) {
            this.addLog(`New ${this.bot.config.timeFrame} candle closed. Processing...`, LogType.Status);
            this.tick();
        }
    }
    
    public onManagementKlineUpdate(newKline: Kline) {
        if (!this.bot.openPosition || this.bot.status !== BotStatus.PositionOpen) return;

        // Update 1m kline history, which is used by the proactive management timer
        const lastKline = this.managementKlines[this.managementKlines.length - 1];
         if (lastKline && newKline.time === lastKline.time) {
            this.managementKlines[this.managementKlines.length - 1] = newKline;
        } else {
            this.managementKlines.push(newKline);
            if(this.managementKlines.length > 2000) this.managementKlines.shift();
        }
    }

    private startManagementTimer() {
        this.stopManagementTimer(); // Ensure no duplicates
        this.addLog(`Proactive position management activated (checking every ${MANAGEMENT_INTERVAL_MS / 1000}s).`, LogType.Status);
        this.managementTimer = window.setInterval(() => this.proactiveManagePosition(), MANAGEMENT_INTERVAL_MS);
    }

    private stopManagementTimer() {
        if (this.managementTimer) {
            clearInterval(this.managementTimer);
            this.managementTimer = null;
            this.addLog('Proactive position management deactivated.', LogType.Status);
        }
    }
    
    private async proactiveManagePosition() {
        // --- Position Reconciliation Check (Top Priority) ---
        // This check prevents the bot from getting stuck if the position is closed on the exchange (e.g., by manual action or failsafe SL).
        if (this.bot.openPosition && this.bot.config.executionMode === 'live') {
            try {
                if (this.bot.config.mode === TradingMode.USDSM_Futures) {
                    const pairSymbol = this.bot.config.pair.replace('/', '');
                    const positionRisk = await binanceService.getFuturesPositionRisk(pairSymbol);

                    // If we have position info from the exchange AND the amount is effectively zero
                    if (positionRisk && Math.abs(parseFloat(positionRisk.positionAmt)) < this.bot.config.stepSize) {
                         this.addLog("CRITICAL: Position desync detected! Position is closed on Binance but open in the app. Re-syncing state now.", LogType.Error);
                         // Use the existing close handler to properly manage state transition
                         // Use live price as the best guess for the unknown external exit price.
                         this.handlersRef.current?.onClosePosition(this.bot.openPosition, 'Position Closed Externally (Re-sync)', this.bot.livePrice || this.bot.openPosition.stopLossPrice);
                         return; // Stop further management as position is being closed.
                    }
                }
                // TODO: Add similar reconciliation logic for Spot (checking asset balance) if needed.
            } catch (e) {
                console.error(`Error during position reconciliation check for bot ${this.bot.id}:`, e);
                this.addLog('Warning: Could not verify live position status on exchange.', LogType.Error);
            }
        }

        if (!this.bot.openPosition || !this.handlersRef.current || this.bot.status !== BotStatus.PositionOpen || !this.bot.livePrice) {
            return;
        }

        const { livePrice, config } = this.bot;
        const { isStopLossLocked, isTakeProfitLocked } = config;

        if (isStopLossLocked && isTakeProfitLocked) {
            return; // Nothing to do if both targets are locked
        }

        const klinesForManagement = this.managementKlines.length > 0 ? this.managementKlines : this.klines;
        if (klinesForManagement.length === 0) return;

        const managementSignal = await getTradeManagementSignal(this.bot.openPosition, klinesForManagement, livePrice, this.bot.config);
        const newPositionTargets = { ...this.bot.openPosition };
        const isLong = newPositionTargets.direction === 'LONG';
        let updated = false;

        if (!isStopLossLocked && managementSignal.newStopLoss) {
            const isImprovement = (isLong && managementSignal.newStopLoss > newPositionTargets.stopLossPrice) || 
                                  (!isLong && managementSignal.newStopLoss < newPositionTargets.stopLossPrice);
            if (isImprovement) {
                newPositionTargets.stopLossPrice = managementSignal.newStopLoss;
                updated = true;
                this.addLog(`Agent updated trailing Stop Loss to ${managementSignal.newStopLoss.toFixed(newPositionTargets.pricePrecision)}.`, LogType.Action);
            }
        }

        if (!isTakeProfitLocked && managementSignal.newTakeProfit) {
             const isImprovement = (isLong && managementSignal.newTakeProfit > newPositionTargets.takeProfitPrice) ||
                                  (!isLong && managementSignal.newTakeProfit < newPositionTargets.takeProfitPrice);
            if (isImprovement) {
                newPositionTargets.takeProfitPrice = managementSignal.newTakeProfit;
                updated = true;
                this.addLog(`Agent updated Take Profit to ${managementSignal.newTakeProfit.toFixed(newPositionTargets.pricePrecision)}.`, LogType.Action);
            }
        }

        if (updated) {
            this.bot.openPosition = newPositionTargets;
            this.onUpdate();
        }
    }

    private timedTickCheck() {
        if (this.isTicking) {
            return;
        }
    
        const isEligibleForCheck = this.bot.status === BotStatus.Monitoring || this.bot.status === BotStatus.Cooldown;
        if (!isEligibleForCheck) {
            return;
        }
    
        // Always run tick if in cooldown to check if it's over
        if (this.bot.status === BotStatus.Cooldown) {
            this.tick();
            return;
        }
    
        // For monitoring, check if a candle has been missed from the websocket stream.
        if (this.klines.length > 0) {
            const lastKline = this.klines[this.klines.length - 1];
            const timeframeMs = getTimeframeMilliseconds(this.bot.config.timeFrame);
            const expectedCloseTime = lastKline.time + timeframeMs;
    
            if (Date.now() > expectedCloseTime + 2000) {
                // Avoid log spam by only logging this once per minute if the bot remains stuck.
                const now = Date.now();
                if (!this.lastTimerLogTimestamp || now - this.lastTimerLogTimestamp > 60000) {
                     this.addLog(`Watchdog: Forcing a check due to a possibly missed candle event.`, LogType.Info);
                     this.lastTimerLogTimestamp = now;
                }
                this.tick();
            }
        }
    }
    
    private waitForBotLivePrice(timeoutMs: number = 5000): Promise<number | null> {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const checkPrice = () => {
                if (this.bot.livePrice && this.bot.livePrice > 0) {
                    resolve(this.bot.livePrice);
                } else if (Date.now() - startTime > timeoutMs) {
                    console.error(`Timeout waiting for live price for bot ${this.bot.id}`);
                    resolve(null);
                } else {
                    setTimeout(checkPrice, 100);
                }
            };
            checkPrice();
        });
    }

    private async runMonitoringLogic() {
        if (this.bot.openPosition) return;
    
        const lastCandle = this.klines.length > 0 ? this.klines[this.klines.length - 1] : null;
    
        if (!lastCandle || (this.bot.lastAnalysisTimestamp === lastCandle.time)) {
            return;
        }
    
        if (this.handlersRef.current) {
            this.bot.lastAnalysisTimestamp = lastCandle.time;
            const signal = await getTradingSignal(this.bot.config.agent, this.klines, this.bot.config.timeFrame, this.bot.config.agentParams);
            this.bot.analysis = signal;
    
            if (signal.signal !== 'HOLD') {
                this.bot.status = BotStatus.ExecutingTrade;
                this.onUpdate();
                await this.executeTrade(signal);
            } else {
                const primaryReason = signal.reasons[signal.reasons.length - 1] || "Conditions not met for a trade.";
                this.addLog(`Analysis: HOLD. ${primaryReason}`, LogType.Info);
            }
        }
    }
    
    private async tick() {
        if (this.isTicking) return;
    
        // 1. Handle state transitions first.
        if (this.bot.status === BotStatus.Cooldown && Date.now() >= (this.bot.cooldownUntil || 0)) {
            this.addLog('Cooldown period finished. Resuming market monitoring.', LogType.Status);
            this.updateState({
                status: BotStatus.Monitoring,
                cooldownUntil: null,
                analysis: null,
            });
    
            // FIX: Instead of processing in the same execution cycle, schedule a new tick shortly.
            // This prevents a potential race condition where the bot tries to trade with state
            // (e.g., live price from websocket) that hasn't been updated since resuming.
            setTimeout(() => this.tick(), 1000); // Re-process in 1 second.
            return; // Exit this tick cycle to allow state to settle.
        }
    
        // 2. Perform action based on the *current, stable* state.
        this.isTicking = true;
        try {
            switch (this.bot.status) {
                case BotStatus.Monitoring:
                    await this.runMonitoringLogic();
                    break;
                case BotStatus.Cooldown:
                    // This will only run if the cooldown is still active.
                    const remainingTime = (this.bot.cooldownUntil || 0) - Date.now();
                    this.bot.analysis = { signal: 'HOLD', reasons: [`In cooldown for ~${Math.round(remainingTime / 1000)}s.`] };
                    break;
                // No other states are handled by the tick.
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred during tick processing.";
            this.addLog(`Error during analysis/execution: ${errorMessage}`, LogType.Error);
            this.updateState({ status: BotStatus.Error, analysis: { signal: 'HOLD', reasons: [errorMessage] } });
        } finally {
            this.isTicking = false;
            this.onUpdate(); // Always update UI at the end of a processing tick.
        }
    }

    public async forceRefreshAndAnalyze() {
        this.addLog('Connection re-established. Forcing data refresh and re-analysis...', LogType.Info);
        try {
            const { pair, timeFrame } = this.bot.config;
            const formattedPair = pair.replace('/', '');
            
            const latestKlines = await binanceService.fetchKlines(formattedPair, timeFrame);
            this.klines = latestKlines;
            this.bot.klinesLoaded = latestKlines.length;

            this.bot.lastAnalysisTimestamp = null;
            
            this.addLog(`Data re-synced with ${latestKlines.length} candles. Triggering analysis.`, LogType.Success);
            
            this.tick();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error during data refresh.";
            this.addLog(`Failed to refresh data after reconnect: ${errorMessage}`, LogType.Error);
        }
    }
    
    private async executeTrade(signal: TradeSignal) {
        const { config } = this.bot;
        const { onExecuteTrade } = this.handlersRef.current!;

        const initialEntryPrice = await this.waitForBotLivePrice(5000);
        if (initialEntryPrice === null) {
            throw new Error("Could not get live price for trade execution.");
        }
        
        const isLong = signal.signal === 'BUY';
        const positionValue = config.mode === TradingMode.USDSM_Futures 
            ? config.investmentAmount * config.leverage 
            : config.investmentAmount;
        const tradeSize = positionValue / initialEntryPrice;

        // --- LAYER 1: USER-DEFINED SL ---
        let userStopLossPrice: number;
        if (config.stopLossMode === RiskMode.Percent) {
            const lossAmount = config.investmentAmount * (config.stopLossValue / 100);
            userStopLossPrice = isLong ? initialEntryPrice - (lossAmount / tradeSize) : initialEntryPrice + (lossAmount / tradeSize);
        } else { // Amount
            userStopLossPrice = isLong ? initialEntryPrice - (config.stopLossValue / tradeSize) : initialEntryPrice + (config.stopLossValue / tradeSize);
        }

        // --- LAYER 2: AGENT'S SMART (ATR) SL ---
        const agentTargets = getInitialAgentTargets(this.klines, initialEntryPrice, isLong ? 'LONG' : 'SHORT', config.timeFrame, { ...DEFAULT_AGENT_PARAMS, ...config.agentParams });
        const agentStopLossPrice = agentTargets.stopLossPrice;

        // --- LAYER 3: HARD CAP SAFETY NET SL ---
        const maxLossAmount = config.investmentAmount * (MAX_STOP_LOSS_PERCENT_OF_INVESTMENT / 100);
        const hardCapStopLossPrice = isLong ? initialEntryPrice - (maxLossAmount / tradeSize) : initialEntryPrice + (maxLossAmount / tradeSize);

        this.addLog(`Risk Analysis: User SL: ${userStopLossPrice.toFixed(config.pricePrecision)}, Agent SL: ${agentStopLossPrice.toFixed(config.pricePrecision)}, Hard Cap: ${hardCapStopLossPrice.toFixed(config.pricePrecision)}`, LogType.Info);
        
        // Determine primary SL based on whether it's locked
        let primaryStopLoss = config.isStopLossLocked ? userStopLossPrice : agentStopLossPrice;
        let finalStopLossPrice: number;

        // The final SL is the TIGHTEST (safest) of the primary SL and the hard cap
        if (isLong) {
            finalStopLossPrice = Math.max(primaryStopLoss, hardCapStopLossPrice);
        } else { // SHORT
            finalStopLossPrice = Math.min(primaryStopLoss, hardCapStopLossPrice);
        }

        if (finalStopLossPrice !== primaryStopLoss) {
            this.addLog(`SAFETY OVERRIDE: Hard cap of ${MAX_STOP_LOSS_PERCENT_OF_INVESTMENT}% is tighter than configured SL. Enforcing safer stop.`, LogType.Action);
        }
        this.addLog(`Final Stop Loss set to: ${finalStopLossPrice.toFixed(config.pricePrecision)}`, LogType.Success);

        // --- TAKE PROFIT CALCULATION ---
        let takeProfitPrice: number;
        // If TP is unlocked, use the Agent's R:R based target
        if (!config.isTakeProfitLocked) {
            // Correctly maintain the R:R based on the *final* SL
            const riskDistance = Math.abs(initialEntryPrice - finalStopLossPrice);
            const agentRiskDistance = Math.abs(initialEntryPrice - agentTargets.stopLossPrice);
            const agentProfitDistance = Math.abs(agentTargets.takeProfitPrice - initialEntryPrice);
            const riskRewardRatio = agentRiskDistance > 0 ? agentProfitDistance / agentRiskDistance : 1.5;
            const profitDistance = riskDistance * riskRewardRatio;
            
            takeProfitPrice = isLong ? initialEntryPrice + profitDistance : initialEntryPrice - profitDistance;
            this.addLog(`Using SMART (ATR-based) Take Profit target: ${takeProfitPrice.toFixed(config.pricePrecision)}`, LogType.Info);
        } else { // TP is locked, use user's setting
            if (config.takeProfitMode === RiskMode.Percent) {
                const profitAmount = config.investmentAmount * (config.takeProfitValue / 100);
                takeProfitPrice = isLong ? initialEntryPrice + (profitAmount / tradeSize) : initialEntryPrice - (profitAmount / tradeSize);
            } else { // Amount
                takeProfitPrice = isLong ? initialEntryPrice + (config.takeProfitValue / tradeSize) : initialEntryPrice - (config.takeProfitValue / tradeSize);
            }
            this.addLog(`Using LOCKED Take Profit target: ${takeProfitPrice.toFixed(config.pricePrecision)}`, LogType.Info);
        }
        
        const execSignal: TradeSignal = {
            ...signal,
            entryPrice: initialEntryPrice,
            stopLossPrice: finalStopLossPrice,
            takeProfitPrice
        };

        await onExecuteTrade(execSignal, this.bot.id);
    }
    
    onExecutionFailed(reason: string) {
        this.addLog(`Trade execution failed: ${reason}. Entering 1-minute cooldown.`, LogType.Error);
        
        const cooldownMs = 60 * 1000; // 1 minute as requested.
        const cooldownUntil = Date.now() + cooldownMs;

        this.updateState({
            status: BotStatus.Cooldown,
            cooldownUntil: cooldownUntil,
            analysis: { signal: 'HOLD', reasons: [`Execution failed. Cooling down.`] }
        });
    }

    onPositionClosed(pnl: number) {
        if (this.bot.openPositionId === null) {
            return;
        }
        this.stopManagementTimer();

        const closeTime = Date.now();
        this.bot.openPositionId = null;
        this.bot.openPosition = null;
        this.managementKlines = []; // Clear 1m klines
        this.bot.lastAnalysisTimestamp = null; // <<< FIX: Reset analysis state to prevent getting stuck.
        this.bot.closedTradesCount = (this.bot.closedTradesCount || 0) + 1;
        this.bot.totalPnl = (this.bot.totalPnl || 0) + pnl;

        if (this.bot.config.isCooldownEnabled) {
            this.bot.status = BotStatus.Cooldown;
            const timeframeMs = getTimeframeMilliseconds(this.bot.config.timeFrame);
            const cooldownMs = BOT_COOLDOWN_CANDLES * timeframeMs;
            this.bot.cooldownUntil = closeTime + cooldownMs;
            const cooldownMinutes = cooldownMs / 60000;
            this.addLog(`Position closed with PNL: ${pnl.toFixed(2)}. Bot in cooldown for ${BOT_COOLDOWN_CANDLES} candles (~${cooldownMinutes.toFixed(1)} mins).`, LogType.Success);
        } else {
            // If cooldown is disabled, apply a short, fixed delay to prevent immediate re-entry.
            this.bot.status = BotStatus.Cooldown;
            const delayMs = 2000; // 2 seconds
            this.bot.cooldownUntil = closeTime + delayMs;
            this.addLog(`Position closed with PNL: ${pnl.toFixed(2)}. Cooldown disabled, applying a ${delayMs / 1000}s delay.`, LogType.Success);
        }
        this.onUpdate();
    }

    pause() {
        if ([BotStatus.Monitoring, BotStatus.PositionOpen, BotStatus.Cooldown].includes(this.bot.status)) {
            if (this.bot.lastResumeTimestamp) {
                this.bot.accumulatedActiveMs += Date.now() - this.bot.lastResumeTimestamp;
            }
            this.stopManagementTimer();
            if (this.analysisTimer) {
                clearInterval(this.analysisTimer);
                this.analysisTimer = null;
            }
            this.bot.lastResumeTimestamp = null;
            this.bot.status = BotStatus.Paused;
            this.addLog('Bot paused. All analysis is halted.', LogType.Info);
            this.onUpdate();
        }
    }

    resume() {
        if (this.bot.status !== BotStatus.Paused) return;
    
        this.bot.lastResumeTimestamp = Date.now();
        let newStatus: BotStatus;
    
        if (this.bot.openPosition) {
            newStatus = BotStatus.PositionOpen;
            this.startManagementTimer();
        } else if (this.bot.cooldownUntil && Date.now() < this.bot.cooldownUntil) {
            newStatus = BotStatus.Cooldown;
        } else {
            this.bot.cooldownUntil = null;
            newStatus = BotStatus.Monitoring;
        }
    
        this.bot.status = newStatus;
        this.bot.analysis = null;
        this.analysisTimer = window.setInterval(() => this.timedTickCheck(), 5000);
        this.addLog('Bot resumed.', LogType.Info);
        this.onUpdate();
        this.tick();
    }
    
    async updateTradeParams(partialConfig: Partial<BotConfig>) {
        if (!this.handlersRef.current) return;
    
        // 1. Update the bot's configuration state immediately
        this.bot.config = { ...this.bot.config, ...partialConfig };
    
        // Log the change for audit
        Object.keys(partialConfig).forEach(keyStr => {
            const key = keyStr as keyof BotConfig;
            this.addLog(`Config updated: ${key} = ${JSON.stringify(this.bot.config[key])}`, LogType.Action);
        });
    
        // 2. If no position is open, there's nothing more to do.
        if (!this.bot.openPosition || !this.bot.livePrice) {
            this.onUpdate();
            return;
        }
    
        const { config: newConfig } = this.bot;
        const position = this.bot.openPosition;
        const livePrice = this.bot.livePrice;
        let targetsUpdated = false;
    
        // A helper to calculate the initial, non-trailed targets based on a config
        const getInitialTargets = () => {
            const isLong = position.direction === 'LONG';
            const { investmentAmount, stopLossMode, stopLossValue, takeProfitMode, takeProfitValue } = newConfig;
    
            let slPrice: number;
            if (stopLossMode === RiskMode.Percent) {
                const lossAmount = investmentAmount * (stopLossValue / 100);
                const priceChange = lossAmount / position.size;
                slPrice = isLong ? position.entryPrice - priceChange : position.entryPrice + priceChange;
            } else { // Amount
                const priceChange = stopLossValue / position.size;
                slPrice = isLong ? position.entryPrice - priceChange : position.entryPrice + priceChange;
            }
    
            let tpPrice: number;
            if (takeProfitMode === RiskMode.Percent) {
                const profitAmount = investmentAmount * (takeProfitValue / 100);
                const priceChange = profitAmount / position.size;
                tpPrice = isLong ? position.entryPrice + priceChange : position.entryPrice - priceChange;
            } else { // Amount
                const priceChange = takeProfitValue / position.size;
                tpPrice = isLong ? position.entryPrice + priceChange : position.entryPrice - priceChange;
            }
            return { stopLossPrice: slPrice, takeProfitPrice: tpPrice };
        };
    
        // 3. React to the new configuration state
    
        // --- STOP LOSS ---
        if (newConfig.isStopLossLocked) {
            // If it's locked, the price is determined SOLELY by the manual config.
            const { stopLossPrice: newStaticSl } = getInitialTargets();
            if (position.stopLossPrice !== newStaticSl) {
                position.stopLossPrice = newStaticSl;
                targetsUpdated = true;
                this.addLog(`Stop Loss manually set to ${newStaticSl.toFixed(position.pricePrecision)}`, LogType.Action);
            }
        } else {
            // If it's unlocked, it should be managed by the agent.
            this.addLog("Stop Loss is unlocked. Checking for agent recommendation...", LogType.Action);
            const managementSignal = await getTradeManagementSignal(position, this.managementKlines, livePrice, newConfig);
            const agentSl = managementSignal.newStopLoss;
    
            if (agentSl && position.stopLossPrice !== agentSl) {
                position.stopLossPrice = agentSl;
                targetsUpdated = true;
                this.addLog(`Agent updated trailing Stop Loss to ${agentSl.toFixed(position.pricePrecision)}`, LogType.Action);
            } else if (!agentSl) {
                // Agent didn't give a new SL. Reset it away from the old manual value.
                const { stopLossPrice: initialSl } = getInitialTargets();
                if (position.stopLossPrice !== initialSl) {
                    position.stopLossPrice = initialSl;
                    targetsUpdated = true;
                    this.addLog(`Stop Loss reset to initial calculated level ${initialSl.toFixed(position.pricePrecision)}`, LogType.Action);
                }
            }
        }
    
        // --- TAKE PROFIT ---
        if (newConfig.isTakeProfitLocked) {
            const { takeProfitPrice: newStaticTp } = getInitialTargets();
            if (position.takeProfitPrice !== newStaticTp) {
                position.takeProfitPrice = newStaticTp;
                targetsUpdated = true;
                this.addLog(`Take Profit manually set to ${newStaticTp.toFixed(position.pricePrecision)}`, LogType.Action);
            }
        } else {
            this.addLog("Take Profit is unlocked. Checking for agent recommendation...", LogType.Action);
            const managementSignal = await getTradeManagementSignal(position, this.managementKlines, livePrice, newConfig);
            const agentTp = managementSignal.newTakeProfit;
    
            if (agentTp && position.takeProfitPrice !== agentTp) {
                position.takeProfitPrice = agentTp;
                targetsUpdated = true;
                this.addLog(`Agent updated Take Profit to ${agentTp.toFixed(position.pricePrecision)}`, LogType.Action);
            } else if (!agentTp) {
                const { takeProfitPrice: initialTp } = getInitialTargets();
                if (position.takeProfitPrice !== initialTp) {
                    position.takeProfitPrice = initialTp;
                    targetsUpdated = true;
                    this.addLog(`Take Profit reset to initial calculated level ${initialTp.toFixed(position.pricePrecision)}`, LogType.Action);
                }
            }
        }
    
        // 4. Final state updates and checks
        if (targetsUpdated) {
            this.addLog(`Targets updated. Active SL: ${position.stopLossPrice.toFixed(position.pricePrecision)}, Active TP: ${position.takeProfitPrice.toFixed(position.pricePrecision)}.`, LogType.Info);
        }
    
        // Check for immediate exit conditions based on the new locked targets
        const isLong = position.direction === 'LONG';
        if (newConfig.isStopLossLocked) {
            if ((isLong && livePrice <= position.stopLossPrice) || (!isLong && livePrice >= position.stopLossPrice)) {
                this.addLog(`Immediate Manual SL triggered. Price: ${livePrice.toFixed(position.pricePrecision)}, Target: ${position.stopLossPrice.toFixed(position.pricePrecision)}.`, LogType.Action);
                this.handlersRef.current.onClosePosition(position, 'Immediate Manual SL', livePrice);
                return; // Exit, position is closing
            }
        }
        if (newConfig.isTakeProfitLocked) {
            if ((isLong && livePrice >= position.takeProfitPrice) || (!isLong && livePrice <= position.takeProfitPrice)) {
                this.addLog(`Immediate Manual TP triggered. Price: ${livePrice.toFixed(position.pricePrecision)}, Target: ${position.takeProfitPrice.toFixed(position.pricePrecision)}.`, LogType.Action);
                this.handlersRef.current.onClosePosition(position, 'Immediate Manual TP', livePrice);
                return; // Exit, position is closing
            }
        }
    
        this.onUpdate();
    }
    
    updateState(newState: Partial<RunningBot>) {
        const wasInPosition = !!this.bot.openPosition;
        this.bot = { ...this.bot, ...newState };
        const isNowInPosition = !!this.bot.openPosition;

        if (isNowInPosition && !wasInPosition) {
             if (this.bot.openPosition) {
                 this.bot.livePrice = this.bot.openPosition.entryPrice;
             }
             this.startManagementTimer();
        }
        this.onUpdate();
    }

    stop() {
        if (this.analysisTimer) clearInterval(this.analysisTimer);
        this.stopManagementTimer();
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
}


class BotManager {
    private bots: Map<string, BotInstance> = new Map();
    private onBotsUpdate: (bots: RunningBot[]) => void = () => {};
    
    // Single, shared WebSocket connection and state
    private ws: WebSocket | null = null;
    private subscriptions: Map<string, Set<Function | string>> = new Map();
    private connectionId = 1;
    private isConnecting = false;
    private reconnectionTimeout: number | null = null;
    
    // Historical data cache
    private klineHistory: Map<string, Kline[]> = new Map();
    
    init(onBotsUpdate: (bots: RunningBot[]) => void) {
        this.onBotsUpdate = onBotsUpdate;
        this.connect(); // Initial connection attempt
    }

    private connect() {
        if (this.ws || this.isConnecting) return;
        this.isConnecting = true;
        this.bots.forEach(b => b.addLog('WebSocket: Connecting...', LogType.Info));
        
        this.ws = new WebSocket(`wss://stream.binance.com:9443/stream`);

        this.ws.onopen = () => {
            console.log('BotManager: WebSocket connected.');
            this.isConnecting = false;
            if (this.reconnectionTimeout) clearTimeout(this.reconnectionTimeout);
            this.reconnectionTimeout = null;
            this.bots.forEach(b => b.addLog('WebSocket: Connection successful.', LogType.Success));


            // Re-subscribe to all existing streams
            const allStreams = Array.from(this.subscriptions.keys());
            if (allStreams.length > 0) {
                this.sendWsMessage('SUBSCRIBE', allStreams);
            }

            // Force refresh all running bots to recover from potential desync
            this.bots.forEach(botInstance => {
                if (botInstance.bot.status !== BotStatus.Stopped && botInstance.bot.status !== BotStatus.Error) {
                    botInstance.forceRefreshAndAnalyze();
                }
            });
        };

        this.ws.onmessage = this.onMessage.bind(this);

        this.ws.onerror = (error) => {
            console.error('BotManager: WebSocket error:', error);
            this.bots.forEach(b => b.addLog('WebSocket: Connection error.', LogType.Error));
            this.ws?.close();
        };

        this.ws.onclose = () => {
            console.log('BotManager: WebSocket disconnected.');
            this.bots.forEach(b => b.addLog('WebSocket: Disconnected.', LogType.Error));
            this.ws = null;
            this.isConnecting = false;
            if (!this.reconnectionTimeout) {
                this.bots.forEach(b => b.addLog(`WebSocket: Retrying in ${RECONNECT_DELAY / 1000}s...`, LogType.Info));
                this.reconnectionTimeout = window.setTimeout(() => this.connect(), RECONNECT_DELAY);
            }
        };
    }

    private sendWsMessage(method: 'SUBSCRIBE' | 'UNSUBSCRIBE', params: string[]) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                method,
                params,
                id: this.connectionId++
            }));
        }
    }

    private onMessage(event: MessageEvent) {
        const message = JSON.parse(event.data);
    
        if (message.result === null && message.id) {
            // Subscription confirmation
            return;
        }
    
        if (message.stream && message.data) {
            const streamName = message.stream;
            const data = message.data;
            const subscribers = this.subscriptions.get(streamName);
            
            if (subscribers) {
                subscribers.forEach(sub => {
                    this.dispatchData(sub, streamName, data);
                });
            }
        }
    }

    private dispatchData(subscriber: Function | string, streamName: string, data: any) {
        if (streamName.includes('@ticker')) {
            const tickerData: LiveTicker = { 
                pair: data.s, 
                closePrice: parseFloat(data.c), 
                highPrice: parseFloat(data.h), 
                lowPrice: parseFloat(data.l), 
                volume: parseFloat(data.v), 
                quoteVolume: parseFloat(data.q) 
            };
            if (typeof subscriber === 'function') {
                subscriber(tickerData);
            } else {
                this.bots.get(subscriber)?.updateLivePrice(tickerData.closePrice, tickerData);
            }
        } else if (streamName.includes('@kline')) {
            const k = data.k;
            const newKline: Kline = { time: k.t, open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c), volume: parseFloat(k.v), isFinal: k.x };
            
            // Update shared history for this stream
            const klineKey = streamName.split('@')[0] + '_' + k.i;
            const history = this.klineHistory.get(klineKey) || [];
            const lastKline = history[history.length - 1];
            if (lastKline && newKline.time === lastKline.time) {
                history[history.length - 1] = newKline;
            } else {
                history.push(newKline);
                if (history.length > 2000) history.shift();
            }
            this.klineHistory.set(klineKey, history);

            if (typeof subscriber === 'function') {
                subscriber(newKline);
            } else {
                const botInstance = this.bots.get(subscriber);
                if (botInstance) {
                    const botTimeframe = botInstance.bot.config.timeFrame;
                    const streamTimeframe = k.i;
                    if (streamTimeframe === botTimeframe) {
                        botInstance.onMainKlineUpdate(newKline);
                    } else if (streamTimeframe === '1m' && botInstance.bot.openPosition) {
                        botInstance.onManagementKlineUpdate(newKline);
                    }
                }
            }
        }
    }

    private subscribe(streamName: string, subscriber: Function | string) {
        if (!this.ws) this.connect();

        const subscribers = this.subscriptions.get(streamName) || new Set();
        if (subscribers.size === 0) {
            this.sendWsMessage('SUBSCRIBE', [streamName]);
        }
        subscribers.add(subscriber);
        this.subscriptions.set(streamName, subscribers);
    }
    
    private unsubscribe(streamName: string, subscriber: Function | string) {
        const subscribers = this.subscriptions.get(streamName);
        if (subscribers) {
            subscribers.delete(subscriber);
            if (subscribers.size === 0) {
                this.sendWsMessage('UNSUBSCRIBE', [streamName]);
                this.subscriptions.delete(streamName);
            }
        }
    }
    
    public subscribeToTickerUpdates(pairSymbol: string, callback: (ticker: LiveTicker) => void) {
        this.subscribe(`${pairSymbol.toLowerCase()}@ticker`, callback);
    }
    
    public unsubscribeFromTickerUpdates(pairSymbol: string, callback: (ticker: LiveTicker) => void) {
        this.unsubscribe(`${pairSymbol.toLowerCase()}@ticker`, callback);
    }

    public subscribeToKlineUpdates(pairSymbol: string, timeFrame: string, subscriber: ((kline: Kline) => void) | string) {
        this.subscribe(`${pairSymbol.toLowerCase()}@kline_${timeFrame}`, subscriber);
    }

    public unsubscribeFromKlineUpdates(pairSymbol: string, timeFrame: string, subscriber: ((kline: Kline) => void) | string) {
        this.unsubscribe(`${pairSymbol.toLowerCase()}@kline_${timeFrame}`, subscriber);
    }
    
    public updateKlines(pairSymbol: string, timeFrame: string, klines: Kline[]) {
        const klineKey = `${pairSymbol.toLowerCase()}_${timeFrame}`;
        this.klineHistory.set(klineKey, klines);
    }

    private notifyUpdate() {
        const botArray = Array.from(this.bots.values()).map(instance => instance.bot);
        this.onBotsUpdate(botArray);
    }

    async startBot(config: BotConfig, handlersRef: React.RefObject<BotHandlers>) {
        const instance = new BotInstance(config, () => this.notifyUpdate(), handlersRef);
        this.bots.set(instance.bot.id, instance);
        
        try {
            const formattedPair = config.pair.replace('/', '');
            const mainKlineKey = `${formattedPair.toLowerCase()}_${config.timeFrame}`;
            const existingHistory = this.klineHistory.get(mainKlineKey);
            
            const initialKlines = existingHistory && existingHistory.length > 0
                ? existingHistory
                : await binanceService.fetchKlines(formattedPair, config.timeFrame);
            
            this.klineHistory.set(mainKlineKey, initialKlines);

            await instance.initialize(initialKlines);
            
            this.subscribeToTickerUpdates(formattedPair, instance.bot.id as any); // Use bot ID for internal routing
            this.subscribeToKlineUpdates(formattedPair, config.timeFrame, instance.bot.id);
            this.notifyUpdate();
        } catch (error) {
            instance.addLog(`Failed to start bot: ${error instanceof Error ? error.message : 'Unknown error'}`, LogType.Error);
            instance.updateState({ status: BotStatus.Error });
        }
    }
    
    stopBot(botId: string) {
        const instance = this.bots.get(botId);
        if (instance) {
            const { pair, timeFrame } = instance.bot.config;
            const pairSymbol = pair.replace('/', '').toLowerCase();
            instance.stop();
            this.unsubscribe(`${pairSymbol}@ticker`, botId);
            this.unsubscribe(`${pairSymbol}@kline_${timeFrame}`, botId);
            this.unsubscribe(`${pairSymbol}@kline_1m`, botId);
        }
    }

    pauseBot(botId: string) { this.bots.get(botId)?.pause(); }
    resumeBot(botId: string) { this.bots.get(botId)?.resume(); }

    deleteBot(botId: string) {
        const instance = this.bots.get(botId);
        if (instance) {
            if (instance.bot.status !== BotStatus.Stopped) this.stopBot(botId);
            this.bots.delete(botId);
            this.notifyUpdate();
        }
    }

    stopAllBots() {
        this.bots.forEach(instance => this.stopBot(instance.bot.id));
        if (this.ws) {
            this.ws.close();
        }
    }
    
    getBot(botId: string): RunningBot | undefined { return this.bots.get(botId)?.bot; }
    
    async updateBotConfig(botId: string, partialConfig: Partial<BotConfig>) { 
        await this.bots.get(botId)?.updateTradeParams(partialConfig);
    }
    
    updateBotState(botId: string, newState: Partial<RunningBot>) {
        const instance = this.bots.get(botId);
        if (!instance) return;
        
        const wasInPosition = !!instance.bot.openPosition;
        instance.updateState(newState);
        const isNowInPosition = !!instance.bot.openPosition;
        
        const pairSymbol = instance.bot.config.pair.replace('/', '').toLowerCase();
        
        // If bot just entered a position, subscribe to 1m klines
        if (isNowInPosition && !wasInPosition) {
            this.subscribeToKlineUpdates(pairSymbol, '1m', botId);
        }
    }

    addBotLog(botId: string, message: string, type: LogType = LogType.Info) { 
        const instance = this.bots.get(botId);
        if(instance) {
            instance.addLog(message, type);
        }
    }

    public notifyTradeExecutionFailed(botId: string, reason: string) {
        const instance = this.bots.get(botId);
        if (instance) {
            instance.onExecutionFailed(reason);
        }
    }
    
    notifyPositionClosed(botId: string, pnl: number) {
        const instance = this.bots.get(botId);
        if (instance) {
            instance.onPositionClosed(pnl);
            const pairSymbol = instance.bot.config.pair.replace('/', '').toLowerCase();
            this.unsubscribeFromKlineUpdates(pairSymbol, '1m', botId);
        }
    }

    public waitForBotLivePrice(botId: string, timeoutMs: number = 5000): Promise<number | null> {
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