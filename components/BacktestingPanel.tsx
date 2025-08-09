



import React, { useState, useEffect } from 'react';
import { Agent, BotConfig, BacktestResult, TradingMode, AgentParams, Kline, SimulatedTrade, RiskMode } from '../types';
import * as constants from '../constants';
import * as binanceService from './../services/binanceService';
import { runBacktest } from '../services/backtestingService';
import { getInitialAgentTargets } from '../services/localAgentService';
import { FlaskIcon, ChevronUp, ChevronDown, LockIcon, UnlockIcon } from './icons';
import { SearchableDropdown } from './SearchableDropdown';

interface BacktestingPanelProps {
    backtestResult: BacktestResult | null;
    setBacktestResult: (result: BacktestResult | null) => void;
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


const AgentParameterEditor: React.FC<{agent: Agent, params: AgentParams, onChange: (p: keyof AgentParams, v: number | boolean) => void}> = ({ agent, params, onChange }) => {
    const P = { ...constants.DEFAULT_AGENT_PARAMS, ...params };
    
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
                        <ParamSlider label="Volume SMA Period" value={P.mom_volumeSmaPeriod} min={10} max={30} step={1} onChange={v => onChange('mom_volumeSmaPeriod', v)} />
                        <ParamSlider label="Volume Multiplier" value={P.mom_volumeMultiplier} min={1.1} max={3.0} step={0.1} onChange={v => onChange('mom_volumeMultiplier', v)} />
                    </> );
             case 4: // Scalping Expert
             case 6: // Profit Locker (uses Scalping Expert logic)
                return ( <>
                    <p className="text-xs text-center text-slate-500 dark:text-slate-400">Score-based scalper. A trade is triggered when the combined score of indicators exceeds the threshold.</p>
                    <ParamSlider label="Score Threshold" value={P.scalp_scoreThreshold} min={2} max={5} step={1} onChange={v => onChange('scalp_scoreThreshold', v)} />
                    <h4 className="font-semibold text-sm -mb-2">Indicator Settings</h4>
                    <ParamSlider label="EMA Period" value={P.scalp_emaPeriod} min={20} max={100} step={5} onChange={v => onChange('scalp_emaPeriod', v)} />
                    <ParamSlider label="SuperTrend Period" value={P.scalp_superTrendPeriod} min={7} max={14} step={1} onChange={v => onChange('scalp_superTrendPeriod', v)} />
                    <ParamSlider label="SuperTrend Multiplier" value={P.scalp_superTrendMultiplier} min={1} max={4} step={0.25} onChange={v => onChange('scalp_superTrendMultiplier', v)} />
                    <ParamSlider label="PSAR Step" value={P.scalp_psarStep} min={0.01} max={0.05} step={0.01} onChange={v => onChange('scalp_psarStep', v)} />
                    <ParamSlider label="PSAR Max" value={P.scalp_psarMax} min={0.1} max={0.5} step={0.05} onChange={v => onChange('scalp_psarMax', v)} />
                    <ParamSlider label="StochRSI Oversold" value={P.scalp_stochRsiOversold} min={10} max={30} step={1} onChange={v => onChange('scalp_stochRsiOversold', v)} />
                    <ParamSlider label="StochRSI Overbought" value={P.scalp_stochRsiOverbought} min={70} max={90} step={1} onChange={v => onChange('scalp_stochRsiOverbought', v)} />
                </> )
             case 5: // Market Phase Adaptor
                return ( <>
                        <p className="text-xs text-center text-slate-500 dark:text-slate-400">This agent adapts its strategy to the market phase.</p>
                        <h4 className="font-semibold text-sm -mb-2">Phase Detection</h4>
                        <ParamSlider label="ADX Trend Level" value={P.mpa_adxTrend!} min={20} max={30} step={1} onChange={v => onChange('mpa_adxTrend', v)} />
                        <ParamSlider label="ADX Chop Level" value={P.mpa_adxChop!} min={15} max={25} step={1} onChange={v => onChange('mpa_adxChop', v)} />
                        <ParamSlider label="BBW Squeeze Level" value={P.mpa_bbwSqueeze!} min={0.01} max={0.05} step={0.005} onChange={v => onChange('mpa_bbwSqueeze', v)} />
                        <h4 className="font-semibold text-sm -mb-2">Trending Strategy</h4>
                        <ParamSlider label="Trend EMA Fast" value={P.mpa_trendEmaFast!} min={10} max={30} step={1} onChange={v => onChange('mpa_trendEmaFast', v)} />
                        <ParamSlider label="Trend EMA Slow" value={P.mpa_trendEmaSlow!} min={40} max={60} step={2} onChange={v => onChange('mpa_trendEmaSlow', v)} />
                        <h4 className="font-semibold text-sm -mb-2">Ranging Strategy</h4>
                        <ParamSlider label="Range BB Period" value={P.mpa_rangeBBPeriod!} min={15} max={30} step={1} onChange={v => onChange('mpa_rangeBBPeriod', v)} />
                        <ParamSlider label="Range BB StdDev" value={P.mpa_rangeBBStdDev!} min={1.8} max={2.5} step={0.1} onChange={v => onChange('mpa_rangeBBStdDev', v)} />
                        <ParamSlider label="Range RSI Oversold" value={P.mpa_rangeRsiOversold!} min={25} max={40} step={1} onChange={v => onChange('mpa_rangeRsiOversold', v)} />
                        <ParamSlider label="Range RSI Overbought" value={P.mpa_rangeRsiOverbought!} min={60} max={75} step={1} onChange={v => onChange('mpa_rangeRsiOverbought', v)} />
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
            case 9: // Quantum Scalper
                 return ( <>
                    <p className="text-xs text-center text-slate-500 dark:text-slate-400">Adaptive scalper. Uses regime detection and a PSAR trailing stop for exits.</p>
                    <h4 className="font-semibold text-sm -mb-2">Regime Detection</h4>
                    <ParamSlider label="Fast EMA" value={P.qsc_fastEmaPeriod!} min={5} max={15} step={1} onChange={v => onChange('qsc_fastEmaPeriod', v)} />
                    <ParamSlider label="Slow EMA" value={P.qsc_slowEmaPeriod!} min={18} max={30} step={1} onChange={v => onChange('qsc_slowEmaPeriod', v)} />
                    <ParamSlider label="ADX Threshold" value={P.qsc_adxThreshold!} min={15} max={40} step={1} onChange={v => onChange('qsc_adxThreshold', v)} />
                    <h4 className="font-semibold text-sm -mb-2">Entry Scoring</h4>
                    <ParamSlider label="Trend Score Threshold" value={P.qsc_trendScoreThreshold!} min={2} max={4} step={1} onChange={v => onChange('qsc_trendScoreThreshold', v)} />
                    <ParamSlider label="Range Score Threshold" value={P.qsc_rangeScoreThreshold!} min={1} max={3} step={1} onChange={v => onChange('qsc_rangeScoreThreshold', v)} />
                    <ParamSlider label="StochRSI Oversold" value={P.qsc_stochRsiOversold!} min={20} max={35} step={1} onChange={v => onChange('qsc_stochRsiOversold', v)} />
                    <ParamSlider label="StochRSI Overbought" value={P.qsc_stochRsiOverbought!} min={65} max={80} step={1} onChange={v => onChange('qsc_stochRsiOverbought', v)} />
                    <h4 className="font-semibold text-sm -mb-2">Risk & Exit</h4>
                    <ParamSlider label="Initial SL (ATR Mult)" value={P.qsc_atrMultiplier!} min={1.0} max={3.0} step={0.1} onChange={v => onChange('qsc_atrMultiplier', v)} />
                    <ParamSlider label="PSAR Trail Step" value={P.qsc_psarStep!} min={0.01} max={0.05} step={0.005} onChange={v => onChange('qsc_psarStep', v)} />
                    <ParamSlider label="PSAR Trail Max" value={P.qsc_psarMax!} min={0.1} max={0.3} step={0.01} onChange={v => onChange('qsc_psarMax', v)} />
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
        setActiveView, onApplyConfig, theme
    } = props;
    
    const [localSelectedPair, setLocalSelectedPair] = useState('BTC/USDT');
    const [tradablePairs, setTradablePairs] = useState<string[]>(constants.TRADING_PAIRS);
    const [localTimeFrame, setLocalTimeFrame] = useState('3m');
    const [localSelectedAgent, setLocalSelectedAgent] = useState<Agent>(constants.AGENTS.find(a => a.id === 9)!); // Default to Quantum Scalper
    const [localTradingMode, setLocalTradingMode] = useState<TradingMode>(TradingMode.Spot);
    const [localLeverage, setLocalLeverage] = useState(10);
    const [localAgentParams, setLocalAgentParams] = useState<AgentParams>({});
    
    const [localInvestmentAmount, setLocalInvestmentAmount] = useState(100);
    const [localStopLossMode, setLocalStopLossMode] = useState<RiskMode>(RiskMode.Percent);
    const [localStopLossValue, setLocalStopLossValue] = useState<number>(2);
    const [localTakeProfitMode, setLocalTakeProfitMode] = useState<RiskMode>(RiskMode.Percent);
    const [localTakeProfitValue, setLocalTakeProfitValue] = useState<number>(4);
    const [isLocalStopLossLocked, setIsLocalStopLossLocked] = useState<boolean>(false);
    const [isLocalTakeProfitLocked, setIsLocalTakeProfitLocked] = useState<boolean>(false);
    const [isLocalCooldownEnabled, setIsLocalCooldownEnabled] = useState(false);
    const [localMinimumGrossProfit, setLocalMinimumGrossProfit] = useState<number>(1.0);


    const [isParamsOpen, setIsParamsOpen] = useState(false);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [testPeriodDays, setTestPeriodDays] = useState(30);

    useEffect(() => {
        const fetchPairs = async () => {
            let pairFetcher: () => Promise<string[]>;
            switch(localTradingMode) {
                case TradingMode.Spot: pairFetcher = binanceService.fetchSpotPairs; break;
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
                setTradablePairs(constants.TRADING_PAIRS);
            }
        };
        fetchPairs();
    }, [localTradingMode, localSelectedPair]);

    useEffect(() => {
        const updateSmartTargets = () => {
            if (props.klines.length < 50 || (!isLocalStopLossLocked || !isLocalTakeProfitLocked)) return;

            const currentPrice = props.klines[props.klines.length - 1].close;
            if (currentPrice <= 0) return;
            
            const timeframeAdaptiveParams = constants.TIMEFRAME_ADAPTIVE_SETTINGS[localTimeFrame] || {};
            const finalParams: Required<AgentParams> = { ...constants.DEFAULT_AGENT_PARAMS, ...timeframeAdaptiveParams, ...localAgentParams };

            const longTargets = getInitialAgentTargets(props.klines, currentPrice, 'LONG', localTimeFrame, finalParams, localSelectedAgent.id);
            
            const stopDistance = currentPrice - longTargets.stopLossPrice;
            const profitDistance = longTargets.takeProfitPrice - currentPrice;

            if (!isLocalStopLossLocked) {
                let newSlValue: number;
                if (localStopLossMode === RiskMode.Percent) {
                    newSlValue = (stopDistance / currentPrice) * 100;
                } else { // Amount
                    newSlValue = localInvestmentAmount * (stopDistance / currentPrice);
                }
                setLocalStopLossValue(parseFloat(newSlValue.toFixed(2)));
            }
            
            if (!isLocalTakeProfitLocked) {
                let newTpValue: number;
                if (localTakeProfitMode === RiskMode.Percent) {
                    newTpValue = (profitDistance / currentPrice) * 100;
                } else { // Amount
                    newTpValue = localInvestmentAmount * (profitDistance / currentPrice);
                }
                setLocalTakeProfitValue(parseFloat(newTpValue.toFixed(2)));
            }
        };

        updateSmartTargets();
    }, [
        props.klines, isLocalStopLossLocked, isLocalTakeProfitLocked, localSelectedAgent, localTimeFrame, localAgentParams, 
        localInvestmentAmount, localStopLossMode, localTakeProfitMode, setLocalStopLossValue, setLocalTakeProfitValue
    ]);


    const handleParamChange = (param: keyof AgentParams, value: number | boolean) => {
        setLocalAgentParams(prev => ({...prev, [param]: value}));
    };

    const runHighFidelityTest = async (testRunner: (mainKlines: Kline[], mgmtKlines: Kline[], config: BotConfig) => Promise<any>) => {
        const formattedPair = localSelectedPair.replace('/', '');
        
        // Fetch symbol info for precision data
        const symbolInfo = localTradingMode === TradingMode.USDSM_Futures
            ? await binanceService.getFuturesSymbolInfo(formattedPair)
            : await binanceService.getSymbolInfo(formattedPair);
        
        if (!symbolInfo) {
            throw new Error(`Could not fetch symbol info for ${localSelectedPair} to run backtest.`);
        }
        
        const timeframeDurationMs = getTimeframeDuration(localTimeFrame);
        if (timeframeDurationMs === 0) {
            throw new Error("Invalid timeframe selected.");
        }
        const totalMsInPeriod = testPeriodDays * 24 * 60 * 60 * 1000;
        const candleLimit = Math.ceil(totalMsInPeriod / timeframeDurationMs);

        // Fetch main timeframe klines for the calculated period
        const mainKlines = await binanceService.fetchKlines(formattedPair, localTimeFrame, { limit: Math.min(candleLimit, 1500) });
        if (mainKlines.length < 200) {
            throw new Error("Not enough historical data for a meaningful backtest. Need at least 200 candles.");
        }
        
        // 2. Determine the full time range from the main klines
        const startTime = mainKlines[0].time;
        const endTime = mainKlines[mainKlines.length - 1].time + getTimeframeDuration(localTimeFrame) - 1;

        // 3. Fetch all 1-minute klines for that exact range
        const managementKlines = await binanceService.fetchFullKlines(formattedPair, '1m', startTime, endTime);
        if (managementKlines.length === 0) {
            throw new Error("Could not fetch 1-minute management klines for the selected period.");
        }

        const config: BotConfig = {
            pair: localSelectedPair, timeFrame: localTimeFrame, agent: localSelectedAgent,
            executionMode: 'paper',
            investmentAmount: localInvestmentAmount,
            stopLossMode: localStopLossMode, stopLossValue: localStopLossValue,
            takeProfitMode: localTakeProfitMode, takeProfitValue: localTakeProfitValue,
            isStopLossLocked: isLocalStopLossLocked, isTakeProfitLocked: isLocalTakeProfitLocked,
            isCooldownEnabled: isLocalCooldownEnabled,
            minimumGrossProfit: localMinimumGrossProfit,
            leverage: localTradingMode === TradingMode.USDSM_Futures ? localLeverage : 1, 
            mode: localTradingMode,
            agentParams: localAgentParams,
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
    
    const handleApplyCurrentConfig = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const formattedPair = localSelectedPair.replace('/', '');
            const symbolInfo = localTradingMode === TradingMode.USDSM_Futures
                ? await binanceService.getFuturesSymbolInfo(formattedPair)
                : await binanceService.getSymbolInfo(formattedPair);
            
            if (!symbolInfo) {
                throw new Error(`Could not fetch symbol info for ${localSelectedPair} to apply configuration.`);
            }

            const config: BotConfig = {
                pair: localSelectedPair, mode: localTradingMode, 
                executionMode: 'paper',
                leverage: localTradingMode === TradingMode.USDSM_Futures ? localLeverage : 1,
                agent: localSelectedAgent, timeFrame: localTimeFrame, 
                investmentAmount: localInvestmentAmount,
                stopLossMode: localStopLossMode, stopLossValue: localStopLossValue,
                takeProfitMode: localTakeProfitMode, takeProfitValue: localTakeProfitValue,
                isStopLossLocked: isLocalStopLossLocked, isTakeProfitLocked: isLocalTakeProfitLocked,
                isCooldownEnabled: isLocalCooldownEnabled,
                minimumGrossProfit: localMinimumGrossProfit,
                agentParams: localAgentParams,
                pricePrecision: binanceService.getPricePrecision(symbolInfo),
                quantityPrecision: binanceService.getQuantityPrecision(symbolInfo),
                stepSize: binanceService.getStepSize(symbolInfo),
            };
            onApplyConfig(config);
            setActiveView('trading');
        } catch(e) {
            setError(e instanceof Error ? e.message : 'An unknown error occurred while applying config.');
        } finally {
            setIsLoading(false);
        }
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
                        onClick={handleApplyCurrentConfig}
                        className="px-4 py-2 bg-sky-600 text-white font-semibold rounded-md shadow-sm hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500"
                    >
                        Use This Configuration
                    </button>
                </div>
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

    return (
        <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 lg:col-span-4 xl:col-span-3">
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow">
                    <div className="p-3 border-b border-slate-200 dark:border-slate-700 font-semibold">Backtest Configuration</div>
                    <div className="p-4 flex flex-col gap-3">
                        <div className={formGroupClass}><label className={formLabelClass}>Market</label><SearchableDropdown theme={theme} options={tradablePairs} value={localSelectedPair} onChange={setLocalSelectedPair}/></div>
                        <div className={formGroupClass}>
                            <label className={formLabelClass}>Trading Mode</label>
                            <select value={localTradingMode} onChange={e => setLocalTradingMode(e.target.value as TradingMode)} className={formInputClass}>
                                {Object.values(TradingMode).map(mode => <option key={mode} value={mode}>{mode}</option>)}
                            </select>
                        </div>
                        <div className={formGroupClass}><label className={formLabelClass}>Time Frame</label><select value={localTimeFrame} onChange={e => setLocalTimeFrame(e.target.value)} className={formInputClass}>{constants.TIME_FRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}</select></div>
                        
                        <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-1"></div>
                        
                        <div className={formGroupClass}>
                            <label className={formLabelClass}>Investment Amount (USDT)</label>
                            <input type="number" value={localInvestmentAmount} onChange={e => setLocalInvestmentAmount(Number(e.target.value))} min="1" className={formInputClass} />
                        </div>
                         <div className="grid grid-cols-2 gap-4">
                            <RiskInputWithLock label="Stop Loss" mode={localStopLossMode} value={localStopLossValue} isLocked={isLocalStopLossLocked} investmentAmount={localInvestmentAmount} onModeChange={setLocalStopLossMode} onValueChange={setLocalStopLossValue} onLockToggle={() => setIsLocalStopLossLocked(!isLocalStopLossLocked)} />
                            <RiskInputWithLock label="Take Profit" mode={localTakeProfitMode} value={localTakeProfitValue} isLocked={isLocalTakeProfitLocked} investmentAmount={localInvestmentAmount} onModeChange={setLocalTakeProfitMode} onValueChange={setLocalTakeProfitValue} onLockToggle={() => setIsLocalTakeProfitLocked(!isLocalTakeProfitLocked)} />
                        </div>
                        <div className={formGroupClass}>
                            <label htmlFor="min-gross-profit" className={formLabelClass}>Minimum Gross Profit ($)</label>
                            <input type="number" id="min-gross-profit" value={localMinimumGrossProfit} onChange={e => setLocalMinimumGrossProfit(Number(e.target.value))} min="0" step="0.1" className={formInputClass} />
                        </div>
                        {localTradingMode === TradingMode.USDSM_Futures && (
                            <ParamSlider label="Leverage" value={localLeverage} min={1} max={125} step={1} onChange={setLocalLeverage} />
                        )}
                        <ParamSlider label="Test Period (Days)" value={testPeriodDays} min={1} max={180} step={1} onChange={setTestPeriodDays} />

                        <div className={formGroupClass}>
                            <div className="flex items-center justify-between">
                                <label htmlFor="cooldown-toggle" className={formLabelClass}>
                                    Post-Profit Cooldown
                                </label>
                                <ToggleSwitch
                                    checked={isLocalCooldownEnabled}
                                    onChange={setIsLocalCooldownEnabled}
                                />
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                If enabled, bot enters a persistent cautious state after a profit. It analyzes the next trade opportunity for trend exhaustion to protect gains.
                            </p>
                        </div>
                        
                        <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-1"></div>

                        <div className={formGroupClass}><label className={formLabelClass}>Trading Agent</label><select value={localSelectedAgent.id} onChange={e => setLocalSelectedAgent(constants.AGENTS.find(a => a.id === Number(e.target.value))!)} className={formInputClass}>{constants.AGENTS.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></div>

                        <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                             <button onClick={() => setIsParamsOpen(!isParamsOpen)} className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200">
                                Customize Agent Logic
                                {isParamsOpen ? <ChevronUp className="w-5 h-5"/> : <ChevronDown className="w-5 h-5"/>}
                            </button>
                            {isParamsOpen && (
                                <div className="p-3 border-t border-slate-200 dark:border-slate-600 flex flex-col gap-4">
                                    <AgentParameterEditor agent={localSelectedAgent} params={localAgentParams} onChange={handleParamChange} />
                                    <button onClick={() => setLocalAgentParams({})} className="text-xs text-sky-600 dark:text-sky-400 hover:underline self-start">Reset Agent Logic Params</button>
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