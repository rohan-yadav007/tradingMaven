
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
import { Agent, Kline, TradeSignal, BotConfig, MarketDataContext, TradingMode, OpenInterestKline } from '../types';
import { runLiveAnalysis } from './workerService';
import { orderBookService } from './orderBookService';
import * as binanceService from './binanceService';


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
    astraXKlinesMap?: Map<string, Kline[]>, // New parameter for AstraX data
    btcKlines?: Kline[] // New parameter for Market Tide
): Promise<TradeSignal> {
    
    // Fetch live order book data if available.
    const obAnalysis = orderBookService.getAnalysis(config.pair, config.mode);
    
    // V4.0: Fetch Open Interest History if Futures AND Agent is Omega (ID 25)
    // Optimization: Don't fetch OI for agents that don't use it (e.g. Supertrend, Sentinel)
    let openInterestHistory: OpenInterestKline[] | undefined;
    if (config.mode === TradingMode.USDSM_Futures && agent.id === 25) {
        // Map generic timeframes to OI periods. 5m is usually granular enough.
        // If we are on 1m, use 5m OI to see the bigger flow.
        const oiPeriod = ['1m', '3m', '5m'].includes(config.timeFrame) ? '5m' : config.timeFrame;
        openInterestHistory = await binanceService.fetchOpenInterestHistory(config.pair, oiPeriod);
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
            obAnalysis, // Pass OB Analysis to worker
            openInterestHistory // Pass OI History to worker
        );
        
        return workerSignal;

    } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'An unknown worker error occurred.';
        console.error("Error from analysis worker:", e);
        return { signal: 'HOLD', reasons: [`❌ VETO: Analysis worker failed.`, errorMessage] };
    }
}
