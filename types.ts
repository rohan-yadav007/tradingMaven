
// types.ts

// --- Enums ---

export enum TradingMode {
    Spot = 'Spot',
    USDSM_Futures = 'USDⓈ-M Futures',
}

export enum BotStatus {
    Starting = 'Starting',
    Monitoring = 'Monitoring',
    ExecutingTrade = 'Executing Trade',
    PositionOpen = 'Position Open',
    FlipPending = 'Flip Pending',
    Paused = 'Paused',
    Stopping = 'Stopping',
    Stopped = 'Stopped',
    Error = 'Error',
}

export enum LogType {
    Info = 'Info',
    Success = 'Success',
    Error = 'Error',
    Action = 'Action',
    Status = 'Status',
}


// --- Core Data Structures ---

export interface Kline {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    takerBuyVolume?: number; // Omega V2.1: Institutional Aggression
    isFinal: boolean;
}

export interface LiveTicker {
    pair: string;
    closePrice: number;
    highPrice: number;

    lowPrice: number;
    volume: number;
    quoteVolume: number;
}

export interface OpenInterestKline {
    symbol: string;
    sumOpenInterest: string; // The raw value from Binance is string
    sumOpenInterestValue: string;
    timestamp: number;
}


// --- Binance API Specific ---

export interface SymbolInfo {
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    isSpotTradingAllowed: boolean;
    filters: SymbolFilter[];
    pricePrecision: number;
    quantityPrecision: number;
}

export interface SymbolFilter {
    filterType: 'PRICE_FILTER' | 'LOT_SIZE' | 'MARKET_LOT_SIZE' | 'MAX_NUM_ORDERS' | 'MAX_NUM_ALGO_ORDERS' | 'ICEBERG_PARTS' | 'MIN_NOTIONAL';
    [key: string]: any;
}

export interface RawWalletBalance {
    asset: string;
    free: number;
    locked: number;
}

export interface WalletBalance extends RawWalletBalance {
    total: number;
    usdValue: number;
}

export interface AccountInfo {
    makerCommission: number;
    takerCommission: number;
    balances: WalletBalance[];
    canTrade: boolean;
    canWithdraw: boolean;
    canDeposit: boolean;
    updateTime: number;
    accountType: string;
    totalMarginBalance?: string;
    totalUnrealizedProfit?: string;
    positions?: any[];
}

export interface LeverageBracket {
    bracket: number;
    initialLeverage: number;
    notionalCap: number;
    notionalFloor: number;
    maintMarginRatio: number;
    cum: number;
}

export interface BinanceOrderResponse {
    symbol: string;
    orderId: number;
    clientOrderId: string;
    transactTime: number;
    price: string;
    origQty: string;
    executedQty: string;
    cummulativeQuoteQty: string;
    status: string;
    timeInForce: string;
    type: string;
    side: string;
    avgPrice?: string;
    cumQuote?: string;
}

export interface OrderBookEntry {
    price: number;
    amount: number;
    total: number;
}

export interface OrderBook {
    bids: OrderBookEntry[];
    asks: OrderBookEntry[];
    spread: number;
    spreadPercentage: number;
}

export interface OrderBookAnalysis {
    imbalance: number; // -1 (Bearish) to 1 (Bullish)
    bidWall: number | null; // Price of nearest significant bid wall
    askWall: number | null; // Price of nearest significant ask wall
    spread: number;
    depthRatio: number; // Ratio of total bid volume to total ask volume in depth scope
}

// --- Analysis & Structure ---

export interface SupportResistance {
    supports: { price: number; score: number }[];
    resistances: { price: number; score: number }[];
}

export interface SwingPoint {
    index: number;
    price: number;
    type: 'high' | 'low';
}

export interface MarketStructureAnalysis {
    structure: 'Uptrend' | 'Downtrend' | 'Ranging' | 'Indeterminate';
    lastSignal: 'HH' | 'HL' | 'LL' | 'LH' | 'ChoCH_Bearish' | 'ChoCH_Bullish' | null;
    reason: string;
}

// --- Pattern Recognition ---

