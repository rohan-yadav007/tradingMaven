

import React, { useState, useEffect, useMemo } from 'react';
import { Agent, BotConfig, BacktestResult, TradingMode, AgentParams, Kline, SimulatedTrade, RiskMode } from '../types';
import * as constants from '../constants';
import * as binanceService from './../services/binanceService';
import { runBacktest } from '../services/backtestingService';
import { getInitialAgentTargets } from '../services/localAgentService';
import { FlaskIcon, ChevronUp, ChevronDown, LockIcon, UnlockIcon } from './icons';
import { SearchableDropdown } from './SearchableDropdown';
import { useTradingConfigState, useTradingConfigActions } from '../contexts/TradingConfigContext';

interface BacktestingPanelProps {
    backtestResult: BacktestResult | null;
    setBacktestResult: (result: BacktestResult | null) => void;
    setActiveView: (view: 'trading' | 'backtesting') => void;
    klines: Kline[]; // Passed from App.tsx for suggestions
    theme: 'light' | 'dark';
}

type BacktestConfig = {
    tradingMode: TradingMode;
    selectedPair: string;
    chartTimeFrame: string;
    selectedAgent: Agent;
    investmentAmount: number;
    takeProfitMode: RiskMode;
    takeProfitValue: number;
    isTakeProfitLocked: boolean;
    isCooldownEnabled: boolean;
    isHtfConfirmationEnabled: boolean;
    isAtrTrailingStopEnabled: boolean;
    htfTimeFrame: 'auto' | string;
    agentParams: AgentParams;
    leverage: number;
};

const formGroupClass = "flex flex-col gap-1.5";
const formLabelClass = "text-sm font-medium text-slate-700 dark:text-slate-300";
const formInputClass = "w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500";
const buttonClass = "w-full flex items-center justify-center gap-2 px-4 py-2 text-white font-semibold rounded-md shadow-sm transition-colors";

const ResultMetric: React.FC<{label: string, value: string | number, className?: string}> = ({label, value, className}) => (
    <div className="text-center bg-slate-100 dark:bg-slate-800/50 p-2 rounded-lg">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-0">{label}</p>
        <p className={`text-lg font-bold mb-0 ${className}`}>{value}</p>
    </div>
)

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

const ParamSlider: React.FC<{
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void
}> = ({ label, value, min, max, step, onChange }) => (
    <div className="flex flex-col gap-1">
        <div className="flex justify-between">
            <label className="text-sm mb-0 text-slate-700 dark:text-slate-300">{label}</label>
            <span className="font-bold text-sky-500 text-sm">{value.toFixed(step.toString().split('.')[1]?.length || 0)}</span>
        </div>
        <input
            type="range"
            value={value}
            onChange={e => onChange(Number(e.target.value))}
            min={min} max={max} step={step}
            className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer"
        />
    </div>
);

const RiskInputWithLock: React.FC<{
    label: string;
    mode: RiskMode;
    value: number;
    isLocked: boolean;
    investmentAmount: number;
    onModeChange: (mode: RiskMode) => void;
    onValueChange: (value: number) => void;
    onLockToggle: () => void;
}> = ({ label, mode, value, isLocked, investmentAmount, onModeChange, onValueChange, onLockToggle }) => {
    
    const [inputValue, setInputValue] = useState<string>(String(value));

    useEffect(() => {
        setInputValue(String(value));
    }, [value, mode]);

    const handleToggleMode = () => {
        const currentValue = parseFloat(inputValue);
        // Add guard clause to prevent division by zero or NaN operations
        if (isNaN(currentValue) || investmentAmount <= 0) {
            const nextMode = mode === RiskMode.Percent ? RiskMode.Amount : RiskMode.Percent;
            onModeChange(nextMode);
            return;
        }

        let nextValue: number;
        const nextMode = mode === RiskMode.Percent ? RiskMode.Amount : RiskMode.Percent;

        if (nextMode === RiskMode.Amount) { // from % to $
            nextValue = investmentAmount * (currentValue / 100);
        } else { // from $ to %
            nextValue = (currentValue / investmentAmount) * 100;
        }

        const formattedNextValue = parseFloat(nextValue.toFixed(2));
        
        onModeChange(nextMode);
        onValueChange(formattedNextValue);
    };

    const handleBlur = () => {
         const numValue = parseFloat(inputValue);
         if (!isNaN(numValue) && numValue !== value) {
            onValueChange(numValue);
         } else {
            setInputValue(String(value));
         }
    };
    
    return (
        <div className={formGroupClass}>
            <label className={formLabelClass}>{label}</label>
            <div className="flex">
                 <button
                    onClick={onLockToggle}
                    className={`px-3 bg-slate-100 dark:bg-slate-700 border border-r-0 border-slate-300 dark:border-slate-600 rounded-l-md hover:bg-slate-200 dark:hover:bg-slate-500 transition-colors ${!isLocked ? 'text-sky-500' : 'text-slate-400'}`}
                    aria-label={isLocked ? "Unlock to enable proactive management" : "Lock to set a hard target"}
                    title={isLocked ? "Target is Locked (Manual)" : "Target is Unlocked (Auto-Managed)"}
                >
                   {isLocked ? <LockIcon className="w-4 h-4" /> : <UnlockIcon className="w-4 h-4" />}
                </button>
                <div className="relative flex-grow">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 text-sm">
                        {mode === RiskMode.Percent ? '%' : '$'}
                    </span>
                    <input
                        type="number"
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        onBlur={handleBlur}
                        className={`${formInputClass} pl-7 rounded-none`}
                        min="0"
                    />
                </div>
                <button
                    onClick={handleToggleMode}
                    className="px-3 bg-slate-100 dark:bg-slate-700 border border-l-0 border-slate-300 dark:border-slate-600 rounded-r-md font-bold text-sm hover:bg-slate-200 dark:hover:bg-slate-500 transition-colors"
                    aria-label={`Switch to ${mode === RiskMode.Percent ? 'PNL Amount ($)' : 'Percentage (%)'}`}
                    title={`Switch to ${mode === RiskMode.Percent ? 'PNL Amount ($)' : 'Percentage (%)'}`}
                >
                   {mode === RiskMode.Percent ? '$' : '%'}
                </button>
            </div>
        </div>
    );
};


