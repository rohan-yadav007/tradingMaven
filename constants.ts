// FIX: Import 'WalletBalance' type.
import { Agent, AgentParams, WalletBalance } from './types';

export const TRADING_PAIRS: string[] = [
    'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT'
];

export const TIME_FRAMES: string[] = ['1m', '3m', '5m', '15m', '1h', '4h', '1d'];

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


export const AGENTS: Agent[] = [
    {
        id: 9,
        name: 'Quantum Scalper',
        description: "A dynamic, aggressive agent using a weighted scoring system. It filters for volatility and trend regime, then scores signals based on Trend, Momentum (VI, OBV), and Confirmation (Ichimoku, Supertrend). Features a Dynamic Momentum Filter to improve entry timing and a Volume Exhaustion Veto to avoid chasing blow-off tops/bottoms. Supports 'Breakout' and 'Pullback' entry modes. Now enhanced with AI-driven filters for MACD, RSI, StochRSI, Bollinger Bands, and ADX strength for higher-conviction entries.",
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
        description: 'A dynamic momentum agent centered on the KST indicator. It uses a long-period EMA for trend direction and ADX to filter for trending conditions. Entries require a KST/signal line crossover confirmed by OBV, ensuring trades align with strong, volume-backed momentum.',
        indicators: ['KST', 'EMA Cross', 'ADX', 'OBV'],
    },
    {
        id: 14,
        name: 'The Sentinel',
        description: 'A comprehensive scoring engine. Analyzes Trend, Momentum, and Confirmation factors, using On-Balance Volume and HTF alignment to weigh momentum and confirm entries. Signals are filtered to avoid high-risk, low-conviction setups.',
        indicators: ['Weighted Scoring', 'Vortex Indicator', 'OBV', 'Multi-Indicator Analysis'],
    },
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
    qsc_adxThreshold: 30,
    qsc_adxChopBuffer: 3,
    qsc_bbPeriod: 20,
    qsc_bbStdDev: 2,
    qsc_bbwSqueezeThreshold: 0.01,
    qsc_stochRsiPeriod: 14,
    qsc_stochRsiOversold: 25,
    qsc_stochRsiOverbought: 75,
    qsc_superTrendPeriod: 10,
    qsc_superTrendMultiplier: 2,
    qsc_psarStep: 0.02,
    qsc_psarMax: 0.2,
    qsc_atrPeriod: 14,
    qsc_atrMultiplier: 1.5,
    qsc_trendScoreThreshold: 60,
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

    // FIX: Add default parameters for Ichimoku Trend Rider agent (ID 16).
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
    // KST Defaults for Agent 13
    ch_kst_rocPer1: 10,
    ch_kst_rocPer2: 15,
    ch_kst_rocPer3: 20,
    ch_kst_rocPer4: 30,
    ch_kst_smaRocPer1: 10,
    ch_kst_smaRocPer2: 10,
    ch_kst_smaRocPer3: 10,
    ch_kst_smaRocPer4: 15,
    ch_kst_signalPeriod: 9,
    
    // Agent 14: The Sentinel
    sentinel_scoreThreshold: 70,
};


// --- TIMEFRAME-SPECIFIC PARAMETER OVERRIDES ---

export const QUANTUM_SCALPER_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { qsc_stochRsiOversold: 20, qsc_stochRsiOverbought: 80, qsc_adxThreshold: 30, viPeriod: 10, qsc_rsiOverextendedLong: 80, qsc_rsiOverextendedShort: 20 },
    '3m':  { qsc_stochRsiOversold: 25, qsc_stochRsiOverbought: 75, qsc_adxThreshold: 28, viPeriod: 12, qsc_rsiOverextendedLong: 78, qsc_rsiOverextendedShort: 22 },
    '5m':  { qsc_stochRsiOversold: 30, qsc_stochRsiOverbought: 70, qsc_adxThreshold: 25, viPeriod: 14, qsc_rsiOverextendedLong: 75, qsc_rsiOverextendedShort: 25, qsc_rsiBuyThreshold: 60, qsc_rsiSellThreshold: 40 },
    '15m': { qsc_stochRsiOversold: 30, qsc_stochRsiOverbought: 70, qsc_adxThreshold: 25, viPeriod: 14, qsc_rsiOverextendedLong: 70, qsc_rsiOverextendedShort: 30 },
    '1h':  { qsc_stochRsiOversold: 30, qsc_stochRsiOverbought: 70, qsc_adxThreshold: 22, viPeriod: 18, qsc_rsiOverextendedLong: 70, qsc_rsiOverextendedShort: 30 },
    '4h':  { qsc_stochRsiOversold: 35, qsc_stochRsiOverbought: 65, qsc_adxThreshold: 22, viPeriod: 20, qsc_rsiOverextendedLong: 70, qsc_rsiOverextendedShort: 30 },
    '1d':  { qsc_stochRsiOversold: 35, qsc_stochRsiOverbought: 65, qsc_adxThreshold: 22, viPeriod: 20, qsc_rsiOverextendedLong: 70, qsc_rsiOverextendedShort: 30 },
};

