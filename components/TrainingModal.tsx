
// components/TrainingModal.tsx
// Multi-pair Universal Pattern Training Modal.
// Trains on N pairs, aggregates into a universal cross-pair model,
// saves it so Omega can use it as a real-time confidence modifier.

import React, { useState, useCallback, useRef } from 'react';
import { TradingMode } from '../types';
import { TIME_FRAMES } from '../constants';
import {
    trainMultiPair, PairTrainingResult, TrainingProgress, TrainingDuration, UniversalSignalModel
} from '../services/trainingService';
import { pairProfileService } from '../services/pairProfileService';
import { botManagerService } from '../services/botManagerService';
import { CloseIcon } from './icons';

interface Props {
    onClose: () => void;
    availablePairs: string[];
}

const DURATIONS: { label: string; value: TrainingDuration; hint: string }[] = [
    { label: '3 Days',   value: '3d',  hint: 'Quick sanity check' },
    { label: '10 Days',  value: '10d', hint: 'Short-term patterns' },
    { label: '1 Month',  value: '1m',  hint: 'Recommended baseline' },
    { label: '3 Months', value: '3m',  hint: 'Seasonal patterns' },
    { label: '6 Months', value: '6m',  hint: 'Deep regime analysis' },
    { label: '1 Year',   value: '1y',  hint: 'Full cycle view' },
];

const QUICK_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT'];

// ── Small helpers ──────────────────────────────────────────────────────

const wr = (v: number) =>
    v >= 65 ? 'text-emerald-400' : v >= 52 ? 'text-sky-400' : v >= 42 ? 'text-amber-400' : 'text-red-400';

const WinBar: React.FC<{ value: number; small?: boolean }> = ({ value, small }) => (
    <div className={`flex items-center gap-2 ${small ? 'mt-0' : 'mt-1'}`}>
        <div className={`flex-1 ${small ? 'h-1' : 'h-1.5'} bg-slate-700 rounded-full overflow-hidden`}>
            <div className={`h-full rounded-full ${value >= 65 ? 'bg-emerald-400' : value >= 52 ? 'bg-sky-400' : value >= 42 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${value}%` }} />
        </div>
        <span className={`${small ? 'text-[10px]' : 'text-xs'} font-bold tabular-nums ${wr(value)}`}>{value}%</span>
    </div>
);

const Pill: React.FC<{ label: string; value: string | number; color?: string }> = ({ label, value, color = 'text-slate-100' }) => (
    <div className="bg-slate-800 rounded-lg px-3 py-2">
        <span className="text-[10px] text-slate-500 uppercase tracking-wide block">{label}</span>
        <span className={`text-sm font-bold ${color}`}>{value}</span>
    </div>
);

const Sparkline: React.FC<{ data: PairTrainingResult['chartData'] }> = ({ data }) => {
    if (data.length < 2) return null;
    const prices = data.map(d => d.close);
    const min = Math.min(...prices), max = Math.max(...prices), range = max - min || 1;
    const W = 300, H = 50;
    const pts = prices.map((p, i) => `${(i / (prices.length - 1)) * W},${H - ((p - min) / range) * H}`).join(' ');
    const isUp = prices[prices.length - 1] >= prices[0];
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-10" preserveAspectRatio="none">
            <polyline points={pts} fill="none" stroke={isUp ? '#10b981' : '#ef4444'} strokeWidth="1.5" />
        </svg>
    );
};

const HeatmapRow: React.FC<{ data: Record<number, number> }> = ({ data }) => (
    <div className="flex flex-wrap gap-0.5 mt-1">
        {Array.from({ length: 24 }, (_, h) => {
            const v = data[h] ?? 0;
            const bg = v === 0 ? 'bg-slate-700' : v >= 60 ? 'bg-emerald-600' : v >= 50 ? 'bg-sky-600' : v >= 40 ? 'bg-amber-600' : 'bg-red-700';
            return <div key={h} title={`${String(h).padStart(2, '0')}:00 UTC — ${v}%`} className={`w-5 h-5 rounded-sm flex items-center justify-center text-[8px] font-semibold text-white/80 cursor-default ${bg}`}>{String(h).padStart(2, '0')}</div>;
        })}
    </div>
);

