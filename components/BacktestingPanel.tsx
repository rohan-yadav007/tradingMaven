
// components/BacktestingPanel.tsx

import React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { Agent, BotConfig, BacktestResult, TradingMode, AgentParams, Kline } from '../types';
import * as constants from '../constants';
import * as binanceService from './../services/binanceService';
import { runBacktest } from '../services/workerService';
import { FlaskIcon, ChevronUp, ChevronDown, SparklesIcon } from './icons';
import { useTradingConfigState, useTradingConfigActions } from '../contexts/TradingConfigContext';
import { SearchableDropdown } from './SearchableDropdown';
import { BacktestResultDisplay } from './BacktestResultDisplay';
import { pairProfileService } from '../services/pairProfileService';


// --- Shared UI helpers ---

const formGroupClass = "flex flex-col gap-1.5";
const formLabelClass = "text-sm font-medium text-slate-700 dark:text-slate-300";
const formInputClass = "w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500";
const buttonClass = "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-white font-semibold rounded-md shadow-sm transition-colors";
const primaryButtonClass = `${buttonClass} bg-sky-600 hover:bg-sky-700 disabled:bg-slate-400 dark:disabled:bg-slate-600`;

const ParamSlider: React.FC<{
    label: string;
    value: number;
    onChange: (val: number) => void;
    min: number;
    max: number;
    step: number;
    valueDisplay?: (v: number) => string;
}> = ({ label, value, onChange, min, max, step, valueDisplay }) => (
    <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-baseline">
            <label className={formLabelClass}>{label}</label>
            <span className="text-sm font-semibold text-sky-500">{valueDisplay ? valueDisplay(value) : value}</span>
        </div>
        <input
            type="range" min={min} max={max} step={step} value={value}
            onChange={e => onChange(Number(e.target.value))}
            className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer"
        />
    </div>
);

const ToggleSwitch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void }> = ({ checked, onChange }) => (
    <button
        type="button" role="switch" aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`${checked ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none`}
    >
        <span aria-hidden="true" className={`${checked ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`} />
    </button>
);

// --- Agent Parameter Editor ---

