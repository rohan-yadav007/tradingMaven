import React, { createContext, useState, useContext, useMemo, useEffect, useCallback } from 'react';
import { TradingMode, Agent, AgentParams, RiskMode } from '../types';
import * as constants from '../constants';
import * as binanceService from '../services/binanceService';

// --- State Interface ---
interface TradingConfigState {
    executionMode: 'live' | 'paper';
    tradingMode: TradingMode;
    selectedPairs: string[];
    allPairs: string[];
    isPairsLoading: boolean;
    leverage: number;
    marginType: 'ISOLATED' | 'CROSSED';
    chartTimeFrame: string;
    selectedAgent: Agent;
    investmentAmount: number;
    availableBalance: number;
    maxMarginLossPercent: number;
    // Legacy TP properties for type compatibility
    takeProfitMode: RiskMode;
    takeProfitValue: number;
    isTakeProfitLocked: boolean;
    isHtfConfirmationEnabled: boolean;
    isUniversalProfitTrailEnabled: boolean;
    isMinRrEnabled: boolean;
    isReanalysisEnabled: boolean;
    isInvalidationCheckEnabled: boolean;
    isAgentTrailEnabled: boolean;
    isBreakevenTrailEnabled: boolean;
    isMarketCohesionEnabled: boolean;
    htfTimeFrame: 'auto' | string;
    agentParams: AgentParams;
    htfAgentParams: AgentParams;
    isApiConnected: boolean; // Managed from App.tsx but needed here
    walletViewMode: TradingMode;
    isMultiAssetMode: boolean;
    entryTiming: 'immediate' | 'onNextCandle';
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
    setSelectedPairs: (pairs: string[]) => void;
    setAllPairs: (pairs: string[]) => void;
    setLeverage: (leverage: number) => void;
    setMarginType: (type: 'ISOLATED' | 'CROSSED') => void;
    setTimeFrame: (tf: string) => void;
    setSelectedAgent: (agent: Agent) => void;
    setInvestmentAmount: (amount: number) => void;
    setAvailableBalance: (balance: number) => void;
    setMaxMarginLossPercent: (percent: number) => void;
    setIsHtfConfirmationEnabled: (isEnabled: boolean) => void;
    setIsUniversalProfitTrailEnabled: (isEnabled: boolean) => void;
    setIsMinRrEnabled: (isEnabled: boolean) => void;
    setIsReanalysisEnabled: (isEnabled: boolean) => void;
    setIsInvalidationCheckEnabled: (isEnabled: boolean) => void;
    setIsAgentTrailEnabled: (isEnabled: boolean) => void;
    setIsBreakevenTrailEnabled: (isEnabled: boolean) => void;
    setIsMarketCohesionEnabled: (isEnabled: boolean) => void;
    setHtfTimeFrame: (tf: 'auto' | string) => void;
    setAgentParams: (params: AgentParams) => void;
    setHtfAgentParams: (params: AgentParams) => void;
    setIsApiConnected: (isConnected: boolean) => void;
    setWalletViewMode: (mode: TradingMode) => void;
    setIsMultiAssetMode: (isEnabled: boolean) => void;
    setEntryTiming: (timing: 'immediate' | 'onNextCandle') => void;
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
    const [selectedPairs, setSelectedPairs] = useState<string[]>(['BTC/USDT']);
    const [leverage, setLeverage] = useState<number>(20);
    const [marginType, setMarginType] = useState<'ISOLATED' | 'CROSSED'>('ISOLATED');
    const [chartTimeFrame, setTimeFrame] = useState<string>('5m');
    const [selectedAgent, setSelectedAgent] = useState<Agent>(constants.AGENTS[0]);
    const [agentParams, setAgentParams] = useState<AgentParams>({});
    const [htfAgentParams, setHtfAgentParams] = useState<AgentParams>({});
    const [investmentAmount, setInvestmentAmount] = useState<number>(100);
    const [availableBalance, setAvailableBalance] = useState<number>(Infinity);
    const [maxMarginLossPercent, setMaxMarginLossPercent] = useState<number>(constants.MAX_MARGIN_LOSS_PERCENT);
    const [isHtfConfirmationEnabled, setIsHtfConfirmationEnabled] = useState<boolean>(false);
    const [isUniversalProfitTrailEnabled, setIsUniversalProfitTrailEnabled] = useState<boolean>(true);
    const [isMinRrEnabled, setIsMinRrEnabled] = useState<boolean>(true);
    const [isReanalysisEnabled, setIsReanalysisEnabled] = useState<boolean>(true);
    const [isInvalidationCheckEnabled, setIsInvalidationCheckEnabled] = useState<boolean>(true);
    const [isAgentTrailEnabled, setIsAgentTrailEnabled] = useState<boolean>(true);
    const [isBreakevenTrailEnabled, setIsBreakevenTrailEnabled] = useState<boolean>(true);
    const [isMarketCohesionEnabled, setIsMarketCohesionEnabled] = useState<boolean>(true);
    const [htfTimeFrame, setHtfTimeFrame] = useState<'auto' | string>('auto');
    const [isApiConnected, setIsApiConnected] = useState(false);
    const [walletViewMode, setWalletViewMode] = useState<TradingMode>(TradingMode.Spot);
    const [isMultiAssetMode, setIsMultiAssetMode] = useState(false);
    const [entryTiming, setEntryTiming] = useState<'immediate' | 'onNextCandle'>('onNextCandle');

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
                        // Ensure at least one valid pair is selected
                        const currentValidPairs = selectedPairs.filter(p => pairs.includes(p));
                        if (currentValidPairs.length === 0) {
                            setSelectedPairs([pairs[0] || 'BTC/USDT']);
                        } else {
                            setSelectedPairs(currentValidPairs);
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
        const primaryPair = selectedPairs[0];
        if (tradingMode === TradingMode.USDSM_Futures && executionMode === 'live' && isApiConnected && primaryPair) {
            setFuturesSettingsError(null);
            binanceService.setFuturesLeverage(primaryPair.replace('/', ''), leverage)
                .catch(e => {
                    const errorMessage = binanceService.interpretBinanceError(e);
                    console.error("Failed to update leverage:", errorMessage);
                    setFuturesSettingsError(errorMessage);
                });
        }
    }, [leverage, selectedPairs, tradingMode, executionMode, isApiConnected]);

    // Set futures margin type
    useEffect(() => {
        const primaryPair = selectedPairs[0];
        const updateMarginType = async () => {
            if (tradingMode === TradingMode.USDSM_Futures && executionMode === 'live' && isApiConnected && !isMultiAssetMode && primaryPair) {
                setFuturesSettingsError(null);
                const pairSymbol = primaryPair.replace('/', '');
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
    }, [marginType, selectedPairs, tradingMode, executionMode, isApiConnected, isMultiAssetMode]);

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
        const primaryPair = selectedPairs[0];
        if (tradingMode === TradingMode.USDSM_Futures && primaryPair) {
            setIsLeverageLoading(true);
            binanceService.fetchFuturesLeverageBrackets(primaryPair)
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
    }, [selectedPairs, tradingMode]);

    // Reset agent-specific parameters when the agent or timeframe changes
    useEffect(() => {
        const timeframeSettings = constants.getAgentTimeframeSettings(selectedAgent.id, chartTimeFrame);
        // This resets any user customizations, which is the desired behavior.
        setAgentParams(timeframeSettings);
    }, [selectedAgent, chartTimeFrame]);

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
        setExecutionMode, setTradingMode, setSelectedPairs, setAllPairs,
        setLeverage, setMarginType, setTimeFrame, setSelectedAgent,
        setInvestmentAmount, setAvailableBalance,
        setMaxMarginLossPercent,
        setIsHtfConfirmationEnabled, setHtfTimeFrame, setAgentParams, setHtfAgentParams, setIsApiConnected, setWalletViewMode,
        setIsMultiAssetMode, onSetMultiAssetMode, setFuturesSettingsError, setIsUniversalProfitTrailEnabled,
        setIsMinRrEnabled, setIsReanalysisEnabled, setIsInvalidationCheckEnabled, setIsAgentTrailEnabled, setIsBreakevenTrailEnabled, setEntryTiming,
        setIsMarketCohesionEnabled,
    }), [onSetMultiAssetMode]);
    
    const state = {
        executionMode, tradingMode, selectedPairs, allPairs, isPairsLoading, leverage, marginType, chartTimeFrame,
        selectedAgent, agentParams, htfAgentParams, investmentAmount, availableBalance,
        maxMarginLossPercent,
        // Provide default values for legacy TP properties for internal type compatibility
        takeProfitMode: RiskMode.Percent,
        takeProfitValue: 0,
        isTakeProfitLocked: false,
        isHtfConfirmationEnabled, isUniversalProfitTrailEnabled, 
        isMinRrEnabled, isReanalysisEnabled, isInvalidationCheckEnabled, isAgentTrailEnabled, isBreakevenTrailEnabled, isMarketCohesionEnabled, htfTimeFrame,
        isApiConnected, walletViewMode, isMultiAssetMode, maxLeverage, isLeverageLoading,
        futuresSettingsError, multiAssetModeError, entryTiming
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