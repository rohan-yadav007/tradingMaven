import React, { createContext, useState, useContext, useMemo, useEffect, useCallback, ReactNode } from 'react';
import { TradingMode, Agent, AgentParams, TradingPairList } from '../types';
import * as constants from '../constants';
import * as binanceService from '../services/binanceService';
import { userPreferencesService } from '../services/userPreferencesService';

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
    isInitialRiskVetoEnabled: boolean;
    isHtfConfirmationEnabled: boolean;
    isUniversalProfitTrailEnabled: boolean;
    isMinRrEnabled: boolean;
    invalidationSensitivity: 'low' | 'medium' | 'high';
    isAgentTrailEnabled: boolean;
    isBreakevenTrailEnabled: boolean;
    isMarketCohesionEnabled: boolean;
    isVwapConfirmationEnabled: boolean;
    isBtcConfirmationEnabled: boolean;
    isBtcCorrelationVetoEnabled: boolean;
    btcConfirmationThreshold: number;
    isVolumeFilterEnabled: boolean;
    isAdxFilterEnabled: boolean;
    isExhaustionFilterEnabled: boolean;
    isSmcVetoEnabled: boolean;
    isSrAnalysisEnabled: boolean;
    isCandlestickConfirmationEnabled: boolean;
    isMarketStructureVetoEnabled: boolean;
    htfTimeFrame: 'auto' | string;
    agentParams: AgentParams;
    htfAgentParams: AgentParams;
    isApiConnected: boolean; // Managed from App.tsx but needed here
    walletViewMode: TradingMode;
    isMultiAssetMode: boolean;
    entryTiming: 'immediate' | 'onNextCandle';
    tradingPairLists: TradingPairList[];
    isAdaptiveTpEnabled: boolean;
    aggressiveTrailMode: 'distance' | 'pnl';
    isMarketBreadthFilterEnabled: boolean;
    isLiquidationFilterEnabled: boolean;
    isConfirmationCandleEnabled: boolean;
    isMomentumConcordanceEnabled: boolean;
    isTradeGuardianEnabled: boolean;
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
    setIsInitialRiskVetoEnabled: (isEnabled: boolean) => void;
    setIsHtfConfirmationEnabled: (isEnabled: boolean) => void;
    setIsUniversalProfitTrailEnabled: (isEnabled: boolean) => void;
    setIsMinRrEnabled: (isEnabled: boolean) => void;
    setInvalidationSensitivity: (sensitivity: 'low' | 'medium' | 'high') => void;
    setIsAgentTrailEnabled: (isEnabled: boolean) => void;
    setIsBreakevenTrailEnabled: (isEnabled: boolean) => void;
    setIsMarketCohesionEnabled: (isEnabled: boolean) => void;
    setIsVwapConfirmationEnabled: (isEnabled: boolean) => void;
    setIsBtcConfirmationEnabled: (isEnabled: boolean) => void;
    setIsBtcCorrelationVetoEnabled: (isEnabled: boolean) => void;
    setBtcConfirmationThreshold: (threshold: number) => void;
    setIsVolumeFilterEnabled: (isEnabled: boolean) => void;
    setIsAdxFilterEnabled: (isEnabled: boolean) => void;
    setIsExhaustionFilterEnabled: (isEnabled: boolean) => void;
    setIsSmcVetoEnabled: (isEnabled: boolean) => void;
    setIsSrAnalysisEnabled: (isEnabled: boolean) => void;
    setIsCandlestickConfirmationEnabled: (isEnabled: boolean) => void;
    setIsMarketStructureVetoEnabled: (isEnabled: boolean) => void;
    setHtfTimeFrame: (tf: 'auto' | string) => void;
    setAgentParams: (params: AgentParams) => void;
    setHtfAgentParams: (params: AgentParams) => void;
    setIsApiConnected: (isConnected: boolean) => void;
    setWalletViewMode: (mode: TradingMode) => void;
    setIsMultiAssetMode: (isEnabled: boolean) => void;
    setEntryTiming: (timing: 'immediate' | 'onNextCandle') => void;
    setIsAdaptiveTpEnabled: (isEnabled: boolean) => void;
    setAggressiveTrailMode: (mode: 'distance' | 'pnl') => void;
    setIsMarketBreadthFilterEnabled: (isEnabled: boolean) => void;
    setIsLiquidationFilterEnabled: (isEnabled: boolean) => void;
    setIsConfirmationCandleEnabled: (isEnabled: boolean) => void;
    setIsMomentumConcordanceEnabled: (isEnabled: boolean) => void;
    setIsTradeGuardianEnabled: (isEnabled: boolean) => void;
    // Complex actions
    onSetMultiAssetMode: (isEnabled: boolean) => Promise<void>;
    setFuturesSettingsError: (error: string | null) => void;
    // New actions for pair lists
    addTradingPairList: (list: Omit<TradingPairList, 'id'>) => void;
    updateTradingPairList: (list: TradingPairList) => void;
    deleteTradingPairList: (listId: string) => void;
}

