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


// --- Binance API Specific ---

export interface SymbolFilter {
    filterType: 'PRICE_FILTER' | 'LOT_SIZE' | 'MARKET_LOT_SIZE' | 'MAX_NUM_ORDERS' | 'MAX_NUM_ALGO_ORDERS' | 'ICEBERG_PARTS' | 'MIN_NOTIONAL';
    [key: string]: any;
}

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
    veto_normalizeAtrChaos?: boolean; // Tweak #2
    // -- Adaptive Concordance --
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
    
    // Agent 14: The Sentinel V2 (Market Structure First)
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
    // FIX: Add missing parameters for Sentinel exit/SL logic used in riskManagementService
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

    // SMC Reversal Veto
    smc_divergenceLookback?: number;
    smc_volumeMultiplier?: number;
    smc_requireConfluenceOnScalp?: boolean; // Tweak #3
    smc_confluence_bbwSqueezeThreshold?: number; // Tweak #3

    // BTC Correlation Veto (Tweak #5)
    btc_correlation_veto_ema_fast?: number;
    btc_correlation_veto_ema_slow?: number;
    
    // Risk Management
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
    // HTF prefixed properties
    htf_rsi14?: number;
    htf_adx14?: ADXOutput;
    htf_stochRsi?: StochasticRSIOutput;
    htf_trend?: 'bullish' | 'bearish' | 'neutral';
}

export interface TradeSignal {
    signal: 'BUY' | 'SELL' | 'HOLD';
    reasons: string[];
    entryPrice?: number;
    takeProfitPrice?: number;
    stopLossPrice?: number;
    sentinelAnalysis?: SentinelAnalysis;
    conductorAnalysis?: ConductorAnalysis;
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
    isBtcCorrelationVetoEnabled?: boolean; // Tweak #5
    btcConfirmationThreshold?: number;
    isVolumeFilterEnabled?: boolean;
    isAdxFilterEnabled?: boolean;
    isExhaustionFilterEnabled?: boolean;
    isSmcVetoEnabled?: boolean;
    isSrAnalysisEnabled?: boolean;
    isCandlestickConfirmationEnabled?: boolean;
    isMarketStructureVetoEnabled?: boolean;
    isAdaptiveTpEnabled: boolean;
    aggressiveTrailMode: 'distance' | 'pnl';
    agentParams: AgentParams;
    htfAgentParams?: AgentParams;
    pricePrecision: number;
    quantityPrecision: number;
    stepSize: number;
    takerFeeRate: number;
    entryTiming: 'immediate' | 'onNextCandle';
    telegramChatId?: string;
    refreshInterval?: number;
    isMarketBreadthFilterEnabled?: boolean;
    isLiquidationFilterEnabled?: boolean;
    isConfirmationCandleEnabled?: boolean;
    isMomentumConcordanceEnabled: boolean;
    finalEntryFailSafe?: 'fail-open' | 'fail-closed';
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
    isBtcCorrelationVetoEnabled?: boolean; // Tweak #5
    btcConfirmationThreshold?: number;
    isVolumeFilterEnabled?: boolean;
    isAdxFilterEnabled?: boolean;
    isExhaustionFilterEnabled?: boolean;
    isSmcVetoEnabled?: boolean;
    isSrAnalysisEnabled?: boolean;
    isCandlestickConfirmationEnabled?: boolean;
    isMarketStructureVetoEnabled?: boolean;
    htfTimeFrame?: 'auto' | string;
    entryTiming?: 'immediate' | 'onNextCandle';
    isAdaptiveTpEnabled?: boolean;
    aggressiveTrailMode?: 'distance' | 'pnl';
    isInitialRiskVetoEnabled?: boolean;
    isMarketBreadthFilterEnabled?: boolean;
    isLiquidationFilterEnabled?: boolean;
    isConfirmationCandleEnabled?: boolean;
    isMomentumConcordanceEnabled: boolean;
    finalEntryFailSafe?: 'fail-open' | 'fail-closed';
}

export interface Position {
    id: number;
    botId: string | null;
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
    initialTakeProfitPrice: number;
    initialStopLossPrice: number;
    initialRiskInPrice: number;
    initialStopLossReason: 'Agent Logic' | 'Hard Cap';
    activeStopLossReason: 'Agent Logic' | 'Hard Cap' | 'Profit Secure' | 'Breakeven' | 'Agent Trail';
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
}
