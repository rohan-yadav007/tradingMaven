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
    closePosition?: boolean;
    closeAndFlipPosition?: boolean; // For Agent 13 V2
    reasons: string[];
    newState?: any; // Generic state update object
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
    // For R:R based trailing
    initialStopLossPrice: number;
    initialTakeProfitPrice: number;
    // For SL transparency
    activeStopLossReason: 'Agent Logic' | 'Hard Cap' | 'Profit Secure' | 'Agent Trail' | 'Breakeven';
    isBreakevenSet?: boolean;
    proactiveLossCheckTriggered: boolean;
    profitLockTier: number; // 0 for none, or the fee-multiple trigger (e.g., 3, 4, 5)
    peakPrice?: number; // Highest price for LONG, lowest for SHORT since entry
    candlesSinceEntry?: number; // For state-based management (Chameleon V2)
    hasBeenProfitable?: boolean; // For trade invalidation check
}

export interface Trade extends Position {
    exitPrice: number;
    exitTime: Date;
    pnl: number; // Net PNL (after fees)
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
    takeProfitMode: RiskMode;
    takeProfitValue: number;
    // Proactive Management Toggles
    isTakeProfitLocked: boolean;
    isHtfConfirmationEnabled: boolean;
    isUniversalProfitTrailEnabled: boolean;
    isTrailingTakeProfitEnabled: boolean;
    isMinRrEnabled: boolean;
    isInvalidationCheckEnabled?: boolean;
    htfTimeFrame?: 'auto' | string;
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

export interface ChameleonAgentState {
    // Strategic context (updated on candle close)
    lastAtr: number;
    lastRsi: number;
    swingPoint: number; // The most recent valid swing low/high
    fastEma: number;
    slowEma: number;
    lastPsar?: number;
    lastAdx?: ADXOutput;
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
    // Performance Metrics
    closedTradesCount: number;
    totalPnl: number; // Gross PNL
    wins: number;
    losses: number;
    totalGrossProfit: number;
    totalGrossLoss: number; // Stored as a positive number
    // State & Monitoring
    lastProfitableTradeDirection: 'LONG' | 'SHORT' | null;
    accumulatedActiveMs: number;
    lastResumeTimestamp: number | null;
    klinesLoaded?: number;
    lastAnalysisTimestamp: number | null;
    lastPriceUpdateTimestamp: number | null;
    agentState?: ChameleonAgentState;
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
    invalidationCandleLimit?: number; // Universal invalidation check

    // Agent 1: Momentum Master
    adxTrendThreshold?: number;
    mom_emaFastPeriod?: number;
    mom_emaSlowPeriod?: number;
    mom_rsiThresholdBullish?: number;
    mom_rsiThresholdBearish?: number;
    mom_volumeSmaPeriod?: number;
    mom_volumeMultiplier?: number;
    mom_atrVolatilityThreshold?: number;
    
    // Agent 2: Trend Rider
    tr_emaFastPeriod?: number;
    tr_emaSlowPeriod?: number;
    tr_rsiMomentumBullish?: number;
    tr_rsiMomentumBearish?: number;
    tr_breakoutPeriod?: number;
    tr_volumeSmaPeriod?: number;
    tr_volumeMultiplier?: number;

    // Agent 3: Mean Reversionist
    mr_adxPeriod?: number;
    mr_adxThreshold?: number;
    mr_bbPeriod?: number;
    mr_bbStdDev?: number;
    mr_rsiPeriod?: number;
    mr_rsiOversold?: number;
    mr_rsiOverbought?: number;
    mr_htfEmaPeriod?: number;

    // Agent 4: Scalping Expert (NEW LOGIC)
    se_emaFastPeriod?: number;
    se_emaSlowPeriod?: number;
    se_rsiPeriod?: number;
    se_rsiOversold?: number;
    se_rsiOverbought?: number;
    se_bbPeriod?: number;
    se_bbStdDev?: number;
    se_atrPeriod?: number;
    se_atrVolatilityThreshold?: number; // As a percentage, e.g., 0.5 for 0.5%
    se_macdFastPeriod?: number;
    se_macdSlowPeriod?: number;
    se_macdSignalPeriod?: number;
    se_scoreThreshold?: number;

    // Agent 5: Market Ignition
    mi_bbPeriod?: number;
    mi_bbStdDev?: number;
    mi_bbwSqueezeThreshold?: number;
    mi_volumeLookback?: number;
    mi_volumeMultiplier?: number;
    mi_emaBiasPeriod?: number;

    // Agent 6: Profit Locker (uses old scalping logic)
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
    scalp_obvLookback?: number;
    scalp_obvScore?: number;

    // Agent 7: Market Structure Maven
    msm_htfEmaPeriod?: number;
    msm_swingPointLookback?: number;
    msm_minPivotScore?: number;
    isCandleConfirmationEnabled?: boolean; // New feature

    // Agent 9: Quantum Scalper
    qsc_fastEmaPeriod?: number;
    qsc_slowEmaPeriod?: number;
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

    // Agent 11: Historic Expert
    he_trendSmaPeriod?: number;
    he_fastEmaPeriod?: number;
    he_slowEmaPeriod?: number;
    he_rsiPeriod?: number;
    he_rsiMidline?: number;

    // Agent 13: The Chameleon
    ch_rsiPeriod?: number;
    ch_atrPeriod?: number;
    ch_momentumThreshold?: number; // e.g., 65 for bullish, 35 for bearish
    ch_volatilityMultiplier?: number; // Base ATR multiplier for SL
    ch_lookbackPeriod?: number; // For swing points and divergence
    ch_bbPeriod?: number;
    ch_bbStdDev?: number;
    ch_profitLockMultiplier?: number; // For aggressive trailing
    ch_volatilitySpikeMultiplier?: number; // For entry veto
    ch_psarStep?: number;
    ch_psarMax?: number;
    ch_scoreThreshold?: number;
    // V2 Params
    ch_adxThreshold?: number;
    ch_volumeMultiplier?: number;
    ch_breathingRoomCandles?: number;
    // V3 Params
    ch_useHybridTrail?: boolean;

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
