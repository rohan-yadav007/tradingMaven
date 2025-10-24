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
        id: 19,
        name: 'AstraX Super-Agent',
        description: "A TF-agnostic, multi-pair, long-running agent that derives a unified market state from multiple timeframes to determine directional conviction and adaptive risk.",
        indicators: ["Multi-Timeframe Analysis", "Market Structure", "VWAP", "Volume Profile"],
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

    // Universal Veto Parameters
    veto_volumeFilterMultiplier: 2.0, // Day-trading default
    veto_srZoneAtrBuffer: 0.5,
    veto_sr_buffer_scalp: 0.3, // Tighter buffer for scalpers
    veto_sr_buffer_swing: 0.8, // Wider buffer for swing traders
    veto_rsiAlignmentThreshold_bullish: 52,
    veto_rsiAlignmentThreshold_bearish: 48,
    veto_concordanceDivergenceLookback: 15, // Day-trading default
    veto_atrChaosRatio: 2.5, // Day-trading default
    veto_normalizeAtrChaos: true, // Tweak #2
    veto_candlePositionVeto_long: 0.80, // Day-trading default
    veto_candlePositionVeto_short: 0.20, // Day-trading default
    veto_concordanceVolumeMinMultiplier: 0.8, // Day-trading default
    veto_rsiConcordance_strongTrend_bullish: 55,
    veto_rsiConcordance_strongTrend_bearish: 45,
    veto_rsiConcordance_chop_bullish: 51,
    veto_rsiConcordance_chop_bearish: 49,
    veto_concordance_strongTrendAdx: 30,
    veto_concordance_chopAdx: 20,
    veto_atrChaos_graceMultiplier: 1.2,
    veto_atrChaos_strongTrendAdx: 30,
    veto_liquiditySweep_maxAdx: 30,
    // New Context-Aware Entry Classifier
    veto_microEmaFast: 5,       // For Breakout mode
    veto_microEmaSlow: 9,       // For Breakout mode
    veto_pullback_stochRsiPeriod: 14, // For Pullback mode
    veto_pullback_stochRsiOversold: 30, // For Pullback mode
    veto_pullback_stochRsiOverbought: 70, // For Pullback mode

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
    conductor_entryTrigger_candleVelocity: 0.75, // Requires close in top/bottom 25% of range
    conductor_entryTrigger_rsiHookPeriod: 3,

    // Agent 19: AstraX Super-Agent (Re-architected)
    astraX_baseThreshold: 35,
    astraX_strongTrendAdx: 30,
    astraX_chopAdx: 20,
    astraX_regimeMultiplier_strong: 0.7,
    astraX_regimeMultiplier_chop: 1.3,
    astraX_strongTrendThreshold: 65,
    astraX_chopThreshold: 80,
    astraX_structureLookback: 10,
    // --- Pillar Weights ---
    astraX_weights_structure: 35,
    astraX_weights_momentum: 35,
    astraX_weights_context: 15,
    astraX_weights_confirmation: 15,
    // --- Context Pillar Weights ---
    astraX_context_vwapWeight: 35,
    astraX_context_volatilityWeight: 15,
    astraX_context_marketBreadthWeight: 25,
    astraX_context_liquidationWeight: 25,
    // --- Confirmation/Trigger ---
    astraX_confirmation_minVolumeMultiplier: 1.1,
    astraX_confirmation_candleBodyMinRatio: 0.3,
    // --- Setup/Tactical ---
    astraX_scalp_retestEmaPeriod: 9,
    astraX_scalp_bbPeriod: 20,
    astraX_scalp_bbStdDev: 2,
    // FIX: Add default values for new AstraX properties.
    astraX_executionMode: 'hybrid',
    astraX_scalp_enabledInChop: true,

    // SMC Reversal Veto
    smc_divergenceLookback: 12,
    smc_volumeMultiplier: 2.0,
    smc_requireConfluenceOnScalp: true, // Tweak #3
    smc_confluence_bbwSqueezeThreshold: 0.006, // Tweak #3

    // BTC Correlation Veto (Tweak #5)
    btc_correlation_veto_ema_fast: 8,
    btc_correlation_veto_ema_slow: 21,

    // Risk Management
    risk_atrVolatilityPercentile_upper: 80, // Top 20%
    risk_atrVolatilityPercentile_lower: 20, // Bottom 20%
    risk_atrVolatilityMultiplier_upper_adj: 0.5,
    risk_atrVolatilityMultiplier_lower_adj: -0.5,
};


