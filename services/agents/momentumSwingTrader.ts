// services/agents/momentumSwingTrader.ts

import { Kline, BotConfig, MarketDataContext, TradeSignal, MACDOutput } from '../../types';
import { EMA, MACD } from 'technicalindicators';
import { getLast, calculateVwap } from './agentUtils';

export const getMomentumSwingTraderSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<typeof config.agentParams>;
    const minKlines = params.mst_emaSlowPeriod;
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for analysis (${klines.length}/${minKlines} candles).`] };
    }

    const closes = klines.map(k => k.close);
    const currentPrice = getLast(closes) as number | undefined;
    
    // Indicators
    const vwap = getLast(calculateVwap(klines));
    const emaFast = getLast(EMA.calculate({ period: params.mst_emaFastPeriod, values: closes })) as number | undefined;
    const emaSlow = getLast(EMA.calculate({ period: params.mst_emaSlowPeriod, values: closes })) as number | undefined;
    const macd = getLast(MACD.calculate({
        values: closes,
        fastPeriod: params.mst_macdFastPeriod,
        slowPeriod: params.mst_macdSlowPeriod,
        signalPeriod: params.mst_macdSignalPeriod,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    })) as MACDOutput | undefined;

    if (!currentPrice || !vwap || !emaFast || !emaSlow || !macd?.histogram) {
        return { signal: 'HOLD', reasons: ['ℹ️ Required indicators are not ready.'] };
    }

    // Bullish Conditions
    const isBullishTrend = emaFast > emaSlow;
    const isPriceAboveVwap = currentPrice > vwap;
    const isMacdBullish = macd.histogram > 0;
    
    // Bearish Conditions
    const isBearishTrend = emaFast < emaSlow;
    const isPriceBelowVwap = currentPrice < vwap;
    const isMacdBearish = macd.histogram < 0;

    const bullishReasons: string[] = [
        isBullishTrend ? `✅ Trend: Bullish (EMA ${params.mst_emaFastPeriod} > ${params.mst_emaSlowPeriod})` : `❌ Trend: Not Bullish`,
        isPriceAboveVwap ? `✅ Bias: Bullish (Price > VWAP)` : `❌ Bias: Not Bullish`,
        isMacdBullish ? `✅ Momentum: Bullish (MACD Hist > 0)` : `❌ Momentum: Not Bullish`
    ];
    
    // Check for a BUY signal
    if (isBullishTrend && isPriceAboveVwap && isMacdBullish) {
        return { signal: 'BUY', reasons: bullishReasons };
    }

    const bearishReasons: string[] = [
        isBearishTrend ? `✅ Trend: Bearish (EMA ${params.mst_emaFastPeriod} < ${params.mst_emaSlowPeriod})` : `❌ Trend: Not Bearish`,
        isPriceBelowVwap ? `✅ Bias: Bearish (Price < VWAP)` : `❌ Bias: Not Bearish`,
        isMacdBearish ? `✅ Momentum: Bearish (MACD Hist < 0)` : `❌ Momentum: Not Bearish`
    ];

    // Check for a SELL signal
    if (isBearishTrend && isPriceBelowVwap && isMacdBearish) {
        return { signal: 'SELL', reasons: bearishReasons };
    }
    
    // If no signal, determine which direction has more conviction to provide better feedback.
    const bullConditionsMet = [isBullishTrend, isPriceAboveVwap, isMacdBullish].filter(Boolean).length;
    const bearConditionsMet = [isBearishTrend, isPriceBelowVwap, isMacdBearish].filter(Boolean).length;

    if (bullConditionsMet > bearConditionsMet) {
        bullishReasons.unshift('ℹ️ Waiting for bullish signal confirmation.');
        return { signal: 'HOLD', reasons: bullishReasons };
    } else if (bearConditionsMet > bullConditionsMet) {
        bearishReasons.unshift('ℹ️ Waiting for bearish signal confirmation.');
        return { signal: 'HOLD', reasons: bearishReasons };
    }

    // Default message if conviction is tied or zero.
    return { signal: 'HOLD', reasons: ['ℹ️ No clear directional bias. Waiting for conditions to align.'] };
};
