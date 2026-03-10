
// components/AnalysisPreview.tsx

import React from 'react';
import { Agent, TradeSignal, AgentParams, OmegaAnalysis } from '../types';
import { ActivityIcon, SparklesIcon, ZapIcon, ChartIcon } from './icons';
import { pairProfileService } from '../services/pairProfileService';

interface AnalysisPreviewProps {
    analysis: TradeSignal | null;
    isLoading: boolean;
    agent: Agent;
    agentParams?: AgentParams;
    compact?: boolean;
}

const ProgressBar: React.FC<{ value: number; colorClass: string; height?: string }> = ({ value, colorClass, height = "h-2" }) => (
    <div className={`w-full bg-slate-200 dark:bg-slate-700 rounded-full ${height}`}>
        <div className={`${colorClass} ${height} rounded-full transition-all duration-300`} style={{ width: `${Math.min(value, 100)}%` }}></div>
    </div>
);

const StepCard: React.FC<{ 
    label: string; 
    status: string; 
    isActive: boolean; 
    icon?: React.ReactNode 
}> = ({ label, status, isActive, icon }) => {
    const baseBorder = "border-slate-200 dark:border-slate-700";
    const activeBorder = "border-indigo-500 dark:border-indigo-400";
    const baseBg = "bg-slate-50 dark:bg-slate-800/50";
    const activeBg = "bg-indigo-50 dark:bg-indigo-900/20";

    return (
        <div className={`flex flex-col p-2.5 rounded-lg border ${isActive ? `${activeBorder} ${activeBg}` : `${baseBorder} ${baseBg}`} transition-colors duration-200`}>
            <div className="flex items-center gap-1.5 mb-1">
                {icon}
                <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">{label}</span>
            </div>
            <span className={`text-[11px] font-bold truncate ${isActive ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-400'}`}>
                {status}
            </span>
        </div>
    );
};

const SentimentCard: React.FC<{ label: string; value: string; trend?: 'bullish' | 'bearish' | 'neutral' }> = ({ label, value, trend }) => (
    <div className="flex justify-between items-center p-2 bg-slate-50 dark:bg-slate-800/30 rounded border border-slate-100 dark:border-slate-700/50">
        <span className="text-[9px] text-slate-500 font-semibold uppercase">{label}</span>
        <span className={`text-[10px] font-bold font-mono ${trend === 'bullish' ? 'text-emerald-500' : trend === 'bearish' ? 'text-rose-500' : 'text-slate-400'}`}>
            {value}
        </span>
    </div>
);

const ScorePillar: React.FC<{ label: string; score: number }> = ({ label, score }) => (
    <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[8px] font-bold text-slate-500 uppercase">
            <span>{label}</span>
            <span>{score.toFixed(0)}</span>
        </div>
        <ProgressBar value={score} colorClass="bg-indigo-400" height="h-1" />
    </div>
);