// --- TIMEFRAME-SPECIFIC PARAMETER OVERRIDES ---

export const CONCORDANCE_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    // Stricter on low TFs to avoid chasing
    '1m':  { concordance_breakout_stochRsiOverbought: 80, concordance_breakout_stochRsiOversold: 20, concordance_breakout_macdHistoDecel: true },
    '3m':  { concordance_breakout_stochRsiOverbought: 85, concordance_breakout_stochRsiOversold: 15, concordance_breakout_macdHistoDecel: true },
    '5m':  { concordance_breakout_stochRsiOverbought: 85, concordance_breakout_stochRsiOversold: 15, concordance_breakout_macdHistoDecel: true },
    // More lenient on higher TFs
    '15m': { concordance_breakout_stochRsiOverbought: 90, concordance_breakout_stochRsiOversold: 10, concordance_breakout_macdHistoDecel: false },
    '30m': { concordance_breakout_stochRsiOverbought: 90, concordance_breakout_stochRsiOversold: 10, concordance_breakout_macdHistoDecel: false },
    '1h':  { concordance_breakout_stochRsiOverbought: 95, concordance_breakout_stochRsiOversold: 5, concordance_breakout_macdHistoDecel: false },
    '4h':  { concordance_breakout_stochRsiOverbought: 95, concordance_breakout_stochRsiOversold: 5, concordance_breakout_macdHistoDecel: false },
    '1d':  { concordance_breakout_stochRsiOverbought: 95, concordance_breakout_stochRsiOversold: 5, concordance_breakout_macdHistoDecel: false },
};

export const VETO_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    // Scalping (1m, 3m, 5m)
    '1m':  { veto_volumeFilterMultiplier: 1.5, veto_concordanceDivergenceLookback: 8,  veto_atrChaosRatio: 2.0, veto_candlePositionVeto_long: 0.90, veto_candlePositionVeto_short: 0.10, veto_concordanceVolumeMinMultiplier: 1.0 },
    '3m':  { veto_volumeFilterMultiplier: 1.8, veto_concordanceDivergenceLookback: 10, veto_atrChaosRatio: 2.0, veto_candlePositionVeto_long: 0.90, veto_candlePositionVeto_short: 0.10, veto_concordanceVolumeMinMultiplier: 0.9 },
    '5m':  { veto_volumeFilterMultiplier: 2.0, veto_concordanceDivergenceLookback: 12, veto_atrChaosRatio: 2.2, veto_candlePositionVeto_long: 0.85, veto_candlePositionVeto_short: 0.15, veto_concordanceVolumeMinMultiplier: 0.8 },
    // Day Trading (defaults are mostly here)
    '15m': { veto_concordanceDivergenceLookback: 15, veto_concordanceVolumeMinMultiplier: 0.7 },
    '30m': { veto_volumeFilterMultiplier: 2.2, veto_concordanceDivergenceLookback: 18, veto_concordanceVolumeMinMultiplier: 0.7 },
    '1h':  { veto_volumeFilterMultiplier: 2.2, veto_concordanceDivergenceLookback: 20, veto_atrChaosRatio: 2.8, veto_candlePositionVeto_long: 0.75, veto_candlePositionVeto_short: 0.25, veto_concordanceVolumeMinMultiplier: 0.6 },
    // Swing Trading (4h, 1d)
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
    // Scalping: Faster, more sensitive exits. Tighter trails.
    '1m':  { sentinel_swingLookback: 5, sentinel_entryThreshold: 85, sentinel_stPeriod: 7, sentinel_stMultiplier: 2.0, sentinel_adxPeriod: 10, sentinel_rsiPeriod: 10 },
    '3m':  { sentinel_swingLookback: 6, sentinel_entryThreshold: 82, sentinel_stPeriod: 7, sentinel_stMultiplier: 2.0, sentinel_adxPeriod: 10, sentinel_rsiPeriod: 10 },
    '5m':  { sentinel_swingLookback: 8, sentinel_entryThreshold: 80, sentinel_stPeriod: 8, sentinel_stMultiplier: 2.2, sentinel_adxPeriod: 12, sentinel_rsiPeriod: 12 },
    // Day Trading: Balanced settings.
    '15m': { sentinel_swingLookback: 10, sentinel_entryThreshold: 78, sentinel_stPeriod: 10, sentinel_stMultiplier: 2.5, sentinel_adxPeriod: 14, sentinel_rsiPeriod: 14 },
    '30m': { sentinel_swingLookback: 10, sentinel_entryThreshold: 78, sentinel_stPeriod: 10, sentinel_stMultiplier: 2.5, sentinel_adxPeriod: 14, sentinel_rsiPeriod: 14 },
    '1h':  { sentinel_swingLookback: 12, sentinel_entryThreshold: 75, sentinel_stPeriod: 12, sentinel_stMultiplier: 2.8, sentinel_adxPeriod: 14, sentinel_rsiPeriod: 14 },
    // Swing Trading: Slower, less sensitive exits. Wider trails.
    '4h':  { sentinel_swingLookback: 15, sentinel_entryThreshold: 75, sentinel_stPeriod: 12, sentinel_stMultiplier: 3.0, sentinel_adxPeriod: 14, sentinel_rsiPeriod: 14 },
    '1d':  { sentinel_swingLookback: 15, sentinel_entryThreshold: 72, sentinel_stPeriod: 14, sentinel_stMultiplier: 3.0, sentinel_adxPeriod: 14, sentinel_rsiPeriod: 14 },
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

