import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ChartComponent } from './components/ChartComponent';
import { TradingLog } from './components/TradingLog';
import { RunningBots } from './components/RunningBots';
import { TradingMode, Position, Trade, Kline, SymbolInfo, LiveTicker, AccountInfo, RunningBot, BotConfig, BotStatus, BinanceOrderResponse, BacktestResult, LogType, MarketDataContext, TradeSignal } from './types';
import * as constants from './constants';
import * as binanceService from './services/binanceService';
import { historyService } from './services/historyService';
import { botManagerService, BotHandlers } from './services/botManagerService';
import * as localAgentService from './services/localAgentService';
import { telegramBotService } from './services/telegramBotService';
import { BacktestingPanel } from './components/BacktestingPanel';
import { PreferencesPanel } from './components/PreferencesPanel';
import { TradingConfigProvider, useTradingConfigState, useTradingConfigActions } from './contexts/TradingConfigContext';

const AppContent: React.FC = () => {
    // ---- State Management ----
    // UI State
    const [isInitialized, setIsInitialized] = useState(false);
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
    });
    const [activeView, setActiveView] = useState<'trading' | 'backtesting' | 'preferences'>('trading');
    
    // Trading Configuration (from context)
    const configState = useTradingConfigState();
    const configActions = useTradingConfigActions();
    const { 
        executionMode, tradingMode, selectedPairs, chartTimeFrame, 
        selectedAgent, investmentAmount, isApiConnected,
        agentParams, maxMarginLossPercent,
        leverage, marginType, isHtfConfirmationEnabled, htfTimeFrame, isUniversalProfitTrailEnabled,
        isMinRrEnabled, invalidationSensitivity, htfAgentParams,
        entryTiming,
        isAgentTrailEnabled, isBreakevenTrailEnabled, isMarketCohesionEnabled, isVwapConfirmationEnabled,
        isBtcConfirmationEnabled, btcConfirmationThreshold, isVolumeFilterEnabled, isAdxFilterEnabled,
        isExhaustionFilterEnabled, isAdaptiveTpEnabled, aggressiveTrailMode, isInitialRiskVetoEnabled,
        isSmcVetoEnabled, isSrAnalysisEnabled, isCandlestickConfirmationEnabled, isMarketStructureVetoEnabled,
        isMarketBreadthFilterEnabled, isLiquidationFilterEnabled, isConfirmationCandleEnabled, isMomentumConcordanceEnabled
    } = configState;

    const {
        setSelectedPairs, setIsApiConnected, setAvailableBalance
    } = configActions;

    const displayPair = useMemo(() => selectedPairs[0] || constants.TRADING_PAIRS[0], [selectedPairs]);
    
    // Backtesting State
    const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
    
    // Bot State
    const [runningBots, setRunningBots] = useState<RunningBot[]>([]);

    // Trade History
    const [tradeHistory, setTradeHistory] = useState<Trade[]>([]);

    // Market Data
    const [klines, setKlines] = useState<Kline[]>([]);
    const [isChartLoading, setIsChartLoading] = useState(true);
    const [isFetchingMoreChartData, setIsFetchingMoreChartData] = useState(false);
    const [livePrice, setLivePrice] = useState(0);
    const [liveTicker, setLiveTicker] = useState<LiveTicker | undefined>();
    const [symbolInfo, setSymbolInfo] = useState<SymbolInfo | undefined>();
    const [fundingInfo, setFundingInfo] = useState<{ rate: string; time: number } | null>(null);
    const pricePrecision = binanceService.getPricePrecision(symbolInfo);
    
    // Wallet & Positions Data
    const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
    const [isWalletLoading, setIsWalletLoading] = useState(false);
    const [walletError, setWalletError] = useState<string | null>(null);
    const [closingPositionIds, setClosingPositionIds] = useState<Set<number>>(new Set());
    
    const [currentFeeRate, setCurrentFeeRate] = useState(constants.TAKER_FEE_RATE);

    const handlersRef = useRef<BotHandlers | null>(null);

    const botsToCreate = useMemo(() => {
        if (selectedPairs.length === 0) return [];
        if (executionMode === 'paper') return selectedPairs;

        return selectedPairs.filter(pair =>
            !runningBots.some(bot =>
                bot.config.executionMode === 'live' &&
                bot.config.pair === pair &&
                bot.config.agent.id === selectedAgent.id &&
                bot.config.timeFrame === chartTimeFrame &&
                bot.status !== BotStatus.Stopped &&
                bot.status !== BotStatus.Error
            )
        );
    }, [selectedPairs, runningBots, executionMode, selectedAgent, chartTimeFrame]);

    const handleStartBot = useCallback(() => {
        if (botsToCreate.length === 0) return;

        botsToCreate.forEach(async pair => {
            try {
                const formattedPair = pair.replace('/', '');
                
                const symbolInfoForBot = tradingMode === TradingMode.USDSM_Futures
                    ? await binanceService.getFuturesSymbolInfo(formattedPair)
                    : await binanceService.getSymbolInfo(formattedPair);

                if (!symbolInfoForBot) {
                    console.error(`Could not fetch symbol info for ${pair}. Cannot start bot.`);
                    return;
                }
                
                const pricePrecisionForBot = binanceService.getPricePrecision(symbolInfoForBot);
                const quantityPrecisionForBot = binanceService.getQuantityPrecision(symbolInfoForBot);
                const stepSizeForBot = binanceService.getStepSize(symbolInfoForBot);

                const botConfig: BotConfig = {
                    pair: pair,
                    mode: tradingMode,
                    executionMode,
                    leverage,
                    marginType,
                    agent: selectedAgent,
                    timeFrame: chartTimeFrame,
                    investmentAmount,
                    maxMarginLossPercent,
                    isInitialRiskVetoEnabled,
                    isHtfConfirmationEnabled,
                    htfTimeFrame,
                    isUniversalProfitTrailEnabled,
                    isMinRrEnabled,
                    invalidationSensitivity,
                    isAgentTrailEnabled,
                    isBreakevenTrailEnabled,
                    isMarketCohesionEnabled,
                    isVwapConfirmationEnabled,
                    isBtcConfirmationEnabled,
                    btcConfirmationThreshold,
                    isVolumeFilterEnabled,
                    isAdxFilterEnabled,
                    isExhaustionFilterEnabled,
                    isSmcVetoEnabled,
                    isSrAnalysisEnabled,
                    isCandlestickConfirmationEnabled,
                    isMarketStructureVetoEnabled,
                    isAdaptiveTpEnabled,
                    aggressiveTrailMode,
                    agentParams,
                    htfAgentParams,
                    pricePrecision: pricePrecisionForBot,
                    quantityPrecision: quantityPrecisionForBot,
                    stepSize: stepSizeForBot,
                    takerFeeRate: currentFeeRate,
                    entryTiming,
                    isMarketBreadthFilterEnabled,
                    isLiquidationFilterEnabled,
                    isConfirmationCandleEnabled,
                    isMomentumConcordanceEnabled,
                    finalEntryFailSafe: executionMode === 'live' ? 'fail-closed' : 'fail-open',
                };

                botManagerService.startBot(botConfig);
            } catch (error) {
                console.error(`Failed to start bot for ${pair}:`, error);
            }
        });

    }, [
        botsToCreate, tradingMode, executionMode, leverage, marginType,
        selectedAgent, chartTimeFrame, investmentAmount, maxMarginLossPercent, isInitialRiskVetoEnabled,
        isHtfConfirmationEnabled, htfTimeFrame, agentParams, htfAgentParams,
        isUniversalProfitTrailEnabled, isMinRrEnabled, invalidationSensitivity,
        currentFeeRate, entryTiming,
        isAgentTrailEnabled, isBreakevenTrailEnabled, isMarketCohesionEnabled, isVwapConfirmationEnabled,
        isBtcConfirmationEnabled, btcConfirmationThreshold, isVolumeFilterEnabled, isAdxFilterEnabled,
        isExhaustionFilterEnabled, isSmcVetoEnabled, isSrAnalysisEnabled, isCandlestickConfirmationEnabled, 
        isMarketStructureVetoEnabled, isAdaptiveTpEnabled, aggressiveTrailMode, isMarketBreadthFilterEnabled,
        isLiquidationFilterEnabled, isConfirmationCandleEnabled, isMomentumConcordanceEnabled,
    ]);

    const handleClosePosition = useCallback(async (posToClose: Position, exitReason: string = "Manual Close", exitPriceOverride?: number) => {
        if (!posToClose || closingPositionIds.has(posToClose.id)) {
            return;
        }
        setClosingPositionIds(prev => new Set(prev).add(posToClose.id));

        const exitPrice = exitPriceOverride ?? botManagerService.getBot(posToClose.botId!)?.bot.livePrice ?? 0;
        if (exitPrice === 0 && posToClose.executionMode !== 'live') {
            console.error("Could not determine exit price for paper trade", posToClose.id);
            setClosingPositionIds(prev => { const newSet = new Set(prev); newSet.delete(posToClose.id); return newSet; });
            return;
        }

        const closePositionInState = async (finalExitPrice: number, fees: number = 0) => {
            const isLong = posToClose.direction === 'LONG';
            const grossPnl = (finalExitPrice - posToClose.entryPrice) * posToClose.size * (isLong ? 1 : -1);
            
            const netPnl = grossPnl - fees;

            const mfePrice = posToClose.peakPrice ?? posToClose.entryPrice;
            const maePrice = posToClose.troughPrice ?? posToClose.entryPrice;
            const mfe = Math.abs(mfePrice - posToClose.entryPrice) * posToClose.size;
            const mae = Math.abs(maePrice - posToClose.entryPrice) * posToClose.size;
            
            const bot = botManagerService.getBot(posToClose.botId!);
            const botKlines = bot ? bot.klines : [];

            let htfKlines: Kline[] | undefined;
            if (posToClose.botConfigSnapshot?.isHtfConfirmationEnabled) {
                const htf = posToClose.botConfigSnapshot.htfTimeFrame === 'auto'
                    ? constants.getHigherTimeframe(posToClose.timeFrame)
                    : posToClose.botConfigSnapshot.htfTimeFrame;
                if(htf) {
                    htfKlines = await binanceService.fetchKlines(posToClose.pair.replace('/',''), htf, { limit: 205, mode: posToClose.mode });
                }
            }
            const exitContext = localAgentService.captureMarketContext(botKlines, htfKlines);

            const newTrade: Trade = { 
                ...posToClose, 
                exitPrice: finalExitPrice, 
                exitTime: new Date().toISOString(), 
                pnl: netPnl, 
                exitReason,
                mfe,
                mae,
                exitContext,
            };
            
            setTradeHistory(prevHistory => {
                if (prevHistory.some(t => t.id === newTrade.id)) return prevHistory;
                const updatedHistory = historyService.saveTrade(newTrade);
                return updatedHistory;
            });

            if (posToClose.botId) {
                botManagerService.notifyPositionClosed(posToClose.botId, netPnl);
            }
            
            const botForChatId = botManagerService.getBot(newTrade.botId!);
            const chatId = botForChatId?.bot.config.telegramChatId;
            if (posToClose.executionMode === 'live' && chatId) {
                const isProfit = newTrade.pnl >= 0;
                const pnlEmoji = isProfit ? '✅' : '❌';
                const message = `
*🔒 LIVE TRADE CLOSED*
${pnlEmoji} *${newTrade.direction} ${newTrade.pair}*
*Agent:* ${newTrade.agentName}
*Entry Price:* ${newTrade.entryPrice.toFixed(newTrade.pricePrecision)}
*Exit Price:* ${newTrade.exitPrice.toFixed(newTrade.pricePrecision)}
*Net PNL:* $${newTrade.pnl.toFixed(2)} (${isProfit ? 'Profit' : 'Loss'})
*Exit Reason:* ${newTrade.exitReason}
                `;
                telegramBotService.sendMessage(message, chatId);
            }

            setClosingPositionIds(prev => { const newSet = new Set(prev); newSet.delete(posToClose.id); return newSet; });
        }

        if (posToClose.executionMode === 'live') {
            botManagerService.addBotLog(posToClose.botId!, `Attempting to close live position for ${posToClose.pair}...`, LogType.Info);
            try {
                const formattedPair = posToClose.pair.replace('/', '');
                
                const liveSymbolInfo = posToClose.mode === TradingMode.USDSM_Futures 
                    ? await binanceService.getFuturesSymbolInfo(formattedPair) 
                    : await binanceService.getSymbolInfo(formattedPair);

                if (!liveSymbolInfo) throw new Error(`Could not fetch symbol info for ${formattedPair} to close position.`);

                const quantityPrecision = binanceService.getQuantityPrecision(liveSymbolInfo);
                const closingSide = posToClose.direction === 'LONG' ? 'SELL' : 'BUY';
                
                const quantity = parseFloat(posToClose.size.toFixed(quantityPrecision));

                if (quantity <= 0) {
                     throw { code: -4003, msg: "Calculated closing quantity is zero or less. Cannot close position." };
                }

                let orderResponse: BinanceOrderResponse;
                switch(posToClose.mode) {
                    case TradingMode.Spot:
                        orderResponse = await binanceService.createSpotOrder(posToClose.pair, closingSide, quantity);
                        break;
                    case TradingMode.USDSM_Futures:
                        orderResponse = await binanceService.createFuturesOrder(posToClose.pair, closingSide, quantity, true);
                        break;
                    default:
                        throw new Error(`Unsupported trading mode for closing position: ${posToClose.mode}`);
                }
                
                 const executedQuantity = parseFloat(orderResponse.executedQty);
                 if (Math.abs(executedQuantity - quantity) > 1e-9) {
                     throw new Error(`Position closure failed: Order only partially filled. Requested ${quantity}, but executed ${executedQuantity}. Please resolve manually on the exchange.`);
                 }

                 botManagerService.addBotLog(posToClose.botId!, `Live position closed successfully via API.`, LogType.Success);
                 const finalExitPrice = parseFloat(orderResponse.cummulativeQuoteQty) / executedQuantity;
                 
                 const entryValue = posToClose.entryPrice * posToClose.size;
                 const exitValue = finalExitPrice * posToClose.size;
                 const feeRate = posToClose.takerFeeRate || constants.TAKER_FEE_RATE;
                 const totalFees = (entryValue + exitValue) * feeRate;

                 await closePositionInState(finalExitPrice, totalFees);

            } catch(e) {
                const errorMessage = binanceService.interpretBinanceError(e);
                console.error("CRITICAL: Failed to close live position on Binance:", e);
                const criticalMessage = `CRITICAL: Failed to close live position for ${posToClose.pair}. Please close manually on Binance to prevent loss. Reason: ${errorMessage}`;
                botManagerService.addBotLog(posToClose.botId!, criticalMessage, LogType.Error);
                botManagerService.updateBotState(posToClose.botId!, { status: BotStatus.Error, analysis: {signal: 'HOLD', reasons: [criticalMessage]}});
                
                const botForChatId = botManagerService.getBot(posToClose.botId!);
                const chatId = botForChatId?.bot.config.telegramChatId;
                if(chatId) {
                    telegramBotService.sendMessage(
`🚨 *CRITICAL ALERT: FAILED TO CLOSE LIVE POSITION* 🚨

*Action Required!* Please manually close the following position on Binance immediately:

*Pair:* ${posToClose.pair}
*Direction:* ${posToClose.direction}
*Entry Price:* ${posToClose.entryPrice.toFixed(posToClose.pricePrecision)}
*Size:* ${posToClose.size}

*Reason for Failure:* ${errorMessage}`,
                    chatId
                    );
                }

                setClosingPositionIds(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(posToClose.id);
                    return newSet;
                });
            }
        } else {
            const entryValue = posToClose.entryPrice * posToClose.size;
            const exitValue = exitPrice * posToClose.size;
            const feeRate = posToClose.takerFeeRate || constants.TAKER_FEE_RATE;
            const simulatedFees = (entryValue + exitValue) * feeRate;
            await closePositionInState(exitPrice, simulatedFees);
        }
    }, [closingPositionIds]);

    const handleExecuteTrade = useCallback(async (
        execSignal: TradeSignal,
        botId: string,
        executionDetails: {
            agentStopLoss: number,
            slReason: 'Agent Logic' | 'Hard Cap',
            entryContext: MarketDataContext,
        }
    ) => {
        const bot = botManagerService.getBot(botId);
        if (!bot) {
            console.error(`handleExecuteTrade called for non-existent bot ID: ${botId}`);
            return;
        }

        if (execSignal.signal === 'HOLD') {
            botManagerService.notifyTradeExecutionFailed(botId, "Trade execution requested for a 'HOLD' signal.");
            return;
        }
        
        const { config } = bot.bot;
        const { stopLossPrice, takeProfitPrice } = execSignal;
        if (stopLossPrice === undefined || takeProfitPrice === undefined) {
             botManagerService.notifyTradeExecutionFailed(botId, "Bot did not provide required SL/TP targets.");
             return;
        }

        let orderResponse: BinanceOrderResponse | null = null;
        let tradeSize: number;
        let finalEntryPrice: number;
        let finalLiquidationPrice: number | undefined = undefined;

        // Calculate trade size first to perform risk checks before placing live orders.
        const tempEntryPrice = execSignal.entryPrice || 0;
        if (tempEntryPrice === 0) {
            botManagerService.notifyTradeExecutionFailed(botId, "No live price was provided by the bot for trade.");
            return;
        }
        const positionValue = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
        const preliminaryTradeSize = positionValue / tempEntryPrice;
        
        // --- Initial Risk Veto Logic ---
        if (config.isInitialRiskVetoEnabled) {
            const initialRiskInDollars = Math.abs(tempEntryPrice - executionDetails.agentStopLoss) * preliminaryTradeSize;
            const maxAllowedRiskInDollars = config.investmentAmount * (config.maxMarginLossPercent / 100);
            if (initialRiskInDollars > maxAllowedRiskInDollars) {
                const reason = `❌ VETO: Initial risk ($${initialRiskInDollars.toFixed(2)}) exceeds max allowed ($${maxAllowedRiskInDollars.toFixed(2)}).`;
                botManagerService.notifyTradeExecutionFailed(botId, reason);
                return;
            }
        }


        if (config.executionMode === 'live') {
            if (!accountInfo) {
                botManagerService.notifyTradeExecutionFailed(botId, "Live account information is not yet available.");
                return;
            }

            const modeToAccountType: Record<string, string> = { [TradingMode.Spot]: 'SPOT', [TradingMode.USDSM_Futures]: 'USDT_FUTURES' };
            if (accountInfo.accountType !== modeToAccountType[config.mode]) {
                botManagerService.notifyTradeExecutionFailed(botId, `Wallet mismatch. Bot needs ${config.mode}, but UI wallet is ${accountInfo.accountType}.`);
                return;
            }

            const quoteAsset = config.pair.split('/')[1];
            const balance = accountInfo.balances.find(b => b.asset === quoteAsset);
            const availableBalance = balance ? balance.free : 0;

            if (config.investmentAmount > availableBalance) {
                botManagerService.notifyTradeExecutionFailed(botId, `Insufficient funds. Required: ${config.investmentAmount.toFixed(2)}, Available: ${availableBalance.toFixed(2)}.`);
                return;
            }

            try {
                const entryPriceForOrder = execSignal.entryPrice;
                if (!entryPriceForOrder || entryPriceForOrder <= 0) {
                    throw new Error("Could not get live price for trade execution.");
                }

                const rawQuantity = config.mode === TradingMode.USDSM_Futures ? (config.investmentAmount * config.leverage) / entryPriceForOrder : config.investmentAmount / entryPriceForOrder;
                const tempQuantity = Math.floor(rawQuantity / config.stepSize) * config.stepSize;
                const quantity = parseFloat(tempQuantity.toFixed(config.quantityPrecision));

                if (quantity <= 0) throw new Error("Calculated quantity is too small to trade.");

                switch (config.mode) {
                    case TradingMode.Spot: orderResponse = await binanceService.createSpotOrder(config.pair, execSignal.signal, quantity); break;
                    case TradingMode.USDSM_Futures: orderResponse = await binanceService.createFuturesOrder(config.pair, execSignal.signal, quantity); break;
                    default: throw new Error(`Unsupported trading mode: ${config.mode}`);
                }
                
                tradeSize = parseFloat(orderResponse.executedQty);
                finalEntryPrice = (orderResponse.avgPrice && parseFloat(orderResponse.avgPrice) > 0) ? parseFloat(orderResponse.avgPrice) : parseFloat(orderResponse.cummulativeQuoteQty) / tradeSize;

                if (config.mode === TradingMode.USDSM_Futures) {
                    const positionRisk = await binanceService.getFuturesPositionRisk(config.pair.replace('/', ''));
                    if (positionRisk) finalLiquidationPrice = positionRisk.liquidationPrice;
                }
                
                botManagerService.addBotLog(botId, `Live order placed. ID: ${orderResponse?.orderId}. Avg Price: ${finalEntryPrice.toFixed(config.pricePrecision)}`, LogType.Success);
            } catch (e) {
                const errorMessage = binanceService.interpretBinanceError(e);
                botManagerService.notifyTradeExecutionFailed(botId, errorMessage);
                return;
            }
        } else {
            finalEntryPrice = tempEntryPrice;
            tradeSize = preliminaryTradeSize;
        }
        
        const risk = Math.abs(finalEntryPrice - executionDetails.agentStopLoss);
        const reward = Math.abs(takeProfitPrice - finalEntryPrice);
        const initialRiskRewardRatio = risk > 0 ? reward / risk : 0;

        const newPosition: Position = {
            id: Date.now(),
            pair: config.pair, mode: config.mode, marginType: config.marginType, executionMode: config.executionMode,
            direction: execSignal.signal === 'BUY' ? 'LONG' : 'SHORT',
            entryPrice: finalEntryPrice, size: tradeSize, investmentAmount: config.investmentAmount,
            leverage: config.mode === TradingMode.USDSM_Futures ? config.leverage : 1,
            entryTime: new Date().toISOString(), entryReason: execSignal.reasons.join('\n'), agentName: config.agent.name,
            takeProfitPrice, stopLossPrice, initialTakeProfitPrice: takeProfitPrice, initialStopLossPrice: executionDetails.agentStopLoss,
            initialRiskInPrice: Math.abs(finalEntryPrice - executionDetails.agentStopLoss),
            initialStopLossReason: executionDetails.slReason, activeStopLossReason: executionDetails.slReason,
            pricePrecision: config.pricePrecision, timeFrame: config.timeFrame, botId, orderId: orderResponse?.orderId ?? null,
            liquidationPrice: finalLiquidationPrice, isBreakevenSet: false, proactiveLossCheckTriggered: false,
            profitLockTier: 0, profitSpikeTier: 0, aggressiveTrailTier: 0,
            peakPrice: finalEntryPrice, troughPrice: finalEntryPrice, candlesSinceEntry: 0, hasBeenProfitable: false,
            takerFeeRate: config.takerFeeRate, initialRiskRewardRatio, agentParamsSnapshot: config.agentParams,
            adaptiveTpTriggered: false,
            botConfigSnapshot: {
                isHtfConfirmationEnabled: config.isHtfConfirmationEnabled,
                isUniversalProfitTrailEnabled: config.isUniversalProfitTrailEnabled,
                isMinRrEnabled: config.isMinRrEnabled,
                invalidationSensitivity: config.invalidationSensitivity,
                isAgentTrailEnabled: config.isAgentTrailEnabled,
                isBreakevenTrailEnabled: config.isBreakevenTrailEnabled,
                isMarketCohesionEnabled: config.isMarketCohesionEnabled,
                isVwapConfirmationEnabled: config.isVwapConfirmationEnabled,
                isBtcConfirmationEnabled: config.isBtcConfirmationEnabled,
                btcConfirmationThreshold: config.btcConfirmationThreshold,
                isVolumeFilterEnabled: config.isVolumeFilterEnabled,
                isAdxFilterEnabled: config.isAdxFilterEnabled,
                isExhaustionFilterEnabled: config.isExhaustionFilterEnabled,
                isSmcVetoEnabled: config.isSmcVetoEnabled,
                isSrAnalysisEnabled: config.isSrAnalysisEnabled,
                isCandlestickConfirmationEnabled: config.isCandlestickConfirmationEnabled,
                isMarketStructureVetoEnabled: config.isMarketStructureVetoEnabled,
                htfTimeFrame: config.htfTimeFrame,
                entryTiming: config.entryTiming,
                isAdaptiveTpEnabled: config.isAdaptiveTpEnabled,
                aggressiveTrailMode: config.aggressiveTrailMode,
                isInitialRiskVetoEnabled: config.isInitialRiskVetoEnabled,
                isMarketBreadthFilterEnabled: config.isMarketBreadthFilterEnabled,
                isLiquidationFilterEnabled: config.isLiquidationFilterEnabled,
                isConfirmationCandleEnabled: config.isConfirmationCandleEnabled,
                isMomentumConcordanceEnabled: config.isMomentumConcordanceEnabled,
                finalEntryFailSafe: config.finalEntryFailSafe,
            },
            entryContext: executionDetails.entryContext,
        };

        const chatId = config.telegramChatId;
        if (config.executionMode === 'live' && chatId) {
            const directionEmoji = newPosition.direction === 'LONG' ? '🟢' : '🔴';
            const message = `
*🚀 LIVE TRADE OPENED*
${directionEmoji} *${newPosition.direction} ${newPosition.pair}*
*Agent:* ${newPosition.agentName}
*Entry Price:* ${newPosition.entryPrice.toFixed(newPosition.pricePrecision)}
*Size:* ${newPosition.size.toFixed(4)}
*Leverage:* ${newPosition.leverage}x
*Stop Loss:* ${newPosition.stopLossPrice.toFixed(newPosition.pricePrecision)}
*Take Profit:* ${newPosition.takeProfitPrice.toFixed(newPosition.pricePrecision)}
            `;
            telegramBotService.sendMessage(message, chatId);
        }

        botManagerService.updateBotState(botId, {
            status: BotStatus.PositionOpen, openPositionId: newPosition.id, openPosition: newPosition,
        });

    }, [accountInfo]);
    
    useEffect(() => {
        const updateFeeRate = async () => {
            if (!isApiConnected) { setCurrentFeeRate(constants.TAKER_FEE_RATE); return; }
            if (tradingMode === TradingMode.Spot) {
                setCurrentFeeRate(accountInfo?.takerCommission ? accountInfo.takerCommission / 10000 : constants.TAKER_FEE_RATE);
            } else if (tradingMode === TradingMode.USDSM_Futures) {
                try {
                    const commissionInfo = await binanceService.fetchFuturesCommissionRate(displayPair);
                    setCurrentFeeRate(commissionInfo ? commissionInfo.takerCommissionRate : constants.TAKER_FEE_RATE);
                } catch (error) {
                    console.error("Failed to fetch futures commission rate, using default.", error);
                    setCurrentFeeRate(constants.TAKER_FEE_RATE);
                }
            }
        };
        updateFeeRate();
    }, [tradingMode, displayPair, isApiConnected, accountInfo]);

    useEffect(() => {
        handlersRef.current = { onExecuteTrade: handleExecuteTrade, onClosePosition: handleClosePosition };
    }, [handleExecuteTrade, handleClosePosition]);

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('light', 'dark'); root.classList.add(theme);
        localStorage.setItem('theme', theme);
    }, [theme]);
    
    useEffect(() => {
        const onBotUpdate = () => { setRunningBots(botManagerService.getRunningBots()); };
        const stableHandlers: BotHandlers = {
            onExecuteTrade: (...args) => handlersRef.current?.onExecuteTrade(...args) ?? Promise.resolve(),
            onClosePosition: (...args) => handlersRef.current?.onClosePosition(...args),
        };
        botManagerService.setHandlers(stableHandlers, onBotUpdate);
        binanceService.checkApiConnection().then(setIsApiConnected).catch(() => setIsApiConnected(false));
        setTradeHistory(historyService.loadTrades());
        setIsInitialized(true);
        telegramBotService.start();
        return () => botManagerService.stopAllBots();
    }, []);

    useEffect(() => {
        let isCancelled = false;
        const fetchAllData = async () => {
            setIsChartLoading(true);
            try {
                const formattedPair = displayPair.replace('/', '');
                const data = await binanceService.fetchKlines(formattedPair, chartTimeFrame, { limit: 500, mode: tradingMode });
                if (!isCancelled) {
                    setKlines(data);
                    if (data.length > 0) setLivePrice(data[data.length - 1].close);
                }
            } catch (err) { console.error("Failed to fetch klines:", err); if (!isCancelled) setKlines([]);
            } finally { if (!isCancelled) setIsChartLoading(false); }

            try {
                const formattedPair = displayPair.replace('/', '');
                const info = tradingMode === TradingMode.USDSM_Futures ? await binanceService.getFuturesSymbolInfo(formattedPair) : await binanceService.getSymbolInfo(formattedPair);
                if (!isCancelled) setSymbolInfo(info);
                if (tradingMode === TradingMode.USDSM_Futures) {
                    const funding = await binanceService.fetchFundingRate(formattedPair);
                    if (!isCancelled) setFundingInfo(funding ? { rate: funding.fundingRate, time: funding.fundingTime } : null);
                } else { if (!isCancelled) setFundingInfo(null); }
            } catch (err) {
                console.error("Failed to fetch symbol info:", err);
                 if (!isCancelled) { setSymbolInfo(undefined); setFundingInfo(null); }
            }
        };
        fetchAllData();

        const formattedPair = displayPair.replace('/', '');
        const tickerCallback = (data: any) => {
             const ticker: LiveTicker = { pair: data.s, closePrice: parseFloat(data.c), highPrice: parseFloat(data.h), lowPrice: parseFloat(data.l), volume: parseFloat(data.v), quoteVolume: parseFloat(data.q) };
             if (ticker.pair.toLowerCase() === formattedPair.toLowerCase()) { setLivePrice(ticker.closePrice); setLiveTicker(ticker); }
        };
        const klineCallback = (data: any) => {
             const newKline: Kline = { time: data.k.t, open: parseFloat(data.k.o), high: parseFloat(data.k.h), low: parseFloat(data.k.l), close: parseFloat(data.k.c), volume: parseFloat(data.k.v), isFinal: data.k.x };
             setKlines(prev => {
                const last = prev[prev.length - 1];
                if (last && newKline.time === last.time) { if (newKline.isFinal) { const newKlines = [...prev]; newKlines[newKlines.length - 1] = newKline; return newKlines; } return prev;
                } else if (!last || newKline.time > last.time) { return [...prev, newKline]; }
                return prev;
            });
        };
        botManagerService.subscribeToTickerUpdates(formattedPair, tradingMode, tickerCallback);
        botManagerService.subscribeToKlineUpdates(formattedPair, chartTimeFrame, tradingMode, klineCallback);

        return () => { 
            isCancelled = true;
            botManagerService.unsubscribeFromTickerUpdates(formattedPair, tradingMode, tickerCallback);
            botManagerService.unsubscribeFromKlineUpdates(formattedPair, chartTimeFrame, tradingMode, klineCallback);
        };
    }, [displayPair, chartTimeFrame, tradingMode]);

    useEffect(() => {
        if (executionMode === 'live' && isApiConnected && configState.walletViewMode) {
            setIsWalletLoading(true);
            setWalletError(null);
            const fetchWallet = configState.walletViewMode === TradingMode.Spot ? binanceService.fetchSpotWalletBalance : binanceService.fetchFuturesWalletBalance;
            fetchWallet()
                .then(info => {
                    setAccountInfo(info);
                    const quoteAsset = displayPair.split('/')[1];
                    const balance = info.balances.find(b => b.asset === quoteAsset);
                    setAvailableBalance(balance ? balance.free : 0);
                })
                .catch(err => {
                    console.error("Failed to fetch wallet:", err);
                    setWalletError(err.message || 'Could not connect to wallet.');
                })
                .finally(() => setIsWalletLoading(false));
        } else if (executionMode === 'paper') {
            setAccountInfo(null);
            setWalletError(null);
            const paperWallet = configState.walletViewMode === TradingMode.Spot ? constants.MOCK_PAPER_SPOT_WALLET : constants.MOCK_PAPER_FUTURES_WALLET;
            const quoteAsset = displayPair.split('/')[1];
            const balance = paperWallet.find(b => b.asset === quoteAsset);
            setAvailableBalance(balance ? balance.free : 10000);
        }
    }, [executionMode, isApiConnected, configState.walletViewMode, displayPair]);

    const handleLoadMoreData = useCallback(async () => {
        if (isFetchingMoreChartData || klines.length === 0) return;
        setIsFetchingMoreChartData(true);
        try {
            const firstKlineTime = klines[0].time;
            const formattedPair = displayPair.replace('/', '');
            const moreData = await binanceService.fetchKlines(formattedPair, chartTimeFrame, { endTime: firstKlineTime - 1, limit: 200, mode: tradingMode });
            if (moreData.length > 0) setKlines(prev => [...moreData, ...prev]);
        } catch (error) { console.error("Failed to load more chart data:", error);
        } finally { setIsFetchingMoreChartData(false); }
    }, [isFetchingMoreChartData, klines, displayPair, chartTimeFrame, tradingMode]);

    if (!isInitialized) {
        return <div className="flex items-center justify-center h-screen bg-slate-900 text-white"><div className="text-lg font-semibold">Initializing Trading Assistant...</div></div>;
    }
    
    return (
        <div className={`min-h-screen font-sans bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-50 ${theme}`}>
            <Header isApiConnected={isApiConnected} executionMode={executionMode} theme={theme} setTheme={setTheme} activeView={activeView} setActiveView={setActiveView} />
            <main className="container mx-auto p-3 lg:p-4">
              {activeView === 'trading' ? (
                 <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  <div className="col-span-12 lg:col-span-3 order-last lg:order-first">
                    <Sidebar
                        onStartBot={handleStartBot} klines={klines} livePrice={livePrice}
                        botsToCreateCount={botsToCreate.length} selectedPairsCount={selectedPairs.length}
                        theme={theme} isApiConnected={isApiConnected} pricePrecision={pricePrecision}
                        accountInfo={accountInfo} isWalletLoading={isWalletLoading} walletError={walletError}
                    />
                  </div>
                  <div className="col-span-12 lg:col-span-9 flex flex-col gap-4">
                    <ChartComponent
                        data={klines} pair={displayPair} allPairs={configState.allPairs}
                        onPairChange={(newPair) => setSelectedPairs([newPair])}
                        isLoading={isChartLoading} pricePrecision={pricePrecision} livePrice={livePrice}
                        liveTicker={liveTicker} chartTimeFrame={chartTimeFrame} onTimeFrameChange={configActions.setTimeFrame}
                        onLoadMoreData={handleLoadMoreData} isFetchingMoreData={isFetchingMoreChartData}
                        theme={theme} fundingInfo={fundingInfo}
                    />
                    <RunningBots
                      bots={runningBots} onClosePosition={handleClosePosition}
                      onPauseBot={botManagerService.pauseBot} onResumeBot={botManagerService.resumeBot}
                      onStopBot={botManagerService.stopBot} onDeleteBot={botManagerService.deleteBot}
                      onUpdateBotConfig={botManagerService.updateBotConfig} onRefreshBotAnalysis={botManagerService.refreshBotAnalysis}
                    />
                    <TradingLog tradeHistory={tradeHistory} setTradeHistory={setTradeHistory} theme={theme} />
                  </div>
                </div>
              ) : activeView === 'backtesting' ? (
                <BacktestingPanel
                  backtestResult={backtestResult} setBacktestResult={setBacktestResult}
                  setActiveView={setActiveView} klines={klines} theme={theme}
                />
              ) : (
                <PreferencesPanel theme={theme} />
              )}
            </main>
        </div>
    );
};

const App: React.FC = () => (
    <TradingConfigProvider>
        <AppContent />
    </TradingConfigProvider>
);

export default App;
