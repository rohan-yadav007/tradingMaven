
// services/workerService.ts

import { Kline, BotConfig, BacktestResult, OptimizationResultItem, TradeSignal, Agent, OrderBookAnalysis, OpenInterestKline, LongShortRatio } from '../types';
import { UniversalSignalModel } from './trainingService';

// Use a dynamic import for the worker to support module syntax
const worker = new Worker(new URL('./backtesting.worker.ts', import.meta.url), {
    type: 'module',
});

const requestResolvers = new Map<number, { resolve: Function, reject: Function, onProgress?: Function }>();
let requestIdCounter = 0;

worker.onmessage = (event: MessageEvent) => {
    const { type, payload, error, id, progress } = event.data;

    if (type === 'progress') {
        const resolver = requestResolvers.get(id);
        if (resolver?.onProgress) {
            resolver.onProgress(progress);
        }
        return;
    }

    const resolver = requestResolvers.get(id);
    if (!resolver) return;

    if (type === 'result') {
        resolver.resolve(payload);
    } else if (type === 'error') {
        resolver.reject(new Error(error));
    }
    
    requestResolvers.delete(id);
};

worker.onerror = (error) => {
    console.error('Error in worker service:', error);
    requestResolvers.forEach(resolver => resolver.reject(new Error('Worker encountered an unrecoverable error.')));
    requestResolvers.clear();
};

export function runBacktest(
    klines: Kline[],
    config: BotConfig,
    htfKlines?: Kline[],
    astraXKlinesMap?: Map<string, Kline[]>,
    openInterestHistory?: OpenInterestKline[],
    lsRatioHistory?: LongShortRatio[],
    universalModel?: UniversalSignalModel | null,
    onProgress?: (progress: { percent: number }) => void
): Promise<BacktestResult> {
    return new Promise((resolve, reject) => {
        const id = requestIdCounter++;
        requestResolvers.set(id, { resolve, reject, onProgress });
        worker.postMessage({
            type: 'runBacktest',
            id,
            payload: { klines, config, htfKlines, astraXKlinesMap, openInterestHistory, lsRatioHistory, universalModel },
        });
    });
}

export function runLiveAnalysis(
    agent: Agent,
    klines: Kline[],
    config: BotConfig,
    htfKlines?: Kline[],
    immediateKlines?: Kline[],
    ltfKlines?: Kline[],
    ethBtcKlines?: Kline[],
    livePrice?: number,
    astraXKlinesMap?: Map<string, Kline[]>,
    btcKlines?: Kline[],
    orderBookAnalysis?: OrderBookAnalysis,
    openInterestHistory?: OpenInterestKline[],
    lsRatioHistory?: LongShortRatio[],
    universalModel?: object | null,
    fundingRate?: number | null
): Promise<TradeSignal> {
     return new Promise((resolve, reject) => {
        const id = requestIdCounter++;
        requestResolvers.set(id, { resolve, reject });
        worker.postMessage({
            type: 'runLiveAnalysis',
            id,
            payload: {
                agent, klines, config, htfKlines, immediateKlines, ltfKlines,
                ethBtcKlines, livePrice, astraXKlinesMap, btcKlines,
                orderBookAnalysis, openInterestHistory, lsRatioHistory, universalModel, fundingRate
            },
        });
    });
}


export function runOptimization(
    klines: Kline[],
    baseConfig: BotConfig,
    onProgress: (progress: { percent: number; combinations: number }) => void,
    htfKlines?: Kline[],
    astraXKlinesMap?: Map<string, Kline[]> 
): Promise<OptimizationResultItem[]> {
    return new Promise((resolve, reject) => {
        const id = requestIdCounter++;
        requestResolvers.set(id, { resolve, reject, onProgress });
        worker.postMessage({
            type: 'runOptimization',
            id,
            payload: { klines, config: baseConfig, htfKlines, astraXKlinesMap },
        });
    });
}
