
// components/AnalysisPreview.tsx


import React, { useRef, useEffect } from 'react';
import { Agent, TradeSignal, AgentParams, SentinelAnalysis, ConductorAnalysis, AstraXAnalysis, OmegaAnalysis, Kline, MarketDataContext } from '../types';
import { ChevronDown, ChevronUp, CheckCircleIcon, XCircleIcon, InfoIcon, SparklesIcon, ZapIcon } from './icons';

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
    const isMet = reason.startsWith('✅') || reason.startsWith('🚀');
    const isUnmet = reason.startsWith('❌');
    const isInfo = reason.startsWith('ℹ️') || reason.startsWith('Scan:') || reason.startsWith('Hunt:') || reason.startsWith('Kill:');
    const isWarning = reason.startsWith('⚠️');

    if (isMet || isUnmet || isInfo || isWarning) {
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
                <span className={textColor}>{reason}</span>
            </li>
        );
    }
    
    // Default for plain text reasons
    return <li className="text-slate-700 dark:text-slate-200">{reason}</li>;
};

const ProgressBar: React.FC<{ value: number; colorClass: string; height?: string }> = ({ value, colorClass, height = "h-2" }) => (
    <div className={`w-full bg-slate-200 dark:bg-slate-600 rounded-full ${height}`}>
        <div className={`${colorClass} ${height} rounded-full transition-all duration-300`} style={{ width: `${Math.min(value, 100)}%` }}></div>
    </div>
);

