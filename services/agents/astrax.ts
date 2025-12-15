
// services/agents/astrax.ts

import { Kline, BotConfig, TradeSignal, AstraXAnalysis, AgentParams, ADXOutput, BollingerBandsOutput, StochasticRSIOutput, MACDOutput } from '../../types';
import { RSI, ATR, ADX, BollingerBands, SMA, EMA, StochasticRSI, MACD } from 'technicalindicators';
import { calculateDailyVwap, getLast, getPenultimate, detectLiquiditySweep, calculateRsiSlope, isPriceOverextended, detectVolatilityCompression, Supertrend, analyzeBitcoinState, calculateRVOL, detectRsiDivergence } from './agentUtils';
import { findSwingPoints, analyzeMarketStructure, calculateSupportResistance } from '../chartAnalysisService';

// Helper to determine the dominant trend using Higher Timeframe data
function getDominantTrend(htfKlines: Kline[] | undefined): 'Bullish' | 'Bearish' | 'Neutral' {
    if (!htfKlines || htfKlines.length < 50) return 'Neutral';
    
    // Upgrade: Use Market Structure Analysis instead of just EMA
    // Look back 15 candles on HTF (enough to see a trend)
    const swingPoints = findSwingPoints(htfKlines, 5);
    const structure = analyzeMarketStructure(swingPoints);
    
    if (structure.structure === 'Uptrend') return 'Bullish';
    if (structure.structure === 'Downtrend') return 'Bearish';
    
    // Fallback to EMA alignment if structure is ranging/indeterminate
    const closes = htfKlines.map(k => k.close);
    const ema50 = getLast(EMA.calculate({ period: 50, values: closes }));
    const ema200 = getLast(EMA.calculate({ period: 200, values: closes }));
    const lastClose = getLast(closes);

    if (ema50 && ema200 && lastClose) {
        if (lastClose > ema50 && ema50 > ema200) return 'Bullish';
        if (lastClose < ema50 && ema50 < ema200) return 'Bearish';
    }
    return 'Neutral';
}

export const getConfluenceTimeframes = (primaryTf: string): string[] => {
    const mappings: Record<string, string[]> = {
        '1m':  ['5m'],  // Tightened from 15m to 5m for faster reaction
        '3m':  ['15m'],
        '5m':  ['15m'], // Tightened from 1h to 15m (3x ratio)
        '15m': ['1h'],  // Tightened from 4h to 1h (4x ratio)
        '30m': ['1h'],  // Tightened from 4h to 1h
        '1h':  ['4h'],  // Tightened from 1d to 4h (4x ratio)
        '4h':  ['1d'],
        '1d':  ['1d'] 
    };
    return mappings[primaryTf] || [primaryTf];
};

// Alias for backward compatibility
export const getLowerConfluenceTimeframes = getConfluenceTimeframes;

export function getAstraXRegimeAndDirection(
    config: BotConfig,
    klinesMap: Map<string, Kline[]>,
    analyticalTimeframes: string[],
): { regime: AstraXAnalysis['regime'], direction: 'bullish' | 'bearish' | 'neutral' } {
    // Lightweight regime check for external consumers (like BotManager)
    const primaryKlines = klinesMap.get(config.timeFrame);
    if (!primaryKlines) return { regime: 'Choppy Market', direction: 'neutral' };
    
    const params = config.agentParams || {};
    const adxPeriod = params.adxPeriod || 14;

    const closes = primaryKlines.map(k => k.close);
    const ema50 = getLast(EMA.calculate({ period: 50, values: closes }));
    const lastClose = getLast(closes);
    
    let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (ema50 && lastClose) {
        direction = lastClose > ema50 ? 'bullish' : 'bearish';
    }

    // Dynamic ADX Period
    const adx = getLast(ADX.calculate({ period: adxPeriod, high: primaryKlines.map(k=>k.high), low: primaryKlines.map(k=>k.low), close: closes })) as ADXOutput;
    let regime: AstraXAnalysis['regime'] = 'Choppy Market';
    if (adx && adx.adx > (config.agentParams?.astraX_adxThreshold || 25)) regime = 'Strong Trend';
    
    return { regime, direction };
}

