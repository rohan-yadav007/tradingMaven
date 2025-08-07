
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
        
        // Start the single, unified master timer
        this.masterTimer = window.setInterval(() => this.tick(), MASTER_TICK_INTERVAL_MS);
        
        // Perform immediate analysis on startup instead of waiting for the next tick.
        this.addLog("Performing initial analysis on startup.", LogType.Info);
        await this.runImmediateAnalysis(); 
        
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
                            return; // Stop execution
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
        const lastKline = this.klines[this.klines.length - 1];
        if (lastKline && newKline.time === lastKline.time) {
            this.klines[this.klines.length - 1] = newKline;
        } else {
            this.klines.push(newKline);
            if(this.klines.length > 2000) this.klines.shift();
        }
        this.bot.klinesLoaded = this.klines.length;

        if (newKline.isFinal) {
            this.addLog(`New ${this.bot.config.timeFrame} candle closed. Master loop will process.`, LogType.Status);
        }
    }
    
    private async proactiveManagePosition() {
        if (!this.bot.openPosition || !this.handlersRef.current || !this.bot.livePrice) {
            return;
        }
    
        const { livePrice, config, openPosition } = this.bot;
        const isLong = openPosition.direction === 'LONG';
    
        // Use live price for up-to-the-second analysis
        const analysisKlines = [...this.klines];
        if (livePrice && analysisKlines.length > 0) {
            const previewCandle = { ...analysisKlines[analysisKlines.length - 1], close: livePrice, isFinal: false };
            analysisKlines[analysisKlines.length - 1] = previewCandle;
        }
    
        const managementSignal = await getTradeManagementSignal(openPosition, analysisKlines, livePrice, config);
    
        // 1. Handle partial position closure
        if (managementSignal.partialClose && this.handlersRef.current.onPartialClose) {
            this.addLog(`Agent decided to partially close position. Reason: ${managementSignal.partialClose.reason}`, LogType.Action);
            await this.handlersRef.current.onPartialClose(openPosition, managementSignal.partialClose.tpIndex);
            return; // Await partial close before continuing
        }

        // 2. Handle full position closure
        if (managementSignal.closePosition) {
            this.addLog(`Agent decided to close position. Reason: ${managementSignal.reasons[0]}`, LogType.Action);
            this.handlersRef.current.onClosePosition(openPosition, managementSignal.reasons[0], livePrice);
            return; // Exit as position is being closed
        }
    
        // 3. Handle dynamic stop loss (trailing)
        if (managementSignal.newStopLoss && !config.isStopLossLocked) {
            const currentSL = openPosition.stopLossPrice;
            const newSL = managementSignal.newStopLoss;
    
            const isImprovement = (isLong && newSL > currentSL) || (!isLong && newSL < currentSL);
    
            if (isImprovement && newSL !== currentSL) {
                openPosition.stopLossPrice = newSL;
                this.addLog(`Trailing Stop Loss updated to ${newSL.toFixed(openPosition.pricePrecision)}. Reason: ${managementSignal.reasons[0]}`, LogType.Action);
            }
        }
        
        // 4. Handle dynamic take profit (if any agent implements this in the future)
        if (managementSignal.newTakeProfit && !config.isTakeProfitLocked) {
            const currentTP = openPosition.takeProfitPrice;
            const newTP = managementSignal.newTakeProfit;
    
            if (newTP !== currentTP) {
                openPosition.takeProfitPrice = newTP;
                this.addLog(`Take Profit updated to ${newTP.toFixed(openPosition.pricePrecision)}. Reason: ${managementSignal.reasons[0]}`, LogType.Action);
            }
        }
    }
    
    private async tick() {
        if (this.isTicking) return;
        this.isTicking = true;
        try {
            const { status, openPosition, cooldownUntil } = this.bot;

            // Inactive states, do nothing.
            if (status === BotStatus.Paused || status === BotStatus.Stopping || status === BotStatus.Stopped || status === BotStatus.Error) {
                return;
            }

            // --- State 1: Position is Open ---
            if (openPosition) {
                if (this.bot.livePrice && this.bot.lastPriceUpdateTimestamp && (Date.now() - this.bot.lastPriceUpdateTimestamp > 10000)) {
                    const lastLog = this.bot.log[0];
                    if (!lastLog || !lastLog.message.includes("Live price feed may be delayed")) {
                        this.addLog("WARNING: Live price feed may be delayed. Last update was >10s ago. Trade management might be impacted.", LogType.Error);
                    }
                }

                // Check for SL/TP hit by live price (highest priority)
                 if (this.bot.livePrice && this.handlersRef.current?.onClosePosition) {
                    const { direction, takeProfitPrice, stopLossPrice } = openPosition;
                    const isLong = direction === 'LONG';
                    let exitPrice: number | null = null;
                    let exitReason: string | null = null;
            
                    if ((isLong && this.bot.livePrice >= takeProfitPrice) || (!isLong && this.bot.livePrice <= takeProfitPrice)) {
                        exitPrice = takeProfitPrice;
                        exitReason = 'Take Profit Hit';
                    } else if ((isLong && this.bot.livePrice <= stopLossPrice) || (!isLong && this.bot.livePrice >= stopLossPrice)) {
                        exitPrice = stopLossPrice;
                        exitReason = 'Stop Loss Hit';
                    }
                    if (exitPrice !== null && exitReason !== null) {
                        this.addLog(`${exitReason} triggered. Closing position.`, LogType.Action);
                        this.handlersRef.current.onClosePosition(openPosition, exitReason, exitPrice);
                        return; // Exit tick immediately after closing
                    }
                }
                
                // Run proactive management (checking for signal reversal and trailing stops)
                if (status !== BotStatus.ExecutingTrade) {
                    await this.proactiveManagePosition();
                }
                return; 
            }

            // --- State 2: No Position, but in Error Cooldown ---
            if (cooldownUntil && Date.now() < cooldownUntil) {
                if (status !== BotStatus.Cooldown) this.updateState({ status: BotStatus.Cooldown });
                return; // Wait for cooldown to expire.
            }
            
            // --- State 3: No Position, Ready to Analyze ---
            if (status === BotStatus.Cooldown) {
                 this.addLog("Cooldown finished.", LogType.Status);
                 this.updateState({ status: BotStatus.Monitoring, cooldownUntil: null, analysis: null });
            }
           
            if ([BotStatus.Monitoring, BotStatus.PostProfitAnalysis].includes(status)) {
                 await this.runImmediateAnalysis();
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred during tick processing.";
            this.addLog(`Error during main tick loop: ${errorMessage}`, LogType.Error);
            this.updateState({ status: BotStatus.Error, analysis: { signal: 'HOLD', reasons: [errorMessage] } });
        } finally {
            this.isTicking = false;
            this.onUpdate();
        }
    }

    private async getInitialPriceReliably(): Promise<number | null> {
        if (this.bot.livePrice && this.bot.livePrice > 0) return this.bot.livePrice;
        
        const { pair, mode } = this.bot.config;
        const formattedPair = pair.replace('/', '');
        this.addLog("Live price not available via WebSocket, fetching via HTTP...", LogType.Info);
        
        try {
            const price = mode === TradingMode.USDSM_Futures 
                ? await binanceService.fetchFuturesTickerPrice(formattedPair)
                : await binanceService.fetchTickerPrice(formattedPair);
            
            if (price) {
                this.addLog(`HTTP Price fetched successfully: ${price}`, LogType.Success);
                this.bot.livePrice = price; 
                this.onUpdate();
                return price;
            }
        } catch (error) {
            console.error(`Reliable price fetch failed for ${formattedPair}`, error);
        }
        return null;
    }
    
    private async executeTrade(signal: TradeSignal) {
        const { config } = this.bot;
        const { onExecuteTrade } = this.handlersRef.current!;
    
        const initialEntryPrice = await this.getInitialPriceReliably();
        if (initialEntryPrice === null) {
            this.onExecutionFailed("Could not get live price for trade execution.");
            return;
        }
    
        const isLong = signal.signal === 'BUY';
        
        // --- TARGET CALCULATION ---
        const agentTargets = getInitialAgentTargets(this.klines, initialEntryPrice, isLong ? 'LONG' : 'SHORT', config.timeFrame, { ...DEFAULT_AGENT_PARAMS, ...config.agentParams }, config.agent.id);
        
        let finalStopLossPrice: number;
        let finalTakeProfitPrice: number;

        if (config.isStopLossLocked) {
             const { investmentAmount, stopLossMode, stopLossValue } = config;
             const positionValue = config.mode === TradingMode.USDSM_Futures ? investmentAmount * config.leverage : investmentAmount;
             const tradeSize = positionValue / initialEntryPrice;

             if (stopLossMode === RiskMode.Percent) {
                const lossAmount = investmentAmount * (stopLossValue / 100);
                finalStopLossPrice = isLong ? initialEntryPrice - (lossAmount / tradeSize) : initialEntryPrice + (lossAmount / tradeSize);
             } else { // Amount
                finalStopLossPrice = isLong ? initialEntryPrice - (stopLossValue / tradeSize) : initialEntryPrice + (stopLossValue / tradeSize);
             }
        } else {
            finalStopLossPrice = agentTargets.stopLossPrice;
        }

        if (config.isTakeProfitLocked) {
            const { investmentAmount, takeProfitMode, takeProfitValue } = config;
            const positionValue = config.mode === TradingMode.USDSM_Futures ? investmentAmount * config.leverage : investmentAmount;
            const tradeSize = positionValue / initialEntryPrice;
            if (takeProfitMode === RiskMode.Percent) {
                const profitAmount = investmentAmount * (takeProfitValue / 100);
                finalTakeProfitPrice = isLong ? initialEntryPrice + (profitAmount / tradeSize) : initialEntryPrice - (profitAmount / tradeSize);
            } else { // Amount
                finalTakeProfitPrice = isLong ? initialEntryPrice + (takeProfitValue / tradeSize) : initialEntryPrice - (takeProfitValue / tradeSize);
            }
        } else {
             const riskDistance = Math.abs(initialEntryPrice - finalStopLossPrice);
             const agentRiskDistance = Math.abs(initialEntryPrice - agentTargets.stopLossPrice);
             const agentProfitDistance = Math.abs(agentTargets.takeProfitPrice - initialEntryPrice);
             const riskRewardRatio = agentRiskDistance > 0 ? agentProfitDistance / agentRiskDistance : 1.5;
             finalTakeProfitPrice = isLong ? initialEntryPrice + (riskDistance * riskRewardRatio) : initialEntryPrice - (riskDistance * riskRewardRatio);
        }
        
        // --- Hard Cap Safety Net ---
        const positionValue = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
        const tradeSize = positionValue / initialEntryPrice;
        const maxLossAmount = config.investmentAmount * (MAX_STOP_LOSS_PERCENT_OF_INVESTMENT / 100);
        const hardCapStopLossPrice = isLong ? initialEntryPrice - (maxLossAmount / tradeSize) : initialEntryPrice + (maxLossAmount / tradeSize);
        
        const originalFinalStopLoss = finalStopLossPrice;
        finalStopLossPrice = isLong ? Math.max(finalStopLossPrice, hardCapStopLossPrice) : Math.min(finalStopLossPrice, hardCapStopLossPrice);

        if (finalStopLossPrice !== originalFinalStopLoss) {
            this.addLog(`SAFETY OVERRIDE: Hard cap of ${MAX_STOP_LOSS_PERCENT_OF_INVESTMENT}% is tighter than configured SL. Enforcing safer stop.`, LogType.Action);
            if (!config.isTakeProfitLocked) {
                const riskDistance = Math.abs(initialEntryPrice - finalStopLossPrice);
                const originalRiskDistance = Math.abs(initialEntryPrice - originalFinalStopLoss);
                const originalProfitDistance = Math.abs(finalTakeProfitPrice - initialEntryPrice);
                const riskRewardRatio = originalRiskDistance > 0 ? originalProfitDistance / originalRiskDistance : 1.5;
                const newProfitDistance = riskDistance * riskRewardRatio;
                finalTakeProfitPrice = isLong ? initialEntryPrice + newProfitDistance : initialEntryPrice - (newProfitDistance);
                this.addLog(`Take Profit adjusted to ${finalTakeProfitPrice.toFixed(config.pricePrecision)} to maintain R:R after SL cap.`, LogType.Info);
            }
        }
        
        this.addLog(`Final Targets - SL: ${finalStopLossPrice.toFixed(config.pricePrecision)}, TP: ${finalTakeProfitPrice.toFixed(config.pricePrecision)}`, LogType.Success);

        const execSignal: TradeSignal = {
            ...signal, entryPrice: initialEntryPrice, stopLossPrice: finalStopLossPrice, takeProfitPrice: finalTakeProfitPrice
        };
        
        // Add partial TP info to the position if the agent provides it
        if (agentTargets.partialTps) {
             execSignal.partialTps = agentTargets.partialTps;
             execSignal.trailStartPrice = agentTargets.trailStartPrice;
        }

        await onExecuteTrade(execSignal, this.bot.id);
    }
    
    onExecutionFailed(reason: string) {
        this.addLog(`Trade execution failed: ${reason}. Short cooldown initiated.`, LogType.Error);
        
        const cooldownMs = 10 * 1000; // 10 second cooldown on failure
        const cooldownUntil = Date.now() + cooldownMs;

        this.updateState({
            status: BotStatus.Cooldown,
            cooldownUntil: cooldownUntil,
            analysis: { signal: 'HOLD', reasons: [`Execution failed.`] }
        });
    }

    onPositionClosed(pnl: number) {
        if (this.bot.openPositionId === null) {
            return;
        }

        const closedPositionDirection = this.bot.openPosition!.direction;

        this.bot.openPositionId = null;
        this.bot.openPosition = null;
        this.managementKlines = []; 
        this.bot.lastAnalysisTimestamp = null;
        this.bot.closedTradesCount = (this.bot.closedTradesCount || 0) + 1;
        this.bot.totalPnl = (this.bot.totalPnl || 0) + pnl;

        if (pnl > 0) {
            this.bot.wins = (this.bot.wins || 0) + 1;
            this.bot.totalGrossProfit = (this.bot.totalGrossProfit || 0) + pnl;
        } else {
            this.bot.losses = (this.bot.losses || 0) + 1;
            this.bot.totalGrossLoss = (this.bot.totalGrossLoss || 0) + Math.abs(pnl);
        }

        if (pnl > 0 && this.bot.config.isCooldownEnabled) {
            this.updateState({ 
                status: BotStatus.PostProfitAnalysis,
                lastProfitableTradeDirection: closedPositionDirection 
            });
            this.addLog(`Profitable trade closed. Entering Post-Profit Analysis to check for trend exhaustion.`, LogType.Info);
        } else {
            const logMessage = pnl <= 0 
                ? `Position closed with Gross PNL: ${pnl.toFixed(2)}. Resuming monitoring.`
                : `Position closed with Gross PNL: ${pnl.toFixed(2)}. Cooldown disabled. Resuming monitoring.`;
            this.updateState({ status: BotStatus.Monitoring, lastProfitableTradeDirection: null });
            this.addLog(logMessage, LogType.Success);
        }
    }
    
    onPartialPositionClosed(realizedPnl: number, closedSize: number, tpIndex: number) {
        const { openPosition } = this.bot;
        if (!openPosition || !openPosition.partialTps) return;
        
        this.addLog(`Partial close (TP${tpIndex + 1}) executed. Realized PNL: $${realizedPnl.toFixed(2)}`, LogType.Success);
        
        // Update position state
        openPosition.size -= closedSize;
        openPosition.partialTps[tpIndex].hit = true;
        
        // Update bot performance metrics
        this.bot.totalPnl += realizedPnl;
        if(realizedPnl > 0) {
            this.bot.totalGrossProfit += realizedPnl;
        } else {
            this.bot.totalGrossLoss += Math.abs(realizedPnl);
        }
        
        // Check if this was the last partial close. If so, only trailing stop remains.
        const remainingTps = openPosition.partialTps.filter(tp => !tp.hit).length;
        if (remainingTps === 0) {
            this.addLog(`All partial TPs hit. Trailing stop is now active on remaining ${openPosition.size.toFixed(this.bot.config.quantityPrecision)} units.`, LogType.Info);
        }

        this.onUpdate();
    }


    pause() {
        if ([BotStatus.Monitoring, BotStatus.PositionOpen, BotStatus.Cooldown, BotStatus.PostProfitAnalysis].includes(this.bot.status)) {
            if (this.masterTimer) {
                clearInterval(this.masterTimer);
                this.masterTimer = null;
            }
            if (this.bot.lastResumeTimestamp) {
                this.bot.accumulatedActiveMs += Date.now() - this.bot.lastResumeTimestamp;
            }
            this.bot.lastResumeTimestamp = null;
            this.bot.status = BotStatus.Paused;
            this.addLog('Bot paused.', LogType.Info);
            this.onUpdate();
        }
    }

    resume() {
        if (this.bot.status !== BotStatus.Paused) return;
    
        this.addLog('Bot resumed.', LogType.Info);
        this.bot.lastResumeTimestamp = Date.now();
        this.masterTimer = window.setInterval(() => this.tick(), MASTER_TICK_INTERVAL_MS);
        
        // Let the tick handler determine the correct state
        this.tick();
    }
    
    async updateTradeParams(partialConfig: Partial<BotConfig>) {
        this.bot.config = { ...this.bot.config, ...partialConfig };
    
        Object.keys(partialConfig).forEach(keyStr => {
            const key = keyStr as keyof BotConfig;
            this.addLog(`Config updated: ${key} = ${JSON.stringify(this.bot.config[key])}`, LogType.Action);
        });
    
        if (!this.bot.openPosition) {
            this.onUpdate();
            return;
        }
    
        const { config: newConfig } = this.bot;
        const position = this.bot.openPosition;
        let targetsUpdated = false;
    
        // Helper to calculate targets based on user input
        const getStaticTargets = () => {
            const isLong = position.direction === 'LONG';
            const { investmentAmount, stopLossMode, stopLossValue, takeProfitMode, takeProfitValue } = newConfig;
    
            let slPrice: number;
            if (stopLossMode === RiskMode.Percent) {
                const lossAmount = investmentAmount * (stopLossValue / 100);
                const priceChange = lossAmount / position.size;
                slPrice = isLong ? position.entryPrice - priceChange : position.entryPrice + priceChange;
            } else {
                const priceChange = stopLossValue / position.size;
                slPrice = isLong ? position.entryPrice - priceChange : position.entryPrice + priceChange;
            }
    
            let tpPrice: number;
            if (takeProfitMode === RiskMode.Percent) {
                const profitAmount = investmentAmount * (takeProfitValue / 100);
                const priceChange = profitAmount / position.size;
                tpPrice = isLong ? position.entryPrice + priceChange : position.entryPrice - priceChange;
            } else {
                const priceChange = takeProfitValue / position.size;
                tpPrice = isLong ? position.entryPrice + priceChange : position.entryPrice - priceChange;
            }
            return { stopLossPrice: slPrice, takeProfitPrice: tpPrice };
        };
    
        // Only update SL if it's locked and the value changes
        if (newConfig.isStopLossLocked) {
            const { stopLossPrice: newStaticSl } = getStaticTargets();
            if (position.stopLossPrice !== newStaticSl) {
                position.stopLossPrice = newStaticSl;
                targetsUpdated = true;
                this.addLog(`Stop Loss manually set to ${newStaticSl.toFixed(position.pricePrecision)}`, LogType.Action);
            }
        }
        
        // Only update TP if it's locked and the value changes
        if (newConfig.isTakeProfitLocked) {
            const { takeProfitPrice: newStaticTp } = getStaticTargets();
            if (position.takeProfitPrice !== newStaticTp) {
                position.takeProfitPrice = newStaticTp;
                targetsUpdated = true;
                this.addLog(`Take Profit manually set to ${newStaticTp.toFixed(position.pricePrecision)}`, LogType.Action);
            }
        }
    
        if (targetsUpdated) {
            this.addLog(`Targets updated. SL: ${position.stopLossPrice.toFixed(position.pricePrecision)}, TP: ${position.takeProfitPrice.toFixed(position.pricePrecision)}.`, LogType.Info);
        }
        
        // Unlocked targets will be handled by the next tick via proactiveManagePosition
        this.onUpdate();
    }
    
    updateState(newState: Partial<RunningBot>) {
        this.bot = { ...this.bot, ...newState };
        this.onUpdate();
    }

    stop() {
        if (this.masterTimer) clearInterval(this.masterTimer);
        this.masterTimer = null;
        
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
    
    // --- WebSocket State ---
    private wsConnections: Map<TradingMode, WebSocket | null> = new Map();
    private connectionStates: Map<TradingMode, { isConnecting: boolean; reconnectionTimeout: number | null }> = new Map();
    private subscriptions: Map<TradingMode, Map<string, Set<(data: any) => void>>> = new Map();
    private connectionIds: Map<TradingMode, number> = new Map();
    
    private klineHistory: Map<string, Kline[]> = new Map();
    
    init(onBotsUpdate: (bots: RunningBot[]) => void) {
        this.onBotsUpdate = onBotsUpdate;
        
        // Initialize state for both modes
        for (const mode of Object.values(TradingMode)) {
            this.wsConnections.set(mode, null);
            this.connectionStates.set(mode, { isConnecting: false, reconnectionTimeout: null });
            this.subscriptions.set(mode, new Map());
            this.connectionIds.set(mode, 1);
        }

        this.connect(TradingMode.Spot);
        this.connect(TradingMode.USDSM_Futures);
    }

    private onMessage(event: MessageEvent, mode: TradingMode) {
        try {
            const message = JSON.parse(event.data);
            const modeSubscriptions = this.subscriptions.get(mode);
            if (!modeSubscriptions) return;

            if (message.stream && message.data) {
                const streamName = message.stream;
                const callbacks = modeSubscriptions.get(streamName);
                if (!callbacks) return;

                if (streamName.includes('@kline_')) {
                    const klineData = message.data.k;
                    const formattedKline: Kline = {
                        time: klineData.t, open: parseFloat(klineData.o), high: parseFloat(klineData.h),
                        low: parseFloat(klineData.l), close: parseFloat(klineData.c),
                        volume: parseFloat(klineData.v), isFinal: klineData.x,
                    };
                    callbacks.forEach(cb => cb(formattedKline));
                } else if (streamName.includes('@ticker')) {
                    const tickerData = message.data;
                    const formattedTicker: LiveTicker = {
                        pair: tickerData.s.toLowerCase(), closePrice: parseFloat(tickerData.c),
                        highPrice: parseFloat(tickerData.h), lowPrice: parseFloat(tickerData.l),
                        volume: parseFloat(tickerData.v), quoteVolume: parseFloat(tickerData.q),
                    };
                     callbacks.forEach(cb => cb(formattedTicker));
                }
            } else if (message.result === null && message.id) {
                console.log(`BotManager [${mode}]: Received confirmation for request ID ${message.id}`);
            }
        } catch (error) {
            console.error(`BotManager [${mode}]: Error parsing WebSocket message:`, error, event.data);
        }
    }

    private connect(mode: TradingMode) {
        const state = this.connectionStates.get(mode);
        if (this.wsConnections.get(mode) || state?.isConnecting) return;

        state!.isConnecting = true;
        
        // Use local proxy to avoid cross-origin issues in development
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;

        const url = mode === TradingMode.Spot
            ? `${wsProtocol}//${host}/proxy-spot-ws/stream`
            : `${wsProtocol}//${host}/proxy-futures-ws/stream`;

        console.log(`BotManager: Connecting to ${mode} stream at ${url}...`);
        const ws = new WebSocket(url);
        this.wsConnections.set(mode, ws);

        ws.onopen = () => {
            console.log(`BotManager [${mode}]: WebSocket connected.`);
            state!.isConnecting = false;
            if (state!.reconnectionTimeout) clearTimeout(state!.reconnectionTimeout);
            state!.reconnectionTimeout = null;

            const streams = Array.from(this.subscriptions.get(mode)?.keys() || []);
            if (streams.length > 0) {
                this.sendWsMessage(mode, 'SUBSCRIBE', streams);
            }
        };

        ws.onmessage = (event) => this.onMessage(event, mode);

        ws.onerror = (error) => {
            console.error(`BotManager [${mode}]: WebSocket error:`, error);
            ws.close();
        };

        ws.onclose = (event: CloseEvent) => {
            console.log(`BotManager [${mode}]: WebSocket disconnected. Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}.`);
            this.wsConnections.set(mode, null);
            state!.isConnecting = false;
            if (!state!.reconnectionTimeout) {
                console.log(`BotManager [${mode}]: Retrying in ${RECONNECT_DELAY / 1000}s...`);
                state!.reconnectionTimeout = window.setTimeout(() => this.connect(mode), RECONNECT_DELAY);
            }
        };
    }

    private sendWsMessage(mode: TradingMode, method: 'SUBSCRIBE' | 'UNSUBSCRIBE', params: string[]) {
        const ws = this.wsConnections.get(mode);
        if (ws?.readyState === WebSocket.OPEN) {
            const id = this.connectionIds.get(mode)!;
            ws.send(JSON.stringify({ method, params, id }));
            this.connectionIds.set(mode, id + 1);
        }
    }

    private addSubscription(mode: TradingMode, streamName: string, callback: (data: any) => void) {
        const modeSubscriptions = this.subscriptions.get(mode);
        if (!modeSubscriptions) return;

        if (!modeSubscriptions.has(streamName)) {
            modeSubscriptions.set(streamName, new Set());
            if (this.wsConnections.get(mode)?.readyState === WebSocket.OPEN) {
                this.sendWsMessage(mode, 'SUBSCRIBE', [streamName]);
            }
        }
        modeSubscriptions.get(streamName)!.add(callback);
    }
    
    private removeSubscription(mode: TradingMode, streamName: string, callback: (data: any) => void) {
        const modeSubscriptions = this.subscriptions.get(mode);
        if (!modeSubscriptions) return;

        const callbacks = modeSubscriptions.get(streamName);
        if (callbacks) {
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                modeSubscriptions.delete(streamName);
                if (this.wsConnections.get(mode)?.readyState === WebSocket.OPEN) {
                    this.sendWsMessage(mode, 'UNSUBSCRIBE', [streamName]);
                }
            }
        }
    }

    subscribeToTickerUpdates(pair: string, mode: TradingMode, callback: (ticker: LiveTicker) => void) {
        const streamName = `${pair}@ticker`;
        this.addSubscription(mode, streamName, callback);
    }

    unsubscribeFromTickerUpdates(pair: string, mode: TradingMode, callback: (ticker: LiveTicker) => void) {
        const streamName = `${pair}@ticker`;
        this.removeSubscription(mode, streamName, callback);
    }

    subscribeToKlineUpdates(pair: string, timeFrame: string, mode: TradingMode, callback: (kline: Kline) => void) {
        const streamName = `${pair}@kline_${timeFrame}`;
        this.addSubscription(mode, streamName, callback);
    }

    unsubscribeFromKlineUpdates(pair: string, timeFrame: string, mode: TradingMode, callback: (kline: Kline) => void) {
        const streamName = `${pair}@kline_${timeFrame}`;
        this.removeSubscription(mode, streamName, callback);
    }

    // --- Bot Lifecycle Management ---

    async startBot(config: BotConfig, handlersRef: React.RefObject<BotHandlers>) {
        const botInstance = new BotInstance(config, () => this.publishBotsUpdate(), handlersRef);
        this.bots.set(botInstance.bot.id, botInstance);
        this.publishBotsUpdate();
        
        try {
            const formattedPair = config.pair.replace('/', '');
            
            // Unify kline fetching for both modes
            const klineFetcher = config.mode === TradingMode.USDSM_Futures 
                ? (pair: string, tf: string) => binanceService.fetchKlines(pair, tf)
                : (pair: string, tf: string) => binanceService.fetchKlines(pair, tf);
            
            const klines = await klineFetcher(formattedPair, config.timeFrame);
            this.klineHistory.set(`${formattedPair}-${config.timeFrame}`, klines);
            
            await botInstance.initialize(klines);
            
            const tickerCallback = (ticker: LiveTicker) => botInstance.updateLivePrice(ticker.closePrice, ticker);
            const klineCallback = (kline: Kline) => botInstance.onMainKlineUpdate(kline);
            
            // Store callbacks with the bot instance to remove them later correctly.
            (botInstance as any)._tickerCallback = tickerCallback;
            (botInstance as any)._klineCallback = klineCallback;

            this.subscribeToTickerUpdates(formattedPair.toLowerCase(), config.mode, tickerCallback);
            this.subscribeToKlineUpdates(formattedPair.toLowerCase(), config.timeFrame, config.mode, klineCallback);

        } catch (error) {
            botInstance.addLog(`Failed to start bot: ${error instanceof Error ? error.message : 'Unknown error'}`, LogType.Error);
            botInstance.updateState({ status: BotStatus.Error, analysis: {signal: 'HOLD', reasons: ['Failed to start.']} });
        }
    }

    stopBot(botId: string) {
        const botInstance = this.bots.get(botId);
        if (botInstance) {
            const { pair, timeFrame, mode } = botInstance.bot.config;
            const formattedPair = pair.replace('/', '').toLowerCase();

            // Unsubscribe from streams using the stored callbacks and correct mode.
            const tickerCallback = (botInstance as any)._tickerCallback;
            const klineCallback = (botInstance as any)._klineCallback;

            if (tickerCallback) this.unsubscribeFromTickerUpdates(formattedPair, mode, tickerCallback);
            if (klineCallback) this.unsubscribeFromKlineUpdates(formattedPair, timeFrame, mode, klineCallback);

            botInstance.stop();
            this.publishBotsUpdate();
        }
    }

    deleteBot(botId: string) {
        const botInstance = this.bots.get(botId);
        if (botInstance && botInstance.bot.status === BotStatus.Stopped) {
            this.bots.delete(botId);
            this.publishBotsUpdate();
        }
    }

    pauseBot(botId: string) {
        this.bots.get(botId)?.pause();
    }
    
    resumeBot(botId: string) {
        this.bots.get(botId)?.resume();
    }

    stopAllBots() {
        this.bots.forEach(bot => bot.stop());
        this.wsConnections.forEach(ws => ws?.close());
    }

    // --- State & Data Propagation ---

    getBot(botId: string): RunningBot | undefined {
        return this.bots.get(botId)?.bot;
    }
    
    updateKlines(pair: string, timeFrame: string, klines: Kline[]) {
        this.klineHistory.set(`${pair}-${timeFrame}`, klines);
        this.bots.forEach(bot => {
            if (bot.bot.config.pair === pair && bot.bot.config.timeFrame === timeFrame) {
                bot.klines = klines;
                bot.bot.klinesLoaded = klines.length;
                bot.addLog(`${klines.length} klines loaded from main chart component.`, LogType.Info);
            }
        });
    }

    addBotLog(botId: string, message: string, type: LogType) {
        this.bots.get(botId)?.addLog(message, type);
    }
    
    updateBotState(botId: string, state: Partial<RunningBot>) {
        const bot = this.bots.get(botId);
        if (bot) {
            bot.updateState(state);
        }
    }

    updateBotConfig(botId: string, partialConfig: Partial<BotConfig>) {
        const bot = this.bots.get(botId);
        if (bot) {
            bot.updateTradeParams(partialConfig);
        }
    }

    notifyTradeExecutionFailed(botId: string, reason: string) {
        this.bots.get(botId)?.onExecutionFailed(reason);
    }
    
    notifyPositionClosed(botId: string, pnl: number) {
        this.bots.get(botId)?.onPositionClosed(pnl);
    }

    notifyPartialPositionClosed(botId: string, realizedPnl: number, closedSize: number, tpIndex: number) {
        this.bots.get(botId)?.onPartialPositionClosed(realizedPnl, closedSize, tpIndex);
    }

    private publishBotsUpdate() {
        const allBots = Array.from(this.bots.values()).map(instance => instance.bot);
        this.onBotsUpdate(allBots);
    }
}