export type PatternType = 
    | 'Double Top' | 'Double Bottom' 
    | 'Triple Top' | 'Triple Bottom'
    | 'Head and Shoulders' | 'Inverse Head and Shoulders' 
    | 'Bull Flag' | 'Bear Flag' 
    | 'Bull Pennant' | 'Bear Pennant'
    | 'Bullish Rectangle' | 'Bearish Rectangle'
    | 'Ascending Triangle' | 'Descending Triangle' 
    | 'Symmetrical Triangle' | 'Rising Wedge' | 'Falling Wedge';

export interface ChartPattern {
    type: PatternType;
    sentiment: 'Bullish' | 'Bearish' | 'Neutral';
    confidence: number; // 0 to 100
    points: number[]; // Indices of klines forming the pattern
    reason: string;
    triggerPrice?: number;      // Price level that confirms a breakout
    measuredTarget?: number;    // Calculated take-profit for the pattern
    invalidationLevel?: number; // Calculated stop-loss for the pattern
}

// --- Agent & Trading Logic ---

export interface Agent {
    id: number;
    name: string;
    description: string;
    indicators: string[];
}

export interface AgentParams {
    rsiPeriod?: number;
    atrPeriod?: number;
    adxPeriod?: number;
    viPeriod?: number;
    obvPeriod?: number;
    macdFastPeriod?: number;
    macdSlowPeriod?: number;
    macdSignalPeriod?: number;
    invalidationCandleLimit?: number;

    // Universal Veto Parameters
    veto_volumeFilterMultiplier?: number;
    veto_srZoneAtrBuffer?: number;
    veto_rsiAlignmentThreshold_bullish?: number;
    veto_rsiAlignmentThreshold_bearish?: number;
    veto_concordanceDivergenceLookback?: number;
    veto_atrChaosRatio?: number;
    veto_candlePositionVeto_long?: number;
    veto_candlePositionVeto_short?: number;
    veto_concordanceVolumeMinMultiplier?: number;
    veto_normalizeAtrChaos?: boolean;
    veto_rsiConcordance_strongTrend_bullish?: number;
    veto_rsiConcordance_strongTrend_bearish?: number;
    veto_rsiConcordance_chop_bullish?: number;
    veto_rsiConcordance_chop_bearish?: number;
    veto_concordance_strongTrendAdx?: number;
    veto_concordance_chopAdx?: number;
    veto_atrChaos_graceMultiplier?: number;
    veto_atrChaos_strongTrendAdx?: number;
    veto_liquiditySweep_maxAdx?: number;
    veto_sr_buffer_scalp?: number;
    veto_sr_buffer_swing?: number;
    veto_microEmaFast?: number;
    veto_microEmaSlow?: number;
    veto_pullback_stochRsiPeriod?: number;
    veto_pullback_stochRsiOversold?: number;
    veto_pullback_stochRsiOverbought?: number;

    // TF-Specific Concordance Veto Parameters
    concordance_breakout_stochRsiOverbought?: number;
    concordance_breakout_stochRsiOversold?: number;
    concordance_breakout_macdHistoDecel?: boolean;
    
    // Agent 9: Quantum Scalper
    qsc_adxPeriod?: number;
    qsc_adxThreshold?: number;
    qsc_adxChopBuffer?: number;
    qsc_bbPeriod?: number;
    qsc_bbStdDev?: number;
    qsc_bbwSqueezeThreshold?: number;
    qsc_stochRsiPeriod?: number;
    qsc_stochRsiOversold?: number;
    qsc_stochRsiOverbought?: number;
    qsc_superTrendPeriod?: number;
    qsc_superTrendMultiplier?: number;
    qsc_psarStep?: number;
    qsc_psarMax?: number;
    qsc_atrPeriod?: number;
    qsc_atrMultiplier?: number;
    qsc_trendScoreThreshold?: number;
    qsc_rangeScoreThreshold?: number;
    qsc_ichi_conversionPeriod?: number;
    qsc_ichi_basePeriod?: number;
    qsc_ichi_laggingSpanPeriod?: number;
    qsc_ichi_displacement?: number;
    qsc_rsiOverextendedLong?: number;
    qsc_rsiOverextendedShort?: number;
    qsc_entryMode?: 'breakout' | 'pullback';
    qsc_rsiMomentumThreshold?: number;
    qsc_rsiPullbackThreshold?: number;
    qsc_rsiBuyThreshold?: number;
    qsc_rsiSellThreshold?: number;
    qsc_volumeExhaustionMultiplier?: number;
    qsc_marketCohesionCandles?: number;

