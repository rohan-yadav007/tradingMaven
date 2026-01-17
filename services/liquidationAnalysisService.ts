
// services/liquidationAnalysisService.ts

import { BotConfig } from '../types';
import { futuresWsManager } from './wsRegistry';

interface LiquidationEvent {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
}

interface LiquidationBucket {
    timestamp: number;
    buySideVolume: number;
    sellSideVolume: number;
}

interface LiquidationState {
    recentBuckets: LiquidationBucket[];
    longTermHistory: { buySideVolume: number; sellSideVolume: number; timestamp: number; }[];
    movingAverages: { buySide: number; sellSide: number; };
    stdDevs: { buySide: number; sellSide: number; };
    eventBuffer: LiquidationEvent[];
}

const RECENT_WINDOW_SECONDS = 5; 
const HISTORY_WINDOW_SECONDS = 300; 
const HISTORY_BUCKET_SIZE_SECONDS = 5;
const HISTORY_MAX_LENGTH = HISTORY_WINDOW_SECONDS / HISTORY_BUCKET_SIZE_SECONDS;
const SPIKE_STD_DEV_THRESHOLD = 3.0; 

class LiquidationAnalysisService {
    private symbolStates = new Map<string, LiquidationState>();
    private processingInterval: ReturnType<typeof setInterval> | null = null;

    constructor() {
        this.init();
        this.startProcessingInterval();
    }

    private init() {
        futuresWsManager.subscribe('!forceOrder@arr', (data: any) => {
            const liqEvent: LiquidationEvent = {
                symbol: data.o.s,
                side: data.o.S,
                quantity: parseFloat(data.o.q),
                price: parseFloat(data.o.p),
            };
            if (!this.symbolStates.has(liqEvent.symbol)) {
                this.symbolStates.set(liqEvent.symbol, this.createInitialState());
            }
            this.symbolStates.get(liqEvent.symbol)!.eventBuffer.push(liqEvent);
        });
    }

    private createInitialState(): LiquidationState {
        return {
            recentBuckets: [],
            longTermHistory: [],
            movingAverages: { buySide: 0, sellSide: 0 },
            stdDevs: { buySide: 1, sellSide: 1 }, 
            eventBuffer: [],
        };
    }

    private startProcessingInterval() {
        if (this.processingInterval) clearInterval(this.processingInterval);
        this.processingInterval = setInterval(() => {
            const now = Date.now();
            for (const [symbol, state] of this.symbolStates.entries()) {
                let currentSecondBuySideVol = 0, currentSecondSellSideVol = 0;
                const buffer = state.eventBuffer.splice(0); 
                for (const event of buffer) {
                    if (event.side === 'BUY') currentSecondBuySideVol += event.quantity * event.price;
                    else currentSecondSellSideVol += event.quantity * event.price;
                }
                state.recentBuckets.push({ timestamp: now, buySideVolume: currentSecondBuySideVol, sellSideVolume: currentSecondSellSideVol });
                while (state.recentBuckets.length > 0 && now - state.recentBuckets[0].timestamp > RECENT_WINDOW_SECONDS * 1000) state.recentBuckets.shift();
                const lastHistoryEntry = state.longTermHistory.length > 0 ? state.longTermHistory[state.longTermHistory.length - 1] : null;
                const shouldUpdateHistory = state.recentBuckets.length > 0 && (!lastHistoryEntry || now - lastHistoryEntry.timestamp >= HISTORY_BUCKET_SIZE_SECONDS * 1000);
                if (shouldUpdateHistory) this.updateLongTermStats(state, now);
            }
        }, 1000);
    }

    private updateLongTermStats(state: LiquidationState, timestamp: number) {
        const fiveSecondData = {
            buySideVolume: state.recentBuckets.slice(-HISTORY_BUCKET_SIZE_SECONDS).reduce((sum, b) => sum + b.buySideVolume, 0),
            sellSideVolume: state.recentBuckets.slice(-HISTORY_BUCKET_SIZE_SECONDS).reduce((sum, b) => sum + b.sellSideVolume, 0),
        };
        state.longTermHistory.push({ ...fiveSecondData, timestamp });
        if (state.longTermHistory.length > HISTORY_MAX_LENGTH) state.longTermHistory.shift();
        if (state.longTermHistory.length > 1) {
            const calculateStats = (values: number[]) => {
                const sum = values.reduce((a, b) => a + b, 0);
                const avg = sum / values.length || 0;
                const stdDev = Math.sqrt(values.map(x => Math.pow(x - avg, 2)).reduce((a, b) => a + b, 0) / values.length) || 1;
                return { avg, stdDev };
            };
            const buyStats = calculateStats(state.longTermHistory.map(h => h.buySideVolume));
            const sellStats = calculateStats(state.longTermHistory.map(h => h.sellSideVolume));
            state.movingAverages = { buySide: buyStats.avg, sellSide: sellStats.avg };
            state.stdDevs = { buySide: buyStats.stdDev, sellSide: sellStats.stdDev };
        }
    }

    public getLiquidationVeto(signalDirection: 'BUY' | 'SELL', pair: string, config: BotConfig): { veto: boolean; reason: string } {
        const symbol = pair.replace('/', '');
        let state = this.symbolStates.get(symbol);
        if (!state) { state = this.createInitialState(); this.symbolStates.set(symbol, state); }
        if (state.longTermHistory.length < 10) {
            const reason = 'Liquidation Data: Initializing...';
            return { veto: config.finalEntryFailSafe === 'fail-closed', reason: config.finalEntryFailSafe === 'fail-closed' ? `❌ VETO: ${reason} (Fail-safe)` : `⚠️ ${reason} (Fail-open)` };
        }
        if (state.recentBuckets.length === 0) return { veto: false, reason: `✅ Liquidation Filter: Passed` };
        const lastBucket = state.recentBuckets[state.recentBuckets.length - 1];
        if (signalDirection === 'BUY') {
            const threshold = state.movingAverages.sellSide + (state.stdDevs.sellSide * SPIKE_STD_DEV_THRESHOLD);
            if (lastBucket.sellSideVolume > threshold) return { veto: true, reason: `❌ VETO: Trading against a LONG liquidation cascade.` };
        } else { 
            const threshold = state.movingAverages.buySide + (state.stdDevs.buySide * SPIKE_STD_DEV_THRESHOLD);
            if (lastBucket.buySideVolume > threshold) return { veto: true, reason: `❌ VETO: Trading against a SHORT liquidation squeeze.` };
        }
        return { veto: false, reason: `✅ Liquidation Filter: Passed` };
    }

    public getLiquidityTrap(pair: string, side: 'BUY' | 'SELL'): 'Spring' | 'Upthrust' | 'None' {
        const symbol = pair.replace('/', '');
        let state = this.symbolStates.get(symbol);
        if (!state || state.recentBuckets.length === 0) return 'None';
        const lastBucket = state.recentBuckets[state.recentBuckets.length - 1];
        if (side === 'BUY') {
            const threshold = state.movingAverages.sellSide + (state.stdDevs.sellSide * SPIKE_STD_DEV_THRESHOLD);
            if (lastBucket.sellSideVolume > threshold && lastBucket.sellSideVolume > 5000) return 'Spring';
        } else {
            const threshold = state.movingAverages.buySide + (state.stdDevs.buySide * SPIKE_STD_DEV_THRESHOLD);
            if (lastBucket.buySideVolume > threshold && lastBucket.buySideVolume > 5000) return 'Upthrust';
        }
        return 'None';
    }
}

export const liquidationAnalysisService = new LiquidationAnalysisService();
