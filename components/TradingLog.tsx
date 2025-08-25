import React, { useState, useMemo } from 'react';
import Select from 'react-select';
import { Trade, TradingMode, AgentParams, MarketDataContext } from '../types';
import * as constants from '../constants';
import { HistoryIcon, ChevronDown, ChevronUp, TrashIcon, DownloadIcon } from './icons';

interface TradingLogProps {
    tradeHistory: Trade[];
    onClearHistory: () => void;
}

const formatPrice = (price: number | undefined, precision: number) => {
    if (price === undefined || price === null) return 'N/A';
    return price.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
};

const formatDisplayDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
};

const DetailItem: React.FC<{ label: string; value: React.ReactNode; valueClass?: string }> = ({ label, value, valueClass }) => (
    <div>
        <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">{label}</h4>
        <div className={`text-slate-500 dark:text-slate-400 ${valueClass}`}>{value}</div>
    </div>
);

const ParamDisplay: React.FC<{ params?: AgentParams }> = ({ params }) => {
    if (!params || Object.keys(params).length === 0) {
        return <p>Default</p>;
    }
    return (
        <div className="space-y-0.5 font-mono text-xs p-2 bg-slate-100 dark:bg-slate-900/50 rounded">
            {Object.entries(params).map(([key, value]) => (
                <div key={key} className="flex justify-between">
                    <span>{key}:</span>
                    <span className="font-semibold">{String(value)}</span>
                </div>
            ))}
        </div>
    );
};

