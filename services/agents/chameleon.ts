// services/agents/chameleon.ts

import { Kline, BotConfig, MarketDataContext, TradeSignal, ADXOutput } from '../../types';
import { ADX, EMA } from 'technicalindicators';
import { getLast, getPenultimate } from './agentUtils';

export const getChameleonSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<typeof config.agentParams>;
    const minKlines = Math.max(
        params.ch_trendEmaPeriod,
        params.ch_slowEmaPeriod,
        params.adxPeriod
    );
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data for analysis.'] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const reasons: string[] = [];

    const trendEma = getLast(EMA.calculate({ period: params.ch_trendEmaPeriod, values: closes })) as number | undefined;
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.adxPeriod })) as ADXOutput | undefined;
    const fastEmaValues = EMA.calculate({ period: params.ch_fastEmaPeriod, values: closes });
    const slowEmaValues = EMA.calculate({ period: params.ch_slowEmaPeriod, values: closes });
    const lastFastEma = getLast(fastEmaValues) as number | undefined;
    const prevFastEma = getPenultimate(fastEmaValues) as number | undefined;
    const lastSlowEma = getLast(slowEmaValues) as number | undefined;
    const prevSlowEma = getPenultimate(slowEmaValues) as number | undefined;
    const currentPrice = getLast(closes) as number | undefined;
    
    if(!trendEma || !adx || !lastFastEma || !prevFastEma || !lastSlowEma || !prevSlowEma || !currentPrice) {
         return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data for indicators.'] };
    }

    const isMacroBullish = currentPrice > trendEma;
    const isMacroBearish = currentPrice < trendEma;
    
    const isTrending = !config.isAdxFilterEnabled || adx.adx > params.ch_adxThreshold;

    const bullishCross = prevFastEma < prevSlowEma && lastFastEma > lastSlowEma;
    const bearishCross = prevFastEma > prevSlowEma && lastFastEma < lastSlowEma;
    
    reasons.push(isMacroBullish ? `✅ Trend: Bullish` : isMacroBearish ? `✅ Trend: Bearish` : `❌ Trend: Neutral`);
    if (config.isAdxFilterEnabled) {
        reasons.push(isTrending ? `✅ Regime: Trending (ADX ${adx.adx.toFixed(1)})` : `❌ Regime: Ranging`);
    } else {
        reasons.push('✅ Regime: Trending (ADX Filter Disabled)');
    }

    if (isMacroBullish && isTrending) {
        reasons.push(bullishCross ? `✅ EMA: Bullish Cross` : `❌ EMA: No Bullish Cross`);
        if (bullishCross) {
            return { signal: 'BUY', reasons };
        }
    }
    
    if (isMacroBearish && isTrending) {
        reasons.push(bearishCross ? `✅ EMA: Bearish Cross` : `❌ EMA: No Bearish Cross`);
        if (bearishCross) {
            return { signal: 'SELL', reasons };
        }
    }

    return { signal: 'HOLD', reasons };
};
