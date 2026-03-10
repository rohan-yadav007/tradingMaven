
// services/indicators.ts

import { Kline } from '../types';

export function calculateCVD(klines: Kline[]): number[] {
    const cvd: number[] = [0];
    for (let i = 1; i < klines.length; i++) {
        const kline = klines[i];
        if (kline.volume === undefined || kline.takerBuyVolume === undefined) {
            cvd.push(cvd[i - 1]);
            continue;
        }
        
        // Taker Buy Volume = Buying Pressure
        // Taker Sell Volume = Total Volume - Taker Buy Volume
        const buyVol = kline.takerBuyVolume;
        const sellVol = kline.volume - buyVol;
        const delta = buyVol - sellVol;
        
        cvd.push(cvd[i - 1] + delta);
    }
    return cvd;
}

/**
 * Detects Absorption: Price making Lower Lows while CVD makes Higher Lows (Bullish Absorption)
 * or Price making Higher Highs while CVD makes Lower Highs (Bearish Absorption).
 */
export function detectAbsorption(klines: Kline[], cvd: number[], lookback: number = 20): 'Bullish' | 'Bearish' | 'None' {
    if (klines.length < lookback || cvd.length < lookback) return 'None';

    const recentKlines = klines.slice(-lookback);
    const recentCvd = cvd.slice(-lookback);

    // Identify indices of Price Lows and Highs
    const lowestPriceIdx = recentKlines.reduce((minIdx, k, idx, arr) => k.low < arr[minIdx].low ? idx : minIdx, 0);
    const highestPriceIdx = recentKlines.reduce((maxIdx, k, idx, arr) => k.high > arr[maxIdx].high ? idx : maxIdx, 0);

    // Identify indices of CVD Lows and Highs
    const lowestCvdIdx = recentCvd.reduce((minIdx, v, idx, arr) => v < arr[minIdx] ? idx : minIdx, 0);
    const highestCvdIdx = recentCvd.reduce((maxIdx, v, idx, arr) => v > arr[maxIdx] ? idx : maxIdx, 0);

    // Bullish Absorption Logic:
    // Price makes a NEW Low (lowest is at the end), but CVD's lowest point was earlier (CVD is rising/holding)
    // Simplified: Price Slope is Down, CVD Slope is Up
    const priceStart = recentKlines[0].close;
    const priceEnd = recentKlines[recentKlines.length - 1].close;
    const cvdStart = recentCvd[0];
    const cvdEnd = recentCvd[recentCvd.length - 1];

    if (priceEnd < priceStart && cvdEnd > cvdStart) {
        // Confirm it's not just noise: Check if we are at a structural low
        if (lowestPriceIdx > lookback * 0.8) { 
            return 'Bullish';
        }
    }

    // Bearish Absorption Logic:
    // Price makes NEW High, but CVD is dropping (Selling into strength)
    if (priceEnd > priceStart && cvdEnd < cvdStart) {
        if (highestPriceIdx > lookback * 0.8) {
            return 'Bearish';
        }
    }

    return 'None';
}

export function calculateVWAP(klines: Kline[]): number[] {
    const vwap: number[] = [];
    let cumVolume = 0;
    let cumPV = 0; // Cumulative (Price * Volume)
    
    // Reset VWAP daily? For crypto perpetuals, a rolling or session VWAP is often better.
    // Here we implement a simple rolling VWAP for the provided window.
    
    for (const k of klines) {
        const avgPrice = (k.high + k.low + k.close) / 3;
        const vol = k.volume || 0;
        
        cumVolume += vol;
        cumPV += avgPrice * vol;
        
        if (cumVolume === 0) vwap.push(avgPrice);
        else vwap.push(cumPV / cumVolume);
    }
    return vwap;
}

export function getVolatilityRegime(atr: number, price: number): 'Low' | 'Normal' | 'High' {
    const volatilityPercent = (atr / price) * 100;

    // Widened Normal band to capture typical 5M conditions across BTC and altcoins.
    // Old: Low < 0.2%, High > 0.8% — too narrow, misclassified most altcoins as Low/High.
    // New: Low < 0.15%, High > 0.6% — Normal band covers 0.15%–0.6% (broader and more realistic).
    if (volatilityPercent < 0.15) return 'Low';
    if (volatilityPercent > 0.60) return 'High';
    return 'Normal';
}
