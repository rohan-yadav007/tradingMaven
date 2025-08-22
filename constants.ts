

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
        description: 'Identifies primary trend with a 50-EMA. Enters on pullbacks to high-volume support/resistance zones, often requiring a confirmation candle. Ideal for clear, trending markets. Optimal Timeframes: 15m, 1h, 4h. Leverage: Low to Medium (3-10x).',
        indicators: ['Price Action (S/R Levels)', 'Volume', 'EMA (Bias)'],
    },
    {
        id: 9,
        name: 'Quantum Scalper',
        description: 'A hyper-adaptive scalper. In trending markets, it uses EMA/momentum scores. In ranging markets, it seeks high-probability mean reversions using a confluence of Bollinger Bands, StochRSI, and significant deviation from VWAP. Optimal Timeframes: 1m, 3m, 5m. Leverage: High (20-50x).',
        indicators: ['Market Regime Filter', 'Score-based Entry', 'Vortex Indicator', 'PSAR Trailing Stop'],
    },
    {
        id: 11,
        name: 'Historic Expert',
        description: 'A classic trend-following agent using a 30-SMA for trend direction, an EMA crossover for entry triggers, and RSI for momentum confirmation. Best suited for markets with sustained, long-term trends. Optimal Timeframes: 1h, 4h, 1d. Leverage: Low (2-5x).',
        indicators: ['SMA (Trend)', 'EMA Crossover (Trigger)', 'RSI (Momentum)'],
    },
    {
        id: 13,
        name: 'The Chameleon',
        description: 'An advanced trend-following agent that uses the Ichimoku Cloud to define the market trend. It seeks high-probability entries on pullbacks to the Kijun-sen (Base Line), a key institutional level. Thrives in volatile, trending conditions. Optimal Timeframes: 5m, 15m, 1h. Leverage: Medium (10-20x).',
        indicators: ['Ichimoku Cloud', 'Kijun-sen Pullback', 'Vortex Indicator', 'Volatility Trailing Stop'],
    },
    {
        id: 14,
        name: 'The Sentinel',
        description: 'A comprehensive market-scoring engine. Analyzes Trend (35%), Momentum (40%), and Confirmation (25%) factors. It provides a detailed score breakdown and only enters when a high-confluence setup is detected. An all-rounder for most market conditions. Optimal Timeframes: 5m, 15m. Leverage: Medium (5-15x).',
        indicators: ['Weighted Scoring', 'Vortex Indicator', 'Confluence', 'Multi-Indicator Analysis'],
    },
    {
        id: 15,
        name: 'Institutional Flow Tracer',
        description: 'Tracks institutional activity by using the VWAP as a key dynamic level. It aligns with the long-term trend (200-EMA) and enters on confirmed bounces or rejections from the VWAP. Best for intraday trading. Optimal Timeframes: 5m, 15m. Leverage: Medium (10-20x).',
        indicators: ['VWAP', 'EMA (Trend)', 'Price Action'],
    },
    {
        id: 16,
        name: 'Ichimoku Trend Rider',
        description: 'A pure trend-following system using the full Ichimoku Kinko Hyo indicator. Enters on strong Kumo (Cloud) breakouts and uses the cloud\'s boundaries as a dynamic trailing stop-loss. Excels in markets with strong, sustained trends. Optimal Timeframes: 1h, 4h. Leverage: Low to Medium (3-10x).',
        indicators: ['Ichimoku Cloud', 'Price Action'],
    },
    {
        id: 17,
        name: 'The Detonator',
        description: 'A high-momentum scalper that uses a multi-layer Bollinger Band system to detect explosive volatility. It enters only on high-volume breakouts that are confirmed by trend and momentum filters.',
        indicators: ['Bollinger Bands (x4)', 'EMA', 'RSI', 'Volume', 'ATR'],
    },
];