    // Agent 16: Ichimoku Trend Rider
    ichi_conversionPeriod?: number;
    ichi_basePeriod?: number;
    ichi_laggingSpanPeriod?: number;
    ichi_displacement?: number;

    // Agent 11: Historic Expert
    he_trendSmaPeriod?: number;
    he_fastEmaPeriod?: number;
    he_slowEmaPeriod?: number;
    he_rsiPeriod?: number;
    he_rsiMidline?: number;
    he_adxTrendThreshold?: number;
    
    // Agent 13: The Chameleon
    ch_fastEmaPeriod?: number;
    ch_slowEmaPeriod?: number;
    ch_trendEmaPeriod?: number;
    ch_adxThreshold?: number;
    
    // Agent 14: The Sentinel V2
    sentinel_entryThreshold?: number;
    sentinel_swingLookback?: number;
    sentinel_structureWeight?: number;
    sentinel_momentumWeight?: number;
    sentinel_contextWeight?: number;
    sentinel_htfMultiplier?: number;
    sentinel_htfPenalty?: number;
    sentinel_atr_mult_strong?: number;
    sentinel_atr_mult_transition?: number;
    sentinel_atr_mult_chop?: number;
    sentinel_adxPeriod?: number;
    sentinel_stPeriod?: number;
    sentinel_stMultiplier?: number;
    sentinel_useSrLevelsForTp?: boolean;
    sentinel_rsiPeriod?: number;


    // Agent 17: Momentum Swing Trader
    mst_emaFastPeriod?: number;
    mst_emaSlowPeriod?: number;
    mst_macdFastPeriod?: number;
    mst_macdSlowPeriod?: number;
    mst_macdSignalPeriod?: number;

    // Agent 18: The Conductor
    conductor_swingLookback?: number;
    conductor_rsiDivergenceLookback?: number;
    conductor_convictionThreshold?: number;
    conductor_structureWeight?: number;
    conductor_momentumWeight?: number;
    conductor_contextWeight?: number;
    conductor_confirmationWeight?: number;
    conductor_volumeMultiplier?: number;
    conductor_slAtrMultiplier?: number;
    conductor_strongTrendAdx?: number;
    conductor_strongTrendThreshold?: number;
    conductor_choppyTrendAdx?: number;
    conductor_choppyTrendThreshold?: number;
    conductor_structureWeightMultiplier?: number;
    conductor_entryTrigger_candleVelocity?: number;
    conductor_entryTrigger_rsiHookPeriod?: number;
    
    // Agent 19: AstraX Super-Agent
    astraX_executionMode?: 'conviction' | 'scalp' | 'hybrid';
    astraX_sweepLookback?: number;
    astraX_breakoutVolMultiplier?: number;
    astraX_pullbackEmaPeriod?: number;
    astraX_adxThreshold?: number;
    astraX_baseThreshold?: number;
    astraX_strongTrendAdx?: number;
    astraX_chopAdx?: number;
    astraX_strongTrendThreshold?: number;
    astraX_chopThreshold?: number;
    astraX_regimeMultiplier_strong?: number;
    astraX_regimeMultiplier_chop?: number;
    astraX_weights_structure?: number;
    astraX_weights_momentum?: number;
    astraX_weights_context?: number;
    astraX_weights_confirmation?: number;
    astraX_context_vwapWeight?: number;
    astraX_context_volatilityWeight?: number;
    astraX_context_marketBreadthWeight?: number;
    astraX_context_liquidationWeight?: number;
    astraX_scalp_retestEmaPeriod?: number;
    astraX_scalp_bbPeriod?: number;
    astraX_scalp_bbStdDev?: number;
    astraX_confirmation_minVolumeMultiplier?: number;
    astraX_confirmation_candleBodyMinRatio?: number;
    astraX_supertrendPeriod?: number;
    astraX_supertrendMultiplier?: number;
    astraX_sl_multiplier_sweep?: number;
    astraX_sl_multiplier_breakout?: number;
    astraX_sl_multiplier_pullback?: number;
    astraX_breakout_candle_max_atr?: number;
    astraX_elasticity_multiplier?: number;
    astraX_ratchet_breakeven?: number;
    astraX_ratchet_secure?: number;
    astraX_ratchet_parabolic?: number;
    
