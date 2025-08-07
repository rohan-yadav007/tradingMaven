
import React, { useState } from 'react';
import { Trade, TradingMode } from '../types';
import { HistoryIcon, ChevronDown, ChevronUp } from './icons';

interface TradingLogProps {
    tradeHistory: Trade[];
    onLoadMoreHistory: () => void;
}

const formatPrice = (price: number | undefined, precision: number) => {
    if (price === undefined || price === null) return 'N/A';
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision })}`;
};

const formatDisplayDate = (dateString: Date): string => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
};

const TradeRow: React.FC<{ trade: Trade; isOpen: boolean; onToggle: () => void; }> = ({ trade, isOpen, onToggle }) => {
    const isLong = trade.direction === 'LONG';
    const isProfit = trade.pnl >= 0;
    return (
        <>
            <tr onClick={onToggle} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer">
                <td className="px-4 py-3 align-middle text-xs">
                     <div className="flex items-center gap-2">
                        <span className="text-slate-400">
                            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </span>
                        <div>
                            <div>{formatDisplayDate(trade.exitTime)}</div>
                            {trade.botId && <div className="text-sky-500 font-mono opacity-80">{trade.botId}</div>}
                        </div>
                    </div>
                </td>
                <td className="px-4 py-3 font-semibold align-middle text-sm">{trade.pair}</td>
                <td className={`px-4 py-3 font-bold align-middle text-sm ${isLong ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {trade.direction}{trade.mode === TradingMode.USDSM_Futures && ` ${trade.leverage}x`}
                </td>
                <td className="px-4 py-3 align-middle font-mono text-sm">{formatPrice(trade.entryPrice, trade.pricePrecision)}</td>
                <td className="px-4 py-3 align-middle font-mono text-sm">{formatPrice(trade.exitPrice, trade.pricePrecision)}</td>
                <td className={`px-4 py-3 font-bold align-middle font-mono text-sm ${isProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {isProfit ? '+' : ''}{formatPrice(trade.pnl, 2)}
                </td>
                <td className="px-4 py-3 align-middle text-sm">{trade.agentName}</td>
            </tr>
            {isOpen && (
                <tr className="bg-slate-50 dark:bg-slate-800/20">
                    <td colSpan={7} className="px-4 py-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs p-2">
                             <div>
                                <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">Entry Reason</h4>
                                <p className="text-slate-500 dark:text-slate-400 whitespace-pre-wrap break-words">{trade.entryReason || 'N/A'}</p>
                            </div>
                            <div>
                                <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">Exit Reason</h4>
                                <p className="text-slate-500 dark:text-slate-400 whitespace-pre-wrap break-words">{trade.exitReason}</p>
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
};

export const TradingLog: React.FC<TradingLogProps> = ({ tradeHistory, onLoadMoreHistory }) => {
    const [visibleCount, setVisibleCount] = useState(5);
    const [expandedRowId, setExpandedRowId] = useState<number | null>(null);

    const handleToggleRow = (tradeId: number) => {
        setExpandedRowId(prevId => (prevId === tradeId ? null : tradeId));
    };

    const handleShowMore = () => {
        setVisibleCount(prev => Math.min(prev + 10, tradeHistory.length));
    };

    const allLoadedTradesVisible = visibleCount >= tradeHistory.length;
    const visibleTrades = tradeHistory.slice(0, visibleCount);

    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100 font-semibold">
                    <HistoryIcon className="w-5 h-5 text-sky-500"/>
                    Trade History
                    <span className="text-xs font-normal bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full">{tradeHistory.length}</span>
                </div>
            </div>
            <div className="overflow-x-auto" style={{maxHeight: '400px'}}>
                <table className="w-full text-sm text-left text-slate-800 dark:text-slate-200">
                    <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-700/50 sticky top-0 z-10">
                        <tr>
                            <th scope="col" className="px-4 py-2 font-medium">Exit Time/Bot ID</th>
                            <th scope="col" className="px-4 py-2 font-medium">Pair</th>
                            <th scope="col" className="px-4 py-2 font-medium">Direction</th>
                            <th scope="col" className="px-4 py-2 font-medium">Entry</th>
                            <th scope="col" className="px-4 py-2 font-medium">Exit</th>
                            <th scope="col" className="px-4 py-2 font-medium">P/L</th>
                            <th scope="col" className="px-4 py-2 font-medium">Agent</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visibleTrades.length > 0 ? (
                            visibleTrades.map((trade) => <TradeRow key={trade.id} trade={trade} isOpen={expandedRowId === trade.id} onToggle={() => handleToggleRow(trade.id)}/>)
                        ) : (
                            <tr><td colSpan={7} className="text-center p-8 text-slate-500">No trade history recorded yet.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
             {(tradeHistory.length > 5 || !allLoadedTradesVisible) && (
                <div className="text-center border-t border-slate-200 dark:border-slate-700 p-2">
                    {!allLoadedTradesVisible ? (
                        <button onClick={handleShowMore} className="text-sm font-semibold text-sky-600 dark:text-sky-400 hover:underline focus:outline-none">
                            Show More ({tradeHistory.length - visibleCount} hidden)
                        </button>
                    ) : (
                        <button onClick={onLoadMoreHistory} className="text-sm font-semibold text-sky-600 dark:text-sky-400 hover:underline focus:outline-none">
                            Load Older Trades from History
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};