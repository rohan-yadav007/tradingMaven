
// services/patternRecognitionService.ts

import { Kline, ChartPattern, SwingPoint } from '../types';
import { findSwingPoints } from './chartAnalysisService';
import { ATR, SMA } from 'technicalindicators';
import { getLast } from './agents/agentUtils';

interface PatternSensitivity {
    swingLookback: number;
    variance: number;
    minMoveAtr: number;
    slopeThreshold: number;
    legVolumeMult: number;
}

/**
 * Geometric Pattern Recognition Service (V8.6 Geometric Precision)
 * Timeframe-aware identification of classical formations with volume and ATR integrity checks.
 */
export class PatternRecognitionService {

    private static getSensitivity(timeframe: string): PatternSensitivity {
        if (['1m', '3m'].includes(timeframe)) {
            // V8.6 Tuning: Variance increased from 0.0018 to 0.0028
            return { swingLookback: 3, variance: 0.0028, minMoveAtr: 1.2, slopeThreshold: 0.00018, legVolumeMult: 1.1 };
        }
        if (['5m', '15m', '30m', '1h'].includes(timeframe)) {
             // V8.6 Tuning: Variance increased from 0.0030 to 0.0045
            return { swingLookback: 5, variance: 0.0045, minMoveAtr: 1.8, slopeThreshold: 0.00012, legVolumeMult: 1.2 };
        }
        // Macro: 4h, 1d
        return { swingLookback: 10, variance: 0.0080, minMoveAtr: 2.8, slopeThreshold: 0.00008, legVolumeMult: 1.5 };
    }
    
    public static detectPatterns(klines: Kline[], timeframe: string): ChartPattern[] {
        const sensitivity = this.getSensitivity(timeframe);
        const swingPoints = findSwingPoints(klines, sensitivity.swingLookback);
        if (swingPoints.length < 5) return [];

        const atrValues = ATR.calculate({ 
            high: klines.map(k => k.high), 
            low: klines.map(k => k.low), 
            close: klines.map(k => k.close), 
            period: 14 
        });
        // FIX: Cast getLast result to number to fix assignment error.
        const currentAtr = (getLast(atrValues) as number) || klines[klines.length - 1].close * 0.01;

        const patterns: ChartPattern[] = [];

        const tripleExtreme = this.detectTripleExtreme(swingPoints, sensitivity, currentAtr);
        if (tripleExtreme) patterns.push(tripleExtreme);

        const doubleExtreme = this.detectDoubleExtreme(swingPoints, sensitivity, currentAtr);
        if (doubleExtreme) patterns.push(doubleExtreme);

        const headAndShoulders = this.detectHeadAndShoulders(swingPoints, currentAtr);
        if (headAndShoulders) patterns.push(headAndShoulders);

        const flagOrPennant = this.detectFlagOrPennant(klines, swingPoints, timeframe, currentAtr, sensitivity);
        if (flagOrPennant) patterns.push(flagOrPennant);

        const triangleOrWedge = this.detectTrianglesAndWedges(swingPoints, sensitivity, currentAtr);
        if (triangleOrWedge) patterns.push(triangleOrWedge);

        const rectangle = this.detectRectangle(swingPoints, sensitivity, currentAtr);
        if (rectangle) patterns.push(rectangle);

        return patterns;
    }

    private static detectDoubleExtreme(swings: SwingPoint[], s: PatternSensitivity, atr: number): ChartPattern | null {
        const lastFour = swings.slice(-4);
        if (lastFour.length < 4) return null;

        const [p1, p2, p3, p4] = lastFour; 
        
        // ATR Scaling: Must have a significant move between peaks
        if (Math.abs(p2.price - p3.price) < atr * s.minMoveAtr) return null;

        // Double Top
        if (p4.type === 'high' && p2.type === 'high' && p3.type === 'low') {
            const diff = Math.abs(p4.price - p2.price) / p2.price;
            if (diff < s.variance) {
                const neckline = p3.price;
                const patternHeight = Math.max(p2.price, p4.price) - neckline;
                return {
                    type: 'Double Top',
                    sentiment: 'Bearish',
                    confidence: 82,
                    points: [p2.index, p3.index, p4.index],
                    reason: 'Double Top rejection verified.',
                    triggerPrice: neckline,
                    measuredTarget: neckline - patternHeight,
                    invalidationLevel: Math.max(p2.price, p4.price) * 1.001
                };
            }
        }

        // Double Bottom
        if (p4.type === 'low' && p2.type === 'low' && p3.type === 'high') {
            const diff = Math.abs(p4.price - p2.price) / p2.price;
            if (diff < s.variance) {
                const neckline = p3.price;
                const patternHeight = neckline - Math.min(p2.price, p4.price);
                return {
                    type: 'Double Bottom',
                    sentiment: 'Bullish',
                    confidence: 82,
                    points: [p2.index, p3.index, p4.index],
                    reason: 'Double Bottom accumulation verified.',
                    triggerPrice: neckline,
                    measuredTarget: neckline + patternHeight,
                    invalidationLevel: Math.min(p2.price, p4.price) * 0.999
                };
            }
        }

        return null;
    }

