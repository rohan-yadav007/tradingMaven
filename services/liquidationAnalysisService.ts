
// services/liquidationAnalysisService.ts

import { BotConfig, TradingMode } from '../types';

interface LiquidationEvent {
    symbol: string;
    side: 'BUY' | 'SELL'; // BUY = Exchange Buying (Short Liq), SELL = Exchange Selling (Long Liq)
    quantity: number;
    price: number;
}

interface LiquidationBucket {
    timestamp: number;
    buySideVolume: number;  // Volume of BUY orders executed (Short Liquidations)
    sellSideVolume: number; // Volume of SELL orders executed (Long Liquidations)
}

interface LiquidationState {
    recentBuckets: LiquidationBucket[];
    longTermHistory: { buySideVolume: number; sellSideVolume: number; timestamp: number; }[];
    movingAverages: { buySide: number; sellSide: number; };
    stdDevs: { buySide: number; sellSide: number; };
    eventBuffer: LiquidationEvent[];
}

// --- Configuration ---
const RECENT_WINDOW_SECONDS = 5; 
const HISTORY_WINDOW_SECONDS = 300; 
const HISTORY_BUCKET_SIZE_SECONDS = 5;
const HISTORY_MAX_LENGTH = HISTORY_WINDOW_SECONDS / HISTORY_BUCKET_SIZE_SECONDS;
const SPIKE_STD_DEV_THRESHOLD = 3.0; 

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
                    side: message.o.S, // 'BUY' (Short Liq) or 'SELL' (Long Liq)
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
                let currentSecondBuySideVol = 0;  // Short Liquidations
                let currentSecondSellSideVol = 0; // Long Liquidations

                const buffer = state.eventBuffer.splice(0); 
                for (const event of buffer) {
                    if (event.side === 'BUY') {
                        currentSecondBuySideVol += event.quantity * event.price;
                    } else { 
                        currentSecondSellSideVol += event.quantity * event.price;
                    }
                }
                
                state.recentBuckets.push({
                    timestamp: now,
                    buySideVolume: currentSecondBuySideVol,
                    sellSideVolume: currentSecondSellSideVol
                });
                
                while (state.recentBuckets.length > 0 && now - state.recentBuckets[0].timestamp > RECENT_WINDOW_SECONDS * 1000) {
                    state.recentBuckets.shift();
                }

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
        const fiveSecondData = {
            buySideVolume: state.recentBuckets.slice(-HISTORY_BUCKET_SIZE_SECONDS).reduce((sum, b) => sum + b.buySideVolume, 0),
            sellSideVolume: state.recentBuckets.slice(-HISTORY_BUCKET_SIZE_SECONDS).reduce((sum, b) => sum + b.sellSideVolume, 0),
        };

        state.longTermHistory.push({ ...fiveSecondData, timestamp });
        if (state.longTermHistory.length > HISTORY_MAX_LENGTH) {
            state.longTermHistory.shift();
        }

        if (state.longTermHistory.length > 1) {
            const buySideVolumes = state.longTermHistory.map(h => h.buySideVolume);
            const sellSideVolumes = state.longTermHistory.map(h => h.sellSideVolume);
            
            const calculateStats = (values: number[]) => {
                const sum = values.reduce((a, b) => a + b, 0);
                const avg = sum / values.length || 0;
                const stdDev = Math.sqrt(values.map(x => Math.pow(x - avg, 2)).reduce((a, b) => a + b, 0) / values.length) || 1;
                return { avg, stdDev };
            };

            const buyStats = calculateStats(buySideVolumes);
            const sellStats = calculateStats(sellSideVolumes);

            state.movingAverages = { buySide: buyStats.avg, sellSide: sellStats.avg };
            state.stdDevs = { buySide: buyStats.stdDev, sellSide: sellStats.stdDev };
        }
    }

    public getLiquidationVeto(signalDirection: 'BUY' | 'SELL', pair: string, config: BotConfig): { veto: boolean; reason: string } {
        const symbol = pair.replace('/', '');
        let state = this.symbolStates.get(symbol);

        if (!state) {
            state = this.createInitialState();
            this.symbolStates.set(symbol, state);
        }

        if (state.longTermHistory.length < 10) {
            const reason = 'Liquidation Data: Initializing...';
            if (config.finalEntryFailSafe === 'fail-closed') {
                return { veto: true, reason: `❌ VETO: ${reason} (Fail-safe triggered)` };
            }
            return { veto: false, reason: `⚠️ ${reason} Trade allowed by fail-open.` };
        }
        
        if (state.recentBuckets.length === 0) {
            return { veto: false, reason: `✅ Liquidation Filter: Passed` };
        }

        const isLongSignal = signalDirection === 'BUY';
        const lastBucket = state.recentBuckets[state.recentBuckets.length - 1];

        if (isLongSignal) {
            // Veto a BUY signal if there's a recent spike in LONG liquidations (Panic Selling)
            // Long Liquidations = Sell Side Volume
            const threshold = state.movingAverages.sellSide + (state.stdDevs.sellSide * SPIKE_STD_DEV_THRESHOLD);
            if (lastBucket.sellSideVolume > threshold) {
                return {
                    veto: true,
                    reason: `❌ VETO: Trading against a LONG liquidation cascade.`
                };
            }
        } else { 
            // Veto a SELL signal if there's a recent spike in SHORT liquidations (Panic Buying / Squeeze)
            // Short Liquidations = Buy Side Volume
            const threshold = state.movingAverages.buySide + (state.stdDevs.buySide * SPIKE_STD_DEV_THRESHOLD);
            if (lastBucket.buySideVolume > threshold) {
                return {
                    veto: true,
                    reason: `❌ VETO: Trading against a SHORT liquidation squeeze.`
                };
            }
        }
        
        return { veto: false, reason: `✅ Liquidation Filter: Passed` };
    }

    public getLiquidityTrap(pair: string, side: 'BUY' | 'SELL'): 'Spring' | 'Upthrust' | 'None' {
        const symbol = pair.replace('/', '');
        let state = this.symbolStates.get(symbol);

        if (!state) {
             state = this.createInitialState();
             this.symbolStates.set(symbol, state);
             return 'None'; 
        }
        
        if (state.recentBuckets.length === 0) return 'None';

        const lastBucket = state.recentBuckets[state.recentBuckets.length - 1];

        if (side === 'BUY') {
            // Looking for a Spring (Bullish Reversal)
            // A Spring typically occurs on heavy selling (Long Liquidations / Sell Side Volume)
            const threshold = state.movingAverages.sellSide + (state.stdDevs.sellSide * SPIKE_STD_DEV_THRESHOLD);
            if (lastBucket.sellSideVolume > threshold && lastBucket.sellSideVolume > 5000) {
                return 'Spring';
            }
        } else {
            // Looking for an Upthrust (Bearish Reversal)
            // An Upthrust typically occurs on heavy buying (Short Liquidations / Buy Side Volume)
            const threshold = state.movingAverages.buySide + (state.stdDevs.buySide * SPIKE_STD_DEV_THRESHOLD);
            if (lastBucket.buySideVolume > threshold && lastBucket.buySideVolume > 5000) {
                return 'Upthrust';
            }
        }
        
        return 'None';
    }
}

export const liquidationAnalysisService = new LiquidationAnalysisService();
