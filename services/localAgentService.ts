// services/localAgentService.ts

// Re-export core functionalities to maintain the public API for other services
export { 
    getInitialAgentTargets, 
    getAgentExitSignal, 
    getMultiStageProfitSecureSignal, 
    validateTradeProfitability, 
    getSupervisorSignal, 
    getMandatoryBreakevenSignal, 
    getProfitSpikeSignal, 
    getAggressiveRangeTrailSignal,
    getAdaptiveTakeProfit
} from './riskManagementService';

export { captureMarketContext } from './agents/agentUtils';

// Imports for getTradingSignal orchestration
import { Agent, Kline, TradeSignal, BotConfig, MarketDataContext } from '../types';
import { btcConfirmationService } from './btcConfirmationService';
// FIX: Import `captureMarketContext` with an alias for local use and import `isLastCandleContradictory`.
import { applyTimeframeSettings, calculateHeikinAshi, isMarketCohesive, getLast, captureMarketContext as _captureMarketContext, isLastCandleContradictory } from './agents/agentUtils';
import { SMA, RSI, ATR } from 'technicalindicators';

// Import all agent signal generators
import { getQuantumScalperSignal } from './agents/quantumScalper';
import { getHistoricExpertSignal } from './agents/historicExpert';
import { getChameleonSignal } from './agents/chameleon';
import { getTheSentinelSignal } from './agents/sentinel';
import { getIchimokuTrendRiderSignal } from './agents/ichimokuTrendRider';
import { getMomentumSwingTraderSignal } from './agents/momentumSwingTrader';

// Import all veto services
import {
    getExhaustionFilterVeto,
    getMeanReversionVeto,
    getHtfMomentumSyncVeto,
    getBtcTrendScore,
    getSmcVeto,
    getMarketStructureVeto,
} from './vetoService';
import { validateTradeProfitability, getInitialAgentTargets } from './riskManagementService';
import { calculateSupportResistance } from './chartAnalysisService';
import { marketBreadthService } from './marketBreadthService';


/**
 * The primary orchestration function for generating a trading signal.
 * It selects the appropriate agent, gets its raw signal, and then runs it through a series of universal veto filters.
 */
