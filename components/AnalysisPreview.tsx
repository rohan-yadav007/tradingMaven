
import React, { useState, useEffect } from 'react';
import { Agent, Kline, TradeSignal, AgentParams } from '../types';
import { getTradingSignal } from '../services/localAgentService';
import { CpuIcon, ChevronDown, ChevronUp } from './icons';

interface AnalysisPreviewProps {
    klines: Kline[];
    selectedPair: string;
    timeFrame: string;
    selectedAgent: Agent;
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

export const AnalysisPreview: React.FC<AnalysisPreviewProps> = ({ klines, selectedPair, timeFrame, selectedAgent, agentParams }) => {
    const [analysis, setAnalysis] = useState<TradeSignal | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const hasCustomParams = Object.keys(agentParams).length > 0;

    useEffect(() => {
        const performAnalysis = async () => {
            if (klines.length === 0) return;
            setIsLoading(true);
            try {
                // Agent now only provides signal and reasons. Risk params are handled at execution.
                const signalData = await getTradingSignal(selectedAgent, klines, timeFrame, agentParams);
                setAnalysis(signalData);
            } catch (error) {
                console.error("Analysis preview failed:", error);
                setAnalysis({ signal: 'HOLD', reasons: ['Error fetching analysis.'] });
            } finally {
                setIsLoading(false);
            }
        };

        const handler = setTimeout(() => {
            performAnalysis();
        }, 500);

        return () => {
            clearTimeout(handler);
        };

    }, [klines, selectedPair, timeFrame, selectedAgent, agentParams]);

    return (
        <div className="bg-white dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700/50">
            <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700/50 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <CpuIcon className="w-5 h-5 text-sky-500" />
                    <h3 className="text-sm font-semibold mb-0 text-slate-800 dark:text-slate-200">AI Analysis Preview</h3>
                </div>
                {isLoading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-sky-500"></div>}
            </div>
            <div className="p-3">
                 <div className="text-xs bg-slate-100 dark:bg-slate-700/50 rounded p-2 mb-3 space-y-1">
                    <p className="mb-0 text-slate-600 dark:text-slate-400">Agent: <span className="font-semibold text-slate-900 dark:text-slate-100">{selectedAgent.name}</span></p>
                    <p className="mb-0 text-slate-600 dark:text-slate-400">
                        Parameters: <span className={`font-semibold ${hasCustomParams ? 'text-sky-600 dark:text-sky-400' : 'text-slate-900 dark:text-slate-100'}`}>{hasCustomParams ? "Customized" : "Default Settings"}</span>
                    </p>
                </div>
                {analysis && !isLoading ? (
                     <div className="flex items-start gap-3">
                        <SignalTag signal={analysis.signal} />
                        <div className="text-xs text-slate-600 dark:text-slate-400 flex-grow">
                            <ul className="list-disc list-inside space-y-1">
                                {analysis.reasons.map((reason, index) => (
                                    <li key={index}>{reason}</li>
                                ))}
                            </ul>
                        </div>
                     </div>
                ) : (
                    !analysis && !isLoading && (
                        <div className="text-center text-sm text-slate-500 pt-4">Waiting for market data...</div>
                    )
                )}
            </div>
        </div>
    );
};