const AgentParameterEditor: React.FC<{
    agent: Agent,
    params: AgentParams,
    timeframe: string,
    onChange: (p: keyof AgentParams, v: number | boolean) => void
}> = ({ agent, params, timeframe, onChange }) => {
    const timeframeAdaptiveParams = constants.TIMEFRAME_ADAPTIVE_SETTINGS[timeframe] || {};
    const P = { ...constants.DEFAULT_AGENT_PARAMS, ...timeframeAdaptiveParams, ...params };
    
    const renderContent = () => {
        switch(agent.id) {
            case 1: // Momentum Master
                return ( <>
                        <h4 className="font-semibold text-sm -mb-2">Volatility Filter</h4>
                         <ParamSlider label="ATR Volatility Threshold (%)" value={P.mom_atrVolatilityThreshold!} min={0.1} max={1.0} step={0.05} onChange={v => onChange('mom_atrVolatilityThreshold', v)} />
                        <h4 className="font-semibold text-sm -mb-2">Trend Confirmation</h4>
                        <ParamSlider label="ADX Period" value={P.adxPeriod} min={5} max={25} step={1} onChange={v => onChange('adxPeriod', v)} />
                        <ParamSlider label="ADX Trend Threshold" value={P.adxTrendThreshold} min={15} max={40} step={1} onChange={v => onChange('adxTrendThreshold', v)} />
                        <ParamSlider label="Slow EMA Period" value={P.mom_emaSlowPeriod} min={30} max={100} step={5} onChange={v => onChange('mom_emaSlowPeriod', v)} />
                        <ParamSlider label="Fast EMA Period" value={P.mom_emaFastPeriod} min={10} max={50} step={2} onChange={v => onChange('mom_emaFastPeriod', v)} />
                        <h4 className="font-semibold text-sm -mb-2">Entry Logic</h4>
                        <ParamSlider label="RSI Period" value={P.rsiPeriod} min={7} max={21} step={1} onChange={v => onChange('rsiPeriod', v)} />
                    </> );
            case 2: // Trend Rider
                return ( <>
                    <p className="text-xs text-center text-slate-500 dark:text-slate-400">Enters on strong breakouts in the direction of the trend. Does not wait for pullbacks.</p>
                     <h4 className="font-semibold text-sm -mb-2">Breakout Confirmation</h4>
                     <ParamSlider label="Volume SMA Period" value={P.tr_volumeSmaPeriod!} min={10} max={40} step={1} onChange={v => onChange('tr_volumeSmaPeriod', v)} />
                     <ParamSlider label="Volume Multiplier" value={P.tr_volumeMultiplier!} min={1.1} max={3.0} step={0.1} onChange={v => onChange('tr_volumeMultiplier', v)} />
                    <h4 className="font-semibold text-sm -mb-2">Trend Confirmation</h4>
                    <ParamSlider label="ADX Period" value={P.adxPeriod} min={5} max={25} step={1} onChange={v => onChange('adxPeriod', v)} />
                    <ParamSlider label="ADX Trend Threshold" value={P.adxTrendThreshold} min={15} max={40} step={1} onChange={v => onChange('adxTrendThreshold', v)} />
                    <ParamSlider label="Slow EMA Period" value={P.tr_emaSlowPeriod} min={30} max={100} step={5} onChange={v => onChange('tr_emaSlowPeriod', v)} />
                    <ParamSlider label="Fast EMA Period" value={P.tr_emaFastPeriod} min={10} max={50} step={2} onChange={v => onChange('tr_emaFastPeriod', v)} />
                </> );
            case 3: // Mean Reversionist
                return ( <>
                    <p className="text-xs text-center text-slate-500 dark:text-slate-400">Trades reversals in ranging markets. Only active when ADX is low.</p>
                    <h4 className="font-semibold text-sm -mb-2">Safety Filter</h4>
                     <ParamSlider label="HTF Trend EMA" value={P.mr_htfEmaPeriod!} min={50} max={200} step={10} onChange={v => onChange('mr_htfEmaPeriod', v)} />
                    <h4 className="font-semibold text-sm -mb-2">Range Filter</h4>
                    <ParamSlider label="ADX Period" value={P.mr_adxPeriod!} min={7} max={25} step={1} onChange={v => onChange('mr_adxPeriod', v)} />
                    <ParamSlider label="ADX Range Threshold" value={P.mr_adxThreshold!} min={15} max={30} step={1} onChange={v => onChange('mr_adxThreshold', v)} />
                    <h4 className="font-semibold text-sm -mb-2">Entry Logic</h4>
                    <ParamSlider label="Bollinger Bands Period" value={P.mr_bbPeriod!} min={15} max={30} step={1} onChange={v => onChange('mr_bbPeriod', v)} />
                    <ParamSlider label="BB Standard Deviation" value={P.mr_bbStdDev!} min={1.5} max={3.0} step={0.1} onChange={v => onChange('mr_bbStdDev', v)} />
                </> );
             case 4: // Scalping Expert
                return ( <>
                    <p className="text-xs text-center text-slate-500 dark:text-slate-400">Score-based confirmation strategy. See agent description for logic.</p>
                    <ParamSlider label="Score Threshold" value={P.se_scoreThreshold!} min={2} max={4} step={1} onChange={v => onChange('se_scoreThreshold', v)} />
                    <h4 className="font-semibold text-sm -mb-2">Trend & Volatility</h4>
                    <ParamSlider label="Fast EMA Period" value={P.se_emaFastPeriod!} min={5} max={20} step={1} onChange={v => onChange('se_emaFastPeriod', v)} />
                    <ParamSlider label="Slow EMA Period" value={P.se_emaSlowPeriod!} min={20} max={50} step={1} onChange={v => onChange('se_emaSlowPeriod', v)} />
                    <ParamSlider label="ATR Volatility Threshold (%)" value={P.se_atrVolatilityThreshold!} min={0.1} max={1.0} step={0.05} onChange={v => onChange('se_atrVolatilityThreshold', v)} />
                    <h4 className="font-semibold text-sm -mb-2">Momentum & Entry</h4>
                    <ParamSlider label="MACD Fast" value={P.se_macdFastPeriod!} min={5} max={20} step={1} onChange={v => onChange('se_macdFastPeriod', v)} />
                    <ParamSlider label="MACD Slow" value={P.se_macdSlowPeriod!} min={20} max={50} step={1} onChange={v => onChange('se_macdSlowPeriod', v)} />
                </> );
            case 5: // Market Ignition
                return ( <>
                    <p className="text-xs text-center text-slate-500 dark:text-slate-400">Detects volatility squeeze then enters on a high-volume breakout.</p>
                     <h4 className="font-semibold text-sm -mb-2">Directional Bias</h4>
                     <ParamSlider label="Bias EMA Period" value={P.mi_emaBiasPeriod!} min={20} max={100} step={5} onChange={v => onChange('mi_emaBiasPeriod', v)} />
                    <h4 className="font-semibold text-sm -mb-2">Squeeze Detection</h4>
                    <ParamSlider label="BB Period" value={P.mi_bbPeriod!} min={15} max={30} step={1} onChange={v => onChange('mi_bbPeriod', v)} />
                    <ParamSlider label="BBW Squeeze Threshold" value={P.mi_bbwSqueezeThreshold!} min={0.005} max={0.03} step={0.001} onChange={v => onChange('mi_bbwSqueezeThreshold', v)} />
                    <h4 className="font-semibold text-sm -mb-2">Breakout Confirmation</h4>
                    <ParamSlider label="Volume Lookback" value={P.mi_volumeLookback!} min={10} max={30} step={1} onChange={v => onChange('mi_volumeLookback', v)} />
                    <ParamSlider label="Volume Multiplier" value={P.mi_volumeMultiplier!} min={1.25} max={3.0} step={0.05} onChange={v => onChange('mi_volumeMultiplier', v)} />
                </> );
             case 6: // Profit Locker (uses old scalping logic)
                return ( <>
                    <p className="text-xs text-center text-slate-500 dark:text-slate-400">Score-based scalper. A trade is triggered when the combined score of indicators exceeds the threshold. Partial TPs are now market-structure based.</p>
                    <ParamSlider label="Score Threshold" value={P.scalp_scoreThreshold} min={2} max={5} step={1} onChange={v => onChange('scalp_scoreThreshold', v)} />
                    <h4 className="font-semibold text-sm -mb-2">Indicator Settings</h4>
                    <ParamSlider label="EMA Period" value={P.scalp_emaPeriod} min={20} max={100} step={5} onChange={v => onChange('scalp_emaPeriod', v)} />
                    <ParamSlider label="SuperTrend Period" value={P.scalp_superTrendPeriod} min={7} max={14} step={1} onChange={v => onChange('scalp_superTrendPeriod', v)} />
                </> )
            case 7: // Market Structure Maven
                return ( <>
                        <p className="text-xs text-center text-slate-500 dark:text-slate-400">Trades from volume-confirmed support/resistance levels.</p>
                         <ParamSlider label="Bias EMA Period" value={P.msm_htfEmaPeriod} min={100} max={400} step={10} onChange={v => onChange('msm_htfEmaPeriod', v)} />
                         <ParamSlider label="Swing Point Lookback" value={P.msm_swingPointLookback} min={2} max={10} step={1} onChange={v => onChange('msm_swingPointLookback', v)} />
                         <ParamSlider label="Min Pivot Score" value={P.msm_minPivotScore!} min={1} max={10} step={0.5} onChange={v => onChange('msm_minPivotScore', v)} />
                     </> );
            case 9: // Quantum Scalper
                 return ( <>
                    <p className="text-xs text-center text-slate-500 dark:text-slate-400">Adaptive scalper. Now uses a PSAR-based exit. Risk is managed by the universal system.</p>
                    <h4 className="font-semibold text-sm -mb-2">Regime Detection</h4>
                    <ParamSlider label="Fast EMA" value={P.qsc_fastEmaPeriod!} min={5} max={15} step={1} onChange={v => onChange('qsc_fastEmaPeriod', v)} />
                    <ParamSlider label="Slow EMA" value={P.qsc_slowEmaPeriod!} min={18} max={30} step={1} onChange={v => onChange('qsc_slowEmaPeriod', v)} />
                    <ParamSlider label="ADX Threshold" value={P.qsc_adxThreshold!} min={15} max={40} step={1} onChange={v => onChange('qsc_adxThreshold', v)} />
                    <h4 className="font-semibold text-sm -mb-2">Entry Scoring</h4>
                    <ParamSlider label="Trend Score Threshold" value={P.qsc_trendScoreThreshold!} min={2} max={4} step={1} onChange={v => onChange('qsc_trendScoreThreshold', v)} />
                    <ParamSlider label="Range Score Threshold" value={P.qsc_rangeScoreThreshold!} min={1} max={3} step={1} onChange={v => onChange('qsc_rangeScoreThreshold', v)} />
                </> )
            default:
                return <p className="text-xs text-center text-slate-500 dark:text-slate-400">This agent has no configurable parameters.</p>
        }
    }

    return (
        <div className="flex flex-col gap-3">
             <h4 className="font-semibold text-base">Agent Logic: <span className="text-sky-500">{agent.name}</span></h4>
            {renderContent()}
        </div>
    )
}

