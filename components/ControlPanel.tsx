import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { TradingMode, Kline, TradeSignal, AgentParams, BotConfig, Agent, LiveTicker } from '../types';
import * as constants from '../constants';
import { PlayIcon, CpuIcon, ChevronDown, ChevronUp, InfoIcon } from './icons';
import { AnalysisPreview } from './AnalysisPreview';
import { getTradingSignal, captureMarketContext } from '../services/localAgentService';
import { sharedKlineService } from '../services/sharedKlineService';
import { SearchableDropdown } from './SearchableDropdown';
import { useTradingConfigState, useTradingConfigActions } from '../contexts/TradingConfigContext';
import { botManagerService } from '../services/botManagerService';


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

const AgentParameterEditor: React.FC<{agent: Agent, params: AgentParams, onParamsChange: (p: AgentParams) => void, isAdxFilterEnabled: boolean, timeFrame: string}> = ({ agent, params, onParamsChange, isAdxFilterEnabled, timeFrame }) => {
    const [isExitVetoOpen, setIsExitVetoOpen] = useState(false);
    const [isAstraX_PillarWeightsOpen, setIsAstraX_PillarWeightsOpen] = useState(false);
    const [isAstraX_ContextWeightsOpen, setIsAstraX_ContextWeightsOpen] = useState(false);
    const [isAstraX_AdaptiveThresholdsOpen, setIsAstraX_AdaptiveThresholdsOpen] = useState(true);
    const [isAstraX_SetupTriggerOpen, setIsAstraX_SetupTriggerOpen] = useState(false);

    const allParams = useMemo(() => {
        const timeframeDefaults = constants.getAgentTimeframeSettings(agent.id, timeFrame);
        return { ...constants.DEFAULT_AGENT_PARAMS, ...timeframeDefaults, ...params };
    }, [agent.id, timeFrame, params]);

    const updateParam = (key: keyof AgentParams, value: number | boolean | string) => { onParamsChange({ ...params, [key]: value }); };
    switch (agent.id) {
        case 19: return (<div className="space-y-4">
            
            {/* --- ADAPTIVE THRESHOLDS --- */}
            <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                <button onClick={() => setIsAstraX_AdaptiveThresholdsOpen(!isAstraX_AdaptiveThresholdsOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                    <span>Adaptive Thresholds</span>
                    {isAstraX_AdaptiveThresholdsOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {isAstraX_AdaptiveThresholdsOpen && (
                    <div className="p-3 border-t border-slate-200 dark:border-slate-600 space-y-4">
                        <ParamSlider label="Base Entry Threshold" value={allParams.astraX_baseThreshold!} onChange={v => updateParam('astraX_baseThreshold', v)} min={25} max={75} step={1} />
                        <ParamSlider label="Strong Trend ADX" value={allParams.astraX_strongTrendAdx!} onChange={v => updateParam('astraX_strongTrendAdx', v)} min={25} max={40} step={1} />
                        <ParamSlider label="Chop Market ADX" value={allParams.astraX_chopAdx!} onChange={v => updateParam('astraX_chopAdx', v)} min={15} max={25} step={1} />
                        <ParamSlider label="Strong Trend Threshold" value={allParams.astraX_strongTrendThreshold!} onChange={v => updateParam('astraX_strongTrendThreshold', v)} min={50} max={85} step={1} />
                        <ParamSlider label="Chop Market Threshold" value={allParams.astraX_chopThreshold!} onChange={v => updateParam('astraX_chopThreshold', v)} min={60} max={95} step={1} />
                        <ParamSlider label="Strong Trend Multiplier" value={allParams.astraX_regimeMultiplier_strong!} onChange={v => updateParam('astraX_regimeMultiplier_strong', v)} min={0.5} max={1.0} step={0.05} valueDisplay={v => `${v.toFixed(2)}x`} />
                        <ParamSlider label="Chop Market Multiplier" value={allParams.astraX_regimeMultiplier_chop!} onChange={v => updateParam('astraX_regimeMultiplier_chop', v)} min={1.0} max={1.5} step={0.05} valueDisplay={v => `${v.toFixed(2)}x`} />
                    </div>
                )}
            </div>

            {/* --- PILLAR WEIGHTS --- */}
             <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                <button onClick={() => setIsAstraX_PillarWeightsOpen(!isAstraX_PillarWeightsOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                    <span>Pillar Weights</span>
                    {isAstraX_PillarWeightsOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {isAstraX_PillarWeightsOpen && (
                    <div className="p-3 border-t border-slate-200 dark:border-slate-600 space-y-4">
                        <ParamSlider label="Structure Weight" value={allParams.astraX_weights_structure!} onChange={v => updateParam('astraX_weights_structure', v)} min={0} max={100} step={5} valueDisplay={v => `${v}%`} />
                        <ParamSlider label="Momentum Weight" value={allParams.astraX_weights_momentum!} onChange={v => updateParam('astraX_weights_momentum', v)} min={0} max={100} step={5} valueDisplay={v => `${v}%`} />
                        <ParamSlider label="Context Weight" value={allParams.astraX_weights_context!} onChange={v => updateParam('astraX_weights_context', v)} min={0} max={100} step={5} valueDisplay={v => `${v}%`} />
                        <ParamSlider label="Confirmation Weight" value={allParams.astraX_weights_confirmation!} onChange={v => updateParam('astraX_weights_confirmation', v)} min={0} max={100} step={5} valueDisplay={v => `${v}%`} />
                    </div>
                )}
            </div>

            {/* --- CONTEXT PILLAR WEIGHTS --- */}
             <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                <button onClick={() => setIsAstraX_ContextWeightsOpen(!isAstraX_ContextWeightsOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                    <span>Context Pillar Weights</span>
                    {isAstraX_ContextWeightsOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {isAstraX_ContextWeightsOpen && (
                    <div className="p-3 border-t border-slate-200 dark:border-slate-600 space-y-4">
                        <ParamSlider label="VWAP Weight" value={allParams.astraX_context_vwapWeight!} onChange={v => updateParam('astraX_context_vwapWeight', v)} min={0} max={100} step={5} valueDisplay={v => `${v}%`} />
                        <ParamSlider label="Volatility Weight" value={allParams.astraX_context_volatilityWeight!} onChange={v => updateParam('astraX_context_volatilityWeight', v)} min={0} max={100} step={5} valueDisplay={v => `${v}%`} />
                        <ParamSlider label="Market Breadth Weight" value={allParams.astraX_context_marketBreadthWeight!} onChange={v => updateParam('astraX_context_marketBreadthWeight', v)} min={0} max={100} step={5} valueDisplay={v => `${v}%`} />
                        <ParamSlider label="Liquidation Weight" value={allParams.astraX_context_liquidationWeight!} onChange={v => updateParam('astraX_context_liquidationWeight', v)} min={0} max={100} step={5} valueDisplay={v => `${v}%`} />
                    </div>
                )}
            </div>

            {/* --- SETUP & TRIGGER LOGIC --- */}
            <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                <button onClick={() => setIsAstraX_SetupTriggerOpen(!isAstraX_SetupTriggerOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                    <span>Setup & Trigger Logic</span>
                    {isAstraX_SetupTriggerOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {isAstraX_SetupTriggerOpen && (
                    <div className="p-3 border-t border-slate-200 dark:border-slate-600 space-y-4">
                        <h4 className="text-sm font-semibold text-slate-500 dark:text-slate-400">Pullback Setup (Trend)</h4>
                        <ParamSlider label="Pullback EMA Period" value={allParams.astraX_scalp_retestEmaPeriod!} onChange={v => updateParam('astraX_scalp_retestEmaPeriod', v)} min={5} max={20} step={1} />
                        
                        <h4 className="text-sm font-semibold text-slate-500 dark:text-slate-400 pt-3 border-t border-slate-200 dark:border-slate-700">Mean Reversion Setup (Chop)</h4>
                        <ParamSlider label="Bollinger Bands Period" value={allParams.astraX_scalp_bbPeriod!} onChange={v => updateParam('astraX_scalp_bbPeriod', v)} min={15} max={30} step={1} />
                        <ParamSlider label="Bollinger Bands StdDev" value={allParams.astraX_scalp_bbStdDev!} onChange={v => updateParam('astraX_scalp_bbStdDev', v)} min={1.8} max={2.5} step={0.1} valueDisplay={v => v.toFixed(1)} />
                        
                        <h4 className="text-sm font-semibold text-slate-500 dark:text-slate-400 pt-3 border-t border-slate-200 dark:border-slate-700">Trigger Confirmation</h4>
                        <ParamSlider label="Structure Lookback" value={allParams.astraX_structureLookback!} onChange={v => updateParam('astraX_structureLookback', v)} min={5} max={15} step={1} />
                        <ParamSlider label="Min Volume Multiplier" value={allParams.astraX_confirmation_minVolumeMultiplier!} onChange={v => updateParam('astraX_confirmation_minVolumeMultiplier', v)} min={0.8} max={2.0} step={0.1} valueDisplay={v => `${v.toFixed(1)}x`} />
                        <ParamSlider label="Min Candle Body Ratio" value={allParams.astraX_confirmation_candleBodyMinRatio!} onChange={v => updateParam('astraX_confirmation_candleBodyMinRatio', v)} min={0.1} max={0.7} step={0.05} valueDisplay={v => `${(v * 100).toFixed(0)}%`} />
                    </div>
                )}
            </div>

            </div>);
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
                        <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                Adjusts ATR multiplier based on market volatility percentile to reduce whipsaws in high volatility and react faster in low volatility.
                            </div>
                        </div>
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

export const ControlPanel: React.FC<ControlPanelProps> = (props) => {
    const {
        onStartBot, botsToCreateCount, selectedPairsCount, theme, klines
    } = props;
    
    const config = useTradingConfigState();
    const actions = useTradingConfigActions();
    
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
        isHeikinAshiEnabled
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
        setIsTradeGuardianEnabled, setIsHeikinAshiEnabled
    } = actions;
    
    const [livePrice, setLivePrice] = useState(0);
    const livePriceRef = useRef(0);

    const isInvestmentInvalid = executionMode === 'live' && investmentAmount > availableBalance;

    const [analysisSignal, setAnalysisSignal] = useState<TradeSignal | null>(null);
    const [isAnalysisLoading, setIsAnalysisLoading] = useState(false);
    const [isAnalysisOpen, setIsAnalysisOpen] = useState(true);
    const [selectedList, setSelectedList] = useState<string | null>(null);

    const analysisPair = useMemo(() => selectedPairs[0], [selectedPairs]);
    
    const lastAnalysisRequestTime = useRef(0);
    const analysisInProgress = useRef(false);
    const lastAnalysisErrorTime = useRef(0);

    useEffect(() => {
        if (!analysisPair) return;

        const formattedPair = analysisPair.replace('/', '');
        const tickerCallback = (tickerData: any) => {
             const ticker: LiveTicker = { 
                 pair: tickerData.s, 
                 closePrice: parseFloat(tickerData.c), 
                 highPrice: parseFloat(tickerData.h), 
                 lowPrice: parseFloat(tickerData.l), 
                 volume: parseFloat(tickerData.v), 
                 quoteVolume: parseFloat(tickerData.q) 
             };
             if (ticker.pair.toLowerCase() === formattedPair.toLowerCase()) {
                setLivePrice(ticker.closePrice);
                livePriceRef.current = ticker.closePrice;
             }
        };

        botManagerService.subscribeToTickerUpdates(formattedPair, tradingMode, tickerCallback);

        return () => {
            botManagerService.unsubscribeFromTickerUpdates(formattedPair, tradingMode, tickerCallback);
        };
    }, [analysisPair, tradingMode]);

    const pairListOptions = useMemo(() => {
        const spotLists = tradingPairLists
            .filter(list => list.tradingMode === TradingMode.Spot)
            .map(list => ({ value: list.name, label: list.name }));

        const futuresLists = tradingPairLists
            .filter(list => list.tradingMode === TradingMode.USDSM_Futures)
            .map(list => ({ value: list.name, label: list.name }));
        
        const groups = [];
        if (futuresLists.length > 0) {
            groups.push({
                label: 'USDⓈ-M Futures Lists',
                options: futuresLists
            });
        }
        if (spotLists.length > 0) {
            groups.push({
                label: 'Spot Lists',
                options: spotLists
            });
        }
        return groups;
    }, [tradingPairLists]);


    const handleLoadList = (listName: string | string[]) => {
        if (typeof listName === 'string') {
            const list = tradingPairLists.find(l => l.name === listName);
            if (list) {
                setSelectedPairs(list.pairs);
            }
            setSelectedList(null); 
        }
    };

    const higherTimeFrames = useMemo(() => {
        const currentIndex = constants.TIME_FRAMES.indexOf(timeFrame);
        if (currentIndex === -1) return [];
        return constants.TIME_FRAMES.slice(currentIndex + 1);
    }, [timeFrame]);

    useEffect(() => {
        // When the base timeframe changes, if the selected HTF is no longer valid, reset to 'auto'
        if (htfTimeFrame !== 'auto' && !higherTimeFrames.includes(htfTimeFrame)) {
            setHtfTimeFrame('auto');
        }
    }, [timeFrame, htfTimeFrame, higherTimeFrames, setHtfTimeFrame]);

    const fetchAnalysis = useCallback(async () => {
        if (analysisInProgress.current) return;

        const now = Date.now();
        // Add a 10-second cool-down period after a failed analysis to prevent spamming the API.
        if (now - lastAnalysisErrorTime.current < 10000) {
            return;
        }
        
        if (now - lastAnalysisRequestTime.current < 2000) { // 2 second throttle
            return;
        }
        lastAnalysisRequestTime.current = now;
        
        try {
            const currentLivePrice = livePriceRef.current;
            if (analysisPair && klines.length > 0 && currentLivePrice > 0) {
                analysisInProgress.current = true;
                setIsAnalysisLoading(true);

                const lastKline = klines[klines.length - 1];
                const previewKline: Kline = { ...lastKline, high: Math.max(lastKline.high, currentLivePrice), low: Math.min(lastKline.low, currentLivePrice), close: currentLivePrice, isFinal: false };
                const previewKlines = [...klines.slice(0, -1), previewKline];

                let htfKlines: Kline[] | undefined;
                if (isHtfConfirmationEnabled) {
                    const htf = htfTimeFrame === 'auto' ? constants.TIME_FRAMES[constants.TIME_FRAMES.indexOf(timeFrame) + 1] : htfTimeFrame;
                    if (htf) htfKlines = await sharedKlineService.getData(analysisPair, htf, tradingMode);
                }
                
                const marketContext = captureMarketContext(previewKlines, htfKlines);
                const previewConfig: BotConfig = {
                    pair: analysisPair, mode: tradingMode, executionMode: executionMode, leverage: leverage, marginType: marginType,
                    agent: selectedAgent, timeFrame: timeFrame, investmentAmount: investmentAmount, maxMarginLossPercent: maxMarginLossPercent,
                    isInitialRiskVetoEnabled: isInitialRiskVetoEnabled, isHtfConfirmationEnabled: isHtfConfirmationEnabled,
                    isUniversalProfitTrailEnabled: isUniversalProfitTrailEnabled, isMinRrEnabled: isMinRrEnabled,
                    invalidationSensitivity: invalidationSensitivity, isAgentTrailEnabled: isAgentTrailEnabled, isBreakevenTrailEnabled: isBreakevenTrailEnabled,
                    isMarketCohesionEnabled: isMarketCohesionEnabled, isVwapConfirmationEnabled: isVwapConfirmationEnabled,
                    isBtcConfirmationEnabled: isBtcConfirmationEnabled, isBtcCorrelationVetoEnabled: isBtcCorrelationVetoEnabled,
                    btcConfirmationThreshold: btcConfirmationThreshold, isVolumeFilterEnabled: isVolumeFilterEnabled, isAdxFilterEnabled: isAdxFilterEnabled,
                    isExhaustionFilterEnabled: isExhaustionFilterEnabled, htfTimeFrame: htfTimeFrame, agentParams: agentParams,
                    pricePrecision: 8, quantityPrecision: 8, stepSize: 0.00000001, takerFeeRate: constants.TAKER_FEE_RATE, entryTiming: entryTiming,
                    isAdaptiveTpEnabled: isAdaptiveTpEnabled, aggressiveTrailMode: aggressiveTrailMode, isSmcVetoEnabled: isSmcVetoEnabled,
                    isSrAnalysisEnabled: isSrAnalysisEnabled, isCandlestickConfirmationEnabled: isCandlestickConfirmationEnabled,
                    isMarketStructureVetoEnabled: isMarketStructureVetoEnabled, isSupertrendConfirmationEnabled: isSupertrendConfirmationEnabled,
                    isMarketBreadthFilterEnabled: isMarketBreadthFilterEnabled,
                    isLiquidationFilterEnabled: isLiquidationFilterEnabled, isConfirmationCandleEnabled: isConfirmationCandleEnabled,
                    isMomentumConcordanceEnabled: isMomentumConcordanceEnabled, isTradeGuardianEnabled: isTradeGuardianEnabled,
                    isHeikinAshiEnabled: isHeikinAshiEnabled,
                };

                const signal = await getTradingSignal(selectedAgent, previewKlines, previewConfig, htfKlines);
                setAnalysisSignal(signal);
                lastAnalysisErrorTime.current = 0; // Reset error time on success
            } else {
                setAnalysisSignal(null);
            }
        } catch (e) {
            console.error("Error fetching analysis signal:", e);
            setAnalysisSignal({ signal: 'HOLD', reasons: ['Error fetching analysis. Check console.'] });
            lastAnalysisErrorTime.current = now; // Set error time on failure
        } finally {
            setIsAnalysisLoading(false);
            analysisInProgress.current = false;
        }
    }, [
        selectedAgent, klines, timeFrame, agentParams, analysisPair,
        tradingMode, executionMode, leverage, marginType, investmentAmount, maxMarginLossPercent,
        isInitialRiskVetoEnabled, isHtfConfirmationEnabled, htfTimeFrame,
        isUniversalProfitTrailEnabled, isMinRrEnabled, invalidationSensitivity,
        isAgentTrailEnabled, isBreakevenTrailEnabled, isMarketCohesionEnabled,
        isVwapConfirmationEnabled, isBtcConfirmationEnabled, isBtcCorrelationVetoEnabled,
        btcConfirmationThreshold, isVolumeFilterEnabled, isAdxFilterEnabled,
        isExhaustionFilterEnabled, isSmcVetoEnabled, isSrAnalysisEnabled,
        isCandlestickConfirmationEnabled, isMarketStructureVetoEnabled,
        isSupertrendConfirmationEnabled, isAdaptiveTpEnabled, aggressiveTrailMode, entryTiming,
        isMarketBreadthFilterEnabled, isLiquidationFilterEnabled,
        isConfirmationCandleEnabled, isMomentumConcordanceEnabled, isTradeGuardianEnabled, isHeikinAshiEnabled,
    ]);

    useEffect(() => {
        // Don't run analysis if there are no klines yet.
        if (klines.length > 0) {
            fetchAnalysis(); // Initial analysis
        }

        const analysisInterval = setInterval(() => {
             if (klines.length > 0) {
                fetchAnalysis();
            }
        }, 5000); // Refresh every 5 seconds

        return () => clearInterval(analysisInterval);
    }, [fetchAnalysis, klines.length]);
    
    const getButtonText = () => {
        if (selectedPairsCount === 0) return 'Select One or More Markets';
        if (botsToCreateCount === 0 && selectedPairsCount > 0) return 'Bot(s) Already Running';
        const plural = botsToCreateCount > 1 ? 's' : '';
        return `Start ${botsToCreateCount} Trading Bot${plural}`;
    };

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
                    <SearchableDropdown
                        options={pairListOptions}
                        value={selectedList || ''}
                        onChange={handleLoadList}
                        theme={theme}
                    />
                </div>
            )}
            
            <div className={formGroupClass}>
                <label htmlFor="market-pair" className={formLabelClass}>Market(s)</label>
                <SearchableDropdown
                    isMulti
                    options={allPairs}
                    value={selectedPairs}
                    onChange={(newPairs) => setSelectedPairs(newPairs as string[])}
                    theme={theme}
                    disabled={isPairsLoading}
                />
            </div>
            
            <div className={formGroupClass}>
                <label htmlFor="time-frame" className={formLabelClass}>Time Frame</label>
                <select id="time-frame" value={timeFrame} onChange={e => setTimeFrame(e.target.value)} className={formInputClass}>
                    {constants.TIME_FRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                </select>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>
            
             <div className={formGroupClass}>
                <div className="flex justify-between items-baseline">
                    <label htmlFor="investment-amount" className={formLabelClass}>
                        Investment Amount (per bot)
                    </label>
                    {executionMode === 'live' && (
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                            Available: ${availableBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                        </span>
                    )}
                 </div>
                 <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">$</span>
                    <input 
                        type="number"
                        id="investment-amount"
                        value={investmentAmount} 
                        onChange={e => setInvestmentAmount(Number(e.target.value))} 
                        className={`${formInputClass} pl-7 ${isInvestmentInvalid ? 'border-rose-500 focus:ring-rose-500' : ''}`}
                        min="1"
                    />
                </div>
                {isInvestmentInvalid && (
                    <p className="text-xs text-rose-600 dark:text-rose-400">Investment amount cannot exceed available balance.</p>
                )}
            </div>
            
            <ParamSlider 
                label="Max Margin Loss %" 
                value={maxMarginLossPercent} 
                onChange={v => setMaxMarginLossPercent(v)} 
                min={1} 
                max={25} 
                step={0.5}
                valueDisplay={v => `${v.toFixed(1)}%`}
            />
            
            <div className={`${formGroupClass} -mt-2`}>
                <div className="flex items-center justify-between">
                     <div className="flex items-center gap-1.5">
                        <label htmlFor="initial-risk-veto-toggle" className={formLabelClass}>
                            Initial Risk Veto
                        </label>
                         <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                Vetoes trades if the initial stop loss risk (in dollars) is greater than the 'Max Margin Loss %' of the investment amount.
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isInitialRiskVetoEnabled}
                        onChange={setIsInitialRiskVetoEnabled}
                    />
                </div>
            </div>

             <p className="text-xs text-slate-500 dark:text-slate-400">
                Stop Loss & Take Profit are fully automated by the agent's logic and the universal profit-locking system.
            </p>
            
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
                            <button 
                                onClick={() => setMarginType('ISOLATED')} 
                                className={`flex-1 text-center text-sm font-semibold p-1.5 rounded-md transition-colors ${marginType === 'ISOLATED' ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}
                                disabled={isMultiAssetMode}
                            >
                                Isolated
                            </button>
                            <button 
                                onClick={() => setMarginType('CROSSED')} 
                                className={`flex-1 text-center text-sm font-semibold p-1.5 rounded-md transition-colors ${marginType === 'CROSSED' ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}
                                disabled={isMultiAssetMode}
                            >
                                Crossed
                            </button>
                        </div>
                        {isMultiAssetMode && <p className="text-xs text-slate-500 dark:text-slate-400">Multi-Asset mode forces CROSSED margin.</p>}
                        {futuresSettingsError && <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">{futuresSettingsError}</p>}
                    </div>

                    <div className={formGroupClass}>
                        <label htmlFor="leverage-slider" className="flex justify-between items-baseline">
                            <span className={formLabelClass}>Leverage</span>
                            <span className={`font-bold text-sky-500 ${isLeverageLoading ? 'animate-pulse' : ''}`}>{leverage}x</span>
                        </label>
                        <input
                            id="leverage-slider"
                            type="range"
                            min="1"
                            max={maxLeverage}
                            value={leverage}
                            onChange={e => setLeverage(Number(e.target.value))}
                            className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer"
                            disabled={isLeverageLoading}
                        />
                    </div>
                </>
            )}

            <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>

             <div className={formGroupClass}>
                <div className="flex justify-between items-center">
                    <label htmlFor="agent-select" className={formLabelClass}>Trading Agent</label>
                    <button 
                        onClick={() => setAgentParams({})}
                        className="text-xs font-semibold text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-500 transition-colors"
                        title="Reset agent-specific parameters to their default values"
                    >
                        Reset to Default
                    </button>
                </div>
                <select 
                    id="agent-select" 
                    value={selectedAgent.id} 
                    onChange={e => {
                        const agent = constants.AGENTS.find(a => a.id === Number(e.target.value));
                        if (agent) {
                            setSelectedAgent(agent);
                            setAgentParams({}); // Reset params on agent change for a clean slate
                        }
                    }} 
                    className={formInputClass}
                >
                    {constants.AGENTS.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
                <p className="text-xs text-slate-500 dark:text-slate-400">{selectedAgent.description}</p>
                {selectedAgent.id === 20 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                             <div className="flex items-center gap-1.5">
                                <label htmlFor="heikin-ashi-toggle" className={formLabelClass}>
                                    Use Heikin Ashi Candles
                                </label>
                                 <div className="relative group">
                                    <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                                    <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                        Calculates Supertrend signals using smoothed Heikin Ashi candles instead of regular candles to filter noise.
                                    </div>
                                </div>
                            </div>
                            <ToggleSwitch
                                checked={isHeikinAshiEnabled}
                                onChange={setIsHeikinAshiEnabled}
                            />
                        </div>
                    </div>
                )}
                 {selectedAgent.id === 9 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-4">
                        <AgentParameterEditor agent={selectedAgent} params={agentParams} onParamsChange={setAgentParams} isAdxFilterEnabled={isAdxFilterEnabled} timeFrame={timeFrame} />
                    </div>
                )}
                 {selectedAgent.id === 13 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                         <AgentParameterEditor agent={selectedAgent} params={agentParams} onParamsChange={setAgentParams} isAdxFilterEnabled={isAdxFilterEnabled} timeFrame={timeFrame} />
                    </div>
                )}
                 {selectedAgent.id === 14 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                         <AgentParameterEditor agent={selectedAgent} params={agentParams} onParamsChange={setAgentParams} isAdxFilterEnabled={isAdxFilterEnabled} timeFrame={timeFrame} />
                    </div>
                )}
                {selectedAgent.id === 11 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                        <AgentParameterEditor agent={selectedAgent} params={agentParams} onParamsChange={setAgentParams} isAdxFilterEnabled={isAdxFilterEnabled} timeFrame={timeFrame} />
                    </div>
                )}
                 {selectedAgent.id === 16 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                        <AgentParameterEditor agent={selectedAgent} params={agentParams} onParamsChange={setAgentParams} isAdxFilterEnabled={isAdxFilterEnabled} timeFrame={timeFrame} />
                    </div>
                )}
                {selectedAgent.id === 17 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                        <AgentParameterEditor agent={selectedAgent} params={agentParams} onParamsChange={setAgentParams} isAdxFilterEnabled={isAdxFilterEnabled} timeFrame={timeFrame} />
                    </div>
                )}
                {selectedAgent.id === 18 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                        <AgentParameterEditor agent={selectedAgent} params={agentParams} onParamsChange={setAgentParams} isAdxFilterEnabled={isAdxFilterEnabled} timeFrame={timeFrame} />
                    </div>
                )}
                {selectedAgent.id === 19 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                        <AgentParameterEditor agent={selectedAgent} params={agentParams} onParamsChange={setAgentParams} isAdxFilterEnabled={isAdxFilterEnabled} timeFrame={timeFrame} />
                    </div>
                )}
                {selectedAgent.id === 20 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                        <AgentParameterEditor agent={selectedAgent} params={agentParams} onParamsChange={setAgentParams} isAdxFilterEnabled={isAdxFilterEnabled} timeFrame={timeFrame} />
                    </div>
                )}
                {selectedAgent.id === 21 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                        <AgentParameterEditor agent={selectedAgent} params={agentParams} onParamsChange={setAgentParams} isAdxFilterEnabled={isAdxFilterEnabled} timeFrame={timeFrame} />
                    </div>
                )}
            </div>
            
            <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                <button
                    onClick={() => setIsAnalysisOpen(!isAnalysisOpen)}
                    className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200"
                >
                    <div className="flex items-center gap-2">
                        <CpuIcon className="w-5 h-5 text-sky-500" />
                        <span>AI Analysis Preview (for {selectedPairs[0]})</span>
                    </div>
                    {isAnalysisOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {isAnalysisOpen && (
                    <div className="p-3 border-t border-slate-200 dark:border-slate-600">
                        <AnalysisPreview
                            agent={selectedAgent}
                            agentParams={agentParams}
                            analysis={analysisSignal}
                            isLoading={isAnalysisLoading}
                        />
                    </div>
                )}
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>

             <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                     <div className="flex items-center gap-1.5">
                        <label htmlFor="momentum-concordance-toggle" className={formLabelClass}>
                            Momentum Concordance
                        </label>
                         <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-52 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                Performs a 'just-in-time' analysis before entry. Vetoes trades if immediate 1-min momentum is fading or if the entry point is poor within the current candle's structure (e.g., buying the top of a wick).
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isMomentumConcordanceEnabled}
                        onChange={setIsMomentumConcordanceEnabled}
                    />
                </div>
            </div>
            
             <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                     <div className="flex items-center gap-1.5">
                        <label htmlFor="liquidation-filter-toggle" className={formLabelClass}>
                            Liquidation Cascade Veto
                        </label>
                         <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                Prevents entering a trade directly into a large, ongoing liquidation event. A key safety feature for volatile markets. (Futures only)
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isLiquidationFilterEnabled}
                        onChange={setIsLiquidationFilterEnabled}
                    />
                </div>
            </div>

            <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                     <div className="flex items-center gap-1.5">
                        <label htmlFor="adx-filter-toggle" className={formLabelClass}>
                            ADX Trend Filter
                        </label>
                         <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                Requires a strong trend (high ADX) to be present before allowing an entry. Disabling allows earlier entries at the risk of trading in choppy markets.
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isAdxFilterEnabled}
                        onChange={setIsAdxFilterEnabled}
                    />
                </div>
            </div>
            
            <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                     <div className="flex items-center gap-1.5">
                        <label htmlFor="breadth-filter-toggle" className={formLabelClass}>
                            Market Breadth Filter
                        </label>
                         <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                Ensures trades align with the immediate trend of market leaders (BTC & ETH). Vetoes trades that go against the overall market tide.
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isMarketBreadthFilterEnabled}
                        onChange={setIsMarketBreadthFilterEnabled}
                    />
                </div>
            </div>
            
            <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                     <div className="flex items-center gap-1.5">
                        <label htmlFor="btc-confirm-toggle" className={formLabelClass}>
                            BTC Trend Confirmation
                        </label>
                         <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                Vetoes trades that go against the current trend of BTC/USDT on the same timeframe.
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isBtcConfirmationEnabled}
                        onChange={setIsBtcConfirmationEnabled}
                    />
                </div>
                {isBtcConfirmationEnabled && (
                     <ParamSlider
                        label="BTC Trend Threshold"
                        value={btcConfirmationThreshold}
                        onChange={setBtcConfirmationThreshold}
                        min={50}
                        max={85}
                        step={5}
                        valueDisplay={(v) => `${v}%`}
                    />
                )}
            </div>

            <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                     <div className="flex items-center gap-1.5">
                        <label htmlFor="btc-correlation-veto-toggle" className={formLabelClass}>
                            Capital Flow Veto
                        </label>
                         <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                Vetoes altcoin LONGs if capital is flowing out of alts into BTC (i.e., ETH/BTC is trending down). A powerful risk-off filter.
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isBtcCorrelationVetoEnabled}
                        onChange={setIsBtcCorrelationVetoEnabled}
                    />
                </div>
            </div>
            
            <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                     <div className="flex items-center gap-1.5">
                        <label htmlFor="vwap-toggle" className={formLabelClass}>
                            VWAP Confirmation
                        </label>
                         <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                Filters trades to only allow LONGs above the daily VWAP and SHORTs below it. A powerful intraday trend filter.
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isVwapConfirmationEnabled}
                        onChange={setIsVwapConfirmationEnabled}
                    />
                </div>
            </div>

            <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                    <label htmlFor="htf-toggle" className={formLabelClass}>
                        Higher Timeframe Confirmation
                    </label>
                    <ToggleSwitch
                        checked={isHtfConfirmationEnabled}
                        onChange={setIsHtfConfirmationEnabled}
                    />
                </div>
                 <p className="text-xs text-slate-500 dark:text-slate-400">
                    Aligns trade signals with the dominant trend on a higher timeframe.
                </p>
                {isHtfConfirmationEnabled && higherTimeFrames.length > 0 && (
                    <div className="flex flex-col gap-1.5 mt-2">
                        <label className={formLabelClass}>Confirmation Timeframe</label>
                        <select value={htfTimeFrame} onChange={e => setHtfTimeFrame(e.target.value)} className={formInputClass}>
                            <option value="auto">Auto</option>
                            {higherTimeFrames.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                        </select>
                    </div>
                )}
            </div>
            <div className={`${formGroupClass} space-y-2`}>
                <div className="flex items-center justify-between">
                    <label htmlFor="volume-filter-toggle" className={formLabelClass}>
                        Universal Volume Filter
                    </label>
                    <ToggleSwitch
                        checked={isVolumeFilterEnabled}
                        onChange={setIsVolumeFilterEnabled}
                    />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Ensures entry candle volume is above the 20-period moving average.
                </p>
                {isVolumeFilterEnabled && (
                    <ParamSlider 
                        label="Volume Multiplier" 
                        value={agentParams.veto_volumeFilterMultiplier ?? constants.DEFAULT_AGENT_PARAMS.veto_volumeFilterMultiplier} 
                        onChange={v => setAgentParams({...agentParams, veto_volumeFilterMultiplier: v})} 
                        min={0.5} max={2.5} step={0.1} 
                        valueDisplay={v => `${v.toFixed(1)}x Avg`}
                    />
                )}
            </div>
            <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                    <label htmlFor="cohesion-toggle" className={formLabelClass}>
                        Market Cohesion Filter
                    </label>
                    <ToggleSwitch
                        checked={isMarketCohesionEnabled}
                        onChange={setIsMarketCohesionEnabled}
                    />
                </div>
                 <p className="text-xs text-slate-500 dark:text-slate-400">
                    Uses Heikin-Ashi candles as a final gatekeeper to ensure trades are only taken in smooth, cohesive trends, avoiding choppy markets.
                </p>
            </div>
            <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                    <label htmlFor="exhaustion-filter-toggle" className={formLabelClass}>
                        Exhaustion Filter
                    </label>
                    <ToggleSwitch
                        checked={isExhaustionFilterEnabled}
                        onChange={setIsExhaustionFilterEnabled}
                    />
                </div>
                 <p className="text-xs text-slate-500 dark:text-slate-400">
                   Prevents entries on over-extended moves using StochRSI.
                </p>
            </div>
            <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <label htmlFor="smc-veto-toggle" className={formLabelClass}>
                            SMC Reversal Veto
                        </label>
                         <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                Prevents entries into potential Smart Money Concept reversal patterns (divergence + liquidity sweep + market structure break).
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isSmcVetoEnabled}
                        onChange={setIsSmcVetoEnabled}
                    />
                </div>
            </div>
            <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <label htmlFor="market-structure-veto-toggle" className={formLabelClass}>
                            Market Structure Veto
                        </label>
                        <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-52 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                Analyzes swing points to identify the market trend and will veto trades that go against a confirmed structure or a recent Change of Character (ChoCH).
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isMarketStructureVetoEnabled}
                        onChange={setIsMarketStructureVetoEnabled}
                    />
                </div>
            </div>
            <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <label htmlFor="supertrend-confirmation-toggle" className={formLabelClass}>
                            Supertrend Confirmation
                        </label>
                         <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                A universal trend filter. Only allows LONGs if price is above the Supertrend and SHORTs if price is below it.
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isSupertrendConfirmationEnabled}
                        onChange={setIsSupertrendConfirmationEnabled}
                    />
                </div>
            </div>
            <div className={`${formGroupClass} space-y-2`}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <label htmlFor="sr-analysis-toggle" className={formLabelClass}>
                            S/R Zone Analysis
                        </label>
                        <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                Vetoes trades that would enter directly into a significant support or resistance zone.
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isSrAnalysisEnabled}
                        onChange={setIsSrAnalysisEnabled}
                    />
                </div>
                {isSrAnalysisEnabled && (
                     <ParamSlider 
                        label="S/R Zone Buffer" 
                        value={agentParams.veto_srZoneAtrBuffer ?? constants.DEFAULT_AGENT_PARAMS.veto_srZoneAtrBuffer} 
                        onChange={v => setAgentParams({...agentParams, veto_srZoneAtrBuffer: v})} 
                        min={0.1} max={2.0} step={0.1} 
                        valueDisplay={v => `${v.toFixed(1)}x ATR`}
                    />
                )}
            </div>
            <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <label htmlFor="candlestick-veto-toggle" className={formLabelClass}>
                            Candlestick Veto
                        </label>
                        <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                Vetoes trades if the most recent candle is a strong, contradictory reversal pattern.
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isCandlestickConfirmationEnabled}
                        onChange={setIsCandlestickConfirmationEnabled}
                    />
                </div>
            </div>
            <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>
            <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                     <div className="flex items-center gap-1.5">
                        <label htmlFor="trade-guardian-toggle" className={formLabelClass}>
                            Trade Guardian
                        </label>
                         <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-52 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                Proactive exit system. Continuously monitors open positions for signs of invalidation (e.g., fading momentum, adverse price action) to exit trades before the stop loss is hit.
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isTradeGuardianEnabled}
                        onChange={setIsTradeGuardianEnabled}
                    />
                </div>
            </div>
             <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                    <label htmlFor="agent-trail-toggle" className={formLabelClass}>
                        Agent Indicator Trail
                    </label>
                    <ToggleSwitch
                        checked={isAgentTrailEnabled}
                        onChange={setIsAgentTrailEnabled}
                    />
                </div>
                 <p className="text-xs text-slate-500 dark:text-slate-400">
                    Allows the agent's core logic (e.g., PSAR, Supertrend) to actively trail the stop loss.
                </p>
            </div>
            <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                    <label htmlFor="breakeven-trail-toggle" className={formLabelClass}>
                        Mandatory Breakeven Trail
                    </label>
                    <ToggleSwitch
                        checked={isBreakevenTrailEnabled}
                        onChange={setIsBreakevenTrailEnabled}
                    />
                </div>
                 <p className="text-xs text-slate-500 dark:text-slate-400">
                    Once profitable by 3x fees, the stop loss is moved to a fee-adjusted breakeven point.
                </p>
            </div>
             <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                    <label htmlFor="profit-trail-toggle" className={formLabelClass}>
                        Universal Profit Trail
                    </label>
                    <ToggleSwitch
                        checked={isUniversalProfitTrailEnabled}
                        onChange={setIsUniversalProfitTrailEnabled}
                    />
                </div>
                 <p className="text-xs text-slate-500 dark:text-slate-400">
                    A fee-based profit-locking system. Disabling allows agent-specific exit logic.
                </p>
            </div>
            <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <label htmlFor="adaptive-tp-toggle" className={formLabelClass}>
                            Adaptive Take Profit
                        </label>
                        <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                Automatically tightens the Take Profit target if momentum fades near the objective, securing profits earlier.
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isAdaptiveTpEnabled}
                        onChange={setIsAdaptiveTpEnabled}
                    />
                </div>
            </div>
            <div className={formGroupClass}>
                <label htmlFor="aggressive-trail-mode" className={formLabelClass}>Aggressive Trail Mode</label>
                <select
                    id="aggressive-trail-mode"
                    value={aggressiveTrailMode}
                    onChange={e => setAggressiveTrailMode(e.target.value as 'distance' | 'pnl')}
                    className={formInputClass}
                >
                    <option value="distance">Distance to TP</option>
                    <option value="pnl">PNL %</option>
                </select>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Controls the logic for the hyper-reactive profit-locking trail.
                </p>
            </div>
             <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                    <label htmlFor="rr-veto-toggle" className={formLabelClass}>
                        Minimum R:R Veto
                    </label>
                    <ToggleSwitch
                        checked={isMinRrEnabled}
                        onChange={setIsMinRrEnabled}
                    />
                </div>
                 <p className="text-xs text-slate-500 dark:text-slate-400">
                    Enforces a minimum risk-to-reward ratio of {constants.MIN_RISK_REWARD_RATIO}:1 on all new trades.
                </p>
            </div>
             <div className={formGroupClass}>
                <label htmlFor="invalidation-sensitivity" className={formLabelClass}>Invalidation Sensitivity</label>
                <select 
                    id="invalidation-sensitivity" 
                    value={invalidationSensitivity} 
                    onChange={e => setInvalidationSensitivity(e.target.value as 'low' | 'medium' | 'high')}
                    className={formInputClass}
                >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                </select>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Controls how aggressively the bot exits trades when the original thesis weakens. High sensitivity exits faster.
                </p>
            </div>
             <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                    <label htmlFor="entry-timing-toggle" className={formLabelClass}>
                        Immediate Entry
                    </label>
                    <ToggleSwitch
                        checked={entryTiming === 'immediate'}
                        onChange={(checked) => setEntryTiming(checked ? 'immediate' : 'onNextCandle')}
                    />
                </div>
                 <p className="text-xs text-slate-500 dark:text-slate-400">
                    Enter on signal tick. If disabled, the bot will wait for the next candle to open.
                </p>
            </div>
             <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                     <div className="flex items-center gap-1.5">
                        <label htmlFor="confirmation-candle-toggle" className={formLabelClass}>
                            Confirmation Candle Veto
                        </label>
                         <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-52 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                Immediately closes a trade if the first candle after entry is a strong reversal, preventing small losses from growing.
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isConfirmationCandleEnabled}
                        onChange={setIsConfirmationCandleEnabled}
                    />
                </div>
            </div>

            <button onClick={onStartBot} disabled={botsToCreateCount === 0 || isInvestmentInvalid} className={primaryButtonClass}>
                <PlayIcon className="w-5 h-5"/>
                {getButtonText()}
            </button>
        </div>
    );
};