const OmegaAnalysisDisplay: React.FC<{ analysis: OmegaAnalysis; setupType?: string; omegaMetadata?: any; compact?: boolean }> = ({ analysis, setupType, omegaMetadata, compact }) => {
    const hasModel = pairProfileService.hasModel();
    const { conviction, intent, marketState, poiStatus, triggerStatus, sentiment, scoreBreakdown, sessionAnalysis, htfAlignment, modelScore } = analysis;

    // Resolve the active setup label: use real setup type when a trigger is ready
    const triggerLabel = triggerStatus.ready && setupType
        ? setupType
        : triggerStatus.condition;

    // Session badge color
    const sessionColor = sessionAnalysis?.includes('Dead Zone')
        ? 'bg-rose-900/60 text-rose-300'
        : sessionAnalysis?.includes('US')
        ? 'bg-emerald-900/60 text-emerald-300'
        : sessionAnalysis?.includes('London')
        ? 'bg-sky-900/60 text-sky-300'
        : 'bg-slate-700/60 text-slate-400';

    return (
        <div className="space-y-3">
            <div className="bg-slate-900 rounded-lg p-3 border border-indigo-500/30 shadow-lg">
                <div className="flex justify-between items-center mb-3">
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
                        <SparklesIcon className="w-3 h-3" /> Omega Prime
                    </span>
                    <div className="flex items-center gap-1.5">
                        {sessionAnalysis && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${sessionColor}`}>{sessionAnalysis}</span>
                        )}
                        {hasModel && !modelScore && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-violet-900/60 text-violet-300" title="Model active — score shown when a setup is detected">Model ✦</span>
                        )}
                        {hasModel && modelScore && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-violet-900/60 text-violet-300">Model ✓</span>
                        )}
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-500 text-white uppercase">{intent || 'Growth'}</span>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                    <StepCard
                        label="1H Structure"
                        status={marketState.bias1H}
                        isActive={marketState.bias1H !== 'Neutral'}
                        icon={<ChartIcon className="w-3 h-3 text-slate-400" />}
                    />
                    <StepCard
                        label="POI Type"
                        status={poiStatus.type === 'None' ? poiStatus.distance : poiStatus.type}
                        isActive={poiStatus.type !== 'None'}
                        icon={<ActivityIcon className="w-3 h-3 text-slate-400" />}
                    />
                    <StepCard
                        label="Setup Trigger"
                        status={triggerLabel}
                        isActive={triggerStatus.ready}
                        icon={<ZapIcon className="w-3 h-3 text-slate-400" />}
                    />
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                    <SentimentCard
                        label="Money Flow (OI)"
                        value={sentiment.oiState || 'Neutral'}
                        trend={(sentiment.oiState === 'Long Buildup' || sentiment.oiState === 'Short Buildup') ? 'bullish' : (sentiment.oiState === 'Short Covering' || sentiment.oiState === 'Long Liquidation') ? 'bearish' : 'neutral'}
                    />
                    <SentimentCard
                        label="CVD Flow"
                        value={sentiment.cvdState}
                        trend={sentiment.cvdState === 'Absorption' ? 'bullish' : sentiment.cvdState === 'Distribution' ? 'bearish' : 'neutral'}
                    />
                </div>

                {/* 4H Alignment — always shown */}
                <div className="mt-2">
                    <SentimentCard
                        label="4H Structure"
                        value={htfAlignment ?? 'Scanning'}
                        trend={htfAlignment === 'Aligned' ? 'bullish' : htfAlignment === 'Conflicted' ? 'bearish' : 'neutral'}
                    />
                </div>

                {/* Model cards — only shown when a model is trained */}
                {modelScore && (
                    <div className="mt-2 space-y-1.5">
                        <SentimentCard
                            label="Model Delta"
                            value={modelScore.delta > 0 ? `+${modelScore.delta} (${modelScore.activeCount} hits)` : modelScore.delta < 0 ? `${modelScore.delta} (opposing)` : 'Neutral'}
                            trend={modelScore.delta > 0 ? 'bullish' : modelScore.delta < 0 ? 'bearish' : 'neutral'}
                        />
                        {modelScore.hourWinRate > 0 && (
                            <SentimentCard
                                label="Hour Win Rate"
                                value={`${modelScore.hourWinRate}% this UTC hour`}
                                trend={modelScore.hourWinRate >= 60 ? 'bullish' : modelScore.hourWinRate < 45 ? 'bearish' : 'neutral'}
                            />
                        )}
                    </div>
                )}

                {/* SL / TP source — only shown when a live signal is active */}
                {omegaMetadata && (omegaMetadata.slSource || omegaMetadata.tpSource) && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                        <SentimentCard
                            label="SL Anchor"
                            value={omegaMetadata.slSource || 'ATR'}
                            trend="neutral"
                        />
                        <SentimentCard
                            label="TP Target"
                            value={omegaMetadata.tpSource || 'Fallback'}
                            trend={omegaMetadata.tpSource?.includes('Pool') ? 'bullish' : omegaMetadata.tpSource?.includes('FVG') ? 'bullish' : 'neutral'}
                        />
                    </div>
                )}

                {scoreBreakdown && (
                    <div className={`mt-3 grid ${modelScore ? 'grid-cols-4' : 'grid-cols-3'} gap-1.5 p-2 bg-slate-800/50 rounded border border-slate-700/50`}>
                        <ScorePillar label="Structure" score={scoreBreakdown.structure} />
                        <ScorePillar label="Momentum" score={scoreBreakdown.momentum} />
                        <ScorePillar label="Context" score={scoreBreakdown.context} />
                        {/* Model pillar only shown when a trained model is providing a delta */}
                        {modelScore && <ScorePillar label="Model" score={Math.max(0, Math.min(100, 50 + (scoreBreakdown.model ?? 0) * 2.5))} />}
                    </div>
                )}

                <div className="mt-4">
                    <div className="flex justify-between text-[8px] font-bold text-slate-500 uppercase mb-1">
                        <span>Entry Conviction</span>
                        <span>{conviction.toFixed(0)}%</span>
                    </div>
                    <ProgressBar value={conviction} colorClass="bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]" height="h-1.5" />
                </div>
            </div>
        </div>
    );
};

export const AnalysisPreview: React.FC<AnalysisPreviewProps> = ({ analysis, agent, compact = false }) => {
    if (!analysis) {
        return (
            <div className="text-center py-6">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500 mx-auto mb-2"></div>
                <p className="text-[10px] text-slate-500">Synthesizing Singularity flow...</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
             <div className="flex items-center justify-between bg-slate-100 dark:bg-slate-700/50 rounded-lg p-2 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2">
                    <ActivityIcon className="w-4 h-4 text-sky-500" />
                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100">{agent.name}</span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${analysis.signal === 'BUY' ? 'bg-emerald-500 text-white' : analysis.signal === 'SELL' ? 'bg-rose-500 text-white' : 'bg-slate-500 text-white'}`}>
                    {analysis.signal}
                </span>
            </div>
            {agent.id === 25 && analysis.omegaAnalysis && (
                <OmegaAnalysisDisplay
                    analysis={analysis.omegaAnalysis}
                    setupType={analysis.setupType}
                    omegaMetadata={analysis.omegaMetadata}
                    compact={compact}
                />
            )}
            {!analysis.omegaAnalysis && (
                <div className="space-y-2">
                    <ul className="space-y-1">
                        {analysis.reasons.map((r, i) => (
                            <li key={i} className="text-[10px] text-slate-600 dark:text-slate-400 flex gap-2">
                                <span>•</span> <span>{r}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};