export const ASTRAX_TIMEFRAME_SETTINGS: Record<string, Partial<AgentParams>> = {
    // --- SCALPING (1m, 3m, 5m) ---
    // Goal: High selectivity, quick reaction, strong noise filtering.
    '1m': {
        astraX_baseThreshold: 50,
        astraX_strongTrendAdx: 32, astraX_chopAdx: 22,
        astraX_strongTrendThreshold: 70, astraX_chopThreshold: 85,
        astraX_weights_structure: 25, astraX_weights_momentum: 35, astraX_weights_context: 20, astraX_weights_confirmation: 20,
        astraX_context_vwapWeight: 50, astraX_context_volatilityWeight: 10, astraX_context_marketBreadthWeight: 20, astraX_context_liquidationWeight: 20,
        astraX_structureLookback: 5,
        astraX_scalp_retestEmaPeriod: 8,
        astraX_scalp_bbPeriod: 20,
        astraX_scalp_bbStdDev: 2.2,
        astraX_confirmation_minVolumeMultiplier: 1.8,
        astraX_confirmation_candleBodyMinRatio: 0.4
    },
    '3m': {
        astraX_baseThreshold: 48,
        astraX_strongTrendAdx: 30, astraX_chopAdx: 22,
        astraX_strongTrendThreshold: 70, astraX_chopThreshold: 85,
        astraX_weights_structure: 25, astraX_weights_momentum: 35, astraX_weights_context: 20, astraX_weights_confirmation: 20,
        astraX_context_vwapWeight: 45, astraX_context_volatilityWeight: 15, astraX_context_marketBreadthWeight: 20, astraX_context_liquidationWeight: 20,
        astraX_structureLookback: 6,
        astraX_scalp_retestEmaPeriod: 8,
        astraX_scalp_bbPeriod: 20,
        astraX_scalp_bbStdDev: 2.1,
        astraX_confirmation_minVolumeMultiplier: 1.6,
        astraX_confirmation_candleBodyMinRatio: 0.35
    },
    '5m': {
        astraX_baseThreshold: 45,
        astraX_strongTrendAdx: 30, astraX_chopAdx: 20,
        astraX_strongTrendThreshold: 68, astraX_chopThreshold: 82,
        astraX_weights_structure: 30, astraX_weights_momentum: 40, astraX_weights_context: 15, astraX_weights_confirmation: 15,
        astraX_context_vwapWeight: 40, astraX_context_volatilityWeight: 15, astraX_context_marketBreadthWeight: 25, astraX_context_liquidationWeight: 20,
        astraX_structureLookback: 8,
        astraX_scalp_retestEmaPeriod: 9,
        astraX_scalp_bbPeriod: 20,
        astraX_scalp_bbStdDev: 2.1,
        astraX_confirmation_minVolumeMultiplier: 1.4,
        astraX_confirmation_candleBodyMinRatio: 0.3
    },
    
    // --- DAY TRADING (15m, 30m, 1h) ---
    // Goal: Balanced approach, capturing intraday trends.
    '15m': {
        astraX_baseThreshold: 40,
        astraX_strongTrendAdx: 28, astraX_chopAdx: 20,
        astraX_strongTrendThreshold: 65, astraX_chopThreshold: 80,
        astraX_weights_structure: 35, astraX_weights_momentum: 35, astraX_weights_context: 15, astraX_weights_confirmation: 15,
        astraX_context_vwapWeight: 35, astraX_context_volatilityWeight: 15, astraX_context_marketBreadthWeight: 25, astraX_context_liquidationWeight: 25,
        astraX_structureLookback: 10,
        astraX_scalp_retestEmaPeriod: 10,
        astraX_scalp_bbPeriod: 20,
        astraX_scalp_bbStdDev: 2.0,
        astraX_confirmation_minVolumeMultiplier: 1.2,
        astraX_confirmation_candleBodyMinRatio: 0.3
    },
    '30m': {
        astraX_baseThreshold: 40,
        astraX_strongTrendAdx: 28, astraX_chopAdx: 20,
        astraX_strongTrendThreshold: 65, astraX_chopThreshold: 80,
        astraX_weights_structure: 35, astraX_weights_momentum: 35, astraX_weights_context: 15, astraX_weights_confirmation: 15,
        astraX_context_vwapWeight: 30, astraX_context_volatilityWeight: 20, astraX_context_marketBreadthWeight: 25, astraX_context_liquidationWeight: 25,
        astraX_structureLookback: 12,
        astraX_scalp_retestEmaPeriod: 12,
        astraX_scalp_bbPeriod: 20,
        astraX_scalp_bbStdDev: 2.0,
        astraX_confirmation_minVolumeMultiplier: 1.1,
        astraX_confirmation_candleBodyMinRatio: 0.3
    },
    '1h':  {
        astraX_baseThreshold: 35,
        astraX_strongTrendAdx: 25, astraX_chopAdx: 18,
        astraX_strongTrendThreshold: 62, astraX_chopThreshold: 78,
        astraX_weights_structure: 40, astraX_weights_momentum: 40, astraX_weights_context: 10, astraX_weights_confirmation: 10,
        astraX_context_vwapWeight: 25, astraX_context_volatilityWeight: 25, astraX_context_marketBreadthWeight: 25, astraX_context_liquidationWeight: 25,
        astraX_structureLookback: 14,
        astraX_scalp_retestEmaPeriod: 14,
        astraX_scalp_bbPeriod: 20,
        astraX_scalp_bbStdDev: 2.0,
        astraX_confirmation_minVolumeMultiplier: 1.0,
        astraX_confirmation_candleBodyMinRatio: 0.25
    },
    
    // --- SWING TRADING (4h, 1d) ---
    // Goal: Patience, riding major trends, ignoring single-candle noise.
    '4h':  {
        astraX_baseThreshold: 30,
        astraX_strongTrendAdx: 25, astraX_chopAdx: 18,
        astraX_strongTrendThreshold: 60, astraX_chopThreshold: 75,
        astraX_weights_structure: 40, astraX_weights_momentum: 40, astraX_weights_context: 10, astraX_weights_confirmation: 10,
        astraX_context_vwapWeight: 10, astraX_context_volatilityWeight: 30, astraX_context_marketBreadthWeight: 30, astraX_context_liquidationWeight: 30,
        astraX_structureLookback: 16,
        astraX_scalp_retestEmaPeriod: 16,
        astraX_scalp_bbPeriod: 25,
        astraX_scalp_bbStdDev: 1.9,
        astraX_confirmation_minVolumeMultiplier: 1.0,
        astraX_confirmation_candleBodyMinRatio: 0.25
    },
    '1d':  {
        astraX_baseThreshold: 30,
        astraX_strongTrendAdx: 25, astraX_chopAdx: 18,
        astraX_strongTrendThreshold: 60, astraX_chopThreshold: 75,
        astraX_weights_structure: 45, astraX_weights_momentum: 45, astraX_weights_context: 5, astraX_weights_confirmation: 5,
        astraX_context_vwapWeight: 5, astraX_context_volatilityWeight: 35, astraX_context_marketBreadthWeight: 30, astraX_context_liquidationWeight: 30,
        astraX_structureLookback: 20,
        astraX_scalp_retestEmaPeriod: 20,
        astraX_scalp_bbPeriod: 25,
        astraX_scalp_bbStdDev: 1.9,
        astraX_confirmation_minVolumeMultiplier: 0.9,
        astraX_confirmation_candleBodyMinRatio: 0.25
    },
};

