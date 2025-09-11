// services/agents/quantumScalper.ts

import { Kline, BotConfig, MarketDataContext, TradeSignal, ADXOutput, BollingerBandsOutput, StochasticRSIOutput, MACDOutput } from '../../types';
import { ADX, BollingerBands, StochasticRSI, RSI, MACD } from 'technicalindicators';
import { getLast } from './agentUtils';

export const getQuantumScalperSignal = (klines: Kline[], config: BotConfig, htfContext?: MarketDataContext): TradeSignal => {
    const params = config.agentParams as Required<typeof config.agentParams>;
    const minKlines = 50;
    if (klines.length < minKlines) return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data (${klines.length}/${minKlines})`] };
    
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const closes = klines.map(k => k.close);
    let reasons: string[] = [];

    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: params.adxPeriod })) as ADXOutput | undefined;
    const bbValues = BollingerBands.calculate({ period: params.qsc_bbPeriod, stdDev: params.qsc_bbStdDev, values: closes });
    const bb = getLast(bbValues) as BollingerBandsOutput | undefined;
    const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;
    
    if (!adx || !bb || !stochRsi) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient data for core indicators.`] };
    }
    
    const bbWidth = (bb.upper - bb.lower) / bb.middle;
    if (bbWidth < params.qsc_bbwSqueezeThreshold) {
        return { signal: 'HOLD', reasons: [`ℹ️ Standby: Low volatility squeeze detected (BBW: ${bbWidth.toFixed(4)})`] };
    }
    
    const isTrending = !config.isAdxFilterEnabled || adx.adx > params.qsc_adxThreshold;
    
    if (isTrending) {
        if (config.isAdxFilterEnabled) {
            reasons.push(`ℹ️ Regime: Trending (ADX ${adx.adx.toFixed(1)})`);
        } else {
            reasons.push('ℹ️ Regime: Trending (ADX Filter Disabled)');
        }
        let bullScore = 0;
        let bearScore = 0;
        
        // --- TREND SCORING (Max 40) ---
        if (adx.pdi > adx.mdi) { bullScore += 25; reasons.push(`✅ Trend: Bullish DI`); }
        else if (adx.mdi > adx.pdi) { bearScore += 25; reasons.push(`✅ Trend: Bearish DI`); }
        if (config.isHtfConfirmationEnabled && htfContext?.htf_trend) {
            if (htfContext.htf_trend === 'bullish') { bullScore += 15; reasons.push(`✅ HTF Trend: Confirmed Bullish`); }
            if (htfContext.htf_trend === 'bearish') { bearScore += 15; reasons.push(`✅ HTF Trend: Confirmed Bearish`); }
        } else {
            bullScore += 5; bearScore += 5;
        }

        // --- MOMENTUM SCORING (Max 40) ---
        const rsiValues = RSI.calculate({ period: 14, values: closes });
        const lastRsi = getLast(rsiValues) as number | undefined;
        if (!lastRsi) return { signal: 'HOLD', reasons: ['ℹ️ Cannot calculate RSI for momentum.'] };
        
        const rsiSellThreshold = 100 - params.qsc_rsiMomentumThreshold;
        if (lastRsi > params.qsc_rsiMomentumThreshold) {
            bullScore += 20; reasons.push(`✅ Momentum: Breakout Buy (RSI > ${params.qsc_rsiMomentumThreshold})`);
        } else if (lastRsi < rsiSellThreshold) {
            bearScore += 20; reasons.push(`✅ Momentum: Breakout Sell (RSI < ${rsiSellThreshold})`);
        }
        
        if (stochRsi.k > stochRsi.d && stochRsi.k > 50) { bullScore += 20; reasons.push(`✅ Momentum: StochRSI Bullish`); }
        else if (stochRsi.k < stochRsi.d && stochRsi.k < 50) { bearScore += 20; reasons.push(`✅ Momentum: StochRSI Bearish`); }
        else if (stochRsi.k < stochRsi.d && stochRsi.k > 50) { bullScore -= 15; reasons.push(`❌ Momentum: StochRSI Bearish Crossover`); }
        else if (stochRsi.k > stochRsi.d && stochRsi.k < 50) { bearScore -= 15; reasons.push(`❌ Momentum: StochRSI Bullish Crossover`); }
        
        // --- CONFIRMATION SCORING (Max 20) ---
        const macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false })) as MACDOutput | undefined;
        if (!macd || macd.histogram === undefined) return { signal: 'HOLD', reasons: ['ℹ️ Cannot calculate MACD for confirmation.'] };

        if (macd.histogram > 0) {
            bullScore += 10; reasons.push(`✅ Confirmation: MACD Bullish`);
            bearScore -= 10;
        } else if (macd.histogram < 0) {
            bearScore += 10; reasons.push(`✅ Confirmation: MACD Bearish`);
            bullScore -= 10;
        }

        if (bb.pb > 0.55) { bullScore += 10; reasons.push(`✅ Confirmation: Price in Upper BB`); }
        else if (bb.pb < 0.45) { bearScore += 10; reasons.push(`✅ Confirmation: Price in Lower BB`); }
        
        reasons.push(`ℹ️ Score: Bull ${bullScore} vs Bear ${bearScore}`);

        if (bullScore >= params.qsc_trendScoreThreshold && bullScore > bearScore) {
            return { signal: 'BUY', reasons };
        }
        if (bearScore >= params.qsc_trendScoreThreshold && bearScore > bullScore) {
            return { signal: 'SELL', reasons };
        }
        
        if (bullScore > bearScore) {
            reasons.push(`❌ Conviction: Bullish score of ${bullScore} did not meet threshold of ${params.qsc_trendScoreThreshold}.`);
        } else if (bearScore > bullScore) {
            reasons.push(`❌ Conviction: Bearish score of ${bearScore} did not meet threshold of ${params.qsc_trendScoreThreshold}.`);
        } else {
            reasons.push(`ℹ️ Conviction: Scores are tied or too low to enter.`);
        }
        
        return { signal: 'HOLD', reasons };

    } else { // Ranging / Mean Reversion Logic
        reasons.push(`ℹ️ Regime: Ranging (ADX ${adx.adx.toFixed(1)})`);

        const isAtLowerBB = closes[closes.length-1] <= bb.lower;
        const isAtUpperBB = closes[closes.length-1] >= bb.upper;
        const isStochOversoldBullish = stochRsi.k < params.qsc_stochRsiOversold && stochRsi.k > stochRsi.d;
        const isStochOverboughtBearish = stochRsi.k > params.qsc_stochRsiOverbought && stochRsi.k < stochRsi.d;

        if (isAtLowerBB) {
            reasons.push(`✅ Pattern: Price is at lower BB extreme.`);
            if (isStochOversoldBullish) {
                reasons.push(`✅ Confirmation: StochRSI is oversold & crossing up.`);
                return { signal: 'BUY', reasons };
            } else {
                reasons.push(`❌ Confirmation: StochRSI is not oversold or not crossing up.`);
            }
        }

        if (isAtUpperBB) {
            reasons.push(`✅ Pattern: Price is at upper BB extreme.`);
            if (isStochOverboughtBearish) {
                reasons.push(`✅ Confirmation: StochRSI is overbought & crossing down.`);
                return { signal: 'SELL', reasons };
            } else {
                reasons.push(`❌ Confirmation: StochRSI is not overbought or not crossing down.`);
            }
        }
        
        if (!isAtLowerBB && !isAtUpperBB) {
            reasons.push(`ℹ️ Standby: Price is not at Bollinger Band extremes for a reversal.`);
        }
        
        return { signal: 'HOLD', reasons };
    }
};
