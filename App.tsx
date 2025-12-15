
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

interface BinanceKlineStreamData {
    k: {
        t: number;    // Kline start time
        o: string;    // Open price
        h: string;    // High price
        l: string;    // Low price
        c: string;    // Close price
        v: string;    // Base asset volume
        x: boolean;   // Is this kline closed?
    };
}

const parseToFloat = (value: string, fallback: number = 0): number => {
    const num = parseFloat(value);
    return isNaN(num) ? fallback : num;
};

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
        isBtcConfirmationEnabled, isBtcCorrelationVetoEnabled, btcConfirmationThreshold, isVolumeFilterEnabled, isAdxFilterEnabled,
        isExhaustionFilterEnabled, isAdaptiveTpEnabled, aggressiveTrailMode, isInitialRiskVetoEnabled,
        isSmcVetoEnabled, isSrAnalysisEnabled, isCandlestickConfirmationEnabled, isMarketStructureVetoEnabled,
        isSupertrendConfirmationEnabled,
        isMarketBreadthFilterEnabled, isLiquidationFilterEnabled, isConfirmationCandleEnabled, isMomentumConcordanceEnabled,
        isTradeGuardianEnabled,
        isHeikinAshiEnabled
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
    const [symbolInfo, setSymbolInfo] = useState<SymbolInfo | undefined>();
    const [fundingInfo, setFundingInfo] = useState<{ rate: string; time: number } | null>(null);
    const pricePrecision = binanceService.getPricePrecision(symbolInfo);
    
    // Wallet & Positions Data
    const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
    const [isWalletLoading, setIsWalletLoading] = useState(false);
    const [walletError, setWalletError] = useState<string | null>(null);
    const [closingPositionIds, setClosingPositionIds] = useState<Set<number>>(new Set());
    
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
                    isBtcCorrelationVetoEnabled,
                    btcConfirmationThreshold,
                    isVolumeFilterEnabled,
                    isAdxFilterEnabled,
                    isExhaustionFilterEnabled,
                    isSmcVetoEnabled,
                    isSrAnalysisEnabled,
                    isCandlestickConfirmationEnabled,
                    isMarketStructureVetoEnabled,
                    isSupertrendConfirmationEnabled,
                    isAdaptiveTpEnabled,
                    aggressiveTrailMode,
                    agentParams,
                    htfAgentParams,
                    pricePrecision: pricePrecisionForBot,
                    quantityPrecision: quantityPrecisionForBot,
                    stepSize: stepSizeForBot,
                    takerFeeRate: constants.TAKER_FEE_RATE,
                    entryTiming,
                    isMarketBreadthFilterEnabled,
                    isLiquidationFilterEnabled,
                    isConfirmationCandleEnabled,
                    isMomentumConcordanceEnabled,
                    isTradeGuardianEnabled,
                    finalEntryFailSafe: executionMode === 'live' ? 'fail-closed' : 'fail-open',
                    isHeikinAshiEnabled,
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
        entryTiming,
        isAgentTrailEnabled, isBreakevenTrailEnabled, isMarketCohesionEnabled, isVwapConfirmationEnabled,
        isBtcConfirmationEnabled, isBtcCorrelationVetoEnabled, btcConfirmationThreshold, isVolumeFilterEnabled, isAdxFilterEnabled,
        isExhaustionFilterEnabled, isSmcVetoEnabled, isSrAnalysisEnabled, isCandlestickConfirmationEnabled, 
        isMarketStructureVetoEnabled, isSupertrendConfirmationEnabled, isAdaptiveTpEnabled, aggressiveTrailMode, isMarketBreadthFilterEnabled,
        isLiquidationFilterEnabled, isConfirmationCandleEnabled, isMomentumConcordanceEnabled, isTradeGuardianEnabled, isHeikinAshiEnabled,
    ]);

    const handleClosePosition = useCallback(async (posToClose: Position, exitReason: string = "Manual Close", exitPriceOverride?: number) => {
        if (!posToClose || closingPositionIds.has(posToClose.id)) {
            return;
        }
        setClosingPositionIds(prev => new Set(prev).add(posToClose.id));
    
        let exitPrice = exitPriceOverride;
    
        if (!exitPrice || exitPrice <= 0) {
            const bot = botManagerService.getBot(posToClose.botId!);
            if (bot) {
                if (bot.bot.livePrice && bot.bot.livePrice > 0) {
                    exitPrice = bot.bot.livePrice;
                } 
                else if (bot.klines.length > 0) {
                    exitPrice = bot.klines[bot.klines.length - 1].close;
                    botManagerService.addBotLog(posToClose.botId!, `Used last kline close for exit price: ${exitPrice}`, LogType.Info);
                }
            }
        }
        
        if ((!exitPrice || exitPrice <= 0) && posToClose.executionMode === 'paper') {
            if (exitPriceOverride && exitPriceOverride <= 0) {
                 botManagerService.addBotLog(posToClose.botId!, `CRITICAL: Invalid exit price override (${exitPriceOverride}) for paper trade ${posToClose.id}. Cannot close.`, LogType.Error);
                 setClosingPositionIds(prev => { const newSet = new Set(prev); newSet.delete(posToClose.id); return newSet; });
                 return;
            }
            exitPrice = posToClose.entryPrice;
            botManagerService.addBotLog(posToClose.botId!, `WARNING: Could not determine live market price for paper trade closure. Using entry price ${exitPrice} as failsafe.`, LogType.Error);
        }
    
        const closePositionInState = async (finalExitPrice: number, fees: number = 0) => {
            const isLong = posToClose.direction === 'LONG';
            const grossPnl = (finalExitPrice - posToClose.entryPrice) * posToClose.size * (isLong ? 1 : -1);
            
            const netPnl = grossPnl - fees;
    
            const finalPeakPrice = isLong
                ? Math.max(posToClose.peakPrice, finalExitPrice)
                : Math.min(posToClose.peakPrice, finalExitPrice);
            
            const finalTroughPrice = isLong
                ? Math.min(posToClose.troughPrice, finalExitPrice)
                : Math.max(posToClose.troughPrice, finalExitPrice);

            const mfe = (isLong ? (finalPeakPrice - posToClose.entryPrice) : (posToClose.entryPrice - finalPeakPrice)) * posToClose.size;
            const mae = (isLong ? (posToClose.entryPrice - finalTroughPrice) : (finalTroughPrice - posToClose.entryPrice)) * posToClose.size;
            
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
                exitTime: new Date(binanceService.getSyncedNow()).toISOString(),
                pnl: netPnl, 
                exitReason,
                mfe,
                mae,
                exitContext,
                hasBeenProfitable: netPnl > 0,
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
                const closingSide = posToClose.direction === 'LONG' ? 'SELL' : 'BUY';
                
                let orderResponse: BinanceOrderResponse;
                
                switch(posToClose.mode) {
                    case TradingMode.Spot:
                        {
                            const baseAsset = posToClose.pair.split('/')[0];
                            const accountInfo = await binanceService.fetchSpotWalletBalance();
                            const assetBalance = accountInfo.balances.find(b => b.asset === baseAsset);
                            const liveQuantity = assetBalance ? assetBalance.free : 0;
                            const feeRate = posToClose.takerFeeRate || constants.TAKER_FEE_RATE;

                            if (liveQuantity <= 0) {
                                botManagerService.addBotLog(posToClose.botId!, `State Desync: Spot balance for ${baseAsset} is zero. Reconciling state.`, LogType.Info);
                                const estimatedFees = (posToClose.entryPrice * posToClose.size + (exitPrice || posToClose.entryPrice) * posToClose.size) * feeRate;
                                await closePositionInState(exitPrice || posToClose.entryPrice, estimatedFees);
                                return;
                            }

                            const liveSymbolInfo = await binanceService.getSymbolInfo(formattedPair);
                            if (!liveSymbolInfo) throw new Error(`Could not fetch symbol info for ${formattedPair} to close position.`);
                            const quantityPrecision = binanceService.getQuantityPrecision(liveSymbolInfo);
                            const stepSize = binanceService.getStepSize(liveSymbolInfo);
                            const quantityToSell = Math.floor(liveQuantity / stepSize) * stepSize;
                            const quantity = parseFloat(quantityToSell.toFixed(quantityPrecision));

                            if (quantity <= 0) throw { code: -4003, msg: `Calculated closing quantity for ${baseAsset} is zero or less. Cannot close position.` };
                            
                            orderResponse = await binanceService.createSpotOrder(posToClose.pair, closingSide, quantity);
                        }
                        break;
                    case TradingMode.USDSM_Futures:
                        {
                            const positionRisk = await binanceService.getFuturesPositionRisk(formattedPair);
                            const livePositionAmt = positionRisk ? parseFloat(positionRisk.positionAmt) : 0;
                            const feeRate = posToClose.takerFeeRate || constants.TAKER_FEE_RATE;

                            if (Math.abs(livePositionAmt) === 0) {
                                botManagerService.addBotLog(posToClose.botId!, `State Desync: Position on Binance is already closed. Reconciling state.`, LogType.Info);
                                const estimatedFees = (posToClose.entryPrice * posToClose.size + (exitPrice || posToClose.entryPrice) * posToClose.size) * feeRate;
                                await closePositionInState(exitPrice || posToClose.entryPrice, estimatedFees);
                                return;
                            }
                            
                            const liveSymbolInfo = await binanceService.getFuturesSymbolInfo(formattedPair);
                            if (!liveSymbolInfo) throw new Error(`Could not fetch symbol info for ${formattedPair} to close position.`);
                            const quantityPrecision = binanceService.getQuantityPrecision(liveSymbolInfo);
                            const quantity = parseFloat(Math.abs(livePositionAmt).toFixed(quantityPrecision));
                            
                            if (quantity <= 0) throw { code: -4003, msg: "Position size on exchange is zero or less." };

                            orderResponse = await binanceService.createFuturesOrder(posToClose.pair, closingSide, quantity, true);
                        }
                        break;
                    default:
                        throw new Error(`Unsupported trading mode for closing position: ${posToClose.mode}`);
                }
                
                 const executedQuantity = parseFloat(orderResponse.executedQty);
                 if (executedQuantity === 0) {
                     throw new Error(`Position closure failed: Order executed with zero quantity. Please resolve manually on the exchange.`);
                 }
    
                 botManagerService.addBotLog(posToClose.botId!, `Live position closed successfully via API.`, LogType.Success);
                 const finalExitPrice = (orderResponse.avgPrice && parseFloat(orderResponse.avgPrice) > 0) ? parseFloat(orderResponse.avgPrice) : parseFloat(orderResponse.cummulativeQuoteQty) / executedQuantity;
                 
                 const entryValue = posToClose.entryPrice * posToClose.size;
                 const exitValue = finalExitPrice * posToClose.size; // Use original size for PnL consistency
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
            const exitValue = exitPrice! * posToClose.size;
            const feeRate = posToClose.takerFeeRate || constants.TAKER_FEE_RATE;
            const simulatedFees = (entryValue + exitValue) * feeRate;
            await closePositionInState(exitPrice!, simulatedFees);
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

        const tempEntryPrice = execSignal.entryPrice || 0;
        if (tempEntryPrice === 0) {
            botManagerService.notifyTradeExecutionFailed(botId, "No live price was provided by the bot for trade.");
            return;
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
            const positionValue = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
            tradeSize = positionValue / tempEntryPrice;
        }
        
        const risk = Math.abs(finalEntryPrice - executionDetails.agentStopLoss);
        const reward = Math.abs(takeProfitPrice - finalEntryPrice);
        const initialRiskRewardRatio = risk > 0 ? reward / risk : 0;

        const newPosition: Position = {
            id: Date.now(),
            botId,
            agentId: config.agent.id, // Populate agentId
            orderId: orderResponse?.orderId ?? null,
            pair: config.pair, mode: config.mode, marginType: config.marginType, executionMode: config.executionMode,
            direction: execSignal.signal === 'BUY' ? 'LONG' : 'SHORT',
            entryPrice: finalEntryPrice, size: tradeSize, investmentAmount: config.investmentAmount,
            leverage: config.mode === TradingMode.USDSM_Futures ? config.leverage : 1,
            entryTime: new Date(binanceService.getSyncedNow()).toISOString(), 
            entryReason: execSignal.reasons.join('\n'), agentName: config.agent.name,
            takeProfitPrice, stopLossPrice, initialTakeProfitPrice: takeProfitPrice, initialStopLossPrice: executionDetails.agentStopLoss,
            initialRiskInPrice: Math.abs(finalEntryPrice - executionDetails.agentStopLoss),
            initialStopLossReason: executionDetails.slReason, activeStopLossReason: executionDetails.slReason,
            pricePrecision: config.pricePrecision, timeFrame: config.timeFrame,
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
                isBtcCorrelationVetoEnabled: config.isBtcCorrelationVetoEnabled,
                btcConfirmationThreshold: config.btcConfirmationThreshold,
                isVolumeFilterEnabled: config.isVolumeFilterEnabled,
                isAdxFilterEnabled: config.isAdxFilterEnabled,
                isExhaustionFilterEnabled: config.isExhaustionFilterEnabled,
                isSmcVetoEnabled: config.isSmcVetoEnabled,
                isSrAnalysisEnabled: config.isSrAnalysisEnabled,
                isCandlestickConfirmationEnabled: config.isCandlestickConfirmationEnabled,
                isMarketStructureVetoEnabled: config.isMarketStructureVetoEnabled,
                isSupertrendConfirmationEnabled: config.isSupertrendConfirmationEnabled,
                htfTimeFrame: config.htfTimeFrame,
                entryTiming: config.entryTiming,
                isAdaptiveTpEnabled: config.isAdaptiveTpEnabled,
                aggressiveTrailMode: config.aggressiveTrailMode,
                isInitialRiskVetoEnabled: config.isInitialRiskVetoEnabled,
                isMarketBreadthFilterEnabled: config.isMarketBreadthFilterEnabled,
                isLiquidationFilterEnabled: config.isLiquidationFilterEnabled,
                isConfirmationCandleEnabled: config.isConfirmationCandleEnabled,
                isMomentumConcordanceEnabled: config.isMomentumConcordanceEnabled,
                isTradeGuardianEnabled: config.isTradeGuardianEnabled,
                finalEntryFailSafe: config.finalEntryFailSafe,
                isHeikinAshiEnabled: config.isHeikinAshiEnabled,
            },
            entryContext: executionDetails.entryContext,
            entryAtr: executionDetails.entryContext.atr14,
            tradeType: execSignal.tradeType,
            invalidationPrice: execSignal.invalidationPrice, // Persist invalidation price
            btcContext: execSignal.btcContext, // Persist BTC context
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
        const savedTrades = historyService.loadTrades();
        setTradeHistory(savedTrades);
        telegramBotService.start();
        
        // Initialize Binance time sync
        binanceService.initializeTimeSync();

        const onBotListChange = () => setRunningBots(botManagerService.getRunningBots());
        botManagerService.setOnBotListChange(onBotListChange);
        
        // Call it once to get the initial list
        onBotListChange();

        return () => {
            botManagerService.stopAllBots();
            telegramBotService.stop();
            botManagerService.setOnBotListChange(null); // Clean up the listener
        };
    }, []);

    useEffect(() => {
        // This effect solely manages the trade handlers for the bot manager.
        // It runs less frequently now, only when its dependency functions change.
        handlersRef.current = { onExecuteTrade: handleExecuteTrade, onClosePosition: handleClosePosition };
        botManagerService.setHandlers(handlersRef.current);
    }, [handleExecuteTrade, handleClosePosition]);

    const handleLoadMoreChartData = useCallback(async () => {
        if (isFetchingMoreChartData) return;
        setIsFetchingMoreChartData(true);
        try {
            const firstKlineTime = klines[0]?.time;
            if (firstKlineTime) {
                const moreKlines = await binanceService.fetchKlines(
                    displayPair.replace('/', ''),
                    chartTimeFrame,
                    { endTime: firstKlineTime - 1, limit: 100, mode: tradingMode }
                );
                if (moreKlines.length > 0) {
                    setKlines(prevKlines => [...moreKlines, ...prevKlines]);
                }
            }
        } catch (error) {
            console.error("Failed to load more chart data:", error);
        } finally {
            setIsFetchingMoreChartData(false);
        }
    }, [isFetchingMoreChartData, klines, displayPair, chartTimeFrame, tradingMode]);

    useEffect(() => {
        if (!displayPair) return;
        
        let isCancelled = false;
        const fetchData = async () => {
            setIsChartLoading(true);
            try {
                const [klineData, infoData] = await Promise.all([
                    binanceService.fetchKlines(displayPair.replace('/', ''), chartTimeFrame, { limit: 500, mode: tradingMode }),
                    tradingMode === TradingMode.USDSM_Futures 
                        ? binanceService.getFuturesSymbolInfo(displayPair.replace('/', ''))
                        : binanceService.getSymbolInfo(displayPair.replace('/', '')),
                ]);

                if (isCancelled) return;

                setKlines(klineData);
                setSymbolInfo(infoData);
            } catch (error) {
                console.error("Failed to fetch initial data:", error);
            } finally {
                if (!isCancelled) {
                    setIsChartLoading(false);
                }
            }
        };

        fetchData();

        return () => { isCancelled = true; };
    }, [displayPair, chartTimeFrame, tradingMode, executionMode]);

    useEffect(() => {
        const fetchFunding = async () => {
            if (tradingMode === TradingMode.USDSM_Futures) {
                const info = await binanceService.fetchFundingRate(displayPair.replace('/', ''));
                if (info) {
                    setFundingInfo({
                        rate: info.fundingRate,
                        time: info.fundingTime,
                    });
                } else {
                    setFundingInfo(null);
                }
            } else {
                setFundingInfo(null);
            }
        };
        fetchFunding();
        const interval = setInterval(fetchFunding, 60 * 1000);
        return () => clearInterval(interval);
    }, [displayPair, tradingMode]);
    
    // --- API & Wallet Sync Effect ---
    useEffect(() => {
        let isCancelled = false;
        const syncApiAndWallet = async () => {
            if (executionMode === 'paper') {
                setAvailableBalance(Infinity);
                return;
            }
            
            setIsWalletLoading(true);
            setWalletError(null);
            try {
                const connected = await binanceService.checkApiConnection();
                if (isCancelled) return;
                setIsApiConnected(connected);

                if (connected) {
                    const walletFetcher = tradingMode === TradingMode.USDSM_Futures 
                        ? binanceService.fetchFuturesWalletBalance 
                        : binanceService.fetchSpotWalletBalance;
                    
                    const info = await walletFetcher();
                    if (isCancelled) return;
                    
                    setAccountInfo(info);
                    const quoteAsset = (selectedPairs[0] || 'BTC/USDT').split('/')[1];
                    const balance = info.balances.find(b => b.asset === quoteAsset);
                    setAvailableBalance(balance ? balance.free : 0);
                } else {
                     setAvailableBalance(0);
                }

            } catch (e) {
                if (!isCancelled) {
                    console.error("Failed to sync wallet:", e);
                    setWalletError(e instanceof Error ? e.message : 'An unknown error occurred.');
                }
            } finally {
                if (!isCancelled) {
                    setIsWalletLoading(false);
                }
            }
        };

        syncApiAndWallet();
        return () => { isCancelled = true; };
    }, [executionMode, tradingMode, isApiConnected, selectedPairs]);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        localStorage.setItem('theme', theme);
    }, [theme]);
    
    useEffect(() => {
        if (!isInitialized && tradeHistory.length > 0) {
            const lastTrade = tradeHistory[0];
            const hasRequiredVeto = 'botConfigSnapshot' in lastTrade && lastTrade.botConfigSnapshot && 'isTradeGuardianEnabled' in lastTrade.botConfigSnapshot;
            if(!hasRequiredVeto) {
                 if (window.confirm("It looks like you have trade history from a previous version. Clearing this old data is recommended to prevent compatibility issues. Clear now?")) {
                    historyService.clearTrades();
                    setTradeHistory([]);
                 }
            }
            setIsInitialized(true);
        }
    }, [tradeHistory, isInitialized]);


    return (
        <div className={`min-h-screen font-sans ${theme}`}>
            <div className="bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 min-h-screen transition-colors">
                <Header 
                    isApiConnected={isApiConnected} 
                    executionMode={executionMode}
                    theme={theme}
                    setTheme={setTheme}
                    activeView={activeView}
                    setActiveView={setActiveView}
                />
                <main className="container mx-auto p-3 lg:p-4">
                    {activeView === 'trading' && (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                            <div className="lg:col-span-4 xl:col-span-3">
                                <Sidebar 
                                    onStartBot={handleStartBot}
                                    klines={klines}
                                    botsToCreateCount={botsToCreate.length}
                                    selectedPairsCount={selectedPairs.length}
                                    theme={theme}
                                    isApiConnected={isApiConnected}
                                    pricePrecision={pricePrecision}
                                    accountInfo={accountInfo}
                                    isWalletLoading={isWalletLoading}
                                    walletError={walletError}
                                />
                            </div>
                            <div className="lg:col-span-8 xl:col-span-9 flex flex-col gap-4">
                                <ChartComponent 
                                    data={klines} 
                                    pair={displayPair}
                                    allPairs={configState.allPairs}
                                    onPairChange={(newPair) => setSelectedPairs([newPair])}
                                    isLoading={isChartLoading}
                                    pricePrecision={pricePrecision}
                                    chartTimeFrame={chartTimeFrame}
                                    onTimeFrameChange={configActions.setTimeFrame}
                                    onLoadMoreData={handleLoadMoreChartData}
                                    isFetchingMoreData={isFetchingMoreChartData}
                                    theme={theme}
                                    fundingInfo={fundingInfo}
                                />
                                 <RunningBots 
                                    bots={runningBots}
                                    onClosePosition={handleClosePosition}
                                    onPauseBot={botManagerService.pauseBot}
                                    onResumeBot={botManagerService.resumeBot}
                                    onStopBot={botManagerService.stopBot}
                                    onDeleteBot={botManagerService.deleteBot}
                                    onUpdateBotConfig={botManagerService.updateBotConfig}
                                    onRefreshBotAnalysis={botManagerService.refreshBotAnalysis}
                                />
                                <TradingLog 
                                    tradeHistory={tradeHistory}
                                    setTradeHistory={setTradeHistory}
                                    theme={theme}
                                />
                            </div>
                        </div>
                    )}
                    {activeView === 'backtesting' && (
                         <BacktestingPanel 
                            backtestResult={backtestResult}
                            setBacktestResult={setBacktestResult}
                            setActiveView={setActiveView}
                            theme={theme}
                        />
                    )}
                    {activeView === 'preferences' && (
                        <PreferencesPanel theme={theme} />
                    )}
                </main>
            </div>
        </div>
    );
};

const App: React.FC = () => (
    <TradingConfigProvider>
        <AppContent />
    </TradingConfigProvider>
);

export default App;
