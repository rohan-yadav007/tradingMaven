import React, { useRef, useEffect } from 'react';
import { Agent, TradeSignal, AgentParams, SentinelAnalysis } from '../types';
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

    if (isMet || isUnmet || isInfo) {
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
        } else { // isInfo
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
                    <span>Trend: {bullish.trend.toFixed(0)}%</span>
                    <span>Momentum: {bullish.momentum.toFixed(0)}%</span>
                    <span>Confirm: {bullish.confirmation.toFixed(0)}%</span>
                </div>
            </div>
             <div>
                <div className="flex justify-between items-baseline mb-1">
                    <span className="font-bold text-rose-600 dark:text-rose-400">Bearish Score</span>
                    <span className="font-bold text-lg text-rose-600 dark:text-rose-400">{bearish.total.toFixed(0)}</span>
                </div>
                <ProgressBar value={bearish.total} colorClass="bg-rose-500" />
                <div className="grid grid-cols-3 gap-2 text-xs text-center mt-1.5 text-slate-500 dark:text-slate-400">
                    <span>Trend: {bearish.trend.toFixed(0)}%</span>
                    <span>Momentum: {bearish.momentum.toFixed(0)}%</span>
                    <span>Confirm: {bearish.confirmation.toFixed(0)}%</span>
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

                        {(!isSentinelAgent || !displayAnalysis.sentinelAnalysis) && (
                             <div className="text-xs text-slate-600 dark:text-slate-400 flex-grow">
                                <ul className="space-y-1.5">
                                    {displayAnalysis.reasons.map((reason, index) => (
                                        <ReasonItem key={index} reason={reason} />
                                    ))}
                                </ul>
                            </div>
                        )}

                        {isSentinelAgent && displayAnalysis.reasons.length > 0 && (
                            <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                                 <ul className="space-y-1.5 text-xs">
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
