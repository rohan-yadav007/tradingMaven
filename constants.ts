

// constants.ts

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
 * E.g. 1.5 means the profit must be at least 1.5x the cost of the fee.
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
        id: 25,
        name: 'Omega: Unified Predator',
        description: "An advanced multi-dimensional outcome engine. It ignores execution timeframe constraints to synchronize Macro Tide, Structural Voids (FVGs), and Micro-Liquidity Sweeps for institutional-grade high RR trades.",
        indicators: ["Unified Matrix", "FVG Voids", "Liquidity Sweeps", "The Trap"],
    },
    {
        id: 22,
        name: 'The Matrix Strategist',
        description: "A context-switching agent that morphs its strategy based on the timeframe. From high-frequency 1m scalping to macro 1d investing, it uses a pre-optimized matrix of indicators and rules for each market environment.",
        indicators: ["TF Setup Matrix", "Dynamic EMAs", "Time-Decay Exits", "Adaptive RR"],
    },
    {
        id: 20,
        name: 'Supertrend Flipper',
        description: "A pure trend-following agent that uses Supertrend flips to enter and reverse positions. It aims to always be in the market, capturing the majority of a trend.",
        indicators: ["Supertrend"],
    },
    {
        id: 21,
        name: 'Pivot Point SuperTrend',
        description: "A trend-following agent using a custom SuperTrend calculation based on a weighted average of recent pivot points to generate signals.",
        indicators: ["Pivot Points", "ATR", "SuperTrend"],
    },
    {
        id: 19,
        name: 'AstraX Super-Agent',
        description: "A synchronized multi-dimensional brain. It ensures convergence between Structure (Patterns), Momentum (Velocity), Gravity (BTC/HTF Flow), and Utility (Fee Gating) before emitting a signal.",
        indicators: ["Convergence Matrix", "Quantum Handshake", "Vortex Retest", "Utility Gating"],
    },
    {
        id: 18,
        name: 'The Conductor',
        description: "An advanced, context-aware agent that builds a trade thesis based on Market Structure, Momentum Quality, and Liquidity. It prioritizes high-conviction setups by ensuring confluence across multiple factors.",
        indicators: ["Market Structure Analysis", "RSI Divergence", "S/R Zones"],
    },
    {
        id: 9,
        name: 'Quantum Scalper',
        description: "A dynamic, aggressive agent using a weighted scoring system. It filters for volatility and trend regime, then scores signals based on Trend, Momentum, and Confirmation. Supports 'Breakout' and 'Pullback' entry modes.",
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

    // Universal Veto Parameters
    veto_volumeFilterMultiplier: 2.0, 
    veto_srZoneAtrBuffer: 0.5,
    veto_sr_buffer_scalp: 0.3, 
    veto_sr_buffer_swing: 0.8, 
    veto_rsiAlignmentThreshold_bullish: 52,
    veto_rsiAlignmentThreshold_bearish: 48,
    veto_concordanceDivergenceLookback: 15, 
    veto_atrChaosRatio: 2.5, 
    veto_normalizeAtrChaos: true, 
    veto_candlePositionVeto_long: 0.80, 
    veto_candlePositionVeto_short: 0.20, 
    veto_concordanceVolumeMinMultiplier: 0.8, 
    veto_rsiConcordance_strongTrend_bullish: 55,
    veto_rsiConcordance_strongTrend_bearish: 45,
    veto_rsiConcordance_chop_bullish: 51,
    veto_rsiConcordance_chop_bearish: 49,
    veto_concordance_strongTrendAdx: 30,
    veto_concordance_chopAdx: 20,
    veto_atrChaos_graceMultiplier: 1.2,
    veto_atrChaos_strongTrendAdx: 30,
    veto_liquiditySweep_maxAdx: 30,
    veto_microEmaFast: 5,       
    veto_microEmaSlow: 9,       
    veto_pullback_stochRsiPeriod: 14, 
    veto_pullback_stochRsiOversold: 30, 
    veto_pullback_stochRsiOverbought: 70, 

    // TF-Specific Concordance Veto Parameters
    concordance_breakout_stochRsiOverbought: 85,
    concordance_breakout_stochRsiOversold: 15,
    concordance_breakout_macdHistoDecel: true,


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
    
    // Agent 14: The Sentinel V2
    sentinel_entryThreshold: 80,
    sentinel_swingLookback: 8,
    sentinel_structureWeight: 50,
    sentinel_momentumWeight: 30,
    sentinel_contextWeight: 20,
    sentinel_htfMultiplier: 1.1,
    sentinel_htfPenalty: 0.8,
    sentinel_atr_mult_strong: 2.2,
    sentinel_atr_mult_transition: 2.5,
    sentinel_atr_mult_chop: 3.0,
    sentinel_adxPeriod: 14,
    sentinel_stPeriod: 10,
    sentinel_stMultiplier: 3.0,
    sentinel_useSrLevelsForTp: true,
    sentinel_rsiPeriod: 14,

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
    conductor_entryTrigger_candleVelocity: 0.75, 
    conductor_entryTrigger_rsiHookPeriod: 3,

    // Agent 19: AstraX Super-Agent (V8.6 Tuning)
    astraX_executionMode: 'hybrid',
    astraX_sweepLookback: 25,
    astraX_breakoutVolMultiplier: 2.0,
    astraX_pullbackEmaPeriod: 21,
    astraX_adxThreshold: 22,
    astraX_baseThreshold: 62, // Lowered for higher sensitivity
    astraX_strongTrendAdx: 30,
    astraX_chopAdx: 18,
    astraX_strongTrendThreshold: 72,
    astraX_chopThreshold: 85,
    astraX_regimeMultiplier_strong: 0.9,
    astraX_regimeMultiplier_chop: 1.3,
    astraX_weights_structure: 35,
    astraX_weights_momentum: 35,
    astraX_weights_context: 20,
    astraX_weights_confirmation: 10,
    astraX_context_vwapWeight: 40,
    astraX_context_volatilityWeight: 30,
    astraX_context_marketBreadthWeight: 20,
    astraX_context_liquidationWeight: 10,
    astraX_scalp_retestEmaPeriod: 9,
    astraX_scalp_bbPeriod: 20,
    astraX_scalp_bbStdDev: 2.0,
    astraX_confirmation_minVolumeMultiplier: 1.2,
    astraX_confirmation_candleBodyMinRatio: 0.5,
    astraX_supertrendPeriod: 10,
    astraX_supertrendMultiplier: 3.0,
    astraX_sl_multiplier_sweep: 1.5,
    astraX_sl_multiplier_breakout: 2.0,
    astraX_sl_multiplier_pullback: 1.8,
    astraX_breakout_candle_max_atr: 3.0,
    astraX_elasticity_multiplier: 1.0,
    astraX_ratchet_breakeven: 0.5,
    astraX_ratchet_secure: 1.0,
    astraX_ratchet_parabolic: 2.5,
    
    // Agent 20: Supertrend Flipper
    stf_atrPeriod: 10,
    stf_atrMultiplier: 3.0,
    stf_enableDynamicMultiplier: true,
    stf_volatilityPeriod: 100,
    stf_volatilityThreshold_low: 30,
    stf_volatilityThreshold_high: 70,
    stf_multiplier_low: 1.8,
    stf_multiplier_normal: 3.0,
    stf_multiplier_high: 4.5,

    // Agent 21: Pivot Point SuperTrend
    pps_pivotPeriod: 2,
    pps_atrFactor: 3.0,
    pps_atrPeriod: 10,

    // Agent 22: Matrix Strategist Defaults
    ms_1m_emaFast: 9, ms_1m_emaSlow: 21, ms_1m_rsiPeriod: 7, ms_1m_volSpike: 3.0, ms_1m_bbPeriod: 10, ms_1m_bbStd: 1.5,
    ms_3m_ema1: 12, ms_3m_ema2: 26, ms_3m_ema3: 55, ms_3m_rsiPeriod: 14, ms_3m_volMult: 2.0,
    ms_5m_ema1: 20, ms_5m_ema2: 50, ms_5m_ema3: 200, ms_5m_stochK: 14, ms_5m_stochD: 3,
    ms_15m_ema1: 50, ms_15m_ema2: 100, ms_15m_ema3: 200, ms_15m_adxThreshold: 25,
    ms_30m_ema1: 100, ms_30m_ema2: 200, ms_30m_rsiPeriod: 21,
    ms_1h_emaPeriod: 200,
    ms_4h_swingLookback: 10,

    // Agent 25: Omega Predator Defaults
    omega_matrixThreshold: 75,
    omega_aggressiveness: 'Standard',
    omega_fvgLookback: 20,
    omega_sweepDepth: 30,
    omega_minExpectancy: 5.0,
    omega_frequencyAggressiveness: 3,
    omega_orderFlowWeight: 45,

    // SMC Reversal Veto
    smc_divergenceLookback: 12,
    smc_volumeMultiplier: 2.0,
    smc_requireConfluenceOnScalp: true, 
    smc_confluence_bbwSqueezeThreshold: 0.006, 

    // BTC Correlation Veto
    btc_correlation_veto_ema_fast: 8,
    btc_correlation_veto_ema_slow: 21,

    // Risk Management
    risk_atrVolatilityPeriod: 100,
    risk_atrVolatilityPercentile_upper: 80, 
    risk_atrVolatilityPercentile_lower: 20, 
    risk_atrVolatilityMultiplier_upper_adj: 0.5,
    risk_atrVolatilityMultiplier_lower_adj: -0.5,
};


