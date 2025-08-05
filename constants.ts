import { Agent, WalletBalance, AgentParams } from './types';

export const TRADING_PAIRS: string[] = [
    'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT'
];

export const TIME_FRAMES: string[] = ['1m', '3m', '5m', '15m', '1h', '4h', '1d'];

export const AGENTS: Agent[] = [
    {
        id: 1,
        name: 'Momentum Master',
        description: 'Trades aggressively on confirmed trends. Uses ADX to find trending markets, then enters on strong RSI and MACD signals.',
        indicators: ['RSI', 'MACD', 'EMA (20, 50)', 'ADX', 'ATR']
    },
    {
        id: 4,
        name: 'Scalping Expert',
        description: 'A fast-acting agent designed for scalping. It uses a scoring system based on multiple indicators (EMA, SuperTrend, PSAR, StochRSI) to make quick entry decisions when momentum aligns.',
        indicators: ['EMA', 'SuperTrend', 'PSAR', 'StochRSI']
    },
    {
        id: 5,
        name: 'Market Phase Adaptor',
        description: 'The most advanced agent. It first determines if the market is trending, ranging, or choppy. It then deploys a specialized strategy (trend-following or mean-reversion) best suited for the current phase, while staying out of unpredictable conditions.',
        indicators: ['Market Phase Analysis', 'ADX', 'BBW', 'ATR', 'EMA', 'RSI']
    },
    {
        id: 6,
        name: 'Profit Locker',
        description: "Combines the rapid, score-based entry signals of the 'Scalping Expert' with a superior, dynamic profit-securing exit strategy. Designed to enter trades quickly and maximize gains on any favorable move.",
        indicators: ["Score-Based Entry (EMA, SuperTrend, PSAR, StochRSI)", "Dynamic PNL Trailing Stop"]
    },
    {
        id: 7,
        name: 'Market Structure Maven',
        description: 'A professional-grade agent that reads market structure. It identifies the high-timeframe trend, waits for a pullback, and enters on a confirmed "liquidity grab" pattern.',
        indicators: ['EMA (HTF)', 'Price Action', 'Market Structure', 'ATR']
    },
    {
        id: 8,
        name: 'Institutional Scalper',
        description: 'A high-precision scalping agent based on smart money concepts. It ignores traditional indicators, focusing purely on price action to identify liquidity sweeps followed by a powerful, engulfing confirmation candle. Allows for up to 2 re-entries if a setup re-appears after a stop-out.',
        indicators: ['Price Action', 'Liquidity Grabs', 'Engulfing Patterns']
    }
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

    // Agent 4: Scalping Expert
    scalp_scoreThreshold: 3,
    scalp_emaPeriod: 50,
    scalp_rsiPeriod: 14,
    scalp_stochRsiPeriod: 14,
    scalp_stochRsiOversold: 20,
    scalp_stochRsiOverbought: 80,
    scalp_superTrendPeriod: 10,
    scalp_superTrendMultiplier: 2,
    scalp_psarStep: 0.02,
    scalp_psarMax: 0.2,
    
    // Agent 5 & 6: Market Phase Adaptor & Profit Locker
    mpa_adxTrend: 25,
    mpa_adxChop: 20,
    mpa_bbwSqueeze: 0.015,
    mpa_trendEmaFast: 20,
    mpa_trendEmaSlow: 50,
    mpa_rangeBBPeriod: 20,
    mpa_rangeBBStdDev: 2,
    mpa_rangeRsiOversold: 35,
    mpa_rangeRsiOverbought: 65,

    // Agent 7: Market Structure Maven
    msm_htfEmaPeriod: 200,
    msm_swingPointLookback: 5,

    // Agent 8: Institutional Scalper
    inst_lookbackPeriod: 5,
    inst_powerCandleMultiplier: 1.5,
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
        msm_htfEmaPeriod: 200, // on 1h, this approximates a 50 EMA on 4h
    },
    '4h': {
        adxTrendThreshold: 20,
        mom_rsiThresholdBullish: 65,
        mom_rsiThresholdBearish: 35,
        msm_htfEmaPeriod: 200, // on 4h, this approximates an 80 EMA on 1D
    },
    '1d': {
        adxTrendThreshold: 18,
        mom_rsiThresholdBullish: 70,
        mom_rsiThresholdBearish: 30,
        msm_htfEmaPeriod: 50, // on 1d, 50 EMA is a common trend indicator
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
 * The number of candles a bot waits after closing a trade before it starts monitoring again.
 * This only applies if the bot's cooldown is enabled.
 */
export const BOT_COOLDOWN_CANDLES = 3;

/**
 * A non-configurable hard cap on risk to prevent catastrophic single-trade losses.
 * This is the maximum percentage of the *investment amount* that a trade is allowed to lose.
 * E.g., a value of 10 means a maximum loss of 10%, which is $10 on a $100 investment.
 */
export const MAX_STOP_LOSS_PERCENT_OF_INVESTMENT = 10;