const AgentParameterEditor: React.FC<{
    agent: Agent;
    params: AgentParams;
    onParamsChange: (p: AgentParams) => void;
    theme: 'light' | 'dark';
    timeFrame: string;
}> = ({ agent, params, onParamsChange, theme, timeFrame }) => {
    const allParams = useMemo(() => {
        const timeframeDefaults = constants.getAgentTimeframeSettings(agent.id, timeFrame);
        return { ...constants.DEFAULT_AGENT_PARAMS, ...timeframeDefaults, ...params };
    }, [agent.id, timeFrame, params]);

    const updateParam = (key: keyof AgentParams, value: number | boolean | string) => {
        onParamsChange({ ...params, [key]: value });
    };

    switch (agent.id) {
        case 26: // Apex: Sovereign Predator
            return (
                <div className="p-3 rounded-md bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800">
                    <p className="text-xs font-bold text-violet-700 dark:text-violet-300 uppercase tracking-widest mb-1">Apex: Sovereign Predator</p>
                    <p className="text-xs text-violet-600/80 dark:text-violet-400/80">All parameters are auto-managed. No manual configuration needed.</p>
                </div>
            );

        case 25: // Omega Prime
            const isAuto = allParams.omega_auto_mode ?? true;
            const intent = (allParams.omega_intent as 'Preserve' | 'Growth' | 'Alpha') || 'Growth';
            const patience = (allParams.omega_patience as 'Low' | 'Medium' | 'High') || 'Medium';
            const sessionFilter = allParams.omega_session_filter ?? true;
            return (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded border border-indigo-200 dark:border-indigo-800">
                        <SparklesIcon className="w-4 h-4 text-indigo-500" />
                        <div>
                            <p className="font-bold text-indigo-700 dark:text-indigo-300 text-xs uppercase tracking-widest">Omega Prime</p>
                            <p className="text-[10px] text-indigo-600/80 dark:text-indigo-400/80">Autonomous Intelligent Agent</p>
                        </div>
                    </div>
                    <div className="flex items-center justify-between">
                        <label className={formLabelClass}>Auto-Pilot Mode</label>
                        <ToggleSwitch checked={isAuto} onChange={v => updateParam('omega_auto_mode', v)} />
                    </div>
                    {!isAuto && (<>
                        <div className={formGroupClass}>
                            <label className={formLabelClass}>Intent</label>
                            <select value={intent} onChange={e => updateParam('omega_intent', e.target.value)} className={formInputClass}>
                                <option value="Preserve">Preserve – High bar, strong setups only</option>
                                <option value="Growth">Growth – Balanced, standard mode</option>
                                <option value="Alpha">Alpha – Aggressive, range mode</option>
                            </select>
                        </div>
                        <div className={formGroupClass}>
                            <label className={formLabelClass}>Patience</label>
                            <select value={patience} onChange={e => updateParam('omega_patience', e.target.value)} className={formInputClass}>
                                <option value="Low">Low – Faster entries</option>
                                <option value="Medium">Medium – Balanced</option>
                                <option value="High">High – Waits for best setup</option>
                            </select>
                        </div>
                    </>)}
                    <div className="flex items-center justify-between">
                        <label className={formLabelClass}>Session Filter</label>
                        <ToggleSwitch checked={sessionFilter} onChange={v => updateParam('omega_session_filter', v)} />
                    </div>
                </div>
            );

        case 9: case 11: case 13: case 14: case 17: case 18:
            return (
                <div className="space-y-4">
                    <ParamSlider label="RSI Period" value={allParams.rsiPeriod!} onChange={v => updateParam('rsiPeriod', v)} min={5} max={30} step={1} />
                    <ParamSlider label="ATR Period" value={allParams.atrPeriod!} onChange={v => updateParam('atrPeriod', v)} min={5} max={30} step={1} />
                    <ParamSlider label="ADX Period" value={allParams.adxPeriod!} onChange={v => updateParam('adxPeriod', v)} min={5} max={30} step={1} />
                </div>
            );

        case 20:
            return (
                <div className="space-y-4">
                    <ParamSlider label="ATR Period" value={allParams.atrPeriod!} onChange={v => updateParam('atrPeriod', v)} min={5} max={30} step={1} />
                    <ParamSlider label="ATR Multiplier" value={allParams.atrMultiplier!} onChange={v => updateParam('atrMultiplier', v)} min={1.0} max={5.0} step={0.1} valueDisplay={v => v.toFixed(1)} />
                </div>
            );

        case 21:
            return (
                <div className="space-y-4">
                    <ParamSlider label="Pivot Period" value={allParams.pps_pivotPeriod!} onChange={v => updateParam('pps_pivotPeriod', v)} min={1} max={50} step={1} />
                    <ParamSlider label="ATR Period" value={allParams.pps_atrPeriod!} onChange={v => updateParam('pps_atrPeriod', v)} min={1} max={50} step={1} />
                    <ParamSlider label="ATR Factor" value={allParams.pps_atrFactor!} onChange={v => updateParam('pps_atrFactor', v)} min={1.0} max={10.0} step={0.1} valueDisplay={v => v.toFixed(1)} />
                </div>
            );

        default:
            return <p className="text-sm text-slate-500">This agent has no customizable parameters.</p>;
    }
};

// --- Config ---

export type BacktestConfig = {
    tradingMode: TradingMode;
    selectedPair: string;
    chartTimeFrame: string;
    selectedAgent: Agent;
    investmentAmount: number;
    leverage: number;
    marginType: 'ISOLATED' | 'CROSSED';
    agentParams: AgentParams;
};

// --- Main Panel ---

interface BacktestingPanelProps {
    backtestResult: BacktestResult | null;
    setBacktestResult: (result: BacktestResult | null) => void;
    setActiveView: (view: 'trading' | 'backtesting' | 'preferences') => void;
    theme: 'light' | 'dark';
}

