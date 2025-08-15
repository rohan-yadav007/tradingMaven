import React, { useState, useEffect, useMemo } from 'react';
import { RunningBot, BotStatus, Position, BotConfig, BotLogEntry, TradeSignal, TradingMode, RiskMode, LogType } from '../types';
import { StopIcon, ActivityIcon, CpuIcon, PauseIcon, PlayIcon, TrashIcon, CloseIcon, ChevronDown, ChevronUp, CheckCircleIcon, XCircleIcon, LockIcon, UnlockIcon, InfoIcon, ZapIcon } from './icons';
import { AnalysisPreview } from './AnalysisPreview';
import { MAX_STOP_LOSS_PERCENT_OF_INVESTMENT, TAKER_FEE_RATE } from '../constants';


interface RunningBotsProps {
    bots: RunningBot[];
    onClosePosition: (pos: Position, reason?: string, price?: number) => void;
    onPauseBot: (botId: string) => void;
    onResumeBot: (botId: string) => void;
    onStopBot: (botId: string) => void;
    onDeleteBot: (botId: string) => void;
    onUpdateBotConfig: (botId: string, partialConfig: Partial<BotConfig>) => void;
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
        case BotStatus.Cooldown: return { text: 'Cooldown', bg: 'bg-amber-100 dark:bg-amber-900/50', text_color: 'text-amber-700 dark:text-amber-300', icon: <PauseIcon className="w-3 h-3"/>, pulse: false };
        case BotStatus.PostProfitAnalysis: return { text: 'Post-Profit Analysis', bg: 'bg-indigo-100 dark:bg-indigo-900/50', text_color: 'text-indigo-700 dark:text-indigo-300', icon: <CpuIcon className="w-3 h-3"/>, pulse: true };
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

const BotConfigDetails: React.FC<{ config: BotConfig; onUpdate: (change: Partial<BotConfig>) => void }> = ({ config, onUpdate }) => (
    <div>
        <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-base mb-2">Configuration</h4>
        <div className="bg-slate-100 dark:bg-slate-900/50 p-3 rounded-lg space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-x-4">
                <InfoItem label="Mode" value={config.mode} />
                <InfoItem label="Timeframe" value={config.timeFrame} />
                {config.mode === TradingMode.USDSM_Futures && <InfoItem label="Leverage" value={`${config.leverage}x`} />}
                {config.mode === TradingMode.USDSM_Futures && <InfoItem label="Margin" value={config.marginType || 'N/A'} />}
                <InfoItem label="Investment" value={`$${config.investmentAmount}`} />
            </div>
             <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                 <div className="flex flex-col">
                    <span className="font-medium text-slate-700 dark:text-slate-300">Cooldown</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">Pause after trades</span>
                </div>
                <ToggleSwitch
                    checked={config.isCooldownEnabled}
                    onChange={(checked) => onUpdate({ isCooldownEnabled: checked })}
                    size="sm"
                />
            </div>
        </div>
    </div>
);

const BotHealthDisplay: React.FC<{ bot: RunningBot }> = ({ bot }) => (
    <div>
        <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-base mb-2">Data & Health</h4>
        <div className="bg-slate-100 dark:bg-slate-900/50 p-3 rounded-lg grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <InfoItem label="Candles Loaded" value={bot.klinesLoaded ?? 'N/A'} />
        </div>
    </div>
);

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

    // Display GROSS PNL for clarity, as requested by the user.
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
    const { stopLossPrice, initialStopLossPrice, activeStopLossReason, pricePrecision } = position;

    const activeIsAgentInitial = activeStopLossReason === 'Agent Logic';
    const activeIsHardCap = activeStopLossReason === 'Hard Cap';
    const activeIsUniversalTrail = activeStopLossReason === 'Universal Trail';
    const activeIsAgentTrail = activeStopLossReason === 'Agent Trail';
    
    const isUniversalTrailEnabled = config.isAtrTrailingStopEnabled;

