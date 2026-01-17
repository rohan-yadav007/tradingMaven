
// components/ControlPanel.tsx


import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { TradingMode, Kline, TradeSignal, AgentParams, BotConfig, Agent, LiveTicker } from '../types';
import * as constants from '../constants';
import { PlayIcon, CpuIcon, ChevronDown, ChevronUp, InfoIcon, ZapIcon, SettingsIcon } from './icons';
import { AnalysisPreview } from './AnalysisPreview';
import { getTradingSignal, captureMarketContext } from '../services/localAgentService';
import { sharedKlineService } from '../services/sharedKlineService';
import { SearchableDropdown } from './SearchableDropdown';
import { useTradingConfigState, useTradingConfigActions } from '../contexts/TradingConfigContext';
import { botManagerService } from '../services/botManagerService';
import * as binanceService from '../services/binanceService';


interface ControlPanelProps {
    onStartBot: () => void;
    botsToCreateCount: number;
    selectedPairsCount: number;
    theme: 'light' | 'dark';
    klines: Kline[];
}

const formGroupClass = "flex flex-col gap-1.5";
const formLabelClass = "text-sm font-medium text-slate-700 dark:text-slate-300";
const formInputClass = "w-full px-3 py-2 bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-colors";
const buttonClass = "w-full flex items-center justify-center gap-2 px-4 py-2.5 text-white font-semibold rounded-md shadow-sm transition-colors duration-200";
const primaryButtonClass = `${buttonClass} bg-sky-600 hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 focus:ring-offset-slate-50 dark:dark:focus:ring-offset-slate-800 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed`;

const ParamSlider: React.FC<{label: string, value: number, onChange: (val: number) => void, min: number, max: number, step: number, valueDisplay?: (v: number) => string}> = 
({ label, value, onChange, min, max, step, valueDisplay }) => (
    <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-baseline">
            <label className={formLabelClass}>{label}</label>
            <span className="text-sm font-semibold text-sky-500">{valueDisplay ? valueDisplay(value) : value}</span>
        </div>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={e => onChange(Number(e.target.value))}
            className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer"
        />
    </div>
);


