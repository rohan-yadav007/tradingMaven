


import React, { useState } from 'react';
import { TradingMode, Agent, Kline, AgentParams, RiskMode } from '../types';
import { TIME_FRAMES, AGENTS } from '../constants';
import { PlayIcon, ChevronDown, ChevronUp, SparklesIcon, LockIcon, UnlockIcon } from './icons';
import { AnalysisPreview } from './AnalysisPreview';
import * as binanceService from './../services/binanceService';
import { SearchableDropdown } from './SearchableDropdown';

interface ControlPanelProps {
    executionMode: 'live' | 'paper';
    setExecutionMode: (mode: 'live' | 'paper') => void;
    availableBalance: number;
    tradingMode: TradingMode;
    setTradingMode: (mode: TradingMode) => void;
    allPairs: string[];
    selectedPair: string;
    setSelectedPair: (pair: string) => void;
    leverage: number;
    setLeverage: (leverage: number) => void;
    marginType: 'ISOLATED' | 'CROSSED';
    setMarginType: (type: 'ISOLATED' | 'CROSSED') => void;
    futuresSettingsError: string | null;
    isMultiAssetMode: boolean;
    onSetMultiAssetMode: (isEnabled: boolean) => void;
    multiAssetModeError: string | null;
    investmentAmount: number;
    setInvestmentAmount: (amount: number) => void;
    stopLossMode: RiskMode;
    setStopLossMode: (mode: RiskMode) => void;
    stopLossValue: number;
    setStopLossValue: (value: number) => void;
    takeProfitMode: RiskMode;
    setTakeProfitMode: (mode: RiskMode) => void;
    takeProfitValue: number;
    setTakeProfitValue: (value: number) => void;
    isStopLossLocked: boolean;
    setIsStopLossLocked: (locked: boolean) => void;
    isTakeProfitLocked: boolean;
    setIsTakeProfitLocked: (locked: boolean) => void;
    timeFrame: string;
    setTimeFrame: (timeFrame: string) => void;
    selectedAgent: Agent;
    setSelectedAgent: (agent: Agent) => void;
    onStartBot: () => void;
    klines: Kline[];
    isBotCombinationActive: boolean;
    agentParams: AgentParams;
    setAgentParams: (params: AgentParams | ((p: AgentParams) => AgentParams)) => void;
    theme: 'light' | 'dark';
}

const formGroupClass = "flex flex-col gap-1.5";
const formLabelClass = "text-sm font-medium text-slate-700 dark:text-slate-300";
const formInputClass = "w-full px-3 py-2 bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-colors";
const buttonClass = "w-full flex items-center justify-center gap-2 px-4 py-2.5 text-white font-semibold rounded-md shadow-sm transition-colors duration-200";
const primaryButtonClass = `${buttonClass} bg-sky-600 hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 focus:ring-offset-slate-50 dark:focus:ring-offset-slate-800 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed`;

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
                    className={`px-3 bg-slate-100 dark:bg-slate-600 border border-r-0 border-slate-300 dark:border-slate-600 rounded-l-md hover:bg-slate-200 dark:hover:bg-slate-500 transition-colors ${!isLocked ? 'text-sky-500' : 'text-slate-400'}`}
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
                    className="px-3 bg-slate-100 dark:bg-slate-600 border border-l-0 border-slate-300 dark:border-slate-600 rounded-r-md font-bold text-sm hover:bg-slate-200 dark:hover:bg-slate-500 transition-colors"
                    aria-label={`Switch to ${nextMode} mode`}
                >
                   {mode === RiskMode.Percent ? '$' : '%'}
                </button>
            </div>
        </div>
    );
};

