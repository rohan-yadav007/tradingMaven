
import React, { useState, useEffect } from 'react';
import { RunningBot, BotStatus, Position, BotConfig, BotLogEntry, TradeSignal, TradingMode, RiskMode, LogType } from '../types';
import { StopIcon, ActivityIcon, CpuIcon, PauseIcon, PlayIcon, TrashIcon, CloseIcon, ChevronDown, ChevronUp, CheckCircleIcon, XCircleIcon, LockIcon, UnlockIcon, InfoIcon, ZapIcon } from './icons';

interface RunningBotsProps {
    bots: RunningBot[];
    onClosePosition: (position: Position, exitReason?: string, exitPriceOverride?: number) => void;
    onPauseBot: (botId: string) => void;
    onResumeBot: (botId: string) => void;
    onStopBot: (botId: string) => void;
    onDeleteBot: (botId: string) => void;
    onUpdateBotConfig: (botId: string, partialConfig: Partial<BotConfig>) => void;
}

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

const formatRiskValue = (mode: RiskMode, value: number) => {
    return mode === RiskMode.Percent ? `${value}%` : `$${value}`;
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


const BotAnalysisDisplay: React.FC<{ analysis: TradeSignal | null }> = ({ analysis }) => {
    if (!analysis) return null;
    const isBuy = analysis.signal === 'BUY', isSell = analysis.signal === 'SELL';
    const colorClasses = isBuy ? 'bg-emerald-100 dark:bg-emerald-900/50 border-emerald-500 text-emerald-800 dark:text-emerald-300' : isSell ? 'bg-rose-100 dark:bg-rose-900/50 border-rose-500 text-rose-800 dark:text-rose-300' : 'bg-amber-100 dark:bg-amber-900/50 border-amber-500 text-amber-800 dark:text-amber-300';

    return (
        <div>
            <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-base mb-2">Latest Analysis</h4>
            <div className={`p-3 rounded-lg border-l-4 ${colorClasses}`}>
                <div className="flex items-center gap-2 font-bold text-base">
                    <CpuIcon className="w-5 h-5"/>{analysis.signal}
                </div>
                <hr className="my-2 border-slate-300 dark:border-slate-600"/>
                <ul className="list-disc list-inside space-y-1 text-sm">
                    {analysis.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
                </ul>
            </div>
        </div>
    );
};

const TargetInput: React.FC<{
    label: string;
    botConfig: BotConfig;
    position: Position;
    isTP: boolean;
    onConfigChange: (change: Partial<BotConfig>) => void;
}> = ({ label, botConfig, position, isTP, onConfigChange }) => {
    
    const { entryPrice, size, leverage, direction } = position;
    const {
        isTakeProfitLocked, takeProfitMode, takeProfitValue,
        isStopLossLocked, stopLossMode, stopLossValue
    } = botConfig;

    const isLocked = isTP ? isTakeProfitLocked : isStopLossLocked;
    const mode = isTP ? takeProfitMode : stopLossMode;
    const value = isTP ? takeProfitValue : stopLossValue;

    const [inputValue, setInputValue] = useState<string>(String(value));

    useEffect(() => {
        let displayValue: string;
        // This effect correctly displays the value from the bot's central config
        if (mode === RiskMode.Percent) {
            displayValue = String(value);
        } else { // RiskMode.Amount (PNL)
            displayValue = String(value);
        }
        setInputValue(displayValue);
    }, [value, mode]);

    const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
    };

    const handleUpdateOnBlur = () => {
        const numValue = parseFloat(inputValue);
        if (isNaN(numValue) || numValue === value) {
            // Revert if invalid or unchanged
            setInputValue(String(value));
            return;
        }
        // Send update to the central handler
        const configKey = isTP ? 'takeProfitValue' : 'stopLossValue';
        onConfigChange({ [configKey]: numValue });
    };
    
    const handleToggleMode = () => {
        const currentValue = parseFloat(inputValue);
        if (isNaN(currentValue) || size <= 0) return;

        const nextMode = mode === RiskMode.Percent ? RiskMode.Amount : RiskMode.Percent;
        let nextValue: number;

        if (nextMode === RiskMode.Amount) { // from % to $
            const pnlAmount = botConfig.investmentAmount * (currentValue / 100);
            nextValue = parseFloat(pnlAmount.toFixed(2));
        } else { // from $ to %
            const percentage = (currentValue / botConfig.investmentAmount) * 100;
            nextValue = parseFloat(percentage.toFixed(2));
        }
        
        // Send both mode and value updates to the central handler
        const modeKey = isTP ? 'takeProfitMode' : 'stopLossMode';
        const valueKey = isTP ? 'takeProfitValue' : 'stopLossValue';
        onConfigChange({
            [modeKey]: nextMode,
            [valueKey]: nextValue
        });
    };

    const handleLockToggle = () => {
        const lockKey = isTP ? 'isTakeProfitLocked' : 'isStopLossLocked';
        onConfigChange({ [lockKey]: !isLocked });
    };

    const inputClass = "w-full pl-7 pr-3 py-2 bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-l-md shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-colors text-sm";
    const buttonClass = "px-3 py-2 bg-slate-100 dark:bg-slate-600 border border-l-0 border-slate-300 dark:border-slate-600 rounded-r-md font-bold text-sm hover:bg-slate-200 dark:hover:bg-slate-500 transition-colors";
    
    return (
        <div className="flex flex-col gap-1">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <span>{label}</span>
                <button 
                    onClick={handleLockToggle} 
                    className={`p-1 rounded-full enabled:hover:bg-slate-200 enabled:dark:hover:bg-slate-600`}
                    title={isLocked ? 'Unlock to enable auto-management' : 'Lock to set a hard target'}
                >
                    {isLocked ? <LockIcon className="w-3 h-3 text-slate-400"/> : <UnlockIcon className="w-3 h-3 text-sky-500"/>}
                </button>
            </div>
            <div className="flex relative">
                 <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 text-sm pointer-events-none">
                    {mode === RiskMode.Percent ? '%' : '$'}
                </span>
                <input 
                    type="number" 
                    value={inputValue} 
                    onChange={handleValueChange}
                    onBlur={handleUpdateOnBlur}
                    className={inputClass}
                />
                <button 
                    onClick={handleToggleMode} 
                    aria-label={`Switch to ${mode === RiskMode.Percent ? 'PNL Amount ($)' : 'Percentage (%)'}`}
                    title={`Switch to ${mode === RiskMode.Percent ? 'PNL Amount ($)' : 'Percentage (%)'}`}
                    className={buttonClass} style={{width: '50px'}}
                >
                    {mode === RiskMode.Percent ? '$' : '%'}
                </button>
            </div>
        </div>
    );
};

const PositionPnlProgress: React.FC<{position: Position; livePrice: number}> = ({ position, livePrice }) => {
    const { entryPrice, takeProfitPrice, stopLossPrice, direction } = position;
    const isLong = direction === 'LONG';
    
    const actualSL = isLong ? stopLossPrice : takeProfitPrice;
    const actualTP = isLong ? takeProfitPrice : stopLossPrice;

    const totalRange = Math.abs(actualTP - actualSL);
    if(totalRange === 0) return null;

    const progressFromSL = livePrice - actualSL;
    let progressPercent = (progressFromSL / totalRange) * 100;
    
    if(!isLong) progressPercent = 100 - progressPercent;

    progressPercent = Math.min(100, Math.max(0, progressPercent));
    
    return (
        <div className="w-full bg-rose-200 dark:bg-rose-900/50 rounded-full h-2.5 relative overflow-hidden">
            <div 
                className="bg-emerald-500 dark:bg-emerald-600 h-full rounded-full transition-all duration-300" 
                style={{ width: `${progressPercent}%`}}
            ></div>
            <div className="absolute inset-0 flex justify-between items-center px-2 text-xs text-white font-bold">
                 <span>SL</span>
                 <span>TP</span>
            </div>
        </div>
    );
};

const PositionManager: React.FC<{ 
    bot: RunningBot;
    onConfigChange: (change: Partial<BotConfig>) => void;
}> = ({ bot, onConfigChange }) => {
    const { config, openPosition, livePrice } = bot;
    if (!openPosition || !livePrice) return null;

    return (
        <div className="flex flex-col gap-3">
            <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-base mb-0">Manage Position</h4>
            <div className="grid grid-cols-2 gap-4 text-sm mt-1 mb-2 bg-slate-100 dark:bg-slate-900/50 p-2 rounded-lg">
                <InfoItem label="Entry Price" value={formatPrice(openPosition.entryPrice, openPosition.pricePrecision)} />
                {openPosition.liquidationPrice && openPosition.liquidationPrice > 0 ? (
                    <InfoItem 
                        label="Liq. Price" 
                        value={<span className="flex items-center gap-1">{formatPrice(openPosition.liquidationPrice, openPosition.pricePrecision)} <InfoIcon title="Position will be liquidated if price reaches this level." className="w-3 h-3"/></span>}
                        valueClassName="text-rose-600 dark:text-rose-400 font-semibold"
                    />
                ) : (
                    <InfoItem label="Live Price" value={formatPrice(livePrice, openPosition.pricePrecision)} />
                )}
            </div>
            <PositionPnlProgress position={openPosition} livePrice={livePrice}/>
            <div className="grid grid-cols-2 gap-3">
                <TargetInput 
                    label="Take Profit" 
                    botConfig={config}
                    position={openPosition} 
                    isTP={true} 
                    onConfigChange={onConfigChange}
                />
                <TargetInput 
                    label="Stop Loss" 
                    botConfig={config}
                    position={openPosition} 
                    isTP={false} 
                    onConfigChange={onConfigChange}
                />
            </div>
        </div>
    )
};

const BotPerformanceSummary: React.FC<{ bot: RunningBot }> = ({ bot }) => {
    if (!bot.closedTradesCount || bot.closedTradesCount === 0) {
        return null;
    }

    const totalPnl = bot.totalPnl || 0;
    const pnlIsProfit = totalPnl >= 0;

    return (
        <div>
            <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-base mb-2">Performance</h4>
             <div className="bg-slate-100 dark:bg-slate-900/50 p-3 rounded-lg grid grid-cols-2 gap-4">
                <InfoItem label="Total PNL" value={`$${totalPnl.toFixed(2)}`} valueClassName={`font-bold font-mono text-lg ${pnlIsProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`} />
                <InfoItem label="Closed Trades" value={bot.closedTradesCount} valueClassName="text-lg" />
            </div>
        </div>
    );
};

const CooldownDisplay: React.FC<{ endTime: number }> = ({ endTime }) => {
    const [remaining, setRemaining] = useState(Math.max(0, endTime - Date.now()));

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            const newRemaining = Math.max(0, endTime - Date.now());
            setRemaining(newRemaining);
            if (newRemaining === 0) {
                window.clearInterval(intervalId);
            }
        }, 250);

        return () => window.clearInterval(intervalId);
    }, [endTime]);
    
    const minutes = Math.floor((remaining / 1000) / 60);
    const seconds = Math.floor((remaining / 1000) % 60);

    return (
        <div className="text-center">
            <p className="font-semibold text-amber-600 dark:text-amber-400">Resuming in {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}</p>
        </div>
    );
};

