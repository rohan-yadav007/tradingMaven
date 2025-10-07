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

export function detectSmcReversalPattern(
    klines: Kline[],
    reversalTypeToDetect: 'bullish' | 'bearish',
    config: BotConfig,
    rsiValues: number[],
    volumeSma: number | undefined,
): { detected: boolean; reason: string } {
    const params = config.agentParams as Required<AgentParams>;
    const lookback = params.smc_divergenceLookback;
    
    const isScalpingTf = ['1m', '3m', '5m'].includes(config.timeFrame);
    let requiresConfluence = isScalpingTf && params.smc_requireConfluenceOnScalp;
    let confluenceMet = !requiresConfluence;

    if (requiresConfluence) {
        const bb = getLast(BollingerBands.calculate({ period: 20, stdDev: 2, values: klines.map(k => k.close) })) as BollingerBandsOutput | undefined;
        if (bb) {
            const bbWidth = (bb.upper - bb.lower) / bb.middle;
            if (bbWidth < params.smc_confluence_bbwSqueezeThreshold) {
                confluenceMet = true;
            }
        }
    }

    const rsiStartIndex = klines.length - rsiValues.length;
    if (rsiStartIndex < 0) return { detected: false, reason: '' };
    const getRsiForKlineIndex = (klineIndex: number): number | undefined => {
        const rsiIndex = klineIndex - rsiStartIndex;
        return (rsiIndex >= 0 && rsiIndex < rsiValues.length) ? rsiValues[rsiIndex] : undefined;
    };

    const pivots = findSwingPoints(klines, lookback);

    if (reversalTypeToDetect === 'bearish') {
        const recentHighs = pivots.filter(p => p.type === 'high').slice(-2);
        if (recentHighs.length === 2) {
            const [prevHigh, lastHigh] = recentHighs;
            const prevRsi = getRsiForKlineIndex(prevHigh.index);
            const lastRsi = getRsiForKlineIndex(lastHigh.index);

            if (prevRsi !== undefined && lastRsi !== undefined && lastHigh.price > prevHigh.price && lastRsi < prevRsi) {
                const sweepCandle = klines[lastHigh.index];
                const hasHighVolume = sweepCandle.volume! > (volumeSma || 0) * params.smc_volumeMultiplier;
                if (hasHighVolume && confluenceMet) {
                    return { detected: true, reason: `SMC Reversal: Bearish divergence + liquidity sweep.` };
                }
            }
        }
    }

    if (reversalTypeToDetect === 'bullish') {
        const recentLows = pivots.filter(p => p.type === 'low').slice(-2);
        if (recentLows.length === 2) {
            const [prevLow, lastLow] = recentLows;
            const prevRsi = getRsiForKlineIndex(prevLow.index);
            const lastRsi = getRsiForKlineIndex(lastLow.index);

            if (prevRsi !== undefined && lastRsi !== undefined && lastLow.price < prevLow.price && lastRsi > prevRsi) {
                const sweepCandle = klines[lastLow.index];
                const hasHighVolume = sweepCandle.volume! > (volumeSma || 0) * params.smc_volumeMultiplier;
                if (hasHighVolume && confluenceMet) {
                    return { detected: true, reason: `SMC Reversal: Bullish divergence + liquidity sweep.` };
                }
            }
        }
    }
    
    return { detected: false, reason: '' };
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
    microKlines: Kline[] | undefined, // 1-minute klines
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
    const microCloses = microKlines.map(k => k.close);

    // --- NEW: Anti-Momentum Chasing Filter (Universal Safety Net) ---
    // Veto 1: StochRSI Exhaustion Check on 1m TF
    const stochRsi = getLast(StochasticRSI.calculate({ values: microCloses, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;
    if (stochRsi) {
        if (isLongSignal && stochRsi.k > 80) return { veto: true, reason: '❌ VETO: 1m Momentum Overbought (StochRSI > 80).' };
        if (!isLongSignal && stochRsi.k < 20) return { veto: true, reason: '❌ VETO: 1m Momentum Oversold (StochRSI < 20).' };
    }

    // Veto 2: MACD Deceleration Check on 1m TF
    const macdValues = MACD.calculate({ values: microCloses, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const lastHist = (getLast(macdValues) as MACDOutput | undefined)?.histogram;
    const prevHist = (getPenultimate(macdValues) as MACDOutput | undefined)?.histogram;
    if (lastHist !== undefined && prevHist !== undefined) {
        if (isLongSignal && lastHist > 0 && lastHist < prevHist) return { veto: true, reason: '❌ VETO: 1m Bullish Momentum is Decelerating (MACD).' };
        if (!isLongSignal && lastHist < 0 && lastHist > prevHist) return { veto: true, reason: '❌ VETO: 1m Bearish Momentum is Decelerating (MACD).' };
    }
    // --- End of NEW Filter ---

    const lastMainCandle = mainTimeframeKlines[mainTimeframeKlines.length - 1];
    const candleRange = lastMainCandle.high - lastMainCandle.low;
    const pricePositionRatio = candleRange > 0 ? (livePrice - lastMainCandle.low) / candleRange : 0.5;
    
    const entryType = (isLongSignal && pricePositionRatio > 0.7) || (!isLongSignal && pricePositionRatio < 0.3) ? 'breakout' : 'pullback';

    let totalScore = 0;
    let scoreDetails = '';
    const microVolumes = microKlines.map(k => k.volume || 0);

    if (entryType === 'breakout') {
        const microEmaFast = getLast(EMA.calculate({ period: params.veto_microEmaFast, values: microCloses })) as number | undefined;
        const microEmaSlow = getLast(EMA.calculate({ period: params.veto_microEmaSlow, values: microCloses })) as number | undefined;
        let momentumScore = 0;
        if (microEmaFast && microEmaSlow) {
            if (isLongSignal && livePrice > microEmaFast && microEmaFast > microEmaSlow) momentumScore = 40;
            if (!isLongSignal && livePrice < microEmaFast && microEmaFast < microEmaSlow) momentumScore = 40;
        }
        totalScore += momentumScore;
        scoreDetails += `Momentum:${momentumScore}/40 `;
        
        const volumeSma = getLast(SMA.calculate({ period: 20, values: microVolumes })) as number | undefined;
        const lastVol = getLast(microVolumes);
        const prevVol = getPenultimate(microVolumes);
        let volumeScore = 0;
        if (lastVol && prevVol && volumeSma) {
            if (lastVol > prevVol && lastVol > volumeSma * 1.2) volumeScore = 40;
            else if (lastVol > volumeSma) volumeScore = 20;
        }
        totalScore += volumeScore;
        scoreDetails += `Volume:${volumeScore}/40 `;
        
        let positionScore = 0;
        if (isLongSignal) positionScore = (1 - Math.max(0, (pricePositionRatio - 0.7) / 0.3)) * 20;
        else positionScore = (1 - Math.max(0, (0.3 - pricePositionRatio) / 0.3)) * 20;
        totalScore += positionScore;
        scoreDetails += `Position:${positionScore.toFixed(0)}/20`;

    } else { // pullback
        let positionScore = 0;
        if (isLongSignal) positionScore = Math.max(0, (0.7 - pricePositionRatio) / 0.7) * 50;
        else positionScore = Math.max(0, (pricePositionRatio - 0.3) / 0.7) * 50;
        totalScore += positionScore;
        scoreDetails += `Position:${positionScore.toFixed(0)}/50 `;

        const stochRsiHook = getLast(StochasticRSI.calculate({ values: microCloses, rsiPeriod: params.veto_pullback_stochRsiPeriod, stochasticPeriod: params.veto_pullback_stochRsiPeriod, kPeriod: 3, dPeriod: 3 })) as StochasticRSIOutput | undefined;
        let exhaustionScore = 0;
        if (stochRsiHook) {
            if (isLongSignal && stochRsiHook.k < params.veto_pullback_stochRsiOversold && stochRsiHook.k > stochRsiHook.d) exhaustionScore = 30;
            if (!isLongSignal && stochRsiHook.k > params.veto_pullback_stochRsiOverbought && stochRsiHook.k < stochRsiHook.d) exhaustionScore = 30;
        }
        totalScore += exhaustionScore;
        scoreDetails += `Exhaustion:${exhaustionScore}/30 `;

        const lastMicroCandle = microKlines[microKlines.length - 1];
        const lastVol = lastMicroCandle.volume || 0;
        const volumeSma = getLast(SMA.calculate({ period: 20, values: microVolumes })) as number | undefined;
        let volumeScore = 0;
        if (volumeSma) {
             if (isLongSignal && lastMicroCandle.close > lastMicroCandle.open && lastVol > volumeSma * 0.8) volumeScore = 20;
             else if (!isLongSignal && lastMicroCandle.close < lastMicroCandle.open && lastVol > volumeSma * 0.8) volumeScore = 20;
        }
        totalScore += volumeScore;
        scoreDetails += `Volume:${volumeScore.toFixed(0)}/20`;
    }

    const threshold = params.veto_entryScoreThreshold;
    return totalScore >= threshold
        ? { veto: false, reason: `✅ Entry Dynamics (${entryType}): Score ${totalScore.toFixed(0)}/${threshold}` }
        : { veto: true, reason: `❌ VETO: Entry Dynamics (${entryType}) Score ${totalScore.toFixed(0)} < ${threshold}. (${scoreDetails.trim()})` };
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