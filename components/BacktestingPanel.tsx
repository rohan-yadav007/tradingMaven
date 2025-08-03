


import React, { useState, useEffect } from 'react';
import { Agent, BotConfig, BacktestResult, TradingMode, AgentParams, OptimizationResultItem, Kline, SimulatedTrade, RiskMode } from '../types';
import { AGENTS, TIME_FRAMES, TRADING_PAIRS, DEFAULT_AGENT_PARAMS } from '../constants';
import * as binanceService from './../services/binanceService';
import { runBacktest, runOptimization } from '../services/backtestingService';
import { FlaskIcon, SparklesIcon, ChevronUp, ChevronDown, LockIcon, UnlockIcon } from './icons';
import { OptimizationResults } from './OptimizationResults';
import { SearchableDropdown } from './SearchableDropdown';

interface BacktestingPanelProps {
    backtestResult: BacktestResult | null;
    setBacktestResult: (result: BacktestResult | null) => void;
    optimizationResults: OptimizationResultItem[] | null;
    setOptimizationResults: React.Dispatch<React.SetStateAction<OptimizationResultItem[] | null>>;
    setActiveView: (view: 'trading' | 'backtesting') => void;
    klines: Kline[]; // Passed from App.tsx for suggestions
    onApplyConfig: (config: BotConfig) => void;
    theme: 'light' | 'dark';
}

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
            <label className="text-sm mb-0">{label}</label>
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
    onModeChange: (mode: RiskMode) => void;
    onValueChange: (value: number) => void;
    onLockToggle: () => void;
}> = ({ label, mode, value, isLocked, onModeChange, onValueChange, onLockToggle }) => {
    const nextMode = mode === RiskMode.Percent ? RiskMode.Amount : RiskMode.Percent;
    
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
                        value={value}
                        onChange={e => onValueChange(parseFloat(e.target.value) || 0)}
                        className={`${formInputClass} pl-7 rounded-none`}
                        min="0"
                    />
                </div>
                <button
                    onClick={() => onModeChange(nextMode)}
                    className="px-3 bg-slate-100 dark:bg-slate-700 border border-l-0 border-slate-300 dark:border-slate-600 rounded-r-md font-bold text-sm hover:bg-slate-200 dark:hover:bg-slate-500 transition-colors"
                    aria-label={`Switch to ${nextMode} mode`}
                >
                   {mode === RiskMode.Percent ? '$' : '%'}
                </button>
            </div>
        </div>
    );
};


