

import React, { useState, useEffect, useMemo } from 'react';
import { TradingMode, Kline, RiskMode, TradeSignal, AgentParams, BotConfig } from '../types';
import * as constants from '../constants';
import { PlayIcon, LockIcon, UnlockIcon, CpuIcon, ChevronDown, ChevronUp } from './icons';
import { AnalysisPreview } from './AnalysisPreview';
import { getTradingSignal, getInitialAgentTargets } from '../services/localAgentService';
import { SearchableDropdown } from './SearchableDropdown';
import { useTradingConfigState, useTradingConfigActions } from '../contexts/TradingConfigContext';

interface ControlPanelProps {
    onStartBot: () => void;
    isBotCombinationActive: boolean;
    theme: 'light' | 'dark';
    klines: Kline[];
    livePrice: number;
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
        onStartBot, isBotCombinationActive, theme, klines, livePrice
    } = props;
    
    const config = useTradingConfigState();
    const actions = useTradingConfigActions();
    
    const {
        executionMode, availableBalance, tradingMode, allPairs, selectedPair,
        isPairsLoading, leverage, chartTimeFrame: timeFrame, selectedAgent, investmentAmount,
        takeProfitMode, takeProfitValue,
        isTakeProfitLocked, agentParams,
        marginType, futuresSettingsError, isMultiAssetMode, multiAssetModeError,
        maxLeverage, isLeverageLoading, isHtfConfirmationEnabled, htfTimeFrame,
        isUniversalProfitTrailEnabled, isTrailingTakeProfitEnabled, isMinRrEnabled, isInvalidationCheckEnabled,
        isReanalysisEnabled, isCooldownEnabled,
    } = config;

    const {
        setExecutionMode, setTradingMode, setSelectedPair, setLeverage, setTimeFrame,
        setSelectedAgent, setInvestmentAmount,
        setTakeProfitMode, setTakeProfitValue, setIsTakeProfitLocked,
        setMarginType, onSetMultiAssetMode, setAgentParams,
        setIsHtfConfirmationEnabled, setHtfTimeFrame, setIsUniversalProfitTrailEnabled,
        setIsTrailingTakeProfitEnabled, setIsMinRrEnabled, setIsReanalysisEnabled, setIsInvalidationCheckEnabled,
        setIsCooldownEnabled,
    } = actions;
    
    const isInvestmentInvalid = executionMode === 'live' && investmentAmount > availableBalance;

    const [analysisSignal, setAnalysisSignal] = useState<TradeSignal | null>(null);
    const [isAnalysisLoading, setIsAnalysisLoading] = useState(false);
    const [isAnalysisOpen, setIsAnalysisOpen] = useState(true); // Open by default

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

    useEffect(() => {
        const fetchAnalysis = async () => {
            if (klines.length > 0 && livePrice > 0) {
                setIsAnalysisLoading(true);

                // Construct a preview kline array with the latest live price to ensure real-time analysis
                const lastKline = klines[klines.length - 1];
                const previewKline: Kline = {
                    ...lastKline,
                    high: Math.max(lastKline.high, livePrice),
                    low: Math.min(lastKline.low, livePrice),
                    close: livePrice,
                    isFinal: false,
                };
                const previewKlines = [...klines.slice(0, -1), previewKline];

                try {
                    const previewConfig: BotConfig = {
                        pair: config.selectedPair,
                        mode: config.tradingMode,
                        executionMode: config.executionMode,
                        leverage: config.leverage,
                        marginType: config.marginType,
                        agent: selectedAgent,
                        timeFrame: timeFrame,
                        investmentAmount: config.investmentAmount,
                        takeProfitMode: config.takeProfitMode,
                        takeProfitValue: config.takeProfitValue,
                        isTakeProfitLocked: config.isTakeProfitLocked,
                        isHtfConfirmationEnabled: config.isHtfConfirmationEnabled,
                        isUniversalProfitTrailEnabled: config.isUniversalProfitTrailEnabled,
                        isTrailingTakeProfitEnabled: config.isTrailingTakeProfitEnabled,
                        isMinRrEnabled: config.isMinRrEnabled,
                        isInvalidationCheckEnabled: config.isInvalidationCheckEnabled,
                        isReanalysisEnabled: config.isReanalysisEnabled,
                        isCooldownEnabled: config.isCooldownEnabled,
                        htfTimeFrame: config.htfTimeFrame,
                        agentParams: agentParams,
                        pricePrecision: 8,
                        quantityPrecision: 8,
                        stepSize: 0.00000001,
                        takerFeeRate: constants.TAKER_FEE_RATE,
                    };

                    const signal = await getTradingSignal(selectedAgent, previewKlines, previewConfig);
                    setAnalysisSignal(signal);
                } catch (e) {
                    console.error("Error fetching analysis signal:", e);
                    setAnalysisSignal({ signal: 'HOLD', reasons: ['Error fetching analysis.'] });
                } finally {
                    setIsAnalysisLoading(false);
                }
            }
        };
        fetchAnalysis();
    }, [selectedAgent, klines, timeFrame, agentParams, config, livePrice]);

    useEffect(() => {
        const updateSmartTargets = () => {
            if (klines.length < 50 || isTakeProfitLocked) return;

            const currentPrice = klines[klines.length - 1].close;
            if (currentPrice <= 0) return;
            
            const { stopLossPrice, takeProfitPrice } = getInitialAgentTargets(klines, currentPrice, 'LONG', {
                pair: selectedPair,
                mode: tradingMode,
                executionMode: executionMode,
                leverage: leverage,
                agent: selectedAgent,
                timeFrame: timeFrame,
                investmentAmount: investmentAmount,
                takeProfitMode: takeProfitMode,
                takeProfitValue: takeProfitValue,
                isTakeProfitLocked: isTakeProfitLocked,
                isHtfConfirmationEnabled: false,
                isUniversalProfitTrailEnabled: false,
                isTrailingTakeProfitEnabled: false,
                isMinRrEnabled: false,
                agentParams: agentParams,
                pricePrecision: 8,
                quantityPrecision: 8,
                stepSize: 0.00000001,
                takerFeeRate: constants.TAKER_FEE_RATE,
            });
            
            const profitDistance = takeProfitPrice - currentPrice;
            
            let newTpValue: number;
            if (takeProfitMode === RiskMode.Percent) {
                newTpValue = (profitDistance / currentPrice) * 100;
            } else { // Amount
                const positionValue = tradingMode === TradingMode.USDSM_Futures ? investmentAmount * leverage : investmentAmount;
                newTpValue = positionValue * (profitDistance / currentPrice);
            }
            setTakeProfitValue(parseFloat(newTpValue.toFixed(2)));
        };

        updateSmartTargets();
    }, [
        klines, isTakeProfitLocked, selectedAgent, timeFrame, agentParams, 
        investmentAmount, takeProfitMode, setTakeProfitValue, tradingMode, leverage, selectedPair, executionMode
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
                Stop Loss is fully automated by the agent's logic and the universal profit-locking system.
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
                        if (agent) setSelectedAgent(agent);
                    }} 
                    className={formInputClass}
                >
                    {constants.AGENTS.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
                <p className="text-xs text-slate-500 dark:text-slate-400">{selectedAgent.description}</p>
                 {selectedAgent.id === 7 && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                        <label htmlFor="candle-confirm-toggle" className={formLabelClass}>
                            Candlestick Confirmation
                        </label>
                        <ToggleSwitch
                            checked={agentParams.isCandleConfirmationEnabled || false}
                            onChange={(isChecked) => setAgentParams({ ...agentParams, isCandleConfirmationEnabled: isChecked })}
                        />
                    </div>
                )}
                 {selectedAgent.id === 9 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-4">
                        <div>
                            <label className={formLabelClass}>Entry Mode</label>
                            <div className="flex items-center gap-1 p-1 bg-slate-200 dark:bg-slate-900/70 rounded-md mt-1">
                                <button 
                                    onClick={() => setAgentParams({ ...agentParams, qsc_entryMode: 'breakout' })} 
                                    className={`flex-1 text-center text-xs font-semibold p-1.5 rounded-md transition-colors ${ (agentParams.qsc_entryMode ?? 'breakout') === 'breakout' ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}
                                >
                                    Breakout
                                </button>
                                <button 
                                    onClick={() => setAgentParams({ ...agentParams, qsc_entryMode: 'pullback' })}
                                    className={`flex-1 text-center text-xs font-semibold p-1.5 rounded-md transition-colors ${ agentParams.qsc_entryMode === 'pullback' ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}
                                >
                                    Pullback
                                </button>
                            </div>
                        </div>
                        <ParamSlider 
                            label="ADX Trend Threshold" 
                            value={agentParams.qsc_adxThreshold ?? constants.DEFAULT_AGENT_PARAMS.qsc_adxThreshold}
                            onChange={(v) => setAgentParams({ ...agentParams, qsc_adxThreshold: v })}
                            min={20} max={40} step={1}
                        />
                        {(agentParams.qsc_entryMode ?? 'breakout') === 'breakout' ? (
                            <ParamSlider 
                                label="RSI Breakout Threshold" 
                                value={agentParams.qsc_rsiMomentumThreshold ?? constants.DEFAULT_AGENT_PARAMS.qsc_rsiMomentumThreshold}
                                onChange={(v) => setAgentParams({ ...agentParams, qsc_rsiMomentumThreshold: v })}
                                min={51} max={70} step={1}
                            />
                        ) : (
                            <ParamSlider 
                                label="RSI Pullback Threshold" 
                                value={agentParams.qsc_rsiPullbackThreshold ?? constants.DEFAULT_AGENT_PARAMS.qsc_rsiPullbackThreshold}
                                onChange={(v) => setAgentParams({ ...agentParams, qsc_rsiPullbackThreshold: v })}
                                min={30} max={49} step={1}
                            />
                        )}
                        <ParamSlider 
                            label="Entry Score Threshold" 
                            value={agentParams.qsc_trendScoreThreshold ?? constants.DEFAULT_AGENT_PARAMS.qsc_trendScoreThreshold}
                            onChange={(v) => setAgentParams({ ...agentParams, qsc_trendScoreThreshold: v })}
                            min={50} max={95} step={1}
                            valueDisplay={(v) => `${v}%`}
                        />
                    </div>
                )}
                 {selectedAgent.id === 13 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                         <ParamSlider 
                            label="Trend EMA Period"
                            value={agentParams.ch_trendEmaPeriod ?? constants.DEFAULT_AGENT_PARAMS.ch_trendEmaPeriod}
                            onChange={(v) => setAgentParams({ ...agentParams, ch_trendEmaPeriod: v })}
                            min={50} max={200} step={10}
                        />
                        <ParamSlider 
                            label="ADX Threshold"
                            value={agentParams.ch_adxThreshold ?? constants.DEFAULT_AGENT_PARAMS.ch_adxThreshold}
                            onChange={(v) => setAgentParams({ ...agentParams, ch_adxThreshold: v })}
                            min={18} max={30} step={1}
                        />
                         <ParamSlider 
                            label="Fast EMA Period"
                            value={agentParams.ch_fastEmaPeriod ?? constants.DEFAULT_AGENT_PARAMS.ch_fastEmaPeriod}
                            onChange={(v) => setAgentParams({ ...agentParams, ch_fastEmaPeriod: v })}
                            min={5} max={20} step={1}
                        />
                        <ParamSlider 
                            label="Slow EMA Period"
                            value={agentParams.ch_slowEmaPeriod ?? constants.DEFAULT_AGENT_PARAMS.ch_slowEmaPeriod}
                            onChange={(v) => setAgentParams({ ...agentParams, ch_slowEmaPeriod: v })}
                            min={20} max={50} step={1}
                        />
                        <ParamSlider 
                            label="KST Signal Period"
                            value={agentParams.ch_kst_signalPeriod ?? constants.DEFAULT_AGENT_PARAMS.ch_kst_signalPeriod}
                            onChange={(v) => setAgentParams({ ...agentParams, ch_kst_signalPeriod: v })}
                            min={3} max={20} step={1}
                        />
                    </div>
                )}
                 {selectedAgent.id === 14 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                         <ParamSlider 
                            label="Entry Score Threshold" 
                            value={agentParams.sentinel_scoreThreshold ?? constants.DEFAULT_AGENT_PARAMS.sentinel_scoreThreshold}
                            onChange={(v) => setAgentParams({ ...agentParams, sentinel_scoreThreshold: v })}
                            min={50}
                            max={95}
                            step={1}
                            valueDisplay={(v) => `${v}%`}
                         />
                    </div>
                )}
                {selectedAgent.id === 15 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                        <ParamSlider 
                            label="Trend EMA Period"
                            value={agentParams.vwap_emaTrendPeriod ?? constants.DEFAULT_AGENT_PARAMS.vwap_emaTrendPeriod}
                            onChange={(v) => setAgentParams({ ...agentParams, vwap_emaTrendPeriod: v })}
                            min={50} max={200} step={10}
                        />
                        <ParamSlider 
                            label="VWAP Proximity"
                            value={agentParams.vwap_proximityPercent ?? constants.DEFAULT_AGENT_PARAMS.vwap_proximityPercent}
                            onChange={(v) => setAgentParams({ ...agentParams, vwap_proximityPercent: v })}
                            min={0.1} max={1} step={0.05}
                            valueDisplay={(v) => `${v.toFixed(2)}%`}
                        />
                    </div>
                )}
                 {selectedAgent.id === 16 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                         <p className="text-xs text-slate-500 dark:text-slate-400">Standard Ichimoku parameters (9, 26, 52, 26) are recommended. Adjust with caution.</p>
                         <ParamSlider 
                            label="Conversion Line Period"
                            value={agentParams.ichi_conversionPeriod ?? constants.DEFAULT_AGENT_PARAMS.ichi_conversionPeriod}
                            onChange={(v) => setAgentParams({ ...agentParams, ichi_conversionPeriod: v })}
                            min={5} max={20} step={1}
                        />
                        <ParamSlider 
                            label="Base Line Period"
                            value={agentParams.ichi_basePeriod ?? constants.DEFAULT_AGENT_PARAMS.ichi_basePeriod}
                            onChange={(v) => setAgentParams({ ...agentParams, ichi_basePeriod: v })}
                            min={20} max={60} step={1}
                        />
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

            <div className="border-t border-slate-200 dark:border-slate-700 -mx-4 my-2"></div>

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
                    <label htmlFor="tp-trail-toggle" className={formLabelClass}>
                        Trailing Take Profit
                    </label>
                    <ToggleSwitch
                        checked={isTrailingTakeProfitEnabled}
                        onChange={setIsTrailingTakeProfitEnabled}
                    />
                </div>
                 <p className="text-xs text-slate-500 dark:text-slate-400">
                    Dynamically adjusts the TP target upwards on profitable trades to capture more of a trend.
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
                <div className="flex items-center justify-between">
                    <label htmlFor="reanalysis-toggle" className={formLabelClass}>
                        Agent Re-analysis
                    </label>
                    <ToggleSwitch
                        checked={isReanalysisEnabled}
                        onChange={setIsReanalysisEnabled}
                    />
                </div>
                 <p className="text-xs text-slate-500 dark:text-slate-400">
                    On a set interval, the agent re-evaluates the market. If the original entry conditions are no longer met, the bot will proactively exit the trade.
                </p>
            </div>
            <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                    <label htmlFor="invalidation-toggle" className={formLabelClass}>
                        Proactive Exit & Invalidation
                    </label>
                    <ToggleSwitch
                        checked={isInvalidationCheckEnabled}
                        onChange={setIsInvalidationCheckEnabled}
                    />
                </div>
                 <p className="text-xs text-slate-500 dark:text-slate-400">
                    The ultimate safety net. Secures high profits on early signs of reversal and minimizes losses by exiting invalidated trades before the stop loss is hit. Functions as an always-on 'emergency brake' for every trade.
                </p>
            </div>
             <div className={formGroupClass}>
                <div className="flex items-center justify-between">
                    <label htmlFor="cooldown-toggle" className={formLabelClass}>
                        Post-Trade Cooldown
                    </label>
                    <ToggleSwitch
                        checked={isCooldownEnabled}
                        onChange={setIsCooldownEnabled}
                    />
                </div>
                 <p className="text-xs text-slate-500 dark:text-slate-400">
                    Prevents immediate re-entry in the same direction for a few candles after a trade closes.
                </p>
            </div>

            <button onClick={onStartBot} disabled={isBotCombinationActive || isInvestmentInvalid} className={primaryButtonClass}>
                <PlayIcon className="w-5 h-5"/>
                {isBotCombinationActive ? 'Bot Is Already Running' : 'Start Trading Bot'}
            </button>
        </div>
    );
};
