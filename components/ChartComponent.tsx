import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { type Kline, type LiveTicker } from '../types';
import { ChartIcon } from './icons';
import * as constants from '../constants';
import { SearchableDropdown } from './SearchableDropdown';
import { createChart, ColorType, type IChartApi, type ISeriesApi, type CandlestickData, type UTCTimestamp, TickMarkType } from 'lightweight-charts';

interface ChartComponentProps {
    data: Kline[];
    pair: string;
    allPairs: string[];
    onPairChange: (newPair: string) => void;
    isLoading: boolean;
    pricePrecision: number;
    livePrice: number;
    liveTicker?: LiveTicker;
    chartTimeFrame: string;
    onTimeFrameChange: (newTimeFrame: string) => void;
    onLoadMoreData: () => void | Promise<void>;
    isFetchingMoreData: boolean;
    theme: 'light' | 'dark';
}

const getTimeframeDurationMs = (timeframe: string): number => {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1));
    if (isNaN(value)) return 0;

    switch (unit) {
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return 0;
    }
};

const CountdownTimer: React.FC<{ lastKline: Kline; timeframe: string }> = ({ lastKline, timeframe }) => {
    const [countdown, setCountdown] = useState('');
    const timeframeMs = getTimeframeDurationMs(timeframe);

    useEffect(() => {
        if (!timeframeMs || !lastKline) return;

        const interval = setInterval(() => {
            const lastTime = lastKline.time;
            const nextCloseTime = Math.floor(lastTime / timeframeMs) * timeframeMs + timeframeMs;
            const remaining = nextCloseTime - Date.now();
            
            if (remaining <= 0) {
                setCountdown('00:00');
            } else {
                const minutes = Math.floor((remaining / 1000) / 60);
                const seconds = Math.floor((remaining / 1000) % 60);
                setCountdown(`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
            }
        }, 500);

        return () => clearInterval(interval);
    }, [lastKline, timeframe, timeframeMs]);
    
    if(!lastKline) return null;

    return (
         <div className="absolute top-4 left-4 z-20 bg-slate-100/80 dark:bg-slate-900/80 backdrop-blur-sm px-2 py-1 rounded-md text-slate-700 dark:text-slate-200 text-xs font-mono">
             Candle closes in: <span className="font-bold">{countdown}</span>
        </div>
    );
};

const TimeFrameSelector: React.FC<{selected: string, onSelect: (tf: string) => void}> = ({ selected, onSelect }) => (
    <div className="flex items-center bg-slate-100 dark:bg-slate-700/50 rounded-md p-1">
        {constants.TIME_FRAMES.map(tf => (
            <button 
                key={tf}
                onClick={() => onSelect(tf)}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${selected === tf ? 'bg-sky-600 text-white shadow' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
            >
                {tf}
            </button>
        ))}
    </div>
);


export const ChartComponent: React.FC<ChartComponentProps> = (props) => {
    const { 
        data, pair, isLoading, pricePrecision, livePrice, 
        chartTimeFrame, onTimeFrameChange, allPairs, onPairChange,
        onLoadMoreData, isFetchingMoreData, theme 
    } = props;
    
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    
    const [priceChange, setPriceChange] = useState<'up' | 'down' | 'none'>('none');
    const prevPriceRef = useRef(livePrice);
    
    const onLoadMoreDataRef = useRef(onLoadMoreData);
    onLoadMoreDataRef.current = onLoadMoreData;
    const isFetchingMoreDataRef = useRef(isFetchingMoreData);
    isFetchingMoreDataRef.current = isFetchingMoreData;
    
    useEffect(() => {
        if (livePrice > prevPriceRef.current) setPriceChange('up');
        else if (livePrice < prevPriceRef.current) setPriceChange('down');
        prevPriceRef.current = livePrice;
        const timeout = setTimeout(() => setPriceChange('none'), 500);
        return () => clearTimeout(timeout);
    }, [livePrice]);

    useLayoutEffect(() => {
        if (!chartContainerRef.current) return;
        const chartContainer = chartContainerRef.current;

        const chart = createChart(chartContainer, {
            localization: {
                locale: navigator.language,
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                tickMarkFormatter: (time: UTCTimestamp, tickMarkType: TickMarkType, locale: string) => {
                    const date = new Date(time * 1000);
                    switch (tickMarkType) {
                        case TickMarkType.Year:
                            return date.toLocaleDateString(locale, { year: 'numeric' });
                        case TickMarkType.Month:
                            return date.toLocaleDateString(locale, { month: 'short' });
                        case TickMarkType.DayOfMonth:
                            return date.toLocaleDateString(locale, { day: 'numeric' });
                        case TickMarkType.Time:
                            return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
                        case TickMarkType.TimeWithSeconds:
                            return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    }
                    return '';
                },
            },
        });
        
        const candlestickSeries = (chart as any).addCandlestickSeries({});
        
        chartRef.current = chart;
        candlestickSeriesRef.current = candlestickSeries;

        chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
            if (range && range.from < 10 && !isFetchingMoreDataRef.current) {
                 onLoadMoreDataRef.current();
            }
        });
        
        const resizeObserver = new ResizeObserver(entries => {
            if (entries.length === 0 || entries[0].target !== chartContainer) { return; }
            const { width, height } = entries[0].contentRect;
            if (width > 0 && height > 0) {
                chart.resize(width, height);
            }
        });

        resizeObserver.observe(chartContainer);
        
        return () => {
            resizeObserver.disconnect();
            chart.remove();
            chartRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!chartRef.current || !candlestickSeriesRef.current) return;

        const isDark = theme === 'dark';
        const minMove = 1 / Math.pow(10, pricePrecision);

        chartRef.current.applyOptions({
            layout: {
                background: { type: ColorType.Solid, color: isDark ? '#1e293b' : '#ffffff' },
                textColor: isDark ? '#d1d5db' : '#374151',
            },
            grid: {
                vertLines: { color: isDark ? '#334155' : '#e5e7eb' },
                horzLines: { color: isDark ? '#334155' : '#e5e7eb' },
            },
            rightPriceScale: {
                borderColor: isDark ? '#334155' : '#e5e7eb',
            },
            timeScale: {
                borderColor: isDark ? '#334155' : '#e5e7eb',
            },
        });
        
        candlestickSeriesRef.current.applyOptions({
            wickUpColor: isDark ? '#22c55e' : '#16a34a',
            upColor: isDark ? '#22c55e' : '#16a34a',
            wickDownColor: isDark ? '#ef4444' : '#dc2626',
            downColor: isDark ? '#ef4444' : '#dc2626',
            borderVisible: false,
            priceFormat: {
                type: 'price',
                precision: pricePrecision,
                minMove: minMove,
            },
        });
        
    }, [theme, pricePrecision]);

    useEffect(() => {
        if (candlestickSeriesRef.current) {
            const chartData = data.map(k => ({
                time: (k.time / 1000) as UTCTimestamp,
                open: k.open,
                high: k.high,
                low: k.low,
                close: k.close,
            })) as CandlestickData[];
            
            candlestickSeriesRef.current.setData(chartData);
        }
    }, [data]);
    
    useEffect(() => {
        if (candlestickSeriesRef.current && livePrice > 0 && data.length > 0) {
            const lastKline = data[data.length - 1];
            candlestickSeriesRef.current.update({
                time: (lastKline.time / 1000) as UTCTimestamp,
                open: lastKline.open,
                high: Math.max(lastKline.high, livePrice),
                low: Math.min(lastKline.low, livePrice),
                close: livePrice,
            });
        }
    }, [livePrice, data]);

    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm relative h-96 md:h-[500px] flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                    <div className="w-64">
                         <SearchableDropdown
                            options={allPairs}
                            value={pair}
                            onChange={onPairChange}
                            theme={theme}
                        />
                    </div>
                   <div className={`text-xl font-bold transition-colors duration-300 ${priceChange === 'up' ? 'text-emerald-500' : priceChange === 'down' ? 'text-rose-500' : 'dark:text-white'}`}>
                        {livePrice > 0 ? livePrice.toFixed(pricePrecision) : '...'}
                    </div>
                </div>
                <TimeFrameSelector selected={chartTimeFrame} onSelect={onTimeFrameChange} />
            </div>
            <div className="flex-grow relative">
                {(isLoading || isFetchingMoreData) && (
                    <div className="absolute inset-0 bg-white/70 dark:bg-slate-800/70 z-30 flex items-center justify-center">
                        <div className="text-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500 mx-auto"></div>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{isFetchingMoreData ? 'Loading more data...' : 'Loading chart...'}</p>
                        </div>
                    </div>
                )}
                <div ref={chartContainerRef} className="w-full h-full" />
                {data.length > 0 && <CountdownTimer lastKline={data[data.length - 1]} timeframe={chartTimeFrame} />}
            </div>
        </div>
    );
};