// Global handler for bot logic, which will be updated by the main App component.
// This avoids passing handlers through multiple layers of components.
const globalBotHandlers: React.RefObject<BotHandlers | null> = { current: null };

// Modified executeTrade function
const handleExecuteTrade = async (
    botId: string,
    execSignal: TradeSignal & { partialTps?: any[], trailStartPrice?: number }
) => {
    const botInstance = botManagerService['bots'].get(botId);
    if (!botInstance || !globalBotHandlers.current) return;

    // ... (existing logic to determine finalEntryPrice, tradeSize, etc.)
    const { config } = botInstance.bot;
    const { finalEntryPrice, tradeSize, finalStopLossPrice, finalTakeProfitPrice, orderResponse, finalLiquidationPrice } = ({} as any); // Placeholder for brevity
    
    const newPosition: Position = {
        id: Date.now(),
        pair: config.pair,
        mode: config.mode,
        marginType: config.marginType,
        executionMode: config.executionMode,
        direction: execSignal.signal === 'BUY' ? 'LONG' : 'SHORT',
        entryPrice: finalEntryPrice,
        size: tradeSize,
        leverage: config.mode === TradingMode.USDSM_Futures ? config.leverage : 1,
        entryTime: new Date(),
        entryReason: execSignal.reasons.join('\n'),
        agentName: config.agent.name,
        takeProfitPrice: finalTakeProfitPrice,
        stopLossPrice: finalStopLossPrice,
        pricePrecision: config.pricePrecision,
        timeFrame: config.timeFrame,
        botId,
        orderId: orderResponse?.orderId ?? null,
        liquidationPrice: finalLiquidationPrice,
        initialSize: tradeSize,
        partialTps: execSignal.partialTps,
        trailStartPrice: execSignal.trailStartPrice,
    };

    // --- Minimum Profit Enforcement ---
    const minProfitTarget = 1.5;
    if (newPosition.size > 0 && !newPosition.partialTps) {
        const calculatedProfit = Math.abs(newPosition.takeProfitPrice - newPosition.entryPrice) * newPosition.size;
        if (calculatedProfit < minProfitTarget) {
            const requiredPriceChange = minProfitTarget / newPosition.size;
            const newTp = (newPosition.direction === 'LONG') 
                ? newPosition.entryPrice + requiredPriceChange 
                : newPosition.entryPrice - requiredPriceChange;
            
            const isImprovement = (newPosition.direction === 'LONG' && newTp > newPosition.takeProfitPrice) || 
                                  (newPosition.direction === 'SHORT' && newTp < newPosition.takeProfitPrice);

            if (isImprovement) {
                const oldTp = newPosition.takeProfitPrice;
                newPosition.takeProfitPrice = newTp;
                botInstance.addLog(`ADJUSTMENT: Initial TP ($${oldTp.toFixed(config.pricePrecision)}) yielded less than $${minProfitTarget.toFixed(2)}. Adjusting TP to ${newPosition.takeProfitPrice.toFixed(config.pricePrecision)} to meet minimum profit target.`, LogType.Info);
            }
        }
    }
    
    botInstance.updateState({
        status: BotStatus.PositionOpen,
        openPositionId: newPosition.id,
        openPosition: newPosition,
    });
};


export const botManagerService = new BotManager();
