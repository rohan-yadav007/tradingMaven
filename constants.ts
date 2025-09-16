import { Agent, AgentParams, WalletBalance } from './types';

export const TRADING_PAIRS: string[] = [
    'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT'
];

export const TIME_FRAMES: string[] = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];

/**
 * The standard taker fee rate for Binance Spot and Futures.
 * Used to calculate estimated PNL after fees.
 */
export const TAKER_FEE_RATE = 0.0005; // 0.05% fee per trade side.

/**
 * A non-negotiable, system-wide minimum risk-to-reward ratio for a trade to be considered valid.
 */
export const MIN_RISK_REWARD_RATIO = 1.5;

/**
 * A multiplier to ensure the profit target is a safe distance away from the breakeven point caused by fees.
 * E.g., 1.5 means the profit must be at least 1.5x the cost of the fee.
 */
export const MIN_PROFIT_BUFFER_MULTIPLIER = 1.5;

/**
 * Finds the next higher timeframe from the standard list.
 * @param timeframe The current timeframe (e.g., '5m').
 * @returns The next higher timeframe string (e.g., '15m') or undefined if it's the highest.
 */
export const getHigherTimeframe = (timeframe: string): string | undefined => {
    const currentIndex = TIME_FRAMES.indexOf(timeframe);
    if (currentIndex === -1 || currentIndex >= TIME_FRAMES.length - 1) {
        return undefined;
    }
    return TIME_FRAMES[currentIndex + 1];
};


export const AGENTS: Agent[] = [
    {
        id: 18,
        name: 'The Conductor',
        description: "An advanced, context-aware agent that builds a trade thesis based on Market Structure, Momentum Quality, and Liquidity. It prioritizes high-conviction setups by ensuring confluence across multiple factors.",
        indicators: ["Market Structure Analysis", "RSI Divergence", "S/R Zones"],
    },
    {
        id: 9,
        name: 'Quantum Scalper',
        description: "A dynamic, aggressive agent using a weighted scoring system. It filters for volatility and trend regime, then scores signals based on Trend, Momentum, and Confirmation. Now features a 'Mean Reversion Veto' to prevent chasing exhausted moves, and 'HTF Momentum Sync' to ensure entries align with higher timeframe momentum, not just trend direction. Supports 'Breakout' and 'Pullback' entry modes.",
        indicators: ['Market Regime Filter (ADX)', 'Volatility Filter (BBW)', 'Ichimoku Cloud', 'OBV'],
    },
    {
        id: 11,
        name: 'Historic Expert',
        description: 'A robust trend-follower using an SMA for trend bias. Enters on pullbacks, with entries confirmed by strong momentum from both RSI and On-Balance Volume (OBV). Now includes ADX and volatility filters to improve entry quality.',
        indicators: ['SMA (Trend)', 'EMA (Pullback)', 'RSI (Momentum)', 'OBV (Confirmation)'],
    },
    {
        id: 13,
        name: 'The Chameleon',
        description: 'A classic momentum agent that enters trades on EMA crossovers. It uses a long-period EMA for trend direction and ADX to filter for trending conditions, ensuring trades are only taken during periods of strong, confirmed trend.',
        indicators: ['EMA Cross', 'ADX', 'Trend EMA'],
    },
    {
        id: 14,
        name: 'The Sentinel',
        description: 'A comprehensive, adaptive scoring engine. Analyzes market regime (trend/volatility), then dynamically weighs Trend, Momentum, Confirmation, and market Structure (S/R zones, candlestick patterns) to generate high-conviction signals. Features adaptive score thresholds based on trend strength.',
        indicators: ['Adaptive Scoring', 'S/R Analysis', 'Volatility Filters', 'Multi-Indicator Analysis'],
    },
    {
        id: 16,
        name: 'Ichimoku Trend Rider',
        description: 'A pure Ichimoku Kinko Hyo strategy. It identifies strong trends by checking if the price is above/below the Kumo cloud, then enters on Tenkan/Kijun-sen crossovers, confirmed by volume and momentum indicators.',
        indicators: ['Ichimoku Cloud', 'Vortex Indicator', 'OBV'],
    },
    {
        id: 17,
        name: 'Momentum Swing Trader',
        description: 'An intraday swing strategy using EMA for trend, VWAP for institutional bias, and MACD for momentum confirmation. Enters on alignment of all three factors.',
        indicators: ['EMA Cross', 'VWAP', 'MACD'],
    }
];

