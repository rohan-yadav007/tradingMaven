import type { Kline } from '../types';

export interface SupportResistance {
    supports: number[];
    resistances: number[];
}

/**
 * Calculates support and resistance levels from k-line data with volume-weighted scoring.
 * @param klines - The array of k-line data.
 * @param lookback - The number of candles to look back and forward to confirm a pivot.
 * @param thresholdPercent - The percentage distance to cluster nearby pivots.
 * @returns An object containing arrays of support and resistance price levels.
 */
export const calculateSupportResistance = (klines: Kline[], lookback: number = 10, thresholdPercent: number = 0.0075): SupportResistance => {
    if (klines.length < lookback * 2 + 1) {
        return { supports: [], resistances: [] };
    }

    const pivots: { price: number; type: 'support' | 'resistance'; index: number }[] = [];

    // Find pivot points
    for (let i = lookback; i < klines.length - lookback; i++) {
        const window = klines.slice(i - lookback, i + lookback + 1);
        const windowHighs = window.map(k => k.high);
        const windowLows = window.map(k => k.low);

        const currentHigh = klines[i].high;
        const currentLow = klines[i].low;

        // Check if the current candle's high is the highest in the window
        if (currentHigh === Math.max(...windowHighs)) {
            pivots.push({ price: currentHigh, type: 'resistance', index: i });
            i += lookback; // Skip forward to avoid finding the same pivot in the next iteration
        } 
        // Check if the current candle's low is the lowest in the window
        else if (currentLow === Math.min(...windowLows)) {
            pivots.push({ price: currentLow, type: 'support', index: i });
            i += lookback; // Skip forward
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
                const pivotVolume = klines[pivot.index]?.volume || 0;
                // Use log to temper the effect of extreme volume spikes
                const volumeScore = Math.log(pivotVolume + 1);

                // Average the price and increment the score for the cluster
                level.price = (level.price * level.score + pivot.price) / (level.score + 1);
                level.score += 1 + volumeScore;
                foundLevel = true;
                break;
            }
        }
        if (!foundLevel) {
             const pivotVolume = klines[pivot.index]?.volume || 0;
             const volumeScore = Math.log(pivotVolume + 1);
            levels.push({ price: pivot.price, score: 1 + volumeScore, type: pivot.type });
        }
    });

    const supports = levels
        .filter(l => l.type === 'support')
        .sort((a, b) => b.score - a.score) // Sort by significance
        .map(l => l.price);

    const resistances = levels
        .filter(l => l.type === 'resistance')
        .sort((a, b) => b.score - a.score) // Sort by significance
        .map(l => l.price);
        
    return { supports, resistances };
};