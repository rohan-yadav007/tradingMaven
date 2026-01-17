
// services/btcConfirmationService.ts

import { Kline, TradingMode } from '../types';
import * as binanceService from './binanceService';
import { EMA, RSI } from 'technicalindicators';
import { getLast } from './agents/agentUtils';
import { futuresWsManager } from './wsRegistry';

class BtcConfirmationService {
    private klinesData = new Map<string, Kline[]>();
    private activeTimeframes = new Set<string>();

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
                futuresWsManager.subscribe(`btcusdt@kline_${timeframe}`, (data: any) => {
                    this.handleKlineUpdate(timeframe, data);
                });
            }
            
            return initialKlines;
        } catch (error) {
            console.error(`BTC Service: Failed to get initial data for ${timeframe}`, error);
            throw error;
        }
    }

    public getBtcTrendScore(btcKlines: Kline[]): { bullScore: number; bearScore: number } {
        if (btcKlines.length < 200) return { bullScore: 50, bearScore: 50 };
        const closes = btcKlines.map(k => k.close);
        let bullScore = 0, bearScore = 0;
        const ema50 = getLast(EMA.calculate({ period: 50, values: closes })) as number | undefined;
        const ema200 = getLast(EMA.calculate({ period: 200, values: closes })) as number | undefined;
        if (ema50 && ema200) {
            if (ema50 > ema200) bullScore += 40;
            else bearScore += 40;
        }
        const lastClose = getLast(closes) as number;
        if (ema50) {
            if (lastClose > ema50) bullScore += 30;
            else bearScore += 30;
        }
        const rsi = getLast(RSI.calculate({ period: 14, values: closes })) as number | undefined;
        if (rsi) {
            if (rsi > 55) bullScore += 30;
            else if (rsi < 45) bearScore += 30;
            else { bullScore += (rsi - 45) * 3; bearScore += (55 - rsi) * 3; }
        }
        const total = bullScore + bearScore;
        if (total === 0) return { bullScore: 50, bearScore: 50 };
        return { bullScore: Math.round((bullScore / total) * 100), bearScore: Math.round((bearScore / total) * 100) };
    }
}

export const btcConfirmationService = new BtcConfirmationService();