// Matrix timeframes required by Apex (26) and Omega (25)
const MATRIX_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

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
        leverage: globalConfig.leverage,
        marginType: globalConfig.marginType,
        agentParams: globalConfig.agentParams,
    });

    const [backtestDays, setBacktestDays] = useState(7);
    const [useModelFilter, setUseModelFilter] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadingMessage, setLoadingMessage] = useState('Running Simulation...');
    const [backtestProgress, setBacktestProgress] = useState(0);
    const [isParamsOpen, setIsParamsOpen] = useState(false);

    const updateConfig = <K extends keyof BacktestConfig>(key: K, value: BacktestConfig[K]) => {
        setConfig(prev => ({ ...prev, [key]: value }));
    };

    useEffect(() => {
        updateConfig('agentParams', {});
    }, [config.selectedAgent.id]);

    const isMatrixAgent = config.selectedAgent.id === 25 || config.selectedAgent.id === 26;

    const handleRunBacktest = async () => {
        setIsLoading(true);
        setLoadingMessage('Fetching kline data...');
        setError(null);
        setBacktestResult(null);
        setBacktestProgress(0);

        try {
            const formattedPair = config.selectedPair.replace('/', '');
            const now = binanceService.getSyncedNow();
            const startTime = now - backtestDays * 24 * 60 * 60 * 1000;

            // --- Primary klines (1m for simulation tick resolution) ---
            const primaryKlines = await binanceService.fetchFullKlines(
                formattedPair, '1m', startTime, now, config.tradingMode
            );
            if (primaryKlines.length < 200) {
                throw new Error('Not enough historical data (need at least 200 candles).');
            }

            const startTs = primaryKlines[0].time;
            const endTs = primaryKlines[primaryKlines.length - 1].time;

            // --- Matrix timeframes for Apex / Omega ---
            let matrixMap: Map<string, Kline[]> | undefined;
            let openInterestHistory: any[] | undefined;
            let lsRatioHistory: any[] | undefined;

            if (isMatrixAgent) {
                setLoadingMessage('Syncing matrix (1m → 1D)...');
                matrixMap = new Map();

                // Apex/Omega require h1.length >= 200 and m5.length >= 100 before firing any signal.
                // With only the backtest window, h1 starts at 0 and grows slowly — causing zero trades.
                // Fix: pre-fetch 210 hours of history before the backtest start so the agent has
                // full context from the very first candle.
                const MATRIX_PREFETCH_MS = 210 * 60 * 60 * 1000; // 210h → 200h needed + margin
                const matrixFetchStart = startTs - MATRIX_PREFETCH_MS;

                await Promise.all(
                    MATRIX_TIMEFRAMES.map(async tf => {
                        const data = await binanceService.fetchFullKlines(
                            formattedPair, tf, matrixFetchStart, endTs, config.tradingMode
                        );
                        matrixMap!.set(tf, data);
                    })
                );

                if (config.tradingMode === TradingMode.USDSM_Futures) {
                    setLoadingMessage('Syncing OI & sentiment data...');
                    const oiPeriod = ['1m', '3m', '5m'].includes(config.chartTimeFrame) ? '5m' : config.chartTimeFrame;
                    [openInterestHistory, lsRatioHistory] = await Promise.all([
                        binanceService.fetchOpenInterestHistory(formattedPair, oiPeriod, {
                            limit: 500, startTime: startTs, endTime: endTs
                        }),
                        binanceService.fetchTopLongShortRatio(formattedPair, oiPeriod, {
                            limit: 500, startTime: startTs, endTime: endTs
                        }),
                    ]);
                }
            }

            // --- Universal model (from localStorage — same source as live trading) ---
            const universalModel = useModelFilter ? pairProfileService.load() : null;

            // --- Symbol info ---
            setLoadingMessage('Simulating trades...');
            setBacktestProgress(0);
            const symbolInfo = config.tradingMode === TradingMode.USDSM_Futures
                ? await binanceService.getFuturesSymbolInfo(formattedPair)
                : await binanceService.getSymbolInfo(formattedPair);
            if (!symbolInfo) throw new Error('Could not fetch symbol info.');

            const botConfig: BotConfig = {
                pair: config.selectedPair,
                mode: config.tradingMode,
                executionMode: 'paper',
                timeFrame: config.chartTimeFrame,
                agent: config.selectedAgent,
                investmentAmount: config.investmentAmount,
                leverage: config.leverage,
                marginType: config.marginType,
                agentParams: config.agentParams,
                maxMarginLossPercent: 100,
                pricePrecision: binanceService.getPricePrecision(symbolInfo),
                quantityPrecision: binanceService.getQuantityPrecision(symbolInfo),
                stepSize: binanceService.getStepSize(symbolInfo),
                takerFeeRate: constants.TAKER_FEE_RATE,
                finalEntryFailSafe: 'fail-open',
                // Flags used inside agents (not dead filters)
                isInitialRiskVetoEnabled: true,
                isMinRrEnabled: true,
                entryTiming: 'immediate',
            };

            const result = await runBacktest(
                primaryKlines,
                botConfig,
                undefined, // htfKlines — handled inside matrix
                matrixMap,
                openInterestHistory,
                lsRatioHistory,
                universalModel,
                (p) => setBacktestProgress(p.percent),
            );

            setBacktestResult(result);
        } catch (e) {
            console.error('Backtest failed:', e);
            setError(e instanceof Error ? e.message : 'An unknown error occurred.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleApplyAndSwitch = () => {
        globalActions.setTradingMode(config.tradingMode);
        globalActions.setSelectedPairs([config.selectedPair]);
        globalActions.setTimeFrame(config.chartTimeFrame);
        globalActions.setSelectedAgent(config.selectedAgent);
        globalActions.setInvestmentAmount(config.investmentAmount);
        globalActions.setLeverage(config.leverage);
        globalActions.setMarginType(config.marginType);
        globalActions.setAgentParams(config.agentParams);
        setActiveView('trading');
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* ── Control Panel ─────────────────────────────────────────────── */}
            <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-lg shadow-sm p-4 h-fit">
                <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
                    <FlaskIcon />
                    <span>Backtest Setup</span>
                </h2>

                <div className="space-y-4">

                    {/* Platform */}
                    <div className={formGroupClass}>
                        <label className={formLabelClass}>Platform</label>
                        <select
                            value={config.tradingMode}
                            onChange={e => updateConfig('tradingMode', e.target.value as TradingMode)}
                            className={formInputClass}
                        >
                            {Object.values(TradingMode).map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </div>

                    {/* Market */}
                    <div className={formGroupClass}>
                        <label className={formLabelClass}>Market</label>
                        <SearchableDropdown
                            options={globalConfig.allPairs}
                            value={config.selectedPair}
                            onChange={p => updateConfig('selectedPair', p as string)}
                            theme={theme}
                            disabled={globalConfig.isPairsLoading}
                        />
                    </div>

                    {/* Time Frame */}
                    <div className={formGroupClass}>
                        <label className={formLabelClass}>Chart Timeframe</label>
                        <select
                            value={config.chartTimeFrame}
                            onChange={e => updateConfig('chartTimeFrame', e.target.value)}
                            className={formInputClass}
                        >
                            {constants.TIME_FRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                        </select>
                        {isMatrixAgent && (
                            <p className="text-xs text-slate-400 mt-0.5">
                                Matrix timeframes (1m–1D) are fetched automatically.
                            </p>
                        )}
                    </div>

                    {/* Period */}
                    <div className={formGroupClass}>
                        <label className={formLabelClass}>Backtest Period</label>
                        <select
                            value={backtestDays}
                            onChange={e => setBacktestDays(Number(e.target.value))}
                            className={formInputClass}
                        >
                            <option value={1}>Last 24 Hours</option>
                            <option value={3}>Last 3 Days</option>
                            <option value={7}>Last 7 Days</option>
                            <option value={14}>Last 14 Days</option>
                            <option value={30}>Last 30 Days</option>
                        </select>
                    </div>

                    {/* Model Filter Toggle */}
                    {isMatrixAgent && (
                        <div className="flex items-center justify-between">
                            <div>
                                <label className={formLabelClass}>Model Filter</label>
                                <p className="text-xs text-slate-400">Apply trained pattern model to entries</p>
                            </div>
                            <ToggleSwitch checked={useModelFilter} onChange={setUseModelFilter} />
                        </div>
                    )}

                    <div className="border-t border-slate-200 dark:border-slate-700 -mx-4" />

                    {/* Investment */}
                    <div className={formGroupClass}>
                        <label className={formLabelClass}>Investment Amount ($)</label>
                        <input
                            type="number"
                            value={config.investmentAmount}
                            onChange={e => updateConfig('investmentAmount', Number(e.target.value))}
                            className={formInputClass}
                        />
                    </div>

                    {/* Leverage — futures only */}
                    {config.tradingMode === TradingMode.USDSM_Futures && (
                        <ParamSlider
                            label="Leverage"
                            value={config.leverage}
                            onChange={v => updateConfig('leverage', v)}
                            min={1} max={125} step={1}
                            valueDisplay={v => `${v}x`}
                        />
                    )}

                    <div className="border-t border-slate-200 dark:border-slate-700 -mx-4" />

                    {/* Agent selector */}
                    <div className={formGroupClass}>
                        <div className="flex justify-between items-center">
                            <label className={formLabelClass}>Agent</label>
                            <button
                                onClick={() => updateConfig('agentParams', {})}
                                className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline"
                            >
                                Reset Params
                            </button>
                        </div>
                        <select
                            value={config.selectedAgent.id}
                            onChange={e => updateConfig('selectedAgent', constants.AGENTS.find(a => a.id === Number(e.target.value))!)}
                            className={formInputClass}
                        >
                            {constants.AGENTS.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                    </div>

                    {/* Agent parameter editor */}
                    <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                        <button
                            onClick={() => setIsParamsOpen(!isParamsOpen)}
                            className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200"
                        >
                            <span>Agent Parameters</span>
                            {isParamsOpen
                                ? <ChevronUp className="w-5 h-5" />
                                : <ChevronDown className="w-5 h-5" />}
                        </button>
                        {isParamsOpen && (
                            <div className="p-3 border-t border-slate-200 dark:border-slate-600">
                                <AgentParameterEditor
                                    agent={config.selectedAgent}
                                    params={config.agentParams}
                                    onParamsChange={p => updateConfig('agentParams', p)}
                                    theme={theme}
                                    timeFrame={config.chartTimeFrame}
                                />
                            </div>
                        )}
                    </div>

                    {/* Run button */}
                    <button
                        onClick={handleRunBacktest}
                        disabled={isLoading}
                        className={primaryButtonClass}
                    >
                        <FlaskIcon className="w-5 h-5" />
                        {isLoading ? loadingMessage : 'Run Backtest'}
                    </button>

                </div>
            </div>

            {/* ── Results Panel ──────────────────────────────────────────────── */}
            <div className="lg:col-span-9">
                {isLoading ? (
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 h-full flex items-center justify-center">
                        <div className="text-center w-72">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-sky-500 mx-auto mb-4" />
                            <p className="text-slate-600 dark:text-slate-300 font-medium mb-3">{loadingMessage}</p>
                            {backtestProgress > 0 && (
                                <>
                                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
                                        <div
                                            className="bg-sky-500 h-2.5 rounded-full transition-all duration-300"
                                            style={{ width: `${backtestProgress}%` }}
                                        />
                                    </div>
                                    <p className="text-xs text-slate-400 mt-1.5">{backtestProgress}% complete</p>
                                </>
                            )}
                        </div>
                    </div>
                ) : error ? (
                    <div className="bg-rose-100 dark:bg-rose-900/50 border-l-4 border-rose-500 text-rose-700 dark:text-rose-300 p-4 rounded-r-lg h-full flex flex-col justify-center">
                        <h3 className="font-bold text-lg mb-2">Backtest Failed</h3>
                        <p>{error}</p>
                        <button
                            onClick={() => setError(null)}
                            className="mt-4 text-sm font-semibold underline"
                        >
                            Try again
                        </button>
                    </div>
                ) : backtestResult ? (
                    <BacktestResultDisplay
                        result={backtestResult}
                        onReset={() => setBacktestResult(null)}
                        onApplyAndSwitchView={handleApplyAndSwitch}
                    />
                ) : (
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 h-full flex items-center justify-center">
                        <div className="text-center">
                            <FlaskIcon className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                            <h3 className="font-bold text-lg">Configure &amp; Run a Backtest</h3>
                            <p className="text-slate-500 dark:text-slate-400">
                                Select an agent, market, and time period — then hit Run Backtest.
                            </p>
                        </div>
                    </div>
                )}
            </div>

        </div>
    );
};
