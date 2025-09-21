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
import { Agent, Kline, TradeSignal, BotConfig, MarketDataContext, AgentParams, TradingMode } from '../types';
import { btcConfirmationService } from './btcConfirmationService';
import { applyTimeframeSettings, captureMarketContext as _captureMarketContext } from './agents/agentUtils';
import { SMA, RSI, ATR } from 'technicalindicators';
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

// Import all veto services
import {
    getExhaustionFilterVeto,
    getSmcVeto,
    getHardConcordanceVetos,
    getBtcCorrelationVeto
} from './vetoService';
import { validateTradeProfitability, getInitialAgentTargets } from './riskManagementService';
import { calculateSupportResistance, findSwingPoints, analyzeMarketStructure } from './chartAnalysisService';


/**
 * The primary orchestration function for generating a trading signal.
 * It selects the appropriate agent, gets its raw signal, and then runs it through a series of universal veto filters.
 */
export async function getTradingSignal(
    agent: Agent,
    klines: Kline[],
    originalConfig: BotConfig,
    htfKlines?: Kline[],
    microKlines?: Kline[],
    ethBtcKlines?: Kline[], // Tweak #5
    livePrice?: number,
): Promise<TradeSignal> {
    const config = applyTimeframeSettings(originalConfig);
    const params = config.agentParams as Required<AgentParams>;
    const reasons: string[] = [];

    const htfContext = htfKlines && htfKlines.length > 0 ? _captureMarketContext([], htfKlines) : undefined;

    // --- Pre-computation for multiple checks ---
    const structureAnalysis = analyzeMarketStructure(findSwingPoints(klines, 5));

    let agentSignal: TradeSignal;
    switch (agent.id) {
        case 9: agentSignal = getQuantumScalperSignal(klines, config, htfContext); break;
        case 11: agentSignal = getHistoricExpertSignal(klines, config, htfContext); break;
        case 13: agentSignal = getChameleonSignal(klines, config, htfContext); break;
        case 14: 
            const microTimeframe = getMicroTimeframe(config.timeFrame);
            agentSignal = getTheSentinelSignal(klines, config, htfContext, structureAnalysis, microKlines, microTimeframe, livePrice); 
            break;
        case 16: agentSignal = getIchimokuTrendRiderSignal(klines, config, htfContext); break;
        case 17: agentSignal = getMomentumSwingTraderSignal(klines, config, htfContext); break;
        case 18: agentSignal = getTheConductorSignal(klines, config, htfContext); break;
        default: agentSignal = { signal: 'HOLD', reasons: ['Agent not found'] };
    }
    
    reasons.push(...agentSignal.reasons);

    if (agentSignal.signal === 'HOLD') {
        return agentSignal;
    }

    const lastKline = klines[klines.length-1];
    const currentPrice = lastKline?.close;
    if (!currentPrice) {
        return { signal: 'HOLD', reasons: ['Could not get current price for validation.'] };
    }

    // --- Universal "Hard" Veto Filters ---
    if (!lastKline) return { signal: 'HOLD', reasons: ['No kline data for filters.'] };

    // VETO: Market Breadth
    if (config.isMarketBreadthFilterEnabled) {
        const breadthVeto = marketBreadthService.getMarketBreadthVeto(agentSignal.signal);
        if (breadthVeto.veto) {
            return { signal: 'HOLD', reasons: [...reasons, breadthVeto.reason] };
        }
        reasons.push(breadthVeto.reason);
    }
    
    // VETO: Liquidation Cascade
    if (config.isLiquidationFilterEnabled && config.mode === TradingMode.USDSM_Futures) {
        const liquidationVeto = liquidationAnalysisService.getLiquidationVeto(agentSignal.signal, config.pair);
        if (liquidationVeto.veto) {
            return { signal: 'HOLD', reasons: [...reasons, liquidationVeto.reason] };
        }
        reasons.push(liquidationVeto.reason);
    }

    // Sentinel (14) has its own advanced, soft-veto volume logic. The hard veto is bypassed.
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
        if (smcVeto.veto) {
            return { signal: 'HOLD', reasons: [...reasons, smcVeto.reason] };
        }
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

    if (config.isBtcConfirmationEnabled) {
        const btcKlines = await btcConfirmationService.getDataForTimeframe(config.timeFrame);
        if(btcKlines && btcKlines.length > 0) {
            const { bullScore, bearScore } = btcConfirmationService.getBtcTrendScore(btcKlines);
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
    
    // Tweak #5: BTC Correlation Veto
    if (config.isBtcCorrelationVetoEnabled && ethBtcKlines && ethBtcKlines.length > 0) {
        const correlationVeto = getBtcCorrelationVeto(ethBtcKlines, agentSignal.signal, config.pair, config);
        if (correlationVeto.veto) {
            return { signal: 'HOLD', reasons: [...reasons, correlationVeto.reason] };
        }
        reasons.push(correlationVeto.reason);
    }

    // Hard Concordance vetos (ATR Chaos, Liquidity Sweeps)
    if (config.isMomentumConcordanceEnabled) {
        const livePriceForVeto = livePrice || currentPrice;
        const microTimeframe = getMicroTimeframe(config.timeFrame);
        const hardVeto = getHardConcordanceVetos(klines, livePriceForVeto, agentSignal.signal, config, microKlines, microTimeframe);
        if (hardVeto.veto) {
            return { signal: 'HOLD', reasons: [...reasons, hardVeto.reason] };
        }
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