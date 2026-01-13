
// services/agents/omega.ts

import { Kline, BotConfig, TradeSignal, AgentParams, OmegaAnalysis, BitcoinState, Position, TradeManagementSignal, ADXOutput, OpenInterestKline } from '../../types';
import { EMA, ATR, RSI, SMA, ADX } from 'technicalindicators';
import { getLast, detectFairValueGaps, detectAbsorption, calculateCVDDivergence, calculateBandwidthSlope, detectMarketRegime, MarketRegime, getKillZoneMultiplier, calculateDailyVwap, calculateVwapDeviation, validateSwingRejection, calculateRVOL, findNearestStructuralLevel, calculateTrueRange } from './agentUtils';
import { findSwingPoints } from '../chartAnalysisService';
import { liquidationAnalysisService } from '../liquidationAnalysisService';

/**
 * Omega V5.2: The Capital Allocator (Polished)
 * 
 * UPGRADES V5.2 (Precision Fixes):
 * 1. Regime-Aware ATR Floor: Allow breakouts during SQUEEZE regime even if ATR is low.
 * 2. Institutional VWAP Deadzone: Use Session ATR (15m) instead of Execution ATR (1m) for deadzone calc.
 * 3. Flow Veto Logic: Allow Elite execution (Kill Score > 95) to override weak Flow.
 * 4. Explicit Setup Types: Distinct handling for 'Breakout' vs 'Rejection' in management.
 */
class OmegaEngine {
    private config: BotConfig;
    private params: Required<AgentParams>;
    private aggressiveMode: 'Conservative' | 'Standard' | 'Sniper';

    constructor(config: BotConfig) {
        this.config = config;
        this.params = config.agentParams as Required<AgentParams>;
        this.aggressiveMode = this.params.omega_aggressiveness || 'Standard';
    }

    /**
     * GATE 0: REGIME BLENDING
     * Combines Execution Timeframe (15m) with Structural Timeframe (1H/4H)
     * to avoid "Micro-Chop" errors.
     */
    private blendRegimes(klinesMap: Map<string, Kline[]>): { regime: MarketRegime, score: number, reason: string, multiplier: number } {
        const m15 = klinesMap.get('15m');
        const h1 = klinesMap.get('1h');
        
        // Default to Ranging if insufficient data
        if (!m15) return { regime: 'RANGING', score: 0, reason: 'No Data', multiplier: 0.8 };

        const m15Regime = detectMarketRegime(m15);
        
        // If we don't have H1 data, trust M15
        if (!h1 || h1.length < 50) return { ...m15Regime, reason: `M15 Only` };

        const h1Regime = detectMarketRegime(h1);

        // LOGIC 1: Structural Trend Overrides Micro Range
        // If H1 is Trending, but M15 is Ranging, we are likely in a pullback. Treat as TRENDING.
        if (h1Regime.regime === 'TRENDING' && m15Regime.regime === 'RANGING') {
            return { regime: 'TRENDING', score: h1Regime.score, multiplier: h1Regime.multiplier, reason: 'H1 Trend > M15 Range' };
        }

        // LOGIC 2: Structural Chop Contaminates Micro Trend
        // If H1 is Volatile/Chop, but M15 looks like a trend, it's likely a fake-out. Downgrade.
        if (h1Regime.regime === 'VOLATILE' && m15Regime.regime === 'TRENDING') {
            return { regime: 'VOLATILE', score: h1Regime.score, multiplier: 0.5, reason: 'H1 Chop dampens M15 Trend' };
        }

        // Default: Use M15 classification but note the H1 context
        return { ...m15Regime, reason: `M15 ${m15Regime.regime} (H1 ${h1Regime.regime})` };
    }