// ── Universal Condition Card ───────────────────────────────────────────

const CondCard: React.FC<{ cond: UniversalSignalModel['conditions'][0] }> = ({ cond }) => (
    <div className="bg-slate-800 border border-slate-700/70 rounded-lg p-3">
        <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${cond.direction === 'LONG' ? 'bg-emerald-900/60 text-emerald-400' : 'bg-red-900/60 text-red-400'}`}>{cond.direction}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400`}>{cond.category}</span>
                </div>
                <p className="text-xs font-semibold text-slate-100 mt-1 leading-tight">{cond.name}</p>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{cond.description}</p>
            </div>
            <div className="text-right shrink-0">
                <div className={`text-base font-bold ${wr(cond.globalWinRate)}`}>{cond.globalWinRate}%</div>
                <div className="text-[9px] text-slate-500">{cond.trainedPairs} pairs</div>
            </div>
        </div>
        <WinBar value={cond.globalWinRate} />
        <div className="flex gap-3 mt-1.5 text-[10px] text-slate-500">
            <span>Consistency: <span className={`font-semibold ${cond.consistency >= 70 ? 'text-emerald-400' : cond.consistency >= 50 ? 'text-sky-400' : 'text-amber-400'}`}>{cond.consistency}%</span></span>
            <span>Avg R: <span className="text-emerald-400 font-semibold">{cond.avgRMultiple.toFixed(1)}R</span></span>
            <span>Delta: <span className={`font-bold ${cond.confidenceDelta >= 0 ? 'text-sky-400' : 'text-red-400'}`}>{cond.confidenceDelta >= 0 ? '+' : ''}{cond.confidenceDelta}</span></span>
        </div>
    </div>
);

// ── Main Modal ─────────────────────────────────────────────────────────

