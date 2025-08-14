
import React, { createContext, useState, useContext, useMemo, useEffect, useCallback } from 'react';
import { TradingMode, Agent, AgentParams, RiskMode } from '../types';
import * as constants from '../constants';
import * as binanceService from '../services/binanceService';

// --- State Interface ---
interface TradingConfigState {
    executionMode: 'live' | 'paper';
    tradingMode: TradingMode;
    selectedPair: string;
    allPairs: string[];
    isPairsLoading: boolean;
    leverage: number;
    marginType: 'ISOLATED' | 'CROSSED';
    chartTimeFrame: string;
    selectedAgent: Agent;
    investmentAmount: number;
    availableBalance: number;
    takeProfitMode: RiskMode;
    takeProfitValue: number;
    isTakeProfitLocked: boolean;
    isCooldownEnabled: boolean;
    isHtfConfirmationEnabled: boolean;
    isAtrTrailingStopEnabled: boolean;
    htfTimeFrame: 'auto' | string;
    agentParams: AgentParams;
    isApiConnected: boolean; // Managed from App.tsx but needed here
    walletViewMode: TradingMode;
    isMultiAssetMode: boolean;
    // Context-specific state
    maxLeverage: number;
    isLeverageLoading: boolean;
    futuresSettingsError: string | null;
    multiAssetModeError: string | null;
}

// --- Actions Interface ---
interface TradingConfigActions {
    setExecutionMode: (mode: 'live' | 'paper') => void;
    setTradingMode: (mode: TradingMode) => void;
    setSelectedPair: (pair: string) => void;
    setAllPairs: (pairs: string[]) => void;
    setLeverage: (leverage: number) => void;
    setMarginType: (type: 'ISOLATED' | 'CROSSED') => void;
    setTimeFrame: (tf: string) => void;
    setSelectedAgent: (agent: Agent) => void;
    setInvestmentAmount: (amount: number) => void;
    setAvailableBalance: (balance: number) => void;
    setTakeProfitMode: (mode: RiskMode) => void;
    setTakeProfitValue: (value: number) => void;
    setIsTakeProfitLocked: (isLocked: boolean) => void;
    setIsCooldownEnabled: (isEnabled: boolean) => void;
    setIsHtfConfirmationEnabled: (isEnabled: boolean) => void;
    setIsAtrTrailingStopEnabled: (isEnabled: boolean) => void;
    setHtfTimeFrame: (tf: 'auto' | string) => void;
    setAgentParams: (params: AgentParams) => void;
    setIsApiConnected: (isConnected: boolean) => void;
    setWalletViewMode: (mode: TradingMode) => void;
    setIsMultiAssetMode: (isEnabled: boolean) => void;
    // Complex actions
    onSetMultiAssetMode: (isEnabled: boolean) => Promise<void>;
    setFuturesSettingsError: (error: string | null) => void;
}

// --- Context Creation ---
const TradingConfigStateContext = createContext<TradingConfigState | undefined>(undefined);
const TradingConfigActionsContext = createContext<TradingConfigActions | undefined>(undefined);

