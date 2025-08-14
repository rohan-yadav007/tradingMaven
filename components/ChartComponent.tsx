import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { type Kline, type LiveTicker } from '../types';
import { ChartIcon } from './icons';
import * as constants from '../constants';
import { calculateSupportResistance, type SupportResistance } from '../services/chartAnalysisService';
import { SearchableDropdown } from './SearchableDropdown';
import { 
    createChart, 
    ColorType, 
    LineStyle, 
    type IChartApi, 
    type ISeriesApi, 
    type CandlestickData, 
    type UTCTimestamp, 
    type PriceLineOptions,
    type IPriceLine 
} from 'lightweight-charts';

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
    const priceLineRefs = useRef<IPriceLine[]>([]);
    
    const [priceChange, setPriceChange] = useState<'up' | 'down' | 'none'>('none');
    const prevPriceRef = useRef(livePrice);
    
    const [srLevels, setSrLevels] = useState<SupportResistance>({ supports: [], resistances: [] });
    
    // Use refs for callbacks and state inside the single-run effect to avoid stale closures
    const onLoadMoreDataRef = useRef(onLoadMoreData);
    onLoadMoreDataRef.current = onLoadMoreData;
    const isFetchingMoreDataRef = useRef(isFetchingMoreData);
    isFetchingMoreDataRef.current = isFetchingMoreData;
    
    // Effect for live price ticker color
    useEffect(() => {
        if (livePrice > prevPriceRef.current) setPriceChange('up');
        else if (livePrice < prevPriceRef.current) setPriceChange('down');
        prevPriceRef.current = livePrice;
        const timeout = setTimeout(() => setPriceChange('none'), 500);
        return () => clearTimeout(timeout);
    }, [livePrice]);

    // --- Chart Initialization (runs only once to prevent flickering) ---
    useLayoutEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            autoSize: true,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
            },
        });
        
        const candlestickSeries = chart.addCandlestickSeries({});
        
        chartRef.current = chart;
        candlestickSeriesRef.current = candlestickSeries;

        // Subscribe to scroll events for infinite scroll using stable refs
        chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
            if (range && range.from < 10 && !isFetchingMoreDataRef.current) {
                 onLoadMoreDataRef.current();
            }
        });
        
        return () => {
            chart.remove();
            chartRef.current = null;
        };
    }, []); // <-- Empty dependency array is CRITICAL to prevent re-creation

    // --- Chart Theme Update ---
    useEffect(() => {
        if (!chartRef.current) return;

        const isDark = theme === 'dark';
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
        candlestickSeriesRef.current?.applyOptions({
            upColor: isDark ? '#22c55e' : '#16a34a',
            downColor: isDark ? '#ef4444' : '#dc2626',
            borderVisible: false,
            wickUpColor: isDark ? '#22c55e' : '#16a34a',
            wickDownColor: isDark ? '#ef4444' : '#dc2626',
        });
    }, [theme]);
    
    // --- Data Management ---
    useEffect(() => {
        if (!candlestickSeriesRef.current || data.length === 0) return;
        
        const formattedData: CandlestickData[] = data.map(k => ({
            time: (k.time / 1000) as UTCTimestamp,
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
        }));
        
        candlestickSeriesRef.current.setData(formattedData);

    }, [data]);
    
    // Update live price
    useEffect(() => {
        if (!candlestickSeriesRef.current || !data.length || !livePrice) return;
        const lastKline = data[data.length - 1];
        
        candlestickSeriesRef.current.update({
            time: (lastKline.time / 1000) as UTCTimestamp,
            open: lastKline.open,
            high: Math.max(lastKline.high, livePrice),
            low: Math.min(lastKline.low, livePrice),
            close: livePrice,
        });
    }, [livePrice, data]);

    // Calculate and draw S/R levels
    useEffect(() => {
        if (data.length > 50) {
            const levels = calculateSupportResistance(data);
            setSrLevels(levels);
        } else {
            setSrLevels({ supports: [], resistances: [] });
        }
    }, [data]);
    
    useEffect(() => {
        const series = candlestickSeriesRef.current;
        if (!series) return;

        // Clear previous lines
        priceLineRefs.current.forEach(line => series.removePriceLine(line));
        priceLineRefs.current = [];

        const createPriceLine = (price: number, color: string, title: string) => {
            const lineOptions: PriceLineOptions = {
                price,
                color,
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title,
                lineVisible: true,
                axisLabelColor: color,
                axisLabelTextColor: theme === 'dark' ? '#000000' : '#ffffff',
            };
            priceLineRefs.current.push(series.createPriceLine(lineOptions));
        };

        srLevels.supports.slice(0, 3).forEach(level => createPriceLine(level, '#22c55e', 'Support'));
        srLevels.resistances.slice(0, 3).forEach(level => createPriceLine(level, '#ef4444', 'Resistance'));

    }, [srLevels, theme]);

    const livePriceColor = priceChange === 'up' ? 'text-emerald-500' : priceChange === 'down' ? 'text-rose-500' : 'text-slate-800 dark:text-slate-200';
    
    const renderContent = () => {
        if (isLoading) {
            return <div style={{height: '400px'}} className="flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500"></div></div>;
        }
         if (data.length === 0 && !isLoading) {
            return <div style={{height: '400px'}} className="flex items-center justify-center text-rose-500">Could not load chart data for this pair.</div>;
        }
        return (
             <div ref={chartContainerRef} className="w-full h-[400px] relative">
                 {isFetchingMoreData && (
                    <div className="absolute top-1/2 left-4 z-20 p-2 rounded-full bg-slate-100/50 dark:bg-slate-800/50">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-sky-500"></div>
                    </div>
                )}
                {data.length > 0 && <CountdownTimer lastKline={data[data.length - 1]} timeframe={chartTimeFrame} />}
            </div>
        )
    };
    
    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm">
            <div className="p-4">
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                    <div className="flex items-center gap-4">
                        <ChartIcon className="w-6 h-6 text-sky-500" />
                        <div className="w-48 z-20">
                             <SearchableDropdown
                                options={allPairs}
                                value={pair}
                                onChange={onPairChange}
                                theme={theme}
                            />
                        </div>
                        <div className={`text-2xl font-mono font-bold transition-colors duration-200 ${livePriceColor}`}>
                            {livePrice.toLocaleString('en-US', { minimumFractionDigits: pricePrecision, maximumFractionDigits: pricePrecision })}
                        </div>
                    </div>
                    <TimeFrameSelector selected={chartTimeFrame} onSelect={onTimeFrameChange} />
                </div>
                {renderContent()}
            </div>
        </div>
    );
};