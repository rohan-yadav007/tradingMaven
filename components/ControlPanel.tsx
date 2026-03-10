
// components/ControlPanel.tsx

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TradingMode, Kline, TradeSignal, AgentParams, BotConfig, Agent } from '../types';
import * as constants from '../constants';
import { PlayIcon, CpuIcon, ChevronDown, ChevronUp, ZapIcon, SparklesIcon } from './icons';
import { AnalysisPreview } from './AnalysisPreview';
import { getTradingSignal } from '../services/localAgentService';
import { SearchableDropdown } from './SearchableDropdown';
import { useTradingConfigState, useTradingConfigActions } from '../contexts/TradingConfigContext';
import * as binanceService from '../services/binanceService';
import { TrainingModal } from './TrainingModal';

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


const ToggleSwitch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void }> = ({ checked, onChange }) => (
    <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${checked ? 'bg-sky-500' : 'bg-slate-600'}`}
    >
        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
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

const AgentParameterEditor: React.FC<{agent: Agent, params: AgentParams, onParamsChange: (p: AgentParams) => void, theme: 'light' | 'dark', timeFrame: string}> = ({ agent, params, onParamsChange }) => {
    const updateParam = (key: keyof AgentParams, value: any) => { onParamsChange({ ...params, [key]: value }); };
    void updateParam; // used by non-Omega agents below

    switch (agent.id) {
        case 25: // Omega Prime
            return (
                <div className="space-y-3">
                    {/* Identity */}
                    <div className="flex items-center gap-2 p-2.5 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
                        <SparklesIcon className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                        <div>
                            <p className="font-bold text-indigo-700 dark:text-indigo-300 text-xs uppercase tracking-widest">Omega Prime</p>
                            <p className="text-[10px] text-indigo-600/80 dark:text-indigo-400/80 leading-tight">Fully autonomous — no manual overrides.</p>
                        </div>
                        <ZapIcon className="w-3.5 h-3.5 text-sky-400 animate-pulse ml-auto" />
                    </div>

                    {/* Intelligence pillars */}
                    <div className="grid grid-cols-1 gap-1.5 text-[10px]">
                        <div className="flex items-start gap-2 p-2 bg-slate-100 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                            <span className="text-emerald-500 mt-0.5">▸</span>
                            <span className="text-slate-600 dark:text-slate-300"><span className="font-semibold text-slate-800 dark:text-slate-100">Intent</span> auto-selected: Preserve (high vol), Growth (trending), Alpha (ranging)</span>
                        </div>
                        <div className="flex items-start gap-2 p-2 bg-slate-100 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                            <span className="text-sky-500 mt-0.5">▸</span>
                            <span className="text-slate-600 dark:text-slate-300"><span className="font-semibold text-slate-800 dark:text-slate-100">Entry triggers</span>: Liquidity Sweep, Order Block Reclaim, Structure BOS</span>
                        </div>
                        <div className="flex items-start gap-2 p-2 bg-slate-100 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                            <span className="text-violet-500 mt-0.5">▸</span>
                            <span className="text-slate-600 dark:text-slate-300"><span className="font-semibold text-slate-800 dark:text-slate-100">Filters</span>: 1H + 4H structure, BTC regime, OI dynamics, session window</span>
                        </div>
                        <div className="flex items-start gap-2 p-2 bg-slate-100 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                            <span className="text-amber-500 mt-0.5">▸</span>
                            <span className="text-slate-600 dark:text-slate-300"><span className="font-semibold text-slate-800 dark:text-slate-100">AI Model</span>: trained conditions adjust confidence ±20pt + hourly win-rate gate</span>
                        </div>
                    </div>

                    {/* Session reference */}
                    <div className="grid grid-cols-2 gap-1 text-[9px] font-semibold">
                        <span className="px-1.5 py-0.5 rounded bg-rose-900/40 text-rose-300">🌙 Dead Zone 02–06 UTC</span>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300">🇺🇸 US Core 13:30–21 UTC</span>
                        <span className="px-1.5 py-0.5 rounded bg-sky-900/40 text-sky-300">🇬🇧 London 08–13 UTC</span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-700/40 text-slate-400">🌏 Asia / Late US</span>
                    </div>
                </div>
            );
        case 9: return (<div className="space-y-4">
                <ParamSlider label="Entry Score Threshold" value={params.qsc_trendScoreThreshold || 75} onChange={v => updateParam('qsc_trendScoreThreshold', v)} min={50} max={95} step={1} valueDisplay={v => `${v}%`} />
            </div>);
        default: return <p className="text-sm text-slate-500">Standard parameters active.</p>;
    }
};

export const ControlPanel: React.FC<ControlPanelProps> = (props) => {
    const { onStartBot, botsToCreateCount, theme } = props;
    const config = useTradingConfigState();
    const actions = useTradingConfigActions();
    const { executionMode, availableBalance, tradingMode, allPairs, selectedPairs, isPairsLoading, leverage, chartTimeFrame: timeFrame, selectedAgent, investmentAmount, agentParams, tradingPairLists, isModelFilterEnabled } = config;

    const [analysisSignal, setAnalysisSignal] = useState<TradeSignal | null>(null);
    const [isAnalysisLoading, setIsAnalysisLoading] = useState(false);
    const [isAnalysisOpen, setIsAnalysisOpen] = useState(true);
    const [isTrainingOpen, setIsTrainingOpen] = useState(false);

    const pairListOptions = useMemo(() => {
        return tradingPairLists.map(list => ({
            value: list.id,
            label: `📦 ${list.name} (${list.pairs.length} markets)`
        }));
    }, [tradingPairLists]);

    const handleLoadList = (listId: string | string[]) => {
        if (typeof listId !== 'string') return;
        const list = tradingPairLists.find(l => l.id === listId);
        if (list) {
            actions.setTradingMode(list.tradingMode);
            actions.setSelectedPairs(list.pairs);
        }
    };

    const fetchAnalysis = useCallback(async () => {
        if (!selectedPairs[0] || !selectedAgent) return;
        setIsAnalysisLoading(true);
        try {
            const formattedPair = selectedPairs[0].replace('/', '');
            const klinesData = await binanceService.fetchKlines(formattedPair, timeFrame, { limit: 500, mode: tradingMode });
            
            const astraXKlinesMap = new Map<string, Kline[]>();
            astraXKlinesMap.set(timeFrame, klinesData);
            const tfs = ['1m', '5m', '15m', '1h', '4h', '1d'];
            await Promise.all(tfs.filter(tf => tf !== timeFrame).map(async (tf) => {
                const data = await binanceService.fetchKlines(formattedPair, tf, { limit: 200, mode: tradingMode });
                astraXKlinesMap.set(tf, data);
            }));

            const btcKlines = await binanceService.fetchKlines('BTCUSDT', timeFrame, { limit: 200, mode: tradingMode });
            
            // Fetch OI and L/S for Omega
            let openInterestHistory, lsRatioHistory;
            if (selectedAgent.id === 25 && tradingMode === TradingMode.USDSM_Futures) {
                const oiPeriod = ['1m', '3m', '5m'].includes(timeFrame) ? '5m' : timeFrame;
                [openInterestHistory, lsRatioHistory] = await Promise.all([
                    binanceService.fetchOpenInterestHistory(formattedPair, oiPeriod),
                    binanceService.fetchTopLongShortRatio(formattedPair, oiPeriod)
                ]);
            }

            const botConfigForAnalysis = {
                ...config,
                agent: selectedAgent,
                pair: selectedPairs[0],
                timeFrame: timeFrame,
                mode: tradingMode,
                isModelFilterEnabled,
            } as unknown as BotConfig;

            // Updated getTradingSignal call handled via the updated localAgentService which now handles fetching internally or we pass it if we have it.
            // Since we fetched it here for the preview, we should pass it or update getTradingSignal to accept it optionally.
            // However, localAgentService.ts updates in previous turn made it handle fetching. 
            // For the PREVIEW, we might need to manually pass it if the service logic requires it to be fetched inside.
            // Actually, the new getTradingSignal logic fetches it internally if needed.
            
            const signal = await getTradingSignal(selectedAgent, klinesData, botConfigForAnalysis, undefined, undefined, undefined, undefined, klinesData[klinesData.length-1].close, astraXKlinesMap, btcKlines);
            setAnalysisSignal(signal);
        } catch (e) {
            console.error(e);
        } finally {
            setIsAnalysisLoading(false);
        }
    }, [selectedPairs, selectedAgent, timeFrame, tradingMode, agentParams, config]);

    useEffect(() => {
        if (isAnalysisOpen) {
            fetchAnalysis();
            const interval = setInterval(fetchAnalysis, 30000);
            return () => clearInterval(interval);
        }
    }, [isAnalysisOpen, fetchAnalysis]);

    const isInvestmentInvalid = executionMode === 'live' && investmentAmount > availableBalance;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 p-3 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm">
                <label className={formLabelClass}>Execution Mode</label>
                <div className="flex items-center gap-2 p-1 bg-slate-200 dark:bg-slate-900/70 rounded-md">
                    <button onClick={() => actions.setExecutionMode('paper')} className={`flex-1 text-center text-sm font-semibold p-1.5 rounded-md transition-colors ${executionMode === 'paper' ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}>Paper</button>
                    <button onClick={() => actions.setExecutionMode('live')} className={`flex-1 text-center text-sm font-semibold p-1.5 rounded-md transition-colors ${executionMode === 'live' ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}>Live</button>
                </div>
            </div>

            {/* QUICK LOAD LIST - Strictly Preserved and Promoted */}
            <div className={formGroupClass}>
                <label className={formLabelClass}>Quick Load Saved List</label>
                <SearchableDropdown 
                    options={pairListOptions} 
                    value="" 
                    onChange={handleLoadList} 
                    theme={theme} 
                    disabled={pairListOptions.length === 0} 
                />
                {pairListOptions.length === 0 && (
                    <p className="text-[10px] text-slate-500 mt-1 italic">Create lists in Preferences to bulk-load markets.</p>
                )}
            </div>

            <div className={formGroupClass}>
                <label className={formLabelClass}>Trading Platform</label>
                <select value={tradingMode} onChange={e => actions.setTradingMode(e.target.value as TradingMode)} className={formInputClass}>
                    {Object.values(TradingMode).map(mode => <option key={mode} value={mode}>{mode}</option>)}
                </select>
            </div>

            <div className={formGroupClass}>
                <label className={formLabelClass}>Market(s) <span className="text-[10px] text-slate-400">(Bulk enabled)</span></label>
                <SearchableDropdown isMulti options={allPairs} value={selectedPairs} onChange={(newPairs) => actions.setSelectedPairs(newPairs as string[])} theme={theme} disabled={isPairsLoading} />
            </div>

            <div className={formGroupClass}>
                <label className={formLabelClass}>Time Frame</label>
                <select value={timeFrame} onChange={e => actions.setTimeFrame(e.target.value)} className={formInputClass}>
                    {constants.TIME_FRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                </select>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>

            <div className={formGroupClass}>
                <label className={formLabelClass}>Investment Amount ($)</label>
                <input type="number" value={investmentAmount} onChange={e => actions.setInvestmentAmount(Number(e.target.value))} className={`${formInputClass} ${isInvestmentInvalid ? 'border-rose-500' : ''}`} min="1" />
            </div>

            <div className={formGroupClass}>
                <label className={formLabelClass}>Leverage</label>
                <input type="range" min="1" max="125" value={leverage} onChange={e => actions.setLeverage(Number(e.target.value))} className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer" />
                <div className="text-right text-xs font-bold text-sky-500">{leverage}x</div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>

            <div className={formGroupClass}>
                <label className={formLabelClass}>Trading Agent</label>
                <select value={selectedAgent.id} onChange={e => { const agent = constants.AGENTS.find(a => a.id === Number(e.target.value)); if (agent) { actions.setSelectedAgent(agent); actions.setAgentParams({}); } }} className={formInputClass}>
                    {constants.AGENTS.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
                <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <AgentParameterEditor agent={selectedAgent} params={agentParams} onParamsChange={actions.setAgentParams} theme={theme} timeFrame={timeFrame} />
                </div>
                {(selectedAgent.id === 25 || selectedAgent.id === 26) && (
                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                        <div>
                            <p className={formLabelClass}>Model Filter</p>
                            <p className="text-xs text-slate-400">Apply trained pattern model to entries</p>
                        </div>
                        <ToggleSwitch checked={isModelFilterEnabled} onChange={actions.setIsModelFilterEnabled} />
                    </div>
                )}
            </div>

            <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                <button onClick={() => setIsAnalysisOpen(!isAnalysisOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                    <div className="flex items-center gap-2"><CpuIcon className="w-5 h-5 text-sky-500" /><span>Analysis Matrix</span></div>
                    {isAnalysisOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {isAnalysisOpen && (
                    <div className="p-3 border-t border-slate-200 dark:border-slate-600">
                        <AnalysisPreview agent={selectedAgent} agentParams={agentParams} analysis={analysisSignal} isLoading={isAnalysisLoading} />
                    </div>
                )}
            </div>

            <button onClick={onStartBot} disabled={botsToCreateCount === 0 || isInvestmentInvalid} className={primaryButtonClass}>
                <PlayIcon className="w-5 h-5"/>
                {botsToCreateCount > 0 ? `Start ${botsToCreateCount} Bot(s)` : 'Select Markets'}
            </button>

            <button
                onClick={() => setIsTrainingOpen(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-md border border-violet-600 text-violet-400 hover:bg-violet-900/30 transition-colors"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Pattern Training Lab
            </button>

            {isTrainingOpen && (
                <TrainingModal
                    onClose={() => setIsTrainingOpen(false)}
                    availablePairs={allPairs}
                />
            )}
        </div>
    );
};
