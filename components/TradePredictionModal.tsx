
// components/TradePredictionModal.tsx

import React, { useMemo } from 'react';
import { RunningBot } from '../types';
import { CloseIcon } from './icons';

interface Props {
    bot: RunningBot;
    onClose: () => void;
}

// --- SVG Gauge helpers ---
const GAUGE_CX = 90;
const GAUGE_CY = 90;
const GAUGE_R = 70;
const SWEEP = 240; // degrees of arc
const START_ANGLE = 150; // degrees from right (3 o'clock = 0)

function toRad(deg: number) { return (deg * Math.PI) / 180; }

function polarToCart(cx: number, cy: number, r: number, angleDeg: number) {
    const a = toRad(angleDeg);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
    const s = polarToCart(cx, cy, r, startDeg);
    const e = polarToCart(cx, cy, r, endDeg);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

const GaugeArc: React.FC<{ probability: number }> = ({ probability }) => {
    const endAngle = START_ANGLE + (probability / 100) * SWEEP;
    const color = probability >= 60 ? '#10b981' : probability >= 40 ? '#f59e0b' : '#ef4444';

    return (
        <svg width="180" height="160" viewBox="0 0 180 160" className="mx-auto">
            {/* Background track */}
            <path
                d={arcPath(GAUGE_CX, GAUGE_CY, GAUGE_R, START_ANGLE, START_ANGLE + SWEEP)}
                fill="none"
                stroke="currentColor"
                strokeWidth="12"
                strokeLinecap="round"
                className="text-slate-200 dark:text-slate-700"
            />
            {/* Foreground arc */}
            {probability > 1 && (
                <path
                    d={arcPath(GAUGE_CX, GAUGE_CY, GAUGE_R, START_ANGLE, endAngle)}
                    fill="none"
                    stroke={color}
                    strokeWidth="12"
                    strokeLinecap="round"
                    style={{ transition: 'all 0.4s ease' }}
                />
            )}
            {/* Centre label */}
            <text x={GAUGE_CX} y={GAUGE_CY - 8} textAnchor="middle" className="fill-slate-900 dark:fill-slate-100" style={{ fontSize: 30, fontWeight: 700, fontFamily: 'monospace' }} fill={color}>
                {probability}%
            </text>
            <text x={GAUGE_CX} y={GAUGE_CY + 14} textAnchor="middle" className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 11, fontFamily: 'sans-serif' }} fill="#94a3b8">
                Win Probability
            </text>
        </svg>
    );
};

