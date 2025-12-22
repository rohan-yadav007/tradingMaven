
// services/orderBookService.ts

import { OrderBookAnalysis, TradingMode } from '../types';
import { WebSocketManager } from './webSocketManager';

interface RawOrderBookEntry {
    0: string; // Price
    1: string; // Quantity
}

// Union type to handle both Spot and Futures payload formats
interface AnyDepthPayload {
    // Spot Format
    lastUpdateId?: number;
    bids?: RawOrderBookEntry[];
    asks?: RawOrderBookEntry[];
    
    // Futures Format
    e?: string;
    b?: RawOrderBookEntry[];
    a?: RawOrderBookEntry[];
}

const SIGNIFICANT_WALL_THRESHOLD = 3.0; // Wall must be 3x larger than average depth
const WALL_PERSISTENCE_MS = 2000; // Wall must persist for 2 seconds to be considered real

interface WallState {
    price: number;
    firstSeen: number;
}

class OrderBookService {
    private spotWsManager: WebSocketManager;
    private futuresWsManager: WebSocketManager;
    
    // Key: "MODE:SYMBOL" -> Data
    private orderBooks = new Map<string, { bids: [number, number][], asks: [number, number][], lastUpdate: number }>();
    
    // Key: "MODE:SYMBOL" -> Wall State
    private wallTracker = new Map<string, { bid: WallState | null, ask: WallState | null }>();
    
    // Key: "MODE:SYMBOL" -> Callback function reference (for unsubscribing)
    private streamCallbacks = new Map<string, (data: any) => void>();
    
    // Key: "MODE:SYMBOL" -> Reference count
    private subscriptionCounts = new Map<string, number>();

    constructor() {
        this.spotWsManager = new WebSocketManager(() => '/proxy-spot-ws');
        this.futuresWsManager = new WebSocketManager(() => '/proxy-futures-ws');
    }

    private getCacheKey(pair: string, mode: TradingMode): string {
        return `${mode}:${pair.replace('/', '').toLowerCase()}`;
    }

    public subscribe(pair: string, mode: TradingMode) {
        const key = this.getCacheKey(pair, mode);
        let count = this.subscriptionCounts.get(key) || 0;
        
        this.subscriptionCounts.set(key, count + 1);

        if (count === 0) {
            const symbol = pair.replace('/', '').toLowerCase();
            // Using depth20@100ms for high-frequency updates. 
            const streamName = `${symbol}@depth20@100ms`; 
            const manager = mode === TradingMode.USDSM_Futures ? this.futuresWsManager : this.spotWsManager;

            const callback = (data: AnyDepthPayload) => {
                let rawBids: RawOrderBookEntry[] | undefined;
                let rawAsks: RawOrderBookEntry[] | undefined;

                // Handle Futures Format (b, a)
                if (data.b && data.a) {
                    rawBids = data.b;
                    rawAsks = data.a;
                } 
                // Handle Spot Format (bids, asks)
                else if (data.bids && data.asks) {
                    rawBids = data.bids;
                    rawAsks = data.asks;
                }

                if (!rawBids || !rawAsks || !Array.isArray(rawBids) || !Array.isArray(rawAsks)) {
                    return;
                }

                // Map raw string arrays to number tuples for performance
                const bids: [number, number][] = rawBids.map(b => [parseFloat(b[0]), parseFloat(b[1])]);
                const asks: [number, number][] = rawAsks.map(a => [parseFloat(a[0]), parseFloat(a[1])]);
                
                this.orderBooks.set(key, {
                    bids,
                    asks,
                    lastUpdate: Date.now()
                });
                
                // Update persistent wall tracker immediately on data arrival
                this.updateWallTracker(key, bids, asks);
            };

            this.streamCallbacks.set(key, callback);
            manager.subscribe(streamName, callback);
            console.log(`[OrderBookService] Subscribed to ${streamName} (${mode})`);
        }
    }

    public unsubscribe(pair: string, mode: TradingMode) {
        const key = this.getCacheKey(pair, mode);
        let count = this.subscriptionCounts.get(key) || 0;

        if (count > 0) {
            count--;
            this.subscriptionCounts.set(key, count);

            if (count === 0) {
                const symbol = pair.replace('/', '').toLowerCase();
                const streamName = `${symbol}@depth20@100ms`;
                const manager = mode === TradingMode.USDSM_Futures ? this.futuresWsManager : this.spotWsManager;
                
                const callback = this.streamCallbacks.get(key);
                if (callback) {
                    manager.unsubscribe(streamName, callback);
                    this.streamCallbacks.delete(key);
                }
                
                this.orderBooks.delete(key);
                this.wallTracker.delete(key);
                console.log(`[OrderBookService] Unsubscribed from ${streamName} (${mode})`);
            }
        }
    }
    
