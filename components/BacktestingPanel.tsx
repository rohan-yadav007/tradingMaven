
import React from 'react';
import { useState, useEffect } from 'react';
import { Agent, BotConfig, BacktestResult, TradingMode, AgentParams, Kline, RiskMode, OptimizationResultItem } from '../types';
import * as constants from '../constants';
import * as binanceService from './../services/binanceService';
import { runBacktest, runOptimization } from '../services/backtestingService';
import { FlaskIcon, ChevronUp, ChevronDown, LockIcon, UnlockIcon, SparklesIcon } from './icons';
import { useTradingConfigState, useTradingConfigActions } from '../contexts/TradingConfigContext';
import { SearchableDropdown } from './SearchableDropdown';


// --- Internal Components (Consolidated) ---

const formGroupClass = "flex flex-col gap-1.5";
const formLabelClass = "text-sm font-medium text-slate-700 dark:text-slate-300";
const formInputClass = "w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500";
const buttonClass = "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-white font-semibold rounded-md shadow-sm transition-colors";

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

const RiskInputWithLock: React.FC<{
    label: string; mode: RiskMode; value: number; isLocked: boolean; investmentAmount: number;
    onModeChange: (mode: RiskMode) => void; onValueChange: (value: number) => void; onLockToggle: () => void;
}> = ({ label, mode, value, isLocked, investmentAmount, onModeChange, onValueChange, onLockToggle }) => {
    const [inputValue, setInputValue] = useState<string>(String(value));
    useEffect(() => { setInputValue(String(value)); }, [value, mode]);
    const handleToggleMode = () => {
        const currentValue = parseFloat(inputValue);
        if (isNaN(currentValue) || investmentAmount <= 0) { onModeChange(mode === RiskMode.Percent ? RiskMode.Amount : RiskMode.Percent); return; }
        const nextMode = mode === RiskMode.Percent ? RiskMode.Amount : RiskMode.Percent;
        const nextValue = nextMode === RiskMode.Amount ? investmentAmount * (currentValue / 100) : (currentValue / investmentAmount) * 100;
        onModeChange(nextMode); onValueChange(parseFloat(nextValue.toFixed(2)));
    };
    const handleBlur = () => {
        const numValue = parseFloat(inputValue);
        if (!isNaN(numValue) && numValue !== value) { onValueChange(numValue); } else { setInputValue(String(value)); }
    };
    return (
        <div className={formGroupClass}>
            <label className={formLabelClass}>{label}</label>
            <div className="flex">
                <button onClick={onLockToggle} className={`px-3 bg-slate-100 dark:bg-slate-600 border border-r-0 border-slate-300 dark:border-slate-600 rounded-l-md hover:bg-slate-200 dark:hover:bg-slate-500 transition-colors ${!isLocked ? 'text-sky-500' : 'text-slate-400'}`}>
                   {isLocked ? <LockIcon className="w-4 h-4" /> : <UnlockIcon className="w-4 h-4" />}
                </button>
                <div className="relative flex-grow">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 text-sm">{mode === RiskMode.Percent ? '%' : '$'}</span>
                    <input type="number" value={inputValue} onChange={e => setInputValue(e.target.value)} onBlur={handleBlur} className={`${formInputClass} pl-7 rounded-none`} min="0" />
                </div>
                <button onClick={handleToggleMode} className="px-3 bg-slate-100 dark:bg-slate-600 border border-l-0 border-slate-300 dark:border-slate-600 rounded-r-md font-bold text-sm hover:bg-slate-200 dark:hover:bg-slate-500 transition-colors">
                   {mode === RiskMode.Percent ? '$' : '%'}
                </button>
            </div>
        </div>
    );
};

const ParamSlider: React.FC<{label: string, value: number, onChange: (val: number) => void, min: number, max: number, step: number}> = ({ label, value, onChange, min, max, step }) => (
    <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-baseline"><label className={formLabelClass}>{label}</label><span className="text-sm font-semibold text-sky-500">{value}</span></div>
        <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer" />
    </div>
);

