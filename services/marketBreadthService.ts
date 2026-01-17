
// services/marketBreadthService.ts

import { futuresWsManager } from './wsRegistry';

interface TickerState {
    price: number;
    trend: 'up' | 'down' | 'neutral';
}

class MarketBreadthService {
    private marketLeaders: string[] = ['BTCUSDT', 'ETHUSDT'];
    private tickerStates = new Map<string, TickerState>();

    constructor() {
        this.init();
    }

    private init() {
        futuresWsManager.subscribe('!miniTicker@arr', (data: any[]) => {
            if (Array.isArray(data)) {
                this.updateTickerStates(data);
            }
        });
    }
    
    private updateTickerStates(tickers: any[]) {
        for (const ticker of tickers) {
            const symbol = ticker.s;
            if (this.marketLeaders.includes(symbol)) {
                const newPrice = parseFloat(ticker.c);
                const currentState = this.tickerStates.get(symbol);
                let trend: 'up' | 'down' | 'neutral' = 'neutral';
                if (currentState) {
                    if (newPrice > currentState.price) trend = 'up';
                    else if (newPrice < currentState.price) trend = 'down';
                }
                this.tickerStates.set(symbol, { price: newPrice, trend });
            }
        }
    }

    public getMarketBreadthVeto(signalDirection: 'BUY' | 'SELL'): { veto: boolean; reason: string } {
        if (this.tickerStates.size < this.marketLeaders.length) {
            return { veto: false, reason: 'ℹ️ Market Breadth: Data initializing.' };
        }
        const isLong = signalDirection === 'BUY';
        let supportingTrendCount = 0;
        for (const leader of this.marketLeaders) {
            const state = this.tickerStates.get(leader);
            if (state) {
                if (isLong && state.trend === 'up') supportingTrendCount++;
                else if (!isLong && state.trend === 'down') supportingTrendCount++;
            }
        }
        if (supportingTrendCount === 0) {
            const trends = this.marketLeaders.map(l => `${l}: ${this.tickerStates.get(l)?.trend || 'N/A'}`).join(', ');
            return { veto: true, reason: `❌ VETO: Market Breadth is contradictory (${trends}).` };
        }
        return { veto: false, reason: `✅ Market Breadth: Confirmed (${supportingTrendCount}/${this.marketLeaders.length})` };
    }
}

export const marketBreadthService = new MarketBreadthService();