    const getUniversalTrailStatus = () => {
        if (!isUniversalTrailEnabled) return { text: 'Disabled', className: 'bg-slate-200 dark:bg-slate-600' };
        if (activeIsUniversalTrail) return { text: 'ACTIVE', className: 'bg-sky-500 text-white' };
        return { text: 'Enabled', className: 'bg-slate-500 dark:bg-slate-400 text-white dark:text-slate-900' };
    };

    const universalTrailStatus = getUniversalTrailStatus();

    const isFutures = config.mode === TradingMode.USDSM_Futures;
    let hardCapLabel = `Hard Cap (${MAX_STOP_LOSS_PERCENT_OF_INVESTMENT}%)`;
    let hardCapDescription: string;

    if (isFutures && config.leverage > 1) {
        const marginLossPercent = (MAX_STOP_LOSS_PERCENT_OF_INVESTMENT * config.leverage);
        hardCapLabel = `Hard Cap (${MAX_STOP_LOSS_PERCENT_OF_INVESTMENT}% of Position)`;
        hardCapDescription = `Caps price move at ${MAX_STOP_LOSS_PERCENT_OF_INVESTMENT}%. With ${config.leverage}x leverage, this is a max loss of ≈${marginLossPercent.toFixed(0)}% of your margin.`;
    } else {
        hardCapDescription = `Caps max loss to ${MAX_STOP_LOSS_PERCENT_OF_INVESTMENT}% of your investment if the agent's logic is riskier.`;
    }

    return (
        <div>
            <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-base mb-2">Stop-Loss Details</h4>
            <div className="bg-slate-100 dark:bg-slate-900/50 p-3 rounded-lg space-y-3 text-sm">
                <div className="flex justify-between items-center">
                    <span className="font-bold">Active SL Price</span>
                    <span className="font-bold font-mono bg-slate-200 dark:bg-slate-700 px-2 py-1 rounded-md">{formatPrice(stopLossPrice, pricePrecision)}</span>
                </div>
                
                <div className={`p-2 rounded-md ${activeIsUniversalTrail ? 'bg-sky-100 dark:bg-sky-900 border border-sky-300 dark:border-sky-700' : ''}`}>
                    <div className="flex justify-between items-center">
                         <span className={activeIsUniversalTrail ? 'font-semibold text-sky-700 dark:text-sky-300' : 'font-medium'}>Universal Trail</span>
                         <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${universalTrailStatus.className}`}>
                            {universalTrailStatus.text}
                         </span>
                    </div>
                    {isUniversalTrailEnabled && !activeIsUniversalTrail &&
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                           Will become active once the trade is in sufficient profit.
                        </p>
                    }
                </div>

                <div className={`p-2 rounded-md ${activeIsAgentTrail ? 'bg-teal-100 dark:bg-teal-900 border border-teal-300 dark:border-teal-700' : ''}`}>
                    <div className="flex justify-between items-center">
                         <span className={activeIsAgentTrail ? 'font-semibold text-teal-700 dark:text-teal-300' : ''}>Agent Trail</span>
                         <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeIsAgentTrail ? 'bg-teal-500 text-white' : 'bg-slate-200 dark:bg-slate-600'}`}>
                            {activeIsAgentTrail ? 'ACTIVE' : 'Inactive'}
                         </span>
                    </div>
                    {activeIsAgentTrail &&
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                           An agent-specific trailing stop (e.g., PSAR) is managing the trade.
                        </p>
                    }
                </div>

