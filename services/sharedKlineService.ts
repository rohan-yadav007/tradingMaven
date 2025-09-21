// services/sharedKlineService.ts

import { Kline, TradingMode } from '../types';
import * as binanceService from './binanceService';
import { WebSocketManager } from './webSocketManager';

class SharedKlineService {
    private klineCache = new Map<string, Kline[]>();
    private referenceCounts = new Map<string, number>();
    private spotWsManager: WebSocketManager;
    private futuresWsManager: WebSocketManager;
    private fetchingPromises = new Map<string, Promise<Kline[]>>();

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
        });
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
                // Note: We don't unsubscribe from WebSockets here as it's complex to manage
                // shared subscriptions without a more advanced WebSocket manager.
                // The primary goal is stopping redundant HTTP calls, which this achieves.
            }
        }
    }
}

export const sharedKlineService = new SharedKlineService();