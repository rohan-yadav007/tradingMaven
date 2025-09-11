// services/agents/ichimokuTrendRider.ts

import { Kline, BotConfig, MarketDataContext, TradeSignal, IchimokuCloudOutput } from '../../types';
import { IchimokuCloud, OBV } from 'technicalindicators';
import { getLast, getPenultimate, isObvTrending, VortexIndicator } from './agentUtils';

export const getIchimokuTrendRiderSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<typeof config.agentParams>;
    const minKlines = params.ichi_basePeriod + params.ichi_displacement;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data (${klines.length}/${minKlines}).`] };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes) as number | undefined;
    const prevPrice = getPenultimate(closes) as number | undefined;
    let reasons: string[] = [];

    const ichi_params = { high: highs, low: lows, conversionPeriod: params.ichi_conversionPeriod, basePeriod: params.ichi_basePeriod, spanPeriod: params.ichi_laggingSpanPeriod, displacement: params.ichi_displacement };
    const ichiValues = IchimokuCloud.calculate(ichi_params);
    const lastIchi = getLast(ichiValues) as IchimokuCloudOutput | undefined;
    const prevIchi = getPenultimate(ichiValues) as IchimokuCloudOutput | undefined;
    
    if (!currentPrice || !prevPrice || !lastIchi || !prevIchi || !lastIchi.spanA || !lastIchi.spanB || !prevIchi.spanA || !prevIchi.spanB) {
        return { signal: 'HOLD', reasons: ['ℹ️ Ichimoku Cloud not yet formed.'] };
    }
    
    const isPriceAboveKumo = currentPrice > lastIchi.spanA && currentPrice > lastIchi.spanB;
    const isPriceBelowKumo = currentPrice < lastIchi.spanA && currentPrice < lastIchi.spanB;
    const bullishTkCross = prevIchi.conversion < prevIchi.base && lastIchi.conversion > lastIchi.base;
    const bearishTkCross = prevIchi.conversion > prevIchi.base && lastIchi.conversion < lastIchi.base;

    const vi = VortexIndicator.calculate({ high: highs, low: lows, close: closes, period: params.viPeriod });
    const lastViPdi = getLast(vi.pdi);
    const lastViNdi = getLast(vi.ndi);

    if (lastViPdi === undefined || lastViNdi === undefined) return { signal: 'HOLD', reasons: ['ℹ️ VI data unavailable.'] };
    
    const isViBullish = lastViPdi > lastViNdi;
    const isViBearish = lastViNdi > lastViPdi;
    const obv = OBV.calculate({ close: closes, volume: volumes });
    const isObvBullish = isObvTrending(obv, 'bullish');
    const isObvBearish = isObvTrending(obv, 'bearish');
    
    // Pullback Entry Logic
    if (isPriceAboveKumo && bullishTkCross) {
        reasons.push(`✅ Entry Type: Pullback (TK Cross)`);
        reasons.push(isViBullish ? `✅ VI Confirmed` : `❌ VI Not Bullish`);
        reasons.push(isObvBullish ? `✅ OBV Confirmed` : `❌ OBV Not Bullish`);
        if (isViBullish && isObvBullish) return { signal: 'BUY', reasons };
    }
    if (isPriceBelowKumo && bearishTkCross) {
        reasons.push(`✅ Entry Type: Pullback (TK Cross)`);
        reasons.push(isViBearish ? `✅ VI Confirmed` : `❌ VI Not Bearish`);
        reasons.push(isObvBearish ? `✅ OBV Confirmed` : `❌ OBV Not Bearish`);
        if (isViBearish && isObvBearish) return { signal: 'SELL', reasons };
    }

    // Breakout Entry Logic (if pullback fails)
    reasons = []; // Reset reasons for breakout logic
    const isBullishKumo = lastIchi.spanA > lastIchi.spanB;
    const prevCloudTop = Math.max(prevIchi.spanA, prevIchi.spanB);
    const lastCloudTop = Math.max(lastIchi.spanA, lastIchi.spanB);
    const bullishBreakout = prevPrice < prevCloudTop && currentPrice > lastCloudTop;
    const chikouPriceTargetIndex = klines.length - 1 - params.ichi_displacement;

    if (bullishBreakout && chikouPriceTargetIndex >= 0) {
        const chikouIsBullish = currentPrice > closes[chikouPriceTargetIndex];
        reasons.push(`✅ Entry Type: Kumo Breakout`);
        reasons.push(chikouIsBullish ? `✅ Lagging Span Confirmed` : `❌ Lagging Span`);
        reasons.push(isViBullish ? `✅ VI Confirmed` : `❌ VI Not Bullish`);
        reasons.push(isObvBullish ? `✅ OBV Confirmed` : `❌ OBV Not Bullish`);
        if (chikouIsBullish && isBullishKumo && isViBullish && isObvBullish) return { signal: 'BUY', reasons };
    }
    
    const prevCloudBottom = Math.min(prevIchi.spanA, prevIchi.spanB);
    const lastCloudBottom = Math.min(lastIchi.spanA, lastIchi.spanB);
    const bearishBreakout = prevPrice > prevCloudBottom && currentPrice < lastCloudBottom;
     if (bearishBreakout && chikouPriceTargetIndex >= 0) {
        const chikouIsBearish = currentPrice < closes[chikouPriceTargetIndex];
        reasons.push(`✅ Entry Type: Kumo Breakout`);
        reasons.push(chikouIsBearish ? `✅ Lagging Span Confirmed` : `❌ Lagging Span`);
        reasons.push(isViBearish ? `✅ VI Confirmed` : `❌ VI Not Bearish`);
        reasons.push(isObvBearish ? `✅ OBV Confirmed` : `❌ OBV Not Bearish`);
        if (chikouIsBearish && !isBullishKumo && isViBearish && isObvBearish) return { signal: 'SELL', reasons };
    }
    
    return { signal: 'HOLD', reasons: ['ℹ️ No valid Ichimoku signal.'] };
};
