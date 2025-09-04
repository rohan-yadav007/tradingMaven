import { Kline, TradingMode } from '../types';
import * as binanceService from './binanceService';

class BtcConfirmationService {
    private klinesData = new Map<string, Kline[]>();
    private activeTimeframes = new Set<string>();
    private ws: WebSocket | null = null;
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    private connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const streamNames = this.getStreamNames();
        if (streamNames.length === 0) {
            // Don't connect if there are no streams to listen to
            return;
        }

        const url = `/proxy-futures-ws/stream?streams=${streamNames.join('/')}`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log('BTC Confirmation WebSocket connected for streams:', streamNames.join(', '));
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.stream && message.data) {
                    const timeframe = message.stream.split('_')[1];
                    this.handleKlineUpdate(timeframe, message.data);
                }
            } catch (e) {
                console.error('BTC Service: Error parsing WS message', e);
            }
        };

        this.ws.onerror = (error) => {
            console.error('BTC Confirmation WebSocket error:', error);
        };
        
        this.ws.onclose = () => {
            console.log('BTC Confirmation WebSocket disconnected. Reconnecting in 5s...');
            this.ws = null;
            if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = setTimeout(() => this.connect(), 5000);
        };
    }

    private getStreamNames(): string[] {
        return Array.from(this.activeTimeframes).map(tf => `btcusdt@kline_${tf}`);
    }
    
    private resubscribe() {
        if (this.ws) {
            this.ws.onclose = null; // Prevent the old socket from triggering reconnect
            this.ws.close();
            this.ws = null;
        }
        // Debounce the connection to handle rapid succession of new timeframe requests
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => this.connect(), 100);
    }

    private handleKlineUpdate(timeframe: string, data: any) {
        const newKline: Kline = {
            time: data.k.t, open: parseFloat(data.k.o), high: parseFloat(data.k.h),
            low: parseFloat(data.k.l), close: parseFloat(data.k.c), volume: parseFloat(data.k.v), isFinal: data.k.x,
        };
        const existingKlines = this.klinesData.get(timeframe);
        if (existingKlines) {
            const last = existingKlines[existingKlines.length - 1];
            if (last && newKline.time === last.time) {
                existingKlines[existingKlines.length - 1] = newKline;
            } else if (!last || newKline.time > last.time) {
                existingKlines.push(newKline);
                if (existingKlines.length > 501) existingKlines.shift();
            }
        }
    }

    public async getDataForTimeframe(timeframe: string): Promise<Kline[]> {
        if (this.klinesData.has(timeframe)) {
            return this.klinesData.get(timeframe)!;
        }

        try {
            const initialKlines = await binanceService.fetchKlines(
                'BTCUSDT', timeframe, { limit: 500, mode: TradingMode.USDSM_Futures }
            );
            this.klinesData.set(timeframe, initialKlines);
            
            if (!this.activeTimeframes.has(timeframe)) {
                this.activeTimeframes.add(timeframe);
                this.resubscribe(); // Reconnect with the new stream
            }
            
            return initialKlines;
        } catch (error) {
            console.error(`BTC Service: Failed to get initial data for ${timeframe}`, error);
            throw error;
        }
    }
}

export const btcConfirmationService = new BtcConfirmationService();
