import React, { useRef, useEffect } from 'react';
import { Agent, TradeSignal, AgentParams, SentinelAnalysis, ConductorAnalysis, AstraXAnalysis } from '../types';
import { ChevronDown, ChevronUp, CheckCircleIcon, XCircleIcon, InfoIcon } from './icons';

interface AnalysisPreviewProps {
    analysis: TradeSignal | null;
    isLoading: boolean;
    agent: Agent;
    agentParams?: AgentParams;
}

const SignalTag: React.FC<{ signal: 'BUY' | 'SELL' | 'HOLD' }> = ({ signal }) => {
    const isBuy = signal === 'BUY';
    const isSell = signal === 'SELL';
    
    const colorClasses = isBuy 
        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300' 
        : isSell 
        ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300' 
        : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300';
        
    const icon = isBuy ? <ChevronUp className="w-5 h-5" /> : isSell ? <ChevronDown className="w-5 h-5" /> : null;

    return (
        <span className={`inline-flex items-center gap-1 px-3 py-1 text-base font-semibold rounded-full ${colorClasses}`}>
            {icon}
            <span>{signal}</span>
        </span>
    );
};

const ReasonItem: React.FC<{ reason: string }> = ({ reason }) => {
    const isMet = reason.startsWith('✅');
    const isUnmet = reason.startsWith('❌');
    const isInfo = reason.startsWith('ℹ️');
    const isWarning = reason.startsWith('⚠️');

    if (isMet || isUnmet || isInfo || isWarning) {
        const text = reason.substring(2).trim();
        let iconColor: string;
        let textColor: string;
        let Icon: React.FC<any>;

        if (isMet) {
            iconColor = 'text-emerald-500';
            textColor = 'text-slate-700 dark:text-slate-300';
            Icon = CheckCircleIcon;
        } else if (isUnmet) {
            iconColor = 'text-rose-500';
            textColor = 'text-slate-500 dark:text-slate-400';
            Icon = XCircleIcon;
        } else { // isInfo or isWarning
            iconColor = 'text-sky-500';
            textColor = 'text-slate-600 dark:text-slate-300';
            Icon = InfoIcon;
        }

        return (
            <li className="flex items-center gap-2">
                <Icon className={`w-4 h-4 flex-shrink-0 ${iconColor}`} />
                <span className={textColor}>{text}</span>
            </li>
        );
    }
    
    // Default for plain text reasons
    return <li className="text-slate-700 dark:text-slate-200">{reason}</li>;
};

const ProgressBar: React.FC<{ value: number; colorClass: string }> = ({ value, colorClass }) => (
    <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2">
        <div className={`${colorClass} h-2 rounded-full transition-all duration-300`} style={{ width: `${Math.min(value, 100)}%` }}></div>
    </div>
);

const SentinelAnalysisDisplay: React.FC<{ analysis: SentinelAnalysis }> = ({ analysis }) => {
    const { bullish, bearish } = analysis;

    return (
        <div className="space-y-4 text-sm">
            <div>
                <div className="flex justify-between items-baseline mb-1">
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">Bullish Score</span>
                    <span className="font-bold text-lg text-emerald-600 dark:text-emerald-400">{bullish.total.toFixed(0)}</span>
                </div>
                <ProgressBar value={bullish.total} colorClass="bg-emerald-500" />
                <div className="grid grid-cols-3 gap-2 text-xs text-center mt-1.5 text-slate-500 dark:text-slate-400">
                    <span>Struct: {bullish.structure.toFixed(0)}</span>
                    <span>Moment: {bullish.momentum.toFixed(0)}</span>
                    <span>Context: {bullish.context.toFixed(0)}</span>
                </div>
            </div>
             <div>
                <div className="flex justify-between items-baseline mb-1">
                    <span className="font-bold text-rose-600 dark:text-rose-400">Bearish Score</span>
                    <span className="font-bold text-lg text-rose-600 dark:text-rose-400">{bearish.total.toFixed(0)}</span>
                </div>
                <ProgressBar value={bearish.total} colorClass="bg-rose-500" />
                 <div className="grid grid-cols-3 gap-2 text-xs text-center mt-1.5 text-slate-500 dark:text-slate-400">
                    <span>Struct: {bearish.structure.toFixed(0)}</span>
                    <span>Moment: {bearish.momentum.toFixed(0)}</span>
                    <span>Context: {bearish.context.toFixed(0)}</span>
                </div>
            </div>
        </div>
    );
};

const ConductorAnalysisDisplay: React.FC<{ analysis: ConductorAnalysis }> = ({ analysis }) => {
    const { bullish, bearish } = analysis;

    return (
        <div className="space-y-4 text-sm">
            <div>
                <div className="flex justify-between items-baseline mb-1">
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">Bullish Conviction</span>
                    <span className="font-bold text-lg text-emerald-600 dark:text-emerald-400">{bullish.total.toFixed(0)}</span>
                </div>
                <ProgressBar value={bullish.total} colorClass="bg-emerald-500" />
                <div className="grid grid-cols-4 gap-2 text-xs text-center mt-1.5 text-slate-500 dark:text-slate-400">
                    <span>Struct: {bullish.structure.toFixed(0)}</span>
                    <span>Moment: {bullish.momentum.toFixed(0)}</span>
                    <span>Context: {bullish.context.toFixed(0)}</span>
                    <span>Confirm: {bullish.confirmation.toFixed(0)}</span>
                </div>
            </div>
             <div>
                <div className="flex justify-between items-baseline mb-1">
                    <span className="font-bold text-rose-600 dark:text-rose-400">Bearish Conviction</span>
                    <span className="font-bold text-lg text-rose-600 dark:text-rose-400">{bearish.total.toFixed(0)}</span>
                </div>
                <ProgressBar value={bearish.total} colorClass="bg-rose-500" />
                <div className="grid grid-cols-4 gap-2 text-xs text-center mt-1.5 text-slate-500 dark:text-slate-400">
                    <span>Struct: {bearish.structure.toFixed(0)}</span>
                    <span>Moment: {bearish.momentum.toFixed(0)}</span>
                    <span>Context: {bearish.context.toFixed(0)}</span>
                    <span>Confirm: {bearish.confirmation.toFixed(0)}</span>
                </div>
            </div>
        </div>
    );
};

