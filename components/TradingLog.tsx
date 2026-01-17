
// components/TradingLog.tsx

import React, { useState, useMemo } from 'react';
import Select, { StylesConfig, GroupBase } from 'react-select';
import { Trade, TradingMode, AgentParams, MarketDataContext, BitcoinState, OrderBookAnalysis } from '../types';
import * as constants from '../constants';
import { historyService } from '../services/historyService';
import { HistoryIcon, ChevronDown, ChevronUp, TrashIcon, DownloadIcon, ChartIcon, InfoIcon, SettingsIcon, ActivityIcon, SparklesIcon, ZapIcon } from './icons';

interface TradingLogProps {
    tradeHistory: Trade[];
    setTradeHistory: (trades: Trade[]) => void;
    theme: 'light' | 'dark';
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

// --- Sub-Components for Expanded View ---

const MetricCard: React.FC<{ label: string; value: React.ReactNode; subValue?: string; color?: string }> = ({ label, value, subValue, color = "text-slate-800 dark:text-slate-200" }) => (
    <div className="bg-slate-100 dark:bg-slate-700/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col justify-center">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mb-1">{label}</span>
        <div className={`text-sm font-bold font-mono ${color}`}>{value}</div>
        {subValue && <div className="text-[10px] text-slate-500 mt-0.5">{subValue}</div>}
    </div>
);

const BtcContextVisual: React.FC<{ btcContext?: BitcoinState }> = ({ btcContext }) => {
    if (!btcContext) return (
        <div className="p-3 bg-slate-100 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-700 h-full flex items-center justify-center text-xs text-slate-400">
            No BTC Context Recorded
        </div>
    );

    const isBullish = btcContext.state === 'TREND_UP' || btcContext.state === 'PUMP';
    const isBearish = btcContext.state === 'TREND_DOWN' || btcContext.state === 'CRASH';
    const bgClass = isBullish ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : isBearish ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700';
    const textClass = isBullish ? 'text-emerald-700 dark:text-emerald-300' : isBearish ? 'text-rose-700 dark:text-rose-300' : 'text-slate-700 dark:text-slate-300';

    return (
        <div className={`p-3 rounded-lg border ${bgClass} h-full`}>
            <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">BTC Environment</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/50 dark:bg-black/20 ${textClass}`}>{btcContext.state}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                    <span className="block opacity-60 text-[10px]">Trend</span>
                    <span className="font-semibold capitalize">{btcContext.trend}</span>
                </div>
                <div>
                    <span className="block opacity-60 text-[10px]">Momentum</span>
                    <span className="font-semibold capitalize">{btcContext.momentum}</span>
                </div>
            </div>
            {btcContext.reason && (
                <div className="mt-2 text-[10px] italic opacity-80 border-t border-black/5 dark:border-white/5 pt-1">
                    "{btcContext.reason}"
                </div>
            )}
        </div>
    );
};

const ContextComparisonRow: React.FC<{ label: string; entryVal: any; exitVal: any; format?: (v: any) => string }> = ({ label, entryVal, exitVal, format }) => {
    const formatValue = (v: any) => {
        if (v === undefined || v === null) return '-';
        return format ? format(v) : (typeof v === 'number' ? v.toFixed(2) : String(v));
    };

    return (
        <div className="grid grid-cols-3 border-b border-slate-200 dark:border-slate-700 py-1.5 text-xs last:border-0">
            <span className="text-slate-500 dark:text-slate-400 font-medium self-center">{label}</span>
            <span className="font-mono text-slate-800 dark:text-slate-200">{formatValue(entryVal)}</span>
            <span className="font-mono text-slate-800 dark:text-slate-200">{formatValue(exitVal)}</span>
        </div>
    );
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors border-b-2 ${
            active 
                ? 'border-sky-500 text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-slate-800' 
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50'
        }`}
    >
        {icon}
        <span>{label}</span>
    </button>
);

const ExpandedTradeDetails: React.FC<{ trade: Trade }> = ({ trade }) => {
    const [activeTab, setActiveTab] = useState<'overview' | 'context' | 'config'>('overview');

    // Extract metrics
    const durationMs = new Date(trade.exitTime).getTime() - new Date(trade.entryTime).getTime();
    const durationStr = durationMs > 3600000 
        ? `${(durationMs / 3600000).toFixed(1)}h` 
        : `${(durationMs / 60000).toFixed(0)}m`;
    
    const isProfit = trade.pnl >= 0;
    const entryContext = trade.entryContext || {};
    const exitContext = trade.exitContext || {};
    const titanData = entryContext.omega_metadata;

    const formatJSON = (data: any) => {
        try {
            return JSON.stringify(data, null, 2);
        } catch (e) {
            return 'Invalid Data';
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 border-x border-b border-slate-200 dark:border-slate-700 shadow-inner">
            <div className="flex border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
                <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={<ActivityIcon className="w-4 h-4"/>} label="Overview" />
                <TabButton active={activeTab === 'context'} onClick={() => setActiveTab('context')} icon={<ChartIcon className="w-4 h-4"/>} label="Market Data" />
                <TabButton active={activeTab === 'config'} onClick={() => setActiveTab('config')} icon={<SettingsIcon className="w-4 h-4"/>} label="Strategy & Config" />
            </div>

            <div className="p-4">
                {activeTab === 'overview' && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Column 1: Financials */}
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Financials</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <MetricCard label="Net PNL" value={`$${trade.pnl.toFixed(2)}`} color={isProfit ? 'text-emerald-600' : 'text-rose-600'} />
                                <MetricCard label="Return" value={`${((trade.pnl / (trade.investmentAmount || 1)) * 100).toFixed(2)}%`} color={isProfit ? 'text-emerald-600' : 'text-rose-600'} />
                                <MetricCard label="Invested" value={`$${trade.investmentAmount?.toFixed(0) || '0'}`} />
                                <MetricCard label="Leverage" value={`${trade.leverage}x`} />
                            </div>
                            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-slate-500">Entry Price</span>
                                    <span className="font-mono">{formatPrice(trade.entryPrice, trade.pricePrecision)}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-500">Exit Price</span>
                                    <span className="font-mono">{formatPrice(trade.exitPrice, trade.pricePrecision)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Column 2: Performance & Omega Context */}
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Performance & Context</h4>
                            {titanData ? (
                                <div className="grid grid-cols-2 gap-3 mb-3">
                                    <MetricCard label="Titan Tier" value={titanData.tier} color="text-sky-500" />
                                    <MetricCard label="RVOL Gate" value={`${titanData.rvol.toFixed(1)}x`} color={titanData.rvol > 1.5 ? "text-emerald-500" : "text-slate-400"} />
                                    <MetricCard label="Entry RSI" value={titanData.entryRsi.toFixed(1)} />
                                    <MetricCard label="Stop Dist" value={`${titanData.stopDistancePercent.toFixed(2)}%`} color="text-rose-500" />
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-3 mb-3">
                                    <MetricCard label="Risk : Reward" value={trade.initialRiskRewardRatio ? `${trade.initialRiskRewardRatio.toFixed(2)}` : 'N/A'} />
                                    <MetricCard label="Duration" value={durationStr} />
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <div className="p-2 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800 rounded">
                                    <div className="text-[9px] uppercase text-emerald-600 dark:text-emerald-400 font-bold">Max Profit (MFE)</div>
                                    <div className="font-mono text-sm text-emerald-700 dark:text-emerald-300">
                                        {trade.mfe ? `$${trade.mfe.toFixed(2)}` : 'N/A'}
                                    </div>
                                </div>
                                <div className="p-2 bg-rose-50 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-800 rounded">
                                    <div className="text-[9px] uppercase text-rose-600 dark:text-rose-400 font-bold">Max Drawdown (MAE)</div>
                                    <div className="font-mono text-sm text-rose-700 dark:text-rose-300">
                                        {trade.mae ? `$${trade.mae.toFixed(2)}` : 'N/A'}
                                    </div>
                                </div>
                            </div>
                            <BtcContextVisual btcContext={trade.btcContext} />
                        </div>

                        {/* Column 3: The Story */}
                        <div className="flex flex-col h-full">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Trade Narrative</h4>
                            <div className="flex-grow bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700 overflow-y-auto max-h-64 text-xs space-y-3">
                                <div>
                                    <span className="font-bold text-sky-600 dark:text-sky-400 block mb-1">Entry Reason</span>
                                    <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                                        {trade.entryReason || "No entry reason recorded."}
                                    </p>
                                </div>
                                <div className="border-t border-slate-200 dark:border-slate-600 pt-2">
                                    <span className="font-bold text-rose-600 dark:text-rose-400 block mb-1">Exit Reason</span>
                                    <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                                        {trade.exitReason || "No exit reason recorded."}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'context' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
                                <SparklesIcon className="w-4 h-4 text-sky-500"/> Indicator Delta (Entry vs Exit)
                            </h4>
                            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                                <div className="grid grid-cols-3 bg-slate-50 dark:bg-slate-700/50 py-2 px-3 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    <span>Metric</span>
                                    <span>Entry</span>
                                    <span>Exit</span>
                                </div>
                                <div className="px-3">
                                    <ContextComparisonRow label="RSI (14)" entryVal={titanData ? titanData.entryRsi : entryContext.rsi14} exitVal={exitContext.rsi14} format={v => v?.toFixed(1)} />
                                    <ContextComparisonRow label="ADX Strength" entryVal={titanData ? titanData.entryAdx : entryContext.adx14?.adx} exitVal={exitContext.adx14?.adx} format={v => v?.toFixed(1)} />
                                    <ContextComparisonRow label="ATR Volatility" entryVal={titanData ? titanData.entryAtr : entryContext.atr14} exitVal={exitContext.atr14} format={v => v?.toFixed(4)} />
                                    <ContextComparisonRow label="Stoch RSI (K)" entryVal={entryContext.stochRsi?.k} exitVal={exitContext.stochRsi?.k} format={v => v?.toFixed(1)} />
                                    <ContextComparisonRow label="Volume" entryVal={entryContext.lastVolume} exitVal={exitContext.lastVolume} format={v => v?.toFixed(0)} />
                                    <ContextComparisonRow label="Price vs EMA50" entryVal={entryContext.ema50 ? (trade.entryPrice - entryContext.ema50).toFixed(2) : '-'} exitVal={exitContext.ema50 ? (trade.exitPrice - exitContext.ema50).toFixed(2) : '-'} />
                                    <ContextComparisonRow label="Funding Rate" entryVal={trade.entryContext?.fundingRate} exitVal={trade.exitContext?.fundingRate} />
                                </div>
                            </div>
                        </div>
                        
                        <div>
                            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3">HTF Context (Entry)</h4>
                            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">HTF Trend</span>
                                    <span className={`font-bold uppercase ${entryContext.htf_trend === 'bullish' ? 'text-emerald-500' : entryContext.htf_trend === 'bearish' ? 'text-rose-500' : 'text-slate-500'}`}>
                                        {entryContext.htf_trend || 'N/A'}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">HTF RSI</span>
                                    <span className="font-mono">{entryContext.htf_rsi14?.toFixed(1) || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">HTF ADX</span>
                                    <span className="font-mono">{entryContext.htf_adx14?.adx?.toFixed(1) || 'N/A'}</span>
                                </div>
                            </div>

                            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-4 mb-3">Order Book (Entry)</h4>
                            {entryContext.orderBook ? (
                                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2 text-xs">
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Imbalance</span>
                                        <span className={`font-mono font-bold ${entryContext.orderBook.imbalance > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                            {(entryContext.orderBook.imbalance * 100).toFixed(2)}%
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Spread</span>
                                        <span className="font-mono">{(entryContext.orderBook.spread * 100).toFixed(3)}%</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Bid Wall</span>
                                        <span className="font-mono text-emerald-600">{entryContext.orderBook.bidWall || '-'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Ask Wall</span>
                                        <span className="font-mono text-rose-600">{entryContext.orderBook.askWall || '-'}</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-xs text-slate-400 italic bg-slate-50 dark:bg-slate-800/50 p-3 rounded">No Order Book snapshot available.</div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'config' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-2">Bot Configuration Snapshot</h4>
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-[10px] font-mono overflow-auto max-h-80">
                                <pre className="whitespace-pre-wrap text-slate-600 dark:text-slate-300">
                                    {formatJSON(trade.botConfigSnapshot)}
                                </pre>
                            </div>
                        </div>
                        <div>
                            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-2">Agent Parameters Snapshot</h4>
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-[10px] font-mono overflow-auto max-h-80">
                                <pre className="whitespace-pre-wrap text-slate-600 dark:text-slate-300">
                                    {formatJSON(trade.agentParamsSnapshot)}
                                </pre>
                            </div>
                        </div>
                    </div>
                )}
            </div>
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
        <React.Fragment>
            <tr onClick={onToggle} className={`border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer text-sm ${isOpen ? 'bg-slate-50 dark:bg-slate-800/50' : ''}`}>
                <td className="px-4 py-3 align-middle">
                     <div className="flex items-center gap-3">
                        <span className="text-slate-400">
                            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </span>
                        <div className="font-semibold">{trade.pair}</div>
                        {trade.promotedFrom === 'scalp' && (
                            <div className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300" title="Promoted from a scalp trade">
                                PRO
                            </div>
                        )}
                        <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${executionModeTag.bg} ${executionModeTag.text_color}`}>{executionModeTag.text}</div>
                        <div className="text-[10px] font-semibold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">{trade.timeFrame}</div>
                    </div>
                </td>
                <td className={`px-4 py-3 font-bold align-middle ${isLong ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {trade.direction}{trade.mode === TradingMode.USDSM_Futures && ` ${trade.leverage}x`}
                </td>
                <td className="px-4 py-3 align-middle font-mono text-slate-600 dark:text-slate-300">
                    ${trade.investmentAmount ? trade.investmentAmount.toFixed(0) : 'N/A'}
                </td>
                <td className="px-4 py-3 align-middle font-mono text-xs text-slate-500 dark:text-slate-400">
                    {formatDisplayDate(trade.entryTime)}
                </td>
                <td className="px-4 py-3 align-middle font-mono text-xs text-slate-500 dark:text-slate-400">
                    {formatDisplayDate(trade.exitTime)}
                </td>
                <td className={`px-4 py-3 font-bold align-middle font-mono ${isProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {isProfit ? '+' : ''}{formatPrice(trade.pnl, 2)}
                </td>
                <td className="px-4 py-3 align-middle text-slate-500 dark:text-slate-400 text-xs truncate max-w-[150px]" title={trade.agentName}>
                    {trade.agentName}
                </td>
            </tr>
            {isOpen && (
                <tr>
                    <td colSpan={7} className="p-0">
                        <ExpandedTradeDetails trade={trade} />
                    </td>
                </tr>
            )}
        </React.Fragment>
    );
};

const getCustomStyles = (isDark: boolean): StylesConfig<any, boolean, GroupBase<any>> => ({
    control: (provided, state) => ({
        ...provided,
        backgroundColor: isDark ? '#334155' : '#ffffff',
        borderColor: state.isFocused ? '#0ea5e9' : (isDark ? '#475569' : '#cbd5e1'),
        boxShadow: state.isFocused ? '0 0 0 1px #0ea5e9' : 'none',
        '&:hover': {
            borderColor: state.isFocused ? '#0ea5e9' : (isDark ? '#64748b' : '#94a3b8')
        },
        minHeight: '38px', borderRadius: '0.375rem'
    }),
    valueContainer: (provided) => ({ ...provided, padding: '0 8px' }),
    input: (provided) => ({ ...provided, margin: '0px', color: isDark ? '#f1f5f9' : '#1e293b' }),
    indicatorSeparator: () => ({ display: 'none' }),
    menu: (provided) => ({ ...provided, backgroundColor: isDark ? '#1e293b' : '#ffffff', border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`, zIndex: 50, borderRadius: '0.375rem' }),
    option: (provided, state) => ({ ...provided, backgroundColor: state.isSelected ? '#0ea5e9' : (state.isFocused ? (isDark ? '#334155' : '#f1f5f9') : 'transparent'), color: state.isSelected ? '#ffffff' : (isDark ? '#f1f5f9' : '#1e293b'), '&:active': { backgroundColor: isDark ? '#475569' : '#e2e8f0' }, cursor: 'pointer' }),
    multiValue: (provided) => ({ ...provided, backgroundColor: isDark ? '#475569' : '#e2e8f0' }),
    multiValueLabel: (provided) => ({ ...provided, color: isDark ? '#f1f5f9' : '#1e293b' }),
    placeholder: (provided) => ({ ...provided, color: isDark ? '#94a3b8' : '#64748b' })
});

