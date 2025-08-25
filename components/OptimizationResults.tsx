
import React, { useState } from 'react';
import { OptimizationResultItem, AgentParams } from '../types';
import { ChevronDown, ChevronUp } from './icons';

interface OptimizationResultsProps {
    results: OptimizationResultItem[];
    onApplyAndSwitchView: (params: AgentParams) => void;
    onReset: () => void;
    pricePrecision: number;
}

const ResultMetric: React.FC<{label: string, value: string | number, className?: string}> = ({label, value, className}) => (
    <div className="text-center">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-0">{label}</p>
        <p className={`text-base font-bold mb-0 ${className}`}>{value}</p>
    </div>
)

const OptimizationResultRow: React.FC<{
    item: OptimizationResultItem,
    onApply: () => void,
    pricePrecision: number,
    isOpen: boolean,
    onToggle: () => void,
}> = ({ item, onApply, isOpen, onToggle }) => {
    
    const { result, params } = item;
    const pnlIsProfit = result.totalPnl >= 0;
    const winRateIsGood = result.winRate >= 50;
    const sideClass = (dir: 'LONG' | 'SHORT') => dir === 'LONG' ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300' : 'bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-300';
    
    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm">
            <button onClick={onToggle} className="w-full text-left p-3 focus:outline-none">
                 <div className="grid grid-cols-3 md:grid-cols-4 gap-3 w-full items-center">
                     <ResultMetric label="Total PNL" value={`$${result.totalPnl.toFixed(2)}`} className={pnlIsProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}/>
                     <ResultMetric label="Win Rate" value={`${result.winRate.toFixed(1)}%`} className={winRateIsGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} />
                     <ResultMetric label="Trades" value={result.totalTrades} />
                     <div className="hidden md:flex justify-end pr-2">
                        {isOpen ? <ChevronUp className="w-5 h-5 text-slate-400"/> : <ChevronDown className="w-5 h-5 text-slate-400"/>}
                     </div>
                </div>
            </button>
            {isOpen && (
                <div className="p-4 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-grow">
                            <h4 className="font-semibold text-sm mb-2">Trade Log</h4>
                            <div className="overflow-auto border dark:border-slate-700 rounded-md" style={{maxHeight: '240px'}}>
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-slate-50 dark:bg-slate-700/50 sticky top-0">
                                        <tr>
                                            <th className="px-2 py-1.5">Exit Time</th><th className="px-2 py-1.5">Side</th>
                                            <th className="px-2 py-1.5">PNL</th><th className="px-2 py-1.5">Reason</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                                        {result.trades.map(trade => (
                                            <tr key={trade.id}>
                                                <td className="px-2 py-1.5 whitespace-nowrap">{new Date(trade.exitTime).toLocaleDateString()}</td>
                                                <td className="px-2 py-1.5"><span className={`px-2 py-0.5 rounded-full font-medium ${sideClass(trade.direction)}`}>{trade.direction}</span></td>
                                                <td className={`px-2 py-1.5 font-mono ${trade.pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{trade.pnl.toFixed(2)}</td>
                                                <td className="px-2 py-1.5 text-slate-500 dark:text-slate-400 truncate">{trade.exitReason}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="w-full md:max-w-xs">
                            <h4 className="font-semibold text-sm mb-2">Parameters Used</h4>
                            <div className="text-xs p-3 bg-slate-100 dark:bg-slate-900/50 rounded-lg border dark:border-slate-700 mb-3 space-y-1">
                                {Object.entries(params).map(([key, value]) => (
                                    <div key={key} className="flex justify-between">
                                        <span className="text-slate-500 dark:text-slate-400">{key}:</span>
                                        <span className="font-mono font-semibold">{String(value)}</span>
                                    </div>
                                ))}
                            </div>
                             <button onClick={onApply} className="w-full px-4 py-2 bg-sky-600 text-white font-semibold rounded-md shadow-sm hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500">
                                Apply to Trading
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};


export const OptimizationResults: React.FC<OptimizationResultsProps> = ({ results, onApplyAndSwitchView, onReset, pricePrecision }) => {
    const [openId, setOpenId] = useState<number | null>(0);

    const handleToggle = (id: number) => {
        setOpenId(prevId => prevId === id ? null : id);
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 animate-fade-in h-full flex flex-col">
             <div className="flex justify-between items-center mb-4 flex-shrink-0">
                <h3 className="font-bold text-lg">Optimization Results ({results.length} combinations)</h3>
                <button onClick={onReset} className="text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-sky-500">
                    Run New Test
                </button>
             </div>
             <div className="space-y-2 flex-grow overflow-y-auto pr-2 -mr-2">
                {results.map((item, index) => (
                    <OptimizationResultRow 
                        key={index}
                        item={item}
                        onApply={() => onApplyAndSwitchView(item.params)}
                        pricePrecision={pricePrecision}
                        isOpen={openId === index}
                        onToggle={() => handleToggle(index)}
                    />
                ))}
             </div>
        </div>
    )
};
