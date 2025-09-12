// services/liquidationAnalysisService.ts

import { TradingMode } from '../types';

interface LiquidationEvent {
    symbol: string;
    side: 'BUY' | 'SELL'; // BUY = long liquidation, SELL = short liquidation
    quantity: number;
    price: number;
}

interface LiquidationBucket {
    timestamp: number;
    longVolume: number;
    shortVolume: number;
}

interface LiquidationState {
    // Stores 1-second buckets for the last 5 seconds to check for recent spikes
    recentBuckets: LiquidationBucket[];
    // Stores 5-second aggregated volumes for the last 5 minutes to calculate baseline
    longTermHistory: { longVolume: number; shortVolume: number; timestamp: number; }[];
    movingAverages: { long: number; short: number; };
    stdDevs: { long: number; short: number; };
    // Buffer for incoming raw events before aggregation
    eventBuffer: LiquidationEvent[];
}

// --- Configuration ---
const RECENT_WINDOW_SECONDS = 5; // Check for spikes in the last 5 seconds
const HISTORY_WINDOW_SECONDS = 300; // Calculate MA/StdDev over the last 5 minutes
const HISTORY_BUCKET_SIZE_SECONDS = 5;
const HISTORY_MAX_LENGTH = HISTORY_WINDOW_SECONDS / HISTORY_BUCKET_SIZE_SECONDS;
const SPIKE_STD_DEV_THRESHOLD = 3.0; // A spike is > 3 standard deviations above the average

class LiquidationAnalysisService {
    private ws: WebSocket | null = null;
    private symbolStates = new Map<string, LiquidationState>();
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private processingInterval: ReturnType<typeof setInterval> | null = null;

    constructor() {
        this.connect();
        this.startProcessingInterval();
    }