export const DEFAULT_AGENT_PARAMS: Required<AgentParams> = {
    // General
    rsiPeriod: 14,
    atrPeriod: 14,
    adxPeriod: 14,
    viPeriod: 14,
    macdFastPeriod: 12,
    macdSlowPeriod: 26,
    macdSignalPeriod: 9,
    invalidationCandleLimit: 10,

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
    qsc_trendScoreThreshold: 3,
    qsc_rangeScoreThreshold: 3,
    qsc_vwapDeviationPercent: 0.2,

    // Agent 11: Historic Expert
    he_trendSmaPeriod: 30,
    he_fastEmaPeriod: 9,
    he_slowEmaPeriod: 21,
    he_rsiPeriod: 14,
    he_rsiMidline: 50,
    
    // Agent 13: The Chameleon
    ch_rsiPeriod: 14,
    ch_atrPeriod: 14,
    ch_momentumThreshold: 65,
    ch_volatilityMultiplier: 1.8,
    ch_lookbackPeriod: 10,
    ch_bbPeriod: 20,
    ch_bbStdDev: 2,
    ch_profitLockMultiplier: 1.2,
    ch_volatilitySpikeMultiplier: 2.5,
    ch_psarStep: 0.02,
    ch_psarMax: 0.2,
    ch_scoreThreshold: 5,
    ch_adxThreshold: 22,
    ch_volumeMultiplier: 1.5,
    ch_breathingRoomCandles: 2,
    
    // Agent 14: The Sentinel
    sentinel_scoreThreshold: 70,

    // Agent 15: Institutional Flow Tracer
    vwap_emaTrendPeriod: 200,
    vwap_proximityPercent: 0.2, // 0.2% proximity to VWAP

    // Agent 16: Ichimoku Trend Rider
    ichi_conversionPeriod: 9,
    ichi_basePeriod: 26,
    ichi_laggingSpanPeriod: 52,
    ichi_displacement: 26,

    // Agent 17: The Detonator
    det_bb1_len: 20,
    det_bb1_dev: 2.4,
    det_bb2_len: 50,
    det_bb2_dev: 2.8,
    det_bb3_len: 100,
    det_bb3_dev: 3.2,
    det_bb4_len: 10,
    det_bb4_dev: 1.8,
    det_ema_fast_len: 21,
    det_ema_slow_len: 55,
    det_rsi_len: 14,
    det_rsi_thresh: 52,
    det_vol_len: 20,
    det_vol_mult: 1.6,
    det_atr_len: 14,
    det_sl_atr_mult: 0.9,
    det_rr_mult: 1.6,
    det_max_bar_move_pct: 18.0,
    det_bb_margin_pct: 0.08,
};


// --- TIMEFRAME-SPECIFIC PARAMETER OVERRIDES ---

export const MARKET_STRUCTURE_MAVEN_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { msm_htfEmaPeriod: 21, msm_swingPointLookback: 5 },
    '3m':  { msm_htfEmaPeriod: 34, msm_swingPointLookback: 5 },
    '5m':  { msm_htfEmaPeriod: 50, msm_swingPointLookback: 8 },
    '15m': { msm_htfEmaPeriod: 50, msm_swingPointLookback: 10 },
    '1h':  { msm_htfEmaPeriod: 89, msm_swingPointLookback: 12 },
    '4h':  { msm_htfEmaPeriod: 100, msm_swingPointLookback: 15 },
    '1d':  { msm_htfEmaPeriod: 100, msm_swingPointLookback: 20 },
};

export const QUANTUM_SCALPER_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    // Tighter settings for noisy, low timeframes
    '1m': { qsc_stochRsiOversold: 20, qsc_stochRsiOverbought: 80, qsc_vwapDeviationPercent: 0.1, qsc_adxThreshold: 28 },
    '3m': { qsc_stochRsiOversold: 25, qsc_stochRsiOverbought: 75, qsc_vwapDeviationPercent: 0.15, qsc_adxThreshold: 26 },
    // Baseline settings for its optimal range
    '5m': { qsc_stochRsiOversold: 25, qsc_stochRsiOverbought: 75, qsc_vwapDeviationPercent: 0.2, qsc_adxThreshold: 25 },
    // Relaxed settings as it becomes less effective on higher timeframes
    '15m': { qsc_stochRsiOversold: 30, qsc_stochRsiOverbought: 70, qsc_vwapDeviationPercent: 0.3, qsc_adxThreshold: 22 },
};

export const HISTORIC_EXPERT_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { he_trendSmaPeriod: 50, he_fastEmaPeriod: 5, he_slowEmaPeriod: 10 },
    '3m':  { he_trendSmaPeriod: 50, he_fastEmaPeriod: 7, he_slowEmaPeriod: 14 },
    '5m':  { he_trendSmaPeriod: 40, he_fastEmaPeriod: 8, he_slowEmaPeriod: 18 },
    '15m': { he_trendSmaPeriod: 30, he_fastEmaPeriod: 9, he_slowEmaPeriod: 21 },
    '1h':  { he_trendSmaPeriod: 20, he_fastEmaPeriod: 12, he_slowEmaPeriod: 26 },
    '4h':  { he_trendSmaPeriod: 20, he_fastEmaPeriod: 12, he_slowEmaPeriod: 26 },
    '1d':  { he_trendSmaPeriod: 20, he_fastEmaPeriod: 12, he_slowEmaPeriod: 26 },
};