export const DEFAULT_AGENT_PARAMS: Required<AgentParams> = {
    // General
    rsiPeriod: 14,
    atrPeriod: 14,
    adxPeriod: 14,
    viPeriod: 14,
    obvPeriod: 20,
    macdFastPeriod: 12,
    macdSlowPeriod: 26,
    macdSignalPeriod: 9,
    invalidationCandleLimit: 10,

    // Agent 9: Quantum Scalper
    qsc_adxPeriod: 10,
    qsc_adxThreshold: 28,
    qsc_adxChopBuffer: 3,
    qsc_bbPeriod: 20,
    qsc_bbStdDev: 2,
    qsc_bbwSqueezeThreshold: 0.005,
    qsc_stochRsiPeriod: 14,
    qsc_stochRsiOversold: 25,
    qsc_stochRsiOverbought: 75,
    qsc_superTrendPeriod: 10,
    qsc_superTrendMultiplier: 2,
    qsc_psarStep: 0.02,
    qsc_psarMax: 0.2,
    qsc_atrPeriod: 14,
    qsc_atrMultiplier: 1.5,
    qsc_trendScoreThreshold: 75,
    qsc_rangeScoreThreshold: 2,
    qsc_ichi_conversionPeriod: 9,
    qsc_ichi_basePeriod: 26,
    qsc_ichi_laggingSpanPeriod: 52,
    qsc_ichi_displacement: 26,
    qsc_rsiOverextendedLong: 75,
    qsc_rsiOverextendedShort: 25,
    qsc_entryMode: 'breakout',
    qsc_rsiMomentumThreshold: 55,
    qsc_rsiPullbackThreshold: 45,
    qsc_rsiBuyThreshold: 58,
    qsc_rsiSellThreshold: 42,
    qsc_volumeExhaustionMultiplier: 2.5,
    qsc_marketCohesionCandles: 2,

    // Agent 16: Ichimoku Trend Rider
    ichi_conversionPeriod: 9,
    ichi_basePeriod: 26,
    ichi_laggingSpanPeriod: 52,
    ichi_displacement: 26,

    // Agent 11: Historic Expert
    he_trendSmaPeriod: 30,
    he_fastEmaPeriod: 9,
    he_slowEmaPeriod: 21,
    he_rsiPeriod: 14,
    he_rsiMidline: 50,
    he_adxTrendThreshold: 20,
    
    // Agent 13: The Chameleon
    ch_fastEmaPeriod: 9,
    ch_slowEmaPeriod: 21,
    ch_trendEmaPeriod: 200,
    ch_adxThreshold: 22,
    
    // Agent 14: The Sentinel (Refactored for adaptive logic)
    sentinel_scoreThreshold: 70,
    sentinel_emaFastPeriod: 50,
    sentinel_emaSlowPeriod: 200,
    sentinel_adxPeriod: 14,
    sentinel_rsiPeriod: 14,
    sentinel_stPeriod: 10,
    sentinel_stMultiplier: 3.0,
    sentinel_invalidationCandleLimit: 15,
    sentinel_rsiMomentumExitLong: 48,
    sentinel_rsiMomentumExitShort: 52,
    sentinel_rsiDivergenceLookback: 21,
    sentinel_bbwAtrFactor: 0.5,
    sentinel_emaDistanceAtrMultiplier: 2.5,
    // Fix: Add default values for missing sentinel properties
    sentinel_useSrLevelsForTp: false,
    sentinel_strongTrendAdx: 28,
    sentinel_strongTrendThreshold: 65,
    sentinel_choppyTrendAdx: 20,
    sentinel_choppyTrendThreshold: 85,
    sentinel_trendingWeightMultiplier: 1.2,
    sentinel_transitioningWeightMultiplier: 1.5,
    sentinel_bbwSqueezeThreshold: 0.015,
    sentinel_atrChaosThreshold: 3.0,
    sentinel_volumeFilterMultiplier: 0.8,
    sentinel_srZoneAtrBuffer: 0.5,

    // Agent 17: Momentum Swing Trader
    mst_emaFastPeriod: 50,
    mst_emaSlowPeriod: 200,
    mst_macdFastPeriod: 12,
    mst_macdSlowPeriod: 26,
    mst_macdSignalPeriod: 9,

    // Agent 18: The Conductor
    conductor_swingLookback: 8,
    conductor_rsiDivergenceLookback: 14,
    conductor_convictionThreshold: 75,
    conductor_structureWeight: 40,
    conductor_momentumWeight: 30,
    conductor_contextWeight: 15,
    conductor_confirmationWeight: 15,
    conductor_volumeMultiplier: 1.2,
    conductor_slAtrMultiplier: 1.5,
    conductor_strongTrendAdx: 28,
    conductor_strongTrendThreshold: 68,
    conductor_choppyTrendAdx: 20,
    conductor_choppyTrendThreshold: 82,
    conductor_structureWeightMultiplier: 1.25,

    // SMC Reversal Veto
    smc_divergenceLookback: 12,
    smc_volumeMultiplier: 2.0,
};


