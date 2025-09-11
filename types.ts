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

export enum RiskMode {
    Percent = 'Percent',
    ATR = 'ATR',
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

// --- Order Book ---

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
    
    // Agent 14: The Sentinel
    sentinel_scoreThreshold?: number;
    sentinel_rsiOverextendedLong?: number;
    sentinel_rsiOverextendedShort?: number;
    sentinel_bbwSqueezeThreshold?: number;
    sentinel_atrChaosThreshold?: number;
    sentinel_strongTrendAdx?: number;
    sentinel_strongTrendThreshold?: number;
    sentinel_choppyTrendAdx?: number;
    sentinel_choppyTrendThreshold?: number;
    sentinel_trendingWeightMultiplier?: number;
    sentinel_transitioningWeightMultiplier?: number;
    sentinel_emaFastPeriod?: number;
    sentinel_emaSlowPeriod?: number;
    sentinel_adxPeriod?: number;
    sentinel_rsiPeriod?: number;
    sentinel_macdFastPeriod?: number;
    sentinel_macdSlowPeriod?: number;
    sentinel_macdSignalPeriod?: number;
    sentinel_useSrLevelsForTp?: boolean;
    sentinel_stPeriod?: number;
    sentinel_stMultiplier?: number;
    
    // Agent 17: Momentum Swing Trader
    mst_emaFastPeriod?: number;
    mst_emaSlowPeriod?: number;
    mst_macdFastPeriod?: number;
    mst_macdSlowPeriod?: number;
    mst_macdSignalPeriod?: number;
    
    // SMC Reversal Veto
    smc_divergenceLookback?: number;
    smc_volumeMultiplier?: number;
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
    invalidationScore?: number;
    proactiveLossCheckTriggered: boolean;
    adaptiveTpTriggered?: boolean;
    entryContext?: Partial<MarketDataContext>;
    exitContext?: Partial<MarketDataContext>;
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

export interface KSTOutput {
    kst: number;
    signal: number;
}

export interface IchimokuCloudOutput {
    conversion: number;
    base: number;
    spanA: number;
    spanB: number;
    span: number;
}

export interface SentinelAnalysis {
    bullish: { total: number; trend: number; momentum: number; confirmation: number; structure: number; };
    bearish: { total: number; trend: number; momentum: number; confirmation: number; structure: number; };
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