    /**
     * GATE 1: SCAN (4H, 1H) + BTC VETO
     * Hard Filter: Trend Alignment & Macro Safety.
     */
    private runScanPhase(
        klinesMap: Map<string, Kline[]>, 
        regimeData: { regime: MarketRegime, score: number, reason: string },
        btc: BitcoinState
    ): OmegaAnalysis['phases']['scan'] {
        const h4 = klinesMap.get('4h');
        
        if (!h4 || h4.length < 50) return { bias: 'Neutral', score: 0, reason: 'Insufficient 4H Data' };

        const h4Closes = h4.map(k => k.close);
        const h4Ema50 = getLast(EMA.calculate({ period: 50, values: h4Closes })) as number;
        const currentPrice = h4Closes[h4Closes.length - 1];

        // 1. 4H Trend Direction
        const h4Bias = currentPrice > h4Ema50 ? 'Bullish' : 'Bearish';

        // 2. BTC Veto (Correlation Protection)
        // If trading an Alt, checking BTC state is mandatory.
        const isAltcoin = !this.config.pair.includes('BTC');
        if (isAltcoin) {
            if (h4Bias === 'Bullish' && btc.state === 'CRASH') {
                return { bias: 'Neutral', score: 0, reason: `Veto: BTC Crashing (${btc.reason})` };
            }
            if (h4Bias === 'Bearish' && btc.state === 'PUMP') {
                return { bias: 'Neutral', score: 0, reason: `Veto: BTC Pumping (${btc.reason})` };
            }
        }

        return {
            bias: h4Bias,
            score: 100, // Pass
            reason: `Macro ${h4Bias} [${regimeData.reason}]`
        };
    }

    /**
     * GATE 2: HUNT (15m, 5m) - Structural Target Clamping & Quality Checks
     * Hard Filter: Structural Setup (FVG, Swing, Breakout).
     */
    private runHuntPhase(
        klinesMap: Map<string, Kline[]>, 
        macroBias: 'Bullish' | 'Bearish' | 'Neutral', 
        regime: MarketRegime
    ): OmegaAnalysis['phases']['hunt'] & { target?: number, stop?: number } {
        const m15 = klinesMap.get('15m') || klinesMap.get('5m');
        if (!m15 || m15.length < 50) return { setup: 'None', score: 0, reason: 'No 15m Data' };

        const lastCandle = m15[m15.length - 1];
        const currentPrice = lastCandle.close;
        const isBull = macroBias === 'Bullish';

        // --- V4.7: DYNAMIC ATR & STRUCTURAL CLAMPING ---
        const atrVals = ATR.calculate({ high: m15.map(k=>k.high), low: m15.map(k=>k.low), close: m15.map(k=>k.close), period: 14 });
        const atr = (getLast(atrVals) as number) || currentPrice * 0.01;
        const rewardMult = regime === 'TRENDING' ? 3.0 : 2.0; 
        
        let calculatedTarget = isBull ? currentPrice + (atr * rewardMult) : currentPrice - (atr * rewardMult);
        
        // Find nearest structural obstacle
        const nearestStructure = findNearestStructuralLevel(m15, currentPrice, isBull ? 'LONG' : 'SHORT');
        
        if (nearestStructure) {
            // Clamp target inside the structure level with a small buffer (0.2 ATR)
            const buffer = atr * 0.2;
            if (isBull) {
                // If structure is closer than ATR target, clamp it.
                if (nearestStructure < calculatedTarget) {
                    calculatedTarget = nearestStructure - buffer;
                }
            } else {
                if (nearestStructure > calculatedTarget) {
                    calculatedTarget = nearestStructure + buffer;
                }
            }
        }

        // 1. Fair Value Gaps (High Probability)
        const fvgs = detectFairValueGaps(m15, 50);
        const validFvg = fvgs.find(f => {
            if (f.filled) return false;
            if (isBull && f.type === 'FVG Bullish' && currentPrice <= f.top && currentPrice >= f.bottom) return true;
            if (!isBull && f.type === 'FVG Bearish' && currentPrice >= f.bottom && currentPrice <= f.top) return true;
            return false;
        });

        if (validFvg) {
            const isReacting = isBull ? lastCandle.close > lastCandle.open : lastCandle.close < lastCandle.open;
            if (this.aggressiveMode === 'Conservative' && !isReacting) {
                return { setup: 'None', score: 0, reason: 'Price resting in FVG (No Reaction)' };
            }
            const stop = isBull ? validFvg.bottom : validFvg.top;
            return { setup: 'FVG', score: 100, reason: isReacting ? 'Reacting from Structural FVG' : 'Inside Structural FVG', target: calculatedTarget, stop };
        }

        // 2. Swing Rejections (Medium Probability)
        const swings = findSwingPoints(m15, 5);
        const lastLow = swings.filter(s => s.type === 'low').pop();
        const lastHigh = swings.filter(s => s.type === 'high').pop();
        
        const volumes = m15.map(k => k.volume || 0);
        const volSma = getLast(SMA.calculate({ period: 20, values: volumes })) || 0;

        if (isBull && lastLow) {
             const validation = validateSwingRejection(lastCandle, lastLow.price, 'support', volSma);
             if (regime === 'TRENDING' && validation.score < 50) { /* Skip weak rejections in trend */ } 
             else if (validation.score > 0) {
                 return { 
                     setup: 'Rejection', 
                     score: Math.min(100, 80 + (validation.score / 5)), 
                     reason: `Sweeping Low (${validation.reason})`, 
                     target: calculatedTarget, 
                     stop: lastLow.price * 0.995 
                };
             }
        }
        
        if (!isBull && lastHigh) {
             const validation = validateSwingRejection(lastCandle, lastHigh.price, 'resistance', volSma);
             if (regime === 'TRENDING' && validation.score < 50) { /* Skip */ } 
             else if (validation.score > 0) {
                 return { 
                     setup: 'Rejection', 
                     score: Math.min(100, 80 + (validation.score / 5)),
                     reason: `Sweeping High (${validation.reason})`, 
                     target: calculatedTarget, 
                     stop: lastHigh.price * 1.005 
                };
             }
        }

        // 3. Breakouts (Sniper Only or Strong Trend)
        const allowBreakout = regime === 'TRENDING' || regime === 'SQUEEZE' || this.aggressiveMode === 'Sniper';
        
        if (allowBreakout && regime !== 'RANGING') {
             // V4.7: Breakout Quality Check (Avoid buying wicks)
             // Ensure candle closed in the direction of the breakout (upper 25% for bull, lower 25% for bear)
             const range = lastCandle.high - lastCandle.low;
             const closePosition = range > 0 ? (lastCandle.close - lastCandle.low) / range : 0.5;
             
             const isQualityClose = isBull ? closePosition > 0.75 : closePosition < 0.25;
             
             // V5.1: Structural Stops
             const stopBuffer = atr * 0.5;

             if (isBull && lastHigh && currentPrice > lastHigh.price) {
                 if (!isQualityClose && this.aggressiveMode !== 'Sniper') {
                     // Filter out "wicky" breakouts unless in Sniper mode
                 } else {
                     return { 
                         setup: 'Breakout', 
                         score: 100, 
                         reason: 'Breaking Swing High', 
                         target: calculatedTarget, 
                         stop: lastHigh.price - stopBuffer 
                    };
                 }
             }
             if (!isBull && lastLow && currentPrice < lastLow.price) {
                 if (!isQualityClose && this.aggressiveMode !== 'Sniper') {
                     // Filter
                 } else {
                     return { 
                         setup: 'Breakout', 
                         score: 100, 
                         reason: 'Breaking Swing Low', 
                         target: calculatedTarget, 
                         stop: lastLow.price + stopBuffer
                    };
                 }
             }
        }

        return { setup: 'None', score: 0, reason: 'No structural setup found' };
    }