// --- TIMEFRAME-SPECIFIC PARAMETER OVERRIDES ---

export const SUPERTREND_FLIPPER_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { 
        stf_atrPeriod: 10, stf_atrMultiplier: 2.0, 
        stf_volatilityPeriod: 100, stf_volatilityThreshold_low: 35, stf_volatilityThreshold_high: 65,
        stf_multiplier_low: 1.5, stf_multiplier_normal: 2.2, stf_multiplier_high: 3.5
    },
    '3m':  { 
        stf_atrPeriod: 10, stf_atrMultiplier: 2.2,
        stf_volatilityPeriod: 100, stf_volatilityThreshold_low: 35, stf_volatilityThreshold_high: 65,
        stf_multiplier_low: 1.8, stf_multiplier_normal: 2.5, stf_multiplier_high: 4.0
    },
    '5m':  { 
        stf_atrPeriod: 10, stf_atrMultiplier: 2.5,
        stf_volatilityPeriod: 120, stf_volatilityThreshold_low: 30, stf_volatilityThreshold_high: 70,
        stf_multiplier_low: 1.8, stf_multiplier_normal: 2.8, stf_multiplier_high: 4.5
    },
    '15m': { 
        stf_atrPeriod: 12, stf_atrMultiplier: 3.0,
        stf_volatilityPeriod: 150, stf_volatilityThreshold_low: 30, stf_volatilityThreshold_high: 70,
        stf_multiplier_low: 2.0, stf_multiplier_normal: 3.0, stf_multiplier_high: 5.0
    },
    '30m': { 
        stf_atrPeriod: 12, stf_atrMultiplier: 3.0,
        stf_volatilityPeriod: 150, stf_volatilityThreshold_low: 30, stf_volatilityThreshold_high: 70,
        stf_multiplier_low: 2.2, stf_multiplier_normal: 3.2, stf_multiplier_high: 5.5
    },
    '1h':  { 
        stf_atrPeriod: 12, stf_atrMultiplier: 3.2,
        stf_volatilityPeriod: 200, stf_volatilityThreshold_low: 25, stf_volatilityThreshold_high: 75,
        stf_multiplier_low: 2.5, stf_multiplier_normal: 3.5, stf_multiplier_high: 6.0
    },
    '4h':  { 
        stf_atrPeriod: 14, stf_atrMultiplier: 3.5,
        stf_volatilityPeriod: 200, stf_volatilityThreshold_low: 25, stf_volatilityThreshold_high: 75,
        stf_multiplier_low: 2.8, stf_multiplier_normal: 4.0, stf_multiplier_high: 6.5
    },
    '1d':  { 
        stf_atrPeriod: 14, stf_atrMultiplier: 3.5,
        stf_volatilityPeriod: 250, stf_volatilityThreshold_low: 20, stf_volatilityThreshold_high: 80,
        stf_multiplier_low: 3.0, stf_multiplier_normal: 4.5, stf_multiplier_high: 7.0
    },
};