    private static detectTripleExtreme(swings: SwingPoint[], s: PatternSensitivity, atr: number): ChartPattern | null {
        const lastSix = swings.slice(-6);
        if (lastSix.length < 6) return null;

        const [p1, p2, p3, p4, p5, p6] = lastSix; 

        // ATR Scaling: Significant moves between pivot points
        if (Math.abs(p2.price - p3.price) < atr * s.minMoveAtr) return null;

        // Triple Top (High-Low-High-Low-High)
        if (p2.type === 'high' && p4.type === 'high' && p6.type === 'high' && p3.type === 'low' && p5.type === 'low') {
            const diff1 = Math.abs(p4.price - p2.price) / p2.price;
            const diff2 = Math.abs(p6.price - p4.price) / p4.price;
            if (diff1 < s.variance && diff2 < s.variance) {
                const neckline = Math.min(p3.price, p5.price);
                const patternHeight = Math.max(p2.price, p4.price, p6.price) - neckline;
                return {
                    type: 'Triple Top',
                    sentiment: 'Bearish',
                    confidence: 94,
                    points: [p2.index, p3.index, p4.index, p5.index, p6.index],
                    reason: 'High-conviction Triple Top resistance.',
                    triggerPrice: neckline,
                    measuredTarget: neckline - patternHeight,
                    invalidationLevel: Math.max(p2.price, p4.price, p6.price) * 1.001
                };
            }
        }

        // Triple Bottom (Low-High-Low-High-Low)
        if (p2.type === 'low' && p4.type === 'low' && p6.type === 'low' && p3.type === 'high' && p5.type === 'high') {
            const diff1 = Math.abs(p4.price - p2.price) / p2.price;
            const diff2 = Math.abs(p6.price - p4.price) / p4.price;
            if (diff1 < s.variance && diff2 < s.variance) {
                const neckline = Math.max(p3.price, p5.price);
                const patternHeight = neckline - Math.min(p2.price, p4.price, p6.price);
                return {
                    type: 'Triple Bottom',
                    sentiment: 'Bullish',
                    confidence: 94,
                    points: [p2.index, p3.index, p4.index, p5.index, p6.index],
                    reason: 'High-conviction Triple Bottom support.',
                    triggerPrice: neckline,
                    measuredTarget: neckline + patternHeight,
                    invalidationLevel: Math.min(p2.price, p4.price, p6.price) * 0.999
                };
            }
        }

        return null;
    }

    private static detectHeadAndShoulders(swings: SwingPoint[], atr: number): ChartPattern | null {
        const lastFive = swings.slice(-5);
        if (lastFive.length < 5) return null;

        const [p1, p2, p3, p4, p5] = lastFive;
        const headShoulderMinDist = atr * 1.0;

        // H&S
        if (p1.type === 'high' && p3.type === 'high' && p5.type === 'high' && p2.type === 'low' && p4.type === 'low') {
            const headDist = Math.min(p3.price - p1.price, p3.price - p5.price);
            if (headDist > headShoulderMinDist) {
                const neckline = (p2.price + p4.price) / 2;
                const patternHeight = p3.price - neckline;
                return {
                    type: 'Head and Shoulders',
                    sentiment: 'Bearish',
                    confidence: 90,
                    points: [p1.index, p2.index, p3.index, p4.index, p5.index],
                    reason: 'Classical macro H&S reversal.',
                    triggerPrice: neckline,
                    measuredTarget: neckline - patternHeight,
                    invalidationLevel: p5.price * 1.0015
                };
            }
        }

        // Inv H&S
        if (p1.type === 'low' && p3.type === 'low' && p5.type === 'low' && p2.type === 'high' && p4.type === 'high') {
            const headDist = Math.min(p1.price - p3.price, p5.price - p3.price);
            if (headDist > headShoulderMinDist) {
                const neckline = (p2.price + p4.price) / 2;
                const patternHeight = neckline - p3.price;
                return {
                    type: 'Inverse Head and Shoulders',
                    sentiment: 'Bullish',
                    confidence: 90,
                    points: [p1.index, p2.index, p3.index, p4.index, p5.index],
                    reason: 'Macro Inverse H&S floor.',
                    triggerPrice: neckline,
                    measuredTarget: neckline + patternHeight,
                    invalidationLevel: p5.price * 0.9985
                };
            }
        }

        return null;
    }