    /**
     * GATE 3: KILL (1m) - Regime Aware
     * Hard Filter: Precise Execution Trigger.
     */
    private runKillPhase(klinesMap: Map<string, Kline[]>, setup: string, bias: 'Bullish' | 'Bearish', regime: MarketRegime): OmegaAnalysis['phases']['kill'] {
        const m1 = klinesMap.get('1m');
        if (!m1 || m1.length < 50) return { trigger: 'None', score: 0, reason: 'No 1m Data' };

        // --- V5.0 FIX: KILL PHASE STRUCTURE DEPENDENCY ---
        // Price Action triggers are irrelevant without a structural setup (HUNT phase)
        if (setup === 'None') {
            return { trigger: 'None', score: 0, reason: 'No structural context for PA' };
        }

        const isBull = bias === 'Bullish';
        
        // --- Tier 1 Triggers: Order Flow ---
        const trap = liquidationAnalysisService.getLiquidityTrap(this.config.pair, isBull ? 'BUY' : 'SELL');
        const hasTrap = (isBull && trap === 'Spring') || (!isBull && trap === 'Upthrust');
        
        if (hasTrap) {
            const score = regime === 'RANGING' ? 100 : 90;
            return { trigger: 'Sweep', score, reason: `Liquidity Trap: ${trap}` };
        }

        // 2. CVD Divergence
        const div = calculateCVDDivergence(m1, 20);
        const hasDiv = (isBull && div === 'Bullish Divergence') || (!isBull && div === 'Bearish Divergence');
        if (hasDiv) {
            const score = regime === 'RANGING' ? 100 : 85; 
            return { trigger: 'Divergence', score, reason: `CVD Divergence: ${div}` };
        }

        // --- Tier 2 Triggers: Absorption (V4.8: Context-Aware) ---
        if (this.aggressiveMode !== 'Conservative') {
            // Need context for absorption location filter
            const closes = m1.map(k=>k.close);
            const vwap = getLast(calculateDailyVwap(m1));
            // const bb = getLast(BollingerBands.calculate({ period: 20, stdDev: 2, values: closes })); // Heavy calc?
            const atr = getLast(ATR.calculate({ high: m1.map(k=>k.high), low: m1.map(k=>k.low), close: closes, period: 14 }));
            
            const abs = detectAbsorption(m1, { vwap, atr }); // V4.8: Added context
            const hasAbs = (isBull && abs === 'Bullish Absorption') || (!isBull && abs === 'Bearish Distribution');
            if (hasAbs) return { trigger: 'Sweep', score: 85, reason: `Volume Absorption detected (Key Level)` };
        }

        // --- Tier 3 Triggers: Momentum Price Action ---
        if (this.aggressiveMode === 'Sniper' || this.aggressiveMode === 'Standard') {
            const lastCandle = m1[m1.length - 1];
            const prevCandle = m1[m1.length - 2];
            const closes = m1.map(k => k.close);
            const volumes = m1.map(k => k.volume || 0);
            
            const bandwidthSlope = calculateBandwidthSlope(m1, 20);
            const rvol = getLast(volumes)! / (getLast(SMA.calculate({ period: 20, values: volumes })) || 1);
            
            if (bandwidthSlope < -0.05 && rvol < 2.0) {
                 return { trigger: 'None', score: 0, reason: `Veto: Volatility Contracting` };
            }

            const rsi = getLast(RSI.calculate({ period: 14, values: closes })) || 50;
            const momentumConfirmed = isBull ? rsi > 48 : rsi < 52; 
            
            const prevWasRed = prevCandle.close < prevCandle.open;
            const prevWasGreen = prevCandle.close > prevCandle.open;
            
            let hasPaTrigger = false;
            
            if (momentumConfirmed) {
                if (isBull) {
                    if (lastCandle.close > prevCandle.high && (prevWasRed || rvol > 2.0)) hasPaTrigger = true;
                } else {
                    if (lastCandle.close < prevCandle.low && (prevWasGreen || rvol > 2.0)) hasPaTrigger = true;
                }
            }

            if (hasPaTrigger) {
                if (regime === 'TRENDING') {
                    return { trigger: 'Price Action', score: 95, reason: 'Momentum Break (Trend Aligned)' };
                } else if (regime === 'RANGING') {
                    if (rvol > 3.0) return { trigger: 'Price Action', score: 75, reason: 'High Volatility Breakout' };
                    else return { trigger: 'None', score: 0, reason: 'Veto: Weak Breakout in Range' };
                } else {
                    return { trigger: 'Price Action', score: 80, reason: 'Momentum Break' };
                }
            }
        }

        return { trigger: 'None', score: 0, reason: 'No Valid Trigger found for Mode' };
    }