    // Agent 20: Supertrend Flipper
    stf_atrPeriod?: number;
    stf_atrMultiplier?: number;
    stf_enableDynamicMultiplier?: boolean;
    stf_volatilityPeriod?: number;
    stf_volatilityThreshold_low?: number;
    stf_volatilityThreshold_high?: number;
    stf_multiplier_low?: number;
    stf_multiplier_normal?: number;
    stf_multiplier_high?: number;
    
    // Agent 21: Pivot Point SuperTrend
    pps_pivotPeriod?: number;
    pps_atrFactor?: number;
    pps_atrPeriod?: number;

    // Agent 22: The Matrix Strategist
    ms_1m_emaFast?: number;
    ms_1m_emaSlow?: number;
    ms_1m_rsiPeriod?: number;
    ms_1m_volSpike?: number;
    ms_1m_bbPeriod?: number;
    ms_1m_bbStd?: number;
    ms_3m_ema1?: number;
    ms_3m_ema2?: number;
    ms_3m_ema3?: number;
    ms_3m_rsiPeriod?: number;
    ms_3m_volMult?: number;
    ms_5m_ema1?: number;
    ms_5m_ema2?: number;
    ms_5m_ema3?: number;
    ms_5m_stochK?: number;
    ms_5m_stochD?: number;
    ms_15m_ema1?: number;
    ms_15m_ema2?: number;
    ms_15m_ema3?: number;
    ms_15m_adxThreshold?: number;
    ms_30m_ema1?: number;
    ms_30m_ema2?: number;
    ms_30m_rsiPeriod?: number;
    ms_1h_emaPeriod?: number;
    ms_4h_swingLookback?: number;

    // Agent 25: Omega Predator (V3 Sovereign)
    omega_matrixThreshold?: number;
    omega_aggressiveness?: 'Conservative' | 'Standard' | 'Sniper'; // V3: Simple mode
    omega_minExpectancy?: number;
    // FIX: Added missing Omega parameters
    omega_fvgLookback?: number;
    omega_sweepDepth?: number;
    omega_frequencyAggressiveness?: number;
    omega_orderFlowWeight?: number;
    
    // SMC Reversal Veto
    smc_divergenceLookback?: number;
    smc_volumeMultiplier?: number;
    smc_requireConfluenceOnScalp?: boolean;
    smc_confluence_bbwSqueezeThreshold?: number;

    // BTC Correlation Veto
    btc_correlation_veto_ema_fast?: number;
    btc_correlation_veto_ema_slow?: number;
    
    // Risk Management
    risk_atrVolatilityPeriod?: number;
    risk_atrVolatilityPercentile_upper?: number;
    risk_atrVolatilityPercentile_lower?: number;
    risk_atrVolatilityMultiplier_upper_adj?: number;
    risk_atrVolatilityMultiplier_lower_adj?: number;
}

export interface MarketDataContext {
    rsi14?: number;
    adx14?: ADXOutput;
    atr14?: number;
    stochRsi?: StochasticRSIOutput;
    vi14?: { pdi: number, ndi: number };
    cvd?: number; // Omega V2.1: Cumulative Volume Delta
    openInterest?: number; 
    openInterestHistory?: OpenInterestKline[]; // Omega V4: Trend detection
    liqIntensity?: number;
    bb20_2?: BollingerBandsOutput;
    volumeSma20?: number;
    obvTrend?: 'bullish' | 'bearish' | 'neutral';
    macd?: MACDOutput;
    ema9?: number;
    ema21?: number;
    ema50?: number;
    ema100?: number;
    ema200?: number;
    sma50?: number;
    sma200?: number;
    ichiCloud?: IchimokuCloudOutput;
    lastCandlePattern?: { name: string; type: 'bullish' | 'bearish' };
    vwap?: number;
    lastVolume?: number;
    lastClose?: number;
    htf_rsi14?: number;
    htf_adx14?: ADXOutput;
    htf_stochRsi?: StochasticRSIOutput;
    htf_trend?: 'bullish' | 'bearish' | 'neutral';
    orderBook?: OrderBookAnalysis;
    activePatterns?: ChartPattern[];
}

