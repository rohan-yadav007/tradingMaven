import React, { useState } from 'react';
import { OptimizationResultItem, AgentParams } from '../types';
import { ChevronDown, ChevronUp } from './icons';

interface OptimizationResultsProps {
    results: OptimizationResultItem[];
    onApplyAndSwitchView: (params: AgentParams) => void;
    pricePrecision: number;
}

const ResultMetric: React.FC<{label: string, value: string | number, className?: string}> = ({label, value, className}) => (
    <div className="text-center">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-0">{label}</p>
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
    const sideClass = (dir: 'LONG' | 'SHORT') => dir === 'LONG' ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300';
    
    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm">
            <button onClick={onToggle} className="w-full text-left p-3 focus:outline-none">
                 <div className="grid grid-cols-3 md:grid-cols-4 gap-3 w-full items-center">
                     <ResultMetric label="Total PNL" value={`$${result.totalPnl.toFixed(2)}`} className={pnlIsProfit ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}/>
                     <ResultMetric label="Win Rate" value={`${result.winRate.toFixed(1)}%`} className={winRateIsGood ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} />
                     <ResultMetric label="Trades" value={result.totalTrades} />
                     <div className="hidden md:flex justify-end pr-2">
                        {isOpen ? <ChevronUp className="w-5 h-5 text-gray-400"/> : <ChevronDown className="w-5 h-5 text-gray-400"/>}
                     </div>
                </div>
            </button>
            {isOpen && (
                <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-grow">
                            <h4 className="font-semibold text-sm mb-2">Trade Log</h4>
                            <div className="overflow-auto border dark:border-gray-700 rounded-md" style={{maxHeight: '240px'}}>
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
                                        <tr>
                                            <th className="px-2 py-1.5">Exit Time</th><th className="px-2 py-1.5">Side</th>
                                            <th className="px-2 py-1.5">PNL</th><th className="px-2 py-1.5">Reason</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                        {result.trades.map(trade => (
                                            <tr key={trade.id}>
                                                <td className="px-2 py-1.5 whitespace-nowrap">{new Date(trade.exitTime).toLocaleDateString()}</td>
                                                <td className="px-2 py-1.5"><span className={`px-2 py-0.5 rounded-full font-medium ${sideClass(trade.direction)}`}>{trade.direction}</span></td>
                                                <td className={`px-2 py-1.5 font-mono ${trade.pnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{trade.pnl.toFixed(2)}</td>
                                                <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400 truncate">{trade.exitReason}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="w-full md:max-w-xs">
                            <h4 className="font-semibold text-sm mb-2">Parameters Used</h4>
                            <div className="text-xs p-3 bg-gray-100 dark:bg-gray-900/50 rounded-lg border dark:border-gray-700 mb-3 space-y-1">
                                {Object.entries(params).map(([key, value]) => (
                                    <div key={key} className="flex justify-between">
                                        <span className="text-gray-500 dark:text-gray-400">{key}:</span>
                                        <span className="font-mono font-semibold">{String(value)}</span>
                                    </div>
                                ))}
                            </div>
                             <button onClick={onApply} className="w-full px-4 py-2 bg-blue-600 text-white font-semibold rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                                Use This Configuration
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};


export const OptimizationResults: React.FC<OptimizationResultsProps> = ({ results, onApplyAndSwitchView, pricePrecision }) => {
    const [openId, setOpenId] = useState<number | null>(0);

    const handleToggle = (id: number) => {
        setOpenId(prevId => prevId === id ? null : id);
    };

    return (
        <div className="flex flex-col gap-4">
             <h3 className="font-bold text-lg">Optimization Results ({results.length} combinations)</h3>
             <div className="space-y-2" style={{maxHeight: '80vh', overflowY: 'auto'}}>
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