    /**
     * GATE 4: FLOW (Open Interest) - V4.7 Squat Protection
     * Hard Filter: Rejects fake-outs where OI contradicts price.
     */
    private runFlowPhase(
        oiHistory: OpenInterestKline[] | undefined, 
        bias: 'Bullish' | 'Bearish',
        m1Klines: Kline[]
    ): NonNullable<OmegaAnalysis['phases']['flow']> {
        if (!oiHistory || oiHistory.length < 5) {
            return { trend: 'Flat', score: 50, reason: 'No OI Data (Neutral)' };
        }

        const isBull = bias === 'Bullish';
        const recentOI = oiHistory.slice(-5).map(o => parseFloat(o.sumOpenInterest || "0"));
        const currentOI = recentOI[recentOI.length - 1];
        const prevOI = recentOI[0]; 
        
        if (prevOI === 0) return { trend: 'Flat', score: 50, reason: 'OI Data Zero' };

        const oiDeltaPercent = (currentOI - prevOI) / prevOI;
        
        // V5.1: Direction-Aware Flow Check
        // Rising OI is only confirming if Price Direction matches Trade Direction
        if (oiDeltaPercent > 0.005) { 
            const lastM1 = m1Klines.length > 0 ? m1Klines[m1Klines.length - 1] : null;
            if (lastM1) {
                const priceUp = lastM1.close > lastM1.open;
                const priceDown = lastM1.close < lastM1.open;
                
                if ((isBull && priceUp) || (!isBull && priceDown)) {
                    return { trend: 'Rising', score: 100, reason: isBull ? 'Flow: Strong Buying (OI+Price Rising)' : 'Flow: Strong Selling (OI Rising, Price Drop)' };
                } else {
                    return { trend: 'Rising', score: 50, reason: 'Flow: Rising OI but Price Diverging (Caution)' };
                }
            }
            // Fallback if no M1 klines
            return { trend: 'Rising', score: 75, reason: 'Flow: Rising OI (Price unconfirmed)' };
        }
        
        // 2. Divergence (Trap) - OI Dropping usually means liquidation/close out
        if (oiDeltaPercent < -0.01) { 
             return { trend: 'Falling', score: 0, reason: 'Veto: Fake-out (OI Dropping - Stop Run)' };
        }
        
        // 3. Flat OI - V4.7 Sniper Squat Protection
        // Requires both RVOL AND Range Expansion to prove intent.
        if (this.aggressiveMode === 'Sniper') {
             const lastM1 = m1Klines[m1Klines.length - 1];
             const prevM1 = m1Klines[m1Klines.length - 2];
             
             // Volume check
             const volumes = m1Klines.map(k => k.volume || 0);
             const volSma = getLast(SMA.calculate({ period: 20, values: volumes })) || 1;
             const rvol = (lastM1.volume || 0) / volSma;
             
             // V4.7: Range Expansion Check
             const tr = calculateTrueRange(lastM1, prevM1);
             const trHistory = [];
             for(let i=2; i<22; i++) {
                 if(m1Klines.length > i) trHistory.push(calculateTrueRange(m1Klines[m1Klines.length-i], m1Klines[m1Klines.length-i-1]));
             }
             const atr = trHistory.reduce((a,b)=>a+b, 0) / (trHistory.length || 1);
             const rangeExpansion = tr > atr * 1.2;

             if (rvol > 3.0) {
                 if (rangeExpansion) {
                     return { trend: 'Flat', score: 85, reason: `Sniper Override: RVOL ${rvol.toFixed(1)}x + Range Exp` };
                 } else {
                     return { trend: 'Flat', score: 0, reason: `Veto: High Vol but Squat Candle (Absorption)` };
                 }
             }
             
             return { trend: 'Flat', score: 0, reason: 'Veto: Sniper requires OI expansion or Vol Explosion.' };
        }

        return { trend: 'Flat', score: 50, reason: 'Flow: Neutral OI' };
    }