export interface AstraXAnalysis {
    conviction: number;
    regime: 'Strong Trend' | 'Developing Trend' | 'Choppy Market' | 'Volatile Expansion' | 'Range Bound' | 'Unknown';
    thesis: 'Bullish' | 'Bearish' | 'Neutral';
    setupName?: string;
    confidenceMetrics?: {
      technical: number;
      volume: number;
      structure: number;
      momentum: number;
    };
    threshold?: number;
    scores?: {
        structure: { bull: number, bear: number, weight: number },
        momentum: { bull: number, bear: number, weight: number },
        context: { bull: number, bear: number, weight: number },
        confirmation: { bull: number, bear: number, weight: number },
    };
    adjustments?: { reason: string, impact: number }[];
}

// Omega V3: Sovereign Architect Analysis
export interface OmegaAnalysis {
    conviction: number;
    phases: {
        scan: { bias: 'Bullish' | 'Bearish' | 'Neutral', score: number, reason: string }; // 4H/1H
        hunt: { setup: 'FVG' | 'Breakout' | 'Rejection' | 'None', score: number, reason: string }; // 15m/5m
        kill: { trigger: 'Sweep' | 'Divergence' | 'Price Action' | 'None', score: number, reason: string }; // 1m
        flow?: { trend: 'Rising' | 'Falling' | 'Flat', score: number, reason: string }; // V4: OI Flow
    };
    feeExpectancy: {
        cost: number;
        reward: number;
        ratio: number;
        passed: boolean;
    };
    targets: {
        entry: number;
        stopLoss: number;
        takeProfit: number;
    };
    sizing: {
        multiplier: number;
        reason: string;
    };
}

export interface BitcoinState {
    state: 'CRASH' | 'PUMP' | 'RANGE' | 'TREND_UP' | 'TREND_DOWN' | 'NEUTRAL';
    trend: 'bullish' | 'bearish' | 'neutral';
    momentum: 'accelerating' | 'decelerating' | 'neutral';
    rejection: 'resistance' | 'support' | 'none';
    reason: string;
}

export interface TradeSignal {
    signal: 'BUY' | 'SELL' | 'HOLD';
    reasons: string[];
    entryPrice?: number;
    takeProfitPrice?: number;
    stopLossPrice?: number;
    invalidationPrice?: number;
    sentinelAnalysis?: SentinelAnalysis;
    conductorAnalysis?: ConductorAnalysis;
    astraXAnalysis?: AstraXAnalysis;
    omegaAnalysis?: OmegaAnalysis;
    tradeType?: 'conviction' | 'scalp';
    setupType?: string; // Omega V5.2: Explicitly track setup mechanics (Breakout vs Rejection)
    btcContext?: BitcoinState;
}

export interface TradeManagementSignal {
    newStopLoss?: number;
    newTakeProfit?: number;
    action?: 'hold' | 'close';
    reasons: string[];
    newState?: Partial<Position>;
    activeStopLossReason?: Position['activeStopLossReason'];
}

// --- Bot & Position Management ---