export const CHAMELEON_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    // Shorter timeframes: faster Ichimoku settings to react to quick changes
    '1m':  { ichi_conversionPeriod: 7,  ichi_basePeriod: 22 },
    '3m':  { ichi_conversionPeriod: 7,  ichi_basePeriod: 22 },
    '5m':  { ichi_conversionPeriod: 9,  ichi_basePeriod: 26 }, // Default
    '15m': { ichi_conversionPeriod: 9,  ichi_basePeriod: 26 },
    // Longer timeframes: slower settings to capture major trends
    '1h':  { ichi_conversionPeriod: 12, ichi_basePeriod: 30 },
    '4h':  { ichi_conversionPeriod: 12, ichi_basePeriod: 30 },
    '1d':  { ichi_conversionPeriod: 12, ichi_basePeriod: 30 },
};

export const SENTINEL_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    // Higher threshold to filter out noise on low timeframes
    '1m':  { sentinel_scoreThreshold: 75 },
    '3m':  { sentinel_scoreThreshold: 75 },
    '5m':  { sentinel_scoreThreshold: 70 }, // Default
    '15m': { sentinel_scoreThreshold: 70 },
    // Lower threshold as signals on higher timeframes are more reliable
    '1h':  { sentinel_scoreThreshold: 65 },
    '4h':  { sentinel_scoreThreshold: 65 },
};

export const INSTITUTIONAL_FLOW_TRACER_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { vwap_emaTrendPeriod: 100, vwap_proximityPercent: 0.1 },
    '3m':  { vwap_emaTrendPeriod: 150, vwap_proximityPercent: 0.15 },
    '5m':  { vwap_emaTrendPeriod: 200, vwap_proximityPercent: 0.2 }, // Default
    '15m': { vwap_emaTrendPeriod: 200, vwap_proximityPercent: 0.25 },
    '1h':  { vwap_emaTrendPeriod: 200, vwap_proximityPercent: 0.3 },
    '4h':  { vwap_emaTrendPeriod: 200, vwap_proximityPercent: 0.4 },
    '1d':  { vwap_emaTrendPeriod: 200, vwap_proximityPercent: 0.5 },
};

export const ICHIMOKU_TREND_RIDER_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { ichi_conversionPeriod: 7,  ichi_basePeriod: 22 },
    '3m':  { ichi_conversionPeriod: 7,  ichi_basePeriod: 22 },
    '5m':  { ichi_conversionPeriod: 9,  ichi_basePeriod: 26 }, // Default
    '15m': { ichi_conversionPeriod: 9,  ichi_basePeriod: 26 },
    '1h':  { ichi_conversionPeriod: 12, ichi_basePeriod: 30 },
    '4h':  { ichi_conversionPeriod: 12, ichi_basePeriod: 30 },
    '1d':  { ichi_conversionPeriod: 20, ichi_basePeriod: 60 },
};

export const THE_DETONATOR_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { det_rsi_thresh: 52, det_rr_mult: 1.6, det_sl_atr_mult: 0.9 }, // Default
    '3m':  { det_rsi_thresh: 53, det_rr_mult: 1.8, det_sl_atr_mult: 1.0 },
    '5m':  { det_rsi_thresh: 55, det_rr_mult: 2.0, det_sl_atr_mult: 1.1 },
    '15m': { det_rsi_thresh: 58, det_rr_mult: 2.2, det_sl_atr_mult: 1.2 },
    '1h':  { det_rsi_thresh: 60, det_rr_mult: 2.5, det_sl_atr_mult: 1.5 },
    '4h':  { det_rsi_thresh: 62, det_rr_mult: 3.0, det_sl_atr_mult: 1.8 },
    '1d':  { det_rsi_thresh: 65, det_rr_mult: 3.5, det_sl_atr_mult: 2.0 },
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
 * E.g., a value of 40 means a maximum loss of 40%, which is $40 on a $100 investment.
 */
export const MAX_STOP_LOSS_PERCENT_OF_INVESTMENT = 25;

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