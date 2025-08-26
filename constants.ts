

import { Agent, WalletBalance, AgentParams } from './types';

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
        id: 7,
        name: 'Market Structure Maven',
        description: 'Identifies trend with a dynamic EMA. Enters on pullbacks to S/R zones, confirmed by Vortex and OBV momentum. All signals are filtered to avoid entries on climactic, high-volume candles.',
        indicators: ['Price Action (S/R Levels)', 'Volume', 'EMA (Bias)', 'Vortex Indicator', 'OBV'],
    },
    {
        id: 9,
        name: 'Quantum Scalper',
        description: "A dynamic, aggressive agent using a weighted scoring system. It filters for volatility and trend regime, then scores signals based on Trend, Momentum (VI, OBV), and Confirmation (Ichimoku, Supertrend). Supports 'Breakout' and 'Pullback' entry modes.",
        indicators: ['Market Regime Filter (ADX)', 'Volatility Filter (BBW)', 'Ichimoku Cloud', 'OBV'],
    },
    {
        id: 11,
        name: 'Historic Expert',
        description: 'A robust trend-follower using an SMA for trend bias. Enters on pullbacks, with entries confirmed by strong momentum from both RSI and On-Balance Volume (OBV). All signals are filtered to avoid entries on climactic, high-volume candles.',
        indicators: ['SMA (Trend)', 'EMA (Pullback)', 'RSI (Momentum)', 'OBV (Confirmation)'],
    },
    {
        id: 13,
        name: 'The Chameleon',
        description: 'A dynamic momentum agent centered on the KST indicator. It uses a long-period EMA for trend direction and ADX to filter for trending conditions. Entries require both a KST/signal line crossover and confirmation that KST is in bullish/bearish territory (above/below the zero line), ensuring it trades with strong, confirmed momentum. Best suited for lower timeframes (1m-15m).',
        indicators: ['KST', 'EMA Cross', 'ADX', 'OBV'],
    },
    {
        id: 14,
        name: 'The Sentinel',
        description: 'A comprehensive scoring engine. Analyzes Trend (35%), Momentum (40%), and Confirmation (25%) factors, using On-Balance Volume to weigh momentum and confirm entries. All signals are filtered to avoid entries on climactic, high-volume candles.',
        indicators: ['Weighted Scoring', 'Vortex Indicator', 'OBV', 'Multi-Indicator Analysis'],
    },
    {
        id: 15,
        name: 'Institutional Flow Tracer',
        description: 'Tracks institutional activity using VWAP. Aligns with the long-term trend (200-EMA) and enters on confirmed bounces with RSI and OBV flow to confirm momentum. All signals are filtered to avoid entries on climactic, high-volume candles.',
        indicators: ['VWAP', 'EMA (Trend)', 'Price Action', 'RSI', 'OBV'],
    },
    {
        id: 16,
        name: 'Ichimoku Trend Rider',
        description: 'A pure trend system using Ichimoku. Enters on Kumo breakouts confirmed with the Vortex Indicator and On-Balance Volume to validate breakout momentum. All signals are filtered to avoid entries on climactic, high-volume candles.',
        indicators: ['Ichimoku Cloud', 'Vortex Indicator', 'OBV'],
    },
    {
        id: 17,
        name: 'The Detonator',
        description: 'A high-momentum scalper using multi-layer Bollinger Bands to detect explosive volatility. Breakouts are confirmed by trend, momentum, and On-Balance Volume accumulation. All signals are filtered to avoid entries on climactic, high-volume candles.',
        indicators: ['Bollinger Bands (x4)', 'EMA', 'RSI', 'Volume', 'OBV'],
    },
    {
        id: 18,
        name: 'Candlestick Prophet',
        description: 'A pure price action agent that trades based on classic single and multi-candlestick reversal patterns. It filters entries with a short-term EMA to confirm momentum and OBV for volume validation.',
        indicators: ['Candlestick Patterns', 'EMA (Momentum)', 'OBV'],
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
    cooldownCandles: 3,

    // Agent 1: Momentum Master
    adxTrendThreshold: 25,
    mom_emaFastPeriod: 20,
    mom_emaSlowPeriod: 50,
    mom_rsiThresholdBullish: 55,
    mom_rsiThresholdBearish: 45,
    mom_volumeSmaPeriod: 20,
    mom_volumeMultiplier: 1.5,
    mom_atrVolatilityThreshold: 0.3,
    
    // Agent 2: Trend Rider
    tr_emaFastPeriod: 20,
    tr_emaSlowPeriod: 50,
    tr_rsiMomentumBullish: 60,
    tr_rsiMomentumBearish: 40,
    tr_breakoutPeriod: 5,
    tr_volumeSmaPeriod: 20,
    tr_volumeMultiplier: 1.5,

    // Agent 3: Mean Reversionist
    mr_adxPeriod: 14,
    mr_adxThreshold: 25,
    mr_bbPeriod: 20,
    mr_bbStdDev: 2,
    mr_rsiPeriod: 14,
    mr_rsiOversold: 30,
    mr_rsiOverbought: 70,
    mr_htfEmaPeriod: 200,

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
    se_scoreThreshold: 3,

    // Agent 5: Market Ignition
    mi_bbPeriod: 20,
    mi_bbStdDev: 2,
    mi_bbwSqueezeThreshold: 0.015, // Threshold for BBW to be considered a squeeze
    mi_volumeLookback: 20,
    mi_volumeMultiplier: 1.75, // Breakout volume must be 1.75x the average
    mi_emaBiasPeriod: 50,

    // Agent 6: Profit Locker (uses old scalping logic)
    scalp_scoreThreshold: 4,
    scalp_emaPeriod: 50,
    scalp_rsiPeriod: 14, // Used for StochRSI
    scalp_stochRsiPeriod: 14,
    scalp_stochRsiOversold: 20,
    scalp_stochRsiOverbought: 80,
    scalp_superTrendPeriod: 10,
    scalp_superTrendMultiplier: 2,
    scalp_psarStep: 0.02,
    scalp_psarMax: 0.2,

    // Agent 7: Market Structure Maven
    msm_htfEmaPeriod: 50,
    msm_swingPointLookback: 5,
    msm_minPivotScore: 2,
    isCandleConfirmationEnabled: false,

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
    qsc_trendScoreThreshold: 75,
    qsc_rangeScoreThreshold: 2,
    qsc_ichi_conversionPeriod: 9,
    qsc_ichi_basePeriod: 26,
    qsc_ichi_laggingSpanPeriod: 52,
    qsc_ichi_displacement: 26,
    qsc_vwapDeviationPercent: 0.2,
    qsc_rsiOverextendedLong: 75,
    qsc_rsiOverextendedShort: 25,
    qsc_entryMode: 'breakout',
    qsc_rsiMomentumThreshold: 55,
    qsc_rsiPullbackThreshold: 45,

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
    det_maxSlAtrMult: 2.5,

    // Agent 18: Candlestick Prophet
    csp_emaMomentumPeriod: 10,
};


