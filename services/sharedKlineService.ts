// services/sharedKlineService.ts

import { Kline, TradingMode } from '../types';
import * as binanceService from './binanceService';
import { WebSocketManager } from './webSocketManager';

const getTimeframeDuration = (timeframe: string): number => {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1), 10);
    if (isNaN(value)) return 0;
    switch (unit) {
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return 0;
    }
};

class SharedKlineService {
    private klineCache = new Map<string, Kline[]>();
    private referenceCounts = new Map<string, number>();
    private spotWsManager: WebSocketManager;
    private futuresWsManager: WebSocketManager;
    private fetchingPromises = new Map<string, Promise<Kline[]>>();
    private latestClosedCandleTimes = new Map<string, number>(); // <cacheKey, timestamp>

    constructor() {
        this.spotWsManager = new WebSocketManager(() => '/proxy-spot-ws');
        this.futuresWsManager = new WebSocketManager(() => '/proxy-futures-ws');
    }

    private getCacheKey(pair: string, timeframe: string, mode: TradingMode): string {
        return `${pair.replace('/', '').toLowerCase()}-${timeframe}-${mode}`;
    }

    public async getData(pair: string, timeframe: string, mode: TradingMode): Promise<Kline[]> {
        const key = this.getCacheKey(pair, timeframe, mode);

        if (this.fetchingPromises.has(key)) {
            return this.fetchingPromises.get(key)!;
        }

        if (this.klineCache.has(key)) {
            this.referenceCounts.set(key, (this.referenceCounts.get(key) || 0) + 1);
            return this.klineCache.get(key)!;
        }

        const fetchPromise = this.fetchAndCacheData(pair, timeframe, mode, key);
        this.fetchingPromises.set(key, fetchPromise);

        try {
            const data = await fetchPromise;
            this.referenceCounts.set(key, (this.referenceCounts.get(key) || 0) + 1);
            return data;
        } finally {
            this.fetchingPromises.delete(key);
        }
    }

    private async fetchAndCacheData(pair: string, timeframe: string, mode: TradingMode, key: string): Promise<Kline[]> {
        console.log(`[SharedKlineService] Cache miss for ${key}. Fetching initial data...`);
        const klines = await binanceService.fetchKlines(pair.replace('/', ''), timeframe, { limit: 501, mode });
        this.klineCache.set(key, klines);
        
        const lastClosedKline = [...klines].reverse().find(k => k.isFinal);
        if (lastClosedKline) {
            this.latestClosedCandleTimes.set(key, lastClosedKline.time);
        }

        this.subscribeToUpdates(pair, timeframe, mode, key);
        return klines;
    }

    private subscribeToUpdates(pair: string, timeframe: string, mode: TradingMode, key: string) {
        const wsManager = mode === TradingMode.USDSM_Futures ? this.futuresWsManager : this.spotWsManager;
        const streamName = `${pair.replace('/', '').toLowerCase()}@kline_${timeframe}`;

        wsManager.subscribe(streamName, (data: any) => {
            const newKline: Kline = {
                time: data.k.t, open: parseFloat(data.k.o), high: parseFloat(data.k.h),
                low: parseFloat(data.k.l), close: parseFloat(data.k.c), volume: parseFloat(data.k.v),
                isFinal: data.k.x
            };
            const cachedKlines = this.klineCache.get(key);
            if (cachedKlines) {
                const last = cachedKlines[cachedKlines.length - 1];
                if (last && newKline.time === last.time) {
                    cachedKlines[cachedKlines.length - 1] = newKline;
                } else if (!last || newKline.time > last.time) {
                    cachedKlines.push(newKline);
                    if (cachedKlines.length > 501) {
                        cachedKlines.shift();
                    }
                }
            }
             if (newKline.isFinal) {
                this.latestClosedCandleTimes.set(key, newKline.time);
            }
        });
    }
    
    public areKlinesReadyForTimestamp(
        dependencies: { pair: string, timeframe: string, mode: TradingMode }[],
        analysisTimestamp: number
    ): boolean {
        for (const dep of dependencies) {
            const key = this.getCacheKey(dep.pair, dep.timeframe, dep.mode);
            const timeframeMs = getTimeframeDuration(dep.timeframe);
            if (timeframeMs === 0) continue;

            const expectedCandleStartTime = Math.floor(analysisTimestamp / timeframeMs) * timeframeMs;

            const latestClosedTime = this.latestClosedCandleTimes.get(key);

            if (!latestClosedTime || latestClosedTime < expectedCandleStartTime) {
                return false;
            }
        }
        return true;
    }


    public releaseData(pair: string, timeframe: string, mode: TradingMode) {
        const key = this.getCacheKey(pair, timeframe, mode);
        const currentCount = this.referenceCounts.get(key);

        if (currentCount && currentCount > 0) {
            const newCount = currentCount - 1;
            this.referenceCounts.set(key, newCount);

            if (newCount === 0) {
                console.log(`[SharedKlineService] Last reference to ${key} released. Cleaning up.`);
                this.klineCache.delete(key);
                this.latestClosedCandleTimes.delete(key);
            }
        }
    }
}

export const sharedKlineService = new SharedKlineService();