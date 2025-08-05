
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Kline, LiveTicker } from '../types';
import { ChartIcon } from './icons';
import * as constants from '../constants';
import { calculateSupportResistance, SupportResistance } from '../services/chartAnalysisService';
import { SearchableDropdown } from './SearchableDropdown';

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

const ChartCandle: React.FC<{ kline: Kline, x: number, y_scale: (val: number) => number, barWidth: number, theme: 'light' | 'dark' }> = ({ kline, x, y_scale, barWidth, theme }) => {
    const isUp = kline.close >= kline.open;
    const upColor = theme === 'dark' ? '#22c55e' : '#16a34a'; // emerald-500, green-600
    const downColor = theme === 'dark' ? '#f43f5e' : '#ef4444'; // rose-500, red-500
    const candleColor = isUp ? upColor : downColor;

    const body_y = y_scale(Math.max(kline.open, kline.close));
    const body_height = Math.abs(y_scale(kline.open) - y_scale(kline.close)) || 1;
    
    return (
        <g>
            <line x1={x + barWidth / 2} y1={y_scale(kline.high)} x2={x + barWidth / 2} y2={y_scale(kline.low)} stroke={candleColor} strokeWidth="1" />
            <rect x={x} y={body_y} width={barWidth} height={body_height} fill={candleColor} />
        </g>
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

const formatTimestamp = (timestamp: number, timeframe: string): string => {
    const date = new Date(timestamp);
    if (['1m', '5m', '15m'].includes(timeframe)) {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    if (['1h', '4h'].includes(timeframe)) {
         return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

interface CrosshairData {
    x: number;
    y: number;
    time: number;
    price: number;
}

export const ChartComponent: React.FC<ChartComponentProps> = ({ data, pair, isLoading, pricePrecision, livePrice, liveTicker, chartTimeFrame, onTimeFrameChange, allPairs, onPairChange, onLoadMoreData, isFetchingMoreData, theme }) => {
    const [priceChange, setPriceChange] = useState<'up' | 'down' | 'none'>('none');
    const prevPriceRef = useRef(livePrice);
    const [crosshair, setCrosshair] = useState<CrosshairData | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const [srLevels, setSrLevels] = useState<SupportResistance>({ supports: [], resistances: [] });

    // --- Chart Interaction State ---
    const [view, setView] = useState({ startIndex: 0, visibleCandles: 120 });
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({ x: 0, startIndex: 0 });
    const prevDataLengthRef = useRef(data.length);
    const isFullReloadRef = useRef(true); // Ref to track if a full data reload is needed

    // --- Effects for managing chart state ---

    // Effect for live price ticker color
    useEffect(() => {
        if (livePrice > prevPriceRef.current) setPriceChange('up');
        else if (livePrice < prevPriceRef.current) setPriceChange('down');
        prevPriceRef.current = livePrice;
        const timeout = setTimeout(() => setPriceChange('none'), 500);
        return () => clearTimeout(timeout);
    }, [livePrice]);
    
    // Effect to calculate Support/Resistance levels based on visible data
    const visibleData = useMemo(() => {
        return data.slice(
            Math.max(0, Math.floor(view.startIndex)), 
            Math.min(data.length, Math.floor(view.startIndex + view.visibleCandles))
        );
    }, [data, view.startIndex, view.visibleCandles]);

    useEffect(() => {
        if (visibleData.length > 50) {
            const levels = calculateSupportResistance(visibleData);
            setSrLevels(levels);
        } else {
            setSrLevels({ supports: [], resistances: [] });
        }
    }, [visibleData]);

    // Flag for a full reload when pair or timeframe changes
    useEffect(() => {
        isFullReloadRef.current = true;
    }, [pair, chartTimeFrame]);

    // This is the main effect to handle view changes based on data updates.
    useEffect(() => {
        if (isFullReloadRef.current && data.length > 0) {
            const initialVisibleCandles = 120;
            setView({
                startIndex: Math.max(0, data.length - initialVisibleCandles),
                visibleCandles: initialVisibleCandles,
            });
            isFullReloadRef.current = false;
        } 
        else if (data.length > prevDataLengthRef.current) {
            const newCandlesCount = data.length - prevDataLengthRef.current;
            const isHistoricalLoad = newCandlesCount > 2;
            
            if (isHistoricalLoad) {
                setView(prev => ({
                    ...prev,
                    startIndex: prev.startIndex + newCandlesCount,
                }));
            } 
            else {
                const isViewingEnd = view.startIndex + view.visibleCandles >= prevDataLengthRef.current - 2;
                if (isViewingEnd) {
                    setView(prev => ({
                        ...prev,
                        startIndex: prev.startIndex + newCandlesCount,
                    }));
                }
            }
        }
        
        prevDataLengthRef.current = data.length;
    }, [data]);


    const livePriceColor = priceChange === 'up' ? 'text-emerald-500' : priceChange === 'down' ? 'text-rose-500' : 'text-slate-800 dark:text-slate-200';

    const PADDING = { top: 20, right: 60, bottom: 40, left: 10 };
    const SVG_WIDTH = 800;
    const SVG_HEIGHT = 400;

    const chartWidth = SVG_WIDTH - PADDING.left - PADDING.right;
    const chartHeight = SVG_HEIGHT - PADDING.top - PADDING.bottom;
    
    const visiblePrices = visibleData.flatMap(d => [d.low, d.high]);
    if (livePrice > 0) {
        visiblePrices.push(livePrice);
    }
    
    const minPrice = visiblePrices.length > 0 ? Math.min(...visiblePrices) : 0;
    const maxPrice = visiblePrices.length > 0 ? Math.max(...visiblePrices) : 1;
    const priceRange = maxPrice - minPrice;
    
    const y_scale = (price: number) => PADDING.top + chartHeight - ((price - minPrice) / priceRange) * chartHeight;
    const y_invert = (y: number) => minPrice + ((PADDING.top + chartHeight - y) / chartHeight) * priceRange;

    const handleWheel = useCallback((event: WheelEvent) => {
        event.preventDefault();
        if (!svgRef.current) return;

        const zoomIntensity = 0.1;
        const zoomFactor = event.deltaY > 0 ? 1 - zoomIntensity : 1 + zoomIntensity;
        const newVisibleCandles = view.visibleCandles * zoomFactor;
        const clampedVisibleCandles = Math.max(20, Math.min(data.length, newVisibleCandles));

        const rect = svgRef.current.getBoundingClientRect();
        const mouseX = event.clientX - rect.left - PADDING.left;
        const ratio = Math.max(0, Math.min(1, mouseX / chartWidth));

        const cursorIndexInData = view.startIndex + (view.visibleCandles * ratio);
        const newStartIndex = cursorIndexInData - (clampedVisibleCandles * ratio);
        
        setView({
            startIndex: Math.max(0, newStartIndex),
            visibleCandles: clampedVisibleCandles,
        });
    }, [view, data.length, setView, chartWidth, PADDING.left]);

    const handleMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
        setIsPanning(true);
        setPanStart({ x: event.clientX, startIndex: view.startIndex });
        if(svgRef.current) svgRef.current.style.cursor = 'grabbing';
    };

    const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
        if (!svgRef.current || visibleData.length === 0) return;
        
        const rect = svgRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        if (isPanning) {
            const chartDomWidth = svgRef.current.clientWidth;
            const candlesPerPixel = view.visibleCandles / chartDomWidth;
            
            const deltaX = event.clientX - panStart.x;
            const candleDelta = deltaX * candlesPerPixel;
            
            const newStartIndex = panStart.startIndex - candleDelta;
            const clampedStartIndex = Math.max(0, Math.min(newStartIndex, data.length - view.visibleCandles));

            setView(prev => ({ ...prev, startIndex: clampedStartIndex }));

            if (clampedStartIndex < 10 && !isFetchingMoreData) {
                onLoadMoreData();
            }
        }

        if (x > PADDING.left && x < SVG_WIDTH - PADDING.right && y > PADDING.top && y < PADDING.top + chartHeight) {
            const index = Math.floor(((x - PADDING.left) / chartWidth) * visibleData.length);
            const kline = visibleData[index];
            if(kline) {
                setCrosshair({
                    x: x,
                    y: y,
                    time: kline.time,
                    price: y_invert(y),
                });
            }
        } else {
            setCrosshair(null);
        }
    };

    const handleMouseUpOrLeave = () => {
        setIsPanning(false);
        if(svgRef.current) svgRef.current.style.cursor = 'crosshair';
    };

    useEffect(() => {
        const element = svgRef.current;
        if (element) {
            element.addEventListener('wheel', handleWheel, { passive: false });
            return () => {
                element.removeEventListener('wheel', handleWheel);
            };
        }
    }, [handleWheel]);

    const renderChartContent = () => {
        const isDark = theme === 'dark';
        if (isLoading) {
            return <div style={{height: '400px'}} className="flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500"></div></div>;
        }
        if (!visibleData || visibleData.length === 0) {
            return <div style={{height: '400px'}} className="flex items-center justify-center text-rose-500">Could not load chart data.</div>;
        }

        const barWidth = Math.max(1, chartWidth / view.visibleCandles * 0.7);
        const priceLevels = Array.from({ length: 5 }, (_, i) => minPrice + (priceRange / 4) * i);
        const timeLabelsCount = Math.min(10, Math.floor(chartWidth / 80));
        const timeLabelStep = Math.max(1, Math.floor(visibleData.length / timeLabelsCount));
        
        return (
            <div className="w-full overflow-hidden relative">
                {isFetchingMoreData && (
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-sky-500"></div>
                    </div>
                )}
                <svg 
                    ref={svgRef} 
                    width="100%" 
                    height={SVG_HEIGHT} 
                    viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} 
                    preserveAspectRatio="xMidYMid meet" 
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUpOrLeave}
                    onMouseLeave={() => setCrosshair(null)}
                    style={{ cursor: isPanning ? 'grabbing' : 'crosshair', userSelect: 'none', background: isDark ? '#1e293b' : '#f8fafc' }}
                >
                    {priceLevels.map(price => (
                        <g key={`price-grid-${price}`}>
                            <line x1={PADDING.left} y1={y_scale(price)} x2={SVG_WIDTH - PADDING.right} y2={y_scale(price)} className="stroke-slate-200 dark:stroke-slate-700" strokeDasharray="3,3" strokeWidth="0.5" />
                            <text x={SVG_WIDTH - PADDING.right + 5} y={y_scale(price)} className="fill-slate-500 dark:fill-slate-400 text-xs" dominantBaseline="middle">{price.toFixed(pricePrecision)}</text>
                        </g>
                    ))}
                    
                    {srLevels.supports.map(level => (
                        <g key={`support-${level}`}>
                            <line x1={PADDING.left} y1={y_scale(level)} x2={SVG_WIDTH - PADDING.right} y2={y_scale(level)} className="stroke-emerald-500" strokeDasharray="5,5" strokeWidth="1" />
                            <text x={SVG_WIDTH - PADDING.right + 5} y={y_scale(level)} className="fill-emerald-500 text-xs" dominantBaseline="middle">{level.toFixed(pricePrecision)}</text>
                        </g>
                    ))}
                    {srLevels.resistances.map(level => (
                        <g key={`resistance-${level}`}>
                            <line x1={PADDING.left} y1={y_scale(level)} x2={SVG_WIDTH - PADDING.right} y2={y_scale(level)} className="stroke-rose-500" strokeDasharray="5,5" strokeWidth="1" />
                            <text x={SVG_WIDTH - PADDING.right + 5} y={y_scale(level)} className="fill-rose-500 text-xs" dominantBaseline="middle">{level.toFixed(pricePrecision)}</text>
                        </g>
                    ))}

                    {visibleData.map((kline, i) => {
                         const x = PADDING.left + (chartWidth / visibleData.length) * (i + 0.5) - barWidth/2;
                         const showTimeLabel = i % timeLabelStep === 0;
                         return (
                            <React.Fragment key={kline.time}>
                                <ChartCandle kline={kline} x={x} y_scale={y_scale} barWidth={barWidth} theme={theme}/>
                                {showTimeLabel && (
                                    <text x={x + barWidth / 2} y={SVG_HEIGHT - PADDING.bottom + 15} className="fill-slate-500 dark:fill-slate-400 text-xs" textAnchor="middle">{formatTimestamp(kline.time, chartTimeFrame)}</text>
                                )}
                            </React.Fragment>
                         );
                    })}

                    {crosshair && (
                        <g className="pointer-events-none">
                            <line x1={crosshair.x} y1={PADDING.top} x2={crosshair.x} y2={PADDING.top + chartHeight} className="stroke-slate-500 dark:stroke-slate-400" strokeDasharray="4,2" strokeWidth="1" />
                            <line x1={PADDING.left} y1={crosshair.y} x2={SVG_WIDTH - PADDING.right} y2={crosshair.y} className="stroke-slate-500 dark:stroke-slate-400" strokeDasharray="4,2" strokeWidth="1" />
                            <rect x={SVG_WIDTH - PADDING.right} y={crosshair.y - 10} width={PADDING.right} height="20" className="fill-slate-800 dark:fill-slate-700" />
                            <text x={SVG_WIDTH - PADDING.right + 5} y={crosshair.y} className="fill-white text-xs" dominantBaseline="middle">{crosshair.price.toFixed(pricePrecision)}</text>
                            <rect x={crosshair.x - 30} y={SVG_HEIGHT - PADDING.bottom} width={60} height="20" className="fill-slate-800 dark:fill-slate-700" />
                            <text x={crosshair.x} y={SVG_HEIGHT - PADDING.bottom + 10} className="fill-white text-xs" textAnchor="middle" dominantBaseline="middle">{formatTimestamp(crosshair.time, chartTimeFrame)}</text>
                        </g>
                    )}
                </svg>
            </div>
        );
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
                {renderChartContent()}
            </div>
        </div>
    );
};
