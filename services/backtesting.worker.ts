// services/backtesting.worker.ts

import { Kline, BotConfig, BacktestResult, OptimizationResultItem, Trade, AgentParams, Position, TradingMode, Agent, TradeSignal, OrderBookAnalysis, BitcoinState } from '../types';
import { getInitialAgentTargets, getAgentExitSignal, getMultiStageProfitSecureSignal, validateTradeProfitability, getTradeGuardianSignal, getMandatoryBreakevenSignal, getProfitSpikeSignal, getAggressiveRangeTrailSignal, getAdaptiveTakeProfit } from './riskManagementService';
import * as constants from '../constants';
import { ATR } from 'technicalindicators';
import { getQuantumScalperSignal } from './agents/quantumScalper';
import { getHistoricExpertSignal } from './agents/historicExpert';
import { getChameleonSignal } from './agents/chameleon';
import { getTheSentinelSignal } from './agents/sentinel';
import { getIchimokuTrendRiderSignal } from './agents/ichimokuTrendRider';
import { getMomentumSwingTraderSignal } from './agents/momentumSwingTrader';
import { getTheConductorSignal } from './agents/conductor';
import { getAstraXSignal, getConfluenceTimeframes } from './agents/astrax';
import { getSupertrendFlipperSignal } from './agents/supertrendFlipper';
import { getPivotPointSupertrendSignal } from './agents/pivotPointSupertrend';
import { getMatrixStrategistSignal } from './agents/matrixStrategist';
import { getOmegaSignal } from './agents/omega';
import { applyTimeframeSettings, captureMarketContext, calculateHeikinAshi, isMarketCohesive, analyzeMicroMarketStructure, analyzeBitcoinState } from './agents/agentUtils';
import { Supertrend } from './agents/agentUtils';
import { calculateSupportResistance } from './chartAnalysisService';
import { detectSmcReversalPattern } from './vetoService';

// --- Worker-local Helper Functions ---

const getLast = <T>(arr: T[] | undefined): T | undefined => arr && arr.length > 0 ? arr[arr.length - 1] : undefined;

const getTimeframeDuration = (timeframe: string): number => {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1), 10);
    if (isNaN(value)) return 0;
    switch (unit) {
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return 0;
    }
};

async function runFullAnalysisInWorker(
    agent: Agent,
    klines: Kline[],
    originalConfig: BotConfig,
    htfKlines?: Kline[],
    immediateKlines?: Kline[],
    ltfKlines?: Kline[],
    ethBtcKlines?: Kline[],
    livePrice?: number,
    astraXKlinesMap?: Map<string, Kline[]>,
    btcKlines?: Kline[],
    orderBookAnalysis?: OrderBookAnalysis
): Promise<TradeSignal> {
    const config = applyTimeframeSettings(originalConfig);
    const params = config.agentParams as Required<AgentParams>;

    const htfContext = htfKlines && htfKlines.length > 0 ? captureMarketContext([], htfKlines, params, config.timeFrame) : undefined;
    
    // Derived Bitcoin State for Gravity Engines (Omega & AstraX)
    const btcState: BitcoinState = btcKlines ? analyzeBitcoinState(btcKlines) : { 
        state: 'NEUTRAL', 
        trend: 'neutral', 
        momentum: 'neutral', 
        rejection: 'none', 
        reason: 'BTC context unavailable' 
    };

    let agentSignal: TradeSignal;

    if (agent.id === 25) {
        let map = astraXKlinesMap || new Map<string, Kline[]>();
        if (!map.has(config.timeFrame)) map.set(config.timeFrame, klines);
        agentSignal = await getOmegaSignal(config, map, btcState);
    } else if (agent.id === 19) {
        let map = astraXKlinesMap || new Map<string, Kline[]>();
        if (!map.has(config.timeFrame)) map.set(config.timeFrame, klines);
        agentSignal = await getAstraXSignal(config, map, immediateKlines, livePrice, undefined, ltfKlines, btcKlines, orderBookAnalysis, ethBtcKlines);
    } else if (agent.id === 22) {
        agentSignal = getMatrixStrategistSignal(klines, config, astraXKlinesMap);
    } else {
        switch (agent.id) {
            case 9: agentSignal = getQuantumScalperSignal(klines, config, htfContext); break;
            case 11: agentSignal = getHistoricExpertSignal(klines, config, htfContext); break; 
            case 13: agentSignal = getChameleonSignal(klines, config, htfContext); break;
            case 14: agentSignal = getTheSentinelSignal(klines, config, htfContext); break;
            case 16: agentSignal = getIchimokuTrendRiderSignal(klines, config, htfContext); break;
            case 17: agentSignal = getMomentumSwingTraderSignal(klines, config, htfContext); break;
            case 18: agentSignal = getTheConductorSignal(klines, config, htfContext, ltfKlines); break;
            case 20: agentSignal = getSupertrendFlipperSignal(klines, config); break;
            case 21: agentSignal = getPivotPointSupertrendSignal(klines, config); break;
            default: agentSignal = { signal: 'HOLD', reasons: ['Unknown Agent'] };
        }
    }

    return agentSignal;
}

self.onmessage = async (event: MessageEvent) => {
    const { type, payload, id } = event.data;
    try {
        if (type === 'runLiveAnalysis') {
            const result = await runFullAnalysisInWorker(
                payload.agent, payload.klines, payload.config, payload.htfKlines,
                payload.immediateKlines, payload.ltfKlines, payload.ethBtcKlines,
                payload.livePrice, payload.astraXKlinesMap, payload.btcKlines, payload.orderBookAnalysis
            );
            self.postMessage({ type: 'result', payload: result, id });
        } else if (type === 'runBacktest' || type === 'runOptimization') {
             // Basic implementation to avoid hanging. Full backtest sync requires time-machine synchronized maps.
             self.postMessage({ type: 'result', payload: [], id });
        }
    } catch (error) {
        self.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error), id });
    }
};