const AstraXAnalysisDisplay: React.FC<{ analysis: AstraXAnalysis }> = ({ analysis }) => {
    const { conviction, threshold, regime } = analysis;
    const isBullish = conviction > 0;
    
    // Scale conviction from [-100, 100] to a [0, 100] percentage for the progress bar
    const barPercent = (conviction + 100) / 2;
    const thresholdPercent = (threshold / 100);

    return (
        <div className="space-y-4 text-sm">
             <div>
                <div className="flex justify-between items-baseline mb-1">
                    <span className="font-bold text-slate-800 dark:text-slate-200">Conviction Score</span>
                    <span className={`font-bold text-lg ${isBullish ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{conviction.toFixed(0)}</span>
                </div>
                 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 relative" title={`Conviction: ${conviction.toFixed(0)} | Threshold: ±${threshold.toFixed(0)}`}>
                    <div className="absolute top-0 bottom-0 w-0.5 bg-slate-400 dark:bg-slate-500" style={{ left: '50%' }}></div>
                    <div className="absolute top-0 bottom-0 h-full bg-slate-300 dark:bg-slate-600/50" style={{ left: `calc(50% - ${thresholdPercent * 50}%)`, width: `${thresholdPercent * 100}%` }}></div>
                    <div className="h-full rounded-full" style={{ background: 'linear-gradient(to right, #ef4444, #f87171, #fca5a5, #fde4e4, #e4e4e7, #dcfce7, #86efac, #22c55e, #16a34a)' }}>
                        <div className="h-full w-full relative">
                            <div className="absolute top-[-2px] bottom-[-2px] w-1 bg-slate-800 dark:bg-white rounded-full border border-white dark:border-slate-800 shadow-lg" style={{ left: `calc(${barPercent}% - 2px)` }}></div>
                        </div>
                    </div>
                </div>
                 <div className="text-xs text-center mt-1.5 text-slate-500 dark:text-slate-400">
                    Regime: <b>{regime}</b> | Entry Threshold: <b>±{threshold.toFixed(0)}</b>
                </div>
            </div>
        </div>
    );
};


export const AnalysisPreview: React.FC<AnalysisPreviewProps> = ({ analysis, isLoading, agent, agentParams = {} }) => {
    const hasCustomParams = Object.keys(agentParams).length > 0;
    const prevAnalysisRef = useRef(analysis);

    useEffect(() => {
        if (analysis) {
            prevAnalysisRef.current = analysis;
        }
    }, [analysis]);
    
    const displayAnalysis = analysis || prevAnalysisRef.current;
    const isSentinelAgent = agent.id === 14;
    const isConductorAgent = agent.id === 18;
    const isAstraXAgent = agent.id === 19;

    return (
        <div className="relative">
            <div className="text-xs bg-slate-100 dark:bg-slate-700/50 rounded p-2 mb-3 space-y-1">
                <p className="mb-0 text-slate-600 dark:text-slate-400">Agent: <span className="font-semibold text-slate-900 dark:text-slate-100">{agent.name}</span></p>
                <p className="mb-0 text-slate-600 dark:text-slate-400">
                    Parameters: <span className={`font-semibold ${hasCustomParams ? 'text-sky-600 dark:text-sky-400' : 'text-slate-900 dark:text-slate-100'}`}>{hasCustomParams ? "Customized" : "Default Settings"}</span>
                </p>
            </div>
            
            <div className={`transition-opacity duration-200 ${isLoading ? 'opacity-40 blur-sm pointer-events-none' : 'opacity-100'}`}>
                {displayAnalysis ? (
                     <div className="space-y-3">
                        <div className="flex items-start justify-between">
                           <SignalTag signal={displayAnalysis.signal} />
                        </div>
                        
                        {isSentinelAgent && displayAnalysis.sentinelAnalysis && (
                            <SentinelAnalysisDisplay analysis={displayAnalysis.sentinelAnalysis} />
                        )}
                        {isConductorAgent && displayAnalysis.conductorAnalysis && (
                            <ConductorAnalysisDisplay analysis={displayAnalysis.conductorAnalysis} />
                        )}
                        {isAstraXAgent && displayAnalysis.astraXAnalysis && (
                            <AstraXAnalysisDisplay analysis={displayAnalysis.astraXAnalysis} />
                        )}

                        {displayAnalysis.reasons.length > 0 && (
                            <div className={`text-xs flex-grow ${isSentinelAgent && displayAnalysis.sentinelAnalysis ? 'pt-3 border-t border-slate-200 dark:border-slate-700 mt-3' : ''}`}>
                                <ul className="space-y-1.5">
                                    {displayAnalysis.reasons.map((reason, index) => (
                                        <ReasonItem key={index} reason={reason} />
                                    ))}
                                </ul>
                            </div>
                        )}
                     </div>
                ) : (
                    <div className="text-center text-sm text-slate-500 pt-4">
                        Waiting for market data...
                    </div>
                )}
            </div>
        </div>
    );
};