export const TrainingModal: React.FC<Props> = ({ onClose, availablePairs }) => {
    const [selectedPairs, setSelectedPairs] = useState<string[]>([]);
    const [timeframe, setTimeframe] = useState('5m');
    const [duration, setDuration] = useState<TrainingDuration>('1m');
    const [mode, setMode] = useState<TradingMode>(TradingMode.USDSM_Futures);
    const [customPair, setCustomPair] = useState('');

    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState<TrainingProgress | null>(null);
    const [pairResults, setPairResults] = useState<Map<string, PairTrainingResult>>(new Map());
    const [universalModel, setUniversalModel] = useState<UniversalSignalModel | null>(() => pairProfileService.getModel());
    const [activePair, setActivePair] = useState<string | null>(null);
    const [uTab, setUTab] = useState<'long' | 'short' | 'hours'>('long');
    const [pTab, setPTab] = useState<'overview' | 'patterns'>('overview');
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef(false);

    const togglePair = (p: string) => setSelectedPairs(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

    const addCustom = () => {
        const clean = customPair.trim().toUpperCase().replace('/', '');
        if (clean && !selectedPairs.includes(clean)) setSelectedPairs(prev => [...prev, clean]);
        setCustomPair('');
    };

    const handleRun = useCallback(async () => {
        if (selectedPairs.length === 0) return;
        setIsRunning(true);
        setError(null);
        abortRef.current = false;

        try {
            const { pairResults: pr, universalModel: um } = await trainMultiPair(
                selectedPairs,
                timeframe,
                duration,
                mode,
                (p) => setProgress(p)
            );
            setPairResults(pr);
            setUniversalModel(um);
            // Don't auto-save — user must click Deploy
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsRunning(false);
        }
    }, [selectedPairs, timeframe, duration, mode]);

    const handleDeploy = () => {
        if (!universalModel) return;
        pairProfileService.save(universalModel);
        setUniversalModel(pairProfileService.getModel()); // re-read to confirm
        // Immediately refresh analysis for all idle Omega bots so model score shows at once
        botManagerService.requestImmediateOmegaAnalysis();
    };

    const handleClear = () => {
        pairProfileService.clear();
        setUniversalModel(null);
    };

    const currentPairResult = activePair ? pairResults.get(activePair) : null;
    const savedModel = pairProfileService.getModel();

    // Pairs from allPairs + quick list
    const displayPairs = Array.from(new Set([
        ...QUICK_PAIRS,
        ...availablePairs.map(p => p.replace('/', '')).slice(0, 20),
    ])).slice(0, 30);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3">
            <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-5xl max-h-[94vh] flex flex-col overflow-hidden">

                {/* ── Header ── */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700 shrink-0">
                    <div>
                        <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                            <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                            Universal Pattern Training Lab
                        </h2>
                        <p className="text-[11px] text-slate-400 mt-0.5">Train across multiple pairs → build a universal model → Omega uses it as a real-time confidence modifier.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {savedModel && (
                            <span className="text-[10px] bg-violet-900/40 border border-violet-700 text-violet-300 px-2 py-1 rounded-full font-semibold">
                                ✓ Model Active · {savedModel.trainedPairs.length} pairs
                            </span>
                        )}
                        <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors">
                            <CloseIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="flex flex-1 overflow-hidden">

                    {/* ── Left Config Panel ── */}
                    <div className="w-56 shrink-0 border-r border-slate-700 flex flex-col overflow-y-auto p-3 gap-3 text-xs">

                        {/* Market */}
                        <div>
                            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Market</p>
                            <div className="flex gap-1">
                                {[TradingMode.USDSM_Futures, TradingMode.Spot].map(m => (
                                    <button key={m} onClick={() => setMode(m)} className={`flex-1 py-1.5 rounded font-semibold transition-colors ${mode === m ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                                        {m === TradingMode.USDSM_Futures ? 'Futures' : 'Spot'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Timeframe */}
                        <div>
                            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Timeframe</p>
                            <div className="flex flex-wrap gap-1">
                                {TIME_FRAMES.map(tf => (
                                    <button key={tf} onClick={() => setTimeframe(tf)} className={`px-2 py-1 rounded font-medium transition-colors ${timeframe === tf ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>{tf}</button>
                                ))}
                            </div>
                        </div>

                        {/* Duration */}
                        <div>
                            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Duration</p>
                            {DURATIONS.map(d => (
                                <button key={d.value} onClick={() => setDuration(d.value)} className={`w-full text-left px-2.5 py-1.5 rounded mb-0.5 font-medium flex items-center justify-between transition-colors ${duration === d.value ? 'bg-violet-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                                    <span>{d.label}</span>
                                    <span className={`text-[9px] ${duration === d.value ? 'text-violet-200' : 'text-slate-600'}`}>{d.hint}</span>
                                </button>
                            ))}
                        </div>

                        {/* Pairs */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Pairs <span className="text-violet-400">({selectedPairs.length})</span></p>
                                <div className="flex gap-1">
                                    <button onClick={() => setSelectedPairs(Array.from(new Set([...selectedPairs, ...displayPairs])))} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors">All</button>
                                    <button onClick={() => setSelectedPairs([])} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors">Clear</button>
                                </div>
                            </div>
                            <div className="flex gap-1 mb-1.5">
                                <input value={customPair} onChange={e => setCustomPair(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCustom()} placeholder="SOLUSDT…" className="flex-1 px-2 py-2 bg-slate-800 border border-slate-600 rounded text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500" />
                                <button onClick={addCustom} className="px-3 py-2 bg-sky-700 hover:bg-sky-600 text-white rounded font-bold">+</button>
                            </div>
                            <div className="flex flex-col gap-1 h-64 overflow-y-auto pr-1">
                                {displayPairs.map(p => (
                                    <button key={p} onClick={() => togglePair(p)} className={`w-full px-3 py-3 min-h-[40px] rounded text-left text-sm font-medium leading-normal overflow-hidden whitespace-nowrap text-ellipsis transition-colors ${selectedPairs.includes(p) ? 'bg-violet-800/60 border border-violet-600 text-violet-200' : 'bg-slate-800 border border-transparent text-slate-300 hover:bg-slate-700 hover:border-slate-600'}`}>{p}</button>
                                ))}
                            </div>
                        </div>

                        {/* Run / Stop */}
                        <button onClick={isRunning ? () => { abortRef.current = true; } : handleRun} disabled={!isRunning && selectedPairs.length === 0} className={`w-full py-2 rounded-lg font-bold text-sm transition-colors ${isRunning ? 'bg-red-700 hover:bg-red-600 text-white' : selectedPairs.length === 0 ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-violet-600 hover:bg-violet-500 text-white'}`}>
                            {isRunning ? '■ Stop' : `▶ Train (${selectedPairs.length})`}
                        </button>

                        {/* Saved trained results nav */}
                        {pairResults.size > 0 && (
                            <div>
                                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Per-Pair Results</p>
                                {Array.from(pairResults.keys()).map(sym => (
                                    <button key={sym} onClick={() => setActivePair(sym)} className={`w-full px-2 py-1 rounded text-left mb-0.5 font-medium transition-colors ${activePair === sym ? 'bg-sky-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>{sym}</button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ── Right Results Panel ── */}
                    <div className="flex-1 flex flex-col overflow-hidden">

                        {/* Progress */}
                        {(isRunning || (progress && progress.phase !== 'done')) && (
                            <div className="px-4 py-2.5 border-b border-slate-700 bg-slate-800/40 shrink-0">
                                <div className="flex justify-between mb-1">
                                    <span className="text-[11px] text-slate-300 truncate max-w-[85%]">{progress?.message ?? '…'}</span>
                                    <span className="text-[11px] text-slate-400 tabular-nums font-mono">{progress?.progress ?? 0}%</span>
                                </div>
                                <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${progress?.progress ?? 0}%` }} />
                                </div>
                            </div>
                        )}

                        {/* Error */}
                        {error && <div className="m-4 px-4 py-3 bg-red-900/30 border border-red-700/60 rounded-lg text-xs text-red-300">{error}</div>}

                        {/* Empty state */}
                        {!universalModel && pairResults.size === 0 && !isRunning && !error && (
                            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500 p-10 text-center">
                                <svg className="w-14 h-14 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                                <div>
                                    <p className="font-semibold text-slate-400 text-sm">No training data yet</p>
                                    <p className="text-xs mt-1 text-slate-500">Select pairs + duration then click Train.<br />The model will analyse 34 patterns across all pairs.</p>
                                </div>
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto">

                            {/* ─ Universal Model View ─ */}
                            {universalModel && !activePair && (
                                <div className="p-4 space-y-4">

                                    {/* Header */}
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <h3 className="text-sm font-bold text-slate-100">Universal Signal Model</h3>
                                            <p className="text-[11px] text-slate-400 mt-0.5">
                                                {universalModel.trainedPairs.length} pairs · {universalModel.conditions.length} conditions · {universalModel.totalCandles.toLocaleString()} candles · {universalModel.timeframe}
                                            </p>
                                            <p className="text-[10px] text-slate-500 mt-0.5">Built {new Date(universalModel.builtAt).toLocaleString()}</p>
                                        </div>
                                        <div className="flex flex-col gap-2 shrink-0 items-end">
                                            {/* Auto-selected strategy badge */}
                                            {universalModel.deployStrategy && (
                                                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg">
                                                    <span className="text-[9px] text-slate-500 uppercase tracking-wide">Auto Strategy</span>
                                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                                        universalModel.deployStrategy === 'Aggressive'    ? 'bg-rose-600/80 text-rose-200' :
                                                        universalModel.deployStrategy === 'Conservative'  ? 'bg-emerald-700/80 text-emerald-200' :
                                                        universalModel.deployStrategy === 'TrendRiding'   ? 'bg-sky-600/80 text-sky-200' :
                                                        universalModel.deployStrategy === 'MeanReversion' ? 'bg-amber-600/80 text-amber-200' :
                                                        'bg-slate-600/80 text-slate-200'
                                                    }`}>{universalModel.deployStrategy}</span>
                                                </div>
                                            )}
                                            <div className="flex gap-2">
                                            {savedModel?.builtAt !== universalModel.builtAt && (
                                                <button onClick={handleDeploy} className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-bold transition-colors">
                                                    ⬆ Deploy to Omega
                                                </button>
                                            )}
                                            {savedModel && (
                                                <button onClick={handleClear} className="px-3 py-1.5 bg-slate-700 hover:bg-red-900/50 border border-slate-600 hover:border-red-700 text-slate-400 hover:text-red-400 rounded-lg text-xs font-medium transition-colors">
                                                    Clear Model
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                    {/* Trained pairs pills */}
                                    <div className="flex flex-wrap gap-1.5">
                                        {universalModel.trainedPairs.map(p => (
                                            <button key={p} onClick={() => setActivePair(p)} className="text-[10px] px-2 py-1 bg-slate-800 border border-slate-700 hover:border-sky-600 text-slate-300 rounded-full transition-colors">{p}</button>
                                        ))}
                                    </div>

                                    {savedModel?.builtAt === universalModel.builtAt && (
                                        <div className="px-3 py-2 bg-violet-900/30 border border-violet-700/50 rounded-lg text-[11px] text-violet-300 flex items-center gap-2">
                                            <span className="text-violet-400">✓</span>
                                            <span>This model is <strong>active in Omega</strong>. Every signal generation will be adjusted ±{Math.max(...universalModel.conditions.map(c => Math.abs(c.confidenceDelta)))}pt max based on {universalModel.conditions.length} universal conditions.</span>
                                        </div>
                                    )}

                                    {/* Tabs */}
                                    <div className="flex gap-1 border-b border-slate-700">
                                        {(['long', 'short', 'hours'] as const).map(t => (
                                            <button key={t} onClick={() => setUTab(t)} className={`text-xs font-semibold px-3 py-2 rounded-t-md transition-colors ${uTab === t ? 'bg-slate-700 text-sky-300 border-b-2 border-sky-400' : 'text-slate-400 hover:text-slate-200'}`}>
                                                {t === 'long' ? `▲ Best Long (${universalModel.bestLong.length})` : t === 'short' ? `▼ Best Short (${universalModel.bestShort.length})` : '⏰ Best Hours'}
                                            </button>
                                        ))}
                                    </div>

                                    {uTab === 'long' && (
                                        <div className="space-y-2">
                                            <p className="text-[11px] text-slate-400">Conditions that <strong>universally work across all trained pairs</strong> for LONG entries — Omega boosts confidence when these align.</p>
                                            {universalModel.bestLong.length > 0
                                                ? universalModel.bestLong.map(c => <CondCard key={c.name} cond={c} />)
                                                : <p className="text-xs text-slate-500 italic">No universal long conditions met threshold. Try more pairs or a longer duration.</p>}
                                        </div>
                                    )}

                                    {uTab === 'short' && (
                                        <div className="space-y-2">
                                            <p className="text-[11px] text-slate-400">Conditions that universally work for SHORT entries — Omega boosts confidence when these align.</p>
                                            {universalModel.bestShort.length > 0
                                                ? universalModel.bestShort.map(c => <CondCard key={c.name} cond={c} />)
                                                : <p className="text-xs text-slate-500 italic">No universal short conditions met threshold.</p>}
                                        </div>
                                    )}

                                    {uTab === 'hours' && (
                                        <div className="space-y-3">
                                            <p className="text-[11px] text-slate-400">Consensus best trading hours across all trained pairs (UTC). Omega session filter awareness is informed by this data.</p>
                                            <HeatmapRow data={universalModel.consensusHourlyWinRate} />
                                            <div className="flex gap-3 text-[10px] text-slate-500 flex-wrap">
                                                <span><span className="inline-block w-2 h-2 rounded-sm bg-emerald-600 mr-1" />≥60%</span>
                                                <span><span className="inline-block w-2 h-2 rounded-sm bg-sky-600 mr-1" />50-60%</span>
                                                <span><span className="inline-block w-2 h-2 rounded-sm bg-amber-600 mr-1" />40-50%</span>
                                                <span><span className="inline-block w-2 h-2 rounded-sm bg-red-700 mr-1" />&lt;40%</span>
                                            </div>
                                            <div className="bg-slate-800 rounded-lg p-3 mt-2">
                                                <p className="text-xs font-semibold text-slate-300 mb-2">Top consensus hours</p>
                                                {Object.entries(universalModel.consensusHourlyWinRate)
                                                    .map(([h, v]) => ({ h: Number(h), v }))
                                                    .filter(x => x.v > 0)
                                                    .sort((a, b) => b.v - a.v)
                                                    .slice(0, 8)
                                                    .map(({ h, v }) => (
                                                        <div key={h} className="flex items-center gap-3 mb-1.5">
                                                            <span className="text-xs font-mono text-slate-400 w-14">{String(h).padStart(2, '0')}:00 UTC</span>
                                                            <div className="flex-1"><WinBar value={v} small /></div>
                                                        </div>
                                                    ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Timeframe warning */}
                                    {universalModel.timeframe !== '5m' && (
                                        <div className="px-3 py-2 bg-amber-900/30 border border-amber-700/50 rounded-lg text-[11px] text-amber-300 flex items-center gap-2">
                                            <span className="text-amber-400">⚠</span>
                                            <span>Model trained on <strong>{universalModel.timeframe}</strong> candles. Omega runs on <strong>5m</strong> — conditions may not align perfectly. Consider retraining on 5m for best results.</span>
                                        </div>
                                    )}

                                    {/* All conditions summary table */}
                                    <div>
                                        <p className="text-[11px] font-semibold text-slate-400 mb-2">All {universalModel.conditions.length} evaluated conditions</p>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-[11px] text-left">
                                                <thead>
                                                    <tr className="text-slate-500 border-b border-slate-700">
                                                        <th className="pb-1.5 pr-3 font-semibold">Condition</th>
                                                        <th className="pb-1.5 pr-3 font-semibold">Dir</th>
                                                        <th className="pb-1.5 pr-3 font-semibold text-right">Win%</th>
                                                        <th className="pb-1.5 pr-3 font-semibold text-right">Consist.</th>
                                                        <th className="pb-1.5 pr-3 font-semibold text-right">Avg R</th>
                                                        <th className="pb-1.5 pr-3 font-semibold text-right">Edge</th>
                                                        <th className="pb-1.5 font-semibold text-right">Δ</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {[...universalModel.conditions].sort((a, b) => b.globalWinRate - a.globalWinRate).map(c => {
                                                        const edge = ((c.globalWinRate / 100 - 0.5) * c.avgRMultiple).toFixed(2);
                                                        const edgeNum = parseFloat(edge);
                                                        return (
                                                            <tr key={c.name} className="border-b border-slate-800 hover:bg-slate-800/40">
                                                                <td className="py-1 pr-3 text-slate-300 font-medium">{c.name}</td>
                                                                <td className={`py-1 pr-3 font-semibold ${c.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>{c.direction}</td>
                                                                <td className={`py-1 pr-3 text-right font-bold ${wr(c.globalWinRate)}`}>{c.globalWinRate}%</td>
                                                                <td className={`py-1 pr-3 text-right ${c.consistency >= 70 ? 'text-emerald-400' : c.consistency >= 50 ? 'text-sky-400' : 'text-amber-400'}`}>{c.consistency}%</td>
                                                                <td className="py-1 pr-3 text-right text-slate-300">{c.avgRMultiple.toFixed(1)}</td>
                                                                <td className={`py-1 pr-3 text-right font-semibold ${edgeNum > 0.1 ? 'text-emerald-400' : edgeNum > 0 ? 'text-sky-400' : 'text-red-400'}`}>{edgeNum > 0 ? '+' : ''}{edge}</td>
                                                                <td className={`py-1 text-right font-bold ${c.confidenceDelta >= 0 ? 'text-sky-400' : 'text-red-400'}`}>{c.confidenceDelta >= 0 ? '+' : ''}{c.confidenceDelta}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ─ Per-Pair Detail View ─ */}
                            {currentPairResult && (
                                <div className="p-4 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => setActivePair(null)} className="text-xs text-slate-400 hover:text-sky-400 transition-colors">← Universal Model</button>
                                                <span className="text-slate-600">/</span>
                                                <h3 className="text-sm font-bold text-slate-100">{activePair}</h3>
                                            </div>
                                            <p className="text-[11px] text-slate-400 mt-0.5">{currentPairResult.startDate} → {currentPairResult.endDate} · {currentPairResult.totalCandles.toLocaleString()} candles</p>
                                        </div>
                                        <span className={`text-xs font-bold px-2 py-1 rounded-full ${currentPairResult.trendBias === 'Bullish' ? 'bg-emerald-900/50 text-emerald-400' : currentPairResult.trendBias === 'Bearish' ? 'bg-red-900/50 text-red-400' : 'bg-slate-700 text-slate-300'}`}>
                                            {currentPairResult.trendBias} {currentPairResult.priceChangePct > 0 ? '+' : ''}{currentPairResult.priceChangePct}%
                                        </span>
                                    </div>

                                    <div className="bg-slate-800 rounded-lg p-2">
                                        <Sparkline data={currentPairResult.chartData} />
                                    </div>

                                    <div className="grid grid-cols-4 gap-2 text-xs">
                                        <Pill label="Volatility" value={currentPairResult.avgVolatilityRegime} color={currentPairResult.avgVolatilityRegime === 'High' ? 'text-red-400' : currentPairResult.avgVolatilityRegime === 'Low' ? 'text-slate-400' : 'text-sky-400'} />
                                        <Pill label="Avg RVOL" value={currentPairResult.avgRvol.toFixed(2) + 'x'} />
                                        <Pill label="Candles" value={currentPairResult.totalCandles.toLocaleString()} />
                                        <Pill label="Patterns" value={currentPairResult.patterns.length} />
                                    </div>

                                    <div className="flex gap-1 border-b border-slate-700">
                                        {(['overview', 'patterns'] as const).map(t => (
                                            <button key={t} onClick={() => setPTab(t)} className={`text-xs font-semibold px-3 py-2 rounded-t-md capitalize transition-colors ${pTab === t ? 'bg-slate-700 text-sky-300 border-b-2 border-sky-400' : 'text-slate-400 hover:text-slate-200'}`}>{t}</button>
                                        ))}
                                    </div>

                                    {pTab === 'overview' && (
                                        <div className="space-y-3">
                                            <div>
                                                <p className="text-[11px] font-semibold text-slate-400 mb-1.5">Hourly Win Rate (UTC)</p>
                                                <HeatmapRow data={Object.fromEntries(Object.entries(currentPairResult.hourlyWinRate).map(([h, v]) => [h, v.winRate]))} />
                                            </div>
                                            <div>
                                                <p className="text-[11px] font-semibold text-slate-400 mb-1.5">Top patterns on this pair</p>
                                                {currentPairResult.patterns.filter(p => p.occurrences >= 5).sort((a, b) => b.winRate - a.winRate).slice(0, 5).map(p => (
                                                    <div key={p.name} className="flex items-center gap-3 py-1.5 border-b border-slate-800">
                                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${p.direction === 'LONG' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'}`}>{p.direction}</span>
                                                        <span className="text-xs text-slate-200 flex-1">{p.name}</span>
                                                        <div className="w-24"><WinBar value={p.winRate} small /></div>
                                                        <span className="text-[10px] text-slate-500 w-12 text-right">{p.occurrences} signals</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {pTab === 'patterns' && (
                                        <div className="space-y-1.5">
                                            {[...currentPairResult.patterns].sort((a, b) => b.winRate - a.winRate).map(p => (
                                                <div key={p.name} className="bg-slate-800 rounded-lg p-2.5">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${p.direction === 'LONG' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'}`}>{p.direction}</span>
                                                            <span className="text-[9px] bg-slate-700 text-slate-400 px-1 py-0.5 rounded shrink-0">{p.category}</span>
                                                            <span className="text-xs text-slate-200 truncate">{p.name}</span>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <span className={`text-sm font-bold ${wr(p.winRate)}`}>{p.winRate}%</span>
                                                            <span className="text-[10px] text-slate-500 block">{p.occurrences}×</span>
                                                        </div>
                                                    </div>
                                                    <WinBar value={p.winRate} small />
                                                    <div className="flex gap-3 mt-1 text-[10px] text-slate-500">
                                                        <span>Avg R: <span className="text-emerald-400">{p.avgRMultiple.toFixed(1)}R</span></span>
                                                        <span>MAE: <span className="text-red-400">{p.avgAdverseR.toFixed(1)}R</span></span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
