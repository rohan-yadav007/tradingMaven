
import { Kline } from '../types';

export interface SupportResistance {
    supports: number[];
    resistances: number[];
}

/**
 * Calculates support and resistance levels from k-line data.
 * @param klines - The array of k-line data.
 * @param lookback - The number of candles to look back and forward to confirm a pivot.
 * @param thresholdPercent - The percentage distance to cluster nearby pivots.
 * @returns An object containing arrays of support and resistance price levels.
 */
export const calculateSupportResistance = (klines: Kline[], lookback: number = 10, thresholdPercent: number = 0.0075): SupportResistance => {
    if (klines.length < lookback * 2 + 1) {
        return { supports: [], resistances: [] };
    }

    const pivots: { price: number, type: 'support' | 'resistance' }[] = [];

    // Find pivot points
    for (let i = lookback; i < klines.length - lookback; i++) {
        const isPivotHigh = klines[i].high > Math.max(...klines.slice(i - lookback, i).map(k => k.high)) &&
                          klines[i].high > Math.max(...klines.slice(i + 1, i + 1 + lookback).map(k => k.high));

        if (isPivotHigh) {
            pivots.push({ price: klines[i].high, type: 'resistance' });
        }

        const isPivotLow = klines[i].low < Math.min(...klines.slice(i - lookback, i).map(k => k.low)) &&
                         klines[i].low < Math.min(...klines.slice(i + 1, i + 1 + lookback).map(k => k.low));
        
        if (isPivotLow) {
            pivots.push({ price: klines[i].low, type: 'support' });
        }
    }

    // Cluster and score levels
    if (pivots.length === 0) {
        return { supports: [], resistances: [] };
    }

    const levels: { price: number, score: number, type: 'support' | 'resistance' }[] = [];
    
    pivots.forEach(pivot => {
        let foundLevel = false;
        for (const level of levels) {
            if (level.type === pivot.type && Math.abs(level.price - pivot.price) / pivot.price < thresholdPercent) {
                // Average the price and increment the score for the cluster
                level.price = (level.price * level.score + pivot.price) / (level.score + 1);
                level.score++;
                foundLevel = true;
                break;
            }
        }
        if (!foundLevel) {
            levels.push({ price: pivot.price, score: 1, type: pivot.type });
        }
    });

    // Filter for significant levels (e.g., score > 1) and sort by score
    const significantLevels = levels.filter(l => l.score > 1).sort((a, b) => b.score - a.score);

    // Return the top N levels for each type
    const supports = significantLevels
        .filter(l => l.type === 'support')
        .map(l => l.price)
        .slice(0, 3);

    const resistances = significantLevels
        .filter(l => l.type === 'resistance')
        .map(l => l.price)
        .slice(0, 3);
        
    return { supports, resistances };
};
