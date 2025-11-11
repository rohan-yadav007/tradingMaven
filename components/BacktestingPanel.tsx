
import React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { Agent, BotConfig, BacktestResult, TradingMode, AgentParams, OptimizationResultItem } from '../types';
import * as constants from '../constants';
import * as binanceService from './../services/binanceService';
import { runBacktest, runOptimization } from '../services/workerService';
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
                <ParamSlider
                    label="Entry Score Threshold"
                    value={allParams.sentinel_entryThreshold!}
                    onChange={(v) => updateParam('sentinel_entryThreshold', v)}
                    min={50} max={95} step={1}
                />
                <ParamSlider
                    label="Swing Point Lookback"
                    value={allParams.sentinel_swingLookback!}
                    onChange={(v) => updateParam('sentinel_swingLookback', v)}
                    min={3} max={15} step={1}
                />
                <h4 className="text-sm font-semibold text-slate-500 dark:text-slate-400 pt-3 border-t border-slate-200 dark:border-slate-700">Pillar Weights</h4>
                <ParamSlider
                    label="Structure Weight"
                    value={allParams.sentinel_structureWeight!}
                    onChange={(v) => updateParam('sentinel_structureWeight', v)}
                    min={20} max={70} step={5}
                    valueDisplay={v => `${v}%`}
                />
                <ParamSlider
                    label="Momentum Weight"
                    value={allParams.sentinel_momentumWeight!}
                    onChange={(v) => updateParam('sentinel_momentumWeight', v)}
                    min={10} max={50} step={5}
                    valueDisplay={v => `${v}%`}
                />
                <ParamSlider
                    label="Context Weight"
                    value={allParams.sentinel_contextWeight!}
                    onChange={(v) => updateParam('sentinel_contextWeight', v)}
                    min={10} max={50} step={5}
                    valueDisplay={v => `${v}%`}
                />
                 <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                    <button onClick={() => setIsExitVetoOpen(!isExitVetoOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                        <span>Exit & SL/TP Logic</span>
                        {isExitVetoOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                    {isExitVetoOpen && (
                        <div className="p-3 border-t border-slate-200 dark:border-slate-600 space-y-4">
                            <div className="flex items-center justify-between">
                                 <div className="flex items-center gap-1.5">
                                    <label className={formLabelClass}>Use S/R for Take Profit</label>
                                 </div>
                                <ToggleSwitch checked={allParams.sentinel_useSrLevelsForTp!} onChange={v => updateParam('sentinel_useSrLevelsForTp', v)} />
                            </div>
                            <ParamSlider label="SuperTrend Period (Trail SL)" value={allParams.sentinel_stPeriod!} onChange={v => updateParam('sentinel_stPeriod', v)} min={5} max={20} step={1} />
                            <ParamSlider label="SuperTrend Multiplier (Trail SL)" value={allParams.sentinel_stMultiplier!} onChange={v => updateParam('sentinel_stMultiplier', v)} min={1.0} max={5.0} step={0.1} valueDisplay={v => v.toFixed(1)} />
                            <ParamSlider label="Regime ADX Period (SL)" value={allParams.sentinel_adxPeriod!} onChange={v => updateParam('sentinel_adxPeriod', v)} min={5} max={20} step={1} />
                            <ParamSlider label="Momentum RSI Period (Exit)" value={allParams.sentinel_rsiPeriod!} onChange={v => updateParam('sentinel_rsiPeriod', v)} min={5} max={20} step={1} />
                        </div>
                    )}
                </div>
            </div>);
        case 16: // Ichimoku Trend Rider
            return (<div className="space-y-4">
                <ParamSlider 
                   label="Tenkan-sen Period"
                   value={allParams.ichi_conversionPeriod!}
                   onChange={(v) => updateParam('ichi_conversionPeriod', v)}
                   min={5} max={20} step={1}
               />
               <ParamSlider 
                   label="Kijun-sen Period"
                   value={allParams.ichi_basePeriod!}
                   onChange={(v) => updateParam('ichi_basePeriod', v)}
                   min={20} max={60} step={1}
               />
               <ParamSlider 
                   label="Senkou Span B Period"
                   value={allParams.ichi_laggingSpanPeriod!}
                   onChange={(v) => updateParam('ichi_laggingSpanPeriod', v)}
                   min={40} max={120} step={2}
               />
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
        case 18: 
            return (<div className="space-y-4">
                 <h4 className="text-sm font-semibold text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-700">Core Logic</h4>
                 <ParamSlider label="Base Conviction Threshold" value={allParams.conductor_convictionThreshold!} onChange={v => updateParam('conductor_convictionThreshold', v)} min={50} max={95} step={1} valueDisplay={v => `${v}%`} />
                 <ParamSlider label="Swing Point Lookback" value={allParams.conductor_swingLookback!} onChange={v => updateParam('conductor_swingLookback', v)} min={3} max={15} step={1} />
                 <ParamSlider label="Structure Weight" value={allParams.conductor_structureWeight!} onChange={v => updateParam('conductor_structureWeight', v)} min={10} max={60} step={5} valueDisplay={v => `${v}%`} />
                 <ParamSlider label="Momentum Weight" value={allParams.conductor_momentumWeight!} onChange={v => updateParam('conductor_momentumWeight', v)} min={10} max={60} step={5} valueDisplay={v => `${v}%`} />
                 <ParamSlider label="Context Weight" value={allParams.conductor_contextWeight!} onChange={v => updateParam('conductor_contextWeight', v)} min={5} max={40} step={5} valueDisplay={v => `${v}%`} />
                 <ParamSlider label="Confirmation Weight" value={allParams.conductor_confirmationWeight!} onChange={v => updateParam('conductor_confirmationWeight', v)} min={5} max={40} step={5} valueDisplay={v => `${v}%`} />

                 <h4 className="text-sm font-semibold text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-700">Adaptive Behavior</h4>
                 <ParamSlider label="Strong Trend ADX" value={allParams.conductor_strongTrendAdx!} onChange={v => updateParam('conductor_strongTrendAdx', v)} min={25} max={40} step={1} />
                 <ParamSlider label="Strong Trend Threshold" value={allParams.conductor_strongTrendThreshold!} onChange={v => updateParam('conductor_strongTrendThreshold', v)} min={50} max={80} step={1} valueDisplay={v => `${v}%`} />
                 <ParamSlider label="Choppy Market ADX" value={allParams.conductor_choppyTrendAdx!} onChange={v => updateParam('conductor_choppyTrendAdx', v)} min={15} max={25} step={1} />
                 <ParamSlider label="Choppy Market Threshold" value={allParams.conductor_choppyTrendThreshold!} onChange={v => updateParam('conductor_choppyTrendThreshold', v)} min={70} max={95} step={1} valueDisplay={v => `${v}%`} />
                 <ParamSlider label="Structure Weight Multiplier" value={allParams.conductor_structureWeightMultiplier!} onChange={v => updateParam('conductor_structureWeightMultiplier', v)} min={1.0} max={2.0} step={0.05} valueDisplay={v => `${v.toFixed(2)}x`} />
            </div>);
        case 20: return (<div className="space-y-4">
            <ParamSlider 
                label="ATR Period" 
                value={allParams.stf_atrPeriod!} 
                onChange={v => updateParam('stf_atrPeriod', v)} 
                min={5} max={20} step={1} 
            />
            {!allParams.stf_enableDynamicMultiplier && (
                <ParamSlider 
                    label="ATR Multiplier" 
                    value={allParams.stf_atrMultiplier!} 
                    onChange={v => updateParam('stf_atrMultiplier', v)} 
                    min={1.0} max={5.0} step={0.1} 
                    valueDisplay={v => v.toFixed(1)}
                />
            )}
            
            <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <label className={formLabelClass}>Dynamic Multiplier</label>
                        <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" title="Adjusts ATR multiplier based on market volatility."/>
                    </div>
                    <ToggleSwitch checked={allParams.stf_enableDynamicMultiplier!} onChange={v => updateParam('stf_enableDynamicMultiplier', v)} />
                </div>
            </div>

            {allParams.stf_enableDynamicMultiplier && (
                <div className="pl-2 border-l-2 border-sky-500/30 space-y-4 mt-2">
                    <ParamSlider 
                        label="Low Vol Multiplier" 
                        value={allParams.stf_multiplier_low!} 
                        onChange={v => updateParam('stf_multiplier_low', v)} 
                        min={1.0} max={3.0} step={0.1} 
                        valueDisplay={v => v.toFixed(1)}
                    />
                     <ParamSlider 
                        label="Normal Vol Multiplier" 
                        value={allParams.stf_multiplier_normal!} 
                        onChange={v => updateParam('stf_multiplier_normal', v)} 
                        min={1.5} max={5.0} step={0.1} 
                        valueDisplay={v => v.toFixed(1)}
                    />
                     <ParamSlider 
                        label="High Vol Multiplier" 
                        value={allParams.stf_multiplier_high!} 
                        onChange={v => updateParam('stf_multiplier_high', v)} 
                        min={3.0} max={7.0} step={0.1} 
                        valueDisplay={v => v.toFixed(1)}
                    />
                    <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-700">
                        <ParamSlider 
                            label="Volatility Lookback" 
                            value={allParams.stf_volatilityPeriod!} 
                            onChange={v => updateParam('stf_volatilityPeriod', v)} 
                            min={50} max={250} step={10}
                        />
                         <ParamSlider 
                            label="Low/High Threshold" 
                            value={allParams.stf_volatilityThreshold_low!} 
                            onChange={v => {
                                updateParam('stf_volatilityThreshold_low', v);
                                updateParam('stf_volatilityThreshold_high', 100 - v);
                            }}
                            min={10} max={40} step={1}
                            valueDisplay={v => `${v}% / ${100-v}%`}
                        />
                    </div>
                </div>
            )}
        </div>);
        case 21: // Pivot Point SuperTrend
            return (<div className="space-y-4">
                <ParamSlider 
                   label="Pivot Point Period"
                   value={allParams.pps_pivotPeriod!}
                   onChange={(v) => updateParam('pps_pivotPeriod', v)}
                   min={1} max={50} step={1}
               />
               <ParamSlider 
                   label="ATR Period"
                   value={allParams.pps_atrPeriod!}
                   onChange={(v) => updateParam('pps_atrPeriod', v)}
                   min={1} max={50} step={1}
               />
               <ParamSlider 
                   label="ATR Factor"
                   value={allParams.pps_atrFactor!}
                   onChange={(v) => updateParam('pps_atrFactor', v)}
                   min={1.0} max={10.0} step={0.1}
                   valueDisplay={v => v.toFixed(1)}
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
    isBtcCorrelationVetoEnabled: boolean;
    btcConfirmationThreshold: number;
    isVolumeFilterEnabled: boolean;
    isAdxFilterEnabled: boolean;
    isSrAnalysisEnabled: boolean;
    isCandlestickConfirmationEnabled: boolean;
    isMarketStructureVetoEnabled: boolean;
    isSupertrendConfirmationEnabled: boolean;
    isMarketBreadthFilterEnabled: boolean;
    isLiquidationFilterEnabled: boolean;
    isConfirmationCandleEnabled: boolean;
    isMomentumConcordanceEnabled: boolean;
    isTradeGuardianEnabled: boolean;
    isHeikinAshiEnabled: boolean;
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
        isBtcCorrelationVetoEnabled: globalConfig.isBtcCorrelationVetoEnabled,
        btcConfirmationThreshold: globalConfig.btcConfirmationThreshold,
        isVolumeFilterEnabled: globalConfig.isVolumeFilterEnabled,
        isAdxFilterEnabled: globalConfig.isAdxFilterEnabled,
        isSrAnalysisEnabled: globalConfig.isSrAnalysisEnabled,
        isCandlestickConfirmationEnabled: globalConfig.isCandlestickConfirmationEnabled,
        isMarketStructureVetoEnabled: globalConfig.isMarketStructureVetoEnabled,
        isSupertrendConfirmationEnabled: globalConfig.isSupertrendConfirmationEnabled,
        isMarketBreadthFilterEnabled: globalConfig.isMarketBreadthFilterEnabled,
        isLiquidationFilterEnabled: globalConfig.isLiquidationFilterEnabled,
        isConfirmationCandleEnabled: globalConfig.isConfirmationCandleEnabled,
        isMomentumConcordanceEnabled: globalConfig.isMomentumConcordanceEnabled,
        isTradeGuardianEnabled: globalConfig.isTradeGuardianEnabled,
        isHeikinAshiEnabled: globalConfig.isHeikinAshiEnabled,
    });

    const [backtestDays, setBacktestDays] = useState(3);
    const [optimizationResults, setOptimizationResults] = useState<OptimizationResultItem[] | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadingMessage, setLoadingMessage] = useState('Running Simulation...');
    const [isParamsOpen, setIsParamsOpen] = useState(false);
    const [isFiltersOpen, setIsFiltersOpen] = useState(false);


    const canOptimize = [9, 11, 13, 14, 17, 18].includes(config.selectedAgent.id);
    
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
                finalEntryFailSafe: 'fail-open',
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
        const onProgress = (progress: { percent: number; combinations: number }) => {
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
                finalEntryFailSafe: 'fail-open',
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
                         {config.selectedAgent.id === 20 && (
                            <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                                <div className="flex items-center justify-between">
                                     <div className="flex items-center gap-1.5">
                                        <label htmlFor="heikin-ashi-toggle-backtest" className={formLabelClass}>
                                            Use Heikin Ashi Candles
                                        </label>
                                        <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" title="Calculates Supertrend signals using smoothed Heikin Ashi candles instead of regular candles to filter noise." />
                                    </div>
                                    <ToggleSwitch
                                        checked={config.isHeikinAshiEnabled}
                                        onChange={v => updateConfig('isHeikinAshiEnabled', v)}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                        <button onClick={() => setIsParamsOpen(!isParamsOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                            <span>Customize Agent Parameters</span>
                            {isParamsOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                        </button>
                        {isParamsOpen && (
                            <div className="p-3 border-t border-slate-200 dark:border-slate-600 space-y-4">
                                <AgentParameterEditor agent={config.selectedAgent} params={config.agentParams} onParamsChange={(p) => updateConfig('agentParams', p)} isAdxFilterEnabled={config.isAdxFilterEnabled} timeFrame={config.chartTimeFrame} />
                            </div>
                        )}
                    </div>

                    {/* FIX: The broken JSX has been restructured into a proper collapsible section for agent filters. */}
                    <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                        <button onClick={() => setIsFiltersOpen(!isFiltersOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                            <span>Customize Agent Filters</span>
                            {isFiltersOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                        </button>
                        {isFiltersOpen && (
                            <div className="p-3 border-t border-slate-200 dark:border-slate-600 space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>Higher TF Confirmation</label>
                                    <ToggleSwitch checked={config.isHtfConfirmationEnabled} onChange={v => updateConfig('isHtfConfirmationEnabled', v)} />
                                </div>
                                {config.isHtfConfirmationEnabled && higherTimeFrames.length > 0 && (
                                    <div className="flex flex-col gap-1.5 mt-2">
                                        <label className={formLabelClass}>Confirmation Timeframe</label>
                                        <select value={config.htfTimeFrame} onChange={e => updateConfig('htfTimeFrame', e.target.value)} className={formInputClass}>
                                            <option value="auto">Auto</option>
                                            {higherTimeFrames.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                                        </select>
                                    </div>
                                )}
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>Momentum Concordance</label>
                                    <ToggleSwitch checked={config.isMomentumConcordanceEnabled} onChange={v => updateConfig('isMomentumConcordanceEnabled', v)} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>Liquidation Cascade Veto</label>
                                    <ToggleSwitch checked={config.isLiquidationFilterEnabled} onChange={v => updateConfig('isLiquidationFilterEnabled', v)} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>ADX Trend Filter</label>
                                    <ToggleSwitch checked={config.isAdxFilterEnabled} onChange={v => updateConfig('isAdxFilterEnabled', v)} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>Market Breadth Filter</label>
                                    <ToggleSwitch checked={config.isMarketBreadthFilterEnabled} onChange={v => updateConfig('isMarketBreadthFilterEnabled', v)} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>BTC Trend Confirmation</label>
                                    <ToggleSwitch checked={config.isBtcConfirmationEnabled} onChange={v => updateConfig('isBtcConfirmationEnabled', v)} />
                                </div>
                                {config.isBtcConfirmationEnabled && (
                                    <ParamSlider 
                                        label="BTC Trend Threshold"
                                        value={config.btcConfirmationThreshold}
                                        onChange={v => updateConfig('btcConfirmationThreshold', v)}
                                        min={50} max={85} step={5}
                                        valueDisplay={(v) => `${v}%`}
                                    />
                                )}
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>Capital Flow Veto</label>
                                    <ToggleSwitch checked={config.isBtcCorrelationVetoEnabled} onChange={v => updateConfig('isBtcCorrelationVetoEnabled', v)} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>VWAP Confirmation</label>
                                    <ToggleSwitch checked={config.isVwapConfirmationEnabled} onChange={v => updateConfig('isVwapConfirmationEnabled', v)} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>Universal Volume Filter</label>
                                    <ToggleSwitch checked={config.isVolumeFilterEnabled} onChange={v => updateConfig('isVolumeFilterEnabled', v)} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>Market Cohesion Filter</label>
                                    <ToggleSwitch checked={config.isMarketCohesionEnabled} onChange={v => updateConfig('isMarketCohesionEnabled', v)} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>Exhaustion Filter</label>
                                    <ToggleSwitch checked={config.isExhaustionFilterEnabled} onChange={v => updateConfig('isExhaustionFilterEnabled', v)} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>SMC Reversal Veto</label>
                                    <ToggleSwitch checked={config.isSmcVetoEnabled} onChange={v => updateConfig('isSmcVetoEnabled', v)} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>Market Structure Veto</label>
                                    <ToggleSwitch checked={config.isMarketStructureVetoEnabled} onChange={v => updateConfig('isMarketStructureVetoEnabled', v)} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>Supertrend Confirmation</label>
                                    <ToggleSwitch checked={config.isSupertrendConfirmationEnabled} onChange={v => updateConfig('isSupertrendConfirmationEnabled', v)} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>S/R Zone Analysis</label>
                                    <ToggleSwitch checked={config.isSrAnalysisEnabled} onChange={v => updateConfig('isSrAnalysisEnabled', v)} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>Candlestick Veto</label>
                                    <ToggleSwitch checked={config.isCandlestickConfirmationEnabled} onChange={v => updateConfig('isCandlestickConfirmationEnabled', v)} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className={formLabelClass}>Confirmation Candle Veto</label>
                                    <ToggleSwitch checked={config.isConfirmationCandleEnabled} onChange={v => updateConfig('isConfirmationCandleEnabled', v)} />
                                </div>
                            </div>
                        )}
                    </div>


                    <div className="flex gap-4">
                        <button onClick={handleRunBacktest} disabled={isLoading} className={primaryButtonClass}>
                            <FlaskIcon className="w-5 h-5"/>
                            Run Backtest
                        </button>
                        <button onClick={handleRunOptimization} disabled={isLoading || !canOptimize} className={`${primaryButtonClass} bg-indigo-600 hover:bg-indigo-700`}>
                            <SparklesIcon className="w-5 h-5"/>
                            Optimize
                        </button>
                    </div>
                </div>
            </div>

            {/* --- Results Column --- */}
            <div className="lg:col-span-9">
                {isLoading ? (
                     <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 h-full flex items-center justify-center">
                        <div className="text-center">
                             <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500 mx-auto"></div>
                             <p className="mt-4 text-slate-500 dark:text-slate-400">{loadingMessage}</p>
                        </div>
                    </div>
                ) : error ? (
                    <div className="bg-rose-100 dark:bg-rose-900/50 border-l-4 border-rose-500 text-rose-700 dark:text-rose-300 p-4 rounded-r-lg h-full flex flex-col justify-center">
                        <h3 className="font-bold text-lg mb-2">An Error Occurred</h3>
                        <p>{error}</p>
                        <button onClick={() => setError(null)} className="mt-4 text-sm font-semibold text-rose-800 dark:text-rose-200 underline">Try again</button>
                    </div>
                ) : backtestResult ? (
                    <BacktestResultDisplay 
                        result={backtestResult} 
                        onReset={() => { setBacktestResult(null); setOptimizationResults(null); }}
                        onApplyAndSwitchView={() => {
                            globalActions.setTradingMode(config.tradingMode);
                            globalActions.setSelectedPairs([config.selectedPair]);
                            globalActions.setTimeFrame(config.chartTimeFrame);
                            globalActions.setSelectedAgent(config.selectedAgent);
                            globalActions.setInvestmentAmount(config.investmentAmount);
                            globalActions.setMaxMarginLossPercent(config.maxMarginLossPercent);
                            globalActions.setIsInitialRiskVetoEnabled(config.isInitialRiskVetoEnabled);
                            globalActions.setIsHtfConfirmationEnabled(config.isHtfConfirmationEnabled);
                            globalActions.setIsUniversalProfitTrailEnabled(config.isUniversalProfitTrailEnabled);
                            globalActions.setHtfTimeFrame(config.htfTimeFrame);
                            globalActions.setAgentParams(config.agentParams);
                            globalActions.setLeverage(config.leverage);
                            globalActions.setMarginType(config.marginType);
                            globalActions.setIsMinRrEnabled(config.isMinRrEnabled);
                            globalActions.setInvalidationSensitivity(config.invalidationSensitivity);
                            globalActions.setIsAgentTrailEnabled(config.isAgentTrailEnabled);
                            globalActions.setIsBreakevenTrailEnabled(config.isBreakevenTrailEnabled);
                            globalActions.setIsMarketCohesionEnabled(config.isMarketCohesionEnabled);
                            globalActions.setIsExhaustionFilterEnabled(config.isExhaustionFilterEnabled);
                            globalActions.setIsSmcVetoEnabled(config.isSmcVetoEnabled);
                            globalActions.setEntryTiming(config.entryTiming);
                            globalActions.setIsAdaptiveTpEnabled(config.isAdaptiveTpEnabled);
                            globalActions.setAggressiveTrailMode(config.aggressiveTrailMode);
                            globalActions.setIsVwapConfirmationEnabled(config.isVwapConfirmationEnabled);
                            globalActions.setIsBtcConfirmationEnabled(config.isBtcConfirmationEnabled);
                            globalActions.setIsBtcCorrelationVetoEnabled(config.isBtcCorrelationVetoEnabled);
                            globalActions.setBtcConfirmationThreshold(config.btcConfirmationThreshold);
                            globalActions.setIsVolumeFilterEnabled(config.isVolumeFilterEnabled);
                            globalActions.setIsAdxFilterEnabled(config.isAdxFilterEnabled);
                            globalActions.setIsSrAnalysisEnabled(config.isSrAnalysisEnabled);
                            globalActions.setIsCandlestickConfirmationEnabled(config.isCandlestickConfirmationEnabled);
                            globalActions.setIsMarketStructureVetoEnabled(config.isMarketStructureVetoEnabled);
                            globalActions.setIsSupertrendConfirmationEnabled(config.isSupertrendConfirmationEnabled);
                            globalActions.setIsMarketBreadthFilterEnabled(config.isMarketBreadthFilterEnabled);
                            globalActions.setIsLiquidationFilterEnabled(config.isLiquidationFilterEnabled);
                            globalActions.setIsConfirmationCandleEnabled(config.isConfirmationCandleEnabled);
                            globalActions.setIsMomentumConcordanceEnabled(config.isMomentumConcordanceEnabled);
                            globalActions.setIsTradeGuardianEnabled(config.isTradeGuardianEnabled);
                            globalActions.setIsHeikinAshiEnabled(config.isHeikinAshiEnabled);
                            setActiveView('trading');
                        }}
                    />
                ) : optimizationResults ? (
                    <OptimizationResults 
                        results={optimizationResults}
                        onReset={() => { setBacktestResult(null); setOptimizationResults(null); }}
                        onApplyAndSwitchView={handleApplyAndSwitch}
                        pricePrecision={8} // TODO: pass this down dynamically
                    />
                ) : (
                     <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 h-full flex items-center justify-center">
                        <div className="text-center">
                            <FlaskIcon className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4"/>
                            <h3 className="font-bold text-lg">Run a Backtest or Optimization</h3>
                            <p className="text-slate-500 dark:text-slate-400">Configure your parameters on the left and start a simulation to see the results here.</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
