


import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ChartComponent } from './components/ChartComponent';
import { TradingLog } from './components/TradingLog';
import { RunningBots } from './components/RunningBots';
import { TradingMode, Agent, TradeSignal, Position, Trade, WalletBalance, Kline, SymbolInfo, LiveTicker, AccountInfo, RunningBot, BotConfig, BotStatus, BinanceOrderResponse, AgentParams, BacktestResult, LogType } from './types';
import * as constants from './constants';
import * as binanceService from './services/binanceService';
import { historyService } from './services/historyService';
import { botManagerService, BotHandlers } from './services/botManagerService';
import { telegramBotService } from './services/telegramBotService';
import { BacktestingPanel } from './components/BacktestingPanel';
import { TradingConfigProvider, useTradingConfigState, useTradingConfigActions } from './contexts/TradingConfigContext';

const AppContent: React.FC = () => {
    // ---- State Management ----
    // UI State
    const [isApiConnected, setIsApiConnected] = useState(false);
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
        isTrailingTakeProfitEnabled
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
    
    // Refs for stable handlers
    const handlersRef = useRef<BotHandlers | null>(null);
    const openPositionsCountRef = useRef(openPositions.length);
    const audioContextRef = useRef<AudioContext | null>(null);

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

        const closePositionInState = (finalExitPrice: number, fees: number = 0) => {
            const isLong = posToClose.direction === 'LONG';
            const grossPnl = (finalExitPrice - posToClose.entryPrice) * posToClose.size * (isLong ? 1 : -1);
            
            const netPnl = grossPnl - fees;

            const newTrade: Trade = { ...posToClose, exitPrice: finalExitPrice, exitTime: new Date(), pnl: netPnl, exitReason };
            
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
                 const totalFees = (entryValue + exitValue) * constants.TAKER_FEE_RATE;

                 closePositionInState(finalExitPrice, totalFees);

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
            const simulatedFees = (entryValue + exitValue) * constants.TAKER_FEE_RATE;

            closePositionInState(exitPrice, simulatedFees);
        }

    }, [closingPositionIds]);

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
            takeProfitPrice,
            stopLossPrice,
            initialTakeProfitPrice: takeProfitPrice,
            initialStopLossPrice: executionDetails.agentStopLoss,
            activeStopLossReason: executionDetails.slReason,
            pricePrecision: config.pricePrecision,
            timeFrame: config.timeFrame,
            botId,
            orderId: orderResponse?.orderId ?? null,
            liquidationPrice: finalLiquidationPrice,
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

    }, [accountInfo]);
    
    // ---- Effects ----

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
        binanceService.checkApiConnection()
            .then(setIsApiConnected)
            .catch(() => setIsApiConnected(false));

        const trades = historyService.loadTrades();
        setTradeHistory(trades);

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
        
        telegramBotService.start();

        return () => {
            botManagerService.stopAllBots();
        }
    }, []); // Empty dependency array ensures this runs only once.

    useEffect(() => {
        configActions.setIsApiConnected(isApiConnected);
    }, [isApiConnected, configActions]);

    // Fetch chart and symbol data when pair or timeframe changes
    const fetchChartData = useCallback(async () => {
        setIsChartLoading(true);
        try {
            const formattedPair = selectedPair.replace('/', '');

            const symbolInfoFetcher = tradingMode === TradingMode.USDSM_Futures
                ? binanceService.getFuturesSymbolInfo(formattedPair)
                : binanceService.getSymbolInfo(formattedPair);

            const [klineData, info] = await Promise.all([
                binanceService.fetchKlines(formattedPair, chartTimeFrame, { mode: tradingMode }),
                symbolInfoFetcher
            ]);

            if (!info) {
                 throw new Error(`Symbol information not found for ${selectedPair} in ${tradingMode} mode. This pair may not be available for this type of trading.`);
            }

            setKlines(klineData);
            setSymbolInfo(info as SymbolInfo);
            botManagerService.updateKlines(formattedPair, chartTimeFrame, klineData);
        } catch (error) {
            console.error("Failed to fetch chart data:", error);
            setKlines([]);
            setSymbolInfo(undefined);
        } finally {
            setIsChartLoading(false);
        }
    }, [selectedPair, chartTimeFrame, tradingMode]);

    useEffect(() => {
        fetchChartData();
    }, [fetchChartData]);

    // Subscribe to live kline and ticker data
    useEffect(() => {
        const formattedPair = selectedPair.replace('/', '').toLowerCase();
        
        const tickerCallback = (ticker: LiveTicker) => {
            if (ticker.pair.toLowerCase() === formattedPair) {
                setLivePrice(ticker.closePrice);
                setLiveTicker(ticker);
            }
        };

        const klineCallback = (newKline: Kline) => {
            if (newKline.isFinal) {
                setKlines(prevKlines => {
                    if (prevKlines.length === 0) return [newKline];
                    const lastKline = prevKlines[prevKlines.length - 1];
                    if (lastKline && newKline.time === lastKline.time) {
                        const updatedKlines = [...prevKlines];
                        updatedKlines[prevKlines.length - 1] = newKline;
                        return updatedKlines;
                    } 
                    else if (lastKline && newKline.time > lastKline.time) {
                        return [...prevKlines.slice(1), newKline];
                    }
                    return prevKlines;
                });
            }
        };
        
        botManagerService.subscribeToTickerUpdates(formattedPair, tradingMode, tickerCallback);
        botManagerService.subscribeToKlineUpdates(formattedPair, chartTimeFrame, tradingMode, klineCallback);
        
        return () => {
            botManagerService.unsubscribeFromTickerUpdates(formattedPair, tradingMode, tickerCallback);
            botManagerService.unsubscribeFromKlineUpdates(formattedPair, chartTimeFrame, tradingMode, klineCallback);
        };
    }, [selectedPair, chartTimeFrame, tradingMode]);

    // Fetch funding rate for futures
    useEffect(() => {
        if (tradingMode !== TradingMode.USDSM_Futures) {
            setFundingInfo(null);
            return;
        }
        let isCancelled = false;
        const fetchFunding = async () => {
            const formattedPair = selectedPair.replace('/', '');
            const info = await binanceService.fetchFundingRate(formattedPair);
            if (!isCancelled) {
                setFundingInfo(info ? { rate: info.fundingRate, time: info.fundingTime } : null);
            }
        };
        fetchFunding();
        const interval = setInterval(fetchFunding, 60000); // Refresh every minute
        return () => {
            isCancelled = true;
            clearInterval(interval);
        };
    }, [selectedPair, tradingMode]);

    // Fetch wallet balances
    const fetchWalletBalances = useCallback(async () => {
        if (!isApiConnected) {
            setAccountInfo(null);
            setLiveBalances([]);
            setWalletError(null);
            return;
        }
        setIsWalletLoading(true);
        setWalletError(null);
        try {
            let info;
            switch (configState.walletViewMode) {
                case TradingMode.Spot:
                    info = await binanceService.fetchSpotWalletBalance();
                    break;
                case TradingMode.USDSM_Futures:
                    info = await binanceService.fetchFuturesWalletBalance();
                    break;
                default:
                    setWalletError("Invalid trading mode selected for wallet view.");
                    return;
            }
            setAccountInfo(info);
            setLiveBalances(info.balances);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred. Make sure your API keys are correct.";
            setWalletError(errorMessage);
            setAccountInfo(null);
            setLiveBalances([]);
        } finally {
            setIsWalletLoading(false);
        }
    }, [isApiConnected, configState.walletViewMode]);

    useEffect(() => {
        fetchWalletBalances();
    }, [fetchWalletBalances]);

    // Initialize Audio Context and handle user interaction to enable it
    useEffect(() => {
        if (!audioContextRef.current) {
            try {
                // Create the AudioContext once and store it in the ref.
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            } catch (e) {
                console.error("Web Audio API is not supported in this browser.", e);
                return; // Exit if not supported
            }
        }

        const resumeAudio = () => {
            if (audioContextRef.current?.state === 'suspended') {
                audioContextRef.current.resume();
            }
            // Listener cleans itself up after first interaction.
            document.body.removeEventListener('click', resumeAudio);
            document.body.removeEventListener('keydown', resumeAudio);
        };

        document.body.addEventListener('click', resumeAudio);
        document.body.addEventListener('keydown', resumeAudio);

        return () => {
            document.body.removeEventListener('click', resumeAudio);
            document.body.removeEventListener('keydown', resumeAudio);
            audioContextRef.current?.close().catch(e => console.error("Error closing AudioContext", e));
        };
    }, []); // Empty dependency array ensures this runs only once on mount.

    // Synchronize open positions from running bots
    useEffect(() => {
        const positionsFromBots = runningBots
            .filter(bot => bot.openPosition)
            .map(bot => bot.openPosition!);
        setOpenPositions(positionsFromBots);
    }, [runningBots]);

    // Audio Alert Effect for New Positions
    useEffect(() => {
        const playNotificationSound = () => {
            const audioContext = audioContextRef.current;
            if (!audioContext || audioContext.state !== 'running') {
                console.warn('AudioContext not ready, sound blocked. Interact with the page to enable audio.');
                return;
            }
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4 note
            gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
            oscillator.start();
            gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.5);
            oscillator.stop(audioContext.currentTime + 0.5);
        };

        if (openPositions.length > openPositionsCountRef.current) {
            playNotificationSound();
        }
        openPositionsCountRef.current = openPositions.length;
    }, [openPositions]);

    const getAvailableBalanceForInvestment = useCallback(() => {
        if (executionMode !== 'live') return Infinity;
        if (!isApiConnected || !accountInfo || !symbolInfo) return 0;
        if (configState.walletViewMode !== tradingMode) return 0;
        
        const quoteAsset = symbolInfo.quoteAsset;
        if (!quoteAsset) return 0;
        
        const balance = liveBalances.find(b => b.asset === quoteAsset);
        return balance ? balance.free : 0;

    }, [executionMode, isApiConnected, accountInfo, symbolInfo, configState.walletViewMode, tradingMode, liveBalances]);

    useEffect(() => {
        configActions.setAvailableBalance(getAvailableBalanceForInvestment());
    }, [getAvailableBalanceForInvestment, configActions]);

    const handleLoadMoreChartData = useCallback(async () => {
        if (isFetchingMoreChartData || klines.length === 0) return;
        
        setIsFetchingMoreChartData(true);
        try {
            const formattedPair = selectedPair.replace('/', '');
            const oldestKlineTime = klines[0].time;
            
            const newKlines = await binanceService.fetchKlines(formattedPair, chartTimeFrame, { endTime: oldestKlineTime - 1, mode: tradingMode });
            
            const uniqueNewKlines = newKlines.filter(nk => !klines.some(ok => ok.time === nk.time));
            
            if (uniqueNewKlines.length > 0) {
                 const updatedKlines = [...uniqueNewKlines, ...klines];
                 setKlines(updatedKlines);
                 botManagerService.updateKlines(formattedPair, chartTimeFrame, updatedKlines);
            }
        } catch (error) {
            console.error("Failed to load more chart data:", error);
        } finally {
            setIsFetchingMoreChartData(false);
        }
    }, [isFetchingMoreChartData, klines, selectedPair, chartTimeFrame, tradingMode]);
    
    const isBotCombinationActive = useCallback(() => {
        if (executionMode === 'live') {
            // For live trading, prevent running more than one bot per trading pair.
            return runningBots.some(bot => 
                bot.config.executionMode === 'live' &&
                bot.config.pair === selectedPair &&
                bot.status !== BotStatus.Stopped &&
                bot.status !== BotStatus.Error
            );
        }
        
        // For paper trading, always allow creating a new bot, regardless of existing combinations.
        return false;
    }, [runningBots, selectedPair, executionMode]);
    
    const handleStartBot = useCallback(() => {
        if (!symbolInfo) {
            console.error("Cannot start bot: symbol information is not yet loaded.");
            return;
        }

        const botConfig: BotConfig = {
            pair: selectedPair,
            mode: tradingMode,
            executionMode,
            leverage: leverage,
            marginType,
            agent: selectedAgent,
            timeFrame: chartTimeFrame,
            investmentAmount,
            takeProfitMode,
            takeProfitValue,
            isTakeProfitLocked,
            isHtfConfirmationEnabled,
            htfTimeFrame,
            agentParams,
            pricePrecision: binanceService.getPricePrecision(symbolInfo),
            quantityPrecision: binanceService.getQuantityPrecision(symbolInfo),
            stepSize: binanceService.getStepSize(symbolInfo),
            isUniversalProfitTrailEnabled,
            isTrailingTakeProfitEnabled,
        };
        botManagerService.startBot(botConfig);
    }, [
        selectedPair, tradingMode, leverage, marginType, selectedAgent, chartTimeFrame, executionMode,
        investmentAmount, takeProfitMode, takeProfitValue,
        isTakeProfitLocked, isHtfConfirmationEnabled, htfTimeFrame, agentParams, symbolInfo, isUniversalProfitTrailEnabled,
        isTrailingTakeProfitEnabled
    ]);

    const handleUpdateBotConfig = useCallback((botId: string, partialConfig: Partial<BotConfig>) => {
        botManagerService.updateBotConfig(botId, partialConfig);
    }, []);
    
    const botActions = {
        onClosePosition: handleClosePosition,
        onPauseBot: useCallback((botId: string) => botManagerService.pauseBot(botId), []),
        onResumeBot: useCallback((botId: string) => botManagerService.resumeBot(botId), []),
        onStopBot: useCallback((botId: string) => botManagerService.stopBot(botId), []),
        onDeleteBot: useCallback((botId: string) => botManagerService.deleteBot(botId), []),
        onUpdateBotConfig: handleUpdateBotConfig,
    };

    return (
        <div className="bg-slate-100 dark:bg-slate-900 min-h-screen">
            <Header 
                isApiConnected={isApiConnected} 
                theme={theme} 
                setTheme={setTheme}
                activeView={activeView}
                setActiveView={setActiveView}
                executionMode={executionMode}
            />
            
            {activeView === 'trading' && (
                <main className="container mx-auto p-2 sm:p-4 grid grid-cols-12 gap-4">
                    <div className="col-span-12 lg:col-span-3 order-last lg:order-first">
                        <Sidebar
                            klines={klines}
                            isBotCombinationActive={isBotCombinationActive()}
                            onStartBot={handleStartBot}
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
                            isLoading={isChartLoading}
                            pricePrecision={pricePrecision}
                            livePrice={livePrice}
                            liveTicker={liveTicker}
                            chartTimeFrame={chartTimeFrame}
                            onTimeFrameChange={configActions.setTimeFrame}
                            allPairs={configState.allPairs}
                            onPairChange={setSelectedPair}
                            onLoadMoreData={handleLoadMoreChartData}
                            isFetchingMoreData={isFetchingMoreChartData}
                            theme={theme}
                            fundingInfo={fundingInfo}
                        />
                        <RunningBots bots={runningBots} {...botActions} />
                        <TradingLog tradeHistory={tradeHistory} />
                    </div>
                </main>
            )}

            {activeView === 'backtesting' && (
                 <main className="container mx-auto p-2 sm:p-4">
                    <BacktestingPanel 
                        backtestResult={backtestResult}
                        setBacktestResult={setBacktestResult}
                        setActiveView={setActiveView}
                        klines={klines}
                        theme={theme}
                    />
                 </main>
            )}
        </div>
    );
};

const App: React.FC = () => (
    <TradingConfigProvider>
        <AppContent />
    </TradingConfigProvider>
);


export default App;