// --- TIMEFRAME-SPECIFIC PARAMETER OVERRIDES ---

export const EXHAUSTION_FILTER_TIMEFRAME_SETTINGS: Record<string, { overbought: number, oversold: number }> = {
    '1m':  { overbought: 95, oversold: 5 },
    '3m':  { overbought: 90, oversold: 10 },
    '5m':  { overbought: 88, oversold: 12 },
    '15m': { overbought: 85, oversold: 15 },
    '30m': { overbought: 82, oversold: 18 },
    '1h':  { overbought: 80, oversold: 20 },
    '4h':  { overbought: 80, oversold: 20 },
    '1d':  { overbought: 80, oversold: 20 },
};

export const SMC_VETO_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { smc_divergenceLookback: 5, smc_volumeMultiplier: 1.5 },
    '3m':  { smc_divergenceLookback: 8, smc_volumeMultiplier: 2.0 },
    '5m':  { smc_divergenceLookback: 12, smc_volumeMultiplier: 2.0 },
    '15m': { smc_divergenceLookback: 20, smc_volumeMultiplier: 2.5 },
    '30m': { smc_divergenceLookback: 20, smc_volumeMultiplier: 2.5 },
    '1h':  { smc_divergenceLookback: 20, smc_volumeMultiplier: 2.5 },
    '4h':  { smc_divergenceLookback: 20, smc_volumeMultiplier: 2.5 },
    '1d':  { smc_divergenceLookback: 20, smc_volumeMultiplier: 2.5 },
};

