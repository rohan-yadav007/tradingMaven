// services/localAgentService.ts

// Re-export core functionalities to maintain the public API for other services
export { 
    getInitialAgentTargets, 
    getAgentExitSignal, 
    getMultiStageProfitSecureSignal, 
    validateTradeProfitability, 
    getMandatoryBreakevenSignal, 
    getProfitSpikeSignal, 
    getAggressiveRangeTrailSignal,
    getAdaptiveTakeProfit,
    getTradeGuardianSignal
} from './riskManagementService';

export { captureMarketContext } from './agents/agentUtils';

// Imports for getTradingSignal orchestration
import { Agent, Kline, TradeSignal, BotConfig, MarketDataContext, AgentParams, TradingMode, StochasticRSIOutput, ADXOutput, BollingerBandsOutput, MACDOutput } from '../types';
import { btcConfirmationService } from './btcConfirmationService';
import { applyTimeframeSettings, captureMarketContext as _captureMarketContext, calculateHeikinAshi, isMarketCohesive, getLast, getPenultimate, detectRsiDivergence } from './agents/agentUtils';
import { SMA, RSI, ATR, StochasticRSI, ADX, EMA, BollingerBands, MACD } from 'technicalindicators';
import * as binanceService from './binanceService';
import { getMicroTimeframe } from '../constants';
import { marketBreadthService } from './marketBreadthService';
import { liquidationAnalysisService } from './liquidationAnalysisService';


// Import all agent signal generators
import { getQuantumScalperSignal } from './agents/quantumScalper';
import { getHistoricExpertSignal } from './agents/historicExpert';
import { getChameleonSignal } from './agents/chameleon';
import { getTheSentinelSignal } from './agents/sentinel';
import { getIchimokuTrendRiderSignal } from './agents/ichimokuTrendRider';
import { getMomentumSwingTraderSignal } from './agents/momentumSwingTrader';
import { getTheConductorSignal } from './agents/conductor';
import { getAstraXSignal } from './agents/astrax';

import { validateTradeProfitability, getInitialAgentTargets } from './riskManagementService';
import { calculateSupportResistance, findSwingPoints, analyzeMarketStructure } from './chartAnalysisService';
import * as constants from '../constants';
import { detectSmcReversalPattern } from './vetoService';


// --- VETO IMPLEMENTATIONS (Consolidated from vetoService.ts) ---