// --- TIMEFRAME-SPECIFIC PARAMETER OVERRIDES ---

export const MARKET_STRUCTURE_MAVEN_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { msm_htfEmaPeriod: 21, msm_swingPointLookback: 5, viPeriod: 10 },
    '3m':  { msm_htfEmaPeriod: 34, msm_swingPointLookback: 5, viPeriod: 12 },
    '5m':  { msm_htfEmaPeriod: 50, msm_swingPointLookback: 8, viPeriod: 14 },
    '15m': { msm_htfEmaPeriod: 50, msm_swingPointLookback: 10, viPeriod: 14 },
    '1h':  { msm_htfEmaPeriod: 89, msm_swingPointLookback: 12, viPeriod: 18 },
    '4h':  { msm_htfEmaPeriod: 100, msm_swingPointLookback: 15, viPeriod: 20 },
    '1d':  { msm_htfEmaPeriod: 100, msm_swingPointLookback: 20, viPeriod: 20 },
};

export const QUANTUM_SCALPER_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { qsc_stochRsiOversold: 20, qsc_stochRsiOverbought: 80, qsc_adxThreshold: 30, viPeriod: 10, qsc_rsiOverextendedLong: 80, qsc_rsiOverextendedShort: 20 },
    '3m':  { qsc_stochRsiOversold: 25, qsc_stochRsiOverbought: 75, qsc_adxThreshold: 28, viPeriod: 12, qsc_rsiOverextendedLong: 78, qsc_rsiOverextendedShort: 22 },
    '5m':  { qsc_stochRsiOversold: 25, qsc_stochRsiOverbought: 75, qsc_adxThreshold: 28, viPeriod: 14, qsc_rsiOverextendedLong: 75, qsc_rsiOverextendedShort: 25 },
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

