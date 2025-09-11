import type { Kline } from '../types';

export interface SupportResistance {
    supports: { price: number; score: number }[];
    resistances: { price: number; score: number }[];
}

export interface SwingPoint {
    index: number;
    price: number;
    type: 'high' | 'low';
}

export interface MarketStructureAnalysis {
    structure: 'Uptrend' | 'Downtrend' | 'Ranging' | 'Indeterminate';
    lastSignal: 'HH' | 'HL' | 'LL' | 'LH' | 'ChoCH_Bearish' | 'ChoCH_Bullish' | null;
    reason: string;
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
                level.price = (level.price * level.score + pivot.price * (1 + volumeScore)) / (level.score + 1 + volumeScore);
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
        .sort((a, b) => b.score - a.score)
        .slice(0, 4); // Limit to top 4 significant levels

    const resistances = levels
        .filter(l => l.type === 'resistance')
        .sort((a, b) => b.score - a.score)
        .slice(0, 4); // Limit to top 4 significant levels
        
    return { supports, resistances };
};

/**
 * Identifies significant swing high and swing low points from k-line data. This new implementation is more robust.
 * @param klines The historical k-line data.
 * @param lookback The number of candles on each side to validate a pivot point.
 * @returns An array of identified SwingPoint objects.
 */
export const findSwingPoints = (klines: Kline[], lookback: number = 5): SwingPoint[] => {
    if (klines.length < lookback * 2 + 1) return [];

    const allPivots: SwingPoint[] = [];

    // 1. Find all potential pivot points without skipping
    for (let i = lookback; i < klines.length - lookback; i++) {
        const window = klines.slice(i - lookback, i + lookback + 1);
        const currentHigh = klines[i].high;
        const currentLow = klines[i].low;

        const isSwingHigh = currentHigh === Math.max(...window.map(k => k.high));
        const isSwingLow = currentLow === Math.min(...window.map(k => k.low));

        if (isSwingHigh) {
            allPivots.push({ index: i, price: currentHigh, type: 'high' });
        }
        // Use else if to avoid double-counting a doji as both high and low pivot in the same candle
        else if (isSwingLow) {
            allPivots.push({ index: i, price: currentLow, type: 'low' });
        }
    }

    if (allPivots.length < 2) return allPivots;

    // 2. Filter for a clean, alternating sequence of pivots
    const cleanPivots: SwingPoint[] = [allPivots[0]];

    for (let i = 1; i < allPivots.length; i++) {
        const lastCleanPivot = cleanPivots[cleanPivots.length - 1];
        const currentPivot = allPivots[i];

        if (currentPivot.type !== lastCleanPivot.type) {
            cleanPivots.push(currentPivot);
        } else {
            // Same type as the last one, replace if it's more significant
            if (currentPivot.type === 'high' && currentPivot.price > lastCleanPivot.price) {
                cleanPivots[cleanPivots.length - 1] = currentPivot;
            } else if (currentPivot.type === 'low' && currentPivot.price < lastCleanPivot.price) {
                cleanPivots[cleanPivots.length - 1] = currentPivot;
            }
        }
    }
    
    return cleanPivots;
};


/**
 * Analyzes a sequence of swing points to determine the current market structure.
 * @param swingPoints An array of SwingPoint objects, ordered from oldest to most recent.
 * @returns A MarketStructureAnalysis object detailing the trend and the last structural signal.
 */
export const analyzeMarketStructure = (swingPoints: SwingPoint[]): MarketStructureAnalysis => {
    if (swingPoints.length < 4) {
        return { structure: 'Indeterminate', lastSignal: null, reason: 'Not enough swing points for analysis.' };
    }

    const lastFour = swingPoints.slice(-4);
    const [p1, p2, p3, p4] = lastFour; // p4 is the most recent

    // Uptrend Pattern check: Expects Low-High-Low-High sequence
    if (p4.type === 'high' && p3.type === 'low' && p2.type === 'high' && p1.type === 'low') {
        const isHigherHigh = p4.price > p2.price;
        const isHigherLow = p3.price > p1.price;

        if (isHigherHigh && isHigherLow) {
            return { structure: 'Uptrend', lastSignal: 'HH', reason: 'Confirmed Uptrend: Higher Highs and Higher Lows.' };
        }
        if (!isHigherLow) {
            return { structure: 'Downtrend', lastSignal: 'ChoCH_Bearish', reason: 'Change of Character: Uptrend failed to make a Higher Low, breaking structure.' };
        }
        return { structure: 'Ranging', lastSignal: null, reason: 'Uptrend losing momentum (failed to make Higher High).' };
    }

    // Downtrend Pattern check: Expects High-Low-High-Low sequence
    if (p4.type === 'low' && p3.type === 'high' && p2.type === 'low' && p1.type === 'high') {
        const isLowerLow = p4.price < p2.price;
        const isLowerHigh = p3.price < p1.price;

        if (isLowerLow && isLowerHigh) {
            return { structure: 'Downtrend', lastSignal: 'LL', reason: 'Confirmed Downtrend: Lower Lows and Lower Highs.' };
        }
        if (!isLowerHigh) {
            return { structure: 'Uptrend', lastSignal: 'ChoCH_Bullish', reason: 'Change of Character: Downtrend failed to make a Lower High, breaking structure.' };
        }
        return { structure: 'Ranging', lastSignal: null, reason: 'Downtrend losing momentum (failed to make Lower Low).' };
    }

    return { structure: 'Ranging', lastSignal: null, reason: 'Market is in a complex pullback or consolidation.' };
};