export const PIVOT_POINT_SUPERTREND_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { pps_pivotPeriod: 5, pps_atrFactor: 3.5, pps_atrPeriod: 10 },
    '3m':  { pps_pivotPeriod: 4, pps_atrFactor: 3.0, pps_atrPeriod: 10 },
    '5m':  { pps_pivotPeriod: 3, pps_atrFactor: 3.0, pps_atrPeriod: 10 },
    '15m': { pps_pivotPeriod: 2, pps_atrFactor: 3.0, pps_atrPeriod: 10 },
    '30m': { pps_pivotPeriod: 2, pps_atrFactor: 3.0, pps_atrPeriod: 10 },
    '1h':  { pps_pivotPeriod: 2, pps_atrFactor: 3.0, pps_atrPeriod: 12 },
    '4h':  { pps_pivotPeriod: 2, pps_atrFactor: 3.5, pps_atrPeriod: 14 },
    '1d':  { pps_pivotPeriod: 2, pps_atrFactor: 3.5, pps_atrPeriod: 14 },
};

export const CONCORDANCE_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { concordance_breakout_stochRsiOverbought: 80, concordance_breakout_stochRsiOversold: 20, concordance_breakout_macdHistoDecel: true },
    '3m':  { concordance_breakout_stochRsiOverbought: 85, concordance_breakout_stochRsiOversold: 15, concordance_breakout_macdHistoDecel: true },
    '5m':  { concordance_breakout_stochRsiOverbought: 85, concordance_breakout_stochRsiOversold: 15, concordance_breakout_macdHistoDecel: true },
    '15m': { concordance_breakout_stochRsiOverbought: 90, concordance_breakout_stochRsiOversold: 10, concordance_breakout_macdHistoDecel: false },
    '30m': { concordance_breakout_stochRsiOverbought: 90, concordance_breakout_stochRsiOversold: 10, concordance_breakout_macdHistoDecel: false },
    '1h':  { concordance_breakout_stochRsiOverbought: 95, concordance_breakout_stochRsiOversold: 5, concordance_breakout_macdHistoDecel: false },
    '4h':  { concordance_breakout_stochRsiOverbought: 95, concordance_breakout_stochRsiOversold: 5, concordance_breakout_macdHistoDecel: false },
    '1d':  { concordance_breakout_stochRsiOverbought: 95, concordance_breakout_stochRsiOversold: 5, concordance_breakout_macdHistoDecel: false },
};