export interface BotConfig {
    pair: string;
    mode: TradingMode;
    executionMode: 'paper' | 'live';
    leverage: number;
    marginType: 'ISOLATED' | 'CROSSED';
    agent: Agent;
    timeFrame: string;
    investmentAmount: number;
    maxMarginLossPercent: number;
    isInitialRiskVetoEnabled: boolean;
    isHtfConfirmationEnabled: boolean;
    htfTimeFrame: 'auto' | string;
    isUniversalProfitTrailEnabled: boolean;
    isMinRrEnabled: boolean;
    invalidationSensitivity: 'low' | 'medium' | 'high';
    isAgentTrailEnabled: boolean;
    isBreakevenTrailEnabled: boolean;
    isMarketCohesionEnabled?: boolean;
    isVwapConfirmationEnabled?: boolean;
    isBtcConfirmationEnabled?: boolean;
    isBtcCorrelationVetoEnabled?: boolean;
    btcConfirmationThreshold?: number;
    isVolumeFilterEnabled?: boolean;
    isAdxFilterEnabled?: boolean;
    isExhaustionFilterEnabled?: boolean;
    isSmcVetoEnabled?: boolean;
    isSrAnalysisEnabled?: boolean;
    isCandlestickConfirmationEnabled?: boolean;
    isMarketStructureVetoEnabled?: boolean;
    isSupertrendConfirmationEnabled?: boolean;
    isAdaptiveTpEnabled: boolean;
    aggressiveTrailMode: 'distance' | 'pnl' | 'disabled';
    agentParams: AgentParams;
    htfAgentParams?: AgentParams;
    pricePrecision: number;
    quantityPrecision: number;
    stepSize: number;
    takerFeeRate: number;
    entryTiming: 'immediate' | 'onNextCandle';
    telegramChatId?: string;
    isMarketBreadthFilterEnabled?: boolean;
    isLiquidationFilterEnabled?: boolean;
    isConfirmationCandleEnabled?: boolean;
    isMomentumConcordanceEnabled: boolean;
    finalEntryFailSafe?: 'fail-open' | 'fail-closed';
    isTradeGuardianEnabled?: boolean;
    isHeikinAshiEnabled: boolean;
    isDynamicSizingEnabled?: boolean;
}

export interface BotConfigSnapshot {
    isHtfConfirmationEnabled?: boolean;
    isUniversalProfitTrailEnabled?: boolean;
    isMinRrEnabled?: boolean;
    invalidationSensitivity?: 'low' | 'medium' | 'high';
    isAgentTrailEnabled?: boolean;
    isBreakevenTrailEnabled?: boolean;
    isMarketCohesionEnabled?: boolean;
    isVwapConfirmationEnabled?: boolean;
    isBtcConfirmationEnabled?: boolean;
    isBtcCorrelationVetoEnabled?: boolean;
    btcConfirmationThreshold?: number;
    isVolumeFilterEnabled?: boolean;
    isAdxFilterEnabled?: boolean;
    isExhaustionFilterEnabled?: boolean;
    isSmcVetoEnabled?: boolean;
    isSrAnalysisEnabled?: boolean;
    isCandlestickConfirmationEnabled?: boolean;
    isMarketStructureVetoEnabled?: boolean;
    isSupertrendConfirmationEnabled?: boolean;
    htfTimeFrame?: 'auto' | string;
    entryTiming?: 'immediate' | 'onNextCandle';
    isAdaptiveTpEnabled?: boolean;
    aggressiveTrailMode?: 'distance' | 'pnl' | 'disabled';
    isInitialRiskVetoEnabled?: boolean;
    isMarketBreadthFilterEnabled?: boolean;
    isLiquidationFilterEnabled?: boolean;
    isConfirmationCandleEnabled?: boolean;
    isMomentumConcordanceEnabled?: boolean;
    finalEntryFailSafe?: 'fail-open' | 'fail-closed';
    isTradeGuardianEnabled?: boolean;
    isHeikinAshiEnabled?: boolean;
    isDynamicSizingEnabled?: boolean;
    maxMarginLossPercent?: number;
}