// --- Context Creation ---
const TradingConfigStateContext = createContext<TradingConfigState | undefined>(undefined);
const TradingConfigActionsContext = createContext<TradingConfigActions | undefined>(undefined);

// --- Provider Component ---
export const TradingConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // --- State Initialization ---
    const [executionMode, setExecutionMode] = useState<'live' | 'paper'>('paper');
    const [tradingMode, setTradingMode] = useState<TradingMode>(TradingMode.Spot);
    const [allPairs, setAllPairs] = useState<string[]>(constants.TRADING_PAIRS);
    const [selectedPairs, setSelectedPairs] = useState<string[]>(['BTC/USDT']);
    const [leverage, setLeverage] = useState<number>(5);
    const [marginType, setMarginType] = useState<'ISOLATED' | 'CROSSED'>('ISOLATED');
    const [chartTimeFrame, setTimeFrame] = useState<string>('5m');
    const [selectedAgent, setSelectedAgent] = useState<Agent>(constants.AGENTS[0]);
    const [agentParams, setAgentParams] = useState<AgentParams>({});
    const [htfAgentParams, setHtfAgentParams] = useState<AgentParams>({});
    const [investmentAmount, setInvestmentAmount] = useState<number>(100);
    const [availableBalance, setAvailableBalance] = useState<number>(Infinity);
    const [maxMarginLossPercent, setMaxMarginLossPercent] = useState<number>(constants.MAX_MARGIN_LOSS_PERCENT);
    const [isInitialRiskVetoEnabled, setIsInitialRiskVetoEnabled] = useState<boolean>(false);
    const [isHtfConfirmationEnabled, setIsHtfConfirmationEnabled] = useState<boolean>(false);
    const [isUniversalProfitTrailEnabled, setIsUniversalProfitTrailEnabled] = useState<boolean>(true);
    const [isMinRrEnabled, setIsMinRrEnabled] = useState<boolean>(true);
    const [invalidationSensitivity, setInvalidationSensitivity] = useState<'low' | 'medium' | 'high'>('medium');
    const [isAgentTrailEnabled, setIsAgentTrailEnabled] = useState<boolean>(true);
    const [isBreakevenTrailEnabled, setIsBreakevenTrailEnabled] = useState<boolean>(true);
    const [isMarketCohesionEnabled, setIsMarketCohesionEnabled] = useState<boolean>(true);
    const [isVwapConfirmationEnabled, setIsVwapConfirmationEnabled] = useState<boolean>(false);
    const [isBtcConfirmationEnabled, setIsBtcConfirmationEnabled] = useState<boolean>(false);
    const [isBtcCorrelationVetoEnabled, setIsBtcCorrelationVetoEnabled] = useState<boolean>(false);
    const [btcConfirmationThreshold, setBtcConfirmationThreshold] = useState<number>(60);
    const [isVolumeFilterEnabled, setIsVolumeFilterEnabled] = useState<boolean>(false);
    const [isAdxFilterEnabled, setIsAdxFilterEnabled] = useState<boolean>(false);
    const [isExhaustionFilterEnabled, setIsExhaustionFilterEnabled] = useState<boolean>(false);
    const [isSmcVetoEnabled, setIsSmcVetoEnabled] = useState<boolean>(false);
    const [isSrAnalysisEnabled, setIsSrAnalysisEnabled] = useState<boolean>(false);
    const [isCandlestickConfirmationEnabled, setIsCandlestickConfirmationEnabled] = useState<boolean>(false);
    const [isMarketStructureVetoEnabled, setIsMarketStructureVetoEnabled] = useState<boolean>(false);
    const [htfTimeFrame, setHtfTimeFrame] = useState<'auto' | string>('auto');
    const [isApiConnected, setIsApiConnected] = useState(false);
    const [walletViewMode, setWalletViewMode] = useState<TradingMode>(TradingMode.Spot);
    const [isMultiAssetMode, setIsMultiAssetMode] = useState(false);
    const [entryTiming, setEntryTiming] = useState<'immediate' | 'onNextCandle'>('immediate');
    const [tradingPairLists, setTradingPairLists] = useState<TradingPairList[]>([]);
    const [isAdaptiveTpEnabled, setIsAdaptiveTpEnabled] = useState<boolean>(true);
    const [aggressiveTrailMode, setAggressiveTrailMode] = useState<'distance' | 'pnl'>('distance');
    const [isMarketBreadthFilterEnabled, setIsMarketBreadthFilterEnabled] = useState<boolean>(true);
    const [isLiquidationFilterEnabled, setIsLiquidationFilterEnabled] = useState<boolean>(true);
    const [isConfirmationCandleEnabled, setIsConfirmationCandleEnabled] = useState<boolean>(constants.IS_CONFIRMATION_CANDLE_ENABLED);
    const [isMomentumConcordanceEnabled, setIsMomentumConcordanceEnabled] = useState<boolean>(constants.IS_MOMENTUM_CONCORDANCE_ENABLED);
    const [isTradeGuardianEnabled, setIsTradeGuardianEnabled] = useState<boolean>(true);

    // Context-internal state
    const [isPairsLoading, setIsPairsLoading] = useState(true);
    const [maxLeverage, setMaxLeverage] = useState(125);
    const [isLeverageLoading, setIsLeverageLoading] = useState(false);
    const [futuresSettingsError, setFuturesSettingsError] = useState<string | null>(null);
    const [multiAssetModeError, setMultiAssetModeError] = useState<string | null>(null);

    // --- Effects moved from App.tsx ---
    useEffect(() => {
        setTradingPairLists(userPreferencesService.getTradingPairLists());
    }, []);

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
        return () => { isCancelled = true; };
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
                    if (positionRisk && parseFloat(positionRisk.positionAmt) !== 0) {
                        // A position exists, cannot change margin type.
                    } else {
                        await binanceService.setMarginType(pairSymbol, marginType);
                    }
                } catch (e) {
                    const errorMessage = binanceService.interpretBinanceError(e);
                    console.error("Failed to update margin type:", errorMessage);
                    setFuturesSettingsError(errorMessage);
                }
            }
        };
        updateMarginType();
    }, [marginType, selectedPairs, tradingMode, executionMode, isApiConnected, isMultiAssetMode]);

    const onSetMultiAssetMode = useCallback(async (isEnabled: boolean) => {
        setMultiAssetModeError(null);
        try {
            await binanceService.setMultiAssetsMargin(isEnabled);
            setIsMultiAssetMode(isEnabled);
            if (isEnabled) {
                setMarginType('CROSSED');
            }
        } catch (e) {
            const errorMessage = binanceService.interpretBinanceError(e);
            console.error("Failed to update multi-asset mode:", errorMessage);
            setMultiAssetModeError(errorMessage);
        }
    }, []);

    const addTradingPairList = useCallback((list: Omit<TradingPairList, 'id'>) => {
        const newLists = userPreferencesService.addTradingPairList(list);
        setTradingPairLists(newLists);
    }, []);

    const updateTradingPairList = useCallback((list: TradingPairList) => {
        const newLists = userPreferencesService.updateTradingPairList(list);
        setTradingPairLists(newLists);
    }, []);

    const deleteTradingPairList = useCallback((listId: string) => {
        const newLists = userPreferencesService.deleteTradingPairList(listId);
        setTradingPairLists(newLists);
    }, []);

    const stateValue = useMemo(() => ({
        executionMode, tradingMode, selectedPairs, allPairs, isPairsLoading, leverage, marginType, chartTimeFrame, selectedAgent, investmentAmount, availableBalance, maxMarginLossPercent, isInitialRiskVetoEnabled, isHtfConfirmationEnabled, isUniversalProfitTrailEnabled, isMinRrEnabled, invalidationSensitivity, isAgentTrailEnabled, isBreakevenTrailEnabled, isMarketCohesionEnabled, isVwapConfirmationEnabled, isBtcConfirmationEnabled, isBtcCorrelationVetoEnabled, btcConfirmationThreshold, isVolumeFilterEnabled, isAdxFilterEnabled, isExhaustionFilterEnabled, isSmcVetoEnabled, isSrAnalysisEnabled, isCandlestickConfirmationEnabled, isMarketStructureVetoEnabled, htfTimeFrame, agentParams, htfAgentParams, isApiConnected, walletViewMode, isMultiAssetMode, entryTiming, tradingPairLists, isAdaptiveTpEnabled, aggressiveTrailMode, isMarketBreadthFilterEnabled, isLiquidationFilterEnabled, isConfirmationCandleEnabled, isMomentumConcordanceEnabled, isTradeGuardianEnabled, maxLeverage, isLeverageLoading, futuresSettingsError, multiAssetModeError
    }), [executionMode, tradingMode, selectedPairs, allPairs, isPairsLoading, leverage, marginType, chartTimeFrame, selectedAgent, investmentAmount, availableBalance, maxMarginLossPercent, isInitialRiskVetoEnabled, isHtfConfirmationEnabled, isUniversalProfitTrailEnabled, isMinRrEnabled, invalidationSensitivity, isAgentTrailEnabled, isBreakevenTrailEnabled, isMarketCohesionEnabled, isVwapConfirmationEnabled, isBtcConfirmationEnabled, isBtcCorrelationVetoEnabled, btcConfirmationThreshold, isVolumeFilterEnabled, isAdxFilterEnabled, isExhaustionFilterEnabled, isSmcVetoEnabled, isSrAnalysisEnabled, isCandlestickConfirmationEnabled, isMarketStructureVetoEnabled, htfTimeFrame, agentParams, htfAgentParams, isApiConnected, walletViewMode, isMultiAssetMode, entryTiming, tradingPairLists, isAdaptiveTpEnabled, aggressiveTrailMode, isMarketBreadthFilterEnabled, isLiquidationFilterEnabled, isConfirmationCandleEnabled, isMomentumConcordanceEnabled, isTradeGuardianEnabled, maxLeverage, isLeverageLoading, futuresSettingsError, multiAssetModeError]);

    const actionsValue: TradingConfigActions = useMemo(() => ({
        setExecutionMode, setTradingMode, setSelectedPairs, setAllPairs, setLeverage, setMarginType, setTimeFrame, setSelectedAgent, setInvestmentAmount, setAvailableBalance, setMaxMarginLossPercent, setIsInitialRiskVetoEnabled, setIsHtfConfirmationEnabled, setIsUniversalProfitTrailEnabled, setIsMinRrEnabled, setInvalidationSensitivity, setIsAgentTrailEnabled, setIsBreakevenTrailEnabled, setIsMarketCohesionEnabled, setIsVwapConfirmationEnabled, setIsBtcConfirmationEnabled, setIsBtcCorrelationVetoEnabled, setBtcConfirmationThreshold, setIsVolumeFilterEnabled, setIsAdxFilterEnabled, setIsExhaustionFilterEnabled, setIsSmcVetoEnabled, setIsSrAnalysisEnabled, setIsCandlestickConfirmationEnabled, setIsMarketStructureVetoEnabled, setHtfTimeFrame, setAgentParams, setHtfAgentParams, setIsApiConnected, setWalletViewMode, setIsMultiAssetMode, setEntryTiming, setIsAdaptiveTpEnabled, setAggressiveTrailMode, setIsMarketBreadthFilterEnabled, setIsLiquidationFilterEnabled, setIsConfirmationCandleEnabled, setIsMomentumConcordanceEnabled, setIsTradeGuardianEnabled, onSetMultiAssetMode, setFuturesSettingsError, addTradingPairList, updateTradingPairList, deleteTradingPairList
    }), [onSetMultiAssetMode, addTradingPairList, updateTradingPairList, deleteTradingPairList, setExecutionMode, setTradingMode, setSelectedPairs, setAllPairs, setLeverage, setMarginType, setTimeFrame, setSelectedAgent, setInvestmentAmount, setAvailableBalance, setMaxMarginLossPercent, setIsInitialRiskVetoEnabled, setIsHtfConfirmationEnabled, setIsUniversalProfitTrailEnabled, setIsMinRrEnabled, setInvalidationSensitivity, setIsAgentTrailEnabled, setIsBreakevenTrailEnabled, setIsMarketCohesionEnabled, setIsVwapConfirmationEnabled, setIsBtcConfirmationEnabled, setIsBtcCorrelationVetoEnabled, setBtcConfirmationThreshold, setIsVolumeFilterEnabled, setIsAdxFilterEnabled, setIsExhaustionFilterEnabled, setIsSmcVetoEnabled, setIsSrAnalysisEnabled, setIsCandlestickConfirmationEnabled, setIsMarketStructureVetoEnabled, setHtfTimeFrame, setAgentParams, setHtfAgentParams, setIsApiConnected, setWalletViewMode, setIsMultiAssetMode, setEntryTiming, setIsAdaptiveTpEnabled, setAggressiveTrailMode, setIsMarketBreadthFilterEnabled, setIsLiquidationFilterEnabled, setIsConfirmationCandleEnabled, setIsMomentumConcordanceEnabled, setIsTradeGuardianEnabled, setFuturesSettingsError]);

    return (
        <TradingConfigStateContext.Provider value={stateValue}>
            <TradingConfigActionsContext.Provider value={actionsValue}>
                {children}
            </TradingConfigActionsContext.Provider>
        </TradingConfigStateContext.Provider>
    );
};

export const useTradingConfigState = (): TradingConfigState => {
    const context = useContext(TradingConfigStateContext);
    if (context === undefined) {
        throw new Error('useTradingConfigState must be used within a TradingConfigProvider');
    }
    return context;
};

export const useTradingConfigActions = (): TradingConfigActions => {
    const context = useContext(TradingConfigActionsContext);
    if (context === undefined) {
        throw new Error('useTradingConfigActions must be used within a TradingConfigProvider');
    }
    return context;
};