const ToggleSwitch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void; size?: 'sm' | 'md' }> = ({ checked, onChange, size = 'md' }) => {
    const height = size === 'sm' ? 'h-5' : 'h-6';
    const width = size === 'sm' ? 'w-9' : 'w-11';
    const knobSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
    const translation = size === 'sm' ? 'translate-x-4' : 'translate-x-5';

    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={`${checked ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'} relative inline-flex ${height} ${width} flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800`}
        >
            <span
                aria-hidden="true"
                className={`${checked ? translation : 'translate-x-0'} pointer-events-none inline-block ${knobSize} transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
            />
        </button>
    );
};

const ConfigToggle: React.FC<{label: string; checked: boolean; onChange: (checked: boolean) => void; highlight?: boolean}> = ({label, checked, onChange, highlight}) => (
    <div className={`pt-2 mt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between ${highlight ? 'bg-sky-50 dark:bg-sky-900/10 p-2 rounded -mx-2 border border-sky-100 dark:border-sky-800' : ''}`}>
        <div className="flex items-center gap-1.5">
            <span className={`font-medium text-sm ${highlight ? 'text-sky-700 dark:text-sky-300' : 'text-slate-700 dark:text-slate-300'}`}>{label}</span>
            {highlight && <InfoIcon className="w-3.5 h-3.5 text-sky-500" title="Highly Recommended. Prevents catastrophic drawdowns by invalidating failed setups early."/>}
        </div>
        <ToggleSwitch
            checked={checked}
            onChange={onChange}
            size="sm"
        />
    </div>
);

const AgentParameterEditor: React.FC<{agent: Agent, params: AgentParams, onParamsChange: (p: AgentParams) => void, isAdxFilterEnabled: boolean, timeFrame: string}> = ({ agent, params, onParamsChange, isAdxFilterEnabled, timeFrame }) => {
    const allParams = useMemo(() => {
        const timeframeDefaults = constants.getAgentTimeframeSettings(agent.id, timeFrame);
        return { ...constants.DEFAULT_AGENT_PARAMS, ...timeframeDefaults, ...params };
    }, [agent.id, timeFrame, params]);

    const updateParam = (key: keyof AgentParams, value: number | boolean | string) => { onParamsChange({ ...params, [key]: value }); };
    
    switch (agent.id) {
        case 25: // Omega Predator V3
            const activeMode = allParams.omega_aggressiveness || 'Auto';
            
            return (
                <div className="space-y-4">
                    {/* Header Banner */}
                    <div className="p-3 bg-gradient-to-br from-indigo-50 to-slate-50 dark:from-indigo-900/30 dark:to-slate-900/30 rounded-lg border border-indigo-200 dark:border-indigo-800 text-xs shadow-sm">
                         <div className="flex items-center gap-2 mb-1">
                             <ZapIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                             <p className="font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">Omega V12.0: Shapeshifter</p>
                         </div>
                         <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                             Autonomous Multi-Timeframe Matrix. Detects structural voids (FVGs) and liquidity sweeps across 4H, 1H, and 15m fractals.
                         </p>
                    </div>
                    
                    {/* Operational Mode Segmented Control */}
                    <div className="flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                            <label className={formLabelClass}>Operational Mode</label>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${activeMode === 'Auto' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                                {activeMode === 'Auto' ? 'AI: Dynamic' : 'User Override'}
                            </span>
                        </div>
                        <div className="flex p-1 bg-slate-200 dark:bg-slate-900 rounded-lg">
                            {(['Auto', 'Conservative', 'Standard', 'Sniper'] as const).map((mode) => {
                                const isActive = activeMode === mode;
                                let activeClass = '';
                                if (mode === 'Auto') activeClass = 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm';
                                else if (mode === 'Conservative') activeClass = 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm';
                                else if (mode === 'Standard') activeClass = 'bg-white dark:bg-slate-700 text-sky-600 shadow-sm';
                                else if (mode === 'Sniper') activeClass = 'bg-white dark:bg-slate-700 text-rose-600 shadow-sm';
                                else activeClass = 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300';

                                return (
                                    <button
                                        key={mode}
                                        onClick={() => updateParam('omega_aggressiveness', mode)}
                                        className={`flex-1 py-1.5 text-[10px] font-bold rounded-md transition-all duration-200 ${isActive ? activeClass : 'text-slate-500 hover:bg-black/5 dark:hover:bg-white/5'}`}
                                        title={mode === 'Auto' ? "AI Selects Strategy" : `Force ${mode} Mode`}
                                    >
                                        {mode === 'Conservative' ? 'Consv.' : mode === 'Standard' ? 'Std.' : mode}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* V12: Shapeshifting Toggle */}
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-1">
                             <div className="flex items-center gap-1.5">
                                <label className={formLabelClass}>Fractal Shapeshifting</label>
                                 <div className="relative group">
                                    <InfoIcon className="w-3.5 h-3.5 text-indigo-500" />
                                    <div className="absolute bottom-full mb-2 w-56 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                        Allows Omega to dynamically scan 4H, 1H, and 15m structures to find the best FVG zone, regardless of the selected chart timeframe.
                                    </div>
                                </div>
                            </div>
                            <ToggleSwitch checked={allParams.omega_allowShapeshifting || false} onChange={v => updateParam('omega_allowShapeshifting', v)} size="sm" />
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 italic">
                            If enabled, triggers adapt to best fit timeframe (4H → 15m, 1H → 5m, 15m → 1m).
                        </p>
                    </div>
                </div>
            );
        // ... (Other agent cases remain unchanged)
        default: return <p className="text-sm text-slate-500">This agent does not have any customizable parameters.</p>;
    }
};

export const ControlPanel: React.FC<ControlPanelProps> = (props) => {
    // ... existing implementation ...
    const {
        onStartBot, botsToCreateCount, selectedPairsCount, theme, klines
    } = props;
    
    const config = useTradingConfigState();
    const actions = useTradingConfigActions();
    
    // ... destructuring state ...
    const {
        executionMode, availableBalance, tradingMode, allPairs, selectedPairs,
        isPairsLoading, leverage, chartTimeFrame: timeFrame, selectedAgent, investmentAmount,
        agentParams, maxMarginLossPercent, tradingPairLists,
        marginType, futuresSettingsError, isMultiAssetMode, multiAssetModeError,
        maxLeverage, isLeverageLoading,
    } = config;

    // Destructure config properties to stabilize dependencies
    const {
        isHtfConfirmationEnabled, htfTimeFrame,
        isUniversalProfitTrailEnabled, isMinRrEnabled, invalidationSensitivity,
        entryTiming, isAgentTrailEnabled, isBreakevenTrailEnabled, isMarketCohesionEnabled,
        isVwapConfirmationEnabled, isBtcConfirmationEnabled, isBtcCorrelationVetoEnabled,
        btcConfirmationThreshold, isVolumeFilterEnabled, isAdxFilterEnabled,
        isExhaustionFilterEnabled, isInitialRiskVetoEnabled, isAdaptiveTpEnabled,
        aggressiveTrailMode, isSmcVetoEnabled, isSrAnalysisEnabled,
        isCandlestickConfirmationEnabled, isMarketStructureVetoEnabled,
        isSupertrendConfirmationEnabled,
        isMarketBreadthFilterEnabled, isLiquidationFilterEnabled,
        isConfirmationCandleEnabled, isMomentumConcordanceEnabled, isTradeGuardianEnabled,
        isHeikinAshiEnabled, isDynamicSizingEnabled
    } = config;


    const {
        setExecutionMode, setTradingMode, setSelectedPairs, setLeverage, setTimeFrame,
        setSelectedAgent, setInvestmentAmount,
        setMarginType, onSetMultiAssetMode, setAgentParams, setMaxMarginLossPercent,
        setIsHtfConfirmationEnabled, setHtfTimeFrame, setIsUniversalProfitTrailEnabled,
        setIsMinRrEnabled, setInvalidationSensitivity,
        setEntryTiming, setIsAgentTrailEnabled, setIsBreakevenTrailEnabled, setIsMarketCohesionEnabled,
        setIsVwapConfirmationEnabled, setIsBtcConfirmationEnabled, setIsBtcCorrelationVetoEnabled, setBtcConfirmationThreshold, setIsVolumeFilterEnabled, setIsAdxFilterEnabled,
        setIsExhaustionFilterEnabled, setIsInitialRiskVetoEnabled, setIsAdaptiveTpEnabled, setAggressiveTrailMode,
        setIsSmcVetoEnabled, setIsSrAnalysisEnabled, setIsCandlestickConfirmationEnabled, setIsMarketStructureVetoEnabled,
        setIsSupertrendConfirmationEnabled,
        setIsMarketBreadthFilterEnabled, setIsLiquidationFilterEnabled, setIsConfirmationCandleEnabled, setIsMomentumConcordanceEnabled,
        setIsTradeGuardianEnabled, setIsHeikinAshiEnabled, setIsDynamicSizingEnabled
    } = actions;
    
    // ... existing state ...
    const [livePrice, setLivePrice] = useState(0);
    const livePriceRef = useRef(0);

    const isInvestmentInvalid = executionMode === 'live' && investmentAmount > availableBalance;

    const [analysisSignal, setAnalysisSignal] = useState<TradeSignal | null>(null);
    const [isAnalysisLoading, setIsAnalysisLoading] = useState(false);
    const [isAnalysisOpen, setIsAnalysisOpen] = useState(true);
    const [isTradeManagementOpen, setIsTradeManagementOpen] = useState(false); // Default closed
    const [selectedList, setSelectedList] = useState<string | null>(null);

    const analysisPair = useMemo(() => selectedPairs[0], [selectedPairs]);
    
    const lastAnalysisRequestTime = useRef(0);
    const analysisInProgress = useRef(false);
    const lastAnalysisErrorTime = useRef(0);

    // ... useEffects ...
    useEffect(() => {
        if (!analysisPair) return;

        const formattedPair = analysisPair.replace('/', '');
        const tickerCallback = (tickerData: LiveTicker) => {
             if (tickerData.pair.toLowerCase() === formattedPair.toLowerCase()) {
                setLivePrice(tickerData.closePrice);
                livePriceRef.current = tickerData.closePrice;
             }
        };

        botManagerService.subscribeToTickerUpdates(formattedPair, tradingMode, tickerCallback);

        return () => {
            botManagerService.unsubscribeFromTickerUpdates(formattedPair, tradingMode, tickerCallback);
        };
    }, [analysisPair, tradingMode]);

    const pairListOptions = useMemo(() => {
        const spotLists = tradingPairLists.filter(list => list.tradingMode === TradingMode.Spot).map(list => ({ value: list.name, label: list.name }));
        const futuresLists = tradingPairLists.filter(list => list.tradingMode === TradingMode.USDSM_Futures).map(list => ({ value: list.name, label: list.name }));
        const groups = [];
        if (futuresLists.length > 0) groups.push({ label: 'USDⓈ-M Futures Lists', options: futuresLists });
        if (spotLists.length > 0) groups.push({ label: 'Spot Lists', options: spotLists });
        return groups;
    }, [tradingPairLists]);

    const handleLoadList = (listName: string | string[]) => {
        if (typeof listName === 'string') {
            const list = tradingPairLists.find(l => l.name === listName);
            if (list) { setSelectedPairs(list.pairs); }
            setSelectedList(null); 
        }
    };
    
    const higherTimeFrames = useMemo(() => {
        const currentIndex = constants.TIME_FRAMES.indexOf(timeFrame);
        if (currentIndex === -1) return [];
        return constants.TIME_FRAMES.slice(currentIndex + 1);
    }, [timeFrame]);

    const fetchAnalysis = useCallback(async () => {
        if (!analysisPair || !selectedAgent) return;
        
        const now = Date.now();
        // Simple throttle to prevent spamming
        if (analysisInProgress.current || (now - lastAnalysisRequestTime.current < 1000)) return;
        
        analysisInProgress.current = true;
        setIsAnalysisLoading(true);
        // Do not clear analysisSignal immediately to avoid flashing, unless agent changed
        
        try {
            const formattedPair = analysisPair.replace('/', '');
            
            // 1. Fetch Main Klines (Fresh)
            // Note: We could use props.klines if they match, but fetching ensures freshness and sufficient length
            const klines = await binanceService.fetchKlines(formattedPair, timeFrame, { limit: 500, mode: tradingMode });
            
            if (klines.length < 50) throw new Error("Insufficient kline data");

            // 2. Fetch HTF Klines if needed
            let htfKlines: Kline[] | undefined;
            if (isHtfConfirmationEnabled) {
                const htf = htfTimeFrame === 'auto' ? constants.getHigherTimeframe(timeFrame) : htfTimeFrame;
                if (htf) {
                    htfKlines = await binanceService.fetchKlines(formattedPair, htf, { limit: 200, mode: tradingMode });
                }
            }

            // 3. Fetch Matrix Data for Omega/AstraX
            let astraXKlinesMap: Map<string, Kline[]> | undefined;
            if (selectedAgent.id === 25 || selectedAgent.id === 19) {
                astraXKlinesMap = new Map();
                // Optimization: We already have main TF klines
                astraXKlinesMap.set(timeFrame, klines);
                
                const tfs = ['1m', '5m', '15m', '1h', '4h', '1d'];
                const missingTfs = tfs.filter(tf => tf !== timeFrame);
                
                await Promise.all(missingTfs.map(async (tf) => {
                    const data = await binanceService.fetchKlines(formattedPair, tf, { limit: 200, mode: tradingMode });
                    astraXKlinesMap!.set(tf, data);
                }));
            }
            
            // 4. BTC Context
            let btcKlines: Kline[] | undefined;
            if (isBtcConfirmationEnabled || selectedAgent.id === 25 || selectedAgent.id === 19) {
                 btcKlines = await binanceService.fetchKlines('BTCUSDT', timeFrame, { limit: 200, mode: tradingMode });
            }

            const currentPrice = livePriceRef.current || klines[klines.length-1].close;

            // Construct Config Snapshot
            const tempConfig: BotConfig = {
                pair: analysisPair,
                mode: tradingMode,
                executionMode, // irrelevant for analysis
                leverage,
                marginType,
                agent: selectedAgent,
                timeFrame,
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
                pricePrecision: 2, 
                quantityPrecision: 2, 
                stepSize: 0.001,
                takerFeeRate: constants.TAKER_FEE_RATE,
                entryTiming,
                isMarketBreadthFilterEnabled,
                isLiquidationFilterEnabled,
                isConfirmationCandleEnabled,
                isMomentumConcordanceEnabled,
                isTradeGuardianEnabled,
                isHeikinAshiEnabled,
                isDynamicSizingEnabled
            };

            const signal = await getTradingSignal(
                selectedAgent,
                klines,
                tempConfig,
                htfKlines,
                undefined, // immediate
                undefined, // ltf
                undefined, // ethbtc
                currentPrice,
                astraXKlinesMap,
                btcKlines
            );
            
            setAnalysisSignal(signal);
            lastAnalysisRequestTime.current = Date.now();

        } catch (e) {
            console.error("Fetch analysis failed:", e);
            setAnalysisSignal({
                signal: 'HOLD',
                reasons: [`❌ Analysis Error: ${e instanceof Error ? e.message : 'Unknown error'}`]
            });
        } finally {
            setIsAnalysisLoading(false);
            analysisInProgress.current = false;
        }
    }, [
        analysisPair, selectedAgent, timeFrame, tradingMode, isHtfConfirmationEnabled, htfTimeFrame, 
        isBtcConfirmationEnabled, executionMode, leverage, marginType, investmentAmount, maxMarginLossPercent,
        isInitialRiskVetoEnabled, isUniversalProfitTrailEnabled, isMinRrEnabled, invalidationSensitivity,
        isAgentTrailEnabled, isBreakevenTrailEnabled, isMarketCohesionEnabled, isVwapConfirmationEnabled,
        isBtcCorrelationVetoEnabled, btcConfirmationThreshold, isVolumeFilterEnabled, isAdxFilterEnabled,
        isExhaustionFilterEnabled, isSmcVetoEnabled, isSrAnalysisEnabled, isCandlestickConfirmationEnabled,
        isMarketStructureVetoEnabled, isSupertrendConfirmationEnabled, isAdaptiveTpEnabled, aggressiveTrailMode,
        agentParams, entryTiming, isMarketBreadthFilterEnabled, isLiquidationFilterEnabled, isConfirmationCandleEnabled,
        isMomentumConcordanceEnabled, isTradeGuardianEnabled, isHeikinAshiEnabled, isDynamicSizingEnabled
    ]);

    useEffect(() => {
        if (isAnalysisOpen) {
            fetchAnalysis();
            const interval = setInterval(fetchAnalysis, 10000); // Auto-refresh every 10s
            return () => clearInterval(interval);
        }
    }, [isAnalysisOpen, fetchAnalysis]);

    const getButtonText = () => {
        if (selectedPairsCount === 0) return 'Select One or More Markets';
        if (botsToCreateCount === 0 && selectedPairsCount > 0) return 'Bot(s) Already Running';
        const plural = botsToCreateCount > 1 ? 's' : '';
        return `Start ${botsToCreateCount} Trading Bot${plural}`;
    };

    const isHighFreq = ['1m', '3m'].includes(timeFrame);
    const isOmega = selectedAgent.id === 25;

    return (
        <div className="flex flex-col gap-4">
             <div className="flex flex-col gap-2 p-3 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg">
                <label className={formLabelClass}>Execution Mode</label>
                <div className="flex items-center gap-2 p-1 bg-slate-200 dark:bg-slate-900/70 rounded-md">
                    <button onClick={() => setExecutionMode('paper')} className={`flex-1 text-center text-sm font-semibold p-1.5 rounded-md transition-colors ${executionMode === 'paper' ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}>Paper</button>
                    <button onClick={() => setExecutionMode('live')} className={`flex-1 text-center text-sm font-semibold p-1.5 rounded-md transition-colors ${executionMode === 'live' ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}>Live</button>
                </div>
            </div>

            <div className={formGroupClass}>
                <label htmlFor="trading-mode" className={formLabelClass}>Trading Platform</label>
                <select id="trading-mode" value={tradingMode} onChange={e => setTradingMode(e.target.value as TradingMode)} className={formInputClass}>
                    {Object.values(TradingMode).map(mode => <option key={mode} value={mode}>{mode}</option>)}
                </select>
            </div>

            {tradingPairLists.length > 0 && (
                <div className={formGroupClass}>
                    <label htmlFor="pair-list-loader" className={formLabelClass}>Load Pair List</label>
                    <SearchableDropdown options={pairListOptions} value={selectedList || ''} onChange={handleLoadList} theme={theme} />
                </div>
            )}
            
            <div className={formGroupClass}>
                <label htmlFor="market-pair" className={formLabelClass}>Market(s)</label>
                <SearchableDropdown isMulti options={allPairs} value={selectedPairs} onChange={(newPairs) => setSelectedPairs(newPairs as string[])} theme={theme} disabled={isPairsLoading} />
            </div>
            
            <div className={formGroupClass}>
                <label htmlFor="time-frame" className={formLabelClass}>Time Frame</label>
                <select id="time-frame" value={timeFrame} onChange={e => setTimeFrame(e.target.value)} className={formInputClass}>
                    {constants.TIME_FRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                </select>
                {isHighFreq && (
                    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-amber-500 font-bold uppercase tracking-tighter">
                        <ZapIcon className="w-3 h-3"/>
                        <span>High Frequency Mode: Utility Gating Active</span>
                    </div>
                )}
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>
            
             <div className={formGroupClass}>
                <div className="flex justify-between items-baseline">
                    <label htmlFor="investment-amount" className={formLabelClass}>Investment Amount (per bot)</label>
                    {executionMode === 'live' && (<span className="text-xs text-slate-500 dark:text-slate-400">Available: ${availableBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>)}
                 </div>
                 <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">$</span>
                    <input type="number" id="investment-amount" value={investmentAmount} onChange={e => setInvestmentAmount(Number(e.target.value))} className={`${formInputClass} pl-7 ${isInvestmentInvalid ? 'border-rose-500 focus:ring-rose-500' : ''}`} min="1" />
                </div>
                {isInvestmentInvalid && (<p className="text-xs text-rose-600 dark:text-rose-400">Investment amount cannot exceed available balance.</p>)}
            </div>
            
            <div className={`${formGroupClass} mt-2`}>
                <div className="flex items-center justify-between">
                     <div className="flex items-center gap-1.5">
                        <label htmlFor="dynamic-sizing-toggle" className={formLabelClass}>Dynamic Conviction Sizing</label>
                         <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-56 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">If enabled, the AI will reduce position size for lower conviction setups (e.g., 50% size for low conviction). If disabled, it always uses the full Investment Amount.</div>
                        </div>
                    </div>
                    <ToggleSwitch checked={isDynamicSizingEnabled} onChange={setIsDynamicSizingEnabled} />
                </div>
            </div>
            
            <ParamSlider label="Max Margin Loss %" value={maxMarginLossPercent} onChange={v => setMaxMarginLossPercent(v)} min={1} max={25} step={0.5} valueDisplay={v => `${v.toFixed(1)}%`} />
            
            <div className={`${formGroupClass} -mt-2`}>
                <div className="flex items-center justify-between">
                     <div className="flex items-center gap-1.5">
                        <label htmlFor="initial-risk-veto-toggle" className={formLabelClass}>Initial Risk Veto</label>
                         <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">Vetoes trades if the initial stop loss risk (in dollars) is greater than the 'Max Margin Loss %' of the investment amount.</div>
                        </div>
                    </div>
                    <ToggleSwitch checked={isInitialRiskVetoEnabled} onChange={setIsInitialRiskVetoEnabled} />
                </div>
            </div>

             <p className="text-xs text-slate-500 dark:text-slate-400">Stop Loss & Take Profit are fully automated by the agent's logic and the universal profit-locking system.</p>
            
            {tradingMode === TradingMode.USDSM_Futures && (
                 <>
                    {executionMode === 'live' && (
                        <div className={formGroupClass}>
                            <label className={formLabelClass}>Account Margin Mode</label>
                             <div className="flex items-center gap-2 p-1 bg-slate-200 dark:bg-slate-900/70 rounded-md">
                                <button onClick={() => onSetMultiAssetMode(false)} className={`flex-1 text-center text-sm font-semibold p-1.5 rounded-md transition-colors ${!isMultiAssetMode ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}>Single-Asset</button>
                                <button onClick={() => onSetMultiAssetMode(true)} className={`flex-1 text-center text-sm font-semibold p-1.5 rounded-md transition-colors ${isMultiAssetMode ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}>Multi-Asset</button>
                            </div>
                            {multiAssetModeError && <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">{multiAssetModeError}</p>}
                            <p className="text-xs text-slate-500 dark:text-slate-400">Allows sharing margin across all USDT-M positions.</p>
                        </div>
                    )}
                    <div className={formGroupClass}>
                        <label className={formLabelClass}>Position Margin Mode</label>
                        <div className="flex items-center gap-2 p-1 bg-slate-200 dark:bg-slate-900/70 rounded-md">
                            <button onClick={() => setMarginType('ISOLATED')} className={`flex-1 text-center text-sm font-semibold p-1.5 rounded-md transition-colors ${marginType === 'ISOLATED' ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`} disabled={isMultiAssetMode}>Isolated</button>
                            <button onClick={() => setMarginType('CROSSED')} className={`flex-1 text-center text-sm font-semibold p-1.5 rounded-md transition-colors ${marginType === 'CROSSED' ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`} disabled={isMultiAssetMode}>Crossed</button>
                        </div>
                        {isMultiAssetMode && <p className="text-xs text-slate-500 dark:text-slate-400">Multi-Asset mode forces CROSSED margin.</p>}
                        {futuresSettingsError && <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">{futuresSettingsError}</p>}
                    </div>

                    <div className={formGroupClass}>
                        <label htmlFor="leverage-slider" className="flex justify-between items-baseline">
                            <span className={formLabelClass}>Leverage</span>
                            <span className={`font-bold text-sky-500 ${isLeverageLoading ? 'animate-pulse' : ''}`}>{leverage}x</span>
                        </label>
                        <input id="leverage-slider" type="range" min="1" max={maxLeverage} value={leverage} onChange={e => setLeverage(Number(e.target.value))} className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer" disabled={isLeverageLoading} />
                    </div>
                </>
            )}

            <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>

             <div className={formGroupClass}>
                <div className="flex justify-between items-center">
                    <label htmlFor="agent-select" className={formLabelClass}>Trading Agent</label>
                    <button onClick={() => setAgentParams({})} className="text-xs font-semibold text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-500 transition-colors" title="Reset agent-specific parameters to their default values">Reset to Default</button>
                </div>
                <select id="agent-select" value={selectedAgent.id} onChange={e => { const agent = constants.AGENTS.find(a => a.id === Number(e.target.value)); if (agent) { setSelectedAgent(agent); setAgentParams({}); } }} className={formInputClass}>
                    {constants.AGENTS.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
                {selectedAgent.id !== 25 && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">{selectedAgent.description}</p>
                )}
                {selectedAgent.id === 20 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                             <div className="flex items-center gap-1.5">
                                <label htmlFor="heikin-ashi-toggle" className={formLabelClass}>Use Heikin Ashi Candles</label>
                                 <div className="relative group">
                                    <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                                    <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">Calculates Supertrend signals using smoothed Heikin Ashi candles instead of regular candles to filter noise.</div>
                                </div>
                            </div>
                            <ToggleSwitch checked={isHeikinAshiEnabled} onChange={setIsHeikinAshiEnabled} />
                        </div>
                    </div>
                )}
                 <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <AgentParameterEditor agent={selectedAgent} params={agentParams} onParamsChange={setAgentParams} isAdxFilterEnabled={isAdxFilterEnabled} timeFrame={timeFrame} />
                 </div>
            </div>
            
            <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                <button onClick={() => setIsAnalysisOpen(!isAnalysisOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                    <div className="flex items-center gap-2"><CpuIcon className="w-5 h-5 text-sky-500" /><span>AI Analysis Preview (for {selectedPairs[0]})</span></div>
                    {isAnalysisOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {isAnalysisOpen && (
                    <div className="p-3 border-t border-slate-200 dark:border-slate-600">
                        <AnalysisPreview agent={selectedAgent} agentParams={agentParams} analysis={analysisSignal} isLoading={isAnalysisLoading} />
                    </div>
                )}
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>

            {/* --- RESTORED & ENHANCED: Trade Management Configuration --- */}
            <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                <button onClick={() => setIsTradeManagementOpen(!isTradeManagementOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                    <div className="flex items-center gap-2"><SettingsIcon className="w-5 h-5 text-sky-500" /><span>Trade Management</span></div>
                    {isTradeManagementOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {isTradeManagementOpen && (
                    <div className="p-3 border-t border-slate-200 dark:border-slate-600 space-y-2">
                        {isOmega ? (
                            <>
                                <p className="text-xs text-slate-500 dark:text-slate-400 italic mb-2">Omega Sovereign Engine Active: Advanced trails managed internally.</p>
                                <ConfigToggle 
                                    label="Trade Guardian (Proactive Exit)" 
                                    checked={isTradeGuardianEnabled} 
                                    onChange={setIsTradeGuardianEnabled} 
                                    highlight={true}
                                />
                                <div className="flex flex-col gap-1.5 pt-1">
                                    <label className={formLabelClass}>Invalidation Sensitivity</label>
                                    <select value={invalidationSensitivity} onChange={e => setInvalidationSensitivity(e.target.value as any)} className={formInputClass}>
                                        <option value="low">Low</option>
                                        <option value="medium">Medium</option>
                                        <option value="high">High</option>
                                    </select>
                                </div>
                            </>
                        ) : (
                            <>
                                <ConfigToggle 
                                    label="Trade Guardian (Proactive Exit)" 
                                    checked={isTradeGuardianEnabled} 
                                    onChange={setIsTradeGuardianEnabled} 
                                    highlight={true}
                                />
                                <ConfigToggle label="Agent Indicator Trail" checked={isAgentTrailEnabled} onChange={setIsAgentTrailEnabled} />
                                <ConfigToggle label="Mandatory Breakeven Trail" checked={isBreakevenTrailEnabled} onChange={setIsBreakevenTrailEnabled} />
                                <ConfigToggle label="Universal Profit Trail" checked={isUniversalProfitTrailEnabled} onChange={setIsUniversalProfitTrailEnabled} />
                                <ConfigToggle label="Adaptive Take Profit" checked={isAdaptiveTpEnabled} onChange={setIsAdaptiveTpEnabled} />
                                
                                <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-200 dark:border-slate-700">
                                    <label className={formLabelClass}>Aggressive Trail Mode</label>
                                    <select value={aggressiveTrailMode} onChange={e => setAggressiveTrailMode(e.target.value as any)} className={formInputClass}>
                                        <option value="disabled">Disabled</option>
                                        <option value="distance">Distance to TP</option>
                                        <option value="pnl">PNL %</option>
                                    </select>
                                </div>
                                <div className="flex flex-col gap-1.5 pt-2">
                                    <label className={formLabelClass}>Invalidation Sensitivity</label>
                                    <select value={invalidationSensitivity} onChange={e => setInvalidationSensitivity(e.target.value as any)} className={formInputClass}>
                                        <option value="low">Low</option>
                                        <option value="medium">Medium</option>
                                        <option value="high">High</option>
                                    </select>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

             {/* Standard Filters - Hidden for Omega V3 to reduce noise */}
             {selectedAgent.id !== 25 && (
                 <>
                    <div className={formGroupClass}>
                        <div className="flex items-center justify-between">
                             <div className="flex items-center gap-1.5">
                                <label htmlFor="momentum-concordance-toggle" className={formLabelClass}>Momentum Concordance</label>
                                 <div className="relative group">
                                    <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                                    <div className="absolute bottom-full mb-2 w-52 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">Performs a 'just-in-time' analysis before entry. Vetoes trades if immediate 1-min momentum is fading or if the entry point is poor within the current candle's structure (e.g., buying the top of a weapon).</div>
                                </div>
                            </div>
                            <ToggleSwitch checked={isMomentumConcordanceEnabled} onChange={setIsMomentumConcordanceEnabled} />
                        </div>
                    </div>
                    
                    {/* Liquidation Cascade Veto (Hidden for Omega as it has internal Flow logic) */}
                    <div className={formGroupClass}>
                        <div className="flex items-center justify-between">
                             <div className="flex items-center gap-1.5">
                                <label htmlFor="liquidation-filter-toggle" className={formLabelClass}>Liquidation Cascade Veto</label>
                                 <div className="relative group">
                                    <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                                    <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">Prevents entering a trade directly into a large, ongoing liquidation event. A key safety feature for volatile markets. (Futures only)</div>
                                </div>
                            </div>
                            <ToggleSwitch checked={isLiquidationFilterEnabled} onChange={setIsLiquidationFilterEnabled} />
                        </div>
                    </div>
                 </>
             )}

            <button onClick={onStartBot} disabled={botsToCreateCount === 0 || isInvestmentInvalid} className={primaryButtonClass}>
                <PlayIcon className="w-5 h-5"/>
                {getButtonText()}
            </button>
        </div>
    );
};