export const CONDUCTOR_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { conductor_swingLookback: 5, conductor_convictionThreshold: 80, conductor_slAtrMultiplier: 2.0, conductor_strongTrendAdx: 32, conductor_choppyTrendAdx: 25, conductor_strongTrendThreshold: 75, conductor_choppyTrendThreshold: 85 },
    '3m':  { conductor_swingLookback: 6, conductor_convictionThreshold: 78, conductor_slAtrMultiplier: 1.9, conductor_strongTrendAdx: 30, conductor_choppyTrendAdx: 23, conductor_strongTrendThreshold: 72, conductor_choppyTrendThreshold: 84 },
    '5m':  { conductor_swingLookback: 8, conductor_convictionThreshold: 75, conductor_slAtrMultiplier: 1.8, conductor_strongTrendAdx: 28, conductor_choppyTrendAdx: 20, conductor_strongTrendThreshold: 68, conductor_choppyTrendThreshold: 82 },
    '15m': { conductor_swingLookback: 10, conductor_convictionThreshold: 70, conductor_slAtrMultiplier: 2.0, conductor_strongTrendAdx: 25, conductor_choppyTrendAdx: 18, conductor_strongTrendThreshold: 65, conductor_choppyTrendThreshold: 78 },
    '30m': { conductor_swingLookback: 10, conductor_convictionThreshold: 68, conductor_slAtrMultiplier: 2.2, conductor_strongTrendAdx: 25, conductor_choppyTrendAdx: 18, conductor_strongTrendThreshold: 62, conductor_choppyTrendThreshold: 75 },
    '1h':  { conductor_swingLookback: 12, conductor_convictionThreshold: 65, conductor_slAtrMultiplier: 2.5, conductor_strongTrendAdx: 23, conductor_choppyTrendAdx: 17, conductor_strongTrendThreshold: 60, conductor_choppyTrendThreshold: 72 },
    '4h':  { conductor_swingLookback: 15, conductor_convictionThreshold: 65, conductor_slAtrMultiplier: 3.0, conductor_strongTrendAdx: 22, conductor_choppyTrendAdx: 16, conductor_strongTrendThreshold: 58, conductor_choppyTrendThreshold: 70 },
    '1d':  { conductor_swingLookback: 15, conductor_convictionThreshold: 60, conductor_slAtrMultiplier: 3.5, conductor_strongTrendAdx: 20, conductor_choppyTrendAdx: 15, conductor_strongTrendThreshold: 55, conductor_choppyTrendThreshold: 68 },
};

export const QUANTUM_SCALPER_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    // Scalping: Higher thresholds for BBW to reflect naturally higher volatility.
    '1m':  { qsc_adxThreshold: 32, qsc_rsiMomentumThreshold: 65, qsc_rsiOverextendedLong: 70, qsc_rsiOverextendedShort: 30, qsc_trendScoreThreshold: 88, qsc_bbwSqueezeThreshold: 0.012 },
    '3m':  { qsc_adxThreshold: 30, qsc_rsiMomentumThreshold: 62, qsc_rsiOverextendedLong: 82, qsc_rsiOverextendedShort: 18, qsc_trendScoreThreshold: 85, qsc_bbwSqueezeThreshold: 0.010 },
    '5m':  { qsc_adxThreshold: 28, qsc_rsiMomentumThreshold: 60, qsc_rsiOverextendedLong: 80, qsc_rsiOverextendedShort: 20, qsc_trendScoreThreshold: 80, qsc_bbwSqueezeThreshold: 0.008 },
    // Day Trading: Balanced thresholds.
    '15m': { qsc_adxThreshold: 25, qsc_rsiMomentumThreshold: 58, qsc_rsiOverextendedLong: 78, qsc_rsiOverextendedShort: 22, qsc_trendScoreThreshold: 78, qsc_bbwSqueezeThreshold: 0.006 },
    '30m': { qsc_adxThreshold: 23, qsc_rsiMomentumThreshold: 55, qsc_rsiOverextendedLong: 75, qsc_rsiOverextendedShort: 25, qsc_trendScoreThreshold: 75, qsc_bbwSqueezeThreshold: 0.005 },
    '1h':  { qsc_adxThreshold: 22, qsc_rsiMomentumThreshold: 55, qsc_rsiOverextendedLong: 72, qsc_rsiOverextendedShort: 28, qsc_trendScoreThreshold: 70, qsc_bbwSqueezeThreshold: 0.0045 },
    // Swing Trading: Lower thresholds for BBW as trends are smoother.
    '4h':  { qsc_adxThreshold: 20, qsc_rsiMomentumThreshold: 52, qsc_rsiOverextendedLong: 70, qsc_rsiOverextendedShort: 30, qsc_trendScoreThreshold: 68, qsc_bbwSqueezeThreshold: 0.004 },
    '1d':  { qsc_adxThreshold: 20, qsc_rsiMomentumThreshold: 52, qsc_rsiOverextendedLong: 70, qsc_rsiOverextendedShort: 30, qsc_trendScoreThreshold: 65, qsc_bbwSqueezeThreshold: 0.0035 },
};