    /**
     * GATE 5: MATH (Expectancy & Sizing)
     * V4.8: Regime Multiplier & Dynamic VWAP Deviation
     */
    private calculateExpectancyAndSizing(
        entry: number, 
        stop: number, 
        target: number, 
        klines: Kline[], // Execution TF (1m)
        sessionKlines: Kline[], // V4.7: Session TF (15m/1H) for VWAP
        regimeMultiplier: number, // V4.8
        huntScore: number // V5.0: Setup Quality
    ): { feeCheck: OmegaAnalysis['feeExpectancy'], sizing: OmegaAnalysis['sizing'] } {
        
        const feeRate = this.config.takerFeeRate || 0.0005;
        const roundTripCost = entry * feeRate * 2;
        const grossReward = Math.abs(target - entry);
        const ratio = roundTripCost > 0 ? grossReward / roundTripCost : 0;
        
        let minRatio = 5.0; 
        if (this.aggressiveMode === 'Conservative') minRatio = 7.0; 
        if (this.aggressiveMode === 'Sniper') minRatio = 4.0; 

        let passed = ratio >= minRatio;
        
        // V4.7: Institutional VWAP & Deadzone
        // Use Session Klines (15m) for meaningful VWAP
        const vwapArr = calculateDailyVwap(sessionKlines.length > 0 ? sessionKlines : klines);
        const currentVwap = getLast(vwapArr);
        
        // V5.2 FIX: Use Session ATR (15m) for robust Deadzone calculation
        // Execution TF ATR (1m) is too small and makes the deadzone hyper-sensitive.
        const klinesForAtr = sessionKlines.length > 50 ? sessionKlines : klines;
        const highs = klinesForAtr.map(k=>k.high);
        const lows = klinesForAtr.map(k=>k.low);
        const closes = klinesForAtr.map(k=>k.close);
        const atr = getLast(ATR.calculate({high: highs, low: lows, close: closes, period: 14})) || entry * 0.01;

        let sizingMult = 1.0;
        let sizingNote = '';

        if (currentVwap) {
            // V5.1: Regime-Aware VWAP Deadzone
            if (Math.abs(entry - currentVwap) < atr * 0.3) {
                if (regimeMultiplier < 1.0) { // Not Trending (Ranging/Volatile)
                    passed = false; // Veto the trade
                    sizingNote = ' (Inside VWAP Deadzone - Chop)';
                } else {
                    // Soft penalty for trending markets
                    sizingMult *= 0.8;
                    sizingNote += ' (Near VWAP)';
                }
            }

            // V4.8: Dynamic VWAP Deviation (ATR Scaled)
            // Replaced fixed 2.5% check with 1.8 ATR
            if (Math.abs(entry - currentVwap) > atr * 1.8) {
                sizingMult *= 0.5;
                sizingNote += ' (Overextended VWAP > 1.8 ATR)';
            }
        }

        const feeCheck = {
            cost: roundTripCost,
            reward: grossReward,
            ratio,
            passed
        };

        // V4.8: Regime Multiplier
        sizingMult *= regimeMultiplier;
        if (regimeMultiplier !== 1.0) sizingNote += ` (Regime Mult ${regimeMultiplier}x)`;

        // V5.0: Conviction Score Sizing
        const convictionMult = huntScore > 90 ? 1.1 : huntScore < 70 ? 0.8 : 1.0;
        sizingMult *= convictionMult;
        if (convictionMult !== 1.0) sizingNote += ` (Score Mult ${convictionMult}x)`;

        if (this.aggressiveMode === 'Conservative') sizingMult *= 0.8;

        return {
            feeCheck,
            sizing: {
                multiplier: sizingMult,
                reason: `Base ${sizingMult.toFixed(2)}x${sizingNote}`
            }
        };
    }