/**
 * A helper function to get the correct, timeframe-specific parameters for a given agent.
 * This now merges general SMC settings with agent-specific settings.
 * @param agentId The ID of the agent.
 * @param timeFrame The timeframe string (e.g., '5m', '1h').
 * @returns An object with the agent's parameters for that timeframe.
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
        case 16: agentSettings = ICHIMOKU_TREND_RIDER_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 17: agentSettings = MOMENTUM_SWING_TRADER_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 18: agentSettings = CONDUCTOR_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
        case 19: agentSettings = ASTRAX_TIMEFRAME_SETTINGS[timeFrame] || {}; break;
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
 * This is the maximum percentage of the *invested margin* that a trade is allowed to lose.
 * For example, a value of 10 with a $100 investment means the max loss (before fees/slippage)
 * is hard-capped at $10, regardless of leverage or the agent's calculated stop loss.
 */
export const MAX_MARGIN_LOSS_PERCENT = 6; // Increased slightly for more flexibility

// New, wider ATR multipliers for initial stop loss placement to give trades more "breathing room"
export const TIMEFRAME_ATR_CONFIG: Record<string, { atrMultiplier: number, riskRewardRatio: number }> = {
    '1m':  { atrMultiplier: 2.0, riskRewardRatio: 1.6 },
    '3m':  { atrMultiplier: 2.1, riskRewardRatio: 1.8 },
    '5m':  { atrMultiplier: 2.2, riskRewardRatio: 2.0 },
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
    // Scalping & Low TF: More sensitive, uses RSI7 as an early warning.
    '1m':  { rsi7_long_threshold: 45, rsi7_short_threshold: 55, rsi14_long_threshold: 42, rsi14_short_threshold: 58, atrSpikeMultiplier: 2.5, pnlRetracePercent: 0.6, maxCandles: 10, vwapEmaPeriod: 9 },
    '3m':  { rsi7_long_threshold: 45, rsi7_short_threshold: 55, rsi14_long_threshold: 42, rsi14_short_threshold: 58, atrSpikeMultiplier: 2.5, pnlRetracePercent: 0.6, maxCandles: 10, vwapEmaPeriod: 9 },
    '5m':  { rsi7_long_threshold: 45, rsi7_short_threshold: 55, rsi14_long_threshold: 42, rsi14_short_threshold: 58, atrSpikeMultiplier: 2.5, pnlRetracePercent: 0.6, maxCandles: 10, vwapEmaPeriod: 9 },
    // Mid TF: Slightly less sensitive, gives more room.
    '15m': { rsi7_long_threshold: 42, rsi7_short_threshold: 58, rsi14_long_threshold: 40, rsi14_short_threshold: 60, atrSpikeMultiplier: 2.0, pnlRetracePercent: 0.5, maxCandles: 8, vwapEmaPeriod: 21 },
    '30m': { rsi7_long_threshold: 42, rsi7_short_threshold: 58, rsi14_long_threshold: 40, rsi14_short_threshold: 60, atrSpikeMultiplier: 2.0, pnlRetracePercent: 0.5, maxCandles: 8, vwapEmaPeriod: 21 },
    // High TF: Much more lenient, ignores noisy RSI7 completely.
    '1h':  { rsi14_long_threshold: 40, rsi14_short_threshold: 60, atrSpikeMultiplier: 1.8, pnlRetracePercent: 0.5, maxCandles: 5, vwapEmaPeriod: 50 },
    '4h':  { rsi14_long_threshold: 40, rsi14_short_threshold: 60, atrSpikeMultiplier: 1.8, pnlRetracePercent: 0.5, maxCandles: 5, vwapEmaPeriod: 50 },
    '1d':  { rsi14_long_threshold: 38, rsi14_short_threshold: 62, atrSpikeMultiplier: 1.5, pnlRetracePercent: 0.4, maxCandles: 3, vwapEmaPeriod: 100 }
};