export const INSTITUTIONAL_FLOW_TRACER_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { vwap_emaTrendPeriod: 100, vwap_proximityPercent: 0.1, rsiPeriod: 10 },
    '3m':  { vwap_emaTrendPeriod: 150, vwap_proximityPercent: 0.15, rsiPeriod: 12 },
    '5m':  { vwap_emaTrendPeriod: 200, vwap_proximityPercent: 0.2, rsiPeriod: 14 },
    '15m': { vwap_emaTrendPeriod: 200, vwap_proximityPercent: 0.25, rsiPeriod: 14 },
    '1h':  { vwap_emaTrendPeriod: 200, vwap_proximityPercent: 0.3, rsiPeriod: 14 },
    '4h':  { vwap_emaTrendPeriod: 200, vwap_proximityPercent: 0.4, rsiPeriod: 14 },
    '1d':  { vwap_emaTrendPeriod: 200, vwap_proximityPercent: 0.5, rsiPeriod: 14 },
};

export const ICHIMOKU_TREND_RIDER_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { ichi_conversionPeriod: 7,  ichi_basePeriod: 22, viPeriod: 10 },
    '3m':  { ichi_conversionPeriod: 7,  ichi_basePeriod: 22, viPeriod: 12 },
    '5m':  { ichi_conversionPeriod: 9,  ichi_basePeriod: 26, viPeriod: 14 },
    '15m': { ichi_conversionPeriod: 9,  ichi_basePeriod: 26, viPeriod: 14 },
    '1h':  { ichi_conversionPeriod: 12, ichi_basePeriod: 30, viPeriod: 18 },
    '4h':  { ichi_conversionPeriod: 12, ichi_basePeriod: 30, viPeriod: 20 },
    '1d':  { ichi_conversionPeriod: 20, ichi_basePeriod: 60, viPeriod: 20 },
};

export const THE_DETONATOR_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { det_rsi_thresh: 52, det_rr_mult: 1.6, det_sl_atr_mult: 0.9 },
    '3m':  { det_rsi_thresh: 53, det_rr_mult: 1.8, det_sl_atr_mult: 1.0 },
    '5m':  { det_rsi_thresh: 55, det_rr_mult: 2.0, det_sl_atr_mult: 1.1 },
    '15m': { det_rsi_thresh: 58, det_rr_mult: 2.2, det_sl_atr_mult: 1.2 },
    '1h':  { det_rsi_thresh: 60, det_rr_mult: 2.5, det_sl_atr_mult: 1.5 },
    '4h':  { det_rsi_thresh: 62, det_rr_mult: 3.0, det_sl_atr_mult: 1.8 },
    '1d':  { det_rsi_thresh: 65, det_rr_mult: 3.5, det_sl_atr_mult: 2.0 },
};

export const CANDLESTICK_PROPHET_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { csp_emaMomentumPeriod: 21 },
    '3m':  { csp_emaMomentumPeriod: 13 },
    '5m':  { csp_emaMomentumPeriod: 10 },
    '15m': { csp_emaMomentumPeriod: 8 },
    '1h':  { csp_emaMomentumPeriod: 8 },
    '4h':  { csp_emaMomentumPeriod: 5 },
    '1d':  { csp_emaMomentumPeriod: 5 },
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
export const MAX_MARGIN_LOSS_PERCENT = 5;

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