const AgentParameterEditor: React.FC<{agent: Agent, params: AgentParams, onParamsChange: (p: AgentParams) => void}> = ({ agent, params, onParamsChange }) => {
    const allParams: Required<AgentParams> = {...constants.DEFAULT_AGENT_PARAMS, ...params};
    const updateParam = (key: keyof AgentParams, value: number | boolean) => { onParamsChange({ ...params, [key]: value }); };
    switch (agent.id) {
        case 7: return (<div className="space-y-4">
            <ParamSlider label="Trend EMA Period" value={allParams.msm_htfEmaPeriod} onChange={v => updateParam('msm_htfEmaPeriod', v)} min={20} max={200} step={1} />
            <ParamSlider label="S/R Lookback" value={allParams.msm_swingPointLookback} onChange={v => updateParam('msm_swingPointLookback', v)} min={3} max={20} step={1} />
            <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
                <label className={formLabelClass}>Candlestick Confirmation</label>
                <ToggleSwitch checked={allParams.isCandleConfirmationEnabled} onChange={v => updateParam('isCandleConfirmationEnabled', v)} />
            </div>
            </div>);
        case 9: return (<div className="space-y-4">
            <h5 className="font-semibold text-xs uppercase text-slate-400">Regime Filter</h5>
            <ParamSlider label="ADX Period" value={allParams.qsc_adxPeriod} onChange={v => updateParam('qsc_adxPeriod', v)} min={5} max={20} step={1} />
            <ParamSlider label="ADX Trend Threshold" value={allParams.qsc_adxThreshold} onChange={v => updateParam('qsc_adxThreshold', v)} min={15} max={35} step={1} />
            <ParamSlider label="ADX Chop Buffer" value={allParams.qsc_adxChopBuffer} onChange={v => updateParam('qsc_adxChopBuffer', v)} min={0} max={10} step={1} />
            <h5 className="font-semibold text-xs uppercase text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-700">Trend Logic</h5>
            <ParamSlider label="Fast EMA Period" value={allParams.qsc_fastEmaPeriod} onChange={v => updateParam('qsc_fastEmaPeriod', v)} min={5} max={20} step={1} />
            <ParamSlider label="Slow EMA Period" value={allParams.qsc_slowEmaPeriod} onChange={v => updateParam('qsc_slowEmaPeriod', v)} min={15} max={50} step={1} />
            <ParamSlider label="Trend Score Threshold" value={allParams.qsc_trendScoreThreshold} onChange={v => updateParam('qsc_trendScoreThreshold', v)} min={1} max={4} step={1} />
            <h5 className="font-semibold text-xs uppercase text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-700">Range Logic</h5>
            <ParamSlider label="BB Period" value={allParams.qsc_bbPeriod} onChange={v => updateParam('qsc_bbPeriod', v)} min={10} max={30} step={1} />
            <ParamSlider label="BB StdDev" value={allParams.qsc_bbStdDev} onChange={v => updateParam('qsc_bbStdDev', v)} min={1.5} max={3} step={0.1} />
            <ParamSlider label="StochRSI Period" value={allParams.qsc_stochRsiPeriod} onChange={v => updateParam('qsc_stochRsiPeriod', v)} min={7} max={28} step={1} />
            <ParamSlider label="StochRSI Oversold" value={allParams.qsc_stochRsiOversold} onChange={v => updateParam('qsc_stochRsiOversold', v)} min={10} max={40} step={1} />
            <ParamSlider label="StochRSI Overbought" value={allParams.qsc_stochRsiOverbought} onChange={v => updateParam('qsc_stochRsiOverbought', v)} min={60} max={90} step={1} />
            <ParamSlider label="Range Score Threshold" value={allParams.qsc_rangeScoreThreshold} onChange={v => updateParam('qsc_rangeScoreThreshold', v)} min={1} max={2} step={1} />
            <h5 className="font-semibold text-xs uppercase text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-700">Exit Logic</h5>
            <ParamSlider label="PSAR Step" value={allParams.qsc_psarStep} onChange={v => updateParam('qsc_psarStep', v)} min={0.01} max={0.1} step={0.005} />
            <ParamSlider label="PSAR Max" value={allParams.qsc_psarMax} onChange={v => updateParam('qsc_psarMax', v)} min={0.1} max={0.5} step={0.01} />
            </div>);
        case 11: return (<div className="space-y-4">
            <ParamSlider label="Trend SMA Period" value={allParams.he_trendSmaPeriod} onChange={v => updateParam('he_trendSmaPeriod', v)} min={20} max={50} step={1} />
            <ParamSlider label="Fast EMA Period" value={allParams.he_fastEmaPeriod} onChange={v => updateParam('he_fastEmaPeriod', v)} min={5} max={20} step={1} />
            <ParamSlider label="Slow EMA Period" value={allParams.he_slowEmaPeriod} onChange={v => updateParam('he_slowEmaPeriod', v)} min={20} max={50} step={1} />
            <ParamSlider label="RSI Period" value={allParams.he_rsiPeriod} onChange={v => updateParam('he_rsiPeriod', v)} min={7} max={28} step={1} />
            <ParamSlider label="RSI Midline" value={allParams.he_rsiMidline} onChange={v => updateParam('he_rsiMidline', v)} min={40} max={60} step={1} />
            </div>);
        default: return <p className="text-sm text-slate-500">This agent does not have any customizable parameters.</p>;
    }
};

