// services/agents/supertrendFlipper.ts

import { Kline, BotConfig, TradeSignal, AgentParams } from '../../types';
import { Supertrend, getLast, getPenultimate } from './agentUtils';

export const getSupertrendFlipperSignal = (klines: Kline[], config: BotConfig): TradeSignal => {
    const params = config.agentParams as Required<AgentParams>;
    const minKlines = (params.stf_atrPeriod || 10) + 2;

    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for Supertrend (${klines.length}/${minKlines})`] };
    }

    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const closes = klines.map(k => k.close);

    const supertrendValues = Supertrend.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: params.stf_atrPeriod!,
        multiplier: params.stf_atrMultiplier!
    });

    const lastSt = getLast(supertrendValues) as number | undefined;
    const prevSt = getPenultimate(supertrendValues) as number | undefined;

    const lastClose = getLast(closes) as number | undefined;
    const prevClose = getPenultimate(closes) as number | undefined;

    if (lastSt === undefined || prevSt === undefined || lastClose === undefined || prevClose === undefined) {
        return { signal: 'HOLD', reasons: ['ℹ️ Supertrend indicator is still warming up.'] };
    }

    // Determine the trend direction for the previous and current candle based on price vs. the Supertrend line.
    const prevTrend = prevClose > prevSt ? 1 : -1; // 1 for bullish, -1 for bearish
    const lastTrend = lastClose > lastSt ? 1 : -1;

    // A buy signal occurs when the trend flips from bearish (-1) to bullish (1).
    const buySignal = lastTrend === 1 && prevTrend === -1;

    // A sell signal occurs when the trend flips from bullish (1) to bearish (-1).
    const sellSignal = lastTrend === -1 && prevTrend === 1;

    if (buySignal) {
        return { signal: 'BUY', reasons: [`✅ Supertrend flipped to Bullish.`] };
    }

    if (sellSignal) {
        return { signal: 'SELL', reasons: [`✅ Supertrend flipped to Bearish.`] };
    }

    return { signal: 'HOLD', reasons: [`ℹ️ No Supertrend flip detected. Current Trend: ${lastTrend === 1 ? 'Bullish' : 'Bearish'}`] };
};
