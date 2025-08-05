

export enum TradingMode {
    Spot = 'Spot',
    USDSM_Futures = 'USDS-M Futures',
}

export interface Agent {
    id: number;
    name: string;
    description: string;
    indicators: string[];
}

export interface TradeSignal {
    signal: 'BUY' | 'SELL' | 'HOLD';
    reasons: string[];
    // These are added so the bot's tick method can pass the final calculated
    // targets and the execution price to the handler.
    stopLossPrice?: number;
    takeProfitPrice?: number;
    entryPrice?: number;
}

// For proactive trade management
export interface TradeManagementSignal {
    newStopLoss?: number;
    newTakeProfit?: number;
    reasons: string[];
}


export interface Position {
    id: number;
    pair: string;
    mode: TradingMode;
    executionMode: 'live' | 'paper';
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    size: number;
    leverage: number;
    marginType?: 'ISOLATED' | 'CROSSED';
    entryTime: Date;
    entryReason: string;
    agentName: string;
    takeProfitPrice: number;
    stopLossPrice: number;
    pricePrecision: number;
    timeFrame: string;
    botId?: string; // Link back to the bot that opened this position
    orderId: number | null; // Store the real order ID from Binance
    liquidationPrice?: number; // For futures positions
}

export interface Trade extends Position {
    exitPrice: number;
    exitTime: Date;
    pnl: number;
    exitReason: string;
}

export interface RawWalletBalance {
    asset: string;
    free: number;
    locked: number;
    total: number;
}
export interface WalletBalance extends RawWalletBalance {
    usdValue: number;
}


// --- Margin Account Types ---
// Removed as Margin trading is no longer supported.

export interface AccountInfo {
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  updateTime: number;
  accountType: string;
  balances: WalletBalance[];

  // Spot-specific
  makerCommission?: number;
  takerCommission?: number;
  buyerCommission?: number;
  sellerCommission?: number;
  permissions?: string[];

  // Futures-specific
  feeTier?: number;
  totalInitialMargin?: string;
  totalMaintMargin?: string;
  totalUnrealizedProfit?: string;
  totalMarginBalance?: string;
  totalWalletBalance?: string;
  positions?: any[]; // For futures, to check for open positions
}


export interface Kline {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    isFinal?: boolean; // From websocket stream
}

export enum LogType {
    Info = 'Info',
    Status = 'Status',
    Success = 'Success',
    Error = 'Error',
    Action = 'Action',
}

export interface BotLogEntry {
    timestamp: Date;
    message: string;
    type: LogType;
}

export interface LiveTicker {
    pair: string;
    closePrice: number;
    highPrice: number;

    lowPrice: number;
    volume: number;
    quoteVolume: number;
}

export interface SymbolFilter {
    filterType: 'PRICE_FILTER' | 'LOT_SIZE' | 'MARKET_LOT_SIZE' | string;
    minPrice?: string;
    maxPrice?: string;
    tickSize?: string;
    minQty?: string;
    maxQty?: string;
    stepSize?: string;
}

export interface SymbolInfo {
    symbol: string;
    status: string;
    baseAsset: string;
    baseAssetPrecision: number;
    quoteAsset: string;
    quotePrecision: number;
    quoteAssetPrecision: number;
    orderTypes: string[];
    icebergAllowed: boolean;
    ocoAllowed: boolean;
    quoteOrderQtyMarketAllowed: boolean;
    allowTrailingStop: boolean;
    cancelReplaceAllowed: boolean;
    isSpotTradingAllowed: boolean;
    isMarginTradingAllowed: boolean;
    filters: SymbolFilter[];
    permissions: string[];
    defaultSelfTradePreventionMode: string;
    allowedSelfTradePreventionModes: string[];
}

export enum RiskMode {
    Percent = 'percent',
    Amount = 'amount',
}

export interface BotConfig {
    pair: string;
    mode: TradingMode;
    executionMode: 'live' | 'paper';
    leverage: number;
    marginType?: 'ISOLATED' | 'CROSSED';
    agent: Agent;
    timeFrame: string;
    // Risk management model
    investmentAmount: number;
    stopLossMode: RiskMode;
    stopLossValue: number;
    takeProfitMode: RiskMode;
    takeProfitValue: number;
    // Proactive Management Toggles
    isStopLossLocked: boolean;
    isTakeProfitLocked: boolean;
    isCooldownEnabled: boolean;
    agentParams?: AgentParams;
    // Precision data for self-contained bot logic
    pricePrecision: number;
    quantityPrecision: number;
    stepSize: number;
}

export enum BotStatus {
    Starting = 'Starting',
    Monitoring = 'Monitoring',
    ExecutingTrade = 'Executing Trade',
    PositionOpen = 'Position Open',
    Cooldown = 'Cooldown',
    Paused = 'Paused',
    Stopping = 'Stopping',
    Stopped = 'Stopped',
    Error = 'Error',
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
    avgPrice?: string; // For futures
}