export const HISTORIC_EXPERT_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { he_trendSmaPeriod: 50, he_fastEmaPeriod: 5, he_slowEmaPeriod: 10, he_adxTrendThreshold: 25 },
    '3m':  { he_trendSmaPeriod: 50, he_fastEmaPeriod: 7, he_slowEmaPeriod: 14, he_adxTrendThreshold: 25 },
    '5m':  { he_trendSmaPeriod: 40, he_fastEmaPeriod: 8, he_slowEmaPeriod: 18, he_adxTrendThreshold: 22 },
    '15m': { he_trendSmaPeriod: 30, he_fastEmaPeriod: 9, he_slowEmaPeriod: 21, he_adxTrendThreshold: 20 },
    '30m': { he_trendSmaPeriod: 25, he_fastEmaPeriod: 10, he_slowEmaPeriod: 24, he_adxTrendThreshold: 20 },
    '1h':  { he_trendSmaPeriod: 20, he_fastEmaPeriod: 12, he_slowEmaPeriod: 26, he_adxTrendThreshold: 20 },
    '4h':  { he_trendSmaPeriod: 20, he_fastEmaPeriod: 12, he_slowEmaPeriod: 26, he_adxTrendThreshold: 20 },
    '1d':  { he_trendSmaPeriod: 20, he_fastEmaPeriod: 12, he_slowEmaPeriod: 26, he_adxTrendThreshold: 20 },
};

export const CHAMELEON_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { ch_trendEmaPeriod: 100, ch_adxThreshold: 25, ch_fastEmaPeriod: 8, ch_slowEmaPeriod: 18 },
    '3m':  { ch_trendEmaPeriod: 150, ch_adxThreshold: 23, ch_fastEmaPeriod: 9, ch_slowEmaPeriod: 20 },
    '5m':  { ch_trendEmaPeriod: 200, ch_adxThreshold: 22 }, // Uses default EMA params
    '30m': {},
};

export const SENTINEL_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    // Adaptive SuperTrend Multiplier: Higher for low TFs, lower for high TFs.
    '1m':  { sentinel_stMultiplier: 3.5 },
    '3m':  { sentinel_stMultiplier: 3.5 },
    '5m':  { sentinel_stMultiplier: 3.0 },
    '15m': { sentinel_stMultiplier: 3.0 },
    '30m': { sentinel_stMultiplier: 3.0 },
    '1h':  { sentinel_stMultiplier: 3.0 },
    '4h':  { sentinel_stMultiplier: 2.5 },
    '1d':  { sentinel_stMultiplier: 2.5 },
};

export const ICHIMOKU_TREND_RIDER_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  {},
    '3m':  {},
    '5m':  {},
    '15m': {},
    '30m': {},
    '1h':  {},
    '4h':  {},
    '1d':  {},
};

export const MOMENTUM_SWING_TRADER_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '5m':  { mst_emaFastPeriod: 50, mst_emaSlowPeriod: 200 },
    '15m': { mst_emaFastPeriod: 50, mst_emaSlowPeriod: 200 },
    '30m': { mst_emaFastPeriod: 50, mst_emaSlowPeriod: 200 },
    '1h':  { mst_emaFastPeriod: 50, mst_emaSlowPeriod: 200 },
};

