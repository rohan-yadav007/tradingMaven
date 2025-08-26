// Manually define indicator output types as they are not exported by 'technicalindicators'
export interface ADXOutput {
  adx: number;
  pdi: number;
  mdi: number;
}

export interface MACDOutput {
  MACD?: number;
  signal?: number;
  histogram?: number;
}

export interface BollingerBandsOutput {
  upper: number;
  middle: number;
  lower: number;
  pb: number;
}

export interface StochasticRSIOutput {
  stochRSI: number;
  k: number;
  d: number;
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
}

export interface MarketDataContext {
    rsi14?: number;
    stochRsi?: StochasticRSIOutput;
    ema9?: number;
    ema21?: number;
    ema50?: number;
    ema200?: number;
    sma50?: number;
    sma200?: number;
    macd?: MACDOutput;
    adx14?: ADXOutput;
    atr14?: number;
    bb20_2?: BollingerBandsOutput;
    volumeSma20?: number;
    obvTrend?: 'bullish' | 'bearish' | 'neutral';
    vi14?: { pdi: number; ndi: number };
    ichiCloud?: IchimokuCloudOutput;
    lastCandlePattern?: { name: string; type: 'bullish' | 'bearish' } | null;
    // Higher Timeframe Context
    htf_stochRsi?: StochasticRSIOutput;
    htf_rsi14?: number;
    htf_ema9?: number;
    htf_ema21?: number;
    htf_ema50?: number;
    htf_ema200?: number;
    htf_macd?: MACDOutput;
    htf_adx14?: ADXOutput;
    htf_obvTrend?: 'bullish' | 'bearish' | 'neutral';
    htf_vi14?: { pdi: number; ndi: number };
    htf_trend?: 'bullish' | 'bearish' | 'neutral';
}


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

export interface SentinelAnalysis {
    bullish: {
        total: number;
        trend: number;
        momentum: number;
        confirmation: number;
    };
    bearish: {
        total: number;
        trend: number;
        momentum: number;
        confirmation: number;
    };
}


export interface TradeSignal {
    signal: 'BUY' | 'SELL' | 'HOLD';
    reasons: string[];
    // These are added so the bot's tick method can pass the final calculated
    // targets and the execution price to the handler.
    stopLossPrice?: number;
    takeProfitPrice?: number;
    entryPrice?: number;
    sentinelAnalysis?: SentinelAnalysis;
}

// For proactive trade management
export interface TradeManagementSignal {
    newStopLoss?: number;
    newTakeProfit?: number;
    action?: 'hold' | 'close' | 'flip';
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
    investmentAmount: number; // The initial margin used for the trade
    leverage: number;
    marginType?: 'ISOLATED' | 'CROSSED';
    entryTime: string;
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

    initialRiskInPrice: number;
    // For SL transparency
    activeStopLossReason: 'Agent Logic' | 'Hard Cap' | 'Profit Secure' | 'Agent Trail' | 'Breakeven';
    isBreakevenSet?: boolean;
    proactiveLossCheckTriggered: boolean;
    profitLockTier: number; // 0 for none, or the fee-multiple trigger (e.g., 3, 4, 5)
    profitSpikeTier?: number; // Tracks the new Profit Spike Protector state
    peakPrice?: number; // Highest price for LONG, lowest for SHORT since entry (for MFE)
    troughPrice?: number; // Lowest price for LONG, highest for SHORT since entry (for MAE)
    candlesSinceEntry?: number; // For state-based management (Chameleon V2)
    hasBeenProfitable?: boolean; // For trade invalidation check
    takerFeeRate: number;
    // --- Analytics Snapshots ---
    initialRiskRewardRatio?: number;
    agentParamsSnapshot?: AgentParams;
    botConfigSnapshot?: {
        isHtfConfirmationEnabled: boolean;
        isUniversalProfitTrailEnabled: boolean;
        isMinRrEnabled: boolean;
        isInvalidationCheckEnabled?: boolean;
        isReanalysisEnabled?: boolean;
        htfTimeFrame?: 'auto' | string;
    };
    entryContext?: MarketDataContext;
}

export interface Trade extends Position {
    exitPrice: number;
    exitTime: string;
    pnl: number; // Net PNL (after fees)
    exitReason: string;
    mfe?: number; // Max Favorable Excursion in dollars
    mae?: number; // Max Adverse Excursion in dollars
    exitContext?: MarketDataContext;
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
    isMinRrEnabled: boolean;
    isInvalidationCheckEnabled?: boolean;
    isReanalysisEnabled?: boolean;
    htfTimeFrame?: 'auto' | string;
    agentParams?: AgentParams;
    pricePrecision: number;
    quantityPrecision: number;
    stepSize: number;
    takerFeeRate: number;
    refreshInterval?: number;
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
    lastAnalysisTimestamp: number | null;
    lastPriceUpdateTimestamp: number | null;
    livePrice?: number;
    liveTicker?: LiveTicker;
}

export enum BotStatus {
    Starting = 'Starting',
    Monitoring = 'Monitoring',
    ExecutingTrade = 'ExecutingTrade',
    PositionOpen = 'PositionOpen',
    Paused = 'Paused',
    Stopped = 'Stopped',
    Error = 'Error',
    Stopping = 'Stopping',
    FlipPending = 'FlipPending',
}
export interface LeverageBracket {
    bracket: number;
    initialLeverage: number;
    notionalCap: number;
    notionalFloor: number;
    maintMarginRatio: number;
    cum: number;
}

export type BinanceOrderResponse = {
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
};

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

export interface SimulatedTrade {
    id: number;
    pair: string;
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    exitPrice: number;
    entryTime: number;
    exitTime: number;
    size: number;
    investedAmount: number;
    pnl: number;
    exitReason: string;
    entryReason: string;
}