export const ControlPanel: React.FC<ControlPanelProps> = (props) => {
    const {
        executionMode, setExecutionMode, availableBalance,
        tradingMode, setTradingMode, allPairs, selectedPair, setSelectedPair,
        leverage, setLeverage, timeFrame, setTimeFrame, selectedAgent, setSelectedAgent,
        onStartBot, klines, isBotCombinationActive, investmentAmount, setInvestmentAmount,
        stopLossMode, setStopLossMode, stopLossValue, setStopLossValue,
        takeProfitMode, setTakeProfitMode, takeProfitValue, setTakeProfitValue,
        isStopLossLocked, setIsStopLossLocked, isTakeProfitLocked, setIsTakeProfitLocked,
        agentParams, setAgentParams, theme, marginType, setMarginType, futuresSettingsError,
        isMultiAssetMode, onSetMultiAssetMode, multiAssetModeError
    } = props;
    
    const [maxLeverage, setMaxLeverage] = useState(125);
    const [isLeverageLoading, setIsLeverageLoading] = useState(false);
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

    const isInvestmentInvalid = executionMode === 'live' && investmentAmount > availableBalance;

    React.useEffect(() => {
        if (tradingMode === TradingMode.USDSM_Futures) {
            setIsLeverageLoading(true);
            binanceService.fetchFuturesLeverageBrackets(selectedPair)
                .then(bracketInfo => {
                    if (bracketInfo && bracketInfo.brackets.length > 0) {
                        const maxLeverageBracket = bracketInfo.brackets.find(b => b.initialLeverage > 1);
                        const max = maxLeverageBracket ? maxLeverageBracket.initialLeverage : 125;
                        setMaxLeverage(max);
                        if (leverage > max) {
                            setLeverage(max);
                        }
                    } else {
                        setMaxLeverage(125); // Fallback if no specific bracket found
                    }
                })
                .catch(err => {
                    console.error("Could not fetch leverage brackets", err);
                    setMaxLeverage(125); // fallback
                })
                .finally(() => setIsLeverageLoading(false));
        }
    }, [selectedPair, tradingMode, leverage, setLeverage]);

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
            
            <div className={formGroupClass}>
                <label htmlFor="market-pair" className={formLabelClass}>Market</label>
                <SearchableDropdown
                    options={allPairs}
                    value={selectedPair}
                    onChange={setSelectedPair}
                    theme={theme}
                />
            </div>
            
            <div className={formGroupClass}>
                <label htmlFor="time-frame" className={formLabelClass}>Time Frame</label>
                <select id="time-frame" value={timeFrame} onChange={e => setTimeFrame(e.target.value)} className={formInputClass}>
                    {TIME_FRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                </select>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>
            
             <div className={formGroupClass}>
                <div className="flex justify-between items-baseline">
                    <label htmlFor="investment-amount" className={formLabelClass}>
                        Investment Amount
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

            <div className="grid grid-cols-2 gap-4">
                <RiskInputWithLock
                    label="Stop Loss"
                    mode={stopLossMode}
                    value={stopLossValue}
                    isLocked={isStopLossLocked}
                    onModeChange={setStopLossMode}
                    onValueChange={setStopLossValue}
                    onLockToggle={() => setIsStopLossLocked(!isStopLossLocked)}
                />
                <RiskInputWithLock
                    label="Take Profit"
                    mode={takeProfitMode}
                    value={takeProfitValue}
                    isLocked={isTakeProfitLocked}
                    onModeChange={setTakeProfitMode}
                    onValueChange={setTakeProfitValue}
                    onLockToggle={() => setIsTakeProfitLocked(!isTakeProfitLocked)}
                />
            </div>
            
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
                        <label className={formLabelClass}>Pair Margin Type</label>
                        <div className="flex items-center gap-2 p-1 bg-slate-200 dark:bg-slate-700/50 rounded-md">
                            <button disabled={isMultiAssetMode} onClick={() => setMarginType('ISOLATED')} className={`flex-1 text-center text-sm font-semibold p-1.5 rounded-md transition-colors ${marginType === 'ISOLATED' ? 'bg-white dark:bg-slate-600 shadow text-sky-600 dark:text-sky-300' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'} disabled:opacity-50 disabled:cursor-not-allowed`}>Isolated</button>
                            <button disabled={isMultiAssetMode} onClick={() => setMarginType('CROSSED')} className={`flex-1 text-center text-sm font-semibold p-1.5 rounded-md transition-colors ${marginType === 'CROSSED' ? 'bg-white dark:bg-slate-600 shadow text-sky-600 dark:text-sky-300' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'} disabled:opacity-50 disabled:cursor-not-allowed`}>Cross</button>
                        </div>
                        {isMultiAssetMode && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Pair margin is set to Cross when Multi-Asset Mode is active.</p>}
                        {futuresSettingsError && (
                            <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">{futuresSettingsError}</p>
                        )}
                    </div>
                    <div className={formGroupClass}>
                        <label htmlFor="leverage-slider" className={formLabelClass}>Leverage: <span className="font-bold text-sky-500">{leverage}x</span></label>
                        <input
                            id="leverage-slider"
                            type="range"
                            min="1"
                            max={maxLeverage}
                            step="1"
                            value={leverage}
                            onChange={e => setLeverage(Number(e.target.value))}
                            disabled={isLeverageLoading}
                            className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>
                </>
            )}
            
            <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>

            <div className={formGroupClass}>
                <label htmlFor="trading-agent" className={formLabelClass}>Trading Agent</label>
                 <select id="trading-agent" value={selectedAgent.id} onChange={e => setSelectedAgent(AGENTS.find(a => a.id === Number(e.target.value))!)} className={formInputClass}>
                    {AGENTS.map(agent => (
                        <option key={agent.id} value={agent.id}>{agent.name}</option>
                    ))}
                </select>
            </div>
            
            <div className="text-xs text-slate-500 dark:text-slate-400 p-3 bg-slate-100 dark:bg-slate-800/50 rounded-md">
                <p className="font-semibold text-slate-700 dark:text-slate-200">{selectedAgent.name}</p>
                <p>{selectedAgent.description}</p>
            </div>

            <AnalysisPreview
                klines={klines}
                selectedPair={selectedPair}
                timeFrame={timeFrame}
                selectedAgent={selectedAgent}
                agentParams={agentParams}
            />

            <div className="border-t border-slate-200 dark:border-slate-700 -mx-4"></div>

            <div className="bg-slate-100 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700/50">
                <button
                    onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                    className="w-full flex justify-between items-center p-3 text-left"
                >
                    <div className="flex items-center gap-2">
                        <SparklesIcon className="w-5 h-5 text-sky-500"/>
                        <span className="font-semibold text-slate-700 dark:text-slate-200">Customize Agent Logic</span>
                    </div>
                    {isAdvancedOpen ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
                </button>
                {isAdvancedOpen && (
                    <div className="mt-2 p-3 border-t border-slate-200 dark:border-slate-700 space-y-4">
                       {/* Agent-specific parameters will be added here as needed */}
                       <p className="text-xs text-center text-slate-500">Agent-specific logic parameters can be configured in the Backtesting panel.</p>
                    </div>
                )}
            </div>
            
            <button
                onClick={onStartBot}
                disabled={isBotCombinationActive || klines.length < 50 || isInvestmentInvalid}
                title={isBotCombinationActive ? "A bot with this exact configuration (pair, timeframe, agent) is already running." : (klines.length < 50 ? "Not enough market data to start." : (isInvestmentInvalid ? "Investment exceeds available balance." : "Start Trading Bot"))}
                className={primaryButtonClass}
            >
                <PlayIcon className="w-5 h-5" />
                {isBotCombinationActive ? 'Bot Running' : 'Start Bot'}
            </button>
        </div>
    );
};