                <div className={`p-2 rounded-md ${activeIsHardCap ? 'bg-amber-100 dark:bg-amber-900 border border-amber-300 dark:border-amber-700' : ''}`}>
                    <div className="flex justify-between items-center">
                         <span className={activeIsHardCap ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}>{hardCapLabel}</span>
                         <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeIsHardCap ? 'bg-amber-500 text-white' : 'bg-slate-200 dark:bg-slate-600'}`}>
                            {activeIsHardCap ? 'ACTIVE' : 'Overridden'}
                         </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{hardCapDescription}</p>
                </div>
                
                <div className={`p-2 rounded-md ${activeIsAgentInitial ? 'bg-indigo-100 dark:bg-indigo-900 border border-indigo-300 dark:border-indigo-700' : ''}`}>
                    <div className="flex justify-between items-center">
                         <span className={activeIsAgentInitial ? 'font-semibold text-indigo-700 dark:text-indigo-300' : ''}>Agent Logic (Initial)</span>
                         <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeIsAgentInitial ? 'bg-indigo-500 text-white' : 'bg-slate-200 dark:bg-slate-600'}`}>
                            {activeIsAgentInitial ? 'ACTIVE' : 'Overridden'}
                         </span>
                    </div>
                     <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Initial SL calculated by the agent was {formatPrice(initialStopLossPrice, pricePrecision)}.
                    </p>
                </div>
            </div>
        </div>
    );
};

const BotLog: React.FC<{ log: BotLogEntry[] }> = ({ log }) => {
    const getLogColor = (type: LogType) => {
        switch (type) {
            case LogType.Error: return 'text-rose-500';
            case LogType.Success: return 'text-emerald-500';
            case LogType.Action: return 'text-sky-500';
            case LogType.Status: return 'text-amber-500';
            default: return 'text-slate-500 dark:text-slate-400';
        }
    };
    return (
        <div className="bg-slate-900 text-white font-mono text-xs rounded-lg p-3 h-48 overflow-y-auto">
            {log.map((entry, index) => (
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
                    <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold ${statusInfo.bg} ${statusInfo.text_color}`}>
                         {statusInfo.pulse && <div className="w-2 h-2 rounded-full bg-current animate-pulse"></div>}
                        {statusInfo.icon}
                        <span>{statusInfo.text}</span>
                    </div>
                     <div className="flex items-center gap-4 text-sm">
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
                            <button onClick={() => actions.onClosePosition(position)} className="px-3 py-1.5 text-sm bg-rose-600 text-white font-semibold rounded-md shadow-sm hover:bg-rose-700 flex items-center gap-1.5">
                                <CloseIcon className="w-4 h-4" />
                                Close
                            </button>
                        </div>
                        <PositionPnlProgress position={position} livePrice={bot.livePrice || position.entryPrice} />
                    </div>
                )}
            </div>
            
            {/* Expanded Details */}
            {isExpanded && (
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 border-t border-slate-200 dark:border-slate-700">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {position && <StopLossDetails position={position} config={bot.config} />}
                        <div className={position ? '' : 'lg:col-span-1'}>
                             <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-base mb-2">AI Analysis</h4>
                             <AnalysisPreview agent={bot.config.agent} agentParams={bot.config.agentParams ?? {}} analysis={bot.analysis} isLoading={false} />
                        </div>
                         <div className={position ? '' : 'lg:col-span-1'}>
                           <BotConfigDetails config={bot.config} onUpdate={(partial) => actions.onUpdateBotConfig(bot.id, partial)} />
                        </div>
                         <div className={position ? 'md:col-span-2 lg:col-span-1' : 'lg:col-span-1'}>
                            <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-base mb-2">Activity Log</h4>
                            <BotLog log={bot.log} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};


export const RunningBots: React.FC<RunningBotsProps> = ({ bots, ...actions }) => {
    return (
        <div className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <CpuIcon className="w-6 h-6 text-sky-500" />
                <span>Running Bots</span>
                <span className="text-sm font-normal bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-1 rounded-full">{bots.length}</span>
            </h2>
            {bots.length > 0 ? (
                <div className="flex flex-col gap-4">
                    {bots.map(bot => <BotCard key={bot.id} bot={bot} actions={actions} />)}
                </div>
            ) : (
                <div className="text-center p-8 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 dark:text-slate-400">
                    No active bots. Start one from the control panel to see it here.
                </div>
            )}
        </div>
    );
};