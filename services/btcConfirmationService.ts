import { Kline, TradingMode } from '../types';
import * as binanceService from './binanceService';
import { EMA, RSI } from 'technicalindicators';
import { getLast } from './agents/agentUtils';

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

    public getBtcTrendScore(btcKlines: Kline[]): { bullScore: number; bearScore: number } {
        // FIX: Increased guard from 50 to 200 for EMA200 reliability.
        if (btcKlines.length < 200) {
            return { bullScore: 50, bearScore: 50 }; // Neutral if not enough data
        }

        const closes = btcKlines.map(k => k.close);
        let bullScore = 0;
        let bearScore = 0;

        // EMA alignment (long-term trend) - 40 points
        const ema50 = getLast(EMA.calculate({ period: 50, values: closes })) as number | undefined;
        const ema200 = getLast(EMA.calculate({ period: 200, values: closes })) as number | undefined;
        if (ema50 && ema200) {
            if (ema50 > ema200) bullScore += 40;
            else bearScore += 40;
        }

        // Price position relative to EMAs (short-term trend) - 30 points
        const lastClose = getLast(closes) as number;
        if (ema50) {
            if (lastClose > ema50) bullScore += 30;
            else bearScore += 30;
        }

        // RSI (momentum) - 30 points
        const rsi = getLast(RSI.calculate({ period: 14, values: closes })) as number | undefined;
        if (rsi) {
            if (rsi > 55) bullScore += 30;
            else if (rsi < 45) bearScore += 30;
            else { // In the middle range, give partial points
                bullScore += (rsi - 45) * 3; // e.g. at RSI 50, bull gets 15, bear gets 15
                bearScore += (55 - rsi) * 3;
            }
        }
        
        const total = bullScore + bearScore;
        if (total === 0) return { bullScore: 50, bearScore: 50 }; // Avoid division by zero
        
        return {
            bullScore: Math.round((bullScore / total) * 100),
            bearScore: Math.round((bearScore / total) * 100)
        };
    }
}

export const btcConfirmationService = new BtcConfirmationService();