export const HISTORIC_EXPERT_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { he_trendSmaPeriod: 50, he_fastEmaPeriod: 5, he_slowEmaPeriod: 10, he_adxTrendThreshold: 25 },
    '3m':  { he_trendSmaPeriod: 50, he_fastEmaPeriod: 7, he_slowEmaPeriod: 14, he_adxTrendThreshold: 25 },
    '5m':  { he_trendSmaPeriod: 40, he_fastEmaPeriod: 8, he_slowEmaPeriod: 18, he_adxTrendThreshold: 22 },
    '15m': { he_trendSmaPeriod: 30, he_fastEmaPeriod: 9, he_slowEmaPeriod: 21, he_adxTrendThreshold: 20 },
    '1h':  { he_trendSmaPeriod: 20, he_fastEmaPeriod: 12, he_slowEmaPeriod: 26, he_adxTrendThreshold: 20 },
    '4h':  { he_trendSmaPeriod: 20, he_fastEmaPeriod: 12, he_slowEmaPeriod: 26, he_adxTrendThreshold: 20 },
    '1d':  { he_trendSmaPeriod: 20, he_fastEmaPeriod: 12, he_slowEmaPeriod: 26, he_adxTrendThreshold: 20 },
};

export const CHAMELEON_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { ch_trendEmaPeriod: 100, ch_adxThreshold: 25, ch_kst_rocPer1: 8, ch_kst_rocPer2: 12, ch_kst_rocPer3: 16, ch_kst_rocPer4: 24, ch_kst_smaRocPer1: 8, ch_kst_smaRocPer2: 8, ch_kst_smaRocPer3: 8, ch_kst_smaRocPer4: 12 },
    '3m':  { ch_trendEmaPeriod: 150, ch_adxThreshold: 23, ch_kst_rocPer1: 9, ch_kst_rocPer2: 13, ch_kst_rocPer3: 17, ch_kst_rocPer4: 26, ch_kst_smaRocPer1: 9, ch_kst_smaRocPer2: 9, ch_kst_smaRocPer3: 9, ch_kst_smaRocPer4: 13 },
    '5m':  { ch_trendEmaPeriod: 200, ch_adxThreshold: 22 }, // Uses default KST params
};

export const SENTINEL_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { sentinel_scoreThreshold: 75, viPeriod: 10 },
    '3m':  { sentinel_scoreThreshold: 75, viPeriod: 12 },
    '5m':  { sentinel_scoreThreshold: 70, viPeriod: 14 },
    '15m': { sentinel_scoreThreshold: 70, viPeriod: 14 },
    '1h':  { sentinel_scoreThreshold: 65, viPeriod: 18 },
    '4h':  { sentinel_scoreThreshold: 65, viPeriod: 20 },
    '1d':  { sentinel_scoreThreshold: 60, viPeriod: 20 },
};

// FIX: Add timeframe settings constant for Ichimoku Trend Rider agent.
export const ICHIMOKU_TREND_RIDER_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  {},
    '3m':  {},
    '5m':  {},
    '15m': {},
    '1h':  {},
    '4h':  {},
    '1d':  {},
};

/**
 * A helper function to get the correct, timeframe-specific parameters for a given agent.
 * @param agentId The ID of the agent.
 * @param timeFrame The timeframe string (e.g., '5m', '1h').
 * @returns An object with the agent's parameters for that timeframe.
 */
export const getAgentTimeframeSettings = (agentId: number, timeFrame: string): Partial<AgentParams> => {
    switch (agentId) {
        case 9:  return QUANTUM_SCALPER_TIMEFRAME_SETTINGS[timeFrame] || {};
        case 11: return HISTORIC_EXPERT_TIMEFRAME_SETTINGS[timeFrame] || {};
        case 13: return CHAMELEON_TIMEFRAME_SETTINGS[timeFrame] || {};
        case 14: return SENTINEL_TIMEFRAME_SETTINGS[timeFrame] || {};
        // FIX: Add case for Ichimoku Trend Rider agent.
        case 16: return ICHIMOKU_TREND_RIDER_TIMEFRAME_SETTINGS[timeFrame] || {};
        default: return {};
    }
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
export const MAX_MARGIN_LOSS_PERCENT = 7; // Increased slightly for more flexibility

// New, wider ATR multipliers for initial stop loss placement to give trades more "breathing room"
export const TIMEFRAME_ATR_CONFIG: Record<string, { atrMultiplier: number, riskRewardRatio: number }> = {
    '1m':  { atrMultiplier: 2.0, riskRewardRatio: 1.5 },
    '3m':  { atrMultiplier: 2.2, riskRewardRatio: 1.5 },
    '5m':  { atrMultiplier: 2.5, riskRewardRatio: 1.8 },
    '15m': { atrMultiplier: 2.5, riskRewardRatio: 2.0 },
    '1h':  { atrMultiplier: 2.8, riskRewardRatio: 2.2 },
    '4h':  { atrMultiplier: 3.2, riskRewardRatio: 2.5 },
    '1d':  { atrMultiplier: 3.8, riskRewardRatio: 3.0 },
};