export const VETO_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { veto_volumeFilterMultiplier: 1.5, veto_concordanceDivergenceLookback: 8,  veto_atrChaosRatio: 2.0, veto_candlePositionVeto_long: 0.90, veto_candlePositionVeto_short: 0.10, veto_concordanceVolumeMinMultiplier: 1.0 },
    '3m':  { veto_volumeFilterMultiplier: 1.8, veto_concordanceDivergenceLookback: 10, veto_atrChaosRatio: 2.0, veto_candlePositionVeto_long: 0.90, veto_candlePositionVeto_short: 0.10, veto_concordanceVolumeMinMultiplier: 0.9 },
    '5m':  { veto_volumeFilterMultiplier: 2.0, veto_concordanceDivergenceLookback: 12, veto_atrChaosRatio: 2.2, veto_candlePositionVeto_long: 0.85, veto_candlePositionVeto_short: 0.15, veto_concordanceVolumeMinMultiplier: 0.8 },
    '15m': { veto_concordanceDivergenceLookback: 15, veto_concordanceVolumeMinMultiplier: 0.7 },
    '30m': { veto_volumeFilterMultiplier: 2.2, veto_concordanceDivergenceLookback: 18, veto_concordanceVolumeMinMultiplier: 0.7 },
    '1h':  { veto_volumeFilterMultiplier: 2.2, veto_concordanceDivergenceLookback: 20, veto_atrChaosRatio: 2.8, veto_candlePositionVeto_long: 0.75, veto_candlePositionVeto_short: 0.25, veto_concordanceVolumeMinMultiplier: 0.6 },
    '4h':  { veto_volumeFilterMultiplier: 2.5, veto_concordanceDivergenceLookback: 20, veto_atrChaosRatio: 3.0, veto_candlePositionVeto_long: 0.70, veto_candlePositionVeto_short: 0.30, veto_concordanceVolumeMinMultiplier: 0.6 },
    '1d':  { veto_volumeFilterMultiplier: 2.5, veto_concordanceDivergenceLookback: 20, veto_atrChaosRatio: 3.0, veto_candlePositionVeto_long: 0.70, veto_candlePositionVeto_short: 0.30, veto_concordanceVolumeMinMultiplier: 0.5 },
};