const OmegaAnalysisDisplay: React.FC<{ analysis: OmegaAnalysis }> = ({ analysis }) => {
    const { conviction, phases, feeExpectancy, sizing } = analysis;

    if (!phases) return null; // Safety check

    return (
        <div className="space-y-4 text-sm">
            <div className="bg-slate-900 rounded-lg p-3 border border-sky-500/30">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-sky-400 font-bold uppercase tracking-widest text-[10px]">Matrix Conviction</span>
                    <span className="text-white font-mono font-bold text-lg">{conviction}%</span>
                </div>
                <ProgressBar value={conviction} colorClass="bg-sky-500" height="h-3" />
            </div>

            {/* V3: 3-Phase Pipeline */}
            <div className="grid grid-cols-1 gap-3">
                <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded border border-slate-200 dark:border-slate-700">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">1. Scan Phase (4H/1H)</span>
                        <span className={`text-xs font-bold ${phases.scan.score === 100 ? 'text-emerald-500' : 'text-amber-500'}`}>
                            {phases.scan.bias}
                        </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 truncate">{phases.scan.reason}</p>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded border border-slate-200 dark:border-slate-700">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">2. Hunt Phase (15m)</span>
                        <span className={`text-xs font-bold ${phases.hunt.score > 0 ? 'text-sky-500' : 'text-slate-400'}`}>
                            {phases.hunt.setup}
                        </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 truncate">{phases.hunt.reason}</p>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded border border-slate-200 dark:border-slate-700">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">3. Kill Phase (1m)</span>
                        <span className={`text-xs font-bold ${phases.kill.score > 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                            {phases.kill.trigger}
                        </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 truncate">{phases.kill.reason}</p>
                </div>
            </div>

            {/* Fee Law & Sizing */}
            <div className="grid grid-cols-2 gap-3 mt-2">
                <div className={`p-2 rounded border ${feeExpectancy.passed ? 'bg-emerald-100/50 dark:bg-emerald-900/20 border-emerald-500/30' : 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-700'}`}>
                    <span className="text-[10px] text-slate-500 uppercase block mb-1">Fee Expectancy</span>
                    <div className="flex items-center gap-1">
                        <span className={`font-bold ${feeExpectancy.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>
                            {feeExpectancy.ratio > 0 ? `${feeExpectancy.ratio.toFixed(1)}x` : '-'}
                        </span>
                        {feeExpectancy.passed && <CheckCircleIcon className="w-3 h-3 text-emerald-500" />}
                    </div>
                </div>
                <div className="p-2 rounded bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                    <span className="text-[10px] text-slate-500 uppercase block mb-1">Dynamic Size</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                        {sizing.multiplier * 100}%
                    </span>
                </div>
            </div>
        </div>
    );
};

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
    const { conviction, regime, thesis, setupName, confidenceMetrics } = analysis;
    
    const regimeColor = regime === 'Strong Trend' ? 'text-indigo-600 dark:text-indigo-400' 
                      : regime === 'Choppy Market' ? 'text-amber-600 dark:text-amber-400' 
                      : regime === 'Volatile Expansion' ? 'text-rose-600 dark:text-rose-400'
                      : 'text-sky-600 dark:text-sky-400';

    const thesisColor = thesis === 'Bullish' ? 'text-emerald-600 dark:text-emerald-400'
                      : thesis === 'Bearish' ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-500 dark:text-slate-400';

    return (
        <div className="space-y-4 text-sm">
            {/* Market Context Card */}
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 dark:bg-slate-700/30 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-1">Matrix Engine</p>
                    <p className={`text-sm font-bold ${regimeColor}`}>{regime}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-700/30 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-1">Thesis Alignment</p>
                    <p className={`text-sm font-bold ${thesisColor}`}>{thesis}</p>
                </div>
            </div>

            {/* Setup Detection Card */}
            <div className={`p-3 rounded-lg border ${setupName ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
                <div className="flex items-start gap-3">
                    <SparklesIcon className={`w-5 h-5 mt-0.5 ${setupName ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
                    <div>
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                            {setupName ? 'Active Archetype' : 'Scanning Archetypes'}
                        </p>
                        <p className={`text-base font-bold ${setupName ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500 italic'}`}>
                            {setupName || 'Waiting for high-conviction Alpha...'}
                        </p>
                        {setupName && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                <span className="px-2 py-0.5 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 font-mono">
                                    Conviction: {conviction}%
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Multi-Dimensional Confidence Pillars */}
            {confidenceMetrics && (
                <div className="space-y-2.5 pt-3 border-t border-slate-200 dark:border-slate-700">
                    <h5 className="font-bold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest">Confidence Pillars</h5>
                    
                    <div>
                        <div className="flex justify-between text-xs mb-1">
                            <span>Market Structure</span>
                            <span className="font-bold">{confidenceMetrics.structure}%</span>
                        </div>
                        <ProgressBar value={confidenceMetrics.structure} colorClass="bg-sky-500" height="h-1.5" />
                    </div>

                    <div>
                        <div className="flex justify-between text-xs mb-1">
                            <span>Volume Flow (RVOL)</span>
                            <span className="font-bold">{confidenceMetrics.volume}%</span>
                        </div>
                        <ProgressBar value={confidenceMetrics.volume} colorClass="bg-indigo-500" height="h-1.5" />
                    </div>

                    <div>
                        <div className="flex justify-between text-xs mb-1">
                            <span>Technical Validity</span>
                            <span className="font-bold">{confidenceMetrics.technical}%</span>
                        </div>
                        <ProgressBar value={confidenceMetrics.technical} colorClass="bg-emerald-500" height="h-1.5" />
                    </div>

                    <div>
                        <div className="flex justify-between text-xs mb-1">
                            <span>Momentum Quality</span>
                            <span className="font-bold">{confidenceMetrics.momentum}%</span>
                        </div>
                        <ProgressBar value={confidenceMetrics.momentum} colorClass="bg-amber-500" height="h-1.5" />
                    </div>
                </div>
            )}
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
    const isOmegaAgent = agent.id === 25;

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
                        {isOmegaAgent && displayAnalysis.omegaAnalysis && (
                            <OmegaAnalysisDisplay analysis={displayAnalysis.omegaAnalysis} />
                        )}

                        {displayAnalysis.reasons.length > 0 && (
                            <div className={`text-xs flex-grow ${(isSentinelAgent || isOmegaAgent) && (displayAnalysis.sentinelAnalysis || displayAnalysis.omegaAnalysis) ? 'pt-3 border-t border-slate-200 dark:border-slate-700 mt-3' : ''}`}>
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