/**
 * A helper function to get the correct, timeframe-specific parameters for a given agent.
 * This now merges general SMC settings with agent-specific settings.
 * @param agentId The ID of the agent.
 * @param timeFrame The timeframe string (e.g., '5m', '1h').
 * @returns An object with the agent's parameters for that timeframe.
 */
export const getAgentTimeframeSettings = (agentId: number, timeFrame: string): Partial<AgentParams> => {
    const smcSettings = SMC_VETO_TIMEFRAME_SETTINGS[timeFrame] || {};
    let agentSettings: Partial<AgentParams> = {};

    switch (agentId) {
        case 9:  agentSettings = QUANTUM_SCALPER_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 11: agentSettings = HISTORIC_EXPERT_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 13: agentSettings = CHAMELEON_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 14: agentSettings = SENTINEL_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 16: agentSettings = ICHIMOKU_TREND_RIDER_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 17: agentSettings = MOMENTUM_SWING_TRADER_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 18: agentSettings = CONDUCTOR_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
    }

    return { ...smcSettings, ...agentSettings };
};


// --- PAPER TRADING WALLETS ---
export const MOCK_PAPER_SPOT_WALLET: WalletBalance[] = [
    { asset: 'USDT', free: 10000.50, locked: 0, total: 10000.50, usdValue: 10000.50 },
    { asset: 'BTC', free: 0.5, locked: 0.1, total: 0.6, usdValue: 39000.00 },
    { asset: 'ETH', free: 10, locked: 2, total: 12, usdValue: 42000.00 },
];

export const MOCK_PAPER_FUTURES_WALLET: WalletBalance[] = [
    { asset: 'USDT', free: 25000.75, locked: 5000, total: 30000.75, usdValue: 30000.75 },
    { asset: 'BUSD', free: 10000.00, locked: 0, total: 10000.00, usdValue: 10000.00 },
];

// --- BOT & RISK CONSTANTS ---

/**
 * A non-configurable hard cap on risk to prevent catastrophic single-trade losses.
 * This is the maximum percentage of the *invested margin* that a trade is allowed to lose.
 * For example, a value of 10 with a $100 investment means the max loss (before fees/slippage)
 * is hard-capped at $10, regardless of leverage or the agent's calculated stop loss.
 */
export const MAX_MARGIN_LOSS_PERCENT = 6; // Increased slightly for more flexibility

// New, wider ATR multipliers for initial stop loss placement to give trades more "breathing room"
export const TIMEFRAME_ATR_CONFIG: Record<string, { atrMultiplier: number, riskRewardRatio: number }> = {
    '1m':  { atrMultiplier: 2.0, riskRewardRatio: 1.5 },
    '3m':  { atrMultiplier: 2.2, riskRewardRatio: 1.6 },
    '5m':  { atrMultiplier: 2.5, riskRewardRatio: 1.8 },
    '15m': { atrMultiplier: 2.5, riskRewardRatio: 2.0 },
    '30m': { atrMultiplier: 2.7, riskRewardRatio: 2.2 },
    '1h':  { atrMultiplier: 2.8, riskRewardRatio: 2.5 },
    '4h':  { atrMultiplier: 3.2, riskRewardRatio: 2.8 },
    '1d':  { atrMultiplier: 3.8, riskRewardRatio: 3.0 },
};

/**
 * A new universal default for the post-entry confirmation check.
 */
export const IS_CONFIRMATION_CANDLE_ENABLED = true;

/**
 * A new universal default for the immediate momentum concordance check.
 */
export const IS_MOMENTUM_CONCORDANCE_ENABLED = true;

export const MICRO_TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1m', '3m': '1m', '5m': '1m',
  '15m': '3m', '30m': '3m',
  '1h': '5m', '4h':'15m', '1d': '30m'
};

export const getMicroTimeframe = (tf: string) => MICRO_TIMEFRAME_MAP[tf] || '1m';
