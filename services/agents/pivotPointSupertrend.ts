// services/agents/pivotPointSupertrend.ts

import { Kline, BotConfig, TradeSignal, AgentParams } from '../../types';
import { ATR } from 'technicalindicators';
import { getLast, getPenultimate } from './agentUtils';

const findPivots = (klines: Kline[], period: number) => {
    const pivots: ({ index: number, price: number, type: 'high' | 'low' })[] = [];
    if (klines.length < period * 2 + 1) return pivots;

    for (let i = period; i < klines.length - period; i++) {
        const window = klines.slice(i - period, i + period + 1);
        const isHigh = klines[i].high === Math.max(...window.map(k => k.high));
        const isLow = klines[i].low === Math.min(...window.map(k => k.low));

        // Pine script's pivothigh/low doesn't check for uniqueness on flat tops/bottoms.
        // It identifies the first occurrence. To emulate this, we just check if it's a high or low.
        // The precedence `ph ? ph : pl` gives high priority, and our `else if` structure does the same.
        if (isHigh) {
            pivots.push({ index: i, price: klines[i].high, type: 'high' });
        } else if (isLow) {
            pivots.push({ index: i, price: klines[i].low, type: 'low' });
        }
    }
    return pivots;
};


export const getPivotPointSupertrendSignal = (klines: Kline[], config: BotConfig): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = Math.max(params.pps_atrPeriod!, params.pps_pivotPeriod! * 2 + 1) + 1;
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for Pivot Point SuperTrend (${klines.length}/${minKlines})`] };
    }

    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const closes = klines.map(k => k.close);

    const pivots = findPivots(klines, params.pps_pivotPeriod!);
    
    const centerLine: (number | undefined)[] = new Array(klines.length).fill(undefined);
    let pivotCursor = 0;
    for (let i = 1; i < klines.length; i++) {
        let newCenter = centerLine[i-1];
        if (pivots[pivotCursor] && i === pivots[pivotCursor].index) {
            const pivotPrice = pivots[pivotCursor].price;
            if (centerLine[i - 1] === undefined) {
                newCenter = pivotPrice;
            } else {
                newCenter = (centerLine[i - 1]! * 2 + pivotPrice) / 3;
            }
            pivotCursor++;
        }
        centerLine[i] = newCenter;
    }

    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: params.pps_atrPeriod! });

    const TUp: (number | undefined)[] = new Array(klines.length).fill(undefined);
    const TDown: (number | undefined)[] = new Array(klines.length).fill(undefined);
    const Trend: (number | undefined)[] = new Array(klines.length).fill(undefined);
    
    for (let i = minKlines; i < klines.length; i++) {
        const atr = atrValues[i - params.pps_atrPeriod!];
        const center = centerLine[i];
        
        if (atr === undefined || center === undefined) continue;

        const Up = center - (params.pps_atrFactor! * atr); // Lower band in script
        const Dn = center + (params.pps_atrFactor! * atr); // Upper band in script

        const TUp_prev = TUp[i-1];
        const TDown_prev = TDown[i-1];

        if (TUp_prev === undefined || TDown_prev === undefined) {
             TUp[i] = Up;
             TDown[i] = Dn;
             Trend[i] = 1;
             continue;
        }

        TUp[i] = closes[i-1] > TUp_prev ? Math.max(Up, TUp_prev) : Up;
        TDown[i] = closes[i-1] < TDown_prev ? Math.min(Dn, TDown_prev) : Dn;

        const Trend_prev = Trend[i-1] || 1;
        if (closes[i] > TDown_prev) {
            Trend[i] = 1;
        } else if (closes[i] < TUp_prev) {
            Trend[i] = -1;
        } else {
            Trend[i] = Trend_prev;
        }
    }

    const lastTrend = getLast(Trend);
    const prevTrend = getPenultimate(Trend);
    
    if (lastTrend === undefined || prevTrend === undefined) {
        return { signal: 'HOLD', reasons: ['ℹ️ Trend could not be determined.'] };
    }

    const reasons: string[] = [`ℹ️ Current Trend: ${lastTrend === 1 ? 'Bullish' : 'Bearish'}`];

    if (lastTrend === 1 && prevTrend === -1) {
        reasons.push('✅ Trend flipped from Bearish to Bullish.');
        return { signal: 'BUY', reasons };
    }
    
    if (lastTrend === -1 && prevTrend === 1) {
        reasons.push('✅ Trend flipped from Bullish to Bearish.');
        return { signal: 'SELL', reasons };
    }
    
    reasons.push('ℹ️ No trend flip detected.');
    return { signal: 'HOLD', reasons };
};