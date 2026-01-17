
// components/AnalysisPreview.tsx


import React, { useRef, useEffect } from 'react';
import { Agent, TradeSignal, AgentParams, SentinelAnalysis, ConductorAnalysis, AstraXAnalysis, OmegaAnalysis, Kline, MarketDataContext } from '../types';
import { ChevronDown, ChevronUp, CheckCircleIcon, XCircleIcon, InfoIcon, SparklesIcon, ZapIcon } from './icons';

interface AnalysisPreviewProps {
    analysis: TradeSignal | null;
    isLoading: boolean;
    agent: Agent;
    agentParams?: AgentParams;
    compact?: boolean;
}

const SignalTag: React.FC<{ signal: 'BUY' | 'SELL' | 'HOLD'; size?: 'sm' | 'md' }> = ({ signal, size = 'md' }) => {
    const isBuy = signal === 'BUY';
    const isSell = signal === 'SELL';
    
    const colorClasses = isBuy 
        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300' 
        : isSell 
        ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300' 
        : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300';
        
    const iconSize = size === 'sm' ? "w-3.5 h-3.5" : "w-5 h-5";
    const textClass = size === 'sm' ? "text-xs px-2 py-0.5" : "text-base px-3 py-1";

    const icon = isBuy ? <ChevronUp className={iconSize} /> : isSell ? <ChevronDown className={iconSize} /> : null;

    return (
        <span className={`inline-flex items-center gap-1 font-bold rounded-full ${textClass} ${colorClasses}`}>
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
                <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${iconColor}`} />
                <span className={textColor}>{reason}</span>
            </li>
        );
    }
    
    // Default for plain text reasons
    return <li className="text-slate-700 dark:text-slate-200">{reason}</li>;
};

const ProgressBar: React.FC<{ value: number; colorClass: string; height?: string }> = ({ value, colorClass, height = "h-2" }) => (
    <div className={`w-full bg-slate-200 dark:bg-slate-700 rounded-full ${height}`}>
        <div className={`${colorClass} ${height} rounded-full transition-all duration-300`} style={{ width: `${Math.min(value, 100)}%` }}></div>
    </div>
);

// New Component: Clean Pipeline Step for Omega
const PipelineStep: React.FC<{ 
    step: number, 
    label: string, 
    status: string, 
    isActive: boolean, 
    isPassed: boolean,
    details: string,
    compact?: boolean
}> = ({ step, label, status, isActive, isPassed, details, compact }) => {
    const statusColor = isPassed ? 'text-emerald-600 dark:text-emerald-400' : isActive ? 'text-sky-600 dark:text-sky-400' : 'text-slate-400';
    const bgClass = isActive ? 'bg-sky-50 dark:bg-sky-900/10 border-sky-200 dark:border-sky-800' : 'bg-transparent border-transparent';
    const numBg = isPassed ? 'bg-emerald-500 text-white' : isActive ? 'bg-sky-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-500';
    
    const labelSize = compact ? 'text-[10px]' : 'text-xs';
    const statusSize = compact ? 'text-[10px]' : 'text-xs';
    const detailSize = compact ? 'text-[10px]' : 'text-xs';
    const stepSize = compact ? 'w-5 h-5 text-[10px]' : 'w-6 h-6 text-xs';
    const padding = compact ? 'p-1.5' : 'p-2';

    return (
        <div className={`flex items-start gap-2 ${padding} rounded-lg border ${bgClass}`}>
            <div className={`flex-shrink-0 ${stepSize} rounded-full flex items-center justify-center font-bold ${numBg}`}>
                {step}
            </div>
            <div className="flex-grow min-w-0">
                <div className="flex justify-between items-baseline">
                    <span className={`${labelSize} font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400`}>{label}</span>
                    <span className={`${statusSize} font-bold ${statusColor}`}>{status}</span>
                </div>
                <p className={`${detailSize} text-slate-700 dark:text-slate-300 mt-0.5 truncate`} title={details}>
                    {details}
                </p>
            </div>
        </div>
    );
};

const OmegaAnalysisDisplay: React.FC<{ analysis: OmegaAnalysis, compact?: boolean }> = ({ analysis, compact }) => {
    const { conviction, phases, feeExpectancy, sizing, mode, targets } = analysis;

    if (!phases) return null;

    const activeModeColor = mode === 'Sniper' ? 'bg-rose-500' : mode === 'Conservative' ? 'bg-emerald-500' : 'bg-sky-500';
    const modeBadgeColor = mode === 'Sniper' ? 'text-rose-600 bg-rose-100 dark:bg-rose-900/30 dark:text-rose-300' : mode === 'Conservative' ? 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300' : 'text-sky-600 bg-sky-100 dark:bg-sky-900/30 dark:text-sky-300';
    
    const textSize = compact ? 'text-xs' : 'text-sm';
    const labelSize = compact ? 'text-[10px]' : 'text-xs';
    const scoreSize = compact ? 'text-sm' : 'text-lg';

    return (
        <div className="space-y-3">
            {/* Header: Conviction & Mode */}
            <div className="bg-white dark:bg-slate-800 rounded-lg p-2 border border-slate-200 dark:border-slate-700 shadow-sm">
                <div className="flex justify-between items-center mb-1">
                    <div className="flex items-center gap-2">
                        <span className={`${labelSize} font-bold text-slate-500 dark:text-slate-400 uppercase`}>Conviction</span>
                        {mode && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${modeBadgeColor}`}>
                                {mode.toUpperCase()}
                            </span>
                        )}
                    </div>
                    <span className={`font-mono font-bold ${scoreSize} text-slate-900 dark:text-slate-100`}>{conviction}%</span>
                </div>
                <ProgressBar value={conviction} colorClass={activeModeColor} height="h-1.5" />
            </div>

            {/* Pipeline Visualization */}
            <div className="space-y-1">
                <PipelineStep 
                    step={1} 
                    label="Scan" 
                    status={phases.scan.bias} 
                    isActive={phases.scan.score > 0 && phases.hunt.score === 0} 
                    isPassed={phases.scan.score >= 100}
                    details={phases.scan.reason}
                    compact={compact}
                />
                <PipelineStep 
                    step={2} 
                    label="Hunt" 
                    status={phases.hunt.setup} 
                    isActive={phases.hunt.score > 0 && phases.kill.score === 0} 
                    isPassed={phases.hunt.score >= 100}
                    details={phases.hunt.reason}
                    compact={compact}
                />
                <PipelineStep 
                    step={3} 
                    label="Kill" 
                    status={phases.kill.trigger} 
                    isActive={phases.kill.score > 0 && conviction < 100} 
                    isPassed={phases.kill.score >= 100}
                    details={phases.kill.reason}
                    compact={compact}
                />
                <PipelineStep 
                    step={4} 
                    label="Flow" 
                    status={phases.flow?.trend || 'Wait'} 
                    isActive={conviction >= 80} 
                    isPassed={conviction >= 90}
                    details={phases.flow?.reason || 'Pending Execution'}
                    compact={compact}
                />
            </div>

            {/* Metrics Footer - Updated Labels for Clarity */}
            <div className="flex gap-2">
                <div className={`flex-1 p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50`}>
                    <span className="text-[9px] text-slate-500 uppercase block">R:R</span>
                    <div className="flex items-center gap-1">
                        <span className={`${textSize} font-bold ${feeExpectancy.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>
                            {feeExpectancy.ratio > 0 ? `${feeExpectancy.ratio.toFixed(1)}` : '-'}
                        </span>
                        {feeExpectancy.passed && <CheckCircleIcon className="w-3 h-3 text-emerald-500" />}
                    </div>
                </div>
                <div className="flex-1 p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                    <span className="text-[9px] text-slate-500 uppercase block">Size</span>
                    <span className={`${textSize} font-bold text-slate-800 dark:text-slate-200`}>
                        {(sizing.multiplier * 100).toFixed(0)}%
                    </span>
                </div>
                 {targets && targets.takeProfit > 0 && (
                    <div className="flex-1 p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                        <span className="text-[9px] text-slate-500 uppercase block">TGT</span>
                        <div className="flex flex-col leading-none">
                            <span className="text-[9px] text-emerald-600 font-mono">TP: {targets.takeProfit.toFixed(1)}</span>
                            <span className="text-[9px] text-rose-600 font-mono">SL: {targets.stopLoss.toFixed(1)}</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const SentinelAnalysisDisplay: React.FC<{ analysis: SentinelAnalysis, compact?: boolean }> = ({ analysis, compact }) => {
    const { bullish, bearish } = analysis;
    const textSize = compact ? 'text-xs' : 'text-sm';
    const scoreSize = compact ? 'text-base' : 'text-lg';

    return (
        <div className={`space-y-3 ${textSize}`}>
            <div>
                <div className="flex justify-between items-baseline mb-1">
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">Bullish</span>
                    <span className={`font-bold ${scoreSize} text-emerald-600 dark:text-emerald-400`}>{bullish.total.toFixed(0)}</span>
                </div>
                <ProgressBar value={bullish.total} colorClass="bg-emerald-500" height="h-1.5" />
                <div className="grid grid-cols-3 gap-1 text-[10px] text-center mt-1 text-slate-500 dark:text-slate-400">
                    <span>St: {bullish.structure.toFixed(0)}</span>
                    <span>Mo: {bullish.momentum.toFixed(0)}</span>
                    <span>Cx: {bullish.context.toFixed(0)}</span>
                </div>
            </div>
             <div>
                <div className="flex justify-between items-baseline mb-1">
                    <span className="font-bold text-rose-600 dark:text-rose-400">Bearish</span>
                    <span className={`font-bold ${scoreSize} text-rose-600 dark:text-rose-400`}>{bearish.total.toFixed(0)}</span>
                </div>
                <ProgressBar value={bearish.total} colorClass="bg-rose-500" height="h-1.5" />
                 <div className="grid grid-cols-3 gap-1 text-[10px] text-center mt-1 text-slate-500 dark:text-slate-400">
                    <span>St: {bearish.structure.toFixed(0)}</span>
                    <span>Mo: {bearish.momentum.toFixed(0)}</span>
                    <span>Cx: {bearish.context.toFixed(0)}</span>
                </div>
            </div>
        </div>
    );
};

const ConductorAnalysisDisplay: React.FC<{ analysis: ConductorAnalysis, compact?: boolean }> = ({ analysis, compact }) => {
    const { bullish, bearish } = analysis;
    const textSize = compact ? 'text-xs' : 'text-sm';
    const scoreSize = compact ? 'text-base' : 'text-lg';

    return (
        <div className={`space-y-3 ${textSize}`}>
            <div>
                <div className="flex justify-between items-baseline mb-1">
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">Bullish</span>
                    <span className={`font-bold ${scoreSize} text-emerald-600 dark:text-emerald-400`}>{bullish.total.toFixed(0)}</span>
                </div>
                <ProgressBar value={bullish.total} colorClass="bg-emerald-500" height="h-1.5" />
                <div className="grid grid-cols-4 gap-1 text-[10px] text-center mt-1 text-slate-500 dark:text-slate-400">
                    <span>St:{bullish.structure.toFixed(0)}</span>
                    <span>Mo:{bullish.momentum.toFixed(0)}</span>
                    <span>Cx:{bullish.context.toFixed(0)}</span>
                    <span>Cf:{bullish.confirmation.toFixed(0)}</span>
                </div>
            </div>
             <div>
                <div className="flex justify-between items-baseline mb-1">
                    <span className="font-bold text-rose-600 dark:text-rose-400">Bearish</span>
                    <span className={`font-bold ${scoreSize} text-rose-600 dark:text-rose-400`}>{bearish.total.toFixed(0)}</span>
                </div>
                <ProgressBar value={bearish.total} colorClass="bg-rose-500" height="h-1.5" />
                <div className="grid grid-cols-4 gap-1 text-[10px] text-center mt-1 text-slate-500 dark:text-slate-400">
                    <span>St:{bearish.structure.toFixed(0)}</span>
                    <span>Mo:{bearish.momentum.toFixed(0)}</span>
                    <span>Cx:{bearish.context.toFixed(0)}</span>
                    <span>Cf:{bearish.confirmation.toFixed(0)}</span>
                </div>
            </div>
        </div>
    );
};

const AstraXAnalysisDisplay: React.FC<{ analysis: AstraXAnalysis, compact?: boolean }> = ({ analysis, compact }) => {
    const { conviction, regime, thesis, setupName, confidenceMetrics } = analysis;
    
    const regimeColor = regime === 'Strong Trend' ? 'text-indigo-600 dark:text-indigo-400' 
                      : regime === 'Choppy Market' ? 'text-amber-600 dark:text-amber-400' 
                      : regime === 'Volatile Expansion' ? 'text-rose-600 dark:text-rose-400'
                      : 'text-sky-600 dark:text-sky-400';

    const thesisColor = thesis === 'Bullish' ? 'text-emerald-600 dark:text-emerald-400'
                      : thesis === 'Bearish' ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-500 dark:text-slate-400';
                      
    const padding = compact ? 'p-2' : 'p-2.5';
    const textSize = compact ? 'text-xs' : 'text-sm';
    const smallText = compact ? 'text-[10px]' : 'text-xs';

    return (
        <div className={`space-y-3 ${textSize}`}>
            {/* Market Context Card */}
            <div className="grid grid-cols-2 gap-2">
                <div className={`bg-slate-50 dark:bg-slate-700/30 ${padding} rounded-lg border border-slate-200 dark:border-slate-700`}>
                    <p className={`${smallText} text-slate-500 dark:text-slate-400 font-medium mb-0.5`}>Matrix</p>
                    <p className={`${textSize} font-bold ${regimeColor} truncate`}>{regime}</p>
                </div>
                <div className={`bg-slate-50 dark:bg-slate-700/30 ${padding} rounded-lg border border-slate-200 dark:border-slate-700`}>
                    <p className={`${smallText} text-slate-500 dark:text-slate-400 font-medium mb-0.5`}>Alignment</p>
                    <p className={`${textSize} font-bold ${thesisColor}`}>{thesis}</p>
                </div>
            </div>

            {/* Setup Detection Card */}
            <div className={`${padding} rounded-lg border ${setupName ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
                <div className="flex items-start gap-2">
                    <SparklesIcon className={`w-4 h-4 mt-0.5 ${setupName ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
                    <div className="min-w-0">
                        <p className={`${smallText} font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate`}>
                            {setupName ? 'Active Archetype' : 'Scanning'}
                        </p>
                        <p className={`${textSize} font-bold ${setupName ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500 italic'} truncate`}>
                            {setupName || 'Waiting...'}
                        </p>
                        {setupName && (
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-600 dark:text-slate-300">
                                <span className="px-1.5 py-0.5 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 font-mono">
                                    Conf: {conviction}%
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Multi-Dimensional Confidence Pillars */}
            {confidenceMetrics && (
                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <h5 className={`font-bold ${smallText} text-slate-500 dark:text-slate-400 uppercase tracking-widest`}>Confidence</h5>
                    
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        <div>
                            <div className={`flex justify-between ${smallText} mb-0.5`}>
                                <span>Struct</span>
                                <span className="font-bold">{confidenceMetrics.structure}%</span>
                            </div>
                            <ProgressBar value={confidenceMetrics.structure} colorClass="bg-sky-500" height="h-1" />
                        </div>

                        <div>
                            <div className={`flex justify-between ${smallText} mb-0.5`}>
                                <span>Vol</span>
                                <span className="font-bold">{confidenceMetrics.volume}%</span>
                            </div>
                            <ProgressBar value={confidenceMetrics.volume} colorClass="bg-indigo-500" height="h-1" />
                        </div>

                        <div>
                            <div className={`flex justify-between ${smallText} mb-0.5`}>
                                <span>Tech</span>
                                <span className="font-bold">{confidenceMetrics.technical}%</span>
                            </div>
                            <ProgressBar value={confidenceMetrics.technical} colorClass="bg-emerald-500" height="h-1" />
                        </div>

                        <div>
                            <div className={`flex justify-between ${smallText} mb-0.5`}>
                                <span>Momt</span>
                                <span className="font-bold">{confidenceMetrics.momentum}%</span>
                            </div>
                            <ProgressBar value={confidenceMetrics.momentum} colorClass="bg-amber-500" height="h-1" />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};


export const AnalysisPreview: React.FC<AnalysisPreviewProps> = ({ analysis, isLoading, agent, agentParams = {}, compact = false }) => {
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
    
    const headerPadding = compact ? 'p-1.5 mb-2' : 'p-2 mb-3';
    const bodyTextSize = compact ? 'text-[10px]' : 'text-xs';

    return (
        <div className="relative">
            {/* Unified Header */}
            <div className={`flex items-center justify-between bg-slate-100 dark:bg-slate-700/50 rounded-lg ${headerPadding} border border-slate-200 dark:border-slate-700`}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 overflow-hidden">
                    <span className={`font-bold ${compact ? 'text-xs' : 'text-sm'} text-slate-900 dark:text-slate-100 truncate`}>
                        {agent.name}
                    </span>
                    <span className={`text-[9px] uppercase tracking-wide ${hasCustomParams ? 'text-sky-600 dark:text-sky-400 font-bold' : 'text-slate-500 dark:text-slate-400'}`}>
                        {hasCustomParams ? "Custom" : "Default"}
                    </span>
                </div>
                
                {displayAnalysis && (
                    <div className="flex-shrink-0 ml-2">
                        <SignalTag signal={displayAnalysis.signal} size="sm" />
                    </div>
                )}
            </div>
            
            <div className={`transition-opacity duration-200 ${isLoading ? 'opacity-40 blur-sm pointer-events-none' : 'opacity-100'}`}>
                {displayAnalysis ? (
                     <div className="space-y-3">
                        {isSentinelAgent && displayAnalysis.sentinelAnalysis && (
                            <SentinelAnalysisDisplay analysis={displayAnalysis.sentinelAnalysis} compact={compact} />
                        )}
                        {isConductorAgent && displayAnalysis.conductorAnalysis && (
                            <ConductorAnalysisDisplay analysis={displayAnalysis.conductorAnalysis} compact={compact} />
                        )}
                        {isAstraXAgent && displayAnalysis.astraXAnalysis && (
                            <AstraXAnalysisDisplay analysis={displayAnalysis.astraXAnalysis} compact={compact} />
                        )}
                        {isOmegaAgent && displayAnalysis.omegaAnalysis && (
                            <OmegaAnalysisDisplay analysis={displayAnalysis.omegaAnalysis} compact={compact} />
                        )}

                        {/* HIDE GENERIC REASONS FOR OMEGA to prevent duplication */}
                        {(!isOmegaAgent && displayAnalysis.reasons.length > 0) && (
                            <div className={`${bodyTextSize} flex-grow ${(isSentinelAgent) && (displayAnalysis.sentinelAnalysis) ? 'pt-2 border-t border-slate-200 dark:border-slate-700 mt-2' : ''}`}>
                                <ul className="space-y-1">
                                    {displayAnalysis.reasons.map((reason, index) => (
                                        <ReasonItem key={index} reason={reason} />
                                    ))}
                                </ul>
                            </div>
                        )}
                     </div>
                ) : (
                    <div className={`text-center ${compact ? 'text-xs' : 'text-sm'} text-slate-500 pt-4`}>
                        Waiting for market data...
                    </div>
                )}
            </div>
        </div>
    );
};
