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
    fundingInfo: { rate: string; time: number } | null;
}

const getTimeframeDurationMs = (timeframe: string): number => {
    const unit = timeframe.slice(-1);
    // FIX: Added radix to parseInt for safer integer parsing.
    const value = parseInt(timeframe.slice(0, -1), 10);
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

const FundingRateTimer: React.FC<{ fundingInfo: { rate: string; time: number } }> = ({ fundingInfo }) => {
    const [countdown, setCountdown] = useState('');

    useEffect(() => {
        if (!fundingInfo) return;

        const interval = setInterval(() => {
            const remaining = fundingInfo.time - Date.now();
            if (remaining <= 0) {
                setCountdown('00:00:00');
            } else {
                const hours = Math.floor((remaining / (1000 * 60 * 60)));
                const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
                setCountdown(
                    `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
                );
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [fundingInfo]);

    if (!fundingInfo) return null;

    const rateIsPositive = parseFloat(fundingInfo.rate) > 0;

    return (
        <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
            <span>Funding: </span>
            <span className={rateIsPositive ? 'text-emerald-500' : 'text-rose-500'}>
                {fundingInfo.rate}%
            </span>
            <span className="ml-2">in {countdown}</span>
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
        onLoadMoreData, isFetchingMoreData, theme, fundingInfo 
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
                // Formatter for the crosshair label to ensure it's in local time
                timeFormatter: (timestamp: UTCTimestamp) => {
                    return new Date(timestamp * 1000).toLocaleString(navigator.language, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                    });
                },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                // Formatter for the time axis labels, explicitly using the browser's locale
                tickMarkFormatter: (time: UTCTimestamp, tickMarkType: TickMarkType) => {
                    const date = new Date(time * 1000);
                    const language = navigator.language;

                    const timeOptions: Intl.DateTimeFormatOptions = {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                    };

                    switch (tickMarkType) {
                        case TickMarkType.Year:
                            return new Intl.DateTimeFormat(language, { year: 'numeric' }).format(date);
                        case TickMarkType.Month:
                            return new Intl.DateTimeFormat(language, { month: 'short' }).format(date);
                        case TickMarkType.DayOfMonth:
                            return new Intl.DateTimeFormat(language, { day: 'numeric' }).format(date);
                        case TickMarkType.Time:
                            return new Intl.DateTimeFormat(language, timeOptions).format(date);
                        case TickMarkType.TimeWithSeconds:
                             return new Intl.DateTimeFormat(language, { ...timeOptions, second: '2-digit' }).format(date);
                    }
                    return '';
                },
            },
        });
        
        const candlestickSeries = (chart as any).addCandlestickSeries();
        
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
                <div className="flex items-center gap-4">
                    <div className="w-64">
                         <SearchableDropdown
                            options={allPairs}
                            value={pair}
                            onChange={onPairChange}
                            theme={theme}
                        />
                    </div>
                    <div className="flex flex-col">
                        <div className={`text-xl font-bold transition-colors duration-300 ${priceChange === 'up' ? 'text-emerald-500' : priceChange === 'down' ? 'text-rose-500' : 'dark:text-white'}`}>
                            {livePrice > 0 ? livePrice.toFixed(pricePrecision) : '...'}
                        </div>
                        {fundingInfo && <FundingRateTimer fundingInfo={fundingInfo} />}
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