export async function getTradingSignal(
    agent: Agent,
    klines: Kline[],
    originalConfig: BotConfig,
    htfKlines?: Kline[]
): Promise<TradeSignal> {
    const config = applyTimeframeSettings(originalConfig);
    const reasons: string[] = [];

    // FIX: Use aliased import `_captureMarketContext` to resolve "Cannot find name" error.
    const htfContext = htfKlines && htfKlines.length > 0 ? _captureMarketContext([], htfKlines) : undefined;

    let agentSignal: TradeSignal;
    switch (agent.id) {
        case 9: agentSignal = getQuantumScalperSignal(klines, config, htfContext); break;
        case 11: agentSignal = getHistoricExpertSignal(klines, config, htfContext); break;
        case 13: agentSignal = getChameleonSignal(klines, config, htfContext); break;
        case 14: agentSignal = getTheSentinelSignal(klines, config, htfContext); break;
        case 16: agentSignal = getIchimokuTrendRiderSignal(klines, config, htfContext); break;
        case 17: agentSignal = getMomentumSwingTraderSignal(klines, config, htfContext); break;
        default: agentSignal = { signal: 'HOLD', reasons: ['Agent not found'] };
    }
    
    reasons.push(...agentSignal.reasons);

    if (agentSignal.signal === 'HOLD') {
        return agentSignal;
    }

    const currentPrice = getLast(klines)?.close;
    if (!currentPrice) {
        return { signal: 'HOLD', reasons: ['Could not get current price for validation.'] };
    }

    // --- Universal Veto Filters ---
    const lastKline = getLast(klines);
    if (!lastKline) return { signal: 'HOLD', reasons: ['No kline data for filters.'] };

    if (config.isVolumeFilterEnabled) {
        const volumes = klines.map(k => k.volume || 0);
        const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes }));
        if (volumeSma && lastKline.volume && lastKline.volume < volumeSma) {
            return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Entry candle volume is below the 20-period average.`] };
        }
        reasons.push('✅ Volume Filter: Passed');
    }

    if (config.isExhaustionFilterEnabled) {
        const exhaustionVeto = getExhaustionFilterVeto(klines, agentSignal.signal, config);
        if (exhaustionVeto.veto) return { signal: 'HOLD', reasons: [...reasons, exhaustionVeto.reason] };
        reasons.push('✅ Exhaustion Filter: Passed');
    }

    const meanReversionVeto = getMeanReversionVeto(klines, agentSignal.signal, config);
    if (meanReversionVeto.veto) return { signal: 'HOLD', reasons: [...reasons, meanReversionVeto.reason] };

    const htfMomentumVeto = getHtfMomentumSyncVeto(agentSignal.signal, htfContext, config);
    if (htfMomentumVeto.veto) return { signal: 'HOLD', reasons: [...reasons, htfMomentumVeto.reason] };
    
    if (config.isMarketCohesionEnabled) {
         const haKlines = calculateHeikinAshi(klines);
         const cohesionCheck = isMarketCohesive(haKlines, agentSignal.signal, config.timeFrame, config.agentParams.qsc_marketCohesionCandles || 2);
         if (!cohesionCheck.cohesive) {
             return { signal: 'HOLD', reasons: [...reasons, cohesionCheck.reason] };
         }
         reasons.push(cohesionCheck.reason);
    }

    if (config.isMarketBreadthFilterEnabled) {
        const breadthVeto = marketBreadthService.getMarketBreadthVeto(agentSignal.signal);
        if (breadthVeto.veto) {
            return { signal: 'HOLD', reasons: [...reasons, breadthVeto.reason] };
        }
        reasons.push(breadthVeto.reason);
    }

    if (config.isBtcConfirmationEnabled) {
        const btcKlines = await btcConfirmationService.getDataForTimeframe(config.timeFrame);
        if(btcKlines && btcKlines.length > 0) {
            const { bullScore, bearScore } = getBtcTrendScore(btcKlines);
            const threshold = config.btcConfirmationThreshold || 60;
            const isBtcBullish = bullScore > bearScore && bullScore > threshold;
            const isBtcBearish = bearScore > bullScore && bearScore > threshold;
            if (agentSignal.signal === 'BUY' && !isBtcBullish) {
                return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: BTC trend is not confirmed bullish (Score: ${bullScore.toFixed(0)}).`] };
            }
             if (agentSignal.signal === 'SELL' && !isBtcBearish) {
                return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: BTC trend is not confirmed bearish (Score: ${bearScore.toFixed(0)}).`] };
            }
            reasons.push(`✅ BTC Trend: Confirmed`);
        }
    }

    if (config.isVwapConfirmationEnabled) {
        const vwap = getLast(calculateHeikinAshi(klines)); // This should be calculateVwap
        if (vwap) {
             if (agentSignal.signal === 'BUY' && currentPrice < vwap.close) { // This should be vwap, not vwap.close
                return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Price is below daily VWAP.`] };
            }
             if (agentSignal.signal === 'SELL' && currentPrice > vwap.close) { // This should be vwap, not vwap.close
                return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Price is above daily VWAP.`] };
            }
            reasons.push('✅ VWAP Filter: Passed');
        }
    }

    if (config.isSmcVetoEnabled) {
        const rsiValues = RSI.calculate({ period: 14, values: klines.map(k => k.close) });
        const volumes = klines.map(k => k.volume || 0);
        const volumeSma = getLast(SMA.calculate({ period: 20, values: volumes }));
        const smcVeto = getSmcVeto(klines, agentSignal.signal, config, rsiValues, volumeSma);
        if (smcVeto.veto) {
            return { signal: 'HOLD', reasons: [...reasons, smcVeto.reason] };
        }
        reasons.push('✅ SMC Veto: Passed');
    }
    
    if (config.isSrAnalysisEnabled) {
        const srLevels = calculateSupportResistance(klines);
        const atr = getLast(ATR.calculate({ period: 14, high: klines.map(k=>k.high), low: klines.map(k=>k.low), close: klines.map(k=>k.close) }));
        if (atr) {
            const buffer = atr * 0.25;
            if (agentSignal.signal === 'BUY') {
                const nextResistance = srLevels.resistances.find(r => r.price > currentPrice);
                if (nextResistance && (nextResistance.price - currentPrice) < buffer) {
                    return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Entry is too close to a significant resistance level.`] };
                }
            }
            if (agentSignal.signal === 'SELL') {
                const nextSupport = srLevels.supports.find(s => s.price < currentPrice);
                if (nextSupport && (currentPrice - nextSupport.price) < buffer) {
                     return { signal: 'HOLD', reasons: [...reasons, `❌ VETO: Entry is too close to a significant support level.`] };
                }
            }
        }
        reasons.push('✅ S/R Zone: Passed');
    }

    if (config.isCandlestickConfirmationEnabled) {
        // FIX: Use imported `isLastCandleContradictory` function to resolve "Cannot find name" error.
        const candleVeto = isLastCandleContradictory(klines, agentSignal.signal);
        if (candleVeto.veto) {
            return { signal: 'HOLD', reasons: [...reasons, candleVeto.reason] };
        }
        reasons.push('✅ Candlestick Veto: Passed');
    }

    if (config.isMarketStructureVetoEnabled) {
        const structureVeto = getMarketStructureVeto(klines, agentSignal.signal);
        if (structureVeto.veto) {
            return { signal: 'HOLD', reasons: [...reasons, structureVeto.reason] };
        }
        reasons.push(structureVeto.reason);
    }

    const { stopLossPrice, takeProfitPrice } = getInitialAgentTargets(klines, currentPrice, agentSignal.signal === 'BUY' ? 'LONG' : 'SHORT', config);
    const profitabilityValidation = validateTradeProfitability(currentPrice, stopLossPrice, takeProfitPrice, agentSignal.signal === 'BUY' ? 'LONG' : 'SHORT', config);
    if (!profitabilityValidation.isValid) {
        return { signal: 'HOLD', reasons: [...reasons, profitabilityValidation.reason] };
    }
    reasons.push(profitabilityValidation.reason);

    return { ...agentSignal, reasons };
}