    public async generateSignal(klinesMap: Map<string, Kline[]>, btc: BitcoinState, openInterestHistory?: OpenInterestKline[]): Promise<TradeSignal> {
        // --- V4.8: NO TRADE ZONE VETO ---
        const hour = new Date().getUTCHours();
        if (hour >= 22 || hour === 0) {
             return { signal: 'HOLD', reasons: ['🛑 NO TRADE ZONE (UTC 22:00-01:00)'] };
        }

        // --- 0. REGIME BLENDING (V4.6) ---
        // Moved up for V5.2 to allow regime-aware ATR Floor logic
        const regimeData = this.blendRegimes(klinesMap);

        // --- V5.0: ATR FLOOR FILTER (Dead Market Veto) ---
        // Uses the Hunt/Structure timeframe (15m/5m) for reliability
        const sessionKlines = klinesMap.get('15m') || klinesMap.get('5m') || klinesMap.get('1m') || [];
        if (sessionKlines.length > 50) {
            const highs = sessionKlines.map(k => k.high);
            const lows = sessionKlines.map(k => k.low);
            const closes = sessionKlines.map(k => k.close);
            const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
            const currentAtr = getLast(atrValues) || 0;
            const atrSmaValues = SMA.calculate({ period: 20, values: atrValues });
            const currentAtrSma = getLast(atrSmaValues) || 0;

            // V5.2: Allow SQUEEZE regime to bypass ATR floor (anticipating breakout)
            if (currentAtrSma > 0 && currentAtr < currentAtrSma * 0.8 && regimeData.regime !== 'SQUEEZE') {
                return { 
                    signal: 'HOLD', 
                    reasons: [`🛑 ATR Floor Veto: Dead Market (ATR ${currentAtr.toFixed(5)} < ${currentAtrSma.toFixed(5)})`] 
                };
            }
        }

        // --- 1. SCAN (Gate + BTC Veto) ---
        const scan = this.runScanPhase(klinesMap, regimeData, btc);
        if (scan.bias === 'Neutral') {
            return { signal: 'HOLD', reasons: [scan.reason], omegaAnalysis: this.createAnalysis(0, scan) };
        }

        // --- 2. HUNT (Gate + Structural Targets) ---
        const hunt = this.runHuntPhase(klinesMap, scan.bias as any, regimeData.regime);
        if (hunt.setup === 'None') {
            return { signal: 'HOLD', reasons: [scan.reason, hunt.reason], omegaAnalysis: this.createAnalysis(25, scan, hunt) };
        }
        
        // --- V5.0: TRADE TYPE CLASSIFICATION & HARD SCALP VETO ---
        // Trend Rejection = Conviction (Pullback). Breakout = Conviction.
        const tradeType = hunt.setup === 'Breakout' ? 'conviction' :
                          regimeData.regime === 'TRENDING' ? 'conviction' :
                          'scalp';

        // Hard Veto: Block scalps in VOLATILE or RANGING regimes.
        if (tradeType === 'scalp' && (regimeData.regime === 'VOLATILE' || regimeData.regime === 'RANGING')) {
             return { 
                 signal: 'HOLD', 
                 reasons: [`🛑 Regime Veto: Scalps blocked in ${regimeData.regime} market`],
                 omegaAnalysis: this.createAnalysis(30, scan, hunt)
            };
        }

        // --- 3. KILL (Gate + Regime Awareness) ---
        const kill = this.runKillPhase(klinesMap, hunt.setup, scan.bias as any, regimeData.regime);
        if (kill.trigger === 'None') {
            return { signal: 'HOLD', reasons: [scan.reason, hunt.reason, kill.reason], omegaAnalysis: this.createAnalysis(50, scan, hunt, kill) };
        }
        
        // --- V5.1: ALIGNMENT VETO ---
        if (kill.score < 80 && hunt.score < 85) {
            return { 
                signal: 'HOLD', 
                reasons: [`❌ VETO: Weak Alignment (Hunt ${hunt.score} + Kill ${kill.score})`],
                omegaAnalysis: this.createAnalysis(55, scan, hunt, kill) 
            };
        }

        // --- 4. FLOW (Gate + Sniper Squat Protection) ---
        const m1 = klinesMap.get('1m') || [];
        const flow = this.runFlowPhase(openInterestHistory, scan.bias as any, m1);
        if (flow.score === 0) {
            // V5.2: Elite Execution Override
            // If the kill setup is perfect (Score > 95), ignore weak flow/OI data (often lagging).
            if (kill.score >= 95) {
                // Log warning in reason but proceed
                flow.reason += " (Ignored: Elite Execution)";
            } else {
                return { signal: 'HOLD', reasons: [scan.reason, hunt.reason, kill.reason, flow.reason], omegaAnalysis: this.createAnalysis(75, scan, hunt, kill, undefined, flow) };
            }
        }

        // --- 5. MATH (Gate + Expectancy + VWAP Deadzone + Regime Mult) ---
        const entryPrice = m1.length > 0 ? m1[m1.length-1].close : 0;
        if (entryPrice === 0) return { signal: 'HOLD', reasons: ['No price data'] };

        // V4.7: Pass 15m/1H klines for Institutional VWAP
        // Using tradeType derived in step 2 is cleaner but calculateExpectancyAndSizing handles ratio check.
        const sessionKlinesVwap = klinesMap.get('15m') || klinesMap.get('1h') || m1;
        const math = this.calculateExpectancyAndSizing(entryPrice, hunt.stop!, hunt.target!, m1, sessionKlinesVwap, regimeData.multiplier, hunt.score);

        if (!math.feeCheck.passed) {
             return { 
                 signal: 'HOLD', 
                 reasons: [`❌ Fee/Structure Veto: Ratio ${math.feeCheck.ratio.toFixed(1)}x${math.sizing.reason.includes('Deadzone') ? ' (Deadzone)' : ''}`], 
                 omegaAnalysis: this.createAnalysis(85, scan, hunt, kill, math, flow) 
            };
        }

        // --- 6. TIME MULTIPLIER (V4.5) ---
        const timeMult = getKillZoneMultiplier();
        let conviction = 100;
        if (timeMult < 1.0) conviction = Math.round(90 * timeMult); 

        // --- EXECUTE (All Gates Passed) ---
        return {
            signal: scan.bias === 'Bullish' ? 'BUY' : 'SELL',
            reasons: [
                `🚀 OMEGA V5.2 UNLOCKED`,
                `Scan: ${scan.reason}`,
                `Hunt: ${hunt.reason}`,
                `Kill: ${kill.reason}`,
                `Flow: ${flow.reason}`,
                `Math: ${math.feeCheck.ratio.toFixed(1)}x Fee Cov`
            ],
            entryPrice,
            stopLossPrice: hunt.stop,
            takeProfitPrice: hunt.target,
            tradeType: tradeType, 
            setupType: hunt.setup, // V5.2: Explicit Setup Type
            omegaAnalysis: {
                ...this.createAnalysis(conviction, scan, hunt, kill, math, flow),
                sizing: { ...math.sizing, multiplier: math.sizing.multiplier * timeMult } 
            },
        };
    }

