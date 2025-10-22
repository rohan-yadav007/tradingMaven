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
import { Agent, Kline, TradeSignal, BotConfig, MarketDataContext, TradingMode } from '../types';
import { runLiveAnalysis } from './workerService';


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
): Promise<TradeSignal> {
    
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
            livePrice
        );
        
        return workerSignal;

    } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'An unknown worker error occurred.';
        console.error("Error from analysis worker:", e);
        return { signal: 'HOLD', reasons: [`❌ VETO: Analysis worker failed.`, errorMessage] };
    }
}