const BacktestControlPanel: React.FC<{
    config: BacktestConfig; updateConfig: <K extends keyof BacktestConfig>(key: K, value: BacktestConfig[K]) => void;
    backtestDays: number; setBacktestDays: (days: number) => void;
    onRunBacktest: () => void; onRunOptimization: () => void;
    isLoading: boolean; loadingMessage: string; theme: 'light' | 'dark';
}> = ({ config, updateConfig, backtestDays, setBacktestDays, onRunBacktest, onRunOptimization, isLoading, loadingMessage, theme }) => {
    const globalConfig = useTradingConfigState();
    const [isParamsOpen, setIsParamsOpen] = useState(false);
    const canOptimize = [7, 9, 11].includes(config.selectedAgent.id);
    return (
        <div className="flex flex-col gap-4 h-full">
            <h2 className="text-lg font-bold">Backtest Configuration</h2>
            <div className={formGroupClass}><label className={formLabelClass}>Backtest Period (Days)</label><input type="number" value={backtestDays} onChange={e => setBacktestDays(Number(e.target.value))} className={formInputClass} min="1" max="90" /></div>
            <div className={formGroupClass}><label className={formLabelClass}>Trading Platform</label><select value={config.tradingMode} onChange={e => updateConfig('tradingMode', e.target.value as TradingMode)} className={formInputClass}>{Object.values(TradingMode).map(mode => <option key={mode} value={mode}>{mode}</option>)}</select></div>
            <div className={formGroupClass}><label className={formLabelClass}>Market</label><SearchableDropdown options={globalConfig.allPairs} value={config.selectedPair} onChange={(v) => updateConfig('selectedPair', v)} theme={theme} disabled={globalConfig.isPairsLoading} /></div>
            <div className={formGroupClass}><label className={formLabelClass}>Entry Timeframe</label><select value={config.chartTimeFrame} onChange={e => updateConfig('chartTimeFrame', e.target.value)} className={formInputClass}>{constants.TIME_FRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}</select></div>
            <div className={formGroupClass}><label className={formLabelClass}>Trading Agent</label><select value={config.selectedAgent.id} onChange={e => updateConfig('selectedAgent', constants.AGENTS.find(a => a.id === Number(e.target.value))!)} className={formInputClass}>{constants.AGENTS.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></div>
            <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>
            <div className={formGroupClass}><label className={formLabelClass}>Investment Amount</label><div className="relative"><span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">$</span><input type="number" value={config.investmentAmount} onChange={e => updateConfig('investmentAmount', Number(e.target.value))} className={`${formInputClass} pl-7`} min="1"/></div></div>
            {config.tradingMode === TradingMode.USDSM_Futures && (<div className={formGroupClass}><label className="flex justify-between items-baseline"><span className={formLabelClass}>Leverage</span><span className="font-bold text-sky-500">{config.leverage}x</span></label><input type="range" min="1" max={globalConfig.maxLeverage} value={config.leverage} onChange={e => updateConfig('leverage', Number(e.target.value))} className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer" /></div>)}
            <RiskInputWithLock label="Take Profit" mode={config.takeProfitMode} value={config.takeProfitValue} isLocked={config.isTakeProfitLocked} investmentAmount={config.investmentAmount} onModeChange={v => updateConfig('takeProfitMode', v)} onValueChange={v => updateConfig('takeProfitValue', v)} onLockToggle={() => updateConfig('isTakeProfitLocked', !config.isTakeProfitLocked)} />
            <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>
            <div className="space-y-3 pt-2"><div className="flex items-center justify-between"><label className={formLabelClass}>Higher Timeframe Confirmation</label><ToggleSwitch checked={config.isHtfConfirmationEnabled} onChange={v => updateConfig('isHtfConfirmationEnabled', v)} /></div><div className="flex items-center justify-between"><label className={formLabelClass}>Universal Profit Trail</label><ToggleSwitch checked={config.isUniversalProfitTrailEnabled} onChange={v => updateConfig('isUniversalProfitTrailEnabled', v)} /></div><div className="flex items-center justify-between"><label className={formLabelClass}>Trailing Take Profit</label><ToggleSwitch checked={config.isTrailingTakeProfitEnabled} onChange={v => updateConfig('isTrailingTakeProfitEnabled', v)} /></div>
                <div className="flex items-center justify-between"><label className={formLabelClass}>Minimum R:R Veto</label><ToggleSwitch checked={config.isMinRrEnabled} onChange={v => updateConfig('isMinRrEnabled', v)} /></div>
            </div>
            <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                <button onClick={() => setIsParamsOpen(!isParamsOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold">
                    Agent Logic Parameters
                    {isParamsOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {isParamsOpen && (
                    <div className="p-3 border-t border-slate-200 dark:border-slate-600">
                        <div className="flex justify-between items-center mb-4">
                            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Customize Parameters</h4>
                            <button 
                                onClick={() => updateConfig('agentParams', {})}
                                className="text-xs font-semibold text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-500 transition-colors"
                                title="Reset parameters to their default values"
                            >
                                Reset to Default
                            </button>
                        </div>
                        <AgentParameterEditor 
                            agent={config.selectedAgent} 
                            params={config.agentParams} 
                            onParamsChange={p => updateConfig('agentParams', p)} 
                        />
                    </div>
                )}
            </div>
            <div className="mt-auto pt-4 border-t border-slate-200 dark:border-slate-700 flex flex-col gap-3">
                <button onClick={onRunBacktest} disabled={isLoading} className={`${buttonClass} bg-slate-600 hover:bg-slate-700 disabled:bg-slate-400 dark:disabled:bg-slate-600`}>{isLoading ? loadingMessage : 'Run Single Backtest'}</button>
                <button onClick={onRunOptimization} disabled={isLoading || !canOptimize} className={`${buttonClass} bg-sky-600 hover:bg-sky-700 disabled:bg-slate-400 dark:disabled:bg-slate-600`} title={canOptimize ? "Optimize agent parameters" : "This agent does not support optimization"}><SparklesIcon className="w-5 h-5"/>{isLoading ? loadingMessage : 'Optimize Agent'}</button>
            </div>
        </div>
    );
};

const ResultMetric: React.FC<{label: string, value: string | number, className?: string}> = ({label, value, className}) => (
    <div className="text-center bg-slate-100 dark:bg-slate-800/50 p-2 rounded-lg">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-0">{label}</p>
        <p className={`text-lg font-bold mb-0 ${className}`}>{value}</p>
    </div>
);

const BacktestResultDisplay: React.FC<{ result: BacktestResult, onReset: () => void, onApplyAndSwitchView: () => void }> = ({ result, onReset, onApplyAndSwitchView }) => {
    const pnlIsProfit = result.totalPnl >= 0;
    const winRateIsGood = result.winRate >= 50;
    const sideClass = (dir: 'LONG' | 'SHORT') => dir === 'LONG' ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300' : 'bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-300';
    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 animate-fade-in h-full flex flex-col">
            <div className="flex justify-between items-start flex-shrink-0"><h2 className="text-xl font-bold mb-4">Backtest Results</h2><div className="flex gap-2"><button onClick={onReset} className="text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-sky-500">Run New Test</button><button onClick={onApplyAndSwitchView} className="px-4 py-2 bg-sky-600 text-white font-semibold rounded-md shadow-sm hover:bg-sky-700 text-sm">Apply to Trading</button></div></div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6 flex-shrink-0"><ResultMetric label="Total Net PNL" value={`$${result.totalPnl.toFixed(2)}`} className={pnlIsProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}/><ResultMetric label="Win Rate" value={`${result.winRate.toFixed(1)}%`} className={winRateIsGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}/><ResultMetric label="Total Trades" value={result.totalTrades} /><ResultMetric label="Wins / Losses" value={`${result.wins} / ${result.losses}`} /><ResultMetric label="Profit Factor" value={result.profitFactor.toFixed(2)} /><ResultMetric label="Max Drawdown" value={`$${result.maxDrawdown.toFixed(2)}`} /><ResultMetric label="Sharpe Ratio" value={result.sharpeRatio.toFixed(2)} /><ResultMetric label="Avg. Duration" value={result.averageTradeDuration} /></div>
            <div className="overflow-auto border dark:border-slate-700 rounded-md flex-grow"><table className="w-full text-sm text-left"><thead className="bg-slate-50 dark:bg-slate-700/50 sticky top-0"><tr><th className="px-4 py-2">Pair</th><th className="px-4 py-2">Side</th><th className="px-4 py-2">Entry Time</th><th className="px-4 py-2">Exit Time</th><th className="px-4 py-2">Entry Price</th><th className="px-4 py-2">Exit Price</th><th className="px-4 py-2">Net PNL</th><th className="px-4 py-2">Exit Reason</th></tr></thead><tbody className="divide-y divide-slate-200 dark:divide-slate-700">{result.trades.map(trade => (<tr key={trade.id}><td className="px-4 py-2 font-semibold">{trade.pair}</td><td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full font-medium ${sideClass(trade.direction)}`}>{trade.direction}</span></td><td className="px-4 py-2 whitespace-nowrap">{new Date(trade.entryTime).toLocaleString()}</td><td className="px-4 py-2 whitespace-nowrap">{new Date(trade.exitTime).toLocaleString()}</td><td className="px-4 py-2 font-mono">{trade.entryPrice.toFixed(4)}</td><td className="px-4 py-2 font-mono">{trade.exitPrice.toFixed(4)}</td><td className={`px-4 py-2 font-mono ${trade.pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{trade.pnl.toFixed(2)}</td><td className="px-4 py-2 text-slate-500 dark:text-slate-400">{trade.exitReason}</td></tr>))}</tbody></table></div>
        </div>
    );
};

const OptimizationResultRow: React.FC<{ item: OptimizationResultItem; onApply: () => void; isOpen: boolean; onToggle: () => void; }> = ({ item, onApply, isOpen, onToggle }) => {
    const { result, params } = item;
    const pnlIsProfit = result.totalPnl >= 0;
    const winRateIsGood = result.winRate >= 50;
    const sideClass = (dir: 'LONG' | 'SHORT') => dir === 'LONG' ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300' : 'bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-300';
    const Metric: React.FC<{label: string, value: string | number, className?: string}> = ({label, value, className}) => (<div className="text-center"><p className="text-xs text-slate-500 dark:text-slate-400 mb-0">{label}</p><p className={`text-base font-bold mb-0 ${className}`}>{value}</p></div>);
    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm">
            <button onClick={onToggle} className="w-full text-left p-3 focus:outline-none"><div className="grid grid-cols-3 md:grid-cols-4 gap-3 w-full items-center"><Metric label="Total PNL" value={`$${result.totalPnl.toFixed(2)}`} className={pnlIsProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}/><Metric label="Win Rate" value={`${result.winRate.toFixed(1)}%`} className={winRateIsGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} /><Metric label="Trades" value={result.totalTrades} /><div className="hidden md:flex justify-end pr-2">{isOpen ? <ChevronUp className="w-5 h-5 text-slate-400"/> : <ChevronDown className="w-5 h-5 text-slate-400"/>}</div></div></button>
            {isOpen && (<div className="p-4 border-t border-slate-200 dark:border-slate-700"><div className="flex flex-col md:flex-row gap-4"><div className="flex-grow"><h4 className="font-semibold text-sm mb-2">Trade Log</h4><div className="overflow-auto border dark:border-slate-700 rounded-md" style={{maxHeight: '240px'}}><table className="w-full text-xs text-left"><thead className="bg-slate-50 dark:bg-slate-700/50 sticky top-0"><tr><th className="px-2 py-1.5">Exit Time</th><th className="px-2 py-1.5">Side</th><th className="px-2 py-1.5">PNL</th><th className="px-2 py-1.5">Reason</th></tr></thead><tbody className="divide-y divide-slate-200 dark:divide-slate-700">{result.trades.map(trade => (<tr key={trade.id}><td className="px-2 py-1.5 whitespace-nowrap">{new Date(trade.exitTime).toLocaleDateString()}</td><td className="px-2 py-1.5"><span className={`px-2 py-0.5 rounded-full font-medium ${sideClass(trade.direction)}`}>{trade.direction}</span></td><td className={`px-2 py-1.5 font-mono ${trade.pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{trade.pnl.toFixed(2)}</td><td className="px-2 py-1.5 text-slate-500 dark:text-slate-400 truncate">{trade.exitReason}</td></tr>))}</tbody></table></div></div><div className="w-full md:max-w-xs"><h4 className="font-semibold text-sm mb-2">Parameters Used</h4><div className="text-xs p-3 bg-slate-100 dark:bg-slate-900/50 rounded-lg border dark:border-slate-700 mb-3 space-y-1">{Object.entries(params).map(([key, value]) => (<div key={key} className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">{key}:</span><span className="font-mono font-semibold">{String(value)}</span></div>))}</div><button onClick={onApply} className="w-full px-4 py-2 bg-sky-600 text-white font-semibold rounded-md shadow-sm hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500">Apply to Trading</button></div></div></div>)}
        </div>
    );
};

const OptimizationResults: React.FC<{ results: OptimizationResultItem[]; onApplyAndSwitchView: (params: AgentParams) => void; onReset: () => void; }> = ({ results, onApplyAndSwitchView, onReset }) => {
    const [openId, setOpenId] = useState<number | null>(0);
    const handleToggle = (id: number) => { setOpenId(prevId => prevId === id ? null : id); };
    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 animate-fade-in h-full flex flex-col">
            <div className="flex justify-between items-center mb-4 flex-shrink-0"><h3 className="font-bold text-lg">Optimization Results ({results.length} combinations)</h3><button onClick={onReset} className="text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-sky-500">Run New Test</button></div>
            <div className="space-y-2 flex-grow overflow-y-auto pr-2 -mr-2">{results.map((item, index) => (<OptimizationResultRow key={index} item={item} onApply={() => onApplyAndSwitchView(item.params)} isOpen={openId === index} onToggle={() => handleToggle(index)} />))}</div>
        </div>
    )
};


// --- Main Panel Component ---

interface BacktestingPanelProps {
    backtestResult: BacktestResult | null;
    setBacktestResult: (result: BacktestResult | null) => void;
    setActiveView: (view: 'trading' | 'backtesting') => void;
    klines: Kline[];
    theme: 'light' | 'dark';
}

export type BacktestConfig = {
    tradingMode: TradingMode; selectedPair: string; chartTimeFrame: string; selectedAgent: Agent;
    investmentAmount: number; takeProfitMode: RiskMode; takeProfitValue: number; isTakeProfitLocked: boolean;
    isHtfConfirmationEnabled: boolean; isUniversalProfitTrailEnabled: boolean; isTrailingTakeProfitEnabled: boolean;
    isMinRrEnabled: boolean; htfTimeFrame: 'auto' | string;
    agentParams: AgentParams; leverage: number;
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
        tradingMode: globalConfig.tradingMode, selectedPair: globalConfig.selectedPair, chartTimeFrame: '5m',
        selectedAgent: globalConfig.selectedAgent, investmentAmount: globalConfig.investmentAmount,
        takeProfitMode: globalConfig.takeProfitMode, takeProfitValue: globalConfig.takeProfitValue,
        isTakeProfitLocked: globalConfig.isTakeProfitLocked, isHtfConfirmationEnabled: globalConfig.isHtfConfirmationEnabled,
        isUniversalProfitTrailEnabled: globalConfig.isUniversalProfitTrailEnabled, htfTimeFrame: globalConfig.htfTimeFrame,
        agentParams: globalConfig.agentParams, leverage: globalConfig.leverage, isTrailingTakeProfitEnabled: globalConfig.isTrailingTakeProfitEnabled,
        isMinRrEnabled: globalConfig.isMinRrEnabled,
    });

    const [backtestDays, setBacktestDays] = useState(1);
    const [optimizationResults, setOptimizationResults] = useState<OptimizationResultItem[] | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadingMessage, setLoadingMessage] = useState('Running Simulation...');
    
    const updateConfig = <K extends keyof BacktestConfig>(key: K, value: BacktestConfig[K]) => {
        setConfig(prev => ({...prev, [key]: value}));
    };

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
            
            let htfKlines: Kline[] | undefined = undefined;
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
                pair: config.selectedPair, mode: config.tradingMode, executionMode: 'paper', leverage: config.leverage, agent: config.selectedAgent,
                timeFrame: config.chartTimeFrame, investmentAmount: config.investmentAmount, takeProfitMode: config.takeProfitMode,
                takeProfitValue: config.takeProfitValue, isTakeProfitLocked: config.isTakeProfitLocked,
                isHtfConfirmationEnabled: config.isHtfConfirmationEnabled, isUniversalProfitTrailEnabled: config.isUniversalProfitTrailEnabled,
                isTrailingTakeProfitEnabled: config.isTrailingTakeProfitEnabled, isMinRrEnabled: config.isMinRrEnabled,
                htfTimeFrame: config.htfTimeFrame, agentParams: config.agentParams,
                pricePrecision: binanceService.getPricePrecision(symbolInfo), quantityPrecision: binanceService.getQuantityPrecision(symbolInfo),
                stepSize: binanceService.getStepSize(symbolInfo),
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
            
            let htfKlines: Kline[] | undefined = undefined;
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
                pair: config.selectedPair, mode: config.tradingMode, executionMode: 'paper', leverage: config.leverage, agent: config.selectedAgent,
                timeFrame: config.chartTimeFrame, investmentAmount: config.investmentAmount, takeProfitMode: config.takeProfitMode,
                takeProfitValue: config.takeProfitValue, isTakeProfitLocked: config.isTakeProfitLocked,
                isHtfConfirmationEnabled: config.isHtfConfirmationEnabled, isUniversalProfitTrailEnabled: config.isUniversalProfitTrailEnabled,
                isTrailingTakeProfitEnabled: config.isTrailingTakeProfitEnabled, isMinRrEnabled: config.isMinRrEnabled,
                htfTimeFrame: config.htfTimeFrame, agentParams: config.agentParams,
                pricePrecision: binanceService.getPricePrecision(symbolInfo), quantityPrecision: binanceService.getQuantityPrecision(symbolInfo),
                stepSize: binanceService.getStepSize(symbolInfo),
            };
            const results = await runOptimization(backtestKlines, baseBotConfig, onProgress, htfKlines);
            if (results.length === 0) { setError("Optimization complete, but no profitable parameter combinations were found."); } else { setOptimizationResults(results); }
        } catch (e) {
            console.error("Optimization failed:", e); setError(e instanceof Error ? e.message : "An unknown error occurred during optimization.");
        } finally { setIsLoading(false); }
    };
    
    const handleApplyAndSwitchView = (paramsToApply: AgentParams) => {
        globalActions.setAgentParams(paramsToApply); globalActions.setSelectedAgent(config.selectedAgent);
        globalActions.setTradingMode(config.tradingMode); globalActions.setSelectedPair(config.selectedPair);
        globalActions.setTimeFrame(config.chartTimeFrame); globalActions.setInvestmentAmount(config.investmentAmount);
        globalActions.setLeverage(config.leverage); globalActions.setTakeProfitMode(config.takeProfitMode);
        globalActions.setTakeProfitValue(config.takeProfitValue); globalActions.setIsTakeProfitLocked(config.isTakeProfitLocked);
        globalActions.setIsHtfConfirmationEnabled(config.isHtfConfirmationEnabled);
        globalActions.setIsUniversalProfitTrailEnabled(config.isUniversalProfitTrailEnabled);
        globalActions.setIsTrailingTakeProfitEnabled(config.isTrailingTakeProfitEnabled);
        globalActions.setIsMinRrEnabled(config.isMinRrEnabled);
        setActiveView('trading');
    };

    const handleReset = () => {
        setBacktestResult(null); setOptimizationResults(null); setError(null);
    };
    
    const renderContent = () => {
        if (isLoading) { return (<div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm h-full flex flex-col justify-center items-center text-center p-6"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500"></div><p className="mt-4 text-lg font-semibold text-slate-700 dark:text-slate-200">{loadingMessage}</p></div>); }
        if (error) { return (<div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm h-full flex flex-col justify-center items-center text-center p-6"><h3 className="text-lg font-bold text-rose-600 dark:text-rose-400">An Error Occurred</h3><p className="text-slate-600 dark:text-slate-300 my-2">{error}</p><button onClick={handleReset} className="mt-2 px-4 py-2 bg-sky-600 text-white font-semibold rounded-md shadow-sm hover:bg-sky-700">Try Again</button></div>) }
        if (optimizationResults) { return <OptimizationResults results={optimizationResults} onReset={handleReset} onApplyAndSwitchView={handleApplyAndSwitchView} />; }
        if (backtestResult) { return <BacktestResultDisplay result={backtestResult} onReset={handleReset} onApplyAndSwitchView={() => handleApplyAndSwitchView(config.agentParams)} />; }
        return (<div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm text-center h-full flex flex-col justify-center items-center p-6"><FlaskIcon className="w-16 h-16 mx-auto text-slate-300 dark:text-slate-600" /><h2 className="text-xl font-bold mt-4 text-slate-800 dark:text-slate-100">Backtesting Laboratory</h2><p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto">Configure your parameters in the sidebar, then run a simulation or optimize an agent to see the results here.</p></div>);
    };

    return (
        <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 lg:col-span-4 xl:col-span-3">
                 <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-4 h-full">
                    <BacktestControlPanel config={config} updateConfig={updateConfig} backtestDays={backtestDays} setBacktestDays={setBacktestDays} onRunBacktest={handleRunBacktest} onRunOptimization={handleRunOptimization} isLoading={isLoading} loadingMessage={loadingMessage} theme={theme} />
                 </div>
            </div>
            <div className="col-span-12 lg:col-span-8 xl:col-span-9">
                {renderContent()}
            </div>
        </div>
    );
};
