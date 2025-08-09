
import React from 'react';
import { Agent, TradeSignal, AgentParams } from '../types';
import { ChevronDown, ChevronUp, CheckCircleIcon, XCircleIcon, InfoIcon } from './icons';

interface AnalysisPreviewProps {
    analysis: TradeSignal | null;
    isLoading: boolean;
    agent: Agent;
    agentParams: AgentParams;
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

    // Default for non-checklist items (headers, summaries)
    return <li className="font-semibold text-slate-700 dark:text-slate-200">{reason}</li>;
};

export const AnalysisPreview: React.FC<AnalysisPreviewProps> = ({ analysis, isLoading, agent, agentParams }) => {
    const hasCustomParams = Object.keys(agentParams).length > 0;

    return (
        <>
            <div className="text-xs bg-slate-100 dark:bg-slate-700/50 rounded p-2 mb-3 space-y-1">
                <p className="mb-0 text-slate-600 dark:text-slate-400">Agent: <span className="font-semibold text-slate-900 dark:text-slate-100">{agent.name}</span></p>
                <p className="mb-0 text-slate-600 dark:text-slate-400">
                    Parameters: <span className={`font-semibold ${hasCustomParams ? 'text-sky-600 dark:text-sky-400' : 'text-slate-900 dark:text-slate-100'}`}>{hasCustomParams ? "Customized" : "Default Settings"}</span>
                </p>
            </div>
            {analysis && !isLoading ? (
                 <div className="flex items-start gap-4">
                    <SignalTag signal={analysis.signal} />
                    <div className="text-xs text-slate-600 dark:text-slate-400 flex-grow">
                        <ul className="space-y-1.5">
                            {analysis.reasons.map((reason, index) => (
                                <ReasonItem key={index} reason={reason} />
                            ))}
                        </ul>
                    </div>
                 </div>
            ) : (
                <div className="text-center text-sm text-slate-500 pt-4">
                    {isLoading ? 'Analyzing...' : 'Waiting for market data...'}
                </div>
            )}
        </>
    );
};