const formatValue = (value: number) => {
    return value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
};

const TradeRow: React.FC<{trade: SimulatedTrade}> = ({ trade }) => {
    const pnlIsProfit = trade.pnl >= 0;
    const sideClass = trade.direction === 'LONG' ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300' : 'bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-300';
    return (
        <tr className="border-b border-slate-200 dark:border-slate-700">
            <td className="px-2 py-1.5 text-xs text-slate-600 dark:text-slate-300">{new Date(trade.exitTime).toLocaleString()}</td>
            <td className="px-2 py-1.5"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sideClass}`}>{trade.direction}</span></td>
            <td className="px-2 py-1.5 font-mono text-xs text-slate-600 dark:text-slate-300">{formatValue(trade.entryPrice)}</td>
            <td className="px-2 py-1.5 font-mono text-xs text-slate-600 dark:text-slate-300">{formatValue(trade.exitPrice)}</td>
            <td className="px-2 py-1.5 font-mono text-xs text-slate-600 dark:text-slate-300">${formatValue(trade.investedAmount)}</td>
            <td className={`px-2 py-1.5 font-mono text-xs font-bold ${pnlIsProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{pnlIsProfit ? '+' : ''}${formatValue(trade.pnl)}</td>
        </tr>
    );
};

const getTimeframeDuration = (timeframe: string): number => {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1));
    switch (unit) {
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return 0;
    }
};