const InfoItem: React.FC<{ label: string; value: React.ReactNode; valueClassName?: string, labelClassName?: string }> = ({ label, value, valueClassName, labelClassName }) => (
    <div>
        <div className={`text-xs text-slate-500 dark:text-slate-400 ${labelClassName}`}>{label}</div>
        <div className={`font-medium font-mono ${valueClassName}`}>{value}</div>
    </div>
);

const logTypeStyles: Record<LogType, { icon: React.FC<any>; color: string; iconColor: string }> = {
    [LogType.Info]: { icon: InfoIcon, color: 'text-slate-600 dark:text-slate-300', iconColor: 'text-slate-400' },
    [LogType.Status]: { icon: ActivityIcon, color: 'text-sky-700 dark:text-sky-300', iconColor: 'text-sky-500' },
    [LogType.Success]: { icon: CheckCircleIcon, color: 'text-emerald-700 dark:text-emerald-300', iconColor: 'text-emerald-500' },
    [LogType.Error]: { icon: XCircleIcon, color: 'text-rose-700 dark:text-rose-300', iconColor: 'text-rose-500' },
    [LogType.Action]: { icon: ZapIcon, color: 'text-indigo-700 dark:text-indigo-300', iconColor: 'text-indigo-500' },
};

const StructuredActivityLog: React.FC<{ log: BotLogEntry[] }> = ({ log }) => {
    return (
        <div className="font-mono text-xs bg-slate-50 dark:bg-slate-900/50 rounded-lg p-2 flex-grow overflow-y-auto" style={{maxHeight: '400px'}}>
            {log.length > 0 ? (
                log.slice().reverse().map((logEntry, index) => {
                    const style = logTypeStyles[logEntry.type] || logTypeStyles[LogType.Info];
                    const Icon = style.icon;
                    return (
                         <div key={index} className="flex items-start gap-2 p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700/50 rounded">
                            <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${style.iconColor}`} title={logEntry.type} />
                            <div className="flex-grow">
                                <p className={`mb-0 whitespace-pre-wrap break-words ${style.color}`}>{logEntry.message}</p>
                                <span className="text-slate-400 dark:text-slate-500 text-[10px]">{new Date(logEntry.timestamp).toLocaleTimeString()}</span>
                            </div>
                        </div>
                    );
                })
            ) : (
                <div className="text-center p-4 text-slate-500">No activity yet.</div>
            )}
        </div>
    );
};


interface BotRowProps extends Omit<RunningBotsProps, 'bots'> {
    bot: RunningBot;
    onToggle: () => void;
    isOpen: boolean;
}


const BotRow: React.FC<BotRowProps> = (props) => {
    const { bot, onClosePosition, onPauseBot, onResumeBot, onStopBot, onDeleteBot, onUpdateBotConfig, onToggle, isOpen } = props;
    const { config, status, id, livePrice, openPosition } = bot;
    
    // Corrected PNL calculation
    const pnl = (openPosition && livePrice && openPosition.entryPrice) ? (livePrice - openPosition.entryPrice) * openPosition.size * (openPosition.direction === 'LONG' ? 1 : -1) : 0;
    const pnlIsProfit = pnl >= 0;
    const duration = useDuration(bot);
    const statusInfo = getStatusInfo(status);

    const controlButtonClass = "p-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700";

    const renderControls = () => {
        const isStopped = status === BotStatus.Stopped || status === BotStatus.Error;
        const isPaused = status === BotStatus.Paused;
        const isActive = !isStopped;
        const isCoolingDown = status === BotStatus.Cooldown;
        const cannotBeStopped = !!openPosition;

        return (
             <div className="flex items-center gap-2">
                {openPosition && livePrice && <button className={`${controlButtonClass} bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:text-rose-400`} onClick={() => onClosePosition(openPosition, "Manual Close", livePrice)} title="Close Position"><CloseIcon className="w-4 h-4" /></button>}
                
                {(isActive || isCoolingDown) && !isPaused && <button className={`${controlButtonClass}`} onClick={() => onPauseBot(id)} title="Pause Bot"><PauseIcon className="w-5 h-5" /></button>}
                {isPaused && <button className={`${controlButtonClass} text-emerald-600 dark:text-emerald-400`} onClick={() => onResumeBot(id)} title="Resume Bot"><PlayIcon className="w-5 h-5" /></button>}
                
                {isActive && (
                    <button className={controlButtonClass} onClick={() => onStopBot(id)} disabled={cannotBeStopped} title={cannotBeStopped ? "Close position before stopping bot" : "Stop Bot"}>
                        <StopIcon className="w-5 h-5" />
                    </button>
                )}
                
                {isStopped && <button className={controlButtonClass} onClick={() => onDeleteBot(id)} title="Delete Bot"><TrashIcon className="w-5 h-5" /></button>}
            </div>
        );
    };

    const renderHeader = () => {
        const primaryStatusText = status === BotStatus.Monitoring && bot.analysis
            ? bot.analysis.reasons[0] || 'Analyzing...'
            : statusInfo.text;

        const executionModeTag = bot.config.executionMode === 'live'
            ? { text: 'LIVE', bg: 'bg-amber-100 dark:bg-amber-900', text_color: 'text-amber-700 dark:text-amber-300' }
            : { text: 'PAPER', bg: 'bg-sky-100 dark:bg-sky-900', text_color: 'text-sky-700 dark:text-sky-300' };

        return (
            <div className="grid grid-cols-[1fr,auto,1fr] gap-4 items-center p-3">
                {/* Left Column: Bot Name & Config */}
                <div className="flex items-center gap-3">
                    <div>
                        <h3 className="font-bold text-base text-slate-800 dark:text-slate-100">{config.pair}</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">{config.agent.name}</p>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-semibold bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded-full text-center">{config.timeFrame}</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-center ${executionModeTag.bg} ${executionModeTag.text_color}`}>{executionModeTag.text}</span>
                    </div>
                </div>
                
                {/* Middle Column: Status or PNL */}
                <div className="text-center min-h-[42px] flex flex-col justify-center">
                    {openPosition && livePrice ? (
                        <InfoItem label="Unrealized PNL" value={`${pnlIsProfit ? '+' : ''}$${pnl?.toFixed(2)}`} valueClassName={`text-lg ${pnlIsProfit ? 'text-emerald-500' : 'text-rose-500'}`} labelClassName="text-center" />
                    ) : (
                         <div className={`flex items-center justify-center gap-2 text-xs font-semibold px-3 py-1 rounded-full ${statusInfo.bg} ${statusInfo.text_color} ${statusInfo.pulse ? 'animate-pulse' : ''}`} title={primaryStatusText}>
                            {statusInfo.icon}
                            <span className="truncate max-w-[200px]">{primaryStatusText}</span>
                         </div>
                    )}
                    {openPosition && (
                         <div className="flex items-center justify-center gap-2 mt-1">
                            <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${openPosition.direction === 'LONG' ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300' : 'bg-rose-100 dark:bg-rose-900 text-rose-700 dark:text-rose-300'}`}>
                                {openPosition.direction}
                            </span>
                        </div>
                    )}
                </div>

                {/* Right Column: Controls & Uptime */}
                <div className="flex items-center justify-end gap-4">
                    <InfoItem label="Uptime" value={duration} labelClassName="text-right"/>
                    {renderControls()}
                    <button onClick={onToggle} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                       {isOpen ? <ChevronUp className="w-5 h-5"/> : <ChevronDown className="w-5 h-5" />}
                   </button>
                </div>
            </div>
        )
    }
    
    return (
        <div className={`bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/80`}>
            {renderHeader()}
            {isOpen &&
             <div className="px-4 pb-4 border-t border-slate-200 dark:border-slate-700">
                {status === BotStatus.Cooldown && bot.cooldownUntil && <div className="py-2 text-center"><CooldownDisplay endTime={bot.cooldownUntil}/></div>}
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 pt-3">
                    <div className="flex flex-col gap-4">
                        {openPosition && livePrice ? (
                            <PositionManager 
                                bot={bot}
                                onConfigChange={(partialConfig) => onUpdateBotConfig(bot.id, partialConfig)}
                            />
                        ) : (
                            <BotAnalysisDisplay analysis={bot.analysis} />
                        )}
                        <BotPerformanceSummary bot={bot} />
                        <BotConfigDetails config={config} onUpdate={(partialConfig) => onUpdateBotConfig(bot.id, partialConfig)} />
                        <BotHealthDisplay bot={bot} />
                    </div>
                     <div className="flex flex-col">
                        <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-base mb-2">Activity Log</h4>
                        <StructuredActivityLog log={bot.log} />
                    </div>
                </div>
            </div>}
        </div>
    );
};

export const RunningBots: React.FC<RunningBotsProps> = (props) => {
    const [openBotId, setOpenBotId] = useState<string | null>(null);

    useEffect(() => {
        const botIds = props.bots.map(b => b.id);
        
        // If the currently open bot is no longer valid (e.g., deleted), find a new one to open.
        if (openBotId && !botIds.includes(openBotId)) {
            setOpenBotId(botIds[0] || null);
        } 
        // If no bot is open, but there are bots available, open the first one.
        else if (!openBotId && botIds.length > 0) {
            setOpenBotId(botIds[0]);
        }
    }, [props.bots, openBotId]);


    const handleToggle = (botId: string) => {
        setOpenBotId(prev => (prev === botId ? null : botId));
    };
    
    if (props.bots.length === 0) return null;
    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100 font-semibold text-lg">
                    <ActivityIcon className="w-6 h-6 text-sky-500" />
                    Active Bots
                    <span className="text-sm font-normal bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2.5 py-1 rounded-full">{props.bots.length}</span>
                </div>
            </div>
            <div className="p-2 sm:p-4 space-y-3">
                {props.bots.map(bot => {
                    return <BotRow key={bot.id} {...props} bot={bot} onToggle={() => handleToggle(bot.id)} isOpen={openBotId === bot.id} />
                })}
            </div>
        </div>
    );
};