export const EXHAUSTION_FILTER_TIMEFRAME_SETTINGS: Record<string, { overbought: number, oversold: number }> = {
    '1m':  { overbought: 90, oversold: 10 },
    '3m':  { overbought: 88, oversold: 12 },
    '5m':  { overbought: 85, oversold: 15 },
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
    '1m':  { qsc_adxThreshold: 32, qsc_rsiMomentumThreshold: 65, qsc_rsiOverextendedLong: 70, qsc_rsiOverextendedShort: 30, qsc_trendScoreThreshold: 88, qsc_bbwSqueezeThreshold: 0.012 },
    '3m':  { qsc_adxThreshold: 30, qsc_rsiMomentumThreshold: 62, qsc_rsiOverextendedLong: 82, qsc_rsiOverextendedShort: 18, qsc_trendScoreThreshold: 85, qsc_bbwSqueezeThreshold: 0.010 },
    '5m':  { qsc_adxThreshold: 28, qsc_rsiMomentumThreshold: 60, qsc_rsiOverextendedLong: 80, qsc_rsiOverextendedShort: 20, qsc_trendScoreThreshold: 80, qsc_bbwSqueezeThreshold: 0.008 },
    '15m': { qsc_adxThreshold: 25, qsc_rsiMomentumThreshold: 58, qsc_rsiOverextendedLong: 78, qsc_rsiOverextendedShort: 22, qsc_trendScoreThreshold: 78, qsc_bbwSqueezeThreshold: 0.006 },
    '30m': { qsc_adxThreshold: 23, qsc_rsiMomentumThreshold: 55, qsc_rsiOverextendedLong: 75, qsc_rsiOverextendedShort: 25, qsc_trendScoreThreshold: 75, qsc_bbwSqueezeThreshold: 0.005 },
    '1h':  { qsc_adxThreshold: 22, qsc_rsiMomentumThreshold: 55, qsc_rsiOverextendedLong: 72, qsc_rsiOverextendedShort: 28, qsc_trendScoreThreshold: 70, qsc_bbwSqueezeThreshold: 0.0045 },
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
    '5m':  { ch_trendEmaPeriod: 200, ch_adxThreshold: 22 }, 
};

export const SENTINEL_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  { sentinel_swingLookback: 5, sentinel_entryThreshold: 85, sentinel_stPeriod: 7, sentinel_stMultiplier: 2.0, sentinel_adxPeriod: 10, sentinel_rsiPeriod: 10 },
    '3m':  { sentinel_swingLookback: 6, sentinel_entryThreshold: 82, sentinel_stPeriod: 7, sentinel_stMultiplier: 2.0, sentinel_adxPeriod: 10, sentinel_rsiPeriod: 10 },
    '5m':  { sentinel_swingLookback: 8, sentinel_entryThreshold: 80, sentinel_stPeriod: 8, sentinel_stMultiplier: 2.2, sentinel_adxPeriod: 12, sentinel_rsiPeriod: 12 },
    '15m': { sentinel_swingLookback: 10, sentinel_entryThreshold: 78, sentinel_stPeriod: 10, sentinel_stMultiplier: 2.5, sentinel_adxPeriod: 14, sentinel_rsiPeriod: 14 },
    '30m': { sentinel_swingLookback: 10, sentinel_entryThreshold: 78, sentinel_stPeriod: 10, sentinel_stMultiplier: 2.5, sentinel_adxPeriod: 14, sentinel_rsiPeriod: 14 },
    '1h':  { sentinel_swingLookback: 12, sentinel_entryThreshold: 75, sentinel_stPeriod: 12, sentinel_stMultiplier: 2.8, sentinel_adxPeriod: 14, sentinel_rsiPeriod: 14 },
    '4h':  { sentinel_swingLookback: 15, sentinel_entryThreshold: 75, sentinel_stPeriod: 12, sentinel_stMultiplier: 3.0, sentinel_adxPeriod: 14, sentinel_rsiPeriod: 14 },
    '1d':  { sentinel_swingLookback: 15, sentinel_entryThreshold: 72, sentinel_stPeriod: 14, sentinel_stMultiplier: 3.0, sentinel_adxPeriod: 14, sentinel_rsiPeriod: 14 },
};