export const getAstraXSignal = async (
    config: BotConfig, 
    klinesMap: Map<string, Kline[]>,
    immediateKlines?: Kline[], 
    livePrice?: number, 
    fundingRate?: number,
    ltfKlines?: Kline[],
    btcKlines?: Kline[] // Market Tide Input
): Promise<TradeSignal> => {
    const params = config.agentParams as Required<AgentParams>;
    const executionMode = params.astraX_executionMode || 'hybrid';
    const reasons: string[] = [];
    
    const adxPeriod = params.adxPeriod || 14;
    const atrPeriod = params.atrPeriod || 14;
    const rsiPeriod = params.rsiPeriod || 14;

    // 1. Data Preparation
    const primaryKlines = klinesMap.get(config.timeFrame);
    const htfTf = getConfluenceTimeframes(config.timeFrame)[0];
    const htfKlines = klinesMap.get(htfTf);

    if (!primaryKlines || primaryKlines.length < 100) {
        return { signal: 'HOLD', reasons: [`ℹ️ Insufficient primary TF data.`] };
    }

    // --- MARKET TIDE ANALYSIS (Bitcoin State) ---
    let btcState = { state: 'NEUTRAL', reason: 'BTC Data Unavailable' };
    if (btcKlines && btcKlines.length > 50) {
        btcState = analyzeBitcoinState(btcKlines);
    } else {
        reasons.push(`⚠️ Market Tide: BTC Data Unavailable (Defaulting to Neutral).`);
    }
    
    if (btcState.state !== 'NEUTRAL') {
         reasons.push(`ℹ️ Market Tide: ${btcState.reason}`);
    }

    // 2. The Thesis (Structural Flow)
    const dominantTrend = getDominantTrend(htfKlines);
    
    // Local Structure
    const sweepLookback = params.astraX_sweepLookback || 20;
    const structureLookback = Math.max(3, Math.floor(sweepLookback / 4));
    const localStructure = analyzeMarketStructure(findSwingPoints(primaryKlines, structureLookback));
    
    let bias: 'Bullish' | 'Bearish' | 'Neutral' = dominantTrend;
    
    // Strict Bias Rule: If HTF is Neutral, trust Local. If HTF conflicts with Local, Bias is Neutral (Stand aside).
    if (dominantTrend === 'Neutral') {
        if (localStructure.structure === 'Uptrend') bias = 'Bullish';
        if (localStructure.structure === 'Downtrend') bias = 'Bearish';
    } else if (dominantTrend === 'Bullish' && localStructure.structure === 'Downtrend') {
        bias = 'Neutral'; // Conflict
    } else if (dominantTrend === 'Bearish' && localStructure.structure === 'Uptrend') {
        bias = 'Neutral'; // Conflict
    }

    reasons.push(`ℹ️ Thesis: ${bias} (HTF: ${dominantTrend}, LTF: ${localStructure.structure})`);

    // 3. Market Condition Filters
    const closes = primaryKlines.map(k => k.close);
    const highs = primaryKlines.map(k => k.high);
    const lows = primaryKlines.map(k => k.low);
    const volumes = primaryKlines.map(k => k.volume || 0);

    const currentPriceVal = livePrice || getLast(closes)!;
    const ema50 = getLast(EMA.calculate({ period: 50, values: closes })) || 0;
    const atr = getLast(ATR.calculate({ period: atrPeriod, high: primaryKlines.map(k=>k.high), low: primaryKlines.map(k=>k.low), close: closes })) || 0;
    
    // Volume Velocity (RVOL) - Institutional Footprint Check
    const rvol = calculateRVOL(primaryKlines, 20);
    reasons.push(`ℹ️ Vol: RVOL ${rvol.toFixed(1)}x`);

    const isOverextended = isPriceOverextended(currentPriceVal, ema50, atr, 3.5); 
    const isCompressed = detectVolatilityCompression(primaryKlines, 20, 0.02);

    const adxValues = ADX.calculate({ period: adxPeriod, high: primaryKlines.map(k=>k.high), low: primaryKlines.map(k=>k.low), close: closes });
    const adx = getLast(adxValues) as ADXOutput;
    
    let regime: AstraXAnalysis['regime'] = 'Choppy Market';
    // Use configured threshold to define chop
    if (adx && adx.adx > params.astraX_adxThreshold!) {
        regime = adx.adx > 40 ? 'Strong Trend' : 'Developing Trend';
    }

    // MODE LOGIC 1: CHOP HANDLING
    // Scalp Mode is the ONLY mode allowed to trade in pure chop.
    // Hybrid and Conviction must stand aside.
    const allowChop = executionMode === 'scalp';
    if (regime === 'Choppy Market' && !allowChop) {
        return { signal: 'HOLD', reasons: [...reasons, `ℹ️ Regime: Choppy (ADX ${adx.adx.toFixed(1)}). Mode '${executionMode}' waits for trend.`], astraXAnalysis: { conviction: 0, regime, thesis: bias } };
    }
    
    // VWAP Band (Institutional Value)
    const vwapValues = calculateDailyVwap(primaryKlines);
    const vwap = getLast(vwapValues);
    const priceVsVwap = vwap ? (currentPriceVal > vwap ? 'Above' : 'Below') : 'Unknown';
    reasons.push(`ℹ️ VWAP: Price is ${priceVsVwap}`);

    // StochRSI & RSI for Timing
    const stochRsiValues = StochasticRSI.calculate({ values: closes, rsiPeriod: rsiPeriod, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 });
    const stochRsi = getLast(stochRsiValues) as StochasticRSIOutput | undefined;
    const prevStochRsi = getPenultimate(stochRsiValues) as StochasticRSIOutput | undefined;
    const rsiValues = RSI.calculate({ period: rsiPeriod, values: closes });
    const lastRsi = getLast(rsiValues);

    // Supertrend Armour
    const stPeriod = params.astraX_supertrendPeriod || 10;
    const stMult = params.astraX_supertrendMultiplier || 3.0;
    const stValues = Supertrend.calculate({ high: highs, low: lows, close: closes, period: stPeriod, multiplier: stMult });
    const currentSt = getLast(stValues);
    const isStBullish = currentSt !== undefined && currentPriceVal > currentSt;
    const isStBearish = currentSt !== undefined && currentPriceVal < currentSt;

    // --- SETUP SCANNING ENGINE (Priority Order) ---

    // === SETUP A: LIQUIDITY SWEEP (Mean Reversion / Counter-Trend) ===
    // This is the most dangerous setup, so Mode rules apply heavily here.
    const sweep = detectLiquiditySweep(primaryKlines, sweepLookback); 
    const sweepStopMultiplier = params.astraX_sl_multiplier_sweep || 1.2;
    
    if (sweep.bullish) {
        // Find the actual sweep level (the low that was broken)
        // detectLiquiditySweep looks back 'sweepLookback' candles.
        const relevantKlines = primaryKlines.slice(-(sweepLookback + 1), -1);
        const sweepLevel = Math.min(...relevantKlines.map(k => k.low));

        // MODE LOGIC 2: COUNTER-TREND RULES (LONG)
        // If Thesis is Bearish, this is a counter-trend trade.
        const isCounterTrend = bias === 'Bearish';
        
        // TIDE PROTECTION
        // Strict: If BTC is in a Downtrend or Crash, VETO all counter-trend Longs.
        const isBtcWeak = btcState.state === 'TREND_DOWN' || btcState.state === 'CRASH';

        let veto = false;
        let vetoReason = '';

        if (executionMode === 'conviction' && isCounterTrend) {
            veto = true; vetoReason = `❌ VETO (Conviction Mode): Counter-trend trades forbidden.`;
        } else if ((executionMode === 'hybrid' || executionMode === 'scalp') && isBtcWeak && isCounterTrend) {
             veto = true; vetoReason = `❌ VETO (${executionMode} Mode): Cannot go Long against BTC weakness (${btcState.state}).`;
        }

        if (veto) {
            reasons.push(vetoReason);
        } else {
            const hasDiv = detectRsiDivergence(primaryKlines, rsiValues, 'LONG', 14);
            const extremeVol = rvol > 2.0;
            // Hybrid Rule: Counter-trend requires DIVERGENCE (higher quality).
            // Scalp Rule: Just needs Vol or Div.
            const meetsCriteria = executionMode === 'hybrid' && isCounterTrend 
                ? hasDiv 
                : (hasDiv || extremeVol);

            if (!meetsCriteria) {
                 if (executionMode === 'hybrid') reasons.push(`❌ VETO (Hybrid Mode): Counter-trend requires RSI Divergence.`);
                 else reasons.push(`❌ VETO: Insufficient confirmation for sweep.`);
            } else {
                const candle = primaryKlines[primaryKlines.length - 1];
                // STRICTER VALIDATION: Must be a Hammer/Pinbar (Close in top 35% of range)
                const range = candle.high - candle.low;
                if (range > 0) {
                    const closePos = (candle.close - candle.low) / range;
                    if (closePos > 0.65) { // Strict Hammer (Top 35%)
                        const preciseSL = candle.low - (atr * sweepStopMultiplier); 
                        reasons.push(hasDiv ? `✅ Setup: Bullish Sweep + RSI Divergence` : `✅ Setup: Bullish Sweep + Extreme Volume`);
                        return { 
                            signal: 'BUY', reasons, stopLossPrice: preciseSL, tradeType: 'scalp',
                            invalidationPrice: sweepLevel, // CRITICAL: Store the sweep level for Guardian
                            btcContext: btcState as any,
                            astraXAnalysis: { conviction: hasDiv ? 90 : 80, regime, thesis: bias, setupName: 'Bullish Liquidity Reversal' }
                        };
                    } else {
                        reasons.push(`❌ VETO: Sweep candle shape invalid (not a hammer).`);
                    }
                }
            }
        }
    }
    
    if (sweep.bearish) {
        const relevantKlines = primaryKlines.slice(-(sweepLookback + 1), -1);
        const sweepLevel = Math.max(...relevantKlines.map(k => k.high));

        // MODE LOGIC 3: COUNTER-TREND RULES (SHORT)
        const isCounterTrend = bias === 'Bullish';
        // TIDE PROTECTION
        const isBtcStrong = btcState.state === 'TREND_UP' || btcState.state === 'PUMP';

        let veto = false;
        let vetoReason = '';

        if (executionMode === 'conviction' && isCounterTrend) {
             veto = true; vetoReason = `❌ VETO (Conviction Mode): Counter-trend trades forbidden.`;
        } else if ((executionMode === 'hybrid' || executionMode === 'scalp') && isBtcStrong && isCounterTrend) {
             veto = true; vetoReason = `❌ VETO (${executionMode} Mode): Cannot go Short against BTC strength (${btcState.state}).`;
        }

        if (veto) {
            reasons.push(vetoReason);
        } else {
            const hasDiv = detectRsiDivergence(primaryKlines, rsiValues, 'SHORT', 14);
            const extremeVol = rvol > 2.0;
            const meetsCriteria = executionMode === 'hybrid' && isCounterTrend 
                ? hasDiv 
                : (hasDiv || extremeVol);

            if (!meetsCriteria) {
                 if (executionMode === 'hybrid') reasons.push(`❌ VETO (Hybrid Mode): Counter-trend requires RSI Divergence.`);
                 else reasons.push(`❌ VETO: Insufficient confirmation for sweep.`);
            } else {
                const candle = primaryKlines[primaryKlines.length - 1];
                const range = candle.high - candle.low;
                if (range > 0) {
                    const closePos = (candle.close - candle.low) / range;
                    if (closePos < 0.35) { // Strict Shooting Star (Bottom 35%)
                        const preciseSL = candle.high + (atr * sweepStopMultiplier);
                        reasons.push(hasDiv ? `✅ Setup: Bearish Sweep + RSI Divergence` : `✅ Setup: Bearish Sweep + Extreme Volume`);
                        return { 
                            signal: 'SELL', reasons, stopLossPrice: preciseSL, tradeType: 'scalp',
                            invalidationPrice: sweepLevel, // CRITICAL: Store the sweep level for Guardian
                            btcContext: btcState as any,
                            astraXAnalysis: { conviction: hasDiv ? 90 : 80, regime, thesis: bias, setupName: 'Bearish Liquidity Reversal' }
                        };
                    } else {
                        reasons.push(`❌ VETO: Sweep candle shape invalid (not a shooting star).`);
                    }
                }
            }
        }
    }

    // === SETUP B: MOMENTUM BREAKOUT (Expansion) ===
    // Breakouts are inherently trend-following.
    // They are valid in all modes (assuming chop filter passed for Conviction/Hybrid)
    if (!isOverextended && !isCompressed && regime !== 'Choppy Market') {
        const breakoutStopMultiplier = params.astraX_sl_multiplier_breakout || 1.5; // Tighter stop for breakouts
        const requiredVolMult = params.astraX_breakoutVolMultiplier || 2.0;
        const isHighVolume = rvol >= requiredVolMult;

        // Bullish Breakout
        if (bias === 'Bullish' && isStBullish) {
            // Find recent local high
            const recentHighs = primaryKlines.slice(-10, -1).map(k => k.high);
            const resistance = Math.max(...recentHighs);
            
            // Breakout Condition: Price > Resistance AND High Volume
            if (currentPriceVal > resistance && isHighVolume) {
                // Check RSI Exhaustion (Don't buy if already overbought)
                if (lastRsi && lastRsi > 75) {
                    reasons.push(`❌ VETO: Bullish Breakout exhausted (RSI > 75).`);
                } else if (vwap && currentPriceVal < vwap) {
                    reasons.push(`❌ VETO: Bullish Breakout below VWAP.`);
                } else if (btcState.state === 'TREND_DOWN' || btcState.state === 'CRASH') {
                    reasons.push(`❌ VETO: BTC is weak.`);
                } else {
                    const preciseSL = resistance - (atr * breakoutStopMultiplier); 
                    reasons.push(`✅ Setup: Bullish Breakout (Vol: ${rvol.toFixed(1)}x)`);
                    return {
                        signal: 'BUY', reasons, stopLossPrice: preciseSL, tradeType: 'conviction',
                        btcContext: btcState as any,
                        astraXAnalysis: { conviction: 85, regime, thesis: bias, setupName: 'Bullish Breakout' }
                    };
                }
            }
        }
        
        // Bearish Breakout
        if (bias === 'Bearish' && isStBearish) {
            const recentLows = primaryKlines.slice(-10, -1).map(k => k.low);
            const support = Math.min(...recentLows);
            
            if (currentPriceVal < support && isHighVolume) {
                // Check RSI Exhaustion
                if (lastRsi && lastRsi < 25) {
                    reasons.push(`❌ VETO: Bearish Breakout exhausted (RSI < 25).`);
                } else if (vwap && currentPriceVal > vwap) {
                    reasons.push(`❌ VETO: Bearish Breakout above VWAP.`);
                } else if (btcState.state === 'TREND_UP' || btcState.state === 'PUMP') {
                    reasons.push(`❌ VETO: BTC is strong.`);
                } else {
                    const preciseSL = support + (atr * breakoutStopMultiplier);
                    reasons.push(`✅ Setup: Bearish Breakout (Vol: ${rvol.toFixed(1)}x)`);
                    return {
                        signal: 'SELL', reasons, stopLossPrice: preciseSL, tradeType: 'conviction',
                        btcContext: btcState as any,
                        astraXAnalysis: { conviction: 85, regime, thesis: bias, setupName: 'Bearish Breakout' }
                    };
                }
            }
        }
    }

    // === SETUP C: VWAP PULLBACK (Trend Continuation) ===
    // Buying the dip in a strong trend. Valid in all modes.
    const pullbackStopMultiplier = params.astraX_sl_multiplier_pullback || 1.5;
    
    if (bias === 'Bullish' && regime === 'Strong Trend' && vwap) {
        // Price pulled back to near VWAP (within 0.5% or 1 ATR)
        const distToVwap = Math.abs(currentPriceVal - vwap);
        const nearVwap = distToVwap < (atr * 1.0);
        const aboveVwap = currentPriceVal >= vwap * 0.998; // Allow slight wick below
        
        if (nearVwap && aboveVwap) {
            // Trigger: StochRSI Hook from Oversold
            const isStochHook = stochRsi && prevStochRsi && (stochRsi.k > stochRsi.d) && (prevStochRsi.k <= prevStochRsi.d) && (stochRsi.k < 40);
            
            if (isStochHook) {
                if (btcState.state === 'CRASH') {
                    reasons.push(`❌ VETO: Pullback rejected (BTC Crash).`);
                } else {
                    const preciseSL = vwap - (atr * pullbackStopMultiplier);
                    reasons.push(`✅ Setup: Bullish VWAP Pullback + Stoch Hook.`);
                    return {
                        signal: 'BUY', reasons, stopLossPrice: preciseSL, tradeType: 'conviction',
                        btcContext: btcState as any,
                        astraXAnalysis: { conviction: 80, regime, thesis: bias, setupName: `Bullish VWAP Pullback` }
                    };
                }
            }
        }
    }
    
    if (bias === 'Bearish' && regime === 'Strong Trend' && vwap) {
        const distToVwap = Math.abs(currentPriceVal - vwap);
        const nearVwap = distToVwap < (atr * 1.0);
        const belowVwap = currentPriceVal <= vwap * 1.002;
        
        if (nearVwap && belowVwap) {
            const isStochHook = stochRsi && prevStochRsi && (stochRsi.k < stochRsi.d) && (prevStochRsi.k >= prevStochRsi.d) && (stochRsi.k > 60);
            
            if (isStochHook) {
                if (btcState.state === 'PUMP') {
                    reasons.push(`❌ VETO: Pullback rejected (BTC Pump).`);
                } else {
                    const preciseSL = vwap + (atr * pullbackStopMultiplier);
                    reasons.push(`✅ Setup: Bearish VWAP Pullback + Stoch Hook.`);
                    return {
                        signal: 'SELL', reasons, stopLossPrice: preciseSL, tradeType: 'conviction',
                        btcContext: btcState as any,
                        astraXAnalysis: { conviction: 80, regime, thesis: bias, setupName: `Bearish VWAP Pullback` }
                    };
                }
            }
        }
    }

    return { 
        signal: 'HOLD', 
        reasons: [...reasons, "No valid high-probability setup detected."], 
        astraXAnalysis: { conviction: 0, regime, thesis: bias } 
    };
};
