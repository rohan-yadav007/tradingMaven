

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { RunningBot, BotStatus, Position, BotConfig, BotLogEntry, LogType } from '../types';
import { StopIcon, ActivityIcon, CpuIcon, PauseIcon, PlayIcon, TrashIcon, CloseIcon, ChevronDown, ChevronUp, CheckCircleIcon, XCircleIcon, InfoIcon, ZapIcon, RefreshIcon } from './icons';
import { AnalysisPreview } from './AnalysisPreview';
import { TAKER_FEE_RATE } from '../constants';
import { botManagerService } from '../services/botManagerService';


interface RunningBotsProps {
    bots: RunningBot[];
    onClosePosition: (pos: Position, reason?: string, price?: number) => void;
    onPauseBot: (botId: string) => void;
    onResumeBot: (botId: string) => void;
    onStopBot: (botId: string) => void;
    onDeleteBot: (botId: string) => void;
    onUpdateBotConfig: (botId: string, partialConfig: Partial<BotConfig>) => void;
    onRefreshBotAnalysis: (botId: string) => void;
}

const InfoItem: React.FC<{ label: string; value: React.ReactNode; valueClassName?: string, labelClassName?: string }> = ({ label, value, valueClassName, labelClassName }) => (
    <div>
        <div className={`text-xs text-slate-500 dark:text-slate-400 ${labelClassName}`}>{label}</div>
        <div className={`font-medium font-mono ${valueClassName}`}>{value}</div>
    </div>
);