// --- Provider Component ---
export const TradingConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // --- State Initialization ---
    const [executionMode, setExecutionMode] = useState<'live' | 'paper'>('paper');
    const [tradingMode, setTradingMode] = useState<TradingMode>(TradingMode.Spot);
    const [allPairs, setAllPairs] = useState<string[]>(constants.TRADING_PAIRS);
    const [selectedPair, setSelectedPair] = useState<string>('BTC/USDT');
    const [leverage, setLeverage] = useState<number>(20);
    const [marginType, setMarginType] = useState<'ISOLATED' | 'CROSSED'>('ISOLATED');
    const [chartTimeFrame, setTimeFrame] = useState<string>('5m');
    const [selectedAgent, setSelectedAgent] = useState<Agent>(constants.AGENTS[0]);
    const [agentParams, setAgentParams] = useState<AgentParams>({});
    const [investmentAmount, setInvestmentAmount] = useState<number>(100);
    const [availableBalance, setAvailableBalance] = useState<number>(Infinity);
    const [takeProfitMode, setTakeProfitMode] = useState<RiskMode>(RiskMode.Percent);
    const [takeProfitValue, setTakeProfitValue] = useState<number>(4);
    const [isTakeProfitLocked, setIsTakeProfitLocked] = useState<boolean>(false);
    const [isCooldownEnabled, setIsCooldownEnabled] = useState<boolean>(false);
    const [isHtfConfirmationEnabled, setIsHtfConfirmationEnabled] = useState<boolean>(false);
    const [isAtrTrailingStopEnabled, setIsAtrTrailingStopEnabled] = useState<boolean>(true);
    const [htfTimeFrame, setHtfTimeFrame] = useState<'auto' | string>('auto');
    const [isApiConnected, setIsApiConnected] = useState(false);
    const [walletViewMode, setWalletViewMode] = useState<TradingMode>(TradingMode.Spot);
    const [isMultiAssetMode, setIsMultiAssetMode] = useState(false);

    // Context-internal state
    const [isPairsLoading, setIsPairsLoading] = useState(true);
    const [maxLeverage, setMaxLeverage] = useState(125);
    const [isLeverageLoading, setIsLeverageLoading] = useState(false);
    const [futuresSettingsError, setFuturesSettingsError] = useState<string | null>(null);
    const [multiAssetModeError, setMultiAssetModeError] = useState<string | null>(null);

    // --- Effects moved from App.tsx ---

    // Fetch tradable pairs when trading mode changes
    useEffect(() => {
        let isCancelled = false;

        const fetchPairs = async () => {
            setIsPairsLoading(true);
            const pairFetcher = tradingMode === TradingMode.USDSM_Futures 
                ? binanceService.fetchFuturesPairs 
                : binanceService.fetchSpotPairs;
            
            try {
                const pairs = await pairFetcher();
                if (!isCancelled) {
                    if (pairs.length > 0) {
                        setAllPairs(pairs);
                        if (!pairs.includes(selectedPair)) {
                            setSelectedPair(pairs[0] || 'BTC/USDT');
                        }
                    } else {
                        setAllPairs(constants.TRADING_PAIRS);
                    }
                }
            } catch (err) {
                 if (!isCancelled) {
                    console.error(`Could not fetch pairs for mode ${tradingMode}:`, err);
                    setAllPairs(constants.TRADING_PAIRS); // Fallback on error
                 }
            } finally {
                if (!isCancelled) {
                    setIsPairsLoading(false);
                }
            }
        };

        fetchPairs();

        return () => {
            isCancelled = true;
        };
    }, [tradingMode]);


    // Sync wallet view with trading mode
    useEffect(() => {
        setWalletViewMode(tradingMode);
    }, [tradingMode]);

    // Set futures leverage
    useEffect(() => {
        if (tradingMode === TradingMode.USDSM_Futures && executionMode === 'live' && isApiConnected) {
            setFuturesSettingsError(null);
            binanceService.setFuturesLeverage(selectedPair.replace('/', ''), leverage)
                .catch(e => {
                    const errorMessage = binanceService.interpretBinanceError(e);
                    console.error("Failed to update leverage:", errorMessage);
                    setFuturesSettingsError(errorMessage);
                });
        }
    }, [leverage, selectedPair, tradingMode, executionMode, isApiConnected]);

    // Set futures margin type
    useEffect(() => {
        const updateMarginType = async () => {
            if (tradingMode === TradingMode.USDSM_Futures && executionMode === 'live' && isApiConnected && !isMultiAssetMode) {
                setFuturesSettingsError(null);
                const pairSymbol = selectedPair.replace('/', '');
                try {
                    const positionRisk = await binanceService.getFuturesPositionRisk(pairSymbol);
                    if (positionRisk && positionRisk.marginType.toUpperCase() !== marginType) {
                        await binanceService.setMarginType(pairSymbol, marginType);
                    }
                } catch (e: any) {
                    if (e.code !== -4046) {
                        const errorMessage = binanceService.interpretBinanceError(e);
                        console.error("Failed to update margin type:", errorMessage);
                        setFuturesSettingsError(errorMessage);
                    }
                }
            }
        };
        updateMarginType();
    }, [marginType, selectedPair, tradingMode, executionMode, isApiConnected, isMultiAssetMode]);

    // Get multi-asset margin mode
    useEffect(() => {
        if (tradingMode === TradingMode.USDSM_Futures && isApiConnected) {
            binanceService.getMultiAssetsMargin()
                .then(data => setIsMultiAssetMode(data.multiAssetsMargin))
                .catch(e => console.error("Failed to fetch multi-asset margin mode", e));
        }
    }, [tradingMode, isApiConnected]);
    
     // Fetch leverage brackets
    useEffect(() => {
        if (tradingMode === TradingMode.USDSM_Futures) {
            setIsLeverageLoading(true);
            binanceService.fetchFuturesLeverageBrackets(selectedPair)
                .then(bracketInfo => {
                    if (bracketInfo && bracketInfo.brackets && bracketInfo.brackets.length > 0) {
                        const max = bracketInfo.brackets.find(b => b.initialLeverage > 1)?.initialLeverage || 125;
                        setMaxLeverage(max);
                        // Use functional update to avoid adding 'leverage' as a dependency, preventing an infinite loop.
                        setLeverage(currentLeverage => currentLeverage > max ? max : currentLeverage);
                    } else {
                        setMaxLeverage(125);
                    }
                })
                .catch(err => {
                    console.error("Could not fetch leverage brackets", err);
                    setMaxLeverage(125);
                })
                .finally(() => setIsLeverageLoading(false));
        }
    }, [selectedPair, tradingMode]);

    // --- Action Definitions ---

    const onSetMultiAssetMode = useCallback(async (isEnabled: boolean) => {
        if (executionMode !== 'live' || !isApiConnected) return;
        setMultiAssetModeError(null);
        try {
            await binanceService.setMultiAssetsMargin(isEnabled);
            setIsMultiAssetMode(isEnabled);
        } catch (e) {
            const errorMessage = binanceService.interpretBinanceError(e);
            console.error("Failed to set multi-asset margin mode:", errorMessage);
            setMultiAssetModeError(errorMessage);
        }
    }, [executionMode, isApiConnected]);
    
    // Memoize actions to prevent re-renders in consumers
    const actions = useMemo(() => ({
        setExecutionMode, setTradingMode, setSelectedPair, setAllPairs,
        setLeverage, setMarginType, setTimeFrame, setSelectedAgent,
        setInvestmentAmount, setAvailableBalance,
        setTakeProfitMode, setTakeProfitValue, setIsTakeProfitLocked,
        setIsCooldownEnabled, setIsHtfConfirmationEnabled, setHtfTimeFrame, setAgentParams, setIsApiConnected, setWalletViewMode,
        setIsMultiAssetMode, onSetMultiAssetMode, setFuturesSettingsError, setIsAtrTrailingStopEnabled,
    }), [onSetMultiAssetMode]);
    
    const state = {
        executionMode, tradingMode, selectedPair, allPairs, isPairsLoading, leverage, marginType, chartTimeFrame,
        selectedAgent, agentParams, investmentAmount, availableBalance,
        takeProfitMode, takeProfitValue, isTakeProfitLocked, isCooldownEnabled,
        isHtfConfirmationEnabled, isAtrTrailingStopEnabled, htfTimeFrame,
        isApiConnected, walletViewMode, isMultiAssetMode, maxLeverage, isLeverageLoading,
        futuresSettingsError, multiAssetModeError
    };

    return (
        <TradingConfigStateContext.Provider value={state}>
            <TradingConfigActionsContext.Provider value={actions}>
                {children}
            </TradingConfigActionsContext.Provider>
        </TradingConfigStateContext.Provider>
    );
};

// --- Custom Hooks ---
export const useTradingConfigState = () => {
    const context = useContext(TradingConfigStateContext);
    if (context === undefined) {
        throw new Error('useTradingConfigState must be used within a TradingConfigProvider');
    }
    return context;
};

export const useTradingConfigActions = () => {
    const context = useContext(TradingConfigActionsContext);
    if (context === undefined) {
        throw new Error('useTradingConfigActions must be used within a TradingConfigProvider');
    }
    return context;
};
