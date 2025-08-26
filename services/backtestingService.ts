
import { Kline, BotConfig, BacktestResult, OptimizationResultItem } from '../types';

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
    console.error('Error in backtesting worker:', error);
    requestResolvers.forEach(resolver => resolver.reject(new Error('Worker encountered an unrecoverable error.')));
    requestResolvers.clear();
};

export function runBacktest(
    klines: Kline[],
    config: BotConfig,
    htfKlines?: Kline[]
): Promise<BacktestResult> {
    return new Promise((resolve, reject) => {
        const id = requestIdCounter++;
        requestResolvers.set(id, { resolve, reject });
        worker.postMessage({
            type: 'runBacktest',
            id,
            payload: { klines, config, htfKlines },
        });
    });
}

export function runOptimization(
    klines: Kline[],
    baseConfig: BotConfig,
    onProgress: (progress: { percent: number; combinations: number }) => void,
    htfKlines?: Kline[]
): Promise<OptimizationResultItem[]> {
    return new Promise((resolve, reject) => {
        const id = requestIdCounter++;
        requestResolvers.set(id, { resolve, reject, onProgress });
        worker.postMessage({
            type: 'runOptimization',
            id,
            payload: { klines, config: baseConfig, htfKlines },
        });
    });
}