// services/agents/sentinel.ts

import { Kline, BotConfig, MarketDataContext, TradeSignal, SentinelAnalysis, ADXOutput, BollingerBandsOutput } from '../../types';
import { EMA, RSI, ADX, BollingerBands, ATR, SMA } from 'technicalindicators';
import { getLast, detectRsiDivergence } from './agentUtils';

export const getTheSentinelSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<typeof config.agentParams>;
    const minKlines = Math.max(200, params.sentinel_emaSlowPeriod!);
    if (klines.length < minKlines) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for The Sentinel (${klines.length}/${minKlines} candles).`] };
    }

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const currentPrice = getLast(closes)!;
    const reasons: string[] = [];

    // --- 1. INDICATOR CALCULATIONS ---
    const atr = getLast(ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }))! as number;
    const emaFast = getLast(EMA.calculate({ period: params.sentinel_emaFastPeriod!, values: closes }))! as number;
    const emaSlow = getLast(EMA.calculate({ period: params.sentinel_emaSlowPeriod!, values: closes }))! as number;
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.sentinel_adxPeriod! }))! as ADXOutput;
    const bbValues = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    const bb = getLast(bbValues)! as BollingerBandsOutput;
    const rsiValues = RSI.calculate({ values: closes, period: params.sentinel_rsiPeriod! });
    const rsi = getLast(rsiValues)! as number;

    // --- 2. DYNAMIC VETO CHECKS ---

    // Veto 1: Price is over-extended from its EMA baseline
    const emaDistance = Math.abs(currentPrice - emaSlow);
    const emaDistanceThreshold = atr * params.sentinel_emaDistanceAtrMultiplier!;
    if (emaDistance > emaDistanceThreshold) {
        return { signal: 'HOLD', reasons: [`❌ VETO: Price over-extended from baseline EMA (Dist: ${emaDistance.toFixed(2)} > Veto: ${emaDistanceThreshold.toFixed(2)})`] };
    }
    reasons.push(`✅ EMA Distance: OK`);

    // Veto 2: Volatility is too low (squeeze)
    const bbWidths = bbValues.map(b => (b.upper - b.lower) / b.middle);
    const lastBbWidth = getLast(bbWidths)!;
    const dynamicBbwThreshold = (atr / currentPrice) * params.sentinel_bbwAtrFactor!;
    if (lastBbWidth < dynamicBbwThreshold) {
        return { signal: 'HOLD', reasons: [`ℹ️ Standby: Low volatility squeeze (BBW: ${lastBbWidth.toFixed(4)} < Threshold: ${dynamicBbwThreshold.toFixed(4)})`] };
    }
    reasons.push(`✅ Volatility: OK`);


    // --- 3. WEIGHTED SCORING SYSTEM ---
    let bullishScore = 0;
    let bearishScore = 0;
    const analysisBreakdown = {
        bullish: { trend: 0, momentum: 0, confirmation: 0 },
        bearish: { trend: 0, momentum: 0, confirmation: 0 }
    };
    // Fix: Correctly destructure sentinel_scoreThreshold from params
    const { sentinel_scoreThreshold: scoreThreshold } = params;

    // Pillar A: Trend (Max 70 points = 40 ADX + 30 EMA)
    const ADX_WEIGHT = 40;
    const EMA_WEIGHT = 30;
    if (adx.adx > 22) {
        if (adx.pdi > adx.mdi) {
            bullishScore += ADX_WEIGHT;
            analysisBreakdown.bullish.trend += ADX_WEIGHT;
        } else {
            bearishScore += ADX_WEIGHT;
            analysisBreakdown.bearish.trend += ADX_WEIGHT;
        }
    }
    if (emaFast > emaSlow) {
        bullishScore += EMA_WEIGHT;
        analysisBreakdown.bullish.trend += EMA_WEIGHT;
    } else {
        bearishScore += EMA_WEIGHT;
        analysisBreakdown.bearish.trend += EMA_WEIGHT;
    }

    // Pillar B: Confirmation (Max 20 points - BBW Squeeze Breakout)
    const BBW_WEIGHT = 20;
    const bbwSma = getLast(SMA.calculate({ period: 20, values: bbWidths }))!;
    if (lastBbWidth > bbwSma * 1.2) { // Is expanding
        if (currentPrice > bb.upper) {
            bullishScore += BBW_WEIGHT;
            analysisBreakdown.bullish.confirmation += BBW_WEIGHT;
        } else if (currentPrice < bb.lower) {
            bearishScore += BBW_WEIGHT;
            analysisBreakdown.bearish.confirmation += BBW_WEIGHT;
        }
    }

    // Pillar C: Momentum (Max 10 points - RSI supportive & not divergent)
    const RSI_WEIGHT = 10;
    const hasBearishDivergence = detectRsiDivergence(klines, rsiValues, 'LONG', params.sentinel_rsiDivergenceLookback!);
    const hasBullishDivergence = detectRsiDivergence(klines, rsiValues, 'SHORT', params.sentinel_rsiDivergenceLookback!);

    if (rsi > 50 && !hasBearishDivergence) {
        bullishScore += RSI_WEIGHT;
        analysisBreakdown.bullish.momentum += RSI_WEIGHT;
    } else if (hasBearishDivergence) {
        reasons.push('❌ Momentum: Bearish RSI Divergence detected.');
    }
    
    if (rsi < 50 && !hasBullishDivergence) {
        bearishScore += RSI_WEIGHT;
        analysisBreakdown.bearish.momentum += RSI_WEIGHT;
    } else if (hasBullishDivergence) {
        reasons.push('❌ Momentum: Bullish RSI Divergence detected.');
    }

    // --- 4. FINAL DECISION ---
    reasons.push(`ℹ️ Final Score: Bull ${bullishScore.toFixed(0)} vs Bear ${bearishScore.toFixed(0)} (Threshold: ${scoreThreshold})`);
    
    const sentinelAnalysis: SentinelAnalysis = {
        bullish: { total: bullishScore, ...analysisBreakdown.bullish },
        bearish: { total: bearishScore, ...analysisBreakdown.bearish }
    };

    if (config.isHtfConfirmationEnabled && htfContext?.htf_trend) {
        reasons.push(`ℹ️ HTF Trend is ${htfContext.htf_trend}.`);
        if (htfContext.htf_trend === 'bearish' && bullishScore > bearishScore) {
            return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Signal contradicts bearish HTF trend.`], sentinelAnalysis };
        }
        if (htfContext.htf_trend === 'bullish' && bearishScore > bullishScore) {
            return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Signal contradicts bullish HTF trend.`], sentinelAnalysis };
        }
    }

    if (bullishScore >= scoreThreshold && bullishScore > bearishScore) {
        reasons.unshift(`✅ Bullish conviction threshold met.`);
        return { signal: 'BUY', reasons, sentinelAnalysis };
    }
    
    if (bearishScore >= scoreThreshold && bearishScore > bullishScore) {
        reasons.unshift(`✅ Bearish conviction threshold met.`);
        return { signal: 'SELL', reasons, sentinelAnalysis };
    }
    
    return { signal: 'HOLD', reasons, sentinelAnalysis };
};