    private createAnalysis(progress: number, scan?: any, hunt?: any, kill?: any, math?: any, flow?: any): OmegaAnalysis {
        return {
            conviction: progress,
            phases: {
                scan: scan || { bias: 'Neutral', score: 0, reason: 'Waiting...' },
                hunt: hunt || { setup: 'None', score: 0, reason: 'Scanning...' },
                kill: kill || { trigger: 'None', score: 0, reason: 'Idle...' },
                flow: flow || { trend: 'Flat', score: 0, reason: 'Checking...' }
            },
            feeExpectancy: math ? math.feeCheck : { cost: 0, reward: 0, ratio: 0, passed: false },
            targets: { entry: 0, stopLoss: hunt?.stop || 0, takeProfit: hunt?.target || 0 },
            sizing: math ? math.sizing : { multiplier: 1, reason: 'N/A' }
        };
    }
}

/**
 * Sovereign Management Engine V3.5
 * Updates stop loss based on volatility and structural breaks.
 */
export class SovereignManagementEngine {
    public static manage(
        position: Position,
        currentPrice: number,
        klines: Kline[],
        klinesMap: Map<string, Kline[]>
    ): TradeManagementSignal {
        const signal: TradeManagementSignal = { reasons: [] };
        const isLong = position.direction === 'LONG';
        const entry = position.entryPrice;
        
        // V5.2: Use explicit setup type if available, fallback to legacy tradeType check
        const isBreakout = position.setupType === 'Breakout' || (!position.setupType && position.tradeType === 'conviction');
        
        // 1. Calculate Dynamic Volatility Trail
        const m1 = klinesMap.get('1m') || klines;
        const atrVals = ATR.calculate({ high: m1.map(k=>k.high), low: m1.map(k=>k.low), close: m1.map(k=>k.close), period: 14 });
        const atr = (getLast(atrVals) as number) || (entry * 0.005);
        
        // Tighten trail as profit increases
        const pnlPct = Math.abs(currentPrice - entry) / entry;
        
        // V4.7: Setup-Specific Trailing Logic
        let atrMult: number;
        if (isBreakout) {
            // Breakouts need breathing room initially to handle retests
            atrMult = pnlPct > 0.02 ? 2.0 : 3.5; 
        } else {
            // Rejections/Scalps should move quickly
            atrMult = pnlPct > 0.01 ? 1.5 : 2.5;
        }
        
        if (pnlPct > 0.04) atrMult = 1.0; // Aggressive lock after 4% move

        const trailPrice = isLong ? currentPrice - (atr * atrMult) : currentPrice + (atr * atrMult);
        
        const isTighter = isLong ? trailPrice > position.stopLossPrice : trailPrice < position.stopLossPrice;
        const isValid = isLong ? trailPrice < currentPrice : trailPrice > currentPrice;

        if (isTighter && isValid) {
            signal.newStopLoss = trailPrice;
            signal.activeStopLossReason = 'Sovereign Ratchet';
            signal.reasons.push(`V3.5 Ratchet: Context Aware (${isBreakout ? 'Breakout' : 'Scalp'} Mode)`);
        }

        return signal;
    }
}

export const getOmegaSignal = async (config: BotConfig, klinesMap: Map<string, Kline[]>, btc: BitcoinState, openInterestHistory?: OpenInterestKline[]): Promise<TradeSignal> => {
    const engine = new OmegaEngine(config);
    return await engine.generateSignal(klinesMap, btc, openInterestHistory);
};
