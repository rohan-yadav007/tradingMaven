
import { Agent, WalletBalance, AgentParams } from './types';

export const TRADING_PAIRS: string[] = [
    'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT'
];

export const TIME_FRAMES: string[] = ['1m', '3m', '5m', '15m', '1h', '4h', '1d'];

/**
 * The standard taker fee rate for Binance Spot and Futures.
 * Used to calculate estimated PNL after fees.
 */
export const TAKER_FEE_RATE = 0.001; // 0.1% fee per trade side.

export const AGENTS: Agent[] = [
    {
        id: 1,
        name: 'Momentum Master',
        description: 'Identifies a strong trend, then waits for a pullback on RSI and MACD to enter, avoiding chasing peaks.',
        indicators: ['RSI', 'MACD', 'EMA (20, 50)', 'ADX', 'ATR']
    },
    {
        id: 2,
        name: 'Trend Rider',
        description: 'A pure momentum-following agent. It enters trades when a strong trend is established and momentum is high, aiming to ride the trend. Good for strong market moves.',
        indicators: ['EMA (20, 50)', 'ADX', 'RSI', 'Price Action']
    },
    {
        id: 4,
        name: 'Scalping Expert',
        description: "A multi-indicator confirmation strategy. Enters on pullbacks (using Bollinger Bands & RSI) within a confirmed trend (EMA cross, MACD). Exits on MACD momentum fade or an ATR-based trailing stop.",
        indicators: ['EMA Cross', 'MACD', 'RSI', 'Bollinger Bands', 'ATR']
    },
    {
        id: 6,
        name: 'Profit Locker',
        description: "Uses a flexible, score-based entry (EMA, SuperTrend, StochRSI, etc.). Its exit strategy is twofold: it closes on signal reversal for capital protection, and it also moves the stop-loss to lock in profits once a minimum gain is achieved.",
        indicators: ["Score-Based Entry (EMA, SuperTrend, PSAR, StochRSI)", "Minimum Profit Protection Exit"]
    },
    {
        id: 7,
        name: 'Market Structure Maven',
        description: 'Identifies the main trend with a long-term EMA, then enters on a pullback to a confirmed swing point (support/resistance). Trades with the trend.',
        indicators: ['Price Action (Swing Points)', 'EMA (Bias)'],
    },
    {
        id: 9,
        name: 'Quantum Scalper',
        description: 'An aggressive, adaptive scalper. It detects the market regime (trend/range) and uses a tailored scoring system for entries. Exits are managed by a PSAR trailing stop combined with a minimum profit protector safety net.',
        indicators: ['Market Regime Filter (EMA, ADX)', 'Score-based (StochRSI, MACD, Supertrend)', 'PSAR Trailing Exit'],
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

    // Agent 1: Momentum Master
    adxTrendThreshold: 25,
    mom_emaFastPeriod: 20,
    mom_emaSlowPeriod: 50,
    mom_rsiThresholdBullish: 55,
    mom_rsiThresholdBearish: 45,
    mom_volumeSmaPeriod: 20,
    mom_volumeMultiplier: 1.5,
    
    // Agent 2: Trend Rider
    tr_emaFastPeriod: 20,
    tr_emaSlowPeriod: 50,
    tr_rsiMomentumBullish: 60,
    tr_rsiMomentumBearish: 40,
    tr_breakoutPeriod: 5,

    // Agent 4: Scalping Expert (NEW LOGIC)
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

    // Agent 6: Profit Locker (uses old scalping logic)
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
    msm_htfEmaPeriod: 200,
    msm_swingPointLookback: 5,

    // Agent 9: Quantum Scalper
    qsc_fastEmaPeriod: 9,
    qsc_slowEmaPeriod: 21,
    qsc_adxPeriod: 10,
    qsc_adxThreshold: 20,
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
    qsc_trendScoreThreshold: 3,
    qsc_rangeScoreThreshold: 2,
};


// This configuration provides optimized parameters for different timeframes.
// These settings are merged on top of the defaults, and below user customizations.
export const TIMEFRAME_ADAPTIVE_SETTINGS: Record<string, AgentParams> = {
    // Shorter timeframes: more sensitive, quicker reactions
    '1m': {
        mom_rsiThresholdBullish: 60,
        mom_rsiThresholdBearish: 40,
        scalp_stochRsiOversold: 15,
        scalp_stochRsiOverbought: 85,
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
export const MAX_STOP_LOSS_PERCENT_OF_INVESTMENT = 5;
