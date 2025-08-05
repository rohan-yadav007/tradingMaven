

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ChartComponent } from './components/ChartComponent';
import { TradingLog } from './components/TradingLog';
import { RunningBots } from './components/RunningBots';
import { TradingMode, Agent, TradeSignal, Position, Trade, WalletBalance, Kline, SymbolInfo, LiveTicker, AccountInfo, RunningBot, BotConfig, BotStatus, BinanceOrderResponse, AgentParams, BacktestResult, RiskMode, LogType } from './types';
import * as constants from './constants';
import * as binanceService from './services/binanceService';
import { historyService } from './services/historyService';
import { botManagerService, BotHandlers } from './services/botManagerService';
import { BacktestingPanel } from './components/BacktestingPanel';

const App: React.FC = () => {
    // ---- State Management ----
    // UI State
    const [isApiConnected, setIsApiConnected] = useState(false);
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
    });
    const [activeView, setActiveView] = useState<'trading' | 'backtesting'>('trading');
    
    // Trading Configuration
    const [executionMode, setExecutionMode] = useState<'live' | 'paper'>('paper');
    const [tradingMode, setTradingMode] = useState<TradingMode>(TradingMode.Spot);
    const [walletViewMode, setWalletViewMode] = useState<TradingMode>(TradingMode.Spot);
    const [allPairs, setAllPairs] = useState<string[]>(constants.TRADING_PAIRS); // Init with fallback
    const [selectedPair, setSelectedPair] = useState('BTC/USDT');
    const [leverage, setLeverage] = useState(10);
    const [marginType, setMarginType] = useState<'ISOLATED' | 'CROSSED'>('ISOLATED');
    const [futuresSettingsError, setFuturesSettingsError] = useState<string | null>(null);
    const [isMultiAssetMode, setIsMultiAssetMode] = useState(false);
    const [multiAssetModeError, setMultiAssetModeError] = useState<string | null>(null);
    const [chartTimeFrame, setChartTimeFrame] = useState('3m');
    const [selectedAgent, setSelectedAgent] = useState<Agent>(constants.AGENTS[0]);
    const [agentParams, setAgentParams] = useState<AgentParams>({});
    
    // New Risk Management State
    const [investmentAmount, setInvestmentAmount] = useState(100);
    const [stopLossMode, setStopLossMode] = useState<RiskMode>(RiskMode.Percent);
    const [stopLossValue, setStopLossValue] = useState(2); // e.g., 2%
    const [takeProfitMode, setTakeProfitMode] = useState<RiskMode>(RiskMode.Percent);
    const [takeProfitValue, setTakeProfitValue] = useState(4); // e.g., 4%
    const [isStopLossLocked, setIsStopLossLocked] = useState(false);
    const [isTakeProfitLocked, setIsTakeProfitLocked] = useState(false);
    const [isCooldownEnabled, setIsCooldownEnabled] = useState(true);

    // Backtesting State (now fully self-contained in BacktestingPanel, but results are lifted)
    const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
    
    // Bot State
    const [runningBots, setRunningBots] = useState<RunningBot[]>([]);

    // Market Data
    const [klines, setKlines] = useState<Kline[]>([]);
    const [isChartLoading, setIsChartLoading] = useState(true);
    const [isFetchingMoreChartData, setIsFetchingMoreChartData] = useState(false);
    const [livePrice, setLivePrice] = useState(0);
    const [liveTicker, setLiveTicker] = useState<LiveTicker | undefined>();
    const [symbolInfo, setSymbolInfo] = useState<SymbolInfo | undefined>();
    const pricePrecision = binanceService.getPricePrecision(symbolInfo);
    
    // Wallet & Positions Data
    const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
    const [liveBalances, setLiveBalances] = useState<WalletBalance[]>([]);
    const [isWalletLoading, setIsWalletLoading] = useState(false);
    const [walletError, setWalletError] = useState<string | null>(null);
    const [openPositions, setOpenPositions] = useState<Position[]>([]);
    const [tradeHistory, setTradeHistory] = useState<Trade[]>([]);
    const [lastHistoryDate, setLastHistoryDate] = useState<Date | null>(null);
    const [closingPositionIds, setClosingPositionIds] = useState<Set<number>>(new Set());
    
    // Ref for bot handlers to prevent stale closures
    const botHandlersRef = useRef<BotHandlers | null>(null);


    // ---- Effects ----

    // Theme effect for Tailwind CSS
    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('light', 'dark');
        root.classList.add(theme);
        localStorage.setItem('theme', theme);
    }, [theme]);
    
    // Initialize services and load history on mount
    useEffect(() => {
        binanceService.checkApiConnection()
            .then(setIsApiConnected)
            .catch(() => setIsApiConnected(false));

        const { trades, lastDate } = historyService.loadTrades();
        const sortedTrades = trades.sort((a, b) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime());
        setTradeHistory(sortedTrades);
        setLastHistoryDate(lastDate);

        botManagerService.init(setRunningBots);

        return () => {
            botManagerService.stopAllBots();
        }
    }, []);

    // Effect to fetch the correct tradable pairs when the trading mode changes
    useEffect(() => {
        const fetchPairs = async () => {
            if (!isApiConnected) {
                setAllPairs(constants.TRADING_PAIRS);
                return;
            }

            let pairFetcher: () => Promise<string[]>;
            switch(tradingMode) {
                case TradingMode.Spot:
                    pairFetcher = binanceService.fetchSpotPairs;
                    break;
                case TradingMode.USDSM_Futures:
                    pairFetcher = binanceService.fetchFuturesPairs;
                    break;
                default:
                    pairFetcher = binanceService.fetchSpotPairs; // Use Spot as default
            }

            try {
                const pairs = await pairFetcher();
                 if (pairs.length > 0) {
                    setAllPairs(pairs);
                    // Check if current pair is still valid, if not, update it
                    if (!pairs.includes(selectedPair)) {
                        setSelectedPair(pairs[0] || 'BTC/USDT');
                    }
                }
            } catch (err) {
                console.error(`Could not fetch pairs for mode ${tradingMode}:`, err);
                setAllPairs(constants.TRADING_PAIRS); // Fallback to constants on error
            }
        };

        fetchPairs();
    }, [tradingMode, isApiConnected, selectedPair]);
    
    // Sync wallet view with trading mode for better UX and balance validation
    useEffect(() => {
        setWalletViewMode(tradingMode);
    }, [tradingMode]);


    // Effect to set futures leverage on change
    useEffect(() => {
        if (tradingMode === TradingMode.USDSM_Futures && executionMode === 'live' && isApiConnected) {
            const updateLeverage = async () => {
                setFuturesSettingsError(null);
                const pairSymbol = selectedPair.replace('/', '');
                try {
                    await binanceService.setFuturesLeverage(pairSymbol, leverage);
                } catch (e) {
                    const errorMessage = binanceService.interpretBinanceError(e);
                    console.error("Failed to update leverage:", errorMessage);
                    setFuturesSettingsError(errorMessage);
                }
            };
            updateLeverage();
        }
    }, [leverage, selectedPair, tradingMode, executionMode, isApiConnected]);

    // Smart effect to set futures margin type only when needed
    useEffect(() => {
        if (tradingMode === TradingMode.USDSM_Futures && executionMode === 'live' && isApiConnected && !isMultiAssetMode) {
            const updateMarginType = async () => {
                setFuturesSettingsError(null);
                const pairSymbol = selectedPair.replace('/', '');
                try {
                    // 1. Check current margin type on Binance first
                    const positionRisk = await binanceService.getFuturesPositionRisk(pairSymbol);
                    if (positionRisk && positionRisk.marginType.toUpperCase() !== marginType) {
                        // 2. Only send the update if it's different
                        await binanceService.setMarginType(pairSymbol, marginType);
                    }
                } catch (e: any) {
                    // Ignore the "No need to change" error, show others
                    if (e.code !== -4046) {
                        const errorMessage = binanceService.interpretBinanceError(e);
                        console.error("Failed to update margin type:", errorMessage);
                        setFuturesSettingsError(errorMessage);
                    }
                }
            };
            updateMarginType();
        }
    }, [marginType, selectedPair, tradingMode, executionMode, isApiConnected, isMultiAssetMode]);


    // Effect to get the account-wide multi-asset margin mode for futures
    useEffect(() => {
        if (tradingMode === TradingMode.USDSM_Futures && isApiConnected) {
            const fetchMode = async () => {
                try {
                    const data = await binanceService.getMultiAssetsMargin();
                    setIsMultiAssetMode(data.multiAssetsMargin);
                } catch (e) {
                    console.error("Failed to fetch multi-asset margin mode", e);
                    // Don't set an error, just log it. The UI will show the default.
                }
            };
            fetchMode();
        }
    }, [tradingMode, isApiConnected]);


    // Fetch chart and symbol data when pair or timeframe changes
    const fetchChartData = useCallback(async () => {
        setIsChartLoading(true);
        try {
            const formattedPair = selectedPair.replace('/', '');

            // Use the correct symbol info endpoint for the selected trading mode
            const symbolInfoFetcher = tradingMode === TradingMode.USDSM_Futures
                ? binanceService.getFuturesSymbolInfo(formattedPair)
                : binanceService.getSymbolInfo(formattedPair);

            const [klineData, info] = await Promise.all([
                binanceService.fetchKlines(formattedPair, chartTimeFrame),
                symbolInfoFetcher
            ]);

            if (!info) {
                 throw new Error(`Symbol information not found for ${selectedPair} in ${tradingMode} mode. This pair may not be available for this type of trading.`);
            }

            setKlines(klineData);
            setSymbolInfo(info as SymbolInfo); // Cast is acceptable as the used properties are common
            botManagerService.updateKlines(formattedPair, chartTimeFrame, klineData);
        } catch (error) {
            console.error("Failed to fetch chart data:", error);
            setKlines([]);
            setSymbolInfo(undefined); // Clear symbol info on error
        } finally {
            setIsChartLoading(false);
        }
    }, [selectedPair, chartTimeFrame, tradingMode]);


    useEffect(() => {
        fetchChartData();
    }, [fetchChartData]);

    // Subscribe to live kline and ticker data from the centralized service
    useEffect(() => {
        const formattedPair = selectedPair.replace('/', '').toLowerCase();
        
        // Ticker subscription for UI
        const tickerCallback = (ticker: LiveTicker) => {
            if (ticker.pair.toLowerCase() === formattedPair) {
                setLivePrice(ticker.closePrice);
                setLiveTicker(ticker);
            }
        };
        botManagerService.subscribeToTickerUpdates(formattedPair, tickerCallback);

        // Kline subscription for UI chart
        const klineCallback = (newKline: Kline) => {
             setKlines(prevKlines => {
                if (prevKlines.length === 0) return [newKline];
                const lastKline = prevKlines[prevKlines.length - 1];
                if (lastKline && newKline.time === lastKline.time) {
                    const updatedKlines = [...prevKlines];
                    updatedKlines[prevKlines.length - 1] = newKline;
                    return updatedKlines;
                } else {
                    return [...prevKlines.slice(1), newKline];
                }
            });
        };
        botManagerService.subscribeToKlineUpdates(formattedPair, chartTimeFrame, klineCallback);
        
        return () => {
            botManagerService.unsubscribeFromTickerUpdates(formattedPair, tickerCallback);
            botManagerService.unsubscribeFromKlineUpdates(formattedPair, chartTimeFrame, klineCallback);
        };
    }, [selectedPair, chartTimeFrame]);

    // Fetch wallet balances when mode or API connection change
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
            switch (walletViewMode) {
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
    }, [isApiConnected, walletViewMode]);

    useEffect(() => {
        fetchWalletBalances();
    }, [fetchWalletBalances]);

    // Synchronize open positions from running bots
    useEffect(() => {
        const positionsFromBots = runningBots
            .filter(bot => bot.openPosition)
            .map(bot => bot.openPosition!);
        setOpenPositions(positionsFromBots);
    }, [runningBots]);


    // ---- Handlers ----
    const getAvailableBalanceForInvestment = useCallback(() => {
        // For paper mode, there's no limit.
        if (executionMode !== 'live') return Infinity;
        
        // Failsafe: If API isn't connected or info is missing, prevent live trading.
        if (!isApiConnected || !accountInfo || !symbolInfo) return 0;

        // CRITICAL: Ensure the user is viewing the correct wallet for the trade they are about to place.
        if (walletViewMode !== tradingMode) {
            // This prevents using Spot balance for a Futures trade, for example.
            return 0;
        }
        
        const quoteAsset = symbolInfo.quoteAsset;
        if (!quoteAsset) return 0; // Should not happen with valid symbolInfo
        
        // liveBalances is already correctly populated based on walletViewMode
        const balance = liveBalances.find(b => b.asset === quoteAsset);
        
        // For futures, the available balance is the 'free' amount (availableBalance field).
        // For spot, it's also 'free'.
        return balance ? balance.free : 0;

    }, [executionMode, isApiConnected, accountInfo, symbolInfo, walletViewMode, tradingMode, liveBalances]);


    const handleLoadMoreChartData = useCallback(async () => {
        if (isFetchingMoreChartData || klines.length === 0) return;
        
        setIsFetchingMoreChartData(true);
        try {
            const formattedPair = selectedPair.replace('/', '');
            const oldestKlineTime = klines[0].time;
            
            const newKlines = await binanceService.fetchKlines(formattedPair, chartTimeFrame, { endTime: oldestKlineTime - 1 });
            
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
    }, [isFetchingMoreChartData, klines, selectedPair, chartTimeFrame]);

    const handleClosePosition = useCallback(async (posToClose: Position, exitReason: string = "Manual Close", exitPriceOverride?: number) => {
        if (!posToClose || closingPositionIds.has(posToClose.id)) {
            return;
        }
        setClosingPositionIds(prev => new Set(prev).add(posToClose.id));

        const exitPrice = exitPriceOverride ?? botManagerService.getBot(posToClose.botId!)?.livePrice ?? 0;
        if (exitPrice === 0 && posToClose.executionMode !== 'live') { // For paper, we need an exit price
            console.error("Could not determine exit price for paper trade", posToClose.id);
            setClosingPositionIds(prev => { const newSet = new Set(prev); newSet.delete(posToClose.id); return newSet; });
            return;
        }

        const closePositionInState = (finalExitPrice: number) => {
            // Corrected PNL calculation. Leverage is already part of the position's `size` for futures.
            const pnl = (finalExitPrice - posToClose.entryPrice) * posToClose.size * (posToClose.direction === 'LONG' ? 1 : -1);
            const newTrade: Trade = { ...posToClose, exitPrice: finalExitPrice, exitTime: new Date(), pnl, exitReason };
            
            setTradeHistory(prevHistory => {
                if (prevHistory.some(t => t.id === newTrade.id)) return prevHistory;
                historyService.saveTrade(newTrade);
                return [newTrade, ...prevHistory].sort((a, b) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime());
            });

            if (posToClose.botId) {
                botManagerService.notifyPositionClosed(posToClose.botId, pnl);
            }

            setClosingPositionIds(prev => { const newSet = new Set(prev); newSet.delete(posToClose.id); return newSet; });
        }

        if (posToClose.executionMode === 'live') {
            botManagerService.addBotLog(posToClose.botId!, `Attempting to close live position for ${posToClose.pair}...`, LogType.Info);
            try {
                const formattedPair = posToClose.pair.replace('/', '');
                
                // CRITICAL FIX: Fetch the correct symbol info for the mode (Spot vs Futures)
                const liveSymbolInfo = posToClose.mode === TradingMode.USDSM_Futures 
                    ? await binanceService.getFuturesSymbolInfo(formattedPair)
                    : await binanceService.getSymbolInfo(formattedPair);

                if (!liveSymbolInfo) throw new Error(`Could not fetch symbol info for ${formattedPair} to close position.`);

                const quantityPrecision = binanceService.getQuantityPrecision(liveSymbolInfo);
                const closingSide = posToClose.direction === 'LONG' ? 'SELL' : 'BUY';
                
                // Use the exact size of the open position, formatted to the required precision.
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
                 botManagerService.addBotLog(posToClose.botId!, `Live position closed successfully via API.`, LogType.Success);
                 const finalExitPrice = parseFloat(orderResponse.cummulativeQuoteQty) / parseFloat(orderResponse.executedQty);
                 // If API call is successful, then update state
                 closePositionInState(finalExitPrice);
            } catch(e) {
                // FAILSAFE: If API fails, do NOT remove position from UI. Log critical error.
                const errorMessage = binanceService.interpretBinanceError(e);
                console.error("CRITICAL: Failed to close live position on Binance:", e);
                const criticalMessage = `CRITICAL: Failed to close live position. Please close manually on Binance to prevent loss. Reason: ${errorMessage}`;
                botManagerService.addBotLog(posToClose.botId!, criticalMessage, LogType.Error);
                botManagerService.updateBotState(posToClose.botId!, { status: BotStatus.Error, analysis: {signal: 'HOLD', reasons: [criticalMessage]}});

                // Unlock the position ID to allow another attempt if needed
                setClosingPositionIds(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(posToClose.id);
                    return newSet;
                });
            }
        } else {
            // For paper trades, close directly in state
            closePositionInState(exitPrice);
        }

    }, [closingPositionIds]);

    const handleExecuteTrade = useCallback(async (
        execSignal: TradeSignal,
        botId: string,
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
        
        const { config } = bot;
        
        // The bot has already calculated the final SL/TP prices. We just use them.
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
            // --- Pre-flight Balance Check using App state ---
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
            // --- End of Pre-flight Balance Check ---

            try {
                // Use the entry price determined by the bot
                const entryPriceForOrder = execSignal.entryPrice;
                if (!entryPriceForOrder || entryPriceForOrder <= 0) {
                    throw new Error("Could not get live price for trade execution.");
                }

                // Calculate quantity based on investment and live price
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

                // Place the order
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

                // --- ROBUST PRICE CALCULATION ---
                if (orderResponse.avgPrice && parseFloat(orderResponse.avgPrice) > 0) {
                    finalEntryPrice = parseFloat(orderResponse.avgPrice);
                } else if (tradeSize > 0) {
                    finalEntryPrice = parseFloat(orderResponse.cummulativeQuoteQty) / tradeSize;
                } else {
                    throw new Error("Order filled, but failed to parse execution details. Check position manually.");
                }

                 // For futures, get liquidation price after opening position
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
            // Paper trade execution
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
            pricePrecision: config.pricePrecision,
            timeFrame: config.timeFrame,
            botId,
            orderId: orderResponse?.orderId ?? null,
            liquidationPrice: finalLiquidationPrice,
        };

        botManagerService.updateBotState(botId, {
            status: BotStatus.PositionOpen,
            openPositionId: newPosition.id,
            openPosition: newPosition,
        });

    }, [accountInfo]);
    
    // Set ref on every render to ensure bots have the latest handlers
    botHandlersRef.current = {
        onExecuteTrade: handleExecuteTrade,
        onClosePosition: handleClosePosition,
    };
    
    // Check if a bot with the specific config is active
    const isBotCombinationActive = useCallback(() => {
        // Enforce one LIVE bot per pair
        if (executionMode === 'live') {
            return runningBots.some(bot => 
                bot.config.executionMode === 'live' &&
                bot.config.pair === selectedPair &&
                bot.status !== BotStatus.Stopped &&
                bot.status !== BotStatus.Error
            );
        }
        
        // Allow multiple PAPER bots with unique configs
        return runningBots.some(bot => 
            bot.config.executionMode === 'paper' &&
            bot.config.pair === selectedPair &&
            bot.config.timeFrame === chartTimeFrame &&
            bot.config.agent.id === selectedAgent.id &&
            bot.status !== BotStatus.Stopped &&
            bot.status !== BotStatus.Error
        );
    }, [runningBots, selectedPair, chartTimeFrame, selectedAgent, executionMode]);
    
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
            stopLossMode,
            stopLossValue,
            takeProfitMode,
            takeProfitValue,
            isStopLossLocked,
            isTakeProfitLocked,
            isCooldownEnabled,
            agentParams,
            // Add precision data to the config
            pricePrecision: binanceService.getPricePrecision(symbolInfo),
            quantityPrecision: binanceService.getQuantityPrecision(symbolInfo),
            stepSize: binanceService.getStepSize(symbolInfo),
        };
        botManagerService.startBot(botConfig, botHandlersRef);
    }, [
        selectedPair, tradingMode, leverage, marginType, selectedAgent, chartTimeFrame, executionMode,
        investmentAmount, stopLossMode, stopLossValue, takeProfitMode, takeProfitValue,
        isStopLossLocked, isTakeProfitLocked, isCooldownEnabled, agentParams, symbolInfo
    ]);

    // This is the new centralized handler for all bot config updates from the UI
    const handleUpdateBotConfig = useCallback((botId: string, partialConfig: Partial<BotConfig>) => {
        botManagerService.updateBotConfig(botId, partialConfig);
    }, []);

    const handleSetMultiAssetMode = useCallback(async (isEnabled: boolean) => {
        setMultiAssetModeError(null);
        try {
            // Pre-flight checks for enabling Multi-Asset Mode to prevent -4167 error
            if (isEnabled) {
                // 1. Check for open positions
                if (accountInfo?.positions && accountInfo.positions.some(p => parseFloat(p.positionAmt) !== 0)) {
                    throw new Error("Cannot enable Multi-Asset Mode with open futures positions. Please close all positions first.");
                }

                // 2. Proactively switch all ISOLATED symbols with positions to CROSSED
                const allPositionRisks = await binanceService.getAllFuturesPositionRisk();
                const isolatedSymbols = allPositionRisks
                    .filter(p => p.marginType.toUpperCase() === 'ISOLATED' && parseFloat(p.positionAmt) !== 0)
                    .map(p => p.symbol);
                
                if (isolatedSymbols.length > 0) {
                    setMultiAssetModeError(`Switching ${isolatedSymbols.length} pairs to CROSSED margin...`);
                    await Promise.all(
                        isolatedSymbols.map(symbol => binanceService.setMarginType(symbol, 'CROSSED'))
                    );
                }
            }

            // 3. Attempt to set the mode
            await binanceService.setMultiAssetsMargin(isEnabled);
            setIsMultiAssetMode(isEnabled);
            
            // 4. When multi-asset mode is on, margin type is effectively CROSSED
            if (isEnabled) {
                setMarginType('CROSSED');
            }
        } catch (e) {
            const errorMessage = binanceService.interpretBinanceError(e);
            console.error("Failed to set multi-asset margin mode:", e);
            setMultiAssetModeError(errorMessage);
        }
    }, [accountInfo]);
    
    const handleApplyBacktestConfig = useCallback((config: BotConfig) => {
        setSelectedPair(config.pair);
        setTradingMode(config.mode);
        if (config.mode === TradingMode.USDSM_Futures) {
            setLeverage(config.leverage);
            if(config.marginType) setMarginType(config.marginType);
        }
        setChartTimeFrame(config.timeFrame);
        setSelectedAgent(config.agent);
        setAgentParams(config.agentParams || {});
        
        // Apply risk management settings
        setInvestmentAmount(config.investmentAmount);
        setStopLossMode(config.stopLossMode);
        setStopLossValue(config.stopLossValue);
        setTakeProfitMode(config.takeProfitMode);
        setTakeProfitValue(config.takeProfitValue);
        setIsStopLossLocked(config.isStopLossLocked);
        setIsTakeProfitLocked(config.isTakeProfitLocked);
        setIsCooldownEnabled(config.isCooldownEnabled);

    }, []);

    // Memoize bot actions to avoid re-renders of RunningBots component
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
                            executionMode={executionMode} setExecutionMode={setExecutionMode}
                            tradingMode={tradingMode} setTradingMode={setTradingMode}
                            allPairs={allPairs} selectedPair={selectedPair} setSelectedPair={setSelectedPair}
                            leverage={leverage} setLeverage={setLeverage}
                            marginType={marginType} setMarginType={setMarginType}
                            futuresSettingsError={futuresSettingsError}
                            isMultiAssetMode={isMultiAssetMode}
                            onSetMultiAssetMode={handleSetMultiAssetMode}
                            multiAssetModeError={multiAssetModeError}
                            investmentAmount={investmentAmount} setInvestmentAmount={setInvestmentAmount}
                            stopLossMode={stopLossMode} setStopLossMode={setStopLossMode}
                            stopLossValue={stopLossValue} setStopLossValue={setStopLossValue}
                            takeProfitMode={takeProfitMode} setTakeProfitMode={setTakeProfitMode}
                            takeProfitValue={takeProfitValue} setTakeProfitValue={setTakeProfitValue}
                            isStopLossLocked={isStopLossLocked} setIsStopLossLocked={setIsStopLossLocked}
                            isTakeProfitLocked={isTakeProfitLocked} setIsTakeProfitLocked={setIsTakeProfitLocked}
                            isCooldownEnabled={isCooldownEnabled} setIsCooldownEnabled={setIsCooldownEnabled}
                            timeFrame={chartTimeFrame} setTimeFrame={setChartTimeFrame}
                            selectedAgent={selectedAgent} setSelectedAgent={setSelectedAgent}
                            onStartBot={handleStartBot} klines={klines}
                            isBotCombinationActive={isBotCombinationActive()}
                            agentParams={agentParams} setAgentParams={setAgentParams}
                            theme={theme}
                            walletViewMode={walletViewMode} setWalletViewMode={setWalletViewMode}
                            isApiConnected={isApiConnected}
                            pricePrecision={pricePrecision}
                            accountInfo={accountInfo}
                            isWalletLoading={isWalletLoading}
                            walletError={walletError}
                            availableBalance={getAvailableBalanceForInvestment()}
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
                            onTimeFrameChange={setChartTimeFrame}
                            allPairs={allPairs}
                            onPairChange={setSelectedPair}
                            onLoadMoreData={handleLoadMoreChartData}
                            isFetchingMoreData={isFetchingMoreChartData}
                            theme={theme}
                        />
                        <RunningBots bots={runningBots} {...botActions} />
                        <TradingLog tradeHistory={tradeHistory} onLoadMoreHistory={() => historyService.loadTrades(lastHistoryDate ?? undefined)} />
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
                        onApplyConfig={handleApplyBacktestConfig}
                        theme={theme}
                    />
                 </main>
            )}
        </div>
    );
};

export default App;