export function getExhaustionFilterVeto(
    klines: Kline[],
    direction: 'BUY' | 'SELL',
    config: BotConfig,
): { veto: boolean; reason: string } {
    if (klines.length < 31) return { veto: false, reason: '' };

    const timeframeSettings = constants.EXHAUSTION_FILTER_TIMEFRAME_SETTINGS[config.timeFrame] || constants.EXHAUSTION_FILTER_TIMEFRAME_SETTINGS['15m'];
    const positionDirection = direction === 'BUY' ? 'LONG' : 'SHORT';

    const checkExhaustionForSlice = (slice: Kline[]): boolean => {
        const closes = slice.map(k => k.close);
        const rsiValues = RSI.calculate({ period: 14, values: closes });
        const stochRsi = getLast(StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;
        
        if (!stochRsi) return false;

        const isOverextended = direction === 'BUY' ? stochRsi.k > timeframeSettings.overbought : stochRsi.k < timeframeSettings.oversold;
        if (isOverextended) {
            const hasDivergence = detectRsiDivergence(slice, rsiValues, positionDirection, 14);
            return hasDivergence;
        }
        return false;
    };
    
    const isExhaustedNow = checkExhaustionForSlice(klines);
    if (!isExhaustedNow) return { veto: false, reason: '' };
    
    const isExhaustedPreviously = checkExhaustionForSlice(klines.slice(0, -1));

    if (isExhaustedNow && isExhaustedPreviously) {
        return { veto: true, reason: `❌ VETO: Exhaustion risk detected (StochRSI Overextended + RSI Divergence for 2 consecutive candles)` };
    }

    return { veto: false, reason: '' };
}

export function getSmcVeto(
    klines: Kline[],
    direction: 'BUY' | 'SELL',
    config: BotConfig,
    rsiValues: number[],
    volumeSma: number | undefined,
): { veto: boolean; reason: string } {
    if (!config.isSmcVetoEnabled || klines.length < 50) return { veto: false, reason: '' };
    const reversalTypeToDetect = direction === 'BUY' ? 'bearish' : 'bullish';
    const result = detectSmcReversalPattern(klines, reversalTypeToDetect, config, rsiValues, volumeSma);
    return result.detected ? { veto: true, reason: `❌ VETO: ${result.reason}` } : { veto: false, reason: '' };
}

export function getBtcCorrelationVeto(
    ethBtcKlines: Kline[],
    signalDirection: 'BUY' | 'SELL',
    pair: string,
    config: BotConfig,
): { veto: boolean; reason: string } {
    const params = config.agentParams as Required<AgentParams>;
    if (signalDirection !== 'BUY' || pair.startsWith('BTC/') || pair.startsWith('ETH/')) return { veto: false, reason: '' };
    if (ethBtcKlines.length < params.btc_correlation_veto_ema_slow) return { veto: false, reason: 'ℹ️ Correlation: Insufficient ETH/BTC data.' };
    const closes = ethBtcKlines.map(k => k.close);
    const emaFast = getLast(EMA.calculate({ period: params.btc_correlation_veto_ema_fast, values: closes }));
    const emaSlow = getLast(EMA.calculate({ period: params.btc_correlation_veto_ema_slow, values: closes }));
    if (!emaFast || !emaSlow) return { veto: false, reason: 'ℹ️ Correlation: Could not calculate EMAs.' };
    return emaFast < emaSlow
        ? { veto: true, reason: '❌ VETO: Capital flow favors BTC over ALTS (ETH/BTC is bearish).' }
        : { veto: false, reason: '✅ Correlation: Capital flow is neutral or favors ALTS.' };
}

export function getHardConcordanceVetos(
    mainTimeframeKlines: Kline[],
    livePrice: number,
    signalDirection: 'BUY' | 'SELL',
    config: BotConfig,
    microKlines: Kline[] | undefined,
): { veto: boolean; reason: string } {
    const params = config.agentParams as Required<AgentParams>;

    if (!microKlines || microKlines.length < 30) {
        const reason = `Momentum Concordance: Insufficient 1m data.`;
        if (config.finalEntryFailSafe === 'fail-closed') {
            return { veto: true, reason: `❌ VETO: ${reason} (Fail-safe triggered)` };
        }
        return { veto: false, reason: `⚠️ ${reason} Trade allowed by fail-open.` };
    }

    const isLongSignal = signalDirection === 'BUY';
    const lastMainCandle = mainTimeframeKlines[mainTimeframeKlines.length - 1];
    const candleRange = lastMainCandle.high - lastMainCandle.low;
    const pricePositionRatio = candleRange > 0 ? (livePrice - lastMainCandle.low) / candleRange : 0.5;
    
    const entryType = (isLongSignal && pricePositionRatio > 0.7) || (!isLongSignal && pricePositionRatio < 0.3) ? 'breakout' : 'pullback';

    const microCloses = microKlines.map(k => k.close);
    
    if (entryType === 'breakout') {
        // --- BREAKOUT VETO LOGIC: The "Anti-Chase Filter" ---
        const stochRsi = getLast(StochasticRSI.calculate({ values: microCloses, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;
        if (stochRsi) {
            if (isLongSignal && stochRsi.k > 80) return { veto: true, reason: '❌ VETO (Breakout): 1m momentum is overbought (StochRSI > 80).' };
            if (!isLongSignal && stochRsi.k < 20) return { veto: true, reason: '❌ VETO (Breakout): 1m momentum is oversold (StochRSI < 20).' };
        }

        const macdValues = MACD.calculate({ values: microCloses, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
        const lastHist = (getLast(macdValues) as MACDOutput | undefined)?.histogram;
        const prevHist = (getPenultimate(macdValues) as MACDOutput | undefined)?.histogram;
        if (lastHist !== undefined && prevHist !== undefined) {
            if (isLongSignal && lastHist > 0 && lastHist < prevHist) return { veto: true, reason: '❌ VETO (Breakout): 1m bullish momentum is decelerating.' };
            if (!isLongSignal && lastHist < 0 && lastHist > prevHist) return { veto: true, reason: '❌ VETO (Breakout): 1m bearish momentum is decelerating.' };
        }
        
        return { veto: false, reason: `✅ Entry Dynamics (breakout): Passed Anti-Chase Filter.` };
    } else {
        // --- PULLBACK VETO LOGIC: Strict Multi-Condition Check ---
        const reasons: string[] = [];
        let conditionsMet = 0;

        // Condition 1: Location Check (must be near a key MA on main timeframe)
        const mainCloses = mainTimeframeKlines.map(k => k.close);
        const ema21 = getLast(EMA.calculate({ period: 21, values: mainCloses }));
        const ema50 = getLast(EMA.calculate({ period: 50, values: mainCloses }));
        const isAtEma21 = ema21 && lastMainCandle.low <= ema21 && lastMainCandle.high >= ema21;
        const isAtEma50 = ema50 && lastMainCandle.low <= ema50 && lastMainCandle.high >= ema50;
        if (isAtEma21 || isAtEma50) {
            conditionsMet++;
            reasons.push(`Location: OK (at key EMA)`);
        } else {
            reasons.push(`Location: Fail (not at key EMA)`);
        }
        
        // Condition 2: Exhaustion Check (1m StochRSI must be in reversal zone)
        const stochRsi = getLast(StochasticRSI.calculate({ values: microCloses, rsiPeriod: params.veto_pullback_stochRsiPeriod, stochasticPeriod: params.veto_pullback_stochRsiPeriod, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;
        if (stochRsi) {
            if (isLongSignal && stochRsi.k < params.veto_pullback_stochRsiOversold) {
                conditionsMet++;
                reasons.push(`Exhaustion: OK (1m StochRSI is oversold)`);
            } else if (!isLongSignal && stochRsi.k > params.veto_pullback_stochRsiOverbought) {
                conditionsMet++;
                reasons.push(`Exhaustion: OK (1m StochRSI is overbought)`);
            } else {
                reasons.push(`Exhaustion: Fail (1m StochRSI not in reversal zone)`);
            }
        } else {
            reasons.push(`Exhaustion: Fail (no StochRSI data)`);
        }

        // Condition 3: Momentum Turn Check (1m MACD histogram must confirm the turn)
        const macdValues = MACD.calculate({ values: microCloses, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
        const lastHist = (getLast(macdValues) as MACDOutput | undefined)?.histogram;
        const prevHist = (getPenultimate(macdValues) as MACDOutput | undefined)?.histogram;
        if (lastHist !== undefined && prevHist !== undefined) {
            if (isLongSignal && lastHist > 0 && prevHist <= 0) {
                conditionsMet++;
                reasons.push(`Momentum: OK (1m MACD crossed bullish)`);
            } else if (!isLongSignal && lastHist < 0 && prevHist >= 0) {
                conditionsMet++;
                reasons.push(`Momentum: OK (1m MACD crossed bearish)`);
            } else {
                reasons.push(`Momentum: Fail (no 1m MACD cross)`);
            }
        } else {
            reasons.push(`Momentum: Fail (no MACD data)`);
        }

        if (conditionsMet === 3) {
            return { veto: false, reason: `✅ Entry Dynamics (pullback): Passed all conditions.` };
        } else {
            return { veto: true, reason: `❌ VETO (Pullback): Failed validation (${reasons.join(', ')}).` };
        }
    }
}


/**
 * The primary orchestration function for generating a trading signal.
 * It selects the appropriate agent, gets its raw signal, and then runs it through a series of universal veto filters.
 */
export async function getTradingSignal(
    agent: Agent,
    klines: Kline[],
    originalConfig: BotConfig,
    htfKlines?: Kline[],
    immediateKlines?: Kline[],
    ltfKlines?: Kline[],
    ethBtcKlines?: Kline[],
    livePrice?: number,
): Promise<TradeSignal> {
    const config = applyTimeframeSettings(originalConfig);
    const params = config.agentParams as Required<AgentParams>;
    const reasons: string[] = [];

    const htfContext = htfKlines && htfKlines.length > 0 ? _captureMarketContext([], htfKlines) : undefined;

    let agentSignal: TradeSignal;

    if (agent.id === 19) {
        agentSignal = await getAstraXSignal(config, immediateKlines, livePrice);
    } else {
        switch (agent.id) {
            case 9: agentSignal = getQuantumScalperSignal(klines, config, htfContext); break;
            case 11: agentSignal = getHistoricExpertSignal(klines, config, htfContext); break;
            case 13: agentSignal = getChameleonSignal(klines, config, htfContext); break;
            case 14: agentSignal = getTheSentinelSignal(klines, config, htfContext); break;
            case 16: agentSignal = getIchimokuTrendRiderSignal(klines, config, htfContext); break;
            case 17: agentSignal = getMomentumSwingTraderSignal(klines, config, htfContext); break;
            case 18: agentSignal = getTheConductorSignal(klines, config, htfContext, ltfKlines); break;
            default: agentSignal = { signal: 'HOLD', reasons: ['Agent not found'] };
        }
    }
    
    reasons.push(...agentSignal.reasons);

    if (agentSignal.signal === 'HOLD') {
        return agentSignal;
    }

    const lastKline = klines[klines.length-1];
    const currentPrice = livePrice || lastKline?.close;
    if (!currentPrice || currentPrice <= 0) {
        return { signal: 'HOLD', reasons: ['Could not get current price for validation.'] };
    }

    if (!lastKline) return { signal: 'HOLD', reasons: ['No kline data for filters.'] };

    if (config.isMarketBreadthFilterEnabled) {
        const breadthVeto = marketBreadthService.getMarketBreadthVeto(agentSignal.signal);
        if (breadthVeto.veto) return { signal: 'HOLD', reasons: [...reasons, breadthVeto.reason] };
        reasons.push(breadthVeto.reason);
    }
    
    if (config.isLiquidationFilterEnabled && config.mode === TradingMode.USDSM_Futures) {
        const liquidationVeto = liquidationAnalysisService.getLiquidationVeto(agentSignal.signal, config.pair, config);
        if (liquidationVeto.veto) return { signal: 'HOLD', reasons: [...reasons, liquidationVeto.reason] };
        reasons.push(liquidationVeto.reason);
    }

    if (config.isMarketCohesionEnabled) {
        const haKlines = calculateHeikinAshi(klines);
        const cohesionCheck = isMarketCohesive(haKlines, agentSignal.signal, config.timeFrame, 2);
        if (!cohesionCheck.cohesive) return { signal: 'HOLD', reasons: [...reasons, cohesionCheck.reason] };
        reasons.push(cohesionCheck.reason);
    }

    if (config.isVolumeFilterEnabled && config.agent.id !== 14) {
        const volumes = klines.map(k => k.volume || 0);
        const volumeSma = SMA.calculate({ period: 20, values: volumes }).pop();
        const multiplier = params.veto_volumeFilterMultiplier || 0.8;
        if (volumeSma && lastKline.volume && lastKline.volume < (volumeSma * multiplier)) {
            return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Entry candle volume is below the required threshold (${(multiplier * 100).toFixed(0)}% of avg).`] };
        }
        reasons.push('✅ Volume Filter: Passed');
    }

    if (config.isExhaustionFilterEnabled) {
        const exhaustionVeto = getExhaustionFilterVeto(klines, agentSignal.signal, config);
        if (exhaustionVeto.veto) return { signal: 'HOLD', reasons: [...reasons, exhaustionVeto.reason] };
        reasons.push('✅ Exhaustion Filter: Passed');
    }
    
    if (config.isSmcVetoEnabled) {
        const rsiValues = RSI.calculate({ period: 14, values: klines.map(k => k.close) });
        const volumes = klines.map(k => k.volume || 0);
        const volumeSma = SMA.calculate({ period: 20, values: volumes }).pop();
        const smcVeto = getSmcVeto(klines, agentSignal.signal, config, rsiValues, volumeSma);
        if (smcVeto.veto) return { signal: 'HOLD', reasons: [...reasons, smcVeto.reason] };
        reasons.push('✅ SMC Veto: Passed');
    }

    if (config.isSrAnalysisEnabled) {
        const srLevels = calculateSupportResistance(klines);
        const atr = ATR.calculate({ period: 14, high: klines.map(k=>k.high), low: klines.map(k=>k.low), close: klines.map(k=>k.close) }).pop();
        if (atr) {
            let bufferMultiplier = params.veto_srZoneAtrBuffer;
            if (config.agent.id === 9) { bufferMultiplier = params.veto_sr_buffer_scalp; } 
            else if ([17, 18].includes(config.agent.id)) { bufferMultiplier = params.veto_sr_buffer_swing; }
            const buffer = atr * bufferMultiplier;
            if (agentSignal.signal === 'BUY') {
                const nextResistance = srLevels.resistances.find(r => r.price > currentPrice);
                if (nextResistance && (nextResistance.price - currentPrice) < buffer) return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Entry is too close to a significant resistance level.`] };
            }
            if (agentSignal.signal === 'SELL') {
                const nextSupport = srLevels.supports.find(s => s.price < currentPrice);
                if (nextSupport && (currentPrice - nextSupport.price) < buffer) return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Entry is too close to a significant support level.`] };
            }
        }
        reasons.push('✅ S/R Zone: Passed');
    }

    if (config.isBtcConfirmationEnabled) {
        const btcKlines = await btcConfirmationService.getDataForTimeframe(config.timeFrame);
        if(btcKlines && btcKlines.length > 0) {
            const { bullScore, bearScore } = btcConfirmationService.getBtcTrendScore(btcKlines);
            const threshold = config.btcConfirmationThreshold || 60;
            if (agentSignal.signal === 'BUY' && !(bullScore > bearScore && bullScore > threshold)) return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: BTC trend is not confirmed bullish (Score: ${bullScore.toFixed(0)}).`] };
            if (agentSignal.signal === 'SELL' && !(bearScore > bullScore && bearScore > threshold)) return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: BTC trend is not confirmed bearish (Score: ${bearScore.toFixed(0)}).`] };
            reasons.push(`✅ BTC Trend: Confirmed`);
        }
    }
    
    if (config.isBtcCorrelationVetoEnabled && ethBtcKlines && ethBtcKlines.length > 0) {
        const correlationVeto = getBtcCorrelationVeto(ethBtcKlines, agentSignal.signal, config.pair, config);
        if (correlationVeto.veto) return { signal: 'HOLD', reasons: [...reasons, correlationVeto.reason] };
        reasons.push(correlationVeto.reason);
    }

    if (config.isMomentumConcordanceEnabled) {
        const livePriceForVeto = livePrice || currentPrice;
        const hardVeto = getHardConcordanceVetos(klines, livePriceForVeto, agentSignal.signal, config, immediateKlines);
        if (hardVeto.veto) return { signal: 'HOLD', reasons: [...reasons, hardVeto.reason] };
        reasons.push(hardVeto.reason);
    }

    const { stopLossPrice, takeProfitPrice, agentStopLoss } = getInitialAgentTargets(klines, currentPrice, agentSignal.signal === 'BUY' ? 'LONG' : 'SHORT', config);
    const profitabilityValidation = validateTradeProfitability(currentPrice, agentStopLoss, takeProfitPrice, agentSignal.signal === 'BUY' ? 'LONG' : 'SHORT', config);
    if (!profitabilityValidation.isValid) {
        return { signal: 'HOLD', reasons: [...reasons, profitabilityValidation.reason] };
    }
    reasons.push(profitabilityValidation.reason);

    return { 
        ...agentSignal, 
        reasons,
        stopLossPrice: stopLossPrice,
        takeProfitPrice: takeProfitPrice
    };
}