    private static detectFlagOrPennant(klines: Kline[], swings: SwingPoint[], timeframe: string, atr: number, s: PatternSensitivity): ChartPattern | null {
        const poleLookback = ['1m', '3m'].includes(timeframe) ? 20 : 35;
        if (klines.length < poleLookback) return null;

        const recent = klines.slice(-poleLookback);
        const startPrice = recent[0].open;
        const poleIdx = Math.floor(poleLookback * 0.4);
        const poleEndPrice = recent[poleIdx].close;
        const poleMove = poleEndPrice - startPrice;

        if (Math.abs(poleMove) < atr * s.minMoveAtr) return null;

        // V8.6: Volume Integrity Check (Leg Volume > Consolidation Volume)
        const poleKlines = recent.slice(0, poleIdx);
        const consolidationKlines = recent.slice(poleIdx);
        const poleAvgVol = poleKlines.reduce((s,k)=>s+(k.volume||0), 0) / poleKlines.length;
        const consAvgVol = consolidationKlines.reduce((s,k)=>s+(k.volume||0), 0) / consolidationKlines.length;
        
        if (poleAvgVol < consAvgVol * s.legVolumeMult) return null;

        const consolidationSwings = swings.filter(sw => sw.index > klines.length - (poleLookback - poleIdx));
        if (consolidationSwings.length < 2) return null;

        const highPoints = consolidationSwings.filter(p => p.type === 'high');
        const lowPoints = consolidationSwings.filter(p => p.type === 'low');
        if (highPoints.length < 1 || lowPoints.length < 1) return null;

        const isBull = poleMove > 0;
        const currentPrice = klines[klines.length-1].close;

        // Simplify for V8.6: Just detect consolidation at the end of a big move
        const lastLow = lowPoints[lowPoints.length-1].price;
        const lastHigh = highPoints[highPoints.length-1].price;
        const rangeWidth = (lastHigh - lastLow) / lastLow;

        if (rangeWidth < s.variance * 1.5) {
             return {
                type: isBull ? 'Bull Flag' : 'Bear Flag',
                sentiment: isBull ? 'Bullish' : 'Bearish',
                confidence: 80,
                points: consolidationSwings.map(sw => sw.index),
                reason: 'Volume-confirmed Flag consolidation.',
                triggerPrice: isBull ? lastHigh : lastLow,
                measuredTarget: isBull ? currentPrice + (poleMove * 0.8) : currentPrice - (poleMove * 0.8),
                invalidationLevel: isBull ? lastLow * 0.999 : lastHigh * 1.001
            };
        }

        return null;
    }

    private static detectRectangle(swings: SwingPoint[], s: PatternSensitivity, atr: number): ChartPattern | null {
        const lastSix = swings.slice(-6);
        if (lastSix.length < 4) return null;

        const highs = lastSix.filter(sw => sw.type === 'high');
        const lows = lastSix.filter(sw => sw.type === 'low');
        if (highs.length < 2 || lows.length < 2) return null;

        const highPrices = highs.map(p=>p.price);
        const lowPrices = lows.map(p=>p.price);
        
        const highVariance = Math.abs(Math.max(...highPrices) - Math.min(...highPrices)) / Math.min(...highPrices);
        const lowVariance = Math.abs(Math.max(...lowPrices) - Math.min(...lowPrices)) / Math.min(...lowPrices);

        if (highVariance < s.variance && lowVariance < s.variance) {
            const rangeHeight = Math.min(...highPrices) - Math.max(...lowPrices);
            if (rangeHeight < atr * 0.8) return null;

            return {
                type: 'Bullish Rectangle', 
                sentiment: 'Neutral',
                confidence: 78,
                points: lastSix.map(sw => sw.index),
                reason: 'Consolidation channel detected.',
                triggerPrice: Math.min(...highPrices),
                measuredTarget: Math.min(...highPrices) + rangeHeight,
                invalidationLevel: Math.max(...lowPrices)
            };
        }
        return null;
    }

    private static detectTrianglesAndWedges(swings: SwingPoint[], s: PatternSensitivity, atr: number): ChartPattern | null {
        const lastSix = swings.slice(-6);
        if (lastSix.length < 4) return null;

        const highs = lastSix.filter(sw => sw.type === 'high');
        const lows = lastSix.filter(sw => sw.type === 'low');
        if (highs.length < 1 || lows.length < 1) return null;

        const patternHeight = Math.max(...highs.map(h=>h.price)) - Math.min(...lows.map(l=>l.price));
        
        if (patternHeight < atr * 1.5) return null;

        // V8.6 Simplified Wedge/Triangle Logic
        const firstHigh = highs[0].price;
        const lastHigh = highs[highs.length-1].price;
        const firstLow = lows[0].price;
        const lastLow = lows[lows.length-1].price;

        // Ascending Triangle
        if (Math.abs(firstHigh - lastHigh) / lastHigh < s.variance && lastLow > firstLow) {
            return {
                type: 'Ascending Triangle',
                sentiment: 'Bullish',
                confidence: 85,
                points: lastSix.map(sw => sw.index),
                reason: 'Bullish accumulation at resistance ceiling.',
                triggerPrice: lastHigh,
                measuredTarget: lastHigh + (patternHeight * 0.9),
                invalidationLevel: lastLow * 0.999
            };
        }

        // Descending Triangle
        if (Math.abs(firstLow - lastLow) / lastLow < s.variance && lastHigh < firstHigh) {
            return {
                type: 'Descending Triangle',
                sentiment: 'Bearish',
                confidence: 85,
                points: lastSix.map(sw => sw.index),
                reason: 'Bearish distribution at support floor.',
                triggerPrice: lastLow,
                measuredTarget: lastLow - (patternHeight * 0.9),
                invalidationLevel: lastHigh * 1.001
            };
        }

        return null;
    }
}
