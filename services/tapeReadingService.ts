
// services/tapeReadingService.ts

import { TradingMode, TapeMetrics } from '../types';
import { spotWsManager, futuresWsManager } from './wsRegistry';

interface AggTrade {
    p: number; // Price
    q: number; // Quantity
    T: number; // Trade time
    m: boolean; // Was the buyer the maker? (true = sell, false = buy)
}

const METRIC_WINDOW_MS = 5000; // 5 Seconds Window
const CLEANUP_INTERVAL_MS = 1000;

class TapeReadingService {
    private trades: Map<string, AggTrade[]> = new Map();
    private activeSubscriptions = new Map<string, number>(); // Key: symbol, Value: refCount
    
    // Rolling averages for anomaly detection
    private velocityHistory: Map<string, number[]> = new Map(); 

    constructor() {
        // Periodic cleanup
        setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    }

    private getKey(pair: string, mode: TradingMode): string {
        return `${mode}:${pair.replace('/', '').toLowerCase()}`;
    }

    public subscribe(pair: string, mode: TradingMode) {
        const key = this.getKey(pair, mode);
        const refCount = this.activeSubscriptions.get(key) || 0;
        this.activeSubscriptions.set(key, refCount + 1);

        if (refCount === 0) {
            const symbol = pair.replace('/', '').toLowerCase();
            const manager = mode === TradingMode.USDSM_Futures ? futuresWsManager : spotWsManager;
            const stream = `${symbol}@aggTrade`;

            // Initialize storage
            this.trades.set(key, []);
            this.velocityHistory.set(key, []);

            manager.subscribe(stream, (data: any) => {
                // data.p = price, data.q = quantity, data.T = time, data.m = isBuyerMaker
                const trade: AggTrade = {
                    p: parseFloat(data.p),
                    q: parseFloat(data.q),
                    T: data.T,
                    m: data.m
                };
                
                const buffer = this.trades.get(key);
                if (buffer) {
                    buffer.push(trade);
                }
            });
            console.log(`[TapeService] Listening to ${stream} for Momentum Ignition.`);
        }
    }

    public unsubscribe(pair: string, mode: TradingMode) {
        const key = this.getKey(pair, mode);
        const refCount = this.activeSubscriptions.get(key) || 0;

        if (refCount > 0) {
            const newCount = refCount - 1;
            this.activeSubscriptions.set(key, newCount);

            if (newCount === 0) {
                const symbol = pair.replace('/', '').toLowerCase();
                const manager = mode === TradingMode.USDSM_Futures ? futuresWsManager : spotWsManager;
                manager.unsubscribe(`${symbol}@aggTrade`, () => {});
                this.trades.delete(key);
                this.velocityHistory.delete(key);
                console.log(`[TapeService] Stopped listening to ${symbol}.`);
            }
        }
    }

    private cleanup() {
        const now = Date.now();
        const cutoff = now - METRIC_WINDOW_MS;

        this.trades.forEach((buffer, key) => {
            // Keep only recent trades
            // Filter in place or reassign. Reassign is cleaner.
            const freshTrades = buffer.filter(t => t.T >= cutoff);
            this.trades.set(key, freshTrades);
            
            // Periodically update baseline stats
            if (freshTrades.length > 0) {
                const vol = freshTrades.reduce((sum, t) => sum + (t.p * t.q), 0);
                const vel = vol / (METRIC_WINDOW_MS / 1000);
                const history = this.velocityHistory.get(key) || [];
                history.push(vel);
                if (history.length > 60) history.shift(); // Keep last ~1 minute of velocity samples
                this.velocityHistory.set(key, history);
            }
        });
    }

    public getMetrics(pair: string, mode: TradingMode): TapeMetrics {
        const key = this.getKey(pair, mode);
        const buffer = this.trades.get(key) || [];
        const now = Date.now();

        if (buffer.length === 0) {
            return {
                velocity: 0,
                buyPressure: 0.5,
                tradeCount: 0,
                isIgnition: false,
                timestamp: now
            };
        }

        let buyVol = 0;
        let sellVol = 0;
        let tradeCount = 0;

        for (const t of buffer) {
            const value = t.p * t.q;
            if (t.m) {
                // isBuyerMaker = true -> Sell
                sellVol += value;
            } else {
                // isBuyerMaker = false -> Buy
                buyVol += value;
            }
            tradeCount++;
        }

        const totalVol = buyVol + sellVol;
        const velocity = totalVol / (METRIC_WINDOW_MS / 1000); // USD per second
        const buyPressure = totalVol > 0 ? buyVol / totalVol : 0.5;

        // Anomaly Detection (Ignition)
        const history = this.velocityHistory.get(key) || [];
        let isIgnition = false;
        
        if (history.length > 10) {
            const avgVelocity = history.reduce((a,b) => a+b, 0) / history.length;
            // Ignition = Current velocity is > 3x average velocity
            if (velocity > avgVelocity * 3.0 && totalVol > 10000) { // Min threshold $10k to avoid noise
                isIgnition = true;
            }
        }

        return {
            velocity,
            buyPressure,
            tradeCount,
            isIgnition,
            timestamp: now
        };
    }
}

export const tapeReadingService = new TapeReadingService();
