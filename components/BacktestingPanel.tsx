import React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { Agent, BotConfig, BacktestResult, TradingMode, AgentParams, OptimizationResultItem } from '../types';
import * as constants from '../constants';
import * as binanceService from './../services/binanceService';
import { runBacktest, runOptimization } from '../services/backtestingService';
import { FlaskIcon, ChevronUp, ChevronDown, SparklesIcon, InfoIcon } from './icons';
import { useTradingConfigState, useTradingConfigActions } from '../contexts/TradingConfigContext';
import { SearchableDropdown } from './SearchableDropdown';
import { BacktestResultDisplay } from './BacktestResultDisplay';
import { OptimizationResults } from './OptimizationResults';


// --- Internal Components (Moved from BacktestControlPanel) ---

const formGroupClass = "flex flex-col gap-1.5";
const formLabelClass = "text-sm font-medium text-slate-700 dark:text-slate-300";
const formInputClass = "w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500";
const buttonClass = "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-white font-semibold rounded-md shadow-sm transition-colors";
const primaryButtonClass = `${buttonClass} bg-sky-600 hover:bg-sky-700 disabled:bg-slate-400 dark:disabled:bg-slate-600`;

const ToggleSwitch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void }> = ({ checked, onChange }) => (
    <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`${checked ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800`}
    >
        <span
            aria-hidden="true"
            className={`${checked ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
        />
    </button>
);

const ParamSlider: React.FC<{label: string, value: number, onChange: (val: number) => void, min: number, max: number, step: number, valueDisplay?: (v: number) => string}> = 
({ label, value, onChange, min, max, step, valueDisplay }) => (
    <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-baseline">
            <label className={formLabelClass}>{label}</label>
            <span className="text-sm font-semibold text-sky-500">{valueDisplay ? valueDisplay(value) : value}</span>
        </div>
        <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer" />
    </div>
);

const AgentParameterEditor: React.FC<{agent: Agent, params: AgentParams, onParamsChange: (p: AgentParams) => void, isAdxFilterEnabled: boolean, timeFrame: string}> = ({ agent, params, onParamsChange, isAdxFilterEnabled, timeFrame }) => {
    const [isExitVetoOpen, setIsExitVetoOpen] = useState(false);
    
    const allParams = useMemo(() => {
        const timeframeDefaults = constants.getAgentTimeframeSettings(agent.id, timeFrame);
        return { ...constants.DEFAULT_AGENT_PARAMS, ...timeframeDefaults, ...params };
    }, [agent.id, timeFrame, params]);

    const updateParam = (key: keyof AgentParams, value: number | boolean | string) => { onParamsChange({ ...params, [key]: value }); };
    switch (agent.id) {
        case 9: return (<div className="space-y-4">
            <div className="flex flex-col gap-1.5">
                <label className={formLabelClass}>Entry Mode</label>
                <div className="flex items-center gap-1 p-1 bg-slate-200 dark:bg-slate-900/70 rounded-md mt-1">
                    <button 
                        onClick={() => updateParam('qsc_entryMode', 'breakout')} 
                        className={`flex-1 text-center text-xs font-semibold p-1.5 rounded-md transition-colors ${ (allParams.qsc_entryMode ?? 'breakout') === 'breakout' ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}
                    >
                        Breakout
                    </button>
                    <button 
                        onClick={() => updateParam('qsc_entryMode', 'pullback')}
                        className={`flex-1 text-center text-xs font-semibold p-1.5 rounded-md transition-colors ${ allParams.qsc_entryMode === 'pullback' ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}
                    >
                        Pullback
                    </button>
                </div>
            </div>
            {isAdxFilterEnabled && (
                <ParamSlider label="ADX Trend Threshold" value={allParams.qsc_adxThreshold} onChange={v => updateParam('qsc_adxThreshold', v)} min={20} max={40} step={1} />
            )}
            {(allParams.qsc_entryMode ?? 'breakout') === 'breakout' ? (
                <ParamSlider label="RSI Crossover Threshold" value={allParams.qsc_rsiMomentumThreshold} onChange={v => updateParam('qsc_rsiMomentumThreshold', v)} min={51} max={70} step={1} />
            ) : (
                <ParamSlider label="RSI Pullback Threshold" value={allParams.qsc_rsiPullbackThreshold} onChange={v => updateParam('qsc_rsiPullbackThreshold', v)} min={30} max={49} step={1} />
            )}
            <ParamSlider label="Volume Exhaustion Veto" value={allParams.qsc_volumeExhaustionMultiplier!} onChange={v => updateParam('qsc_volumeExhaustionMultiplier', v)} min={1.5} max={5.0} step={0.1} valueDisplay={v => `${v.toFixed(1)}x Avg`} />
            <ParamSlider label="Entry Score Threshold" value={allParams.qsc_trendScoreThreshold} onChange={v => updateParam('qsc_trendScoreThreshold', v)} min={50} max={95} step={1} valueDisplay={v => `${v}%`} />
            </div>);
        case 11: return (<div className="space-y-4">
            <ParamSlider label="Trend SMA Period" value={allParams.he_trendSmaPeriod} onChange={v => updateParam('he_trendSmaPeriod', v)} min={20} max={50} step={1} />
            <ParamSlider label="Fast EMA Period" value={allParams.he_fastEmaPeriod} onChange={v => updateParam('he_fastEmaPeriod', v)} min={5} max={20} step={1} />
            <ParamSlider label="Slow EMA Period" value={allParams.he_slowEmaPeriod} onChange={v => updateParam('he_slowEmaPeriod', v)} min={20} max={50} step={1} />
            <ParamSlider label="RSI Midline" value={allParams.he_rsiMidline} onChange={v => updateParam('he_rsiMidline', v)} min={40} max={60} step={1} />
            </div>);
        case 13: 
             return (<div className="space-y-4">
                 <ParamSlider 
                    label="Trend EMA Period"
                    value={allParams.ch_trendEmaPeriod}
                    onChange={(v) => updateParam('ch_trendEmaPeriod', v)}
                    min={50} max={200} step={10}
                />
                {isAdxFilterEnabled && (
                    <ParamSlider 
                        label="ADX Threshold"
                        value={allParams.ch_adxThreshold}
                        onChange={(v) => updateParam('ch_adxThreshold', v)}
                        min={18} max={30} step={1}
                    />
                )}
                 <ParamSlider 
                    label="Fast EMA Period"
                    value={allParams.ch_fastEmaPeriod}
                    onChange={(v) => updateParam('ch_fastEmaPeriod', v)}
                    min={5} max={20} step={1}
                />
                <ParamSlider 
                    label="Slow EMA Period"
                    value={allParams.ch_slowEmaPeriod}
                    onChange={(v) => updateParam('ch_slowEmaPeriod', v)}
                    min={20} max={50} step={1}
                />
            </div>);
        case 14: 
             return (<div className="space-y-4">
                <h4 className="text-sm font-semibold text-slate-500 dark:text-slate-400">Entry Logic</h4>
                 <ParamSlider 
                    label="Score Threshold" 
                    value={allParams.sentinel_scoreThreshold!}
                    onChange={(v) => updateParam('sentinel_scoreThreshold', v)}
                    min={50} max={95} step={1}
                 />
                 <ParamSlider 
                    label="ADX Trend Minimum" 
                    value={allParams.sentinel_strongTrendAdx!}
                    onChange={(v) => updateParam('sentinel_strongTrendAdx', v)}
                    min={20} max={35} step={1}
                 />
                <ParamSlider label="Fast EMA Period" value={allParams.sentinel_emaFastPeriod!} onChange={v => updateParam('sentinel_emaFastPeriod', v)} min={10} max={100} step={1} />
                <ParamSlider label="Slow EMA Period" value={allParams.sentinel_emaSlowPeriod!} onChange={v => updateParam('sentinel_emaSlowPeriod', v)} min={50} max={300} step={5} />
                <ParamSlider label="RSI Divergence Lookback" value={allParams.sentinel_rsiDivergenceLookback!} onChange={v => updateParam('sentinel_rsiDivergenceLookback', v)} min={10} max={40} step={1} />
                 
                <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                    <button onClick={() => setIsExitVetoOpen(!isExitVetoOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                        <span>Exit Logic</span>
                        {isExitVetoOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                    {isExitVetoOpen && (
                        <div className="p-3 border-t border-slate-200 dark:border-slate-600 space-y-4">
                            <div className="flex items-center justify-between">
                                 <div className="flex items-center gap-1.5">
                                    <label className={formLabelClass}>Use S/R for Take Profit</label>
                                     <div className="relative group">
                                        <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                                        <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                            Sets TP just before the next significant S/R level. Falls back to R:R if no level is found.
                                        </div>
                                    </div>
                                </div>
                                <ToggleSwitch checked={allParams.sentinel_useSrLevelsForTp!} onChange={v => updateParam('sentinel_useSrLevelsForTp', v)} />
                            </div>
                            <ParamSlider label="SuperTrend Period (SL)" value={allParams.sentinel_stPeriod!} onChange={v => updateParam('sentinel_stPeriod', v)} min={5} max={20} step={1} />
                            <ParamSlider label="SuperTrend Multiplier (SL)" value={allParams.sentinel_stMultiplier!} onChange={v => updateParam('sentinel_stMultiplier', v)} min={1.0} max={5.0} step={0.1} valueDisplay={v => v.toFixed(1)} />
                            <ParamSlider label="Invalidation Candle Limit" value={allParams.sentinel_invalidationCandleLimit!} onChange={v => updateParam('sentinel_invalidationCandleLimit', v)} min={3} max={20} step={1} />
                            <ParamSlider label="RSI Exit Long" value={allParams.sentinel_rsiMomentumExitLong!} onChange={v => updateParam('sentinel_rsiMomentumExitLong', v)} min={40} max={50} step={1} />
                            <ParamSlider label="RSI Exit Short" value={allParams.sentinel_rsiMomentumExitShort!} onChange={v => updateParam('sentinel_rsiMomentumExitShort', v)} min={50} max={60} step={1} />
                        </div>
                    )}
                </div>
            </div>);
        case 17:
            return (<div className="space-y-4">
                <ParamSlider 
                   label="Fast EMA Period"
                   value={allParams.mst_emaFastPeriod!}
                   onChange={(v) => updateParam('mst_emaFastPeriod', v)}
                   min={20} max={100} step={1}
               />
               <ParamSlider 
                   label="Slow EMA Period"
                   value={allParams.mst_emaSlowPeriod!}
                   onChange={(v) => updateParam('mst_emaSlowPeriod', v)}
                   min={100} max={300} step={10}
               />
           </div>);
        default: return <p className="text-sm text-slate-500">This agent does not have any customizable parameters.</p>;
    }
};


// --- Main Panel Component ---

interface BacktestingPanelProps {
    backtestResult: BacktestResult | null;
    setBacktestResult: (result: BacktestResult | null) => void;
    setActiveView: (view: 'trading' | 'backtesting' | 'preferences') => void;
    theme: 'light' | 'dark';
}

export type BacktestConfig = {
    tradingMode: TradingMode;
    selectedPair: string;
    chartTimeFrame: string;
    selectedAgent: Agent;
    investmentAmount: number;
    maxMarginLossPercent: number;
    isInitialRiskVetoEnabled: boolean;
    isHtfConfirmationEnabled: boolean;
    isUniversalProfitTrailEnabled: boolean;
    isMinRrEnabled: boolean;
    htfTimeFrame: 'auto' | string;
    invalidationSensitivity: 'low' | 'medium' | 'high';
    isAgentTrailEnabled: boolean;
    isBreakevenTrailEnabled: boolean;
    isMarketCohesionEnabled: boolean;
    isExhaustionFilterEnabled: boolean;
    isSmcVetoEnabled: boolean;
    agentParams: AgentParams;
    leverage: number;
    marginType: 'ISOLATED' | 'CROSSED';
    entryTiming: 'immediate' | 'onNextCandle';
    isAdaptiveTpEnabled: boolean;
    aggressiveTrailMode: 'distance' | 'pnl';
    isVwapConfirmationEnabled: boolean;
    isBtcConfirmationEnabled: boolean;
    btcConfirmationThreshold: number;
    isVolumeFilterEnabled: boolean;
    isAdxFilterEnabled: boolean;
    isSrAnalysisEnabled: boolean;
    isCandlestickConfirmationEnabled: boolean;
    isMarketStructureVetoEnabled: boolean;
    isMarketBreadthFilterEnabled: boolean;
    isLiquidationFilterEnabled: boolean;
    isConfirmationCandleEnabled: boolean;
    isMomentumConcordanceEnabled: boolean;
};

const getTimeframeDuration = (timeframe: string): number => {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1), 10);
    if (isNaN(value)) return 0;
    switch (unit) {
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return 0;
    }
};

export const BacktestingPanel: React.FC<BacktestingPanelProps> = (props) => {
    const { backtestResult, setBacktestResult, setActiveView, theme } = props;
    
    const globalConfig = useTradingConfigState();
    const globalActions = useTradingConfigActions();
    
    const [config, setConfig] = useState<BacktestConfig>({
        tradingMode: globalConfig.tradingMode,
        selectedPair: globalConfig.selectedPairs[0] || constants.TRADING_PAIRS[0], 
        chartTimeFrame: globalConfig.chartTimeFrame,
        selectedAgent: globalConfig.selectedAgent, 
        investmentAmount: globalConfig.investmentAmount,
        maxMarginLossPercent: globalConfig.maxMarginLossPercent,
        isInitialRiskVetoEnabled: globalConfig.isInitialRiskVetoEnabled,
        isHtfConfirmationEnabled: globalConfig.isHtfConfirmationEnabled,
        isUniversalProfitTrailEnabled: globalConfig.isUniversalProfitTrailEnabled, 
        htfTimeFrame: globalConfig.htfTimeFrame,
        agentParams: globalConfig.agentParams, 
        leverage: globalConfig.leverage,
        marginType: globalConfig.marginType,
        isMinRrEnabled: globalConfig.isMinRrEnabled, 
        invalidationSensitivity: globalConfig.invalidationSensitivity,
        isAgentTrailEnabled: globalConfig.isAgentTrailEnabled,
        isBreakevenTrailEnabled: globalConfig.isBreakevenTrailEnabled,
        isMarketCohesionEnabled: globalConfig.isMarketCohesionEnabled,
        isExhaustionFilterEnabled: globalConfig.isExhaustionFilterEnabled,
        isSmcVetoEnabled: globalConfig.isSmcVetoEnabled,
        entryTiming: globalConfig.entryTiming,
        isAdaptiveTpEnabled: globalConfig.isAdaptiveTpEnabled,
        aggressiveTrailMode: globalConfig.aggressiveTrailMode,
        isVwapConfirmationEnabled: globalConfig.isVwapConfirmationEnabled,
        isBtcConfirmationEnabled: globalConfig.isBtcConfirmationEnabled,
        btcConfirmationThreshold: globalConfig.btcConfirmationThreshold,
        isVolumeFilterEnabled: globalConfig.isVolumeFilterEnabled,
        isAdxFilterEnabled: globalConfig.isAdxFilterEnabled,
        isSrAnalysisEnabled: globalConfig.isSrAnalysisEnabled,
        isCandlestickConfirmationEnabled: globalConfig.isCandlestickConfirmationEnabled,
        isMarketStructureVetoEnabled: globalConfig.isMarketStructureVetoEnabled,
        isMarketBreadthFilterEnabled: globalConfig.isMarketBreadthFilterEnabled,
        isLiquidationFilterEnabled: globalConfig.isLiquidationFilterEnabled,
        isConfirmationCandleEnabled: globalConfig.isConfirmationCandleEnabled,
        isMomentumConcordanceEnabled: globalConfig.isMomentumConcordanceEnabled,
    });

    const [backtestDays, setBacktestDays] = useState(3);
    const [optimizationResults, setOptimizationResults] = useState<OptimizationResultItem[] | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadingMessage, setLoadingMessage] = useState('Running Simulation...');
    const [isParamsOpen, setIsParamsOpen] = useState(false);
    const [isFiltersOpen, setIsFiltersOpen] = useState(false);


    const canOptimize = [9, 11, 13, 14, 17].includes(config.selectedAgent.id);
    
    const updateConfig = <K extends keyof BacktestConfig>(key: K, value: BacktestConfig[K]) => {
        setConfig(prev => ({...prev, [key]: value}));
    };

    const higherTimeFrames = useMemo(() => {
        const currentIndex = constants.TIME_FRAMES.indexOf(config.chartTimeFrame);
        if (currentIndex === -1) return [];
        return constants.TIME_FRAMES.slice(currentIndex + 1);
    }, [config.chartTimeFrame]);

    useEffect(() => {
        // When the agent changes, clear out any old custom parameters
        // to ensure the new agent's defaults are used.
        updateConfig('agentParams', {});
    }, [config.selectedAgent.id]);

    useEffect(() => {
        if (config.htfTimeFrame !== 'auto' && !higherTimeFrames.includes(config.htfTimeFrame)) {
            updateConfig('htfTimeFrame', 'auto');
        }
    }, [config.chartTimeFrame, config.htfTimeFrame, higherTimeFrames]);

    useEffect(() => {
        if (!constants.AGENTS.some(a => a.id === config.selectedAgent.id)) {
            updateConfig('selectedAgent', constants.AGENTS[0]);
        }
    }, [config.selectedAgent]);

    const handleRunBacktest = async () => {
        setIsLoading(true); setLoadingMessage('Fetching data...'); setError(null);
        setBacktestResult(null); setOptimizationResults(null);
        try {
            const formattedPair = config.selectedPair.replace('/', '');
            const startTime = Date.now() - backtestDays * 24 * 60 * 60 * 1000;
            const backtestKlines = await binanceService.fetchFullKlines(formattedPair, '1m', startTime, Date.now(), config.tradingMode);
            if (backtestKlines.length < 200) { throw new Error("Not enough historical data available for a reliable backtest (min 200 candles)."); }
            
            let htfKlines: any[] | undefined = undefined;
            if (config.isHtfConfirmationEnabled) {
                const htf = config.htfTimeFrame === 'auto' ? constants.TIME_FRAMES[constants.TIME_FRAMES.indexOf(config.chartTimeFrame) + 1] : config.htfTimeFrame;
                if (htf) {
                    const htfStartTime = backtestKlines[0].time;
                    const htfEndTime = backtestKlines[backtestKlines.length - 1].time + getTimeframeDuration(config.chartTimeFrame) - 1;
                    htfKlines = await binanceService.fetchFullKlines(formattedPair, htf, htfStartTime, htfEndTime, config.tradingMode);
                }
            }

            setLoadingMessage('Running backtest...');
            const symbolInfo = config.tradingMode === TradingMode.USDSM_Futures ? await binanceService.getFuturesSymbolInfo(formattedPair) : await binanceService.getSymbolInfo(formattedPair);
            if (!symbolInfo) throw new Error("Could not fetch symbol info.");
            
            const fullBotConfig: BotConfig = {
                ...config,
                pair: config.selectedPair, 
                mode: config.tradingMode, 
                executionMode: 'paper',
                timeFrame: config.chartTimeFrame, 
                agent: config.selectedAgent,
                pricePrecision: binanceService.getPricePrecision(symbolInfo), 
                quantityPrecision: binanceService.getQuantityPrecision(symbolInfo),
                stepSize: binanceService.getStepSize(symbolInfo),
                takerFeeRate: constants.TAKER_FEE_RATE,
            };
            const result = await runBacktest(backtestKlines, fullBotConfig, htfKlines);
            setBacktestResult(result);
        } catch (e) {
            console.error("Backtest failed:", e); setError(e instanceof Error ? e.message : "An unknown error occurred during backtesting.");
        } finally { setIsLoading(false); }
    };

    const handleRunOptimization = async () => {
        setIsLoading(true); setLoadingMessage('Fetching historical data...'); setError(null);
        setBacktestResult(null); setOptimizationResults(null);
        const onProgress = (progress: { percent: number, combinations: number }) => {
            setLoadingMessage(`Optimizing... ${progress.percent.toFixed(0)}% of ${progress.combinations}`);
        };
        try {
            const formattedPair = config.selectedPair.replace('/', '');
            const startTime = Date.now() - backtestDays * 24 * 60 * 60 * 1000;
            const backtestKlines = await binanceService.fetchFullKlines(formattedPair, '1m', startTime, Date.now(), config.tradingMode);
            if (backtestKlines.length < 200) { throw new Error("Not enough historical data for optimization."); }
            
            let htfKlines: any[] | undefined = undefined;
            if (config.isHtfConfirmationEnabled) {
                 const htf = config.htfTimeFrame === 'auto' ? constants.TIME_FRAMES[constants.TIME_FRAMES.indexOf(config.chartTimeFrame) + 1] : config.htfTimeFrame;
                if (htf) {
                    const htfStartTime = backtestKlines[0].time;
                    const htfEndTime = backtestKlines[backtestKlines.length - 1].time + getTimeframeDuration(config.chartTimeFrame) - 1;
                    htfKlines = await binanceService.fetchFullKlines(formattedPair, htf, htfStartTime, htfEndTime, config.tradingMode);
                }
            }
            
            setLoadingMessage(`Preparing optimization...`);
            const symbolInfo = config.tradingMode === TradingMode.USDSM_Futures ? await binanceService.getFuturesSymbolInfo(formattedPair) : await binanceService.getSymbolInfo(formattedPair);
            if (!symbolInfo) throw new Error("Could not fetch symbol info.");
            const baseBotConfig: BotConfig = {
                ...config,
                pair: config.selectedPair, 
                mode: config.tradingMode, 
                executionMode: 'paper',
                timeFrame: config.chartTimeFrame, 
                agent: config.selectedAgent,
                pricePrecision: binanceService.getPricePrecision(symbolInfo), 
                quantityPrecision: binanceService.getQuantityPrecision(symbolInfo),
                stepSize: binanceService.getStepSize(symbolInfo),
                takerFeeRate: constants.TAKER_FEE_RATE,
            };
            const results = await runOptimization(backtestKlines, baseBotConfig, onProgress, htfKlines);
            if (results.length === 0) { setError("Optimization complete, but no profitable parameter combinations were found."); } else { setOptimizationResults(results); }
        } catch (e) {
            console.error("Optimization failed:", e); setError(e instanceof Error ? e.message : "An unknown error occurred during optimization.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleApplyAndSwitch = (params: AgentParams) => {
        globalActions.setSelectedAgent(config.selectedAgent);
        globalActions.setAgentParams(params);
        setActiveView('trading');
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* --- Control Panel Column --- */}
            <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-lg shadow-sm p-4 h-fit">
                <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
                    <FlaskIcon />
                    <span>Backtest Configuration</span>
                </h2>
                <div className="space-y-4">
                    <div className={formGroupClass}>
                        <label className={formLabelClass}>Platform</label>
                        <select value={config.tradingMode} onChange={e => updateConfig('tradingMode', e.target.value as TradingMode)} className={formInputClass}>
                            {Object.values(TradingMode).map(mode => <option key={mode} value={mode}>{mode}</option>)}
                        </select>
                    </div>

                    <div className={formGroupClass}>
                        <label className={formLabelClass}>Market</label>
                        <SearchableDropdown
                            options={globalConfig.allPairs}
                            value={config.selectedPair}
                            onChange={(p) => updateConfig('selectedPair', p as string)}
                            theme={theme}
                            disabled={globalConfig.isPairsLoading}
                        />
                    </div>
                    
                    <div className={formGroupClass}>
                        <label className={formLabelClass}>Time Frame</label>
                        <select value={config.chartTimeFrame} onChange={e => updateConfig('chartTimeFrame', e.target.value)} className={formInputClass}>
                            {constants.TIME_FRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                        </select>
                    </div>

                    <div className={formGroupClass}>
                        <label className={formLabelClass}>Backtest Period</label>
                        <select value={backtestDays} onChange={e => setBacktestDays(Number(e.target.value))} className={formInputClass}>
                            <option value={1}>Last 24 Hours</option>
                            <option value={3}>Last 3 Days</option>
                            <option value={7}>Last 7 Days</option>
                            <option value={14}>Last 14 Days</option>
                            <option value={30}>Last 30 Days</option>
                        </select>
                    </div>

                    <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>

                    <div className={formGroupClass}>
                        <label className={formLabelClass}>Investment Amount</label>
                        <input type="number" value={config.investmentAmount} onChange={e => updateConfig('investmentAmount', Number(e.target.value))} className={formInputClass} />
                    </div>

                    {config.tradingMode === TradingMode.USDSM_Futures && (
                        <ParamSlider 
                            label="Leverage" 
                            value={config.leverage} 
                            onChange={v => updateConfig('leverage', v)} 
                            min={1} max={125} step={1} valueDisplay={v => `${v}x`} 
                        />
                    )}

                    <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>
                    
                    <div className={formGroupClass}>
                        <div className="flex justify-between items-center">
                            <label className={formLabelClass}>Trading Agent</label>
                            <button onClick={() => updateConfig('agentParams', {})} className="text-xs font-semibold text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-500">
                                Reset Params
                            </button>
                        </div>
                        <select value={config.selectedAgent.id} onChange={e => updateConfig('selectedAgent', constants.AGENTS.find(a => a.id === Number(e.target.value))!)} className={formInputClass}>
                            {constants.AGENTS.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                        </select>
                    </div>

                    <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                        <button onClick={() => setIsParamsOpen(!isParamsOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                            <span>Customize Agent Parameters</span>
                            {isParamsOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                        </button>
                        {isParamsOpen && (
                            <div className="p-3 border-t border-slate-200 dark:border-slate-600">
                                <AgentParameterEditor agent={config.selectedAgent} params={config.agentParams} onParamsChange={(p) => updateConfig('agentParams', p)} isAdxFilterEnabled={config.isAdxFilterEnabled} timeFrame={config.chartTimeFrame} />
                            </div>
                        )}
                    </div>
                    
                    <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                        <button onClick={() => setIsFiltersOpen(!isFiltersOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                            <span>Universal Filters & Rules</span>
                            {isFiltersOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                        </button>
                         {isFiltersOpen && (
                            <div className="p-3 border-t border-slate-200 dark:border-slate-600 space-y-4">
                                <h4 className="text-sm font-semibold text-slate-500 dark:text-slate-400">Entry Filters</h4>
                                <div className={formGroupClass}>
                                    <div className="flex items-center justify-between"><label className={formLabelClass}>Momentum Concordance</label><ToggleSwitch checked={config.isMomentumConcordanceEnabled} onChange={v => updateConfig('isMomentumConcordanceEnabled', v)} /></div>
                                </div>
                                 <div className={formGroupClass}>
                                    <div className="flex items-center justify-between"><label className={formLabelClass}>Market Structure Veto</label><ToggleSwitch checked={config.isMarketStructureVetoEnabled} onChange={v => updateConfig('isMarketStructureVetoEnabled', v)} /></div>
                                </div>
                                <div className={formGroupClass}>
                                    <div className="flex items-center justify-between"><label className={formLabelClass}>SMC Reversal Veto</label><ToggleSwitch checked={config.isSmcVetoEnabled} onChange={v => updateConfig('isSmcVetoEnabled', v)} /></div>
                                </div>
                                <div className={formGroupClass}>
                                    <div className="flex items-center justify-between"><label className={formLabelClass}>ADX Trend Filter</label><ToggleSwitch checked={config.isAdxFilterEnabled} onChange={v => updateConfig('isAdxFilterEnabled', v)} /></div>
                                </div>
                                <div className={formGroupClass}>
                                    <div className="flex items-center justify-between"><label className={formLabelClass}>BTC Trend Confirmation</label><ToggleSwitch checked={config.isBtcConfirmationEnabled} onChange={v => updateConfig('isBtcConfirmationEnabled', v)} /></div>
                                     {config.isBtcConfirmationEnabled && (<ParamSlider label="BTC Trend Threshold" value={config.btcConfirmationThreshold} onChange={v => updateConfig('btcConfirmationThreshold', v)} min={50} max={85} step={5} valueDisplay={(v) => `${v}%`} />)}
                                </div>
                                 <div className={formGroupClass}>
                                    <div className="flex items-center justify-between"><label className={formLabelClass}>VWAP Confirmation</label><ToggleSwitch checked={config.isVwapConfirmationEnabled} onChange={v => updateConfig('isVwapConfirmationEnabled', v)} /></div>
                                </div>
                                <div className={formGroupClass}>
                                    <div className="flex items-center justify-between"><label className={formLabelClass}>HTF Confirmation</label><ToggleSwitch checked={config.isHtfConfirmationEnabled} onChange={v => updateConfig('isHtfConfirmationEnabled', v)} /></div>
                                    {config.isHtfConfirmationEnabled && higherTimeFrames.length > 0 && (<select value={config.htfTimeFrame} onChange={e => updateConfig('htfTimeFrame', e.target.value)} className={formInputClass}><option value="auto">Auto</option>{higherTimeFrames.map(tf => <option key={tf} value={tf}>{tf}</option>)}</select>)}
                                </div>
                                 <div className={`${formGroupClass} space-y-2`}>
                                    <div className="flex items-center justify-between"><label className={formLabelClass}>Universal Volume Filter</label><ToggleSwitch checked={config.isVolumeFilterEnabled} onChange={v => updateConfig('isVolumeFilterEnabled', v)} /></div>
                                    {config.isVolumeFilterEnabled && (<ParamSlider label="Volume Multiplier" value={config.agentParams.veto_volumeFilterMultiplier ?? constants.DEFAULT_AGENT_PARAMS.veto_volumeFilterMultiplier} onChange={v => updateConfig('agentParams', {...config.agentParams, veto_volumeFilterMultiplier: v})} min={0.5} max={2.5} step={0.1} valueDisplay={v => `${v.toFixed(1)}x Avg`} />)}
                                </div>
                                <div className={`${formGroupClass} space-y-2`}>
                                    <div className="flex items-center justify-between"><label className={formLabelClass}>S/R Zone Analysis</label><ToggleSwitch checked={config.isSrAnalysisEnabled} onChange={v => updateConfig('isSrAnalysisEnabled', v)} /></div>
                                    {config.isSrAnalysisEnabled && (<ParamSlider label="S/R Zone Buffer" value={config.agentParams.veto_srZoneAtrBuffer ?? constants.DEFAULT_AGENT_PARAMS.veto_srZoneAtrBuffer} onChange={v => updateConfig('agentParams', {...config.agentParams, veto_srZoneAtrBuffer: v})} min={0.1} max={2.0} step={0.1} valueDisplay={v => `${v.toFixed(1)}x ATR`} />)}
                                </div>
                                
                                <h4 className="text-sm font-semibold text-slate-500 dark:text-slate-400 pt-3 border-t border-slate-200 dark:border-slate-700">Trade Management</h4>
                                <div className={formGroupClass}>
                                    <div className="flex items-center justify-between"><label className={formLabelClass}>Agent Indicator Trail</label><ToggleSwitch checked={config.isAgentTrailEnabled} onChange={v => updateConfig('isAgentTrailEnabled', v)} /></div>
                                </div>
                                <div className={formGroupClass}>
                                    <div className="flex items-center justify-between"><label className={formLabelClass}>Mandatory Breakeven Trail</label><ToggleSwitch checked={config.isBreakevenTrailEnabled} onChange={v => updateConfig('isBreakevenTrailEnabled', v)} /></div>
                                </div>
                                <div className={formGroupClass}>
                                    <div className="flex items-center justify-between"><label className={formLabelClass}>Universal Profit Trail</label><ToggleSwitch checked={config.isUniversalProfitTrailEnabled} onChange={v => updateConfig('isUniversalProfitTrailEnabled', v)} /></div>
                                </div>
                                <div className={formGroupClass}>
                                    <div className="flex items-center justify-between"><label className={formLabelClass}>Adaptive Take Profit</label><ToggleSwitch checked={config.isAdaptiveTpEnabled} onChange={v => updateConfig('isAdaptiveTpEnabled', v)} /></div>
                                </div>
                                 <div className={formGroupClass}>
                                    <div className="flex items-center justify-between"><label className={formLabelClass}>Confirmation Candle Veto</label><ToggleSwitch checked={config.isConfirmationCandleEnabled} onChange={v => updateConfig('isConfirmationCandleEnabled', v)} /></div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex gap-2 pt-2">
                        <button onClick={handleRunBacktest} disabled={isLoading} className={`${buttonClass} bg-sky-600 hover:bg-sky-700 disabled:bg-slate-400 dark:disabled:bg-slate-600`}>
                            <FlaskIcon className="w-4 h-4" /> Run Backtest
                        </button>
                         {canOptimize && (
                            <button onClick={handleRunOptimization} disabled={isLoading} className={`${buttonClass} bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 dark:disabled:bg-slate-600`}>
                                <SparklesIcon className="w-4 h-4" /> Optimize
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* --- Results Column --- */}
            <div className="lg:col-span-9">
                 {isLoading ? (
                    <div className="flex items-center justify-center h-full bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6">
                        <div className="text-center">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500 mx-auto"></div>
                            <p className="mt-4 text-lg font-semibold">{loadingMessage}</p>
                        </div>
                    </div>
                ) : error ? (
                    <div className="flex items-center justify-center h-full bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6">
                        <div className="text-center text-rose-600 dark:text-rose-400">
                            <h3 className="text-lg font-bold mb-2">Backtest Failed</h3>
                            <p>{error}</p>
                            <button onClick={handleRunBacktest} className={`${primaryButtonClass} mt-4`}>Try Again</button>
                        </div>
                    </div>
                ) : backtestResult ? (
                    <BacktestResultDisplay 
                        result={backtestResult}
                        onReset={() => { setBacktestResult(null); setOptimizationResults(null); }}
                        onApplyAndSwitchView={() => handleApplyAndSwitch(config.agentParams)}
                    />
                ) : optimizationResults ? (
                    <OptimizationResults 
                        results={optimizationResults} 
                        onApplyAndSwitchView={handleApplyAndSwitch} 
                        onReset={() => { setBacktestResult(null); setOptimizationResults(null); }}
                        pricePrecision={2}
                    />
                ) : (
                    <div className="flex items-center justify-center h-full bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 text-center">
                        <div>
                            <FlaskIcon className="w-12 h-12 text-slate-400 dark:text-slate-500 mx-auto mb-4" />
                            <h3 className="text-xl font-bold">Backtesting & Optimization</h3>
                            <p className="text-slate-500 dark:text-slate-400 mt-2 max-w-md mx-auto">
                                Configure your bot, select a time period, and run a simulation on historical data to evaluate its performance before going live.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};