export interface RunningBot {
    id: string;
    config: BotConfig;
    status: BotStatus;
    analysis: TradeSignal | null;
    log: BotLogEntry[];
    livePrice?: number;
    liveTicker?: LiveTicker;
    openPositionId: number | null;
    openPosition: Position | null;
    closedTradesCount: number;
    totalPnl: number;
    cooldownUntil: number | null; // Timestamp
    accumulatedActiveMs: number;
    lastResumeTimestamp: number | null;
    klinesLoaded?: number;
    lastAnalysisTimestamp: number | null;
}

export interface LeverageBracket {
    bracket: number;
    initialLeverage: number;
    notionalCap: number;
    notionalFloor: number;
    maintMarginRatio: number;
    cum: number;
}


// --- Backtesting Types ---
export interface AgentParams {
    // General - re-used across agents
    rsiPeriod?: number;
    atrPeriod?: number;
    adxPeriod?: number;
    macdFastPeriod?: number;
    macdSlowPeriod?: number;
    macdSignalPeriod?: number;

    // Agent 1: Momentum Master
    adxTrendThreshold?: number;
    mom_emaFastPeriod?: number;
    mom_emaSlowPeriod?: number;
    mom_rsiThresholdBullish?: number;
    mom_rsiThresholdBearish?: number;
    mom_volumeSmaPeriod?: number;
    mom_volumeMultiplier?: number;

    // Agent 4: Scalping Expert (Score-based)
    scalp_scoreThreshold?: number;
    scalp_emaPeriod?: number;
    scalp_rsiPeriod?: number; // Used for StochRSI
    scalp_stochRsiPeriod?: number;
    scalp_stochRsiOversold?: number;
    scalp_stochRsiOverbought?: number;
    scalp_superTrendPeriod?: number;
    scalp_superTrendMultiplier?: number;
    scalp_psarStep?: number;
    scalp_psarMax?: number;
    
    // Agent 5 & 6: Market Phase Adaptor & Profit Locker
    mpa_adxTrend?: number;
    mpa_adxChop?: number;
    mpa_bbwSqueeze?: number;
    mpa_trendEmaFast?: number;
    mpa_trendEmaSlow?: number;
    mpa_rangeBBPeriod?: number;
    mpa_rangeBBStdDev?: number;
    mpa_rangeRsiOversold?: number;
    mpa_rangeRsiOverbought?: number;

    // Agent 7: Market Structure Maven
    msm_htfEmaPeriod?: number;
    msm_swingPointLookback?: number;

    // Agent 8: Institutional Scalper
    inst_lookbackPeriod?: number;
    inst_powerCandleMultiplier?: number;
}


export interface SimulatedTrade {
    id: number;
    pair: string;
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    exitPrice: number;
    entryTime: number;
    exitTime: number;
    size: number;
    pnl: number;
    exitReason: string;
    entryReason: string;
    investedAmount: number;
}

export interface BacktestResult {
    trades: SimulatedTrade[];
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

// --- Agent-Specific Types ---

// This holds all pre-calculated indicator values, computed once per tick.
export interface ComputedIndicators {
    klines: Kline[];
    closes: number[];
    highs: number[];
    lows: number[];
    volumes: number[];
    currentPrice: number;

    // Indicators with multiple variations, uniquely named
    adx14?: ADXOutput;
    atr14?: number;
    bb20_2?: BollingerBandsOutput;
    prev_bb20_2?: BollingerBandsOutput;
    bb20_2_values?: BollingerBandsOutput[];
    bb20_2_width?: number;
    ema5?: number;
    ema9?: number;
    ema20?: number;
    ema50?: number;
    ema100?: number;
    ema200?: number;
    macd_12_26_9?: MACDOutput;
    prev_macd_12_26_9?: MACDOutput;
    obv?: number;
    psar_002_02?: number;
    rsi14?: number;
    prev_rsi14?: number;
    stochRsi_14_14_3_3?: StochasticRSIOutput;
    st10_3?: { trend: 'bullish' | 'bearish', supertrend: number };
    volumeSma20?: number;
    currentVolume?: number;
    candlestick?: { bullish: boolean; bearish: boolean; pattern: string | null };
}

export interface MACDOutput {
  MACD?: number;
  signal?: number;
  histogram?: number;
}

export interface ADXOutput {
    adx: number;
    pdi: number;
    mdi: number;
}

export interface BollingerBandsOutput {
    middle: number;
    upper: number;
    lower: number;
}

export interface StochasticRSIOutput {
    stochRSI: number;
    k: number;
    d: number;
}