// --- Sparkline ---
const Sparkline: React.FC<{ history: number[] }> = ({ history }) => {
    const data = history.slice(-40);
    if (data.length < 2) return <div className="h-10 flex items-center justify-center text-xs text-slate-400">Building history...</div>;

    const W = 280, H = 48, PAD = 4;
    const minV = Math.min(...data) - 5;
    const maxV = Math.max(...data) + 5;
    const range = maxV - minV || 10;

    const pts = data.map((v, i) => {
        const x = PAD + (i / (data.length - 1)) * (W - PAD * 2);
        const y = PAD + (1 - (v - minV) / range) * (H - PAD * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const last = data[data.length - 1];
    const lastColor = last >= 60 ? '#10b981' : last >= 40 ? '#f59e0b' : '#ef4444';

    return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="w-full">
            <polyline points={pts} fill="none" stroke={lastColor} strokeWidth="1.5" strokeLinejoin="round" opacity="0.7" />
            {/* 50% reference line */}
            <line
                x1={PAD} y1={PAD + (1 - (50 - minV) / range) * (H - PAD * 2)}
                x2={W - PAD} y2={PAD + (1 - (50 - minV) / range) * (H - PAD * 2)}
                stroke="#64748b" strokeWidth="0.5" strokeDasharray="3 3"
            />
        </svg>
    );
};

// --- Factor Row ---
const FactorRow: React.FC<{ label: string; value: number; min: number; max: number; isGoodHigh: boolean; description: string }> = ({
    label, value, min, max, isGoodHigh, description,
}) => {
    const clamped = Math.max(min, Math.min(max, value));
    const pct = ((clamped - min) / (max - min)) * 100;
    const isGood = isGoodHigh ? clamped > (max + min) / 2 : clamped < (max + min) / 2;
    const barColor = isGood ? 'bg-emerald-500' : 'bg-rose-500';

    return (
        <div className="space-y-1">
            <div className="flex justify-between items-baseline text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-300">{label}</span>
                <span className="font-mono text-slate-500 dark:text-slate-400 text-[10px]">{value.toFixed(2)}</span>
            </div>
            <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full">
                <div className={`h-full rounded-full transition-all duration-300 ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">{description}</p>
        </div>
    );
};

// --- SectionHeader helper ---
const SectionHeader: React.FC<{ title: string }> = ({ title }) => (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">{title}</p>
);

// --- Main Modal ---
export const TradePredictionModal: React.FC<Props> = ({ bot, onClose }) => {
    const prob = bot.winProbability ?? 50;
    const factors = bot.winProbabilityFactors;
    const history = bot.probabilityHistory ?? [];
    const position = bot.openPosition;
    const omega = bot.analysis?.omegaAnalysis;

    const trendInfo = useMemo(() => {
        if (history.length < 4) return null;
        const recent = history.slice(-4);
        const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
        if (prob > avg + 3) return { label: '↑ Improving', cls: 'text-emerald-500' };
        if (prob < avg - 3) return { label: '↓ Declining', cls: 'text-rose-500' };
        return { label: '→ Stable', cls: 'text-slate-400' };
    }, [prob, history]);

    const probLabel = prob >= 60 ? 'Favorable' : prob >= 40 ? 'Neutral' : 'Unfavorable';
    const probLabelCls = prob >= 60 ? 'text-emerald-500' : prob >= 40 ? 'text-amber-500' : 'text-rose-500';

    // Trade Risk Metrics
    const riskMetrics = useMemo(() => {
        if (!position) return null;
        const price = bot.livePrice ?? position.entryPrice;
        const slDist = Math.abs(price - position.stopLossPrice);
        const tpDist = Math.abs(position.takeProfitPrice - price);
        const slPct = (slDist / price) * 100;
        const tpPct = (tpDist / price) * 100;
        const rr = slDist > 0 ? tpDist / slDist : 0;
        const pnlPct = position.direction === 'LONG'
            ? ((price - position.entryPrice) / position.entryPrice) * 100 * position.leverage
            : ((position.entryPrice - price) / position.entryPrice) * 100 * position.leverage;
        return { slPct, tpPct, rr, pnlPct };
    }, [position, bot.livePrice]);

    // HTF alignment badge
    const htfCls = omega?.htfAlignment === 'Aligned' ? 'bg-emerald-900/40 text-emerald-400 border-emerald-800'
        : omega?.htfAlignment === 'Conflicted' ? 'bg-rose-900/40 text-rose-400 border-rose-800'
        : 'bg-slate-700 text-slate-400 border-slate-600';

    // Setup type badge
    const setupCls = omega?.poiStatus?.type === 'Liquidity Sweep' ? 'bg-violet-900/40 text-violet-300 border-violet-800'
        : omega?.poiStatus?.type === 'Order Block' ? 'bg-sky-900/40 text-sky-300 border-sky-800'
        : omega?.poiStatus?.type === 'FVG Entry' ? 'bg-amber-900/40 text-amber-300 border-amber-800'
        : 'bg-slate-700 text-slate-400 border-slate-600';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
                    <div>
                        <h2 className="font-bold text-slate-900 dark:text-slate-100 text-sm">Trade Predictor</h2>
                        {position && (
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                {position.direction} · {bot.config.pair} · {position.candlesSinceEntry} candles in · Leverage {position.leverage}×
                            </p>
                        )}
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400">
                        <CloseIcon className="w-4 h-4" />
                    </button>
                </div>

                <div className="overflow-y-auto flex-1 p-5 space-y-5">
                    {/* Top row: Gauge + Risk Metrics side by side */}
                    <div className="flex gap-5 items-start">
                        {/* Gauge */}
                        <div className="flex-shrink-0">
                            <GaugeArc probability={prob} />
                            <div className="flex items-center justify-center gap-3 -mt-2">
                                <span className={`text-sm font-bold ${probLabelCls}`}>{probLabel}</span>
                                {trendInfo && <span className={`text-xs font-medium ${trendInfo.cls}`}>{trendInfo.label}</span>}
                            </div>
                        </div>

                        {/* Risk Metrics */}
                        <div className="flex-1 space-y-3 pt-2">
                            <SectionHeader title="Trade Risk Metrics" />
                            {riskMetrics ? (
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-2.5">
                                        <p className="text-[10px] text-slate-400 mb-0.5">SL Distance</p>
                                        <p className="text-sm font-bold text-rose-500">{riskMetrics.slPct.toFixed(2)}%</p>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-2.5">
                                        <p className="text-[10px] text-slate-400 mb-0.5">TP Distance</p>
                                        <p className="text-sm font-bold text-emerald-500">{riskMetrics.tpPct.toFixed(2)}%</p>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-2.5">
                                        <p className="text-[10px] text-slate-400 mb-0.5">Remaining R:R</p>
                                        <p className={`text-sm font-bold ${riskMetrics.rr >= 1.5 ? 'text-emerald-500' : riskMetrics.rr >= 1 ? 'text-amber-500' : 'text-rose-500'}`}>{riskMetrics.rr.toFixed(2)}R</p>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-2.5">
                                        <p className="text-[10px] text-slate-400 mb-0.5">Live P&L</p>
                                        <p className={`text-sm font-bold ${riskMetrics.pnlPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{riskMetrics.pnlPct >= 0 ? '+' : ''}{riskMetrics.pnlPct.toFixed(2)}%</p>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-xs text-slate-400">No open position</p>
                            )}
                        </div>
                    </div>

                    {/* Live Signal Context (from Omega analysis) */}
                    {omega && (
                        <div>
                            <SectionHeader title="Live Signal Context" />
                            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 space-y-3">
                                {/* Conviction bar */}
                                <div className="space-y-1">
                                    <div className="flex justify-between text-xs">
                                        <span className="font-medium text-slate-700 dark:text-slate-300">Omega Conviction</span>
                                        <span className="font-mono font-bold text-slate-500 dark:text-slate-400">{omega.conviction.toFixed(0)}%</span>
                                    </div>
                                    <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full">
                                        <div
                                            className={`h-full rounded-full transition-all duration-300 ${omega.conviction >= 70 ? 'bg-emerald-500' : omega.conviction >= 55 ? 'bg-amber-500' : 'bg-rose-500'}`}
                                            style={{ width: `${omega.conviction}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Badges row */}
                                <div className="flex flex-wrap gap-1.5">
                                    {omega.poiStatus?.type !== 'None' && (
                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${setupCls}`}>
                                            {omega.poiStatus.type}
                                        </span>
                                    )}
                                    {omega.htfAlignment && (
                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${htfCls}`}>
                                            4H {omega.htfAlignment}
                                        </span>
                                    )}
                                    {omega.intent && (
                                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-violet-800 bg-violet-900/40 text-violet-300">
                                            {omega.intent}
                                        </span>
                                    )}
                                    {omega.sessionAnalysis && (
                                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-slate-600 bg-slate-700 text-slate-300">
                                            {omega.sessionAnalysis}
                                        </span>
                                    )}
                                </div>

                                {/* Score pillars */}
                                {omega.scoreBreakdown && (
                                    <div className="grid grid-cols-4 gap-1.5">
                                        {[
                                            { label: 'Structure', val: omega.scoreBreakdown.structure, max: 100 },
                                            { label: 'Momentum',  val: omega.scoreBreakdown.momentum,  max: 100 },
                                            { label: 'Context',   val: omega.scoreBreakdown.context,   max: 80  },
                                            ...(omega.scoreBreakdown.model !== undefined ? [{ label: 'Model', val: omega.scoreBreakdown.model + 50, max: 100 }] : []),
                                        ].map(p => (
                                            <div key={p.label} className="text-center">
                                                <div className="text-[10px] text-slate-400 mb-1">{p.label}</div>
                                                <div className="text-xs font-bold text-slate-200">{p.val.toFixed(0)}</div>
                                                <div className="h-1 bg-slate-700 rounded-full mt-1">
                                                    <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.min(100, Math.max(0, (p.val / p.max) * 100))}%` }} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Model score detail */}
                                {omega.modelScore && (
                                    <div className="flex items-center gap-2 px-2 py-1.5 bg-violet-900/20 rounded-lg border border-violet-800/40">
                                        <span className="text-violet-400 text-xs font-bold shrink-0">Model</span>
                                        <span className="text-[11px] text-violet-300">
                                            {omega.modelScore.delta > 0 ? '+' : ''}{omega.modelScore.delta}pt · {omega.modelScore.activeCount} conditions
                                            {omega.modelScore.hourWinRate > 0 ? ` · ${omega.modelScore.hourWinRate}% this hour` : ''}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Sparkline */}
                    {history.length >= 2 && (
                        <div>
                            <SectionHeader title={`Probability History (last ${Math.min(history.length, 40)} ticks)`} />
                            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-2">
                                <Sparkline history={history} />
                            </div>
                        </div>
                    )}

                    {/* Factors */}
                    {factors && (
                        <div>
                            <SectionHeader title="Factor Breakdown" />
                            <div className="space-y-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3">
                                <FactorRow label="P&L (in R)" value={factors.pnlR} min={-2} max={3} isGoodHigh={true} description="Current profit in units of initial risk" />
                                <FactorRow label="Remaining R:R" value={factors.remainingRR} min={0} max={5} isGoodHigh={true} description="Distance to TP vs distance to current SL" />
                                <FactorRow label="MFE Efficiency" value={factors.mfeEfficiency} min={0} max={1} isGoodHigh={true} description="How much of the peak profit we're still holding" />
                                <FactorRow label="RSI Alignment" value={factors.rsiAlignment} min={-1} max={1} isGoodHigh={true} description="RSI momentum aligned with trade direction" />
                                <FactorRow label="Stagnation" value={factors.stagnationPenalty} min={0} max={1} isGoodHigh={false} description="Penalty for time in trade without progress" />
                                {factors.breakevenBonus > 0 && (
                                    <div className="flex items-center gap-2 px-2 py-1.5 bg-sky-50 dark:bg-sky-900/30 rounded-lg border border-sky-200 dark:border-sky-800">
                                        <span className="text-sky-500 text-base">✓</span>
                                        <div>
                                            <p className="text-xs font-semibold text-sky-700 dark:text-sky-300">Breakeven Active</p>
                                            <p className="text-[10px] text-sky-500 dark:text-sky-400">Stop loss above entry — loss impossible</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {!factors && !omega && (
                        <p className="text-xs text-center text-slate-400 py-4">Waiting for position data...</p>
                    )}
                </div>

                <div className="px-5 py-3 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-700 shrink-0">
                    <p className="text-[10px] text-slate-400 text-center">
                        Predictive model based on live P&L, momentum, MFE, structure, and Omega signal context. Not a guarantee of outcome.
                    </p>
                </div>
            </div>
        </div>
    );
};
