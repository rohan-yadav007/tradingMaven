







import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ChartComponent } from './components/ChartComponent';
import { TradingLog } from './components/TradingLog';
import { RunningBots } from './components/RunningBots';
import { TradingMode, Agent, TradeSignal, Position, Trade, WalletBalance, Kline, SymbolInfo, LiveTicker, AccountInfo, RunningBot, BotConfig, BotStatus, BinanceOrderResponse, AgentParams, BacktestResult, LogType } from './types';
import * as constants from './constants';
import * as binanceService from './services/binanceService';
import { historyService } from './services/historyService';
// FIX: Correctly import botManagerService after fixing circular dependency
import { botManagerService, BotHandlers } from './services/botManagerService';
import * as localAgentService from './services/localAgentService';
import { telegramBotService } from './services/telegramBotService';
import { BacktestingPanel } from './components/BacktestingPanel';
import { TradingConfigProvider, useTradingConfigState, useTradingConfigActions } from './contexts/TradingConfigContext';

const AppContent: React.FC = () => {
    // ---- State Management ----
    // UI State
    const [isApiConnected, setIsApiConnected] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
    });
    const [activeView, setActiveView] = useState<'trading' | 'backtesting'>('trading');
    
    // Trading Configuration (from context)
    const configState = useTradingConfigState();
    const configActions = useTradingConfigActions();
    const { 
        executionMode, tradingMode, selectedPair, chartTimeFrame, 
        selectedAgent, investmentAmount, takeProfitMode, 
        takeProfitValue, isTakeProfitLocked, agentParams,
        leverage, marginType, isHtfConfirmationEnabled, htfTimeFrame, isUniversalProfitTrailEnabled,
        isMinRrEnabled, isInvalidationCheckEnabled, isReanalysisEnabled, htfAgentParams
    } = configState;

    const {
        setSelectedPair,
    } = configActions;
    
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
    const [liveBalances, setLiveBalances] = useState<WalletBalance[]>([]);
    const [isWalletLoading, setIsWalletLoading] = useState(false);
    const [walletError, setWalletError] = useState<string | null>(null);
    const [openPositions, setOpenPositions] = useState<Position[]>([]);
    const [closingPositionIds, setClosingPositionIds] = useState<Set<number>>(new Set());
    
    // New state for dynamic fee rate
    const [currentFeeRate, setCurrentFeeRate] = useState(constants.TAKER_FEE_RATE);

    // Refs for stable handlers
    const handlersRef = useRef<BotHandlers | null>(null);
    const openPositionsCountRef = useRef(openPositions.length);
    const audioContextRef = useRef<AudioContext | null>(null);

    const isBotCombinationActive = useMemo(() => {
        // If the user wants to start a paper bot, never block them.
        // They can run multiple paper bots with the same settings for comparison.
        if (executionMode === 'paper') {
            return false;
        }
        
        // For live bots, prevent starting a duplicate.
        return runningBots.some(bot => 
            bot.config.executionMode === 'live' && // Important: Only check against other LIVE bots
            bot.config.pair === selectedPair &&
            bot.config.agent.id === selectedAgent.id &&
            bot.config.timeFrame === chartTimeFrame &&
            bot.status !== BotStatus.Stopped &&
            bot.status !== BotStatus.Error
        );
    }, [runningBots, selectedPair, selectedAgent, chartTimeFrame, executionMode]);

    const handleStartBot = useCallback(() => {
        if (isBotCombinationActive) return;

        const start = async () => {
            try {
                const formattedPair = selectedPair.replace('/', '');
                
                const symbolInfoForBot = tradingMode === TradingMode.USDSM_Futures
                    ? await binanceService.getFuturesSymbolInfo(formattedPair)
                    : await binanceService.getSymbolInfo(formattedPair);

                if (!symbolInfoForBot) {
                    console.error(`Could not fetch symbol info for ${selectedPair}. Cannot start bot.`);
                    // TODO: Show this error in UI
                    return;
                }
                
                const pricePrecisionForBot = binanceService.getPricePrecision(symbolInfoForBot);
                const quantityPrecisionForBot = binanceService.getQuantityPrecision(symbolInfoForBot);
                const stepSizeForBot = binanceService.getStepSize(symbolInfoForBot);

                const botConfig: BotConfig = {
                    pair: selectedPair,
                    mode: tradingMode,
                    executionMode,
                    leverage,
                    marginType,
                    agent: selectedAgent,
                    timeFrame: chartTimeFrame,
                    investmentAmount,
                    takeProfitMode,
                    takeProfitValue,
                    isTakeProfitLocked,
                    isHtfConfirmationEnabled,
                    htfTimeFrame,
                    isUniversalProfitTrailEnabled,
                    isMinRrEnabled,
                    isInvalidationCheckEnabled,
                    isReanalysisEnabled,
                    agentParams,
                    htfAgentParams,
                    pricePrecision: pricePrecisionForBot,
                    quantityPrecision: quantityPrecisionForBot,
                    stepSize: stepSizeForBot,
                    takerFeeRate: currentFeeRate,
                };

                botManagerService.startBot(botConfig);
            } catch (error) {
                console.error("Failed to start bot:", error);
            }
        };

        start();
    }, [
        isBotCombinationActive, selectedPair, tradingMode, executionMode, leverage, marginType,
        selectedAgent, chartTimeFrame, investmentAmount, takeProfitMode, takeProfitValue,
        isTakeProfitLocked, isHtfConfirmationEnabled, htfTimeFrame, agentParams, htfAgentParams,
        isUniversalProfitTrailEnabled, isMinRrEnabled, isInvalidationCheckEnabled,
        isReanalysisEnabled, currentFeeRate
    ]);

    // ---- Handlers ----
    const handleClosePosition = useCallback(async (posToClose: Position, exitReason: string = "Manual Close", exitPriceOverride?: number) => {
        if (!posToClose || closingPositionIds.has(posToClose.id)) {
            return;
        }
        setClosingPositionIds(prev => new Set(prev).add(posToClose.id));

        const exitPrice = exitPriceOverride ?? botManagerService.getBot(posToClose.botId!)?.bot.livePrice ?? 0;
        if (exitPrice === 0 && posToClose.executionMode !== 'live') { // For paper, we need an exit price
            console.error("Could not determine exit price for paper trade", posToClose.id);
            setClosingPositionIds(prev => { const newSet = new Set(prev); newSet.delete(posToClose.id); return newSet; });
            return;
        }

        const closePositionInState = async (finalExitPrice: number, fees: number = 0) => {
            const isLong = posToClose.direction === 'LONG';
            const grossPnl = (finalExitPrice - posToClose.entryPrice) * posToClose.size * (isLong ? 1 : -1);
            
            const netPnl = grossPnl - fees;

            // --- MFE/MAE Calculation ---
            const mfePrice = posToClose.peakPrice ?? posToClose.entryPrice;
            const maePrice = posToClose.troughPrice ?? posToClose.entryPrice;
            const mfe = Math.abs(mfePrice - posToClose.entryPrice) * posToClose.size;
            const mae = Math.abs(maePrice - posToClose.entryPrice) * posToClose.size;
            
            const bot = botManagerService.getBot(posToClose.botId!);
            const botKlines = bot ? bot.klines : klines; // Fallback to chart klines

            // --- Enhanced Context Capture ---
            let htfKlines: Kline[] | undefined;
            if (posToClose.botConfigSnapshot?.isHtfConfirmationEnabled) {
                const htf = posToClose.botConfigSnapshot.htfTimeFrame === 'auto'
                    ? constants.TIME_FRAMES[constants.TIME_FRAMES.indexOf(posToClose.timeFrame) + 1]
                    : posToClose.botConfigSnapshot.htfTimeFrame;
                if(htf) {
                    htfKlines = await binanceService.fetchKlines(posToClose.pair.replace('/',''), htf, { limit: 205, mode: posToClose.mode });
                }
            }
            // FIX: Removed extra arguments from captureMarketContext call to match its signature.
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
            
            if (posToClose.executionMode === 'live') {
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
                telegramBotService.sendMessage(message);
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
                
                 // --- CRITICAL VERIFICATION STEP ---
                 const executedQuantity = parseFloat(orderResponse.executedQty);
                 // Use a small tolerance for floating point comparisons
                 if (Math.abs(executedQuantity - quantity) > 1e-9) {
                     throw new Error(`Position closure failed: Order only partially filled. Requested ${quantity}, but executed ${executedQuantity}. Please resolve manually on the exchange.`);
                 }

                 botManagerService.addBotLog(posToClose.botId!, `Live position closed successfully via API.`, LogType.Success);
                 const finalExitPrice = parseFloat(orderResponse.cummulativeQuoteQty) / executedQuantity;
                 
                 const entryValue = posToClose.entryPrice * posToClose.size;
                 const exitValue = finalExitPrice * posToClose.size;
                 const feeRate = posToClose.takerFeeRate || constants.TAKER_FEE_RATE; // Fallback
                 const totalFees = (entryValue + exitValue) * feeRate;

                 await closePositionInState(finalExitPrice, totalFees);

            } catch(e) {
                const errorMessage = binanceService.interpretBinanceError(e);
                console.error("CRITICAL: Failed to close live position on Binance:", e);
                const criticalMessage = `CRITICAL: Failed to close live position for ${posToClose.pair}. Please close manually on Binance to prevent loss. Reason: ${errorMessage}`;
                botManagerService.addBotLog(posToClose.botId!, criticalMessage, LogType.Error);
                botManagerService.updateBotState(posToClose.botId!, { status: BotStatus.Error, analysis: {signal: 'HOLD', reasons: [criticalMessage]}});
                
                telegramBotService.sendMessage(
`🚨 *CRITICAL ALERT: FAILED TO CLOSE LIVE POSITION* 🚨

*Action Required!* Please manually close the following position on Binance immediately:

*Pair:* ${posToClose.pair}
*Direction:* ${posToClose.direction}
*Entry Price:* ${posToClose.entryPrice.toFixed(posToClose.pricePrecision)}
*Size:* ${posToClose.size}

*Reason for Failure:* ${errorMessage}`
                );

                setClosingPositionIds(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(posToClose.id);
                    return newSet;
                });
            }
        } else {
            const entryValue = posToClose.entryPrice * posToClose.size;
            const exitValue = exitPrice * posToClose.size;
            const feeRate = posToClose.takerFeeRate || constants.TAKER_FEE_RATE; // Fallback
            const simulatedFees = (entryValue + exitValue) * feeRate;

            await closePositionInState(exitPrice, simulatedFees);
        }

    }, [closingPositionIds, klines]);

    const handleExecuteTrade = useCallback(async (
        execSignal: TradeSignal,
        botId: string,
        executionDetails: {
            agentStopLoss: number,
            slReason: 'Agent Logic' | 'Hard Cap'
        }
    ) => {
        const bot = botManagerService.getBot(botId);
        if (!bot) {
            console.error(`handleExecuteTrade called for non-existent bot ID: ${botId}`);
            return;
        }

        if (execSignal.signal === 'HOLD') {
            const reason = "Trade execution requested for a 'HOLD' signal. This should not happen.";
            botManagerService.addBotLog(botId, reason, LogType.Error);
            botManagerService.updateBotState(botId, { status: BotStatus.Monitoring });
            return;
        }
        
        const { config } = bot.bot;
        
        const { stopLossPrice, takeProfitPrice } = execSignal;
        if (stopLossPrice === undefined || takeProfitPrice === undefined) {
             const reason = "Trade execution failed: Bot did not provide required Stop Loss/Take Profit targets.";
             botManagerService.notifyTradeExecutionFailed(botId, reason);
             return;
        }

        let orderResponse: BinanceOrderResponse | null = null;
        let tradeSize: number;
        let finalEntryPrice: number;
        let finalLiquidationPrice: number | undefined = undefined;

        if (config.executionMode === 'live') {
            if (!accountInfo) {
                const reason = `Trade aborted: Live account information is not yet available. Please wait a moment.`;
                botManagerService.notifyTradeExecutionFailed(botId, reason);
                return;
            }

            const modeToAccountType: Record<string, string> = {
                [TradingMode.Spot]: 'SPOT',
                [TradingMode.USDSM_Futures]: 'USDT_FUTURES',
            };
            const expectedAccountType = modeToAccountType[config.mode];

            if (accountInfo.accountType !== expectedAccountType) {
                const reason = `Trade aborted: Wallet mismatch. Bot needs ${config.mode}, but UI wallet is ${accountInfo.accountType}. Please switch the sidebar wallet view.`;
                botManagerService.notifyTradeExecutionFailed(botId, reason);
                return;
            }

            const quoteAsset = config.pair.split('/')[1];
            const balance = accountInfo.balances.find(b => b.asset === quoteAsset);
            const availableBalance = balance ? balance.free : 0;

            if (config.investmentAmount > availableBalance) {
                const reason = `Trade aborted: Insufficient funds. Required: ${config.investmentAmount.toFixed(2)} ${quoteAsset}, Available: ${availableBalance.toFixed(2)} ${quoteAsset}.`;
                botManagerService.addBotLog(botId, reason, LogType.Error);
                botManagerService.updateBotState(botId, { status: BotStatus.Monitoring }); // No cooldown for this state
                return;
            }

            try {
                const entryPriceForOrder = execSignal.entryPrice;
                if (!entryPriceForOrder || entryPriceForOrder <= 0) {
                    throw new Error("Could not get live price for trade execution.");
                }

                let rawQuantity: number;
                if (config.mode === TradingMode.USDSM_Futures) {
                    rawQuantity = (config.investmentAmount * config.leverage) / entryPriceForOrder;
                } else {
                    rawQuantity = config.investmentAmount / entryPriceForOrder;
                }

                const tempQuantity = Math.floor(rawQuantity / config.stepSize) * config.stepSize;
                const quantity = parseFloat(tempQuantity.toFixed(config.quantityPrecision));

                if (quantity <= 0) {
                    throw new Error("Calculated quantity is too small to trade based on investment and asset's step size.");
                }

                switch (config.mode) {
                    case TradingMode.Spot:
                        orderResponse = await binanceService.createSpotOrder(config.pair, execSignal.signal, quantity);
                        break;
                    case TradingMode.USDSM_Futures:
                        orderResponse = await binanceService.createFuturesOrder(config.pair, execSignal.signal, quantity);
                        break;
                    default:
                        throw new Error(`Unsupported trading mode for trade execution: ${config.mode}`);
                }
                
                tradeSize = parseFloat(orderResponse.executedQty);

                if (orderResponse.avgPrice && parseFloat(orderResponse.avgPrice) > 0) {
                    finalEntryPrice = parseFloat(orderResponse.avgPrice);
                } else if (tradeSize > 0) {
                    finalEntryPrice = parseFloat(orderResponse.cummulativeQuoteQty) / tradeSize;
                } else {
                    throw new Error("Order filled, but failed to parse execution details. Check position manually.");
                }

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
            finalEntryPrice = execSignal.entryPrice || 0;
            if(finalEntryPrice === 0) {
                 botManagerService.addBotLog(botId, `Paper trade failed: no live price was provided by the bot.`, LogType.Error);
                 botManagerService.updateBotState(botId, { status: BotStatus.Monitoring });
                 return;
            }
            const positionValue = config.mode === TradingMode.USDSM_Futures ? config.investmentAmount * config.leverage : config.investmentAmount;
            tradeSize = positionValue / finalEntryPrice;
        }
        
        const risk = Math.abs(finalEntryPrice - executionDetails.agentStopLoss);
        const reward = Math.abs(takeProfitPrice - finalEntryPrice);
        const initialRiskRewardRatio = risk > 0 ? reward / risk : 0;

        const botConfigSnapshot = {
            isHtfConfirmationEnabled: config.isHtfConfirmationEnabled,
            htfTimeFrame: config.htfTimeFrame,
            isUniversalProfitTrailEnabled: config.isUniversalProfitTrailEnabled,
            isMinRrEnabled: config.isMinRrEnabled,
            isReanalysisEnabled: config.isReanalysisEnabled,
            isInvalidationCheckEnabled: config.isInvalidationCheckEnabled,
        };
        
        let htfKlinesForContext: Kline[] | undefined;
        if (config.isHtfConfirmationEnabled) {
            const htf = config.htfTimeFrame === 'auto' 
                ? constants.TIME_FRAMES[constants.TIME_FRAMES.indexOf(config.timeFrame) + 1] 
                : config.htfTimeFrame;
            if(htf) {
                htfKlinesForContext = await binanceService.fetchKlines(config.pair.replace('/',''), htf, { limit: 205, mode: config.mode });
            }
        }
        // FIX: Removed extra arguments from captureMarketContext call to match its signature.
        const entryContext = localAgentService.captureMarketContext(klines, htfKlinesForContext);

        const newPosition: Position = {
            id: Date.now(),
            pair: config.pair,
            mode: config.mode,
            marginType: config.marginType,
            executionMode: config.executionMode,
            direction: execSignal.signal === 'BUY' ? 'LONG' : 'SHORT',
            entryPrice: finalEntryPrice,
            size: tradeSize,
            investmentAmount: config.investmentAmount,
            leverage: config.mode === TradingMode.USDSM_Futures ? config.leverage : 1,
            entryTime: new Date().toISOString(),
            entryReason: execSignal.reasons.join('\n'),
            agentName: config.agent.name,
            takeProfitPrice,
            stopLossPrice,
            initialTakeProfitPrice: takeProfitPrice,
            initialStopLossPrice: executionDetails.agentStopLoss,
            initialRiskInPrice: Math.abs(finalEntryPrice - executionDetails.agentStopLoss),
            activeStopLossReason: executionDetails.slReason,
            pricePrecision: config.pricePrecision,
            timeFrame: config.timeFrame,
            botId,
            orderId: orderResponse?.orderId ?? null,
            liquidationPrice: finalLiquidationPrice,
            isBreakevenSet: false,
            proactiveLossCheckTriggered: false,
            profitLockTier: 0,
            peakPrice: finalEntryPrice,
            troughPrice: finalEntryPrice,
            candlesSinceEntry: 0,
            hasBeenProfitable: false,
            takerFeeRate: config.takerFeeRate,
            initialRiskRewardRatio,
            agentParamsSnapshot: config.agentParams,
            botConfigSnapshot,
            entryContext,
        };

        if (config.executionMode === 'live') {
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
            telegramBotService.sendMessage(message);
        }

        botManagerService.updateBotState(botId, {
            status: BotStatus.PositionOpen,
            openPositionId: newPosition.id,
            openPosition: newPosition,
        });

    }, [accountInfo, klines]);

    const handleClearHistory = useCallback(() => {
        if (window.confirm('Are you sure you want to permanently delete all trade history? This action cannot be undone.')) {
            historyService.clearTrades();
            setTradeHistory([]);
        }
    }, []);
    
    // ---- Effects ----

    // Effect to fetch and update the current taker fee rate
    useEffect(() => {
        const updateFeeRate = async () => {
             // If API is disconnected, always use default.
            if (!isApiConnected) {
                setCurrentFeeRate(constants.TAKER_FEE_RATE);
                return;
            }
    
            // For both 'live' and 'paper' (if connected), try to fetch the fee.
            if (tradingMode === TradingMode.Spot) {
                if (accountInfo?.takerCommission) {
                    // takerCommission from Binance is in basis points, e.g., 10 for 0.10%
                    setCurrentFeeRate(accountInfo.takerCommission / 10000);
                } else {
                    setCurrentFeeRate(constants.TAKER_FEE_RATE); // Fallback
                }
            } else if (tradingMode === TradingMode.USDSM_Futures) {
                try {
                    const commissionInfo = await binanceService.fetchFuturesCommissionRate(selectedPair);
                    if (commissionInfo) {
                        setCurrentFeeRate(commissionInfo.takerCommissionRate);
                    } else {
                        setCurrentFeeRate(constants.TAKER_FEE_RATE); // Fallback
                    }
                } catch (error) {
                    console.error("Failed to fetch futures commission rate, using default.", error);
                    setCurrentFeeRate(constants.TAKER_FEE_RATE);
                }
            }
        };
        updateFeeRate();
    }, [tradingMode, selectedPair, isApiConnected, accountInfo]);

    // Keep the refs updated with the latest versions of the handlers
    useEffect(() => {
        handlersRef.current = {
            onExecuteTrade: handleExecuteTrade,
            onClosePosition: handleClosePosition,
        };
    }, [handleExecuteTrade, handleClosePosition]);

    // Theme effect for Tailwind CSS
    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('light', 'dark');
        root.classList.add(theme);
        localStorage.setItem('theme', theme);
    }, [theme]);
    
    // Initialize services and load history ONCE on mount
    useEffect(() => {
        const onBotUpdate = () => {
            setRunningBots(botManagerService.getRunningBots());
        };

        const stableHandlers: BotHandlers = {
            onExecuteTrade: (...args) => {
                if (handlersRef.current) {
                    return handlersRef.current.onExecuteTrade(...args);
                }
                return Promise.resolve();
            },
            onClosePosition: (...args) => {
                if (handlersRef.current) {
                    handlersRef.current.onClosePosition(...args);
                }
            },
        };

        botManagerService.setHandlers(stableHandlers, onBotUpdate);
        
        binanceService.checkApiConnection()
            .then(setIsApiConnected)
            .catch(() => setIsApiConnected(false));

        const trades = historyService.loadTrades();
        setTradeHistory(trades);
        setIsInitialized(true);
        telegramBotService.start();

        return () => {
            botManagerService.stopAllBots();
        };
    }, []);

    // Fetch chart klines and other pair-specific data
    useEffect(() => {
        let isCancelled = false;
        const fetchAllData = async () => {
             // Fetch chart klines
            setIsChartLoading(true);
            try {
                const formattedPair = selectedPair.replace('/', '');
                const data = await binanceService.fetchKlines(formattedPair, chartTimeFrame, { limit: 500, mode: tradingMode });
                if (!isCancelled) {
                    setKlines(data);
                    if (data.length > 0) setLivePrice(data[data.length - 1].close);
                }
            } catch (err) {
                console.error("Failed to fetch klines:", err);
                if (!isCancelled) setKlines([]);
            } finally {
                if (!isCancelled) setIsChartLoading(false);
            }

            // Fetch symbol info and funding rate
            try {
                const formattedPair = selectedPair.replace('/', '');
                const info = tradingMode === TradingMode.USDSM_Futures
                    ? await binanceService.getFuturesSymbolInfo(formattedPair)
                    : await binanceService.getSymbolInfo(formattedPair);
                
                if (!isCancelled) setSymbolInfo(info);
                
                if (tradingMode === TradingMode.USDSM_Futures) {
                    const funding = await binanceService.fetchFundingRate(formattedPair);
                    if (!isCancelled) setFundingInfo(funding ? { rate: funding.fundingRate, time: funding.fundingTime } : null);
                } else {
                    if (!isCancelled) setFundingInfo(null);
                }
            } catch (err) {
                console.error("Failed to fetch symbol info:", err);
                 if (!isCancelled) {
                     setSymbolInfo(undefined);
                     setFundingInfo(null);
                 }
            }
        };

        fetchAllData();

         // WebSocket subscriptions
        const formattedPair = selectedPair.replace('/', '');
        const tickerCallback = (data: any) => {
            const ticker: LiveTicker = { pair: data.s, closePrice: parseFloat(data.c), highPrice: parseFloat(data.h), lowPrice: parseFloat(data.l), volume: parseFloat(data.v), quoteVolume: parseFloat(data.q) };
             if (ticker.pair.toLowerCase() === formattedPair.toLowerCase()) {
                setLivePrice(ticker.closePrice);
                setLiveTicker(ticker);
            }
        };

        const klineCallback = (data: any) => {
             const newKline: Kline = { time: data.k.t, open: parseFloat(data.k.o), high: parseFloat(data.k.h), low: parseFloat(data.k.l), close: parseFloat(data.k.c), volume: parseFloat(data.k.v), isFinal: data.k.x };
             setKlines(prev => {
                const last = prev[prev.length - 1];
                if (last && newKline.time === last.time) {
                    // For tick updates within a candle, we don't update the main klines state here.
                    // The livePrice state, updated by the ticker, drives real-time analysis previews.
                    // We only update the kline array when the candle is final to prevent excessive re-renders.
                    if (newKline.isFinal) {
                        const newKlines = [...prev];
                        newKlines[newKlines.length - 1] = newKline;
                        return newKlines;
                    }
                    return prev;
                } else if (!last || newKline.time > last.time) {
                    // A new candle has started.
                    return [...prev, newKline];
                }
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
    }, [selectedPair, chartTimeFrame, tradingMode]);


    const handleLoadMoreData = useCallback(async () => {
        if (isFetchingMoreChartData || klines.length === 0) return;
    
        setIsFetchingMoreChartData(true);
        try {
            const firstKlineTime = klines[0].time;
            const formattedPair = selectedPair.replace('/', '');
            const moreData = await binanceService.fetchKlines(
                formattedPair, 
                chartTimeFrame, 
                { endTime: firstKlineTime - 1, limit: 200, mode: tradingMode }
            );
            if (moreData.length > 0) {
                setKlines(prev => [...moreData, ...prev]);
            }
        } catch (error) {
            console.error("Failed to load more chart data:", error);
        } finally {
            setIsFetchingMoreChartData(false);
        }
    }, [isFetchingMoreChartData, klines, selectedPair, chartTimeFrame, tradingMode]);

    if (!isInitialized) {
        return (
            <div className="flex items-center justify-center h-screen bg-slate-900 text-white">
                <div className="text-lg font-semibold">Initializing Trading Assistant...</div>
            </div>
        );
    }
    
    return (
        <div className={`min-h-screen font-sans bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-50 ${theme}`}>
            <Header
                isApiConnected={isApiConnected}
                executionMode={executionMode}
                theme={theme}
                setTheme={setTheme}
                activeView={activeView}
                setActiveView={setActiveView}
            />
            <main className="container mx-auto p-3 lg:p-4">
              {activeView === 'trading' ? (
                 <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  <div className="col-span-12 lg:col-span-3 order-last lg:order-first">
                    <Sidebar
                        onStartBot={handleStartBot}
                        klines={klines}
                        livePrice={livePrice}
                        isBotCombinationActive={isBotCombinationActive}
                        theme={theme}
                        isApiConnected={isApiConnected}
                        pricePrecision={pricePrecision}
                        accountInfo={accountInfo}
                        isWalletLoading={isWalletLoading}
                        walletError={walletError}
                    />
                  </div>
                  <div className="col-span-12 lg:col-span-9 flex flex-col gap-4">
                    <ChartComponent
                        data={klines}
                        pair={selectedPair}
                        allPairs={configState.allPairs}
                        onPairChange={setSelectedPair}
                        isLoading={isChartLoading}
                        pricePrecision={pricePrecision}
                        livePrice={livePrice}
                        liveTicker={liveTicker}
                        chartTimeFrame={chartTimeFrame}
                        onTimeFrameChange={configActions.setTimeFrame}
                        onLoadMoreData={handleLoadMoreData}
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
                    <TradingLog tradeHistory={tradeHistory} onClearHistory={handleClearHistory} />
                  </div>
                </div>
              ) : (
                <BacktestingPanel
                  backtestResult={backtestResult}
                  setBacktestResult={setBacktestResult}
                  setActiveView={setActiveView}
                  klines={klines}
                  theme={theme}
                />
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