export interface VortexIndicatorOutput {
    pdi: number[];
    ndi: number[];
}
export type AgentParams = Partial<{
    rsiPeriod: number;
    atrPeriod: number;
    adxPeriod: number;
    viPeriod: number;
    obvPeriod: number;
    macdFastPeriod: number;
    macdSlowPeriod: number;
    macdSignalPeriod: number;
    invalidationCandleLimit: number;
    adxTrendThreshold: number;
    mom_emaFastPeriod: number;
    mom_emaSlowPeriod: number;
    mom_rsiThresholdBullish: number;
    mom_rsiThresholdBearish: number;
    mom_volumeSmaPeriod: number;
    mom_volumeMultiplier: number;
    mom_atrVolatilityThreshold: number;
    tr_emaFastPeriod: number;
    tr_emaSlowPeriod: number;
    tr_rsiMomentumBullish: number;
    tr_rsiMomentumBearish: number;
    tr_breakoutPeriod: number;
    tr_volumeSmaPeriod: number;
    tr_volumeMultiplier: number;
    mr_adxPeriod: number;
    mr_adxThreshold: number;
    mr_bbPeriod: number;
    mr_bbStdDev: number;
    mr_rsiPeriod: number;
    mr_rsiOversold: number;
    mr_rsiOverbought: number;
    mr_htfEmaPeriod: number;
    se_emaFastPeriod: number;
    se_emaSlowPeriod: number;
    se_rsiPeriod: number;
    se_rsiOversold: number;
    se_rsiOverbought: number;
    se_bbPeriod: number;
    se_bbStdDev: number;
    se_atrPeriod: number;
    se_atrVolatilityThreshold: number;
    se_macdFastPeriod: number;
    se_macdSlowPeriod: number;
    se_macdSignalPeriod: number;
    se_scoreThreshold: number;
    mi_bbPeriod: number;
    mi_bbStdDev: number;
    mi_bbwSqueezeThreshold: number;
    mi_volumeLookback: number;
    mi_volumeMultiplier: number;
    mi_emaBiasPeriod: number;
    scalp_scoreThreshold: number;
    scalp_emaPeriod: number;
    scalp_rsiPeriod: number;
    scalp_stochRsiPeriod: number;
    scalp_stochRsiOversold: number;
    scalp_stochRsiOverbought: number;
    scalp_superTrendPeriod: number;
    scalp_superTrendMultiplier: number;
    scalp_psarStep: number;
    scalp_psarMax: number;
    msm_htfEmaPeriod: number;
    msm_swingPointLookback: number;
    msm_minPivotScore: number;
    isCandleConfirmationEnabled: boolean;
    qsc_adxPeriod: number;
    qsc_adxThreshold: number;
    qsc_adxChopBuffer: number;
    qsc_bbPeriod: number;
    qsc_bbStdDev: number;
    qsc_bbwSqueezeThreshold: number;
    qsc_stochRsiPeriod: number;
    qsc_stochRsiOversold: number;
    qsc_stochRsiOverbought: number;
    qsc_superTrendPeriod: number;
    qsc_superTrendMultiplier: number;
    qsc_psarStep: number;
    qsc_psarMax: number;
    qsc_atrPeriod: number;
    qsc_atrMultiplier: number;
    qsc_trendScoreThreshold: number;
    qsc_rangeScoreThreshold: number;
    qsc_ichi_conversionPeriod: number;
    qsc_ichi_basePeriod: number;
    qsc_ichi_laggingSpanPeriod: number;
    qsc_ichi_displacement: number;
    qsc_vwapDeviationPercent: number;
    qsc_rsiOverextendedLong: number;
    qsc_rsiOverextendedShort: number;
    qsc_entryMode: 'breakout' | 'pullback';
    qsc_rsiMomentumThreshold: number;
    qsc_rsiPullbackThreshold: number;
    he_trendSmaPeriod: number;
    he_fastEmaPeriod: number;
    he_slowEmaPeriod: number;
    he_rsiPeriod: number;
    he_rsiMidline: number;
    he_adxTrendThreshold: number;
    ch_fastEmaPeriod: number;
    ch_slowEmaPeriod: number;
    ch_trendEmaPeriod: number;
    ch_adxThreshold: number;
    ch_kst_rocPer1: number;
    ch_kst_rocPer2: number;
    ch_kst_rocPer3: number;
    ch_kst_rocPer4: number;
    ch_kst_smaRocPer1: number;
    ch_kst_smaRocPer2: number;
    ch_kst_smaRocPer3: number;
    ch_kst_smaRocPer4: number;
    ch_kst_signalPeriod: number;
    sentinel_scoreThreshold: number;
    vwap_emaTrendPeriod: number;
    vwap_proximityPercent: number;
    ichi_conversionPeriod: number;
    ichi_basePeriod: number;
    ichi_laggingSpanPeriod: number;
    ichi_displacement: number;
    det_bb1_len: number;
    det_bb1_dev: number;
    det_bb2_len: number;
    det_bb2_dev: number;
    det_bb3_len: number;
    det_bb3_dev: number;
    det_bb4_len: number;
    det_bb4_dev: number;
    det_ema_fast_len: number;
    det_ema_slow_len: number;
    det_rsi_len: number;
    det_rsi_thresh: number;
    det_vol_len: number;
    det_vol_mult: number;
    det_atr_len: number;
    det_sl_atr_mult: number;
    det_rr_mult: number;
    det_max_bar_move_pct: number;
    det_bb_margin_pct: number;
    det_maxSlAtrMult: number;
    csp_emaMomentumPeriod: number;
}>;