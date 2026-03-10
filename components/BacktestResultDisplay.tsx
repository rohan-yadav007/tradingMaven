import React from 'react';
import { BacktestResult, SetupTypeStats } from '../types';
import { DownloadIcon } from './icons';

const ResultMetric: React.FC<{label: string, value: string | number, className?: string}> = ({label, value, className}) => (
    <div className="text-center bg-slate-100 dark:bg-slate-800/50 p-2 rounded-lg">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-0">{label}</p>
        <p className={`text-lg font-bold mb-0 ${className}`}>{value}</p>
    </div>
)

const SetupEdgeTable: React.FC<{ breakdown: SetupTypeStats[] }> = ({ breakdown }) => {
    const verdictLabel = (s: SetupTypeStats): { text: string; cls: string } => {
        if (s.count < 5) return { text: 'Low Sample', cls: 'text-slate-400' };
        if (s.expectancy > 0 && s.winRate >= 50) return { text: '✓ Edge', cls: 'text-emerald-500 font-bold' };
        if (s.expectancy > 0 && s.winRate < 50) return { text: '~ Marginal', cls: 'text-yellow-500' };
        return { text: '✗ No Edge', cls: 'text-rose-500 font-bold' };
    };

    return (
        <div className="mt-4 border dark:border-slate-700 rounded-md overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Setup Edge Analysis</h3>
                <p className="text-xs text-slate-400 mt-0.5">Which setups have a proven positive expectancy? Needs &ge;5 trades to be reliable, &ge;30 for statistical significance.</p>
            </div>
            <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 dark:bg-slate-700/30 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    <tr>
                        <th className="px-4 py-2">Setup Type</th>
                        <th className="px-4 py-2 text-right">Trades</th>
                        <th className="px-4 py-2 text-right">Win Rate</th>
                        <th className="px-4 py-2 text-right">Avg Win</th>
                        <th className="px-4 py-2 text-right">Avg Loss</th>
                        <th className="px-4 py-2 text-right">Expectancy</th>
                        <th className="px-4 py-2 text-right">Total PnL</th>
                        <th className="px-4 py-2 text-right">Verdict</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {breakdown.map(s => {
                        const verdict = verdictLabel(s);
                        const rowBg = s.count < 5 ? '' : s.expectancy > 0 ? 'bg-emerald-50/30 dark:bg-emerald-900/10' : 'bg-rose-50/30 dark:bg-rose-900/10';
                        return (
                            <tr key={s.setupType} className={rowBg}>
                                <td className="px-4 py-2 font-semibold">{s.setupType}</td>
                                <td className="px-4 py-2 text-right">{s.count} <span className="text-slate-400 text-xs">({s.wins}W/{s.losses}L)</span></td>
                                <td className={`px-4 py-2 text-right font-mono ${s.winRate >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{s.winRate.toFixed(1)}%</td>
                                <td className="px-4 py-2 text-right font-mono text-emerald-600 dark:text-emerald-400">${s.avgWin.toFixed(2)}</td>
                                <td className="px-4 py-2 text-right font-mono text-rose-600 dark:text-rose-400">${s.avgLoss.toFixed(2)}</td>
                                <td className={`px-4 py-2 text-right font-mono font-bold ${s.expectancy >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>${s.expectancy.toFixed(2)}</td>
                                <td className={`px-4 py-2 text-right font-mono ${s.totalPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>${s.totalPnl.toFixed(2)}</td>
                                <td className={`px-4 py-2 text-right text-xs ${verdict.cls}`}>{verdict.text}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

export const BacktestResultDisplay: React.FC<{ result: BacktestResult, onReset: () => void, onApplyAndSwitchView: () => void }> = ({ result, onReset, onApplyAndSwitchView }) => {
    
    const pnlIsProfit = result.totalPnl >= 0;
    const winRateIsGood = result.winRate >= 50;
    const sideClass = (dir: 'LONG' | 'SHORT') => dir === 'LONG' ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300' : 'bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-300';
    
    const handleExport = () => {
        if (!result || result.trades.length === 0) {
            alert("No backtest trades to export.");
            return;
        }
        
        // Format as a single, pretty-printed JSON array string.
        const dataToExport = JSON.stringify(result.trades, null, 2);
        const blob = new Blob([dataToExport], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'backtest_results.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 animate-fade-in h-full flex flex-col">
            <div className="flex justify-between items-start flex-shrink-0">
                <h2 className="text-xl font-bold mb-4">Backtest Results</h2>
                <div className="flex gap-2 items-center">
                    <button onClick={onReset} className="text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-sky-500">Run New Test</button>
                    <button onClick={onApplyAndSwitchView} className="px-4 py-2 bg-sky-600 text-white font-semibold rounded-md shadow-sm hover:bg-sky-700 text-sm">Apply to Trading</button>
                    <button onClick={handleExport} className="p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-full transition-colors" title="Export Backtest Trades as JSON">
                        <DownloadIcon className="w-5 h-5" />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6 flex-shrink-0">
                <ResultMetric label="Total Net PNL" value={`$${result.totalPnl.toFixed(2)}`} className={pnlIsProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}/>
                <ResultMetric label="Win Rate" value={`${result.winRate.toFixed(1)}%`} className={winRateIsGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}/>
                <ResultMetric label="Total Trades" value={result.totalTrades} />
                <ResultMetric label="Wins / Losses" value={`${result.wins} / ${result.losses}`} />
                <ResultMetric label="Profit Factor" value={result.profitFactor.toFixed(2)} />
                <ResultMetric label="Max Drawdown" value={`$${result.maxDrawdown.toFixed(2)}`} />
                <ResultMetric label="Sharpe Ratio" value={result.sharpeRatio.toFixed(2)} />
                <ResultMetric label="Avg. Duration" value={result.averageTradeDuration} />
            </div>

            {result.setupBreakdown && result.setupBreakdown.length > 0 && (
                <SetupEdgeTable breakdown={result.setupBreakdown} />
            )}

            <div className="mt-4 overflow-auto border dark:border-slate-700 rounded-md flex-grow">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 dark:bg-slate-700/50 sticky top-0">
                        <tr>
                            <th className="px-4 py-2">Pair</th>
                            <th className="px-4 py-2">Side</th>
                            <th className="px-4 py-2">Setup</th>
                            <th className="px-4 py-2">Conv.</th>
                            <th className="px-4 py-2">Entry Time</th>
                            <th className="px-4 py-2">Exit Time</th>
                            <th className="px-4 py-2">Entry Price</th>
                            <th className="px-4 py-2">Exit Price</th>
                            <th className="px-4 py-2">Net PNL</th>
                            <th className="px-4 py-2">Exit Reason</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {result.trades.map(trade => (
                            <tr key={trade.id}>
                                <td className="px-4 py-2 font-semibold">{trade.pair}</td>
                                <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full font-medium ${sideClass(trade.direction)}`}>{trade.direction}</span></td>
                                <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">{trade.setupType || '—'}</td>
                                <td className="px-4 py-2 text-xs font-mono">{trade.conviction != null ? `${Math.round(trade.conviction)}` : '—'}</td>
                                <td className="px-4 py-2 whitespace-nowrap">{new Date(trade.entryTime).toLocaleString()}</td>
                                <td className="px-4 py-2 whitespace-nowrap">{new Date(trade.exitTime).toLocaleString()}</td>
                                <td className="px-4 py-2 font-mono">{trade.entryPrice.toFixed(4)}</td>
                                <td className="px-4 py-2 font-mono">{trade.exitPrice.toFixed(4)}</td>
                                <td className={`px-4 py-2 font-mono ${trade.pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{trade.pnl.toFixed(2)}</td>
                                <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{trade.exitReason}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};