const MarketContextDisplay: React.FC<{ context?: MarketDataContext, title: string }> = ({ context, title }) => {
    if (!context || Object.keys(context).length === 0) return (
        <div>
            <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">{title}</h4>
            <p className="text-xs text-slate-400">Context data not available for this trade.</p>
        </div>
    );

    const { mainContext, htfContext } = useMemo(() => {
        const main: Partial<MarketDataContext> = {};
        const htf: Partial<MarketDataContext> = {};
        for (const key in context) {
            if (key.startsWith('htf_')) {
                const newKey = key.substring(4) as keyof MarketDataContext;
                (htf as any)[newKey] = (context as any)[key];
            } else {
                (main as any)[key] = (context as any)[key];
            }
        }
        return { mainContext: main, htfContext: htf };
    }, [context]);

    const formatValue = (key: keyof MarketDataContext, value: any): React.ReactNode => {
        if (value === null || value === undefined) return 'N/A';
        if (typeof value === 'number') return value.toFixed(4);
        if (typeof value === 'string') return value;
        if (key === 'adx14' && value.adx) return `ADX: ${value.adx.toFixed(2)}`;
        if (key === 'macd' && value.histogram) return `H: ${value.histogram.toFixed(4)}`;
        if (key === 'stochRsi' && value.k) return `K: ${value.k.toFixed(2)}, D: ${value.d.toFixed(2)}`;
        if (key === 'bb20_2' && value.upper) return `U: ${value.upper.toFixed(4)}, L: ${value.lower.toFixed(4)}`;
        if (key === 'lastCandlePattern' && value.name) return `${value.name} (${value.type})`;
        if (key === 'vi14' && value.pdi) return `+VI: ${value.pdi.toFixed(2)}, -VI: ${value.ndi.toFixed(2)}`;
        if (key === 'ichiCloud' && value.spanA) return `SpanA: ${value.spanA.toFixed(4)}`;
        
        return JSON.stringify(value);
    };

    const renderItem = (key: keyof MarketDataContext, value: any) => {
        if (value === undefined || value === null || (typeof value === 'object' && Object.keys(value).length === 0)) return null;
        return (
             <div key={key} className="flex justify-between items-baseline">
                <span className="text-slate-400 capitalize">{key.replace(/([A-Z0-9]+)/g, " $1").trim()}:</span>
                <span className="font-semibold text-slate-200">{formatValue(key, value)}</span>
            </div>
        )
    };

    const renderContextBlock = (ctx: Partial<MarketDataContext>, subtitle: string) => {
        if (Object.keys(ctx).length === 0) return null;
        return (
            <div>
                <h5 className="font-medium text-slate-500 dark:text-slate-400 text-xs mb-1">{subtitle}</h5>
                <div className="space-y-1 font-mono text-xs p-2 bg-slate-100 dark:bg-slate-900/50 rounded">
                    {Object.entries(ctx).map(([key, value]) => renderItem(key as keyof MarketDataContext, value))}
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-2">
            <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">{title}</h4>
            {renderContextBlock(mainContext, "Main Timeframe")}
            {renderContextBlock(htfContext, "Higher Timeframe")}
        </div>
    );
};


const TradeRow: React.FC<{ trade: Trade; isOpen: boolean; onToggle: () => void; }> = ({ trade, isOpen, onToggle }) => {
    const isLong = trade.direction === 'LONG';
    const isProfit = trade.pnl >= 0;
    
    const executionModeTag = trade.executionMode === 'live'
        ? { text: 'LIVE', bg: 'bg-amber-100 dark:bg-amber-900', text_color: 'text-amber-700 dark:text-amber-300' }
        : { text: 'PAPER', bg: 'bg-sky-100 dark:bg-sky-900', text_color: 'text-sky-700 dark:text-sky-300' };

    return (
        <>
            <tr onClick={onToggle} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer text-sm">
                <td className="px-4 py-3 align-middle">
                     <div className="flex items-center gap-3">
                        <span className="text-slate-400">
                            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </span>
                        <div className="font-semibold">{trade.pair}</div>
                        <div className={`text-xs font-bold px-2 py-0.5 rounded-full ${executionModeTag.bg} ${executionModeTag.text_color}`}>{executionModeTag.text}</div>
                        <div className="text-xs font-semibold bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded-full">{trade.timeFrame}</div>
                    </div>
                </td>
                <td className={`px-4 py-3 font-bold align-middle ${isLong ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {trade.direction}{trade.mode === TradingMode.USDSM_Futures && ` ${trade.leverage}x`}
                </td>
                <td className="px-4 py-3 align-middle font-mono">{formatDisplayDate(trade.exitTime)}</td>
                <td className={`px-4 py-3 font-bold align-middle font-mono ${isProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {isProfit ? '+' : ''}{formatPrice(trade.pnl, 2)}
                </td>
                <td className="px-4 py-3 align-middle text-slate-500 dark:text-slate-400">{trade.agentName}</td>
            </tr>
            {isOpen && (
                <tr className="bg-slate-50 dark:bg-slate-800/20">
                    <td colSpan={5} className="px-4 py-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 text-xs p-2">
                            <div className="space-y-4">
                                <DetailItem label="Entry" value={<><p className="font-mono">{formatPrice(trade.entryPrice, trade.pricePrecision)}</p><p>{formatDisplayDate(trade.entryTime)}</p></>} />
                                <DetailItem label="Exit" value={<><p className="font-mono">{formatPrice(trade.exitPrice, trade.pricePrecision)}</p><p>{formatDisplayDate(trade.exitTime)}</p></>} />
                                <DetailItem label="Performance" value={
                                    <div className="font-mono space-y-1">
                                        <p>Initial R:R: <span className="font-semibold">{trade.initialRiskRewardRatio?.toFixed(2) ?? 'N/A'}:1</span></p>
                                        <p>MFE: <span className="font-semibold text-emerald-500">${trade.mfe?.toFixed(2) ?? 'N/A'}</span></p>
                                        <p>MAE: <span className="font-semibold text-rose-500">${trade.mae?.toFixed(2) ?? 'N/A'}</span></p>
                                    </div>
                                } />
                            </div>
                            <div className="space-y-4">
                               <MarketContextDisplay title="Entry Context" context={trade.entryContext} />
                               <MarketContextDisplay title="Exit Context" context={trade.exitContext} />
                            </div>
                            <div className="space-y-4">
                                 <DetailItem label="Entry Reason" value={<p className="whitespace-pre-wrap break-words">{trade.entryReason || 'N/A'}</p>} />
                                <DetailItem label="Exit Reason" value={<p className="whitespace-pre-wrap break-words">{trade.exitReason}</p>} />
                                <DetailItem label="Bot Config Snapshot" value={
                                     <div className="font-mono space-y-1">
                                        {Object.entries(trade.botConfigSnapshot || {}).map(([key, value]) => (
                                             <p key={key}>{key}: <span className="font-semibold">{String(value)}</span></p>
                                        ))}
                                     </div>
                                 } />
                                 <DetailItem label="Agent Params Snapshot" value={<ParamDisplay params={trade.agentParamsSnapshot} />} />
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
};

export const TradingLog: React.FC<TradingLogProps> = ({ tradeHistory, onClearHistory }) => {
    const [expandedRowId, setExpandedRowId] = useState<number | null>(null);
    const [selectedTimeframes, setSelectedTimeframes] = useState<{ value: string; label: string; }[]>([]);

    const timeframeOptions = useMemo(() => 
        constants.TIME_FRAMES.map(tf => ({ value: tf, label: tf })), 
    []);

    const filteredTrades = useMemo(() => {
        if (selectedTimeframes.length === 0) {
            return tradeHistory;
        }
        const selectedValues = selectedTimeframes.map(tf => tf.value);
        return tradeHistory.filter(trade => selectedValues.includes(trade.timeFrame));
    }, [tradeHistory, selectedTimeframes]);

    const { totalPnl, wins, losses } = useMemo(() => {
        return filteredTrades.reduce((acc, trade) => {
            acc.totalPnl += trade.pnl;
            if (trade.pnl > 0) {
                acc.wins++;
            } else if (trade.pnl < 0) {
                acc.losses++;
            }
            return acc;
        }, { totalPnl: 0, wins: 0, losses: 0 });
    }, [filteredTrades]);

    const handleToggleRow = (tradeId: number) => {
        setExpandedRowId(prevId => (prevId === tradeId ? null : tradeId));
    };

    const handleExport = () => {
        if (filteredTrades.length === 0) {
            alert("No trade history to export.");
            return;
        }
        // Format as a single, pretty-printed JSON array string.
        const dataToExport = JSON.stringify(filteredTrades, null, 2);
        const blob = new Blob([dataToExport], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'trade_history.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden min-h-14">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center flex-wrap gap-4">
                <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100 font-semibold">
                        <HistoryIcon className="w-5 h-5 text-sky-500"/>
                        <span>Trade History</span>
                        <span className="text-xs font-normal bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full">{filteredTrades.length} / {tradeHistory.length} trades</span>
                    </div>
                    
                    {tradeHistory.length > 0 && (
                        <div className="flex items-center gap-3 border-l border-slate-200 dark:border-slate-700 pl-3">
                            <div className="text-xs font-semibold">
                                <span className="text-slate-500 dark:text-slate-400 font-normal mr-1">Total PNL:</span>
                                <span className={totalPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                                    ${totalPnl.toFixed(2)}
                                </span>
                            </div>
                            <div className="text-xs font-semibold">
                                <span className="text-slate-500 dark:text-slate-400 font-normal mr-1">W/L:</span>
                                <span className="text-emerald-600 dark:text-emerald-400">{wins}</span>
                                <span className="text-slate-400 mx-0.5">/</span>
                                <span className="text-rose-600 dark:text-rose-400">{losses}</span>
                            </div>
                        </div>
                    )}
                </div>
                 <div className="flex items-center gap-2">
                    <div className="w-48">
                         <Select
                            isMulti
                            options={timeframeOptions}
                            value={selectedTimeframes}
                            onChange={(selected) => setSelectedTimeframes(selected as any)}
                            placeholder="Filter by timeframe..."
                            className="text-sm react-select-container"
                            classNamePrefix="react-select"
                            styles={{
                                menu: (provided) => ({ ...provided, zIndex: 50 }),
                            }}
                        />
                    </div>
                    <button onClick={handleExport} className="p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-full transition-colors" title="Export Filtered History">
                        <DownloadIcon className="w-5 h-5" />
                    </button>
                    <button onClick={onClearHistory} className="p-2 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-full transition-colors" title="Delete All History">
                        <TrashIcon className="w-5 h-5" />
                    </button>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-slate-800 dark:text-slate-200">
                    <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-700/50 sticky top-0 z-10">
                        <tr>
                            <th scope="col" className="px-4 py-2 font-medium">Market</th>
                            <th scope="col" className="px-4 py-2 font-medium">Direction</th>
                            <th scope="col" className="px-4 py-2 font-medium">Exit Time</th>
                            <th scope="col" className="px-4 py-2 font-medium" title="Profit/Loss after estimated trading fees">Net P/L ($)</th>
                            <th scope="col" className="px-4 py-2 font-medium">Agent</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {filteredTrades.length > 0 ? (
                            filteredTrades.map((trade) => <TradeRow key={trade.id} trade={trade} isOpen={expandedRowId === trade.id} onToggle={() => handleToggleRow(trade.id)}/>)
                        ) : (
                            <tr><td colSpan={5} className="text-center p-8 text-slate-500">No trades match the current filter.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};