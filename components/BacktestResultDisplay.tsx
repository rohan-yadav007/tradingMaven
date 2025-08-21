
import React from 'react';
import { BacktestResult } from '../types';

const ResultMetric: React.FC<{label: string, value: string | number, className?: string}> = ({label, value, className}) => (
    <div className="text-center bg-slate-100 dark:bg-slate-800/50 p-2 rounded-lg">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-0">{label}</p>
        <p className={`text-lg font-bold mb-0 ${className}`}>{value}</p>
    </div>
)

export const BacktestResultDisplay: React.FC<{ result: BacktestResult, onReset: () => void, onApplyAndSwitchView: () => void }> = ({ result, onReset, onApplyAndSwitchView }) => {
    
    const pnlIsProfit = result.totalPnl >= 0;
    const winRateIsGood = result.winRate >= 50;
    const sideClass = (dir: 'LONG' | 'SHORT') => dir === 'LONG' ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300' : 'bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-300';
    
    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 animate-fade-in h-full flex flex-col">
            <div className="flex justify-between items-start flex-shrink-0">
                <h2 className="text-xl font-bold mb-4">Backtest Results</h2>
                <div className="flex gap-2">
                    <button onClick={onReset} className="text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-sky-500">Run New Test</button>
                    <button onClick={onApplyAndSwitchView} className="px-4 py-2 bg-sky-600 text-white font-semibold rounded-md shadow-sm hover:bg-sky-700 text-sm">Apply to Trading</button>
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

            <div className="overflow-auto border dark:border-slate-700 rounded-md flex-grow">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 dark:bg-slate-700/50 sticky top-0">
                        <tr>
                            <th className="px-4 py-2">Pair</th>
                            <th className="px-4 py-2">Side</th>
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
