

import { Agent, WalletBalance, AgentParams } from './types';

export const TRADING_PAIRS: string[] = [
    'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT'
];

export const TIME_FRAMES: string[] = ['1m', '3m', '5m', '15m', '1h', '4h', '1d'];

/**
 * The standard taker fee rate for Binance Spot and Futures.
 * Used to calculate estimated PNL after fees.
 */
export const TAKER_FEE_RATE = 0.0004; // 0.04% fee per trade side.

/**
 * A non-negotiable, system-wide minimum risk-to-reward ratio for a trade to be considered valid.
 */
export const MIN_RISK_REWARD_RATIO = 1.2;

/**
 * A multiplier to ensure the profit target is a safe distance away from the breakeven point caused by fees.
 * E.g., 1.5 means the profit must be at least 1.5x the cost of the fee.
 */
export const MIN_PROFIT_BUFFER_MULTIPLIER = 1.5;


export const AGENTS: Agent[] = [
    {
        id: 7,
        name: 'Market Structure Maven',
        description: 'Identifies the main trend with a medium-term EMA, then enters on a pullback to a high-significance, volume-confirmed support/resistance level.',
        indicators: ['Price Action (S/R Levels)', 'Volume', 'EMA (Bias)'],
    },
    {
        id: 9,
        name: 'Quantum Scalper',
        description: 'An adaptive scalper that detects the market regime (trend/range). Exits are managed by a specialized PSAR-based trailing stop for faster reaction times.',
        indicators: ['Market Regime Filter', 'Score-based Entry', 'PSAR Trailing Stop'],
    },
    {
        id: 11,
        name: 'Historic Expert',
        description: 'Determines the main trend using a 30-candle lookback, then enters on a fast EMA crossover with RSI confirmation.',
        indicators: ['SMA (Trend)', 'EMA Crossover (Trigger)', 'RSI (Momentum)'],
    },
];

export const DEFAULT_AGENT_PARAMS: Required<AgentParams> = {
    // General
    rsiPeriod: 14,
    atrPeriod: 14,
    adxPeriod: 14,
    macdFastPeriod: 12,
    macdSlowPeriod: 26,
    macdSignalPeriod: 9,

    // Agent 1: Momentum Master - REMOVED
    adxTrendThreshold: 25,
    mom_emaFastPeriod: 20,
    mom_emaSlowPeriod: 50,
    mom_rsiThresholdBullish: 55,
    mom_rsiThresholdBearish: 45,
    mom_volumeSmaPeriod: 20,
    mom_volumeMultiplier: 1.5,
    mom_atrVolatilityThreshold: 0.3,
    
    // Agent 2: Trend Rider - REMOVED
    tr_emaFastPeriod: 20,
    tr_emaSlowPeriod: 50,
    tr_rsiMomentumBullish: 60,
    tr_rsiMomentumBearish: 40,
    tr_breakoutPeriod: 5,
    tr_volumeSmaPeriod: 20,
    tr_volumeMultiplier: 1.5,

    // Agent 3: Mean Reversionist - REMOVED
    mr_adxPeriod: 14,
    mr_adxThreshold: 25,
    mr_bbPeriod: 20,
    mr_bbStdDev: 2,
    mr_rsiPeriod: 14,
    mr_rsiOversold: 30,
    mr_rsiOverbought: 70,
    mr_htfEmaPeriod: 200,

    // Agent 4: Scalping Expert (NEW LOGIC) - REMOVED
    se_emaFastPeriod: 10,
    se_emaSlowPeriod: 21,
    se_rsiPeriod: 14,
    se_rsiOversold: 35,
    se_rsiOverbought: 65,
    se_bbPeriod: 20,
    se_bbStdDev: 2,
    se_atrPeriod: 14,
    se_atrVolatilityThreshold: 0.4, // Min 0.4% volatility in a candle
    se_macdFastPeriod: 12,
    se_macdSlowPeriod: 26,
    se_macdSignalPeriod: 9,
    se_scoreThreshold: 3,

    // Agent 5: Market Ignition - REMOVED
    mi_bbPeriod: 20,
    mi_bbStdDev: 2,
    mi_bbwSqueezeThreshold: 0.015, // Threshold for BBW to be considered a squeeze
    mi_volumeLookback: 20,
    mi_volumeMultiplier: 1.75, // Breakout volume must be 1.75x the average
    mi_emaBiasPeriod: 50,

    // Agent 6: Profit Locker (uses old scalping logic) - REMOVED
    scalp_scoreThreshold: 4,
    scalp_emaPeriod: 50,
    scalp_rsiPeriod: 14,
    scalp_stochRsiPeriod: 14,
    scalp_stochRsiOversold: 20,
    scalp_stochRsiOverbought: 80,
    scalp_superTrendPeriod: 10,
    scalp_superTrendMultiplier: 2,
    scalp_psarStep: 0.02,
    scalp_psarMax: 0.2,
    scalp_obvLookback: 10,
    scalp_obvScore: 2,

    // Agent 7: Market Structure Maven
    msm_htfEmaPeriod: 50,
    msm_swingPointLookback: 5,
    msm_minPivotScore: 2,
    isCandleConfirmationEnabled: false,

    // Agent 9: Quantum Scalper
    qsc_fastEmaPeriod: 9,
    qsc_slowEmaPeriod: 21,
    qsc_adxPeriod: 10,
    qsc_adxThreshold: 25,
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
    qsc_trendScoreThreshold: 4,
    qsc_rangeScoreThreshold: 1,

    // Agent 11: Historic Expert
    he_trendSmaPeriod: 30,
    he_fastEmaPeriod: 9,
    he_slowEmaPeriod: 21,
    he_rsiPeriod: 14,
    he_rsiMidline: 50,
};


// This configuration provides optimized parameters for different timeframes.
// These settings are merged on top of the defaults, and below user customizations.
export const TIMEFRAME_ADAPTIVE_SETTINGS: Record<string, AgentParams> = {
    // Shorter timeframes: more sensitive, quicker reactions
    '1m': {
        mom_rsiThresholdBullish: 60,
        mom_rsiThresholdBearish: 40,
        scalp_stochRsiOversold: 25,
        scalp_stochRsiOverbought: 80,
    },
    '3m': {
        mom_rsiThresholdBullish: 58,
        mom_rsiThresholdBearish: 42,
    },
    '5m': {
        mom_rsiThresholdBullish: 58,
        mom_rsiThresholdBearish: 42,
    },
    '15m': {
        // Uses default momentum/reversion thresholds
    },
    // Longer timeframes: more patient, looking for bigger moves
    '1h': {
        adxTrendThreshold: 22,
        mom_rsiThresholdBullish: 60,
        mom_rsiThresholdBearish: 40,
    },
    '4h': {
        adxTrendThreshold: 20,
        mom_rsiThresholdBullish: 65,
        mom_rsiThresholdBearish: 35,
    },
    '1d': {
        adxTrendThreshold: 18,
        mom_rsiThresholdBullish: 70,
        mom_rsiThresholdBearish: 30,
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
 * This is the maximum percentage of the *investment amount* that a trade is allowed to lose.
 * E.g., a value of 5 means a maximum loss of 5%, which is $5 on a $100 investment.
 */
export const MAX_STOP_LOSS_PERCENT_OF_INVESTMENT = 1;

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