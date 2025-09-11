// services/agents/historicExpert.ts

import { Kline, BotConfig, MarketDataContext, TradeSignal, ADXOutput } from '../../types';
import { ADX, ATR, SMA, EMA, RSI, OBV } from 'technicalindicators';
import { getLast, isObvTrending } from './agentUtils';

export const getHistoricExpertSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<typeof config.agentParams>;
    const minKlines = Math.max(params.he_trendSmaPeriod, params.he_fastEmaPeriod, params.he_rsiPeriod, params.adxPeriod, params.obvPeriod);
    if (klines.length < minKlines + 1) return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data'] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const lastKline = getLast(klines);
    const reasons: string[] = [];

    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.adxPeriod })) as ADXOutput | undefined;
    const atr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: params.atrPeriod })) as number | undefined;
    const trendSma = getLast(SMA.calculate({ period: params.he_trendSmaPeriod, values: closes })) as number | undefined;
    const pullbackEma = getLast(EMA.calculate({ period: params.he_fastEmaPeriod, values: closes })) as number | undefined;
    const rsi = getLast(RSI.calculate({ period: params.he_rsiPeriod, values: closes })) as number | undefined;

    if (!lastKline || !adx || !atr || !trendSma || !pullbackEma || !rsi) {
        return { signal: 'HOLD', reasons: ['ℹ️ Insufficient data for indicators.'] };
    }
    const currentPrice = lastKline.close;

    const isTrending = !config.isAdxFilterEnabled || adx.adx > params.he_adxTrendThreshold;
    reasons.push(config.isAdxFilterEnabled ? (isTrending ? `✅ Trend Active (ADX > ${params.he_adxTrendThreshold})` : `❌ Chop Zone (ADX < ${params.he_adxTrendThreshold})`) : '✅ Trend Active (ADX Filter Disabled)');
    if (!isTrending) return { signal: 'HOLD', reasons };
    
    const candleRange = lastKline.high - lastKline.low;
    const isNotExhaustion = candleRange < atr * 3;
    reasons.push(isNotExhaustion ? `✅ Normal Volatility` : `❌ High Volatility (Exhaustion Risk)`);
    if (!isNotExhaustion) return { signal: 'HOLD', reasons };
    
    const isBullishTrend = currentPrice > trendSma;
    reasons.push(isBullishTrend ? `✅ Trend: Bullish` : `✅ Trend: Bearish`);

    const bullishPullback = isBullishTrend && lastKline.low <= pullbackEma && lastKline.close > pullbackEma;
    const bearishPullback = !isBullishTrend && lastKline.high >= pullbackEma && lastKline.close < pullbackEma;
    reasons.push(bullishPullback || bearishPullback ? '✅ Entry: Pullback to EMA' : '❌ Entry: No pullback');

    const rsiIsBullish = rsi > params.he_rsiMidline;
    const rsiIsBearish = rsi < params.he_rsiMidline;
    
    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');

    if (bullishPullback) {
        reasons.push(rsiIsBullish ? `✅ RSI > ${params.he_rsiMidline}` : `❌ RSI not bullish`);
        reasons.push(isObvBullish ? `✅ OBV Confirmed` : `❌ OBV not bullish`);
        if (rsiIsBullish && isObvBullish) return { signal: 'BUY', reasons };
    }

    if (bearishPullback) {
        reasons.push(rsiIsBearish ? `✅ RSI < ${params.he_rsiMidline}` : `❌ RSI not bearish`);
        reasons.push(isObvBearish ? `✅ OBV Confirmed` : `❌ OBV not bearish`);
        if (rsiIsBearish && isObvBearish) return { signal: 'SELL', reasons };
    }
    
    return { signal: 'HOLD', reasons };
};
