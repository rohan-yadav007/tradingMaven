import React from 'react';
import { OrderBook, OrderBookEntry } from '../types';
import { ActivityIcon } from './icons';

interface DepthChartProps {
    orderBook: OrderBook | null;
    pricePrecision: number;
}

const DepthRow: React.FC<{
    entry: OrderBookEntry;
    type: 'bid' | 'ask';
    maxTotal: number;
    pricePrecision: number;
}> = ({ entry, type, maxTotal, pricePrecision }) => {
    const barWidth = maxTotal > 0 ? (entry.total / maxTotal) * 100 : 0;
    const isBid = type === 'bid';

    const barColor = isBid ? 'bg-emerald-500/20' : 'bg-rose-500/20';
    const textColor = isBid ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400';
    
    return (
        <div className="relative grid grid-cols-3 text-xs font-mono py-0.5 px-2">
            <div
                className={`absolute top-0 bottom-0 ${barColor} transition-all duration-200 ${isBid ? 'right-0' : 'left-0'}`}
                style={{ width: `${barWidth}%` }}
            ></div>
            <span className={`relative z-10 ${isBid ? `text-left ${textColor}` : 'text-left'}`}>
                {entry.price.toFixed(pricePrecision)}
            </span>
            <span className="relative z-10 text-right text-slate-800 dark:text-slate-200">{entry.amount.toFixed(4)}</span>
            <span className="relative z-10 text-right text-slate-500 dark:text-slate-400">{entry.total.toLocaleString('en-US', {maximumFractionDigits: 0})}</span>
        </div>
    );
};

export const DepthChart: React.FC<DepthChartProps> = ({ orderBook, pricePrecision }) => {
    if (!orderBook) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center">
                <ActivityIcon className="w-8 h-8 text-slate-400 dark:text-slate-500 mb-2 animate-pulse" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Waiting for Order Book</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Connecting to depth stream...</p>
            </div>
        );
    }
    
    const { bids, asks, spread, spreadPercentage } = orderBook;
    const maxBidTotal = bids[0]?.total || 0;
    const maxAskTotal = asks[asks.length - 1]?.total || 0;
    const maxCumulativeTotal = Math.max(maxBidTotal, maxAskTotal);

    return (
        <div className="flex flex-col gap-2 h-full text-sm">
             <div className="grid grid-cols-2 gap-4 text-xs font-semibold text-slate-500 dark:text-slate-400 px-2">
                <span className="text-right">Bids (Buyers)</span>
                <span>Asks (Sellers)</span>
             </div>
             <div className="grid grid-cols-2 gap-4 h-full overflow-hidden">
                {/* Bids Column */}
                <div className="flex flex-col overflow-y-auto">
                     <div className="grid grid-cols-3 text-xs text-slate-500 dark:text-slate-400 px-2 mb-1 sticky top-0 bg-white dark:bg-slate-800 py-1">
                        <span className="text-left">Price</span>
                        <span className="text-right">Amount</span>
                        <span className="text-right">Total</span>
                    </div>
                    <div className="flex-grow">
                        {bids.map((bid, index) => (
                            <DepthRow key={index} entry={bid} type="bid" maxTotal={maxCumulativeTotal} pricePrecision={pricePrecision} />
                        ))}
                    </div>
                </div>

                {/* Asks Column */}
                 <div className="flex flex-col overflow-y-auto">
                     <div className="grid grid-cols-3 text-xs text-slate-500 dark:text-slate-400 px-2 mb-1 sticky top-0 bg-white dark:bg-slate-800 py-1">
                        <span className="text-left">Price</span>
                        <span className="text-right">Amount</span>
                        <span className="text-right">Total</span>
                    </div>
                    <div className="flex-grow">
                        {asks.map((ask, index) => (
                            <DepthRow key={index} entry={ask} type="ask" maxTotal={maxCumulativeTotal} pricePrecision={pricePrecision} />
                        ))}
                    </div>
                </div>
            </div>

            <div className="mt-auto pt-2 border-t border-slate-200 dark:border-slate-700">
                <div className="flex justify-center items-baseline gap-2 text-center p-2 bg-slate-100 dark:bg-slate-700/50 rounded-md">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Spread:</span>
                    <span className="font-semibold font-mono text-slate-800 dark:text-slate-200">{spread.toFixed(pricePrecision)}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">({spreadPercentage.toFixed(3)}%)</span>
                </div>
            </div>
        </div>
    );
};