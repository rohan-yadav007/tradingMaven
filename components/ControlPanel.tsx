
// components/ControlPanel.tsx


import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { TradingMode, Kline, TradeSignal, AgentParams, BotConfig, Agent, LiveTicker } from '../types';
import * as constants from '../constants';
import { PlayIcon, CpuIcon, ChevronDown, ChevronUp, InfoIcon, ZapIcon } from './icons';
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
    const [isAstraX_SweepsOpen, setIsAstraX_SweepsOpen] = useState(false);
    const [isAstraX_BreakoutsOpen, setIsAstraX_BreakoutsOpen] = useState(false);
    const [isAstraX_PullbacksOpen, setIsAstraX_PullbacksOpen] = useState(true);

    const allParams = useMemo(() => {
        const timeframeDefaults = constants.getAgentTimeframeSettings(agent.id, timeFrame);
        return { ...constants.DEFAULT_AGENT_PARAMS, ...timeframeDefaults, ...params };
    }, [agent.id, timeFrame, params]);

    const updateParam = (key: keyof AgentParams, value: number | boolean | string) => { onParamsChange({ ...params, [key]: value }); };
    
    switch (agent.id) {
        case 25: // Omega Predator V3
            return (
                <div className="space-y-4">
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800 text-xs">
                         <p className="font-bold text-indigo-700 dark:text-indigo-300 mb-1 uppercase tracking-wider">Omega V3: Sovereign Architect</p>
                         <p className="text-slate-600 dark:text-slate-400">Autonomous Multi-Timeframe Matrix (1m-4H). No manual config required.</p>
                    </div>
                    
                    <div className="flex flex-col gap-1.5">
                        <label className={formLabelClass}>Predator Aggressiveness</label>
                        <div className="flex items-center gap-1 p-1 bg-slate-200 dark:bg-slate-900/70 rounded-md mt-1">
                            <button onClick={() => updateParam('omega_aggressiveness', 'Conservative')} className={`flex-1 text-center text-xs font-semibold p-1.5 rounded-md transition-colors ${allParams.omega_aggressiveness === 'Conservative' ? 'bg-white dark:bg-slate-700 shadow text-emerald-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}>Conservative</button>
                            <button onClick={() => updateParam('omega_aggressiveness', 'Standard')} className={`flex-1 text-center text-xs font-semibold p-1.5 rounded-md transition-colors ${allParams.omega_aggressiveness === 'Standard' || !allParams.omega_aggressiveness ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}>Standard</button>
                            <button onClick={() => updateParam('omega_aggressiveness', 'Sniper')} className={`flex-1 text-center text-xs font-semibold p-1.5 rounded-md transition-colors ${allParams.omega_aggressiveness === 'Sniper' ? 'bg-white dark:bg-slate-700 shadow text-rose-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}>Sniper</button>
                        </div>
                    </div>

                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                        <div className="p-2 bg-slate-100 dark:bg-slate-900 rounded text-[10px] text-slate-500 space-y-1">
                            <p className="flex items-center gap-2"><ZapIcon className="w-3 h-3 text-sky-500"/><strong>5x Fee Law:</strong> Active</p>
                            <p className="flex items-center gap-2"><ZapIcon className="w-3 h-3 text-purple-500"/><strong>Volatility Sizing:</strong> Active</p>
                            <p className="flex items-center gap-2"><ZapIcon className="w-3 h-3 text-amber-500"/><strong>Sovereign Management:</strong> Active</p>
                        </div>
                    </div>
                </div>
            );
        case 22: // Matrix Strategist
            return (
                <div className="space-y-4">
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800 text-xs">
                         <p className="font-bold text-indigo-700 dark:text-indigo-300 mb-1">Timeframe Context: {timeFrame}</p>
                         <p className="text-slate-500 dark:text-slate-400">Parameters below are specifically for {timeFrame} market dynamics.</p>
                    </div>

                    {timeFrame === '1m' && (
                        <>
                            <ParamSlider label="EMA Fast" value={allParams.ms_1m_emaFast!} onChange={v => updateParam('ms_1m_emaFast', v)} min={5} max={20} step={1} />
                            <ParamSlider label="EMA Slow" value={allParams.ms_1m_emaSlow!} onChange={v => updateParam('ms_1m_emaSlow', v)} min={15} max={50} step={1} />
                            <ParamSlider label="Volume Spike Mult" value={allParams.ms_1m_volSpike!} onChange={v => updateParam('ms_1m_volSpike', v)} min={1.5} max={5.0} step={0.1} valueDisplay={v => `${v}x Avg`} />
                        </>
                    )}
                    
                    {timeFrame === '3m' && (
                        <>
                            <ParamSlider label="EMA Long-Term" value={allParams.ms_3m_ema3!} onChange={v => updateParam('ms_3m_ema3', v)} min={30} max={100} step={5} />
                            <ParamSlider label="MACD Lookback (RSI)" value={allParams.ms_3m_rsiPeriod!} onChange={v => updateParam('ms_3m_rsiPeriod', v)} min={7} max={21} step={1} />
                        </>
                    )}

                    {timeFrame === '5m' && (
                        <>
                            <ParamSlider label="Slow EMA" value={allParams.ms_5m_ema3!} onChange={v => updateParam('ms_5m_ema3', v)} min={100} max={300} step={10} />
                            <ParamSlider label="Stoch Period" value={allParams.ms_5m_stochK!} onChange={v => updateParam('ms_5m_stochK', v)} min={7} max={28} step={1} />
                        </>
                    )}

                    {timeFrame === '15m' && (
                        <>
                            <ParamSlider label="ADX Sensitivity" value={allParams.ms_15m_adxThreshold!} onChange={v => updateParam('ms_15m_adxThreshold', v)} min={15} max={35} step={1} />
                        </>
                    )}

                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                         <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Strategy Recommendations</p>
                         <div className="grid grid-cols-2 gap-2 mt-2">
                             <div className="p-2 bg-slate-100 dark:bg-slate-900 rounded">
                                 <p className="text-[10px] text-slate-400">Rec. Leverage</p>
                                 <p className="text-xs font-bold">{['1m','3m'].includes(timeFrame) ? '8-10x' : ['5m','15m'].includes(timeFrame) ? '3-5x' : '1-2x'}</p>
                             </div>
                             <div className="p-2 bg-slate-100 dark:bg-slate-900 rounded">
                                 <p className="text-[10px] text-slate-400">Risk Profile</p>
                                 <p className="text-xs font-bold">{['1m','3m'].includes(timeFrame) ? 'High Freq' : 'Structural'}</p>
                             </div>
                         </div>
                    </div>
                </div>
            );

        case 19: return (<div className="space-y-4">
            <div className="flex flex-col gap-1.5">
                <label className={formLabelClass}>Execution Mode</label>
                <div className="flex items-center gap-1 p-1 bg-slate-200 dark:bg-slate-900/70 rounded-md mt-1">
                    <button onClick={() => updateParam('astraX_executionMode', 'conviction')} className={`flex-1 text-center text-xs font-semibold p-1.5 rounded-md transition-colors ${(allParams.astraX_executionMode === 'conviction') ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}>Conviction</button>
                    <button onClick={() => updateParam('astraX_executionMode', 'scalp')} className={`flex-1 text-center text-xs font-semibold p-1.5 rounded-md transition-colors ${(allParams.astraX_executionMode === 'scalp') ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}>Scalp</button>
                    <button onClick={() => updateParam('astraX_executionMode', 'hybrid')} className={`flex-1 text-center text-xs font-semibold p-1.5 rounded-md transition-colors ${(allParams.astraX_executionMode === 'hybrid') ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}>Hybrid</button>
                </div>
            </div>
            
            <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                <ParamSlider label="Trend Definition (ADX)" value={allParams.astraX_adxThreshold!} onChange={v => updateParam('astraX_adxThreshold', v)} min={15} max={40} step={1} />
            </div>
            
            {/* --- STRATEGY: LIQUIDITY SWEEPS --- */}
            <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                <button onClick={() => setIsAstraX_SweepsOpen(!isAstraX_SweepsOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                    <span>Setup: Liquidity Sweeps</span>
                    {isAstraX_SweepsOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {isAstraX_SweepsOpen && (
                    <div className="p-3 border-t border-slate-200 dark:border-slate-600 space-y-4">
                        <p className="text-xs text-slate-500 dark:text-slate-400">Catches "Stop Hunts" where price takes out a low/high and reverses.</p>
                        <ParamSlider label="Sweep Lookback" value={allParams.astraX_sweepLookback!} onChange={v => updateParam('astraX_sweepLookback', v)} min={5} max={100} step={1} valueDisplay={v => `${v} candles`} />
                    </div>
                )}
            </div>

            {/* --- STRATEGY: BREAKOUTS --- */}
             <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                <button onClick={() => setIsAstraX_BreakoutsOpen(!isAstraX_BreakoutsOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                    <span>Setup: Momentum Breakouts</span>
                    {isAstraX_BreakoutsOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {isAstraX_BreakoutsOpen && (
                    <div className="p-3 border-t border-slate-200 dark:border-slate-600 space-y-4">
                        <p className="text-xs text-slate-500 dark:text-slate-400">Enters on strong expansion moves confirmed by volume.</p>
                        <ParamSlider label="Volume Multiplier" value={allParams.astraX_breakoutVolMultiplier!} onChange={v => updateParam('astraX_breakoutVolMultiplier', v)} min={1.2} max={3.0} step={0.1} valueDisplay={v => `${v.toFixed(1)}x Avg`} />
                    </div>
                )}
            </div>

            {/* --- STRATEGY: PULLBACKS --- */}
             <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                <button onClick={() => setIsAstraX_PullbacksOpen(!isAstraX_PullbacksOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                    <span>Setup: Dynamic Pullbacks</span>
                    {isAstraX_PullbacksOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {isAstraX_PullbacksOpen && (
                    <div className="p-3 border-t border-slate-200 dark:border-slate-600 space-y-4">
                        <p className="text-xs text-slate-500 dark:text-slate-400">Enters when price retraces to the EMA during a trend.</p>
                        <ParamSlider label="Pullback EMA Period" value={allParams.astraX_pullbackEmaPeriod!} onChange={v => updateParam('astraX_pullbackEmaPeriod', v)} min={9} max={50} step={1} />
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

export const ControlPanel: React.FC<ControlPanelProps> = (props) => {
    // ... (rest of the ControlPanel code remains unchanged, it just calls AgentParameterEditor)
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
        if (htfTimeFrame !== 'auto' && !higherTimeFrames.includes(htfTimeFrame)) {
            setHtfTimeFrame('auto');
        }
        
        if (selectedAgent.id === 22) {
            const tfLeverage: Record<string, number> = { '1m': 10, '3m': 8, '5m': 5, '15m': 3, '30m': 2, '1h': 2, '4h': 1, '1d': 1 };
            setLeverage(tfLeverage[timeFrame] || 1);
            
            const tfMaxLoss: Record<string, number> = { '1m': 3, '3m': 4, '5m': 5, '15m': 6, '30m': 8, '1h': 10, '4h': 12, '1d': 15 };
            setMaxMarginLossPercent(tfMaxLoss[timeFrame] || 6);
        }
    }, [timeFrame, htfTimeFrame, higherTimeFrames, setHtfTimeFrame, selectedAgent.id]);

    const fetchAnalysis = useCallback(async () => {
        if (analysisInProgress.current) return;

        const now = Date.now();
        // V8.7 Rate Limit Protection: Wait 10s after errors
        if (now - lastAnalysisErrorTime.current < 10000) {
            return;
        }
        
        // V8.7 Rate Limit Protection: Increased frequency check to 5s (from 2s) to reduce load
        if (now - lastAnalysisRequestTime.current < 5000) { 
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
                
                // For Omega V3 Analysis, we need the matrix map in the preview
                let omegaMap: Map<string, Kline[]> | undefined;
                if (selectedAgent.id === 25) {
                    omegaMap = new Map();
                    // Basic preview support: Fetch recent data for a few timeframes
                    // V8.7: Staggered fetching to avoid rate limit bursts
                    try {
                        const tfs = ['1m', '5m', '15m', '1h', '4h'];
                        
                        // Sequential fetch instead of Promise.all to respect rate limits
                        for (const tf of tfs) {
                            if (tf !== timeFrame) {
                                const data = await sharedKlineService.getData(analysisPair, tf, tradingMode);
                                omegaMap?.set(tf, data);
                                // Small delay between fetches to let the rate limiter breathe
                                await new Promise(r => setTimeout(r, 100)); 
                            }
                        }
                        
                        omegaMap.set(timeFrame, previewKlines);
                    } catch (e) { 
                        console.warn("Omega Preview: Failed to sync matrix (Rate Limit Protection Active)", e); 
                        // Don't crash analysis if auxiliary TFs fail, just proceed with what we have
                    }
                }

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
                    isHeikinAshiEnabled: isHeikinAshiEnabled, isDynamicSizingEnabled: isDynamicSizingEnabled,
                };

                const signal = await getTradingSignal(
                    selectedAgent, 
                    previewKlines, 
                    previewConfig, 
                    htfKlines, 
                    undefined, // immediateKlines
                    undefined, // ltfKlines
                    undefined, // ethBtc
                    currentLivePrice,
                    omegaMap // Pass the matrix map
                );
                
                setAnalysisSignal(signal);
                lastAnalysisErrorTime.current = 0; 
            } else {
                setAnalysisSignal(null);
            }
        } catch (e) {
            console.error("Error fetching analysis signal:", e);
            setAnalysisSignal({ signal: 'HOLD', reasons: ['Error fetching analysis. Check console.'] });
            lastAnalysisErrorTime.current = now; 
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
        isConfirmationCandleEnabled, isMomentumConcordanceEnabled, isTradeGuardianEnabled, isHeikinAshiEnabled, isDynamicSizingEnabled
    ]);

    useEffect(() => {
        if (klines.length > 0) {
            fetchAnalysis(); 
        }

        const analysisInterval = setInterval(() => {
             if (klines.length > 0 && isAnalysisOpen) { // Only fetch if the panel is open
                fetchAnalysis();
            }
        }, 10000); // V8.7: Increased to 10s interval to prevent rate limit issues

        return () => clearInterval(analysisInterval);
    }, [fetchAnalysis, klines.length, isAnalysisOpen]);
    
    const getButtonText = () => {
        if (selectedPairsCount === 0) return 'Select One or More Markets';
        if (botsToCreateCount === 0 && selectedPairsCount > 0) return 'Bot(s) Already Running';
        const plural = botsToCreateCount > 1 ? 's' : '';
        return `Start ${botsToCreateCount} Trading Bot${plural}`;
    };

    const isHighFreq = ['1m', '3m'].includes(timeFrame);

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
            
            <div className={`${formGroupClass} mt-2`}>
                <div className="flex items-center justify-between">
                     <div className="flex items-center gap-1.5">
                        <label htmlFor="dynamic-sizing-toggle" className={formLabelClass}>
                            Dynamic Conviction Sizing
                        </label>
                         <div className="relative group">
                            <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="absolute bottom-full mb-2 w-56 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                If enabled, the AI will reduce position size for lower conviction setups (e.g., 50% size for low conviction). If disabled, it always uses the full Investment Amount.
                            </div>
                        </div>
                    </div>
                    <ToggleSwitch
                        checked={isDynamicSizingEnabled}
                        onChange={setIsDynamicSizingEnabled}
                    />
                </div>
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
                 <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <AgentParameterEditor agent={selectedAgent} params={agentParams} onParamsChange={setAgentParams} isAdxFilterEnabled={isAdxFilterEnabled} timeFrame={timeFrame} />
                 </div>
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

             {/* Standard Filters - Hidden for Omega V3 to reduce noise */}
             {selectedAgent.id !== 25 && (
                 <>
                    <div className={formGroupClass}>
                        <div className="flex items-center justify-between">
                             <div className="flex items-center gap-1.5">
                                <label htmlFor="momentum-concordance-toggle" className={formLabelClass}>
                                    Momentum Concordance
                                </label>
                                 <div className="relative group">
                                    <InfoIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                                    <div className="absolute bottom-full mb-2 w-52 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                        Performs a 'just-in-time' analysis before entry. Vetoes trades if immediate 1-min momentum is fading or if the entry point is poor within the current candle's structure (e.g., buying the top of a weapon).
                                    </div>
                                </div>
                            </div>
                            <ToggleSwitch
                                checked={isMomentumConcordanceEnabled}
                                onChange={setIsMomentumConcordanceEnabled}
                            />
                        </div>
                    </div>
                    {/* ... other filters ... */}
                 </>
             )}
             
             {/* Simplified Common Filters for All Agents including Omega */}
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

            <button onClick={onStartBot} disabled={botsToCreateCount === 0 || isInvestmentInvalid} className={primaryButtonClass}>
                <PlayIcon className="w-5 h-5"/>
                {getButtonText()}
            </button>
        </div>
    );
};
