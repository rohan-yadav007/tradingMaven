
// services/agents/supertrendFlipper.ts

import { Kline, BotConfig, TradeSignal, AgentParams } from '../../types';
import { Supertrend, getLast, getPenultimate, calculateHeikinAshi } from './agentUtils';
import { ATR } from 'technicalindicators';

export const getSupertrendFlipperSignal = (klines: Kline[], config: BotConfig): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = Math.max((params.stf_atrPeriod || 10) + 2, params.stf_volatilityPeriod || 100);

    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for Supertrend (${klines.length}/${minKlines})`] };
    }

    const reasons: string[] = [];
    let processedKlines = klines;

    if (config.isHeikinAshiEnabled) {
        processedKlines = calculateHeikinAshi(klines);
        reasons.push('ℹ️ Using Heikin Ashi candles for calculation.');
    }

    const highs = processedKlines.map(k => k.high);
    const lows = processedKlines.map(k => k.low);
    const closes = processedKlines.map(k => k.close);

    // --- DYNAMIC MULTIPLIER LOGIC ---
    let activeMultiplier = params.stf_atrMultiplier!;
    if (params.stf_enableDynamicMultiplier) {
        // FIX: Explicitly cast getLast(atrValues) to number | undefined to satisfy TS.
        const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: params.stf_volatilityPeriod! });
        const lastAtr = getLast(atrValues) as number | undefined;

        if (lastAtr && atrValues.length > 2) {
            const historicalAtr = atrValues.slice(0, -1).filter(v => v !== undefined) as number[];
            const sortedAtr = [...historicalAtr].sort((a, b) => a - b);
            const rank = sortedAtr.reduce((acc, val) => (val < lastAtr ? acc + 1 : acc), 0);
            const percentile = (rank / sortedAtr.length) * 100;

            if (percentile <= params.stf_volatilityThreshold_low!) {
                activeMultiplier = params.stf_multiplier_low!;
                reasons.push(`ℹ️ Volatility: Low (Multiplier: ${activeMultiplier})`);
            } else if (percentile >= params.stf_volatilityThreshold_high!) {
                activeMultiplier = params.stf_multiplier_high!;
                reasons.push(`ℹ️ Volatility: High (Multiplier: ${activeMultiplier})`);
            } else {
                activeMultiplier = params.stf_multiplier_normal!;
                reasons.push(`ℹ️ Volatility: Normal (Multiplier: ${activeMultiplier})`);
            }
        } else {
            reasons.push(`⚠️ Could not determine volatility, using default multiplier.`);
        }
    }
    // --- END DYNAMIC MULTIPLIER ---


    const supertrendValues = Supertrend.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: params.stf_atrPeriod!,
        multiplier: activeMultiplier
    });

    const lastSt = getLast(supertrendValues) as number | undefined;
    const prevSt = getPenultimate(supertrendValues) as number | undefined;

    const lastClose = getLast(closes) as number | undefined;
    const prevClose = getPenultimate(closes) as number | undefined;

    if (lastSt === undefined || prevSt === undefined || lastClose === undefined || prevClose === undefined) {
        reasons.push('ℹ️ Supertrend indicator is still warming up.');
        return { signal: 'HOLD', reasons };
    }

    const lastTrend = lastClose > lastSt ? 1 : -1; // 1 for bullish, -1 for bearish
    const currentTrendText = `Current Trend: ${lastTrend === 1 ? 'Bullish' : 'Bearish'}`;

    // --- Immediate Entry Logic ---
    if (config.entryTiming === 'immediate') {
        reasons.push('ℹ️ Immediate entry mode enabled.');
        reasons.push(`✅ ${currentTrendText}`);
        if (lastTrend === 1) {
            return { signal: 'BUY', reasons };
        } else {
            return { signal: 'SELL', reasons };
        }
    }

    // --- Flip-based Entry Logic (default) ---
    const prevTrend = prevClose > prevSt ? 1 : -1;
    reasons.push('ℹ️ Flip entry mode enabled.');
    
    const buySignal = lastTrend === 1 && prevTrend === -1;
    const sellSignal = lastTrend === -1 && prevTrend === 1;

    if (buySignal) {
        reasons.push(`✅ Supertrend flipped to Bullish.`);
        return { signal: 'BUY', reasons };
    }

    if (sellSignal) {
        reasons.push(`✅ Supertrend flipped to Bearish.`);
        return { signal: 'SELL', reasons };
    }

    reasons.push(`ℹ️ No Supertrend flip detected. ${currentTrendText}`);
    return { signal: 'HOLD', reasons };
};