export const ASTRAX_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    // --- SNIPER ZONE (1m - 3m) ---
    // Priority: Momentum (Velocity) and RVOL. Structure is secondary (Liquidity Traps).
    '1m': {
        astraX_weights_structure: 30, astraX_weights_momentum: 45, astraX_weights_context: 15, astraX_weights_confirmation: 10,
        astraX_baseThreshold: 62, astraX_adxThreshold: 20, astraX_sweepLookback: 15, 
        astraX_sl_multiplier_sweep: 1.2, astraX_sl_multiplier_breakout: 1.5, astraX_sl_multiplier_pullback: 1.3,
        astraX_ratchet_breakeven: 0.3, astraX_ratchet_secure: 0.6,
    },
    '3m': {
        astraX_weights_structure: 35, astraX_weights_momentum: 40, astraX_weights_context: 15, astraX_weights_confirmation: 10,
        astraX_baseThreshold: 62, astraX_adxThreshold: 22, astraX_sweepLookback: 20,
        astraX_sl_multiplier_sweep: 1.5, astraX_sl_multiplier_breakout: 1.8,
    },
    
    // --- DAY TRADING ZONE (5m - 1h) ---
    // Priority: Structure (Classic Geometry) and Confirmed Trends.
    '5m': {
        astraX_weights_structure: 40, astraX_weights_momentum: 30, astraX_weights_context: 20, astraX_weights_confirmation: 10,
        astraX_baseThreshold: 60, astraX_adxThreshold: 25, astraX_sweepLookback: 40,
        astraX_sl_multiplier_sweep: 1.5, astraX_sl_multiplier_breakout: 2.0, astraX_sl_multiplier_pullback: 1.6,
    },
    '15m': {
        astraX_weights_structure: 45, astraX_weights_momentum: 25, astraX_weights_context: 20, astraX_weights_confirmation: 10,
        astraX_baseThreshold: 60, astraX_adxThreshold: 25, astraX_sweepLookback: 50,
    },
    '1h': {
        astraX_weights_structure: 50, astraX_weights_momentum: 20, astraX_weights_context: 20, astraX_weights_confirmation: 10,
        astraX_baseThreshold: 60, astraX_adxThreshold: 22,
    },
    
    // --- SWING TRADING ZONE (4h, 1d) ---
    // Priority: Context (HTF Gravity) and Macro S/R Structure.
    '4h': {
        astraX_weights_structure: 35, astraX_weights_momentum: 15, astraX_weights_context: 40, astraX_weights_confirmation: 10,
        astraX_baseThreshold: 60, astraX_adxThreshold: 20, astraX_sweepLookback: 60,
    },
    '1d': {
        astraX_weights_structure: 30, astraX_weights_momentum: 10, astraX_weights_context: 50, astraX_weights_confirmation: 10,
        astraX_baseThreshold: 60, astraX_adxThreshold: 18,
    },
};

export const MATRIX_STRATEGIST_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  {},
    '3m':  {},
    '5m':  {},
    '15m': {},
    '30m': {},
    '1h':  {},
    '4h':  {},
    '1d':  {},
};

export const OMEGA_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    '1m':  {},
    '3m':  {},
    '5m':  {},
    '15m': {},
    '30m': {},
    '1h':  {},
    '4h':  {},
    '1d':  {},
};

/**
 * A helper function to get the correct, timeframe-specific parameters for a given agent.
 */