const AgentParameterEditor: React.FC<{agent: Agent, params: AgentParams, onChange: (p: keyof AgentParams, v: number | boolean) => void}> = ({ agent, params, onChange }) => {
    const P = { ...DEFAULT_AGENT_PARAMS, ...params };
    
    const renderContent = () => {
        switch(agent.id) {
            case 1: // Momentum Master
                return ( <>
                        <h4 className="font-semibold text-sm -mb-2">Trend Confirmation</h4>
                        <ParamSlider label="ADX Period" value={P.adxPeriod} min={5} max={25} step={1} onChange={v => onChange('adxPeriod', v)} />
                        <ParamSlider label="ADX Trend Threshold" value={P.adxTrendThreshold} min={15} max={40} step={1} onChange={v => onChange('adxTrendThreshold', v)} />
                        <ParamSlider label="Slow EMA Period" value={P.mom_emaSlowPeriod} min={30} max={100} step={5} onChange={v => onChange('mom_emaSlowPeriod', v)} />
                        <ParamSlider label="Fast EMA Period" value={P.mom_emaFastPeriod} min={10} max={50} step={2} onChange={v => onChange('mom_emaFastPeriod', v)} />
                        <h4 className="font-semibold text-sm -mb-2">Entry Logic</h4>
                        <ParamSlider label="RSI Period" value={P.rsiPeriod} min={7} max={21} step={1} onChange={v => onChange('rsiPeriod', v)} />
                        <ParamSlider label="RSI Bullish Threshold" value={P.mom_rsiThresholdBullish} min={50} max={70} step={1} onChange={v => onChange('mom_rsiThresholdBullish', v)} />
                        <ParamSlider label="RSI Bearish Threshold" value={P.mom_rsiThresholdBearish} min={30} max={50} step={1} onChange={v => onChange('mom_rsiThresholdBearish', v)} />
                        <ParamSlider label="MACD Fast" value={P.macdFastPeriod} min={5} max={20} step={1} onChange={v => onChange('macdFastPeriod', v)} />
                        <ParamSlider label="MACD Slow" value={P.macdSlowPeriod} min={20} max={50} step={1} onChange={v => onChange('macdSlowPeriod', v)} />
                        <ParamSlider label="MACD Signal" value={P.macdSignalPeriod} min={5} max={15} step={1} onChange={v => onChange('macdSignalPeriod', v)} />
                    </> );
            case 2: // Volatility Voyager
                 return ( <>
                        <h4 className="font-semibold text-sm -mb-2">Volatility Bands</h4>
                        <ParamSlider label="Bollinger Band Period" value={P.vol_bbPeriod} min={10} max={30} step={1} onChange={v => onChange('vol_bbPeriod', v)} />
                        <ParamSlider label="Bollinger Band StdDev" value={P.vol_bbStdDev} min={1.5} max={3} step={0.1} onChange={v => onChange('vol_bbStdDev', v)} />
                        <h4 className="font-semibold text-sm -mb-2">Breakout Confirmation</h4>
                        <ParamSlider label="Stoch RSI Period" value={P.vol_stochRsiRsiPeriod} min={7} max={21} step={1} onChange={v => onChange('vol_stochRsiRsiPeriod', v)} />
                        <ParamSlider label="Stoch K Period" value={P.vol_stochRsiKPeriod} min={2} max={7} step={1} onChange={v => onChange('vol_stochRsiKPeriod', v)} />
                        <ParamSlider label="Stoch D Period" value={P.vol_stochRsiDPeriod} min={2} max={7} step={1} onChange={v => onChange('vol_stochRsiDPeriod', v)} />
                        <ParamSlider label="StochRSI Upper Threshold" value={P.vol_stochRsiUpperThreshold} min={60} max={85} step={1} onChange={v => onChange('vol_stochRsiUpperThreshold', v)} />
                        <ParamSlider label="StochRSI Lower Threshold" value={P.vol_stochRsiLowerThreshold} min={15} max={40} step={1} onChange={v => onChange('vol_stochRsiLowerThreshold', v)} />
                        <ParamSlider label="Trend EMA Period" value={P.vol_emaTrendPeriod} min={50} max={200} step={10} onChange={v => onChange('vol_emaTrendPeriod', v)} />
                    </> )
             case 3: // Trend Surfer
                return ( <>
                        <h4 className="font-semibold text-sm -mb-2">Long-Term Trend</h4>
                        <ParamSlider label="Slow EMA Period" value={P.trend_emaSlowPeriod} min={100} max={300} step={10} onChange={v => onChange('trend_emaSlowPeriod', v)} />
                        <ParamSlider label="Fast EMA Period" value={P.trend_emaFastPeriod} min={20} max={100} step={5} onChange={v => onChange('trend_emaFastPeriod', v)} />
                        <ParamSlider label="ADX Period" value={P.adxPeriod} min={7} max={21} step={1} onChange={v => onChange('adxPeriod', v)} />
                        <ParamSlider label="ADX Trend Threshold" value={P.trend_adxThreshold} min={15} max={30} step={1} onChange={v => onChange('trend_adxThreshold', v)} />
                        <h4 className="font-semibold text-sm -mb-2">Entry Signal</h4>
                        <ParamSlider label="PSAR Step" value={P.psarStep} min={0.01} max={0.05} step={0.001} onChange={v => onChange('psarStep', v)} />
                        <ParamSlider label="PSAR Max Step" value={P.psarMax} min={0.1} max={0.3} step={0.01} onChange={v => onChange('psarMax', v)} />
                    </> )
             case 4: // Scalping Expert
                 return ( <>
                        <h4 className="font-semibold text-sm -mb-2">Core Signals</h4>
                        <ParamSlider label="SuperTrend Period" value={P.scalp_superTrendPeriod} min={7} max={14} step={1} onChange={v => onChange('scalp_superTrendPeriod', v)} />
                        <ParamSlider label="SuperTrend Multiplier" value={P.scalp_superTrendMultiplier} min={1} max={4} step={0.25} onChange={v => onChange('scalp_superTrendMultiplier', v)} />
                        <ParamSlider label="EMA Crossover Fast" value={P.scalp_emaFastPeriod} min={3} max={10} step={1} onChange={v => onChange('scalp_emaFastPeriod', v)} />
                        <ParamSlider label="EMA Crossover Slow" value={P.scalp_emaSlowPeriod} min={12} max={30} step={1} onChange={v => onChange('scalp_emaSlowPeriod', v)} />
                        <h4 className="font-semibold text-sm -mb-2">Confluence Signals</h4>
                        <ParamSlider label="RSI Buy Threshold" value={P.scalp_rsiBuyThreshold} min={20} max={45} step={1} onChange={v => onChange('scalp_rsiBuyThreshold', v)} />
                        <ParamSlider label="RSI Sell Threshold" value={P.scalp_rsiSellThreshold} min={55} max={80} step={1} onChange={v => onChange('scalp_rsiSellThreshold', v)} />
                        <ParamSlider label="MACD Fast" value={P.macdFastPeriod} min={5} max={20} step={1} onChange={v => onChange('macdFastPeriod', v)} />
                        <ParamSlider label="MACD Slow" value={P.macdSlowPeriod} min={20} max={50} step={1} onChange={v => onChange('macdSlowPeriod', v)} />
                        <h4 className="font-semibold text-sm -mb-2">Scoring</h4>
                        <ParamSlider label="Score Threshold" value={P.scalp_scoreThreshold} min={10} max={20} step={1} onChange={v => onChange('scalp_scoreThreshold', v)} />
                    </> )
             case 5: case 6: // Smart Agent, Profit Locker
                return ( <>
                        <h4 className="font-semibold text-sm -mb-2">Core Logic</h4>
                        <ParamSlider label="SuperTrend Period" value={P.smart_superTrendPeriod} min={7} max={14} step={1} onChange={v => onChange('smart_superTrendPeriod', v)} />
                        <ParamSlider label="SuperTrend Multiplier" value={P.smart_superTrendMultiplier} min={1} max={5} step={0.1} onChange={v => onChange('smart_superTrendMultiplier', v)} />
                        <ParamSlider label="Confidence Threshold" value={P.smart_confidenceThreshold} min={0.5} max={1.0} step={0.05} onChange={v => onChange('smart_confidenceThreshold', v)} />
                         <h4 className="font-semibold text-sm -mb-2">Confluence Logic</h4>
                        <ParamSlider label="EMA Fast Period" value={P.smart_emaFastPeriod} min={5} max={15} step={1} onChange={v => onChange('smart_emaFastPeriod', v)} />
                        <ParamSlider label="EMA Slow Period" value={P.smart_emaSlowPeriod} min={18} max={30} step={1} onChange={v => onChange('smart_emaSlowPeriod', v)} />
                        <ParamSlider label="RSI Period" value={P.smart_rsiPeriod} min={7} max={21} step={1} onChange={v => onChange('smart_rsiPeriod', v)} />
                        <ParamSlider label="RSI Buy Threshold" value={P.smart_rsiBuyThreshold} min={55} max={70} step={1} onChange={v => onChange('smart_rsiBuyThreshold', v)} />
                        <ParamSlider label="RSI Sell Threshold" value={P.smart_rsiSellThreshold} min={30} max={45} step={1} onChange={v => onChange('smart_rsiSellThreshold', v)} />
                        <ParamSlider label="MACD Fast" value={P.macdFastPeriod} min={5} max={20} step={1} onChange={v => onChange('macdFastPeriod', v)} />
                        <ParamSlider label="MACD Slow" value={P.macdSlowPeriod} min={20} max={50} step={1} onChange={v => onChange('macdSlowPeriod', v)} />
                    </> )
            case 7: // Market Structure Maven
                return ( <>
                        <p className="text-xs text-center text-slate-500 dark:text-slate-400">This agent uses Price Action logic. Its primary parameter is a long-term EMA to establish a directional bias.</p>
                        <ParamSlider label="HTF Bias EMA Period" value={P.msm_htfEmaPeriod} min={100} max={400} step={10} onChange={v => onChange('msm_htfEmaPeriod', v)} />
                        <ParamSlider label="Swing Point Lookback" value={P.msm_swingPointLookback} min={2} max={10} step={1} onChange={v => onChange('msm_swingPointLookback', v)} />
                     </> )
            case 8: // Institutional Scalper
                return ( <>
                    <p className="text-xs text-center text-slate-500 dark:text-slate-400">Smart money concepts. No traditional indicators used.</p>
                    <ParamSlider label="Liquidity Lookback" value={P.inst_lookbackPeriod} min={3} max={15} step={1} onChange={v => onChange('inst_lookbackPeriod', v)} />
                    <ParamSlider label="Power Candle Multiplier" value={P.inst_powerCandleMultiplier} min={1.0} max={3.0} step={0.1} onChange={v => onChange('inst_powerCandleMultiplier', v)} />
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
            <td className="px-2 py-1.5 text-xs">{new Date(trade.exitTime).toLocaleString()}</td>
            <td className="px-2 py-1.5"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sideClass}`}>{trade.direction}</span></td>
            <td className="px-2 py-1.5 font-mono text-xs">{formatValue(trade.entryPrice)}</td>
            <td className="px-2 py-1.5 font-mono text-xs">{formatValue(trade.exitPrice)}</td>
            <td className="px-2 py-1.5 font-mono text-xs">${formatValue(trade.investedAmount)}</td>
            <td className={`px-2 py-1.5 font-mono text-xs font-bold ${pnlIsProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{pnlIsProfit ? '+' : ''}${formatValue(trade.pnl)}</td>
        </tr>
    );
};

export const BacktestingPanel: React.FC<BacktestingPanelProps> = (props) => {
    const { 
        backtestResult, setBacktestResult,
        optimizationResults, setOptimizationResults,
        setActiveView, onApplyConfig, theme
    } = props;
    
    const [localSelectedPair, setLocalSelectedPair] = useState('BTC/USDT');
    const [tradablePairs, setTradablePairs] = useState<string[]>(TRADING_PAIRS);
    const [localTimeFrame, setLocalTimeFrame] = useState('3m');
    const [localSelectedAgent, setLocalSelectedAgent] = useState<Agent>(AGENTS[AGENTS.length - 1]); // Default to last agent
    const [localTradingMode, setLocalTradingMode] = useState<TradingMode>(TradingMode.Spot);
    const [localLeverage, setLocalLeverage] = useState(10);
    const [localAgentParams, setLocalAgentParams] = useState<AgentParams>({});
    
    // New risk state
    const [localInvestmentAmount, setLocalInvestmentAmount] = useState(100);
    const [localStopLossMode, setLocalStopLossMode] = useState<RiskMode>(RiskMode.Percent);
    const [localStopLossValue, setLocalStopLossValue] = useState(2);
    const [localTakeProfitMode, setLocalTakeProfitMode] = useState<RiskMode>(RiskMode.Percent);
    const [localTakeProfitValue, setLocalTakeProfitValue] = useState(4);
    const [isLocalStopLossLocked, setIsLocalStopLossLocked] = useState(true);
    const [isLocalTakeProfitLocked, setIsLocalTakeProfitLocked] = useState(true);


    const [isParamsOpen, setIsParamsOpen] = useState(false);

    const [isLoading, setIsLoading] = useState(false);
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [optimizationProgress, setOptimizationProgress] = useState(0);
    const [candleLimit, setCandleLimit] = useState(1000);

    useEffect(() => {
        const fetchPairs = async () => {
            let pairFetcher: () => Promise<string[]>;
            switch(localTradingMode) {
                case TradingMode.Spot: pairFetcher = binanceService.fetchSpotPairs; break;
                case TradingMode.Margin: pairFetcher = binanceService.fetchMarginPairs; break;
                case TradingMode.USDSM_Futures: pairFetcher = binanceService.fetchFuturesPairs; break;
                default: pairFetcher = binanceService.fetchSpotPairs;
            }

            try {
                const pairs = await pairFetcher();
                 if (pairs.length > 0) {
                    setTradablePairs(pairs);
                    if (!pairs.includes(localSelectedPair)) {
                        setLocalSelectedPair(pairs[0] || 'BTC/USDT');
                    }
                }
            } catch (err) {
                console.error(`Could not fetch pairs for backtesting mode ${localTradingMode}:`, err);
                setTradablePairs(TRADING_PAIRS);
            }
        };
        fetchPairs();
    }, [localTradingMode, localSelectedPair]);


    const handleParamChange = (param: keyof AgentParams, value: number | boolean) => {
        setLocalAgentParams(prev => ({...prev, [param]: value}));
    };

    const runHighFidelityTest = async () => {
        const formattedPair = localSelectedPair.replace('/', '');
        // Fetch main timeframe candles first
        const mainKlines = await binanceService.fetchKlines(formattedPair, localTimeFrame, { limit: candleLimit });
        if (mainKlines.length < 200) {
            throw new Error("Not enough historical data for the main timeframe. Need at least 200 candles.");
        }
        
        // Fetch all 1-minute candles for the entire duration of the main klines
        const startTime = mainKlines[0].time;
        const intervalMs = mainKlines.length > 1 ? mainKlines[1].time - mainKlines[0].time : 0;
        const endTime = mainKlines[mainKlines.length - 1].time + intervalMs;
        const managementKlines = await binanceService.fetchFullKlines(formattedPair, '1m', startTime, endTime);

        if (managementKlines.length < mainKlines.length) {
             throw new Error(`High-fidelity data fetch failed. Got only ${managementKlines.length} 1-min candles for ${mainKlines.length} ${localTimeFrame} candles.`);
        }

        return { mainKlines, managementKlines };
    };

    const handleRunBacktest = async () => {
        setIsLoading(true); setError(null); setBacktestResult(null); setOptimizationResults(null);
        try {
            const { mainKlines, managementKlines } = await runHighFidelityTest();
            const config: BotConfig = {
                pair: localSelectedPair, timeFrame: localTimeFrame, agent: localSelectedAgent,
                executionMode: 'paper', // Backtesting is always paper
                investmentAmount: localInvestmentAmount, 
                stopLossMode: localStopLossMode, stopLossValue: localStopLossValue,
                takeProfitMode: localTakeProfitMode, takeProfitValue: localTakeProfitValue,
                isStopLossLocked: isLocalStopLossLocked, isTakeProfitLocked: isLocalTakeProfitLocked,
                leverage: localTradingMode === TradingMode.USDSM_Futures ? localLeverage : 1, 
                mode: localTradingMode,
                agentParams: localAgentParams
            };
            setBacktestResult(await runBacktest(mainKlines, managementKlines, config));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'An unknown error occurred during backtest.');
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleApplyAndSwitchView = (params: AgentParams) => {
        const config: BotConfig = {
            pair: localSelectedPair, mode: localTradingMode, 
            executionMode: 'paper', // Default to paper when applying
            leverage: localTradingMode === TradingMode.USDSM_Futures ? localLeverage : 1,
            agent: localSelectedAgent, timeFrame: localTimeFrame, 
            investmentAmount: localInvestmentAmount,
            stopLossMode: localStopLossMode, stopLossValue: localStopLossValue,
            takeProfitMode: localTakeProfitMode, takeProfitValue: localTakeProfitValue,
            isStopLossLocked: isLocalStopLossLocked, isTakeProfitLocked: isLocalTakeProfitLocked,
            agentParams: params,
        };
        onApplyConfig(config);
        setActiveView('trading');
    };

    const handleRunOptimization = async () => {
        setIsOptimizing(true); setError(null); setBacktestResult(null); setOptimizationResults([]); setOptimizationProgress(0);
        try {
            const { mainKlines, managementKlines } = await runHighFidelityTest();
            const config: BotConfig = {
                pair: localSelectedPair, timeFrame: localTimeFrame, agent: localSelectedAgent,
                executionMode: 'paper', // Backtesting is always paper
                investmentAmount: localInvestmentAmount,
                stopLossMode: localStopLossMode, stopLossValue: localStopLossValue,
                takeProfitMode: localTakeProfitMode, takeProfitValue: localTakeProfitValue,
                isStopLossLocked: isLocalStopLossLocked, isTakeProfitLocked: isLocalTakeProfitLocked,
                leverage: localTradingMode === TradingMode.USDSM_Futures ? localLeverage : 1, 
                mode: localTradingMode,
                agentParams: localAgentParams
            };
            await runOptimization(mainKlines, managementKlines, config, (progress) => {
                setOptimizationProgress(progress.percent);
                if (progress.result) {
                    setOptimizationResults(prev => [...(prev || []), progress.result!].sort((a, b) => b.result.totalPnl - a.result.totalPnl));
                }
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'An unknown error occurred during optimization.');
        } finally {
            setIsOptimizing(false); setOptimizationProgress(0);
        }
    };

    const renderSingleResult = () => {
        if (!backtestResult) return null;
        const pnlIsProfit = backtestResult.totalPnl >= 0;
        const winRateIsGood = backtestResult.winRate >= 50;

        return (
            <div className="mt-4 flex flex-col gap-4">
                <h3 className="font-bold text-lg">Backtest Results</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <ResultMetric label="Total PNL" value={`$${backtestResult.totalPnl.toFixed(2)}`} className={pnlIsProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}/>
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
        const anyLoading = isLoading || isOptimizing;

        if (error) return <div className="bg-rose-100 dark:bg-rose-900/50 border-l-4 border-rose-500 text-rose-700 dark:text-rose-300 p-4 rounded-r-lg">{error}</div>;
        if (anyLoading) return (
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow h-full flex flex-col justify-center items-center text-center">
                   <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500"></div>
                   <p className="text-slate-500 dark:text-slate-400 mt-3">{isOptimizing ? 'Running multiple simulations...' : `Fetching high-fidelity data...`}</p>
                   {isOptimizing && (
                        <div className="w-full max-w-sm mt-2 px-4">
                             <div className="w-full bg-slate-200 rounded-full h-2.5 dark:bg-slate-700">
                                <div className="bg-sky-600 h-2.5 rounded-full" style={{ width: `${optimizationProgress}%`}}></div>
                            </div>
                            <p className="text-sm font-semibold text-sky-500 mt-2">{optimizationProgress}%</p>
                        </div>
                   )}
               </div>
        );

        if (optimizationResults && optimizationResults.length > 0) return <OptimizationResults results={optimizationResults} onApplyAndSwitchView={handleApplyAndSwitchView} pricePrecision={2} />
        if (backtestResult) return renderSingleResult();

        return (
            <div className="h-full border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg flex flex-col justify-center items-center text-center">
                <FlaskIcon className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-2"/>
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">Run a Backtest or Optimization</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Configure your test on the left and see the results here.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 lg:col-span-4 xl:col-span-3">
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow">
                    <div className="p-3 border-b border-slate-200 dark:border-slate-700 font-semibold">Backtest Configuration</div>
                    <div className="p-4 flex flex-col gap-3">
                        <div className={formGroupClass}><label className={formLabelClass}>Market</label><SearchableDropdown theme={theme} options={tradablePairs} value={localSelectedPair} onChange={setLocalSelectedPair}/></div>
                        <div className={formGroupClass}><label className={formLabelClass}>Trading Mode</label><select value={localTradingMode} onChange={e => setLocalTradingMode(e.target.value as TradingMode)} className={formInputClass}>
                            {Object.values(TradingMode).filter(m => m !== TradingMode.Funding).map(mode => <option key={mode} value={mode}>{mode}</option>)}</select></div>
                        <div className={formGroupClass}><label className={formLabelClass}>Time Frame</label><select value={localTimeFrame} onChange={e => setLocalTimeFrame(e.target.value)} className={formInputClass}>{TIME_FRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}</select></div>
                        
                        <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-1"></div>
                        
                        <div className={formGroupClass}>
                            <label className={formLabelClass}>Investment Amount (USDT)</label>
                            <input type="number" value={localInvestmentAmount} onChange={e => setLocalInvestmentAmount(Number(e.target.value))} min="1" className={formInputClass} />
                        </div>
                         <div className="grid grid-cols-2 gap-4">
                            <RiskInputWithLock label="Stop Loss" mode={localStopLossMode} value={localStopLossValue} isLocked={isLocalStopLossLocked} onModeChange={setLocalStopLossMode} onValueChange={setLocalStopLossValue} onLockToggle={() => setIsLocalStopLossLocked(!isLocalStopLossLocked)} />
                            <RiskInputWithLock label="Take Profit" mode={localTakeProfitMode} value={localTakeProfitValue} isLocked={isLocalTakeProfitLocked} onModeChange={setLocalTakeProfitMode} onValueChange={setLocalTakeProfitValue} onLockToggle={() => setIsLocalTakeProfitLocked(!isLocalTakeProfitLocked)} />
                        </div>
                        {localTradingMode === TradingMode.USDSM_Futures && (
                            <ParamSlider label="Leverage" value={localLeverage} min={1} max={125} step={1} onChange={setLocalLeverage} />
                        )}
                        <ParamSlider label="Candle Limit" value={candleLimit} min={300} max={1500} step={50} onChange={setCandleLimit} />
                        
                        <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-1"></div>

                        <div className={formGroupClass}><label className={formLabelClass}>Trading Agent</label><select value={localSelectedAgent.id} onChange={e => setLocalSelectedAgent(AGENTS.find(a => a.id === Number(e.target.value))!)} className={formInputClass}>{AGENTS.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></div>

                        <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                             <button onClick={() => setIsParamsOpen(!isParamsOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold">
                                Customize Agent Logic
                                {isParamsOpen ? <ChevronUp className="w-5 h-5"/> : <ChevronDown className="w-5 h-5"/>}
                            </button>
                            {isParamsOpen && (
                                <div className="p-3 border-t border-slate-200 dark:border-slate-600 flex flex-col gap-4">
                                    <AgentParameterEditor agent={localSelectedAgent} params={localAgentParams} onChange={handleParamChange} />
                                    <button onClick={() => setLocalAgentParams({})} className="text-xs text-sky-600 hover:underline self-start">Reset Agent Logic Params</button>
                                </div>
                            )}
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={handleRunBacktest} disabled={isLoading || isOptimizing} className={`${buttonClass} bg-sky-600 hover:bg-sky-700 disabled:bg-slate-400`}><FlaskIcon className="w-5 h-5" />Backtest</button>
                            <button onClick={handleRunOptimization} disabled={isLoading || isOptimizing} className={`${buttonClass} bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400`}><SparklesIcon className="w-5 h-5" />Optimize</button>
                        </div>
                    </div>
                </div>
            </div>
            <div className="col-span-12 lg:col-span-8 xl:col-span-9">
                {renderRightPanelContent()}
            </div>
        </div>
    );
};