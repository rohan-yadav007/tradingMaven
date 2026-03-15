
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
    getTradeGuardianSignal,
    getTPProportionalLockSignal,
    calculateLiquidationPrice
} from './riskManagementService';

export { captureMarketContext } from './agents/agentUtils';

// Imports for getTradingSignal orchestration
import { Agent, Kline, TradeSignal, BotConfig, TradingMode, OpenInterestKline, LongShortRatio } from '../types';
import { runLiveAnalysis } from './workerService';
import { orderBookService } from './orderBookService';
import { tapeReadingService } from './tapeReadingService'; // Import Tape Service
import * as binanceService from './binanceService';
import { pairProfileService } from './pairProfileService';


/**
 * The primary orchestration function for generating a trading signal.
 * It now acts as a pure pass-through to the Web Worker, which handles all
 * agent logic and veto checks internally for better performance and architectural clarity.
 */
export async function getTradingSignal(
    agent: Agent,
    klines: Kline[],
    config: BotConfig,
    htfKlines?: Kline[],
    immediateKlines?: Kline[],
    ltfKlines?: Kline[],
    ethBtcKlines?: Kline[],
    livePrice?: number,
    astraXKlinesMap?: Map<string, Kline[]>,
    btcKlines?: Kline[] 
): Promise<TradeSignal> {
    
    // Fetch live order book data if available.
    const obAnalysis = orderBookService.getAnalysis(config.pair, config.mode);
    
    // V4.0: Fetch Intelligence Data (OI + L/S Ratio)
    let openInterestHistory: OpenInterestKline[] | undefined;
    let lsRatioHistory: LongShortRatio[] | undefined;
    let fundingRate: number | null = null;

    const isApexOrOmega = agent.id === 25 || agent.id === 26;
    if (config.mode === TradingMode.USDSM_Futures && isApexOrOmega) {
        const oiPeriod = ['1m', '3m', '5m'].includes(config.timeFrame) ? '5m' : config.timeFrame;
        const formattedPair = config.pair.replace('/', '');
        const fetchPromises: Promise<any>[] = [
            binanceService.fetchOpenInterestHistory(config.pair, oiPeriod),
            binanceService.fetchTopLongShortRatio(config.pair, oiPeriod),
        ];
        // Apex also fetches funding rate for flow intelligence
        if (agent.id === 26) fetchPromises.push(binanceService.fetchFundingRate(formattedPair));
        const results = await Promise.all(fetchPromises);
        openInterestHistory = results[0];
        lsRatioHistory = results[1];
        if (agent.id === 26 && results[2]) {
            fundingRate = parseFloat(results[2].fundingRate) / 100; // convert % string to decimal
        }
    }

    // --- Offload ALL logic to Worker ---
    try {
        const workerSignal = await runLiveAnalysis(
            agent,
            klines,
            config,
            htfKlines,
            immediateKlines,
            ltfKlines,
            ethBtcKlines,
            livePrice,
            astraXKlinesMap,
            btcKlines,
            obAnalysis,
            openInterestHistory,
            lsRatioHistory,
            // Pass model from main thread — workers have no localStorage access
            (agent.id === 25 || agent.id === 26) && config.isModelFilterEnabled !== false ? pairProfileService.getModel() : undefined,
            agent.id === 26 ? fundingRate : undefined
        );

        // --- LIVE TAPE VETO (The "Pro" Layer) ---
        if (config.mode !== 'Spot' && (agent.id === 25 || agent.id === 26) && workerSignal.signal !== 'HOLD') {
             const tape = tapeReadingService.getMetrics(config.pair, config.mode);

             // 1. Ignition Veto (Don't short a rocket)
             if (workerSignal.signal === 'SELL' && tape.isIgnition && tape.buyPressure > 0.6) {
                 return { signal: 'HOLD', reasons: [...workerSignal.reasons, `🚫 VETO: Bullish Momentum Ignition Detected (Velocity: $${Math.round(tape.velocity)}/s)`] };
             }
             // 2. Dump Veto (Don't buy a falling knife)
             if (workerSignal.signal === 'BUY' && tape.isIgnition && tape.buyPressure < 0.4) {
                 return { signal: 'HOLD', reasons: [...workerSignal.reasons, `🚫 VETO: Bearish Momentum Ignition Detected (Velocity: $${Math.round(tape.velocity)}/s)`] };
             }

             // Append Tape Data to Analysis for UI
             if (workerSignal.omegaAnalysis && workerSignal.omegaAnalysis.sentiment) {
                 workerSignal.omegaAnalysis.sentiment.tape = `Vel: $${(tape.velocity/1000).toFixed(1)}k/s | ${tape.buyPressure > 0.55 ? 'Bullish' : tape.buyPressure < 0.45 ? 'Bearish' : 'Neutral'}`;
             }
        }
        
        return workerSignal;

    } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'An unknown worker error occurred.';
        console.error("Error from analysis worker:", e);
        return { signal: 'HOLD', reasons: [`❌ VETO: Analysis worker failed.`, errorMessage] };
    }
}
