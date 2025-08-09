

import React, { useState, useEffect, useRef } from 'react';
import { TradingMode, Kline, RiskMode, TradeSignal, AgentParams } from '../types';
import * as constants from '../constants';
import { PlayIcon, LockIcon, UnlockIcon, CpuIcon, ChevronDown, ChevronUp } from './icons';
import { AnalysisPreview } from './AnalysisPreview';
import * as binanceService from './../services/binanceService';
import { getTradingSignal, getInitialAgentTargets } from '../services/localAgentService';
import { SearchableDropdown } from './SearchableDropdown';
import { useTradingConfigState, useTradingConfigActions } from '../contexts/TradingConfigContext';

interface ControlPanelProps {
    onStartBot: () => void;
    isBotCombinationActive: boolean;
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
        className={`${checked ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800`}
    >
        <span
            aria-hidden="true"
            className={`${checked ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
        />
    </button>
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
    }, [value, mode]); // Reset input when props change from outside

    const handleToggleMode = () => {
        const currentValue = parseFloat(inputValue);
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
            // Revert to original value if input is invalid
            setInputValue(String(value));
         }
    };
    
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
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        onBlur={handleBlur}
                        className={`${formInputClass} pl-7 rounded-none`}
                        min="0"
                    />
                </div>
                <button
                    onClick={handleToggleMode}
                    className="px-3 bg-slate-100 dark:bg-slate-600 border border-l-0 border-slate-300 dark:border-slate-600 rounded-r-md font-bold text-sm hover:bg-slate-200 dark:hover:bg-slate-500 transition-colors"
                    aria-label={`Switch to ${mode === RiskMode.Percent ? 'PNL Amount ($)' : 'Percentage (%)'}`}
                    title={`Switch to ${mode === RiskMode.Percent ? 'PNL Amount ($)' : 'Percentage (%)'}`}
                >
                   {mode === RiskMode.Percent ? '$' : '%'}
                </button>
            </div>
        </div>
    );
};

export const ControlPanel: React.FC<ControlPanelProps> = (props) => {
    const {
        onStartBot, isBotCombinationActive, theme, klines
    } = props;
    
    const {
        executionMode, availableBalance, tradingMode, allPairs, selectedPair,
        leverage, chartTimeFrame: timeFrame, selectedAgent, investmentAmount,
        takeProfitMode, takeProfitValue,
        isTakeProfitLocked, isCooldownEnabled, agentParams,
        marginType, futuresSettingsError, isMultiAssetMode, multiAssetModeError,
        maxLeverage, isLeverageLoading
    } = useTradingConfigState();

    const {
        setExecutionMode, setTradingMode, setSelectedPair, setLeverage, setTimeFrame,
        setSelectedAgent, setInvestmentAmount,
        setTakeProfitMode, setTakeProfitValue, setIsTakeProfitLocked,
        setIsCooldownEnabled, setMarginType, onSetMultiAssetMode, setAgentParams
    } = useTradingConfigActions();
    
    const isInvestmentInvalid = executionMode === 'live' && investmentAmount > availableBalance;

    const [analysisSignal, setAnalysisSignal] = useState<TradeSignal | null>(null);
    const [isAnalysisLoading, setIsAnalysisLoading] = useState(false);
    const [isAnalysisOpen, setIsAnalysisOpen] = useState(true);

    // Create a stable key representing the core analysis configuration.
    const analysisConfigKey = `${selectedAgent.id}-${timeFrame}-${JSON.stringify(agentParams)}`;
    const analysisConfigChangedRef = useRef(true);

    // Detect when the core configuration changes to trigger the loading state.
    useEffect(() => {
        analysisConfigChangedRef.current = true;
    }, [analysisConfigKey]);

    useEffect(() => {
        const fetchAnalysis = async () => {
            if (klines.length > 50) { // Check for sufficient data
                // Show loader only if the configuration has changed since the last analysis.
                if (analysisConfigChangedRef.current) {
                    setIsAnalysisLoading(true);
                }

                try {
                    const signal = await getTradingSignal(selectedAgent, klines, timeFrame, agentParams);
                    setAnalysisSignal(signal);
                    // Mark that an analysis for this config has run, so subsequent kline updates don't flicker.
                    analysisConfigChangedRef.current = false;
                } catch (e) {
                    console.error("Error fetching analysis signal:", e);
                    setAnalysisSignal({ signal: 'HOLD', reasons: ['Error fetching analysis.'] });
                } finally {
                    // Always turn off the loader after an attempt.
                    setIsAnalysisLoading(false);
                }
            }
        };
        fetchAnalysis();
    }, [selectedAgent, klines, timeFrame, agentParams, analysisConfigKey]);


    useEffect(() => {
        const updateSmartTargets = () => {
            if (klines.length < 50 || !isTakeProfitLocked) return;

            const currentPrice = klines[klines.length - 1].close;
            if (currentPrice <= 0) return;
            
            const timeframeAdaptiveParams = constants.TIMEFRAME_ADAPTIVE_SETTINGS[timeFrame] || {};
            const finalParams: Required<AgentParams> = { ...constants.DEFAULT_AGENT_PARAMS, ...timeframeAdaptiveParams, ...agentParams };

            const longTargets = getInitialAgentTargets(klines, currentPrice, 'LONG', timeFrame, finalParams, selectedAgent.id);
            
            const profitDistance = longTargets.takeProfitPrice - currentPrice;
            
            if (!isTakeProfitLocked) {
                let newTpValue: number;
                if (takeProfitMode === RiskMode.Percent) {
                    newTpValue = (profitDistance / currentPrice) * 100;
                } else { // Amount
                    newTpValue = investmentAmount * (profitDistance / currentPrice);
                }
                setTakeProfitValue(parseFloat(newTpValue.toFixed(2)));
            }
        };

        updateSmartTargets();
    }, [
        klines, isTakeProfitLocked, selectedAgent, timeFrame, agentParams, 
        investmentAmount, takeProfitMode, setTakeProfitValue
    ]);
    
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
                    {constants.TIME_FRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
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

            <div className="grid grid-cols-1 gap-4">
                <RiskInputWithLock
                    label="Take Profit"
                    mode={takeProfitMode}
                    value={takeProfitValue}
                    isLocked={isTakeProfitLocked}
                    investmentAmount={investmentAmount}
                    onModeChange={setTakeProfitMode}
                    onValueChange={setTakeProfitValue}
                    onLockToggle={() => setIsTakeProfitLocked(!isTakeProfitLocked)}
                />
            </div>
             <p className="text-xs text-slate-500 dark:text-slate-400 -mt-2">
                Stop Loss is now fully automated by the agent's logic and the universal profit-locking system.
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
                <label htmlFor="agent-select" className={formLabelClass}>Trading Agent</label>
                <select id="agent-select" value={selectedAgent.id} onChange={e => setSelectedAgent(constants.AGENTS.find(a => a.id === Number(e.target.value))!)} className={formInputClass}>
                    {constants.AGENTS.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
                <p className="text-xs text-slate-500 dark:text-slate-400">{selectedAgent.description}</p>
            </div>
            
            <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>

            <div className="border rounded-md bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                <button
                    onClick={() => setIsAnalysisOpen(!isAnalysisOpen)}
                    className="w-full flex items-center justify-between p-3 text-left font-semibold text-slate-800 dark:text-slate-200"
                >
                    <div className="flex items-center gap-2">
                        <CpuIcon className="w-5 h-5 text-sky-500" />
                        <span>AI Analysis Preview</span>
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

             <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                    <label htmlFor="cooldown-toggle" className={formLabelClass}>
                        Post-Profit Cooldown
                    </label>
                    <ToggleSwitch
                        checked={isCooldownEnabled}
                        onChange={setIsCooldownEnabled}
                    />
                </div>
                 <p className="text-xs text-slate-500 dark:text-slate-400">
                    If enabled, the bot enters a persistent cautious state after a profit. It analyzes the next trade opportunity for trend exhaustion to protect gains.
                </p>
            </div>

            <button onClick={onStartBot} disabled={isBotCombinationActive || isInvestmentInvalid} className={primaryButtonClass}>
                <PlayIcon className="w-5 h-5"/>
                {isBotCombinationActive ? 'Bot Is Already Running' : 'Start Trading Bot'}
            </button>
        </div>
    );
};
