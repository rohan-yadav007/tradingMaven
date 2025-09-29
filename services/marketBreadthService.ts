// services/marketBreadthService.ts

interface TickerState {
    price: number;
    trend: 'up' | 'down' | 'neutral';
}

class MarketBreadthService {
    private ws: WebSocket | null = null;
    private marketLeaders: string[] = ['BTCUSDT', 'ETHUSDT'];
    private tickerStates = new Map<string, TickerState>();
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private isConnected = false;

    constructor() {
        this.connect();
    }

    private connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        // Always connect to futures mini ticker stream as it's more comprehensive and BTC/ETH are perps
        const url = `/proxy-futures-ws/stream?streams=!miniTicker@arr`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log('Market Breadth WebSocket connected.');
            this.isConnected = true;
        };

        this.ws.onmessage = (event) => {
            try {
                const tickers = JSON.parse(event.data).data;
                if (Array.isArray(tickers)) {
                    this.updateTickerStates(tickers);
                }
            } catch (e) {
                console.error('Market Breadth Service: Error parsing WS message', e);
            }
        };

        this.ws.onerror = (error) => {
            console.error('Market Breadth WebSocket error:', error);
        };
        
        this.ws.onclose = () => {
            console.log('Market Breadth WebSocket disconnected. Reconnecting in 5s...');
            this.isConnected = false;
            this.ws = null;
            if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = setTimeout(() => this.connect(), 5000);
        };
    }
    
    private updateTickerStates(tickers: any[]) {
        for (const ticker of tickers) {
            const symbol = ticker.s;
            if (this.marketLeaders.includes(symbol)) {
                const newPrice = parseFloat(ticker.c);
                const currentState = this.tickerStates.get(symbol);
                let trend: 'up' | 'down' | 'neutral' = 'neutral';
                
                if (currentState) {
                    if (newPrice > currentState.price) {
                        trend = 'up';
                    } else if (newPrice < currentState.price) {
                        trend = 'down';
                    }
                }
                
                this.tickerStates.set(symbol, { price: newPrice, trend });
            }
        }
    }

    public getMarketBreadthVeto(signalDirection: 'BUY' | 'SELL'): { veto: boolean; reason: string } {
        if (this.tickerStates.size < this.marketLeaders.length) {
            // Not enough data yet, don't veto
            return { veto: false, reason: 'ℹ️ Market Breadth: Data initializing.' };
        }
        
        const isLong = signalDirection === 'BUY';
        
        let supportingTrendCount = 0;
        for (const leader of this.marketLeaders) {
            const state = this.tickerStates.get(leader);
            if (state) {
                if (isLong && state.trend === 'up') {
                    supportingTrendCount++;
                } else if (!isLong && state.trend === 'down') {
                    supportingTrendCount++;
                }
            }
        }
        
        // Veto if NONE of the market leaders are moving in the signal's direction.
        if (supportingTrendCount === 0) {
            const trends = this.marketLeaders.map(l => `${l}: ${this.tickerStates.get(l)?.trend || 'N/A'}`).join(', ');
            return {
                veto: true,
                reason: `❌ VETO: Market Breadth is contradictory (${trends}).`
            };
        }
        
        return { veto: false, reason: `✅ Market Breadth: Confirmed (${supportingTrendCount}/${this.marketLeaders.length})` };
    }
}

export const marketBreadthService = new MarketBreadthService();