export const BacktestingPanel: React.FC<BacktestingPanelProps> = (props) => {
    const { 
        backtestResult, setBacktestResult,
        setActiveView, theme
    } = props;

    const globalConfigState = useTradingConfigState();
    const globalConfigActions = useTradingConfigActions();

    const [localConfig, setLocalConfig] = useState<BacktestConfig>({
        tradingMode: globalConfigState.tradingMode,
        selectedPair: globalConfigState.selectedPair,
        chartTimeFrame: globalConfigState.chartTimeFrame,
        selectedAgent: globalConfigState.selectedAgent,
        investmentAmount: globalConfigState.investmentAmount,
        takeProfitMode: globalConfigState.takeProfitMode,
        takeProfitValue: globalConfigState.takeProfitValue,
        isTakeProfitLocked: globalConfigState.isTakeProfitLocked,
        isCooldownEnabled: globalConfigState.isCooldownEnabled,
        isHtfConfirmationEnabled: globalConfigState.isHtfConfirmationEnabled,
        isAtrTrailingStopEnabled: globalConfigState.isAtrTrailingStopEnabled,
        htfTimeFrame: globalConfigState.htfTimeFrame,
        agentParams: globalConfigState.agentParams,
        leverage: globalConfigState.leverage,
    });
    
    // Local state for the backtesting panel ONLY
    const [isParamsOpen, setIsParamsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [testPeriodDays, setTestPeriodDays] = useState(1);

    // This effect makes the UI aware of the timeframe-adaptive settings.
    useEffect(() => {
        setLocalConfig(prev => ({ ...prev, agentParams: {}, htfTimeFrame: 'auto' }));
    }, [localConfig.selectedAgent, localConfig.chartTimeFrame]);


    useEffect(() => {
        const updateSmartTargets = () => {
            if (props.klines.length < 50 || !localConfig.isTakeProfitLocked) return;

            const currentPrice = props.klines[props.klines.length - 1].close;
            if (currentPrice <= 0) return;
            
            const timeframeAdaptiveParams = constants.TIMEFRAME_ADAPTIVE_SETTINGS[localConfig.chartTimeFrame] || {};
            const finalParams: Required<AgentParams> = { ...constants.DEFAULT_AGENT_PARAMS, ...timeframeAdaptiveParams, ...localConfig.agentParams };

            const longTargets = getInitialAgentTargets(props.klines, currentPrice, 'LONG', localConfig.chartTimeFrame, finalParams, localConfig.selectedAgent.id);
            
            const profitDistance = longTargets.takeProfitPrice - currentPrice;
            
            if (!localConfig.isTakeProfitLocked) {
                let newTpValue: number;
                if (localConfig.takeProfitMode === RiskMode.Percent) {
                    newTpValue = (profitDistance / currentPrice) * 100;
                } else { // Amount
                    newTpValue = localConfig.investmentAmount * (profitDistance / currentPrice);
                }
                setLocalConfig(prev => ({...prev, takeProfitValue: parseFloat(newTpValue.toFixed(2))}));
            }
        };

        updateSmartTargets();
    }, [
        props.klines, localConfig.isTakeProfitLocked, localConfig.selectedAgent, localConfig.chartTimeFrame, 
        localConfig.agentParams, localConfig.investmentAmount, localConfig.takeProfitMode
    ]);


    const handleParamChange = (param: keyof AgentParams, value: number | boolean) => {
        setLocalConfig(prev => ({
            ...prev, 
            agentParams: { ...prev.agentParams, [param]: value }
        }));
    };

    const runHighFidelityTest = async (testRunner: (mainKlines: Kline[], mgmtKlines: Kline[], config: BotConfig) => Promise<any>) => {
        const formattedPair = localConfig.selectedPair.replace('/', '');
        
        const symbolInfo = localConfig.tradingMode === TradingMode.USDSM_Futures
            ? await binanceService.getFuturesSymbolInfo(formattedPair)
            : await binanceService.getSymbolInfo(formattedPair);
        
        if (!symbolInfo) {
            throw new Error(`Could not fetch symbol info for ${localConfig.selectedPair} to run backtest.`);
        }
        
        const timeframeDurationMs = getTimeframeDuration(localConfig.chartTimeFrame);
        if (timeframeDurationMs === 0) {
            throw new Error("Invalid timeframe selected.");
        }
        const totalMsInPeriod = testPeriodDays * 24 * 60 * 60 * 1000;
        const candleLimit = Math.ceil(totalMsInPeriod / timeframeDurationMs);

        const mainKlines = await binanceService.fetchKlines(formattedPair, localConfig.chartTimeFrame, { limit: Math.min(candleLimit, 1500), mode: localConfig.tradingMode });
        if (mainKlines.length < 200) {
            throw new Error("Not enough historical data for a meaningful backtest. Need at least 200 candles.");
        }
        
        const startTime = mainKlines[0].time;
        const endTime = mainKlines[mainKlines.length - 1].time + getTimeframeDuration(localConfig.chartTimeFrame) - 1;

        const managementKlines = await binanceService.fetchFullKlines(formattedPair, '1m', startTime, endTime, localConfig.tradingMode);
        if (managementKlines.length === 0) {
            throw new Error("Could not fetch 1-minute management klines for the selected period.");
        }

        const config: BotConfig = {
            pair: localConfig.selectedPair,
            mode: localConfig.tradingMode,
            executionMode: 'paper',
            agent: localConfig.selectedAgent,
            timeFrame: localConfig.chartTimeFrame,
            investmentAmount: localConfig.investmentAmount,
            takeProfitMode: localConfig.takeProfitMode,
            takeProfitValue: localConfig.takeProfitValue,
            isTakeProfitLocked: localConfig.isTakeProfitLocked,
            isCooldownEnabled: localConfig.isCooldownEnabled,
            isHtfConfirmationEnabled: localConfig.isHtfConfirmationEnabled,
            isAtrTrailingStopEnabled: localConfig.isAtrTrailingStopEnabled,
            htfTimeFrame: localConfig.htfTimeFrame,
            agentParams: localConfig.agentParams,
            leverage: localConfig.leverage,
            pricePrecision: binanceService.getPricePrecision(symbolInfo),
            quantityPrecision: binanceService.getQuantityPrecision(symbolInfo),
            stepSize: binanceService.getStepSize(symbolInfo),
        };

        return await testRunner(mainKlines, managementKlines, config);
    };

    const handleRunBacktest = async () => {
        setIsLoading(true); setError(null); setBacktestResult(null);
        try {
            const result = await runHighFidelityTest((mainKlines, mgmtKlines, config) => runBacktest(mainKlines, mgmtKlines, config));
            setBacktestResult(result);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'An unknown error occurred during backtest.');
        } finally {
            setIsLoading(false);
        }
    };
    
    const applyConfigToGlobal = () => {
        globalConfigActions.setTradingMode(localConfig.tradingMode);
        globalConfigActions.setSelectedPair(localConfig.selectedPair);
        globalConfigActions.setTimeFrame(localConfig.chartTimeFrame);
        globalConfigActions.setSelectedAgent(localConfig.selectedAgent);
        globalConfigActions.setInvestmentAmount(localConfig.investmentAmount);
        globalConfigActions.setLeverage(localConfig.leverage);
        globalConfigActions.setTakeProfitMode(localConfig.takeProfitMode);
        globalConfigActions.setTakeProfitValue(localConfig.takeProfitValue);
        globalConfigActions.setIsTakeProfitLocked(localConfig.isTakeProfitLocked);
        globalConfigActions.setIsCooldownEnabled(localConfig.isCooldownEnabled);
        globalConfigActions.setIsHtfConfirmationEnabled(localConfig.isHtfConfirmationEnabled);
        globalConfigActions.setIsAtrTrailingStopEnabled(localConfig.isAtrTrailingStopEnabled);
        globalConfigActions.setHtfTimeFrame(localConfig.htfTimeFrame);
        globalConfigActions.setAgentParams(localConfig.agentParams);
    };

    const handleGoToTrading = () => {
        applyConfigToGlobal();
        setActiveView('trading');
    };

    const renderSingleResult = () => {
        if (!backtestResult) return null;
        const pnlIsProfit = backtestResult.totalPnl >= 0;
        const winRateIsGood = backtestResult.winRate >= 50;

        return (
            <div className="mt-4 flex flex-col gap-4">
                <div className="flex justify-between items-center">
                    <h3 className="font-bold text-lg">Backtest Results</h3>
                    <button 
                        onClick={handleGoToTrading}
                        className="px-4 py-2 bg-sky-600 text-white font-semibold rounded-md shadow-sm hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500"
                    >
                        Use This Configuration
                    </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <ResultMetric label="Total Net PNL" value={`$${backtestResult.totalPnl.toFixed(2)}`} className={pnlIsProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}/>
                    <ResultMetric label="Win Rate" value={`${backtestResult.winRate.toFixed(1)}%`} className={winRateIsGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} />
                    <ResultMetric label="Trades (W/L/B)" value={`${backtestResult.wins}/${backtestResult.losses}/${backtestResult.breakEvens}`} />
                    <ResultMetric label="Profit Factor" value={backtestResult.profitFactor.toFixed(2)} />
                    <ResultMetric label="Avg. Duration" value={backtestResult.averageTradeDuration} />
                    <ResultMetric label="Max Drawdown" value={`$${backtestResult.maxDrawdown.toFixed(2)}`} className="text-amber-600 dark:text-amber-400"/>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-lg shadow">
                    <div className="p-3 border-b border-slate-200 dark:border-slate-700 font-semibold">Trade Log</div>
                    <div className="overflow-auto" style={{maxHeight: '400px'}}>
                        <table className="w-full text-left text-sm">
                            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-700/50 text-xs uppercase text-slate-500 dark:text-slate-400">
                                <tr>
                                    <th className="px-2 py-2">Exit Time</th><th className="px-2 py-2">Side</th><th className="px-2 py-2">Entry</th>
                                    <th className="px-2 py-2">Exit</th><th className="px-2 py-2">Invested</th><th className="px-2 py-2">PNL</th>
                                </tr>
                            </thead>
                            <tbody>
                                {backtestResult.trades.map(trade => <TradeRow key={trade.id} trade={trade} />)}
                            </tbody>
                         </table>
                    </div>
                </div>
            </div>
        )
    }

    const renderRightPanelContent = () => {
        if (error) return <div className="bg-rose-100 dark:bg-rose-900/50 border-l-4 border-rose-500 text-rose-700 dark:text-rose-300 p-4 rounded-r-lg">{error}</div>;
        if (isLoading) return (
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow h-full flex flex-col justify-center items-center text-center">
                   <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500"></div>
                   <p className="text-slate-500 dark:text-slate-400 mt-3">Fetching historical data...</p>
               </div>
        );

        if (backtestResult) return renderSingleResult();

        return (
            <div className="h-full border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg flex flex-col justify-center items-center text-center">
                <FlaskIcon className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-2"/>
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">Run a Backtest</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Configure your test on the left and see the results here.</p>
            </div>
        );
    }
    
    const higherTimeFrames = useMemo(() => {
        const currentIndex = constants.TIME_FRAMES.indexOf(localConfig.chartTimeFrame);
        if (currentIndex === -1) return [];
        return constants.TIME_FRAMES.slice(currentIndex + 1);
    }, [localConfig.chartTimeFrame]);

    return (
        <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 lg:col-span-4 xl:col-span-3">
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow">
                    <div className="p-3 border-b border-slate-200 dark:border-slate-700 font-semibold">Backtest Configuration</div>
                    <div className="p-4 flex flex-col gap-3">
                        <div className={formGroupClass}><label className={formLabelClass}>Market</label><SearchableDropdown theme={theme} options={globalConfigState.allPairs} value={localConfig.selectedPair} onChange={v => setLocalConfig(p => ({...p, selectedPair: v}))} disabled={globalConfigState.isPairsLoading}/></div>
                        <div className={formGroupClass}>
                            <label className={formLabelClass}>Trading Mode</label>
                            <select value={localConfig.tradingMode} onChange={e => setLocalConfig(p => ({...p, tradingMode: e.target.value as TradingMode}))} className={formInputClass}>
                                {Object.values(TradingMode).map(mode => <option key={mode} value={mode}>{mode}</option>)}
                            </select>
                        </div>
                        <div className={formGroupClass}><label className={formLabelClass}>Time Frame</label><select value={localConfig.chartTimeFrame} onChange={e => setLocalConfig(p => ({...p, chartTimeFrame: e.target.value}))} className={formInputClass}>{constants.TIME_FRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}</select></div>
                        
                        <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-1"></div>
                        
                        <div className={formGroupClass}>
                            <label className={formLabelClass}>Investment Amount (USDT)</label>
                            <input type="number" value={localConfig.investmentAmount} onChange={e => setLocalConfig(p => ({...p, investmentAmount: Number(e.target.value)}))} min="1" className={formInputClass} />
                        </div>
                         <div className="grid grid-cols-1 gap-4">
                            <RiskInputWithLock 
                                label="Take Profit" 
                                mode={localConfig.takeProfitMode} 
                                value={localConfig.takeProfitValue} 
                                isLocked={localConfig.isTakeProfitLocked} 
                                investmentAmount={localConfig.investmentAmount} 
                                onModeChange={v => setLocalConfig(p => ({...p, takeProfitMode: v}))} 
                                onValueChange={v => setLocalConfig(p => ({...p, takeProfitValue: v}))} 
                                onLockToggle={() => setLocalConfig(p => ({...p, isTakeProfitLocked: !p.isTakeProfitLocked}))} 
                            />
                             <p className="text-xs text-slate-500 dark:text-slate-400 -mt-2">
                                Stop Loss is fully automated by the agent.
                            </p>
                        </div>
                        {localConfig.tradingMode === TradingMode.USDSM_Futures && (
                            <ParamSlider label="Leverage" value={localConfig.leverage} min={1} max={125} step={1} onChange={v => setLocalConfig(p => ({...p, leverage: v}))} />
                        )}
                        <ParamSlider label="Test Period (Days)" value={testPeriodDays} min={1} max={7} step={1} onChange={setTestPeriodDays} />
                        
                        <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-1"></div>

                        <div className={formGroupClass}>
                            <div className="flex items-center justify-between">
                                <label htmlFor="htf-toggle" className={formLabelClass}>
                                    HTF Confirmation
                                </label>
                                <ToggleSwitch
                                    checked={localConfig.isHtfConfirmationEnabled}
                                    onChange={v => setLocalConfig(p => ({...p, isHtfConfirmationEnabled: v}))}
                                />
                            </div>
                             {localConfig.isHtfConfirmationEnabled && higherTimeFrames.length > 0 && (
                                <div className="flex flex-col gap-1.5 mt-2">
                                    <label className={formLabelClass}>Confirmation Timeframe</label>
                                    <select value={localConfig.htfTimeFrame} onChange={e => setLocalConfig(p => ({...p, htfTimeFrame: e.target.value}))} className={formInputClass}>
                                        <option value="auto">Auto</option>
                                        {higherTimeFrames.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>
                        <div className={formGroupClass}>
                            <div className="flex items-center justify-between">
                                <label htmlFor="cooldown-toggle" className={formLabelClass}>
                                    Post-Profit Cooldown
                                </label>
                                <ToggleSwitch
                                    checked={localConfig.isCooldownEnabled}
                                    onChange={v => setLocalConfig(p => ({...p, isCooldownEnabled: v}))}
                                />
                            </div>
                        </div>
                        <div className={formGroupClass}>
                            <div className="flex items-center justify-between">
                                <label htmlFor="atr-trail-toggle" className={formLabelClass}>
                                    Universal ATR Trailing Stop
                                </label>
                                <ToggleSwitch
                                    checked={localConfig.isAtrTrailingStopEnabled}
                                    onChange={v => setLocalConfig(p => ({...p, isAtrTrailingStopEnabled: v}))}
                                />
                            </div>
                        </div>
                        
                        <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-1"></div>

                        <div className={formGroupClass}><label className={formLabelClass}>Trading Agent</label><select value={localConfig.selectedAgent.id} onChange={e => setLocalConfig(p => ({...p, selectedAgent: constants.AGENTS.find(a => a.id === Number(e.target.value))!}))} className={formInputClass}>{constants.AGENTS.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></div>

                        <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                             <button onClick={() => setIsParamsOpen(!isParamsOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                                Customize Agent Logic
                                {isParamsOpen ? <ChevronUp className="w-5 h-5"/> : <ChevronDown className="w-5 h-5"/>}
                            </button>
                            {isParamsOpen && (
                                <div className="p-3 border-t border-slate-200 dark:border-slate-600 flex flex-col gap-4">
                                    <AgentParameterEditor 
                                        agent={localConfig.selectedAgent}
                                        params={localConfig.agentParams}
                                        timeframe={localConfig.chartTimeFrame}
                                        onChange={handleParamChange}
                                    />
                                    <button onClick={() => setLocalConfig(p => ({...p, agentParams: {}}))} className="text-xs text-sky-600 dark:text-sky-400 hover:underline self-start">Reset Agent Logic Params</button>
                                </div>
                            )}
                        </div>
                        
                        <button onClick={handleRunBacktest} disabled={isLoading} className={`${buttonClass} bg-sky-600 hover:bg-sky-700 disabled:bg-slate-400`}>
                            <FlaskIcon className="w-5 h-5" />
                            Run Backtest
                        </button>
                    </div>
                </div>
            </div>
            <div className="col-span-12 lg:col-span-8 xl:col-span-9">
                {renderRightPanelContent()}
            </div>
        </div>
    );
};