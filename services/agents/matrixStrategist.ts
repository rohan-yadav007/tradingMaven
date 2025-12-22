
// services/agents/matrixStrategist.ts

import { Kline, BotConfig, TradeSignal, AgentParams, ADXOutput, BollingerBandsOutput, StochasticRSIOutput, MACDOutput, IchimokuCloudOutput } from '../../types';
import { RSI, EMA, BollingerBands, MACD, StochasticRSI, ADX, SMA, IchimokuCloud, ATR, OBV } from 'technicalindicators';
// FIX: Added isObvTrending to imports
import { getLast, getPenultimate, calculateRVOL, calculateDailyVwap, calculateValueArea, calculatePivotPoints, calculateFibLevels, isObvTrending } from './agentUtils';
import { calculateSupportResistance, findSwingPoints, analyzeMarketStructure } from '../chartAnalysisService';

export const getMatrixStrategistSignal = (
    klines: Kline[], 
    config: BotConfig,
    klinesMap?: Map<string, Kline[]> // Ensure access to 4H/1D for confluence
): TradeSignal => {
    const timeframe = config.timeFrame;
    const params = config.agentParams as Required<AgentParams>;
    const reasons: string[] = [];

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume || 0);
    const currentPrice = getLast(closes)!;
    const rsiValues = RSI.calculate({ period: params.ms_1m_rsiPeriod || 14, values: closes });
    const lastRsi = getLast(rsiValues)!;

    // --- 1. GLOBAL MULTI-TIMEFRAME OVERRIDE ---
    // Rule: Rejection Rules: Contradicting 1D trend = no trade regardless of lower signals
    let tide: 'Bullish' | 'Bearish' | 'Neutral' = 'Neutral';
    const d1Klines = klinesMap?.get('1d');
    if (d1Klines && d1Klines.length >= 200) {
        const d1Closes = d1Klines.map(k => k.close);
        const d1Ema200 = getLast(EMA.calculate({ period: 200, values: d1Closes }));
        if (d1Ema200) {
            tide = getLast(d1Closes)! > d1Ema200 ? 'Bullish' : 'Bearish';
            reasons.push(`ℹ️ Macro Tide (1D): ${tide}`);
        }
    }

    // --- 2. SIGNAL REVERSAL / NEUTRAL CONDITIONS ---
    // Rule: Long to Neutral: RSI > 80 OR price below specific EMAs
    const ema9 = getLast(EMA.calculate({ period: 9, values: closes }));
    if (lastRsi > 80) reasons.push('ℹ️ Warning: Over-extended momentum (RSI > 80).');

    // --- 3. MARKET REGIME ADAPTATION ---
    const adx = getLast(ADX.calculate({ high: highs, low: lows, close: closes, period: 14 })) as ADXOutput;
    const regime = adx?.adx > 25 ? 'Trending' : adx?.adx < 20 ? 'Ranging' : 'Indeterminate';
    reasons.push(`ℹ️ Regime: ${regime} (ADX: ${adx?.adx.toFixed(1)})`);

    // --- 4. LOGIC ROUTER ---
    switch (timeframe) {
        case '1m': {
            // SCALPING STRATEGY
            const ema9 = getLast(EMA.calculate({ period: 9, values: closes }));
            const ema21 = getLast(EMA.calculate({ period: 21, values: closes }));
            const rsi7 = getLast(RSI.calculate({ period: 7, values: closes }));
            const bb = getLast(BollingerBands.calculate({ period: 20, stdDev: 1.5, values: closes })) as BollingerBandsOutput;
            const rvol = calculateRVOL(klines, 20);

            if (!ema9 || !ema21 || !rsi7 || !bb) return { signal: 'HOLD', reasons: ['ℹ️ Scalping indicators warming up...'] };

            const isLong = currentPrice > ema9 && ema9 > ema21 && rsi7 > 30 && rvol > 2.0 && currentPrice > bb.middle;
            const isShort = currentPrice < ema9 && ema9 < ema21 && rsi7 < 70 && rvol > 2.0 && currentPrice < bb.middle;

            if (isLong && tide !== 'Bearish') {
                reasons.push('✅ Setup: 1m Bullish Scalp (EMA Stack + Vol Spike + BB Middle)');
                return { signal: 'BUY', reasons, tradeType: 'scalp' };
            }
            if (isShort && tide !== 'Bullish') {
                reasons.push('✅ Setup: 1m Bearish Scalp (EMA Stack + Vol Spike + BB Middle)');
                return { signal: 'SELL', reasons, tradeType: 'scalp' };
            }
            break;
        }

        case '3m': {
            // MOMENTUM STRATEGY
            const ema12 = getLast(EMA.calculate({ period: 12, values: closes }));
            const ema26 = getLast(EMA.calculate({ period: 26, values: closes }));
            // FIX: Added missing SimpleMAOscillator and SimpleMASignal for MACD.calculate
            const macd = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false })) as MACDOutput;
            const vwap = getLast(calculateDailyVwap(klines));

            if (!ema12 || !ema26 || !macd?.histogram || !vwap) return { signal: 'HOLD', reasons };

            const rsiRising = lastRsi > 45 && lastRsi > (getPenultimate(rsiValues) || 0);
            const rsiFalling = lastRsi < 55 && lastRsi < (getPenultimate(rsiValues) || 100);

            if (ema12 > ema26 && macd.histogram > 0 && rsiRising && currentPrice > vwap) {
                reasons.push('✅ Setup: 3m Momentum (Golden Cross + MACD + VWAP)');
                return { signal: 'BUY', reasons };
            }
            if (ema12 < ema26 && macd.histogram < 0 && rsiFalling && currentPrice < vwap) {
                reasons.push('✅ Setup: 3m Momentum (Death Cross + MACD + VWAP)');
                return { signal: 'SELL', reasons };
            }
            break;
        }

        case '5m': {
            // SWING STRATEGY
            const ema20 = getLast(EMA.calculate({ period: 20, values: closes }));
            const ema50 = getLast(EMA.calculate({ period: 50, values: closes }));
            const bb = getLast(BollingerBands.calculate({ period: 20, stdDev: 2, values: closes })) as BollingerBandsOutput;
            const bbw = (bb.upper - bb.lower) / bb.middle;

            if (!ema20 || !ema50 || !adx) return { signal: 'HOLD', reasons };

            const trending = adx.adx > 25;
            const pullbackLong = currentPrice > ema20 && ema20 > ema50 && Math.abs(currentPrice - ema20) / ema20 < 0.002;
            const pullbackShort = currentPrice < ema20 && ema20 < ema50 && Math.abs(currentPrice - ema20) / ema20 < 0.002;

            if (trending && lastRsi > 40 && pullbackLong && bbw < 0.02) {
                reasons.push('✅ Setup: 5m Swing (EMA Pullback + ADX + BB Squeeze)');
                return { signal: 'BUY', reasons };
            }
            if (trending && lastRsi < 60 && pullbackShort && bbw < 0.02) {
                reasons.push('✅ Setup: 5m Swing (EMA Pullback + ADX + BB Squeeze)');
                return { signal: 'SELL', reasons };
            }
            break;
        }

        case '15m': {
            // TREND STRATEGY
            const ema50 = getLast(EMA.calculate({ period: 50, values: closes }));
            const ema100 = getLast(EMA.calculate({ period: 100, values: closes }));
            const ema200 = getLast(EMA.calculate({ period: 200, values: closes }));
            const stoch = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 }));
            
            if (!ema50 || !ema100 || !ema200 || !stoch) return { signal: 'HOLD', reasons };

            const emaAlignedLong = ema50 > ema100 && ema100 > ema200;
            const emaAlignedShort = ema50 < ema100 && ema100 < ema200;

            if (emaAlignedLong && stoch.k < 20 && stoch.k > stoch.d && currentPrice >= ema50) {
                reasons.push('✅ Setup: 15m Trend (Alignment + Stoch Oversold + EMA 50 Support)');
                return { signal: 'BUY', reasons };
            }
            if (emaAlignedShort && stoch.k > 80 && stoch.k < stoch.d && currentPrice <= ema50) {
                reasons.push('✅ Setup: 15m Trend (Alignment + Stoch Overbought + EMA 50 Resistance)');
                return { signal: 'SELL', reasons };
            }
            break;
        }

        case '30m': {
            // POSITION STRATEGY
            const ichi = getLast(IchimokuCloud.calculate({ conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26, high: highs, low: lows }));
            const va = calculateValueArea(klines);

            if (!ichi || !va) return { signal: 'HOLD', reasons };

            if (currentPrice > ichi.spanA && ichi.conversion > ichi.base && currentPrice < va.val && lastRsi > 50) {
                reasons.push('✅ Setup: 30m Position (Cloud + VAL Support + RSI)');
                return { signal: 'BUY', reasons };
            }
            if (currentPrice < ichi.spanA && ichi.conversion < ichi.base && currentPrice > va.vah && lastRsi < 50) {
                reasons.push('✅ Setup: 30m Position (Cloud + VAH Resistance + RSI)');
                return { signal: 'SELL', reasons };
            }
            break;
        }

        case '1h': {
            // DAILY DIRECTION STRATEGY
            // Simulating Weekly Pivot (simplified to last 7 days from 1H)
            if (klines.length < 168) return { signal: 'HOLD', reasons: ['ℹ️ Need 168h for Weekly Pivot simulation.'] };
            const lastWeek = klines.slice(-168);
            const wHigh = Math.max(...lastWeek.map(k => k.high));
            const wLow = Math.min(...lastWeek.map(k => k.low));
            const wClose = lastWeek[lastWeek.length-1].close;
            const pivots = calculatePivotPoints(wHigh, wLow, wClose);

            const structure = analyzeMarketStructure(findSwingPoints(klines, 12));

            if (currentPrice > pivots.pivot && structure.structure === 'Uptrend' && tide === 'Bullish') {
                reasons.push('✅ Setup: 1h Direction (Above Pivot + HH/HL + Macro Tide)');
                return { signal: 'BUY', reasons };
            }
            if (currentPrice < pivots.pivot && structure.structure === 'Downtrend' && tide === 'Bearish') {
                reasons.push('✅ Setup: 1h Direction (Below Pivot + LH/LL + Macro Tide)');
                return { signal: 'SELL', reasons };
            }
            break;
        }

        case '4h': {
            // SWING POSITION STRATEGY
            const fib = calculateFibLevels(Math.max(...highs), Math.min(...lows));
            const obv = OBV.calculate({ close: closes, volume: volumes });
            const adxStrong = adx?.adx > 30;

            // FIX: uses isObvTrending from agentUtils
            if (currentPrice > fib[0.618] && adxStrong && isObvTrending(obv, 'bullish')) {
                reasons.push('✅ Setup: 4h Swing (61.8% Fib Hold + Strong Trend + OBV)');
                return { signal: 'BUY', reasons };
            }
            if (currentPrice < fib[0.382] && adxStrong && isObvTrending(obv, 'bearish')) {
                reasons.push('✅ Setup: 4h Swing (38.2% Fib Rejection + Strong Trend + OBV)');
                return { signal: 'SELL', reasons };
            }
            break;
        }

        case '1d': {
            // MACRO INVESTMENT
            // FIX: Added missing SimpleMAOscillator and SimpleMASignal for MACD.calculate
            const macdWeekly = getLast(MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }));
            const rangingSideways = (Math.max(...closes.slice(-30)) - Math.min(...closes.slice(-30))) / currentPrice < 0.10;

            if (macdWeekly && macdWeekly.histogram! > 0 && rangingSideways) {
                reasons.push('✅ Setup: 1D Investment (Weekly MACD Cross + Side-ways Accumulation)');
                return { signal: 'BUY', reasons };
            }
            if (macdWeekly && macdWeekly.histogram! < 0 && rangingSideways) {
                reasons.push('✅ Setup: 1D Investment (Weekly MACD Cross + Side-ways Distribution)');
                return { signal: 'SELL', reasons };
            }
            break;
        }
    }

    return { signal: 'HOLD', reasons: [...reasons, 'No timeframe-specific matrix setup triggered.'] };
};