export const getAgentTimeframeSettings = (agentId: number, timeFrame: string): Partial<AgentParams> => {
    const vetoSettings = VETO_TIMEFRAME_SETTINGS[timeFrame] || {};
    const smcSettings = SMC_VETO_TIMEFRAME_SETTINGS[timeFrame] || {};
    const concordanceSettings = CONCORDANCE_TIMEFRAME_SETTINGS[timeFrame] || {};
    let agentSettings: Partial<AgentParams> = {};

    switch (agentId) {
        case 9:  agentSettings = QUANTUM_SCALPER_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 11: agentSettings = HISTORIC_EXPERT_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 13: agentSettings = CHAMELEON_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 14: agentSettings = SENTINEL_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 18: agentSettings = CONDUCTOR_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 19: agentSettings = ASTRAX_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 20: agentSettings = SUPERTREND_FLIPPER_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 21: agentSettings = PIVOT_POINT_SUPERTREND_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 22: agentSettings = MATRIX_STRATEGIST_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 25: agentSettings = OMEGA_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
    }

    return { ...vetoSettings, ...smcSettings, ...concordanceSettings, ...agentSettings };
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
 */
export const MAX_MARGIN_LOSS_PERCENT = 6; 

export const TIMEFRAME_ATR_CONFIG: Record<string, { atrMultiplier: number, riskRewardRatio: number }> = {
    '1m':  { atrMultiplier: 2.8, riskRewardRatio: 1.6 },
    '3m':  { atrMultiplier: 2.8, riskRewardRatio: 1.8 },
    '5m':  { atrMultiplier: 2.4, riskRewardRatio: 2.0 },
    '15m': { atrMultiplier: 2.4, riskRewardRatio: 2.2 },
    '30m': { atrMultiplier: 2.5, riskRewardRatio: 2.5 },
    '1h':  { atrMultiplier: 2.7, riskRewardRatio: 2.8 },
    '4h':  { atrMultiplier: 3.0, riskRewardRatio: 3.0 },
    '1d':  { atrMultiplier: 3.5, riskRewardRatio: 3.5 },
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

export const TRADE_GUARDIAN_CONFIG: Record<string, {
    rsi7_long_threshold?: number;
    rsi7_short_threshold?: number;
    rsi14_long_threshold: number;
    rsi14_short_threshold: number;
    atrSpikeMultiplier: number;
    pnlRetracePercent: number;
    maxCandles: number;
    vwapEmaPeriod: number;
}> = {
    '1m':  { rsi7_long_threshold: 45, rsi7_short_threshold: 55, rsi14_long_threshold: 42, rsi14_short_threshold: 58, atrSpikeMultiplier: 2.5, pnlRetracePercent: 0.7, maxCandles: 15, vwapEmaPeriod: 9 },
    '3m':  { rsi7_long_threshold: 45, rsi7_short_threshold: 55, rsi14_long_threshold: 42, rsi14_short_threshold: 58, atrSpikeMultiplier: 2.5, pnlRetracePercent: 0.7, maxCandles: 15, vwapEmaPeriod: 9 },
    '5m':  { rsi7_long_threshold: 45, rsi7_short_threshold: 55, rsi14_long_threshold: 42, rsi14_short_threshold: 58, atrSpikeMultiplier: 2.5, pnlRetracePercent: 0.7, maxCandles: 15, vwapEmaPeriod: 9 },
    '15m': { rsi7_long_threshold: 42, rsi7_short_threshold: 58, rsi14_long_threshold: 40, rsi14_short_threshold: 60, atrSpikeMultiplier: 2.0, pnlRetracePercent: 0.5, maxCandles: 8, vwapEmaPeriod: 21 },
    '30m': { rsi7_long_threshold: 42, rsi7_short_threshold: 58, rsi14_long_threshold: 40, rsi14_short_threshold: 60, atrSpikeMultiplier: 2.0, pnlRetracePercent: 0.5, maxCandles: 8, vwapEmaPeriod: 21 },
    '1h':  { rsi14_long_threshold: 40, rsi14_short_threshold: 60, atrSpikeMultiplier: 1.8, pnlRetracePercent: 0.5, maxCandles: 5, vwapEmaPeriod: 50 },
    '4h':  { rsi14_long_threshold: 40, rsi14_short_threshold: 60, atrSpikeMultiplier: 1.8, pnlRetracePercent: 0.5, maxCandles: 5, vwapEmaPeriod: 50 },
    '1d':  { rsi14_long_threshold: 38, rsi14_short_threshold: 62, atrSpikeMultiplier: 1.5, pnlRetracePercent: 0.4, maxCandles: 3, vwapEmaPeriod: 100 }
};