const useDuration = (bot: RunningBot) => {
    const [duration, setDuration] = useState('00:00:00');

    useEffect(() => {
        const updateDuration = () => {
            let totalMs = bot.accumulatedActiveMs;
            if (bot.lastResumeTimestamp) {
                totalMs += Date.now() - bot.lastResumeTimestamp;
            }
            
            const hours = Math.floor(totalMs / 3600000);
            const minutes = Math.floor((totalMs % 3600000) / 60000);
            const seconds = Math.floor((totalMs % 60000) / 1000);
            
            setDuration(
                `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
            );
        };

        let intervalId: number | undefined;
        if (bot.status !== BotStatus.Paused && bot.status !== BotStatus.Stopped && bot.status !== BotStatus.Error) {
             intervalId = window.setInterval(updateDuration, 1000);
        }
        
        updateDuration(); 

        return () => {
            if (intervalId) {
                window.clearInterval(intervalId);
            }
        };
    }, [bot.status, bot.accumulatedActiveMs, bot.lastResumeTimestamp]);

    return duration;
};

const formatPrice = (price: number | undefined, precision: number) => {
    if (price === undefined || price === null) return 'N/A';
    return price.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
};

const getStatusInfo = (status: BotStatus): { text: string; bg: string; text_color: string; icon: React.ReactNode; pulse: boolean; } => {
    switch(status) {
        case BotStatus.Monitoring: return { text: status, bg: 'bg-sky-100 dark:bg-sky-900/50', text_color: 'text-sky-700 dark:text-sky-300', icon: <ActivityIcon className="w-3 h-3"/>, pulse: true };
        case BotStatus.PositionOpen: return { text: 'Position Open', bg: 'bg-emerald-100 dark:bg-emerald-900/50', text_color: 'text-emerald-700 dark:text-emerald-300', icon: <CheckCircleIcon className="w-3 h-3"/>, pulse: false };
        case BotStatus.ExecutingTrade: return { text: 'Executing...', bg: 'bg-amber-100 dark:bg-amber-900/50', text_color: 'text-amber-700 dark:text-amber-300', icon: <CpuIcon className="w-3 h-3"/>, pulse: true };
        case BotStatus.FlipPending: return { text: 'Flip Pending', bg: 'bg-indigo-100 dark:bg-indigo-900/50', text_color: 'text-indigo-700 dark:text-indigo-300', icon: <ZapIcon className="w-3 h-3"/>, pulse: true };
        case BotStatus.Error: return { text: status, bg: 'bg-rose-100 dark:bg-rose-900/50', text_color: 'text-rose-700 dark:text-rose-300', icon: <XCircleIcon className="w-3 h-3"/>, pulse: false };
        case BotStatus.Paused: return { text: status, bg: 'bg-slate-200 dark:bg-slate-700', text_color: 'text-slate-600 dark:text-slate-300', icon: <PauseIcon className="w-3 h-3"/>, pulse: false };
        case BotStatus.Stopped: return { text: status, bg: 'bg-slate-200 dark:bg-slate-700', text_color: 'text-slate-600 dark:text-slate-300', icon: <StopIcon className="w-3 h-3"/>, pulse: false };
        case BotStatus.Starting: return { text: status, bg: 'bg-indigo-100 dark:bg-indigo-900/50', text_color: 'text-indigo-700 dark:text-indigo-300', icon: <CpuIcon className="w-3 h-3"/>, pulse: true };
        default: return { text: status, bg: 'bg-slate-200 dark:bg-slate-700', text_color: 'text-slate-600 dark:text-slate-300', icon: <StopIcon className="w-3 h-3"/>, pulse: false };
    }
}

const ToggleSwitch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void; size?: 'sm' | 'md' }> = ({ checked, onChange, size = 'md' }) => {
    const height = size === 'sm' ? 'h-5' : 'h-6';
    const width = size === 'sm' ? 'w-9' : 'w-11';
    const knobSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
    const translation = size === 'sm' ? 'translate-x-4' : 'translate-x-5';

    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={`${checked ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'} relative inline-flex ${height} ${width} flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800`}
        >
            <span
                aria-hidden="true"
                className={`${checked ? translation : 'translate-x-0'} pointer-events-none inline-block ${knobSize} transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
            />
        </button>
    );
};

const ConfigToggle: React.FC<{label: string; checked: boolean; onChange: (checked: boolean) => void}> = ({label, checked, onChange}) => (
    <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
            <span className="font-medium text-slate-700 dark:text-slate-300 text-sm">{label}</span>
        </div>
        <ToggleSwitch
            checked={checked}
            onChange={onChange}
            size="sm"
        />
    </div>
);


const EntryFilterConfiguration: React.FC<{ bot: RunningBot; onUpdate: (change: Partial<BotConfig>) => void; onRefreshAnalysis: () => void; }> = ({ bot, onUpdate, onRefreshAnalysis }) => {
    const { config } = bot;

    const handleChange = (change: Partial<BotConfig>) => {
        onUpdate(change);
        onRefreshAnalysis();
    };

    return (
        <div>
            <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-base mb-2">Entry Filter Configuration</h4>
             <div className="bg-slate-100 dark:bg-slate-900/50 p-3 rounded-lg space-y-2 text-sm">
                <p className="text-xs text-slate-500 dark:text-slate-400">Toggle entry filters for the next trade. These changes apply immediately.</p>
                <ConfigToggle label="Momentum Concordance" checked={config.isMomentumConcordanceEnabled} onChange={v => handleChange({ isMomentumConcordanceEnabled: v })} />
                <ConfigToggle label="Liquidation Cascade Veto" checked={config.isLiquidationFilterEnabled ?? false} onChange={v => handleChange({ isLiquidationFilterEnabled: v })} />
                <ConfigToggle label="ADX Trend Filter" checked={config.isAdxFilterEnabled ?? false} onChange={v => handleChange({ isAdxFilterEnabled: v })} />
                <ConfigToggle label="Market Breadth Filter" checked={config.isMarketBreadthFilterEnabled ?? false} onChange={v => handleChange({ isMarketBreadthFilterEnabled: v })} />
                <ConfigToggle label="BTC Trend Confirmation" checked={config.isBtcConfirmationEnabled ?? false} onChange={v => handleChange({ isBtcConfirmationEnabled: v })} />
                <ConfigToggle label="VWAP Confirmation" checked={config.isVwapConfirmationEnabled ?? false} onChange={v => handleChange({ isVwapConfirmationEnabled: v })} />
                <ConfigToggle label="Higher TF Confirmation" checked={config.isHtfConfirmationEnabled} onChange={v => handleChange({ isHtfConfirmationEnabled: v })} />
                <ConfigToggle label="Universal Volume Filter" checked={config.isVolumeFilterEnabled ?? false} onChange={v => handleChange({ isVolumeFilterEnabled: v })} />
                <ConfigToggle label="Market Cohesion Filter" checked={config.isMarketCohesionEnabled ?? false} onChange={v => handleChange({ isMarketCohesionEnabled: v })} />
                <ConfigToggle label="Exhaustion Filter" checked={config.isExhaustionFilterEnabled ?? true} onChange={v => handleChange({ isExhaustionFilterEnabled: v })} />
                <ConfigToggle label="SMC Reversal Veto" checked={config.isSmcVetoEnabled ?? true} onChange={v => handleChange({ isSmcVetoEnabled: v })} />
                <ConfigToggle label="Market Structure Veto" checked={config.isMarketStructureVetoEnabled ?? true} onChange={v => handleChange({ isMarketStructureVetoEnabled: v })} />
                <ConfigToggle label="Minimum R:R Veto" checked={config.isMinRrEnabled} onChange={v => handleChange({ isMinRrEnabled: v })} />
                <ConfigToggle label="Immediate Entry" checked={config.entryTiming === 'immediate'} onChange={v => handleChange({ entryTiming: v ? 'immediate' : 'onNextCandle' })} />
             </div>
        </div>
    )
};

const TradeManagementConfiguration: React.FC<{ bot: RunningBot; onUpdate: (change: Partial<BotConfig>) => void; onRefreshAnalysis: () => void; }> = ({ bot, onUpdate, onRefreshAnalysis }) => {
    const { config } = bot;

    const handleToggleChange = (change: Partial<BotConfig>) => {
        onUpdate(change);
        // No need to refresh analysis for trade management changes as they don't affect entry signals
    };

     const handleSelectChange = (change: Partial<BotConfig>) => {
        onUpdate(change);
    };

    return (
        <div>
            <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-base mb-2">Trade Management Configuration</h4>
             <div className="bg-slate-100 dark:bg-slate-900/50 p-3 rounded-lg space-y-2 text-sm">
                <p className="text-xs text-slate-500 dark:text-slate-400">Toggle rules for open and future trades.</p>
                <ConfigToggle label="Agent Indicator Trail" checked={config.isAgentTrailEnabled} onChange={v => handleToggleChange({ isAgentTrailEnabled: v })} />
                <ConfigToggle label="Mandatory Breakeven Trail" checked={config.isBreakevenTrailEnabled} onChange={v => handleToggleChange({ isBreakevenTrailEnabled: v })} />
                <ConfigToggle label="Universal Profit Trail" checked={config.isUniversalProfitTrailEnabled} onChange={v => handleToggleChange({ isUniversalProfitTrailEnabled: v })} />
                <ConfigToggle label="Adaptive Take Profit" checked={config.isAdaptiveTpEnabled} onChange={v => handleToggleChange({ isAdaptiveTpEnabled: v })} />
                 <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                    <label htmlFor={`aggressive-trail-mode-${bot.id}`} className="font-medium text-slate-700 dark:text-slate-300 text-sm">Aggressive Trail Mode</label>
                    <select 
                        id={`aggressive-trail-mode-${bot.id}`}
                        value={config.aggressiveTrailMode} 
                        onChange={e => handleSelectChange({ aggressiveTrailMode: e.target.value as 'distance' | 'pnl'})}
                        className="text-xs font-semibold bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md p-1 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    >
                        <option value="distance">Distance to TP</option>
                        <option value="pnl">PNL %</option>
                    </select>
                </div>
                <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                    <label htmlFor={`invalidation-sensitivity-${bot.id}`} className="font-medium text-slate-700 dark:text-slate-300 text-sm">Invalidation Sensitivity</label>
                    <select 
                        id={`invalidation-sensitivity-${bot.id}`}
                        value={config.invalidationSensitivity} 
                        onChange={e => handleSelectChange({ invalidationSensitivity: e.target.value as 'low' | 'medium' | 'high'})}
                        className="text-xs font-semibold bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md p-1 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                    </select>
                </div>
             </div>
        </div>
    )
};


const PositionPnlProgress: React.FC<{position: Position; livePrice: number}> = ({ position, livePrice }) => {
    const { entryPrice, takeProfitPrice, stopLossPrice, direction } = position;
    const isLong = direction === 'LONG';
    
    let progressPercent = 0;
    if (isLong) {
        const totalRange = takeProfitPrice - stopLossPrice;
        if (totalRange > 0) {
            progressPercent = ((livePrice - stopLossPrice) / totalRange) * 100;
        }
    } else { // SHORT
        const totalRange = stopLossPrice - takeProfitPrice;
        if (totalRange > 0) {
            progressPercent = ((stopLossPrice - livePrice) / totalRange) * 100;
        }
    }

    const clampedProgress = Math.min(100, Math.max(0, progressPercent));

    const grossPnl = (livePrice - entryPrice) * position.size * (isLong ? 1 : -1);
    const pnlIsProfit = grossPnl >= 0;

    return (
        <div className="flex flex-col gap-1.5 pt-2">
            <div className="w-full bg-rose-200 dark:bg-rose-900/50 rounded-full h-4 relative">
                <div 
                    className="bg-emerald-500 dark:bg-emerald-600 h-full rounded-full transition-all duration-300" 
                    style={{ width: `${clampedProgress}%`}}
                ></div>
                
                <div 
                    className="absolute top-0 h-full flex items-center" 
                    style={{ left: `calc(${clampedProgress}% - 8px)`}}
                >
                    <div className="w-1 h-5 bg-slate-800 dark:bg-white rounded-full border border-white dark:border-slate-800 shadow-lg"></div>
                    <div className={`absolute top-5 whitespace-nowrap px-1.5 py-0.5 rounded text-xs font-bold shadow-md ${pnlIsProfit ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}
                         style={{ transform: 'translateX(-50%)' }}
                    >
                         <span title="Unrealized PNL (Gross)">{pnlIsProfit ? '+' : ''}${grossPnl.toFixed(2)}</span>
                    </div>
                </div>
            </div>
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 font-mono">
                <span>SL: {formatPrice(stopLossPrice, position.pricePrecision)}</span>
                <span>TP: {formatPrice(takeProfitPrice, position.pricePrecision)}</span>
            </div>
        </div>
    );
};

interface StopLossDetailsProps {
    position: Position;
    config: BotConfig;
}

const StopLossDetails: React.FC<StopLossDetailsProps> = ({ position, config }) => {
    const {
        stopLossPrice, initialStopLossPrice, activeStopLossReason, pricePrecision,
        profitLockTier, isBreakevenSet, profitSpikeTier, aggressiveTrailTier
    } = position;

    const ActiveReasonTag: React.FC<{ reason: Position['activeStopLossReason'] }> = ({ reason }) => {
        const reasonInfo = useMemo(() => {
            switch (reason) {
                case 'Hard Cap':
                    return { text: 'Hard Cap', className: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300' };
                case 'Agent Logic':
                    return { text: 'Agent Logic', className: 'bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200' };
                case 'Profit Secure':
                    return { text: 'Profit Secure', className: 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300' };
                case 'Breakeven':
                    return { text: 'Breakeven', className: 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300' };
                case 'Agent Trail':
                    return { text: 'Agent Trail', className: 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' };
                default:
                    return { text: reason, className: 'bg-slate-200 dark:bg-slate-600' };
            }
        }, [reason]);

        return (
            <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${reasonInfo.className}`}>
                {reasonInfo.text}
            </span>
        );
    };

    const isProfitSecureActive = activeStopLossReason === 'Profit Secure';
    const isAgentTrailActive = activeStopLossReason === 'Agent Trail';
    
    const isUniversalTrailEnabled = config.isUniversalProfitTrailEnabled;

    const universalTrailStatus = useMemo(() => {
        if (!isUniversalTrailEnabled) return { text: 'Disabled by user', className: 'bg-slate-200 dark:bg-slate-600' };
        if (isProfitSecureActive && profitLockTier > 3) {
            const tier = profitLockTier - 3;
            return { text: tier > 0 ? `Tier ${tier} Active` : 'Active', className: 'bg-teal-500 text-white' };
        }
        if (isBreakevenSet) return { text: 'Breakeven', className: 'bg-sky-500 text-white' };
        return { text: 'Enabled', className: 'bg-slate-500 dark:bg-slate-400 text-white dark:text-slate-900' };
    }, [isUniversalTrailEnabled, isProfitSecureActive, isBreakevenSet, profitLockTier]);
    
    const proactiveExitStatus = useMemo(() => {
        // Highest priority states: Aggressive trail and Spike protection
        if (aggressiveTrailTier && aggressiveTrailTier > 0) {
            return { text: 'Aggressive Trail', className: 'bg-purple-500 text-white' };
        }
        if (profitSpikeTier && profitSpikeTier > 0) {
             return { text: `Spike Protector T${profitSpikeTier}`, className: 'bg-purple-500 text-white' };
        }
        // Display the sensitivity level if no higher-priority state is active
        const sensitivity = config.invalidationSensitivity;
        if (sensitivity === 'low') {
            return { text: 'Low Sensitivity', className: 'bg-slate-500 dark:bg-slate-400 text-white dark:text-slate-900' };
        }
        if (sensitivity === 'medium') {
            return { text: 'Medium Sensitivity', className: 'bg-amber-500 text-white' };
        }
        if (sensitivity === 'high') {
            return { text: 'High Sensitivity', className: 'bg-rose-500 text-white' };
        }
        // Fallback
        return { text: 'Enabled', className: 'bg-slate-500 dark:bg-slate-400 text-white dark:text-slate-900' };
    }, [config.invalidationSensitivity, profitSpikeTier, aggressiveTrailTier]);


    const agentTrailStatus = useMemo(() => {
        if (!config.isAgentTrailEnabled) {
            return { text: 'Disabled by user', className: 'bg-slate-200 dark:bg-slate-600' };
        }
        if (isAgentTrailActive) {
            return { text: 'ACTIVE', className: 'bg-indigo-500 text-white' };
        }
        return { text: 'Enabled', className: 'bg-slate-500 dark:bg-slate-400 text-white dark:text-slate-900' };
    }, [isAgentTrailActive, config.isAgentTrailEnabled]);
    
    const isProactiveSystemActive = (profitSpikeTier && profitSpikeTier > 0) || (aggressiveTrailTier && aggressiveTrailTier > 0);

    return (
        <div>
            <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-base mb-2">Stop-Loss Details</h4>
            <div className="bg-slate-100 dark:bg-slate-900/50 p-3 rounded-lg space-y-3 text-sm">
                <div className="flex justify-between items-center">
                    <span className="font-bold">Active SL Price</span>
                    <div className="flex items-center gap-2">
                        <ActiveReasonTag reason={activeStopLossReason} />
                        <span className="font-bold font-mono bg-slate-200 dark:bg-slate-700 px-2 py-1 rounded-md">{formatPrice(stopLossPrice, pricePrecision)}</span>
                    </div>
                </div>

                <div className={`p-2 rounded-md ${isProactiveSystemActive ? 'bg-purple-100 dark:bg-purple-900 border border-purple-300 dark:border-purple-700' : ''}`}>
                    <div className="flex justify-between items-center">
                         <div className="flex items-center gap-1">
                            <ZapIcon className="w-4 h-4 text-purple-600 dark:text-purple-400"/>
                            <span className={isProactiveSystemActive ? 'font-semibold text-purple-700 dark:text-purple-300' : 'font-medium'}>
                                Proactive Exit System
                            </span>
                         </div>
                         <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${proactiveExitStatus.className}`}>
                            {proactiveExitStatus.text}
                         </span>
                    </div>
                </div>

                <div className={`p-2 rounded-md ${isProfitSecureActive && !isProactiveSystemActive ? 'bg-teal-100 dark:bg-teal-900 border border-teal-300 dark:border-teal-700' : ''}`}>
                    <div className="flex justify-between items-center">
                         <span className={isProfitSecureActive ? 'font-semibold text-teal-700 dark:text-teal-300' : 'font-medium'}>
                            Universal Profit Trail
                        </span>
                         <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${universalTrailStatus.className}`}>
                            {universalTrailStatus.text}
                         </span>
                    </div>
                </div>

                <div className={`p-2 rounded-md ${isAgentTrailActive ? 'bg-indigo-100 dark:bg-indigo-900 border border-indigo-300 dark:border-indigo-700' : ''}`}>
                    <div className="flex justify-between items-center">
                         <span className={isAgentTrailActive ? 'font-semibold text-indigo-700 dark:text-indigo-300' : 'font-medium'}>
                            Agent Trail
                        </span>
                         <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${agentTrailStatus.className}`}>
                            {agentTrailStatus.text}
                         </span>
                    </div>
                </div>

                <div className="text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-700">
                    Initial SL: {formatPrice(initialStopLossPrice, pricePrecision)} ({position.initialStopLossReason}).
                </div>
            </div>
        </div>
    );
};

const BotLog: React.FC<{ log: BotLogEntry[] }> = ({ log }) => {
    const logContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [log]);

    const getLogColor = (type: LogType) => {
        switch (type) {
            case LogType.Error: return 'text-rose-500';
            case LogType.Success: return 'text-emerald-500';
            case LogType.Action: return 'text-sky-500';
            case LogType.Status: return 'text-amber-500';
            default: return 'text-slate-500 dark:text-slate-200';
        }
    };
    return (
        <div ref={logContainerRef} className="bg-slate-900 text-white font-mono text-xs rounded-lg p-3 h-[28rem] flex flex-col-reverse overflow-y-auto">
            {/* The empty div is a trick to make scroll anchoring work better with flex-reverse */}
            <div></div>
            {log.slice().reverse().map((entry, index) => (
                <div key={index} className="flex">
                    <span className="text-slate-500 mr-2">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                    <span className={getLogColor(entry.type)}>{entry.message}</span>
                </div>
            ))}
        </div>
    );
};

const BotCard: React.FC<{ bot: RunningBot; actions: Omit<RunningBotsProps, 'bots'> }> = ({ bot, actions }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    
    const [priceChange, setPriceChange] = useState<'up' | 'down' | 'none'>('none');
    const prevPriceRef = useRef(bot.livePrice);

    useEffect(() => {
        const currentPrice = bot.livePrice || 0;
        const prevPrice = prevPriceRef.current || 0;
        
        if (currentPrice > prevPrice) {
            setPriceChange('up');
        } else if (currentPrice < prevPrice) {
            setPriceChange('down');
        }
        
        prevPriceRef.current = currentPrice;
        
        const timeout = setTimeout(() => setPriceChange('none'), 500);
        return () => clearTimeout(timeout);
    }, [bot.livePrice]);

    const duration = useDuration(bot);
    const statusInfo = getStatusInfo(bot.status);
    const position = bot.openPosition;
    const pnlIsProfit = bot.totalPnl >= 0;
    const winRate = bot.closedTradesCount > 0 ? (bot.wins / bot.closedTradesCount) * 100 : 0;
    const winRateIsGood = winRate >= 50;
    
    const isPaused = bot.status === BotStatus.Paused;
    const isStopped = bot.status === BotStatus.Stopped || bot.status === BotStatus.Error;

    const executionModeTag = bot.config.executionMode === 'live'
        ? { text: 'LIVE', bg: 'bg-amber-100 dark:bg-amber-900', text_color: 'text-amber-700 dark:text-amber-300' }
        : { text: 'PAPER', bg: 'bg-sky-100 dark:bg-sky-900', text_color: 'text-sky-700 dark:text-sky-300' };
    
    const roundTripFee = position ? position.entryPrice * position.size * TAKER_FEE_RATE * 2 : 0;
    
    const errorReason = useMemo(() => {
        if (bot.status === BotStatus.Error && bot.analysis && bot.analysis.reasons.length > 0) {
            return bot.analysis.reasons[0].replace('CRITICAL: ', '').replace('Please close manually on Binance to prevent loss. Reason: ', '');
        }
        return null;
    }, [bot.status, bot.analysis]);

    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden transition-all duration-300">
            <div className="p-4">
                {/* Header */}
                <div className="flex justify-between items-start gap-3">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100">{bot.config.pair}</h3>
                            <div className={`text-xs font-bold px-2 py-0.5 rounded-full ${executionModeTag.bg} ${executionModeTag.text_color}`}>{executionModeTag.text}</div>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400">{bot.config.agent.name} on {bot.config.timeFrame}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {isStopped ? (
                            <button onClick={() => actions.onDeleteBot(bot.id)} className="p-2 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-full transition-colors" title="Delete Bot"><TrashIcon className="w-5 h-5"/></button>
                        ) : (
                            <>
                                <button onClick={() => isPaused ? actions.onResumeBot(bot.id) : actions.onPauseBot(bot.id)} className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors" title={isPaused ? "Resume Bot" : "Pause Bot"}>
                                    {isPaused ? <PlayIcon className="w-5 h-5"/> : <PauseIcon className="w-5 h-5"/>}
                                </button>
                                <button onClick={() => actions.onStopBot(bot.id)} className="p-2 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-full transition-colors" title="Stop Bot"><StopIcon className="w-5 h-5"/></button>
                            </>
                        )}
                         <button onClick={() => setIsExpanded(!isExpanded)} className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
                            {isExpanded ? <ChevronUp className="w-5 h-5"/> : <ChevronDown className="w-5 h-5"/>}
                        </button>
                    </div>
                </div>

                {/* Status & Performance */}
                <div className="mt-3 flex items-center justify-between gap-4 flex-wrap border-t border-slate-200 dark:border-slate-700 pt-3">
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold ${statusInfo.bg} ${statusInfo.text_color}`}>
                             {statusInfo.pulse && <div className="w-2 h-2 rounded-full bg-current animate-pulse"></div>}
                            {statusInfo.icon}
                            <span>{statusInfo.text}</span>
                        </div>
                        {errorReason && (
                            <p className="text-xs font-semibold text-rose-600 dark:text-rose-400 truncate" title={errorReason}>
                                {errorReason}
                            </p>
                        )}
                    </div>
                     <div className="flex items-center gap-4 text-sm">
                        <InfoItem 
                            label="Live Price" 
                            value={formatPrice(bot.livePrice, bot.config.pricePrecision)} 
                            valueClassName={`transition-colors duration-300 ${priceChange === 'up' ? 'text-emerald-500' : priceChange === 'down' ? 'text-rose-500' : 'dark:text-slate-100'}`} 
                        />
                        <InfoItem label="Net PNL" value={`$${bot.totalPnl.toFixed(2)}`} valueClassName={pnlIsProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} />
                        <InfoItem label="Win Rate" value={`${winRate.toFixed(1)}%`} valueClassName={winRateIsGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} />
                        <InfoItem label="Trades" value={`${bot.wins}/${bot.losses}`} />
                        <InfoItem label="Duration" value={duration} />
                    </div>
                </div>

                {/* Open Position */}
                {position && (
                    <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                        <div className="flex justify-between items-center">
                            <div>
                                <h4 className="font-semibold text-base text-slate-800 dark:text-slate-200">
                                    <span className={position.direction === 'LONG' ? 'text-emerald-500' : 'text-rose-500'}>{position.direction} Position</span>
                                </h4>
                                 <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Entry: {formatPrice(position.entryPrice, position.pricePrecision)} | Size: {position.size.toFixed(4)}
                                </p>
                            </div>
                            <div className="flex items-center gap-4">
                                {position.liquidationPrice && (
                                    <InfoItem label="Liq. Price" value={formatPrice(position.liquidationPrice, position.pricePrecision)} valueClassName="text-amber-500" />
                                )}
                                <InfoItem label="Est. Fee" value={`$${roundTripFee.toFixed(2)}`} />
                                <button onClick={() => actions.onClosePosition(position)} className="px-3 py-1.5 text-sm bg-rose-600 text-white font-semibold rounded-md shadow-sm hover:bg-rose-700 flex items-center gap-1.5">
                                    <CloseIcon className="w-4 h-4" />
                                    Close
                                </button>
                            </div>
                        </div>
                        <PositionPnlProgress position={position} livePrice={bot.livePrice || position.entryPrice} />
                    </div>
                )}
            </div>
            
            {/* Expanded Details */}
            {isExpanded && (
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 border-t border-slate-200 dark:border-slate-700">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                        {/* Column 1: Position Details & AI Analysis */}
                        <div className="space-y-6">
                            {position && <StopLossDetails position={position} config={bot.config} />}
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                     <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-base">AI Analysis</h4>
                                     <button
                                        onClick={() => actions.onRefreshBotAnalysis(bot.id)}
                                        className="p-1.5 bg-slate-100 dark:bg-slate-700/50 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                                        title="Refresh analysis now"
                                     >
                                        <RefreshIcon className="w-4 h-4"/>
                                     </button>
                                </div>
                                 <AnalysisPreview agent={bot.config.agent} agentParams={bot.config.agentParams} analysis={bot.analysis} isLoading={false} />
                            </div>
                        </div>

                        {/* Column 2: Configurations */}
                        <div className="space-y-6">
                            <EntryFilterConfiguration bot={bot} onUpdate={(partial) => actions.onUpdateBotConfig(bot.id, partial)} onRefreshAnalysis={() => actions.onRefreshBotAnalysis(bot.id)} />
                            <TradeManagementConfiguration bot={bot} onUpdate={(partial) => actions.onUpdateBotConfig(bot.id, partial)} onRefreshAnalysis={() => actions.onRefreshBotAnalysis(bot.id)} />
                        </div>

                        {/* Column 3: Activity Log */}
                        <div className="md:col-span-2 lg:col-span-1">
                            <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-base mb-2">Activity Log</h4>
                            <BotLog log={bot.log} />
                        </div>

                    </div>
                </div>
            )}
        </div>
    );
};


const useBotListState = (initialBots: RunningBot[]) => {
    const [bots, setBots] = useState(initialBots);

    useEffect(() => {
        setBots(initialBots);
    }, [initialBots]);

    useEffect(() => {
        const handleUpdate = (updatedBot: RunningBot) => {
            setBots(currentBots => 
                currentBots.map(b => b.id === updatedBot.id ? updatedBot : b)
            );
        };

        const subscriptions: { botId: string; handler: (bot: RunningBot) => void }[] = [];

        initialBots.forEach(bot => {
            botManagerService.subscribeToBotUpdates(bot.id, handleUpdate);
            subscriptions.push({ botId: bot.id, handler: handleUpdate });
        });

        return () => {
            subscriptions.forEach(sub => {
                botManagerService.unsubscribeFromBotUpdates(sub.botId, sub.handler);
            });
        };
    }, [initialBots]);

    return bots;
}


export const RunningBots: React.FC<RunningBotsProps> = ({ bots: initialBots, ...actions }) => {
    const bots = useBotListState(initialBots);
    const { onClosePosition } = actions;
    const [activeTab, setActiveTab] = useState<'open' | 'monitoring'>('open');

    const { openPositionBots, monitoringBots } = useMemo(() => {
        const open: RunningBot[] = [];
        const monitoring: RunningBot[] = [];
        bots.forEach(bot => {
            if (bot.status === BotStatus.PositionOpen || bot.status === BotStatus.FlipPending) {
                open.push(bot);
            } else {
                monitoring.push(bot);
            }
        });
        return { openPositionBots: open, monitoringBots: monitoring };
    }, [bots]);

    const { allOpenPositions, profitablePositions, losingPositions } = useMemo(() => {
        const allOpen: Position[] = [];
        const profitable: Position[] = [];
        const losing: Position[] = [];

        openPositionBots.forEach(bot => {
            if (bot.openPosition && bot.livePrice) {
                const isLong = bot.openPosition.direction === 'LONG';
                const unrealizedPnl = (bot.livePrice - bot.openPosition.entryPrice) * bot.openPosition.size * (isLong ? 1 : -1);
                
                allOpen.push(bot.openPosition);

                if (unrealizedPnl > 0) {
                    profitable.push(bot.openPosition);
                } else if (unrealizedPnl < 0) {
                    losing.push(bot.openPosition);
                }
            }
        });
        return { allOpenPositions: allOpen, profitablePositions: profitable, losingPositions: losing };
    }, [openPositionBots]);

    const handleCloseAll = () => {
        if (allOpenPositions.length === 0) return;
        if (window.confirm(`Are you sure you want to close all ${allOpenPositions.length} open positions immediately?`)) {
            allOpenPositions.forEach(pos => {
                const bot = bots.find(b => b.openPositionId === pos.id);
                if (bot) {
                    onClosePosition(pos, 'Kill Switch: Close All', bot.livePrice);
                }
            });
        }
    };

    const handleCloseProfitable = () => {
        if (profitablePositions.length === 0) return;
        if (window.confirm(`Are you sure you want to close all ${profitablePositions.length} profitable positions immediately?`)) {
            profitablePositions.forEach(pos => {
                const bot = bots.find(b => b.openPositionId === pos.id);
                if (bot) {
                    onClosePosition(pos, 'Kill Switch: Close Profitable', bot.livePrice);
                }
            });
        }
    };

    const handleCloseLosing = () => {
        if (losingPositions.length === 0) return;
        if (window.confirm(`Are you sure you want to close all ${losingPositions.length} losing positions immediately?`)) {
            losingPositions.forEach(pos => {
                const bot = bots.find(b => b.openPositionId === pos.id);
                if (bot) {
                    onClosePosition(pos, 'Kill Switch: Close Losing', bot.livePrice);
                }
            });
        }
    };

    const botsToDisplay = activeTab === 'open' ? openPositionBots : monitoringBots;
    const activeBotsCount = openPositionBots.length + monitoringBots.length;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center flex-wrap gap-4">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <CpuIcon className="w-6 h-6 text-sky-500" />
                    <span>Running Bots</span>
                    <span className="text-sm font-normal bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-1 rounded-full">{activeBotsCount}</span>
                </h2>
                
                <div className="flex items-center gap-4">
                     {allOpenPositions.length > 0 && (
                         <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-rose-600 dark:text-rose-400 hidden sm:inline">Emergency Close:</span>
                            <button
                                onClick={handleCloseAll}
                                disabled={allOpenPositions.length === 0}
                                className="px-2.5 py-1 text-xs bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300 font-bold rounded-md hover:bg-rose-200 dark:hover:bg-rose-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                                title={`Close all ${allOpenPositions.length} positions`}
                            >
                                <ZapIcon className="w-3.5 h-3.5" />
                                All ({allOpenPositions.length})
                            </button>
                            <button
                                onClick={handleCloseProfitable}
                                disabled={profitablePositions.length === 0}
                                className="px-2.5 py-1 text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 font-bold rounded-md hover:bg-emerald-200 dark:hover:bg-emerald-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                                title={`Close ${profitablePositions.length} profitable positions`}
                            >
                                <ZapIcon className="w-3.5 h-3.5" />
                                Profits ({profitablePositions.length})
                            </button>
                            <button
                                onClick={handleCloseLosing}
                                disabled={losingPositions.length === 0}
                                className="px-2.5 py-1 text-xs bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300 font-bold rounded-md hover:bg-rose-200 dark:hover:bg-rose-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                                title={`Close ${losingPositions.length} losing positions`}
                            >
                                <ZapIcon className="w-3.5 h-3.5" />
                                Losses ({losingPositions.length})
                            </button>
                        </div>
                    )}
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-lg">
                        <button
                            onClick={() => setActiveTab('open')}
                            className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors flex items-center gap-2 ${activeTab === 'open' ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}
                        >
                            Position Open <span className="text-xs bg-sky-500 text-white rounded-full min-w-[20px] px-1.5 py-0.5">{openPositionBots.length}</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('monitoring')}
                            className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors flex items-center gap-2 ${activeTab === 'monitoring' ? 'bg-white dark:bg-slate-700 shadow text-sky-600' : 'text-slate-500 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'}`}
                        >
                            Monitoring <span className="text-xs bg-slate-500 text-white rounded-full min-w-[20px] px-1.5 py-0.5">{monitoringBots.length}</span>
                        </button>
                    </div>
                </div>
            </div>

            {bots.length > 0 ? (
                <div className="flex flex-col gap-4">
                    {botsToDisplay.map(bot => <BotCard key={bot.id} bot={bot} actions={actions} />)}
                    {botsToDisplay.length === 0 && (
                        <div className="text-center p-8 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 dark:text-slate-400">
                           {activeTab === 'open' ? 'No bots currently have an open position.' : 'No bots are currently monitoring for new trades.'}
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-center p-8 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 dark:text-slate-400">
                    No active bots. Start one from the control panel to see it here.
                </div>
            )}
        </div>
    );
};