export interface Position {
    id: number;
    botId: string | null;
    agentId?: number;
    orderId: number | null;
    pair: string;
    mode: TradingMode;
    executionMode: 'paper' | 'live';
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    size: number;
    investmentAmount: number;
    leverage: number;
    marginType: 'ISOLATED' | 'CROSSED';
    entryTime: string;
    entryReason: string;
    agentName: string;
    takeProfitPrice: number;
    stopLossPrice: number;
    invalidationPrice?: number;
    initialTakeProfitPrice: number;
    initialStopLossPrice: number;
    initialRiskInPrice: number;
    initialStopLossReason: 'Agent Logic' | 'Hard Cap' | 'Noise Floor';
    activeStopLossReason: 'Agent Logic' | 'Hard Cap' | 'Profit Secure' | 'Breakeven' | 'Agent Trail' | 'Sovereign Ratchet' | 'Noise Floor';
    pricePrecision: number;
    timeFrame: string;
    liquidationPrice?: number;
    isBreakevenSet: boolean;
    profitLockTier: number;
    profitSpikeTier: number;
    aggressiveTrailTier: number;
    peakPrice: number;
    troughPrice: number;
    candlesSinceEntry: number;
    hasBeenProfitable: boolean;
    takerFeeRate: number;
    initialRiskRewardRatio?: number;
    agentParamsSnapshot?: AgentParams;
    botConfigSnapshot?: BotConfigSnapshot;
    proactiveLossCheckTriggered: boolean;
    adaptiveTpTriggered?: boolean;
    entryContext?: Partial<MarketDataContext>;
    exitContext?: Partial<MarketDataContext>;
    entryAtr?: number;
    tradeType?: 'conviction' | 'scalp';
    setupType?: string; // Omega V5.2: Explicit setup type (Breakout, Rejection)
    promotedFrom?: 'scalp';
    btcContext?: BitcoinState;
    omegaBrainData?: {
        lastManagementReason?: string;
        lockedAtRisk?: number;
        entropyDecay?: number;
    };
}

export interface Trade extends Position {
    exitPrice: number;
    exitTime: string;
    pnl: number;
    exitReason: string;
    mfe?: number;
    mae?: number;
}

export interface BotLogEntry {
    timestamp: Date;
    message: string;
    type: LogType;
}

export interface RunningBot {
    id: string;
    config: BotConfig;
    status: BotStatus;
    log: BotLogEntry[];
    analysis: TradeSignal | null;
    openPositionId: number | null;
    openPosition: Position | null;
    closedTradesCount: number;
    totalPnl: number;
    wins: number;
    losses: number;
    totalGrossProfit: number;
    totalGrossLoss: number;
    lastProfitableTradeDirection: 'LONG' | 'SHORT' | null;
    accumulatedActiveMs: number;
    lastResumeTimestamp: number | null;
    klinesLoaded: number;
    livePrice?: number;
    liveTicker?: LiveTicker;
    lastAnalysisTimestamp: number | null;
    lastPriceUpdateTimestamp: number | null;
}

// --- Backtesting & Optimization ---

export interface BacktestResult {
    trades: Trade[];
    totalPnl: number;
    winRate: number;
    totalTrades: number;
    wins: number;
    losses: number;
    breakEvens: number;
    maxDrawdown: number;
    profitFactor: number;
    sharpeRatio: number;
    averageTradeDuration: string;
}

export interface OptimizationResultItem {
    params: AgentParams;
    result: BacktestResult;
}


// --- Technical Indicator Outputs ---

export interface MACDOutput {
    MACD?: number;
    signal?: number;
    histogram?: number;
}

export interface BollingerBandsOutput {
    middle: number;
    upper: number;
    lower: number;
    pb: number;
}

export interface ADXOutput {
    adx: number;
    pdi: number;
    mdi: number;
}

export interface StochasticRSIOutput {
    k: number;
    d: number;
    }

export interface VortexIndicatorOutput {
    pdi: number[];
    ndi: number[];
}

export interface IchimokuCloudOutput {
    conversion: number;
    base: number;
    spanA: number;
    spanB: number;
    span: number;
}

export interface SentinelAnalysis {
    bullish: {
        total: number;
        structure: number;
        momentum: number;
        context: number;
    };
    bearish: {
        total: number;
        structure: number;
        momentum: number;
        context: number;
    };
}

export interface ConductorAnalysis {
    bullish: { total: number; structure: number; momentum: number; context: number; confirmation: number; };
    bearish: { total: number; structure: number; momentum: number; context: number; confirmation: number; };
}

// --- User Preferences ---
export interface TradingPairList {
    id: string;
    name: string;
    pairs: string[];
    tradingMode: TradingMode;
}

export interface UserPreferences {
    tradingPairLists: TradingPairList[];
    dailyLossLimit?: number;
}