    private detectWalls(bids: [number, number][], asks: [number, number][]): { bidWall: number | null, askWall: number | null } {
        const avgBidVol = bids.reduce((sum, b) => sum + b[1], 0) / bids.length;
        const avgAskVol = asks.reduce((sum, a) => sum + a[1], 0) / asks.length;
        
        let bidWall: number | null = null;
        let askWall: number | null = null;

        // Find nearest significant wall
        for (const [price, qty] of bids) {
            if (qty > avgBidVol * SIGNIFICANT_WALL_THRESHOLD) {
                bidWall = price;
                break;
            }
        }

        for (const [price, qty] of asks) {
            if (qty > avgAskVol * SIGNIFICANT_WALL_THRESHOLD) {
                askWall = price;
                break;
            }
        }
        return { bidWall, askWall };
    }

    private updateWallTracker(key: string, bids: [number, number][], asks: [number, number][]) {
        const now = Date.now();
        const { bidWall, askWall } = this.detectWalls(bids, asks);
        
        let tracker = this.wallTracker.get(key);
        if (!tracker) {
            tracker = { bid: null, ask: null };
            this.wallTracker.set(key, tracker);
        }

        // Update Bid Wall
        if (bidWall) {
            if (tracker.bid && Math.abs(tracker.bid.price - bidWall) / bidWall < 0.001) {
                // Same wall (within 0.1%), keep start time
                tracker.bid.price = bidWall; // Update to exact latest price
            } else {
                // New wall detected
                tracker.bid = { price: bidWall, firstSeen: now };
            }
        } else {
            tracker.bid = null; // Wall disappeared
        }

        // Update Ask Wall
        if (askWall) {
            if (tracker.ask && Math.abs(tracker.ask.price - askWall) / askWall < 0.001) {
                // Same wall, keep start time
                tracker.ask.price = askWall;
            } else {
                // New wall
                tracker.ask = { price: askWall, firstSeen: now };
            }
        } else {
            tracker.ask = null;
        }
    }

    public getAnalysis(pair: string, mode: TradingMode): OrderBookAnalysis | undefined {
        const key = this.getCacheKey(pair, mode);
        const data = this.orderBooks.get(key);
        
        if (!data) return undefined;
        
        // Data Stale Check (5 seconds - strict for high freq)
        if (Date.now() - data.lastUpdate > 5000) return undefined;

        const { bids, asks } = data;
        
        if (bids.length === 0 || asks.length === 0) return undefined;

        // 1. Calculate Imbalance (Weighted by volume)
        let bidVol = 0;
        let askVol = 0;
        const depth = Math.min(bids.length, asks.length, 10); // Analyze top 10 levels
        
        for (let i = 0; i < depth; i++) {
            bidVol += bids[i][1];
            askVol += asks[i][1];
        }
        
        const totalVol = bidVol + askVol;
        const imbalance = totalVol > 0 ? (bidVol - askVol) / totalVol : 0;
        const depthRatio = askVol > 0 ? bidVol / askVol : 1;

        // 2. Spread
        const bestBid = bids[0][0];
        const bestAsk = asks[0][0];
        const spread = (bestAsk - bestBid) / bestBid;

        // 3. Wall Retrieval (Filtered by Persistence)
        const tracker = this.wallTracker.get(key);
        const now = Date.now();
        
        let persistentBidWall: number | null = null;
        let persistentAskWall: number | null = null;

        if (tracker?.bid && (now - tracker.bid.firstSeen > WALL_PERSISTENCE_MS)) {
            persistentBidWall = tracker.bid.price;
        }
        
        if (tracker?.ask && (now - tracker.ask.firstSeen > WALL_PERSISTENCE_MS)) {
            persistentAskWall = tracker.ask.price;
        }

        return {
            imbalance,
            spread,
            bidWall: persistentBidWall,
            askWall: persistentAskWall,
            depthRatio
        };
    }
}

export const orderBookService = new OrderBookService();