export const TradingLog: React.FC<TradingLogProps> = ({ tradeHistory, setTradeHistory, theme }) => {
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

    const handleDelete = () => {
        const isFiltered = selectedTimeframes.length > 0;
        const message = isFiltered 
            ? `Are you sure you want to delete the ${filteredTrades.length} trades matching the current filter? This action cannot be undone.`
            : 'Are you sure you want to permanently delete all trade history? This action cannot be undone.';

        if (window.confirm(message)) {
            if (isFiltered) {
                const idsToDelete = new Set(filteredTrades.map(t => t.id));
                const newHistory = historyService.removeTrades(Array.from(idsToDelete));
                setTradeHistory(newHistory);
            } else {
                historyService.clearTrades();
                setTradeHistory([]);
            }
        }
    };

    const handleExport = () => {
        if (filteredTrades.length === 0) {
            alert("No trade history to export.");
            return;
        }
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
    
    const customStyles = useMemo(() => getCustomStyles(theme === 'dark'), [theme]);

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
                            styles={customStyles}
                        />
                    </div>
                    <button onClick={handleExport} className="p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-full transition-colors" title="Export Filtered History">
                        <DownloadIcon className="w-5 h-5" />
                    </button>
                    <button onClick={handleDelete} className="p-2 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-full transition-colors" title={selectedTimeframes.length > 0 ? "Delete Filtered History" : "Delete All History"}>
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
                            <th scope="col" className="px-4 py-2 font-medium">Inv.</th>
                            <th scope="col" className="px-4 py-2 font-medium">Entry Time</th>
                            <th scope="col" className="px-4 py-2 font-medium">Exit Time</th>
                            <th scope="col" className="px-4 py-2 font-medium" title="Profit/Loss after estimated trading fees">Net P/L ($)</th>
                            <th scope="col" className="px-4 py-2 font-medium">Agent</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {filteredTrades.length > 0 ? (
                            filteredTrades.map((trade) => <TradeRow key={trade.id} trade={trade} isOpen={expandedRowId === trade.id} onToggle={() => handleToggleRow(trade.id)}/>)
                        ) : (
                            <tr><td colSpan={7} className="text-center p-8 text-slate-500">No trades match the current filter.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