    private connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }
        
        const url = `/proxy-futures-ws/stream?streams=!forceOrder@arr`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => console.log('Liquidation Analysis WebSocket connected.');
        this.ws.onmessage = (event) => this.handleMessage(event);
        this.ws.onerror = (error) => console.error('Liquidation Analysis WebSocket error:', error);
        this.ws.onclose = () => {
            console.log('Liquidation Analysis WebSocket disconnected. Reconnecting in 5s...');
            if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = setTimeout(() => this.connect(), 5000);
        };
    }

    private handleMessage(event: MessageEvent) {
        try {
            const message = JSON.parse(event.data).data;
            if (message && message.e === 'forceOrder') {
                const liqEvent: LiquidationEvent = {
                    symbol: message.o.s,
                    side: message.o.S,
                    quantity: parseFloat(message.o.q),
                    price: parseFloat(message.o.p),
                };
                
                if (!this.symbolStates.has(liqEvent.symbol)) {
                    this.symbolStates.set(liqEvent.symbol, this.createInitialState());
                }
                this.symbolStates.get(liqEvent.symbol)!.eventBuffer.push(liqEvent);
            }
        } catch (e) {
            console.error('Liquidation Service: Error parsing WS message', e);
        }
    }

    private createInitialState(): LiquidationState {
        return {
            recentBuckets: [],
            longTermHistory: [],
            movingAverages: { long: 0, short: 0 },
            stdDevs: { long: 1, short: 1 }, // Start with 1 to avoid division by zero
            eventBuffer: [],
        };
    }

    private startProcessingInterval() {
        if (this.processingInterval) clearInterval(this.processingInterval);
        
        // Process buffers every second
        this.processingInterval = setInterval(() => {
            const now = Date.now();
            for (const [symbol, state] of this.symbolStates.entries()) {
                let currentSecondLongVolume = 0;
                let currentSecondShortVolume = 0;

                // Process all events in the buffer for the current symbol
                const buffer = state.eventBuffer.splice(0); // Clear buffer
                for (const event of buffer) {
                    if (event.side === 'BUY') { // Long liquidation
                        currentSecondLongVolume += event.quantity * event.price;
                    } else { // SELL = Short liquidation
                        currentSecondShortVolume += event.quantity * event.price;
                    }
                }
                
                // Add the new 1-second bucket
                state.recentBuckets.push({
                    timestamp: now,
                    longVolume: currentSecondLongVolume,
                    shortVolume: currentSecondShortVolume
                });
                
                // Keep the recent window clean
                while (state.recentBuckets.length > 0 && now - state.recentBuckets[0].timestamp > RECENT_WINDOW_SECONDS * 1000) {
                    state.recentBuckets.shift();
                }

                // Aggregate and update long-term history every 5 seconds
                const lastHistoryEntry = state.longTermHistory.length > 0 ? state.longTermHistory[state.longTermHistory.length - 1] : null;
                const shouldUpdateHistory = state.recentBuckets.length > 0 && 
                    (!lastHistoryEntry || now - lastHistoryEntry.timestamp >= HISTORY_BUCKET_SIZE_SECONDS * 1000);
                
                if (shouldUpdateHistory) {
                    this.updateLongTermStats(state, now);
                }
            }
        }, 1000);
    }

    private updateLongTermStats(state: LiquidationState, timestamp: number) {
        // Aggregate the last 5 seconds of data from recentBuckets
        const fiveSecondData = {
            longVolume: state.recentBuckets.slice(-HISTORY_BUCKET_SIZE_SECONDS).reduce((sum, b) => sum + b.longVolume, 0),
            shortVolume: state.recentBuckets.slice(-HISTORY_BUCKET_SIZE_SECONDS).reduce((sum, b) => sum + b.shortVolume, 0),
        };

        state.longTermHistory.push({ ...fiveSecondData, timestamp });
        if (state.longTermHistory.length > HISTORY_MAX_LENGTH) {
            state.longTermHistory.shift();
        }

        if (state.longTermHistory.length > 1) {
            const longVolumes = state.longTermHistory.map(h => h.longVolume);
            const shortVolumes = state.longTermHistory.map(h => h.shortVolume);
            
            const calculateStats = (values: number[]) => {
                const sum = values.reduce((a, b) => a + b, 0);
                const avg = sum / values.length || 0;
                const stdDev = Math.sqrt(values.map(x => Math.pow(x - avg, 2)).reduce((a, b) => a + b, 0) / values.length) || 1;
                return { avg, stdDev };
            };

            const longStats = calculateStats(longVolumes);
            const shortStats = calculateStats(shortVolumes);

            state.movingAverages = { long: longStats.avg, short: shortStats.avg };
            state.stdDevs = { long: longStats.stdDev, short: shortStats.stdDev };
        }
    }

    public getLiquidationVeto(signalDirection: 'BUY' | 'SELL', pair: string): { veto: boolean; reason: string } {
        const symbol = pair.replace('/', '');
        let state = this.symbolStates.get(symbol);

        // FIX: Proactively create state if it doesn't exist for the requested symbol.
        if (!state) {
            state = this.createInitialState();
            this.symbolStates.set(symbol, state);
        }

        if (state.longTermHistory.length < 10) {
            return { veto: false, reason: 'ℹ️ Liquidation Data: Initializing...' };
        }
        
        // If there's no recent activity, don't veto.
        if (state.recentBuckets.length === 0) {
            return { veto: false, reason: '✅ Liquidation Filter: Passed' };
        }

        const isLongSignal = signalDirection === 'BUY';

        // Check the most recent 1-second bucket for a spike
        const lastBucket = state.recentBuckets[state.recentBuckets.length - 1];

        if (isLongSignal) {
            // Veto a BUY signal if there's a recent spike in LONG liquidations
            const threshold = state.movingAverages.long + (state.stdDevs.long * SPIKE_STD_DEV_THRESHOLD);
            if (lastBucket.longVolume > threshold) {
                return {
                    veto: true,
                    reason: `❌ VETO: Trading against a LONG liquidation cascade.`
                };
            }
        } else { // SELL Signal
            // Veto a SELL signal if there's a recent spike in SHORT liquidations
            const threshold = state.movingAverages.short + (state.stdDevs.short * SPIKE_STD_DEV_THRESHOLD);
            if (lastBucket.shortVolume > threshold) {
                return {
                    veto: true,
                    reason: `❌ VETO: Trading against a SHORT liquidation squeeze.`
                };
            }
        }
        
        return { veto: false, reason: `✅ Liquidation Filter: Passed` };
    }
}

export const liquidationAnalysisService = new LiquidationAnalysisService();