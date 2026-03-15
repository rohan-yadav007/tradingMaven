
// types.ts

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

export interface Kline {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    takerBuyVolume?: number; 
    isFinal: boolean;
    closeTime?: number;
}

export interface LiveTicker {
    pair: string;
    closePrice: number;
    highPrice: number;
    lowPrice: number;
    volume: number;
    quoteVolume: number;
}

export interface TapeMetrics {
    velocity: number; // Volume per second (USD)
    buyPressure: number; // 0.0 to 1.0 (0.5 = neutral, >0.5 = bullish)
    tradeCount: number;
    isIgnition: boolean; // True if velocity is > 3x the recent average
    timestamp: number;
}

export interface OpenInterestKline {
    symbol: string;
    sumOpenInterest: string; 
    sumOpenInterestValue: string;
    timestamp: number;
}

export interface LongShortRatio {
    symbol: string;
    longShortRatio: number;
    longAccount: number;
    shortAccount: number;
    timestamp: number;
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

export interface SymbolFilter {
    filterType: 'PRICE_FILTER' | 'LOT_SIZE' | 'MARKET_LOT_SIZE' | 'MAX_NUM_ORDERS' | 'MAX_NUM_ALGO_ORDERS' | 'ICEBERG_PARTS' | 'MIN_NOTIONAL';
    [key: string]: any;
}

export interface WalletBalance {
    asset: string;
    free: number;
    locked: number;
    total: number;
    usdValue: number;
}

export interface AccountInfo {
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

export interface OrderBookAnalysis {
    imbalance: number; 
    spread: number;
    depthRatio: number;
    bidWall: number | null;
    askWall: number | null;
}

export interface SwingPoint {
    index: number;
    price: number;
    type: 'high' | 'low';
}

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
    omega_patience?: 'Low' | 'Medium' | 'High';
    omega_intent?: 'Preserve' | 'Growth' | 'Alpha';
    omega_auto_mode?: boolean;
    omega_session_filter?: boolean;
    omega_minExpectancy?: number;
    [key: string]: any;
}

export type OmegaIntent = 'Preserve' | 'Growth' | 'Alpha';

export interface OmegaAnalysis {
    conviction: number;
    intent?: OmegaIntent;
    marketState: {
        bias1H: 'Bullish' | 'Bearish' | 'Neutral';
        structure: 'Uptrend' | 'Downtrend' | 'Ranging';
    };
    sentiment: {
        lsRatio: number;
        cvdState: 'Absorption' | 'Distribution' | 'Neutral';
        fundingRate: string;
        tape?: string;
        oiState?: string; // New: Open Interest State
    };
    poiStatus: {
        type: 'Liquidity Sweep' | 'Order Block' | 'FVG Entry' | 'None';
        distance: string; 
        priceLevel: number;
    };
    triggerStatus: {
        ready: boolean;
        condition: string;
    };
    targets: { entry: number, stopLoss: number, takeProfit: number };
    mode?: string;
    sizing?: { multiplier: number };
    sessionAnalysis?: string;
    htfAlignment?: 'Aligned' | 'Conflicted' | 'Neutral';
    scoreBreakdown?: {
        structure: number;
        momentum: number;
        context: number;
        model?: number;          // universal model delta contribution
    };
    modelScore?: {
        delta: number;           // net confidence delta applied
        activeCount: number;     // number of aligning conditions
        hourWinRate: number;     // consensus win rate for this UTC hour (0 = no data)
        perfectBonus: number;    // extra bonus from top-condition alignment
    };
}

export interface BitcoinState {
    state: 'CRASH' | 'PUMP' | 'RANGE' | 'TREND_UP' | 'TREND_DOWN' | 'NEUTRAL';
    trend: 'bullish' | 'bearish' | 'neutral';
    momentum: 'accelerating' | 'decelerating' | 'neutral';
    reason: string;
    rejection: string;
}

export interface TradeSignal {
    signal: 'BUY' | 'SELL' | 'HOLD';
    reasons: string[];
    entryPrice?: number;
    takeProfitPrice?: number;
    stopLossPrice?: number;
    invalidationPrice?: number;
    omegaAnalysis?: OmegaAnalysis;
    astraXAnalysis?: AstraXAnalysis;
    conductorAnalysis?: ConductorAnalysis;
    sentinelAnalysis?: SentinelAnalysis;
    tradeType?: 'conviction' | 'scalp';
    setupType?: string; 
    omegaMetadata?: any;
    isOmegaSetupReady?: boolean;
    omegaSetupDirection?: 'LONG' | 'SHORT';
    omegaSetupZone?: { low: number, high: number };
    btcContext?: BitcoinState;
}

export interface AstraXAnalysis {
    conviction: number;
    regime: string;
    thesis: 'Bullish' | 'Bearish';
    setupName: string;
    confidenceMetrics: {
        structure: number;
        momentum: number;
        technical: number;
        volume: number;
    };
}

export interface ConductorAnalysis {
    bullish: { total: number; structure: number; momentum: number; context: number; confirmation: number };
    bearish: { total: number; structure: number; momentum: number; context: number; confirmation: number };
}

export interface SentinelAnalysis {
    bullish: { total: number; structure: number; momentum: number; context: number };
    bearish: { total: number; structure: number; momentum: number; context: number };
}

export interface Position {
    id: number;
    botId: string | null;
    agentId?: number;
    pair: string;
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    size: number;
    investmentAmount: number;
    leverage: number;
    takeProfitPrice: number;
    stopLossPrice: number;
    initialStopLossPrice: number;
    initialTakeProfitPrice: number;
    initialRiskInPrice: number;
    activeStopLossReason: string;
    initialStopLossReason: string;
    pricePrecision: number;
    timeFrame: string;
    candlesSinceEntry: number;
    takerFeeRate: number;
    peakPrice: number;
    troughPrice: number;
    profitLockTier: number;
    isBreakevenSet: boolean;
    profitSpikeTier: number;
    aggressiveTrailTier: number;
    tpLockStage: number;
    liquidationPrice?: number;
    managementForecast?: { triggerPrice: number; targetStopLoss: number; label: string };
    botConfigSnapshot?: any;
    agentParamsSnapshot?: any;
    invalidationPrice?: number;
    setupType?: string;
    entryReason?: string;
    exitReason?: string;
    entryContext?: MarketDataContext;
    exitContext?: MarketDataContext;
    btcContext?: BitcoinState;
    initialRiskRewardRatio?: number;
    mae?: number;
    mfe?: number;
    promotedFrom?: 'scalp' | 'conviction';
    [key: string]: any;
}

export interface Trade extends Position {
    exitPrice: number;
    exitTime: string;
    pnl: number;
    exitReason: string;
}

export interface RunningBot {
    id: string;
    config: BotConfig;
    status: BotStatus;
    log: BotLogEntry[]; 
    analysis: TradeSignal | null;
    openPosition: Position | null;
    openPositionId: number | null;
    totalPnl: number;
    wins: number;
    losses: number;
    livePrice?: number;
    liveTicker?: LiveTicker;
    lastResumeTimestamp: number | null;
    accumulatedActiveMs: number;
    closedTradesCount: number;
    lastPriceUpdateTimestamp: number | null;
    omegaJitActive?: boolean;
    omegaJitDirection?: 'LONG' | 'SHORT';
    omegaJitZone?: { low: number, high: number };
    klinesLoaded?: number;
    winProbability?: number;
    winProbabilityFactors?: { pnlR: number; remainingRR: number; mfeEfficiency: number; stagnationPenalty: number; breakevenBonus: number; rsiAlignment: number; volumeSupport: number; emaStructure: number; momentumScore: number };
    consecutiveLowProbabilityTicks?: number;
    probabilityHistory?: number[];
    [key: string]: any;
}

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
    minRrRatio?: number;
    agentParams: AgentParams;
    entryTiming: 'immediate' | 'onNextCandle';
    pricePrecision: number;
    quantityPrecision: number;
    stepSize: number;
    takerFeeRate: number;
    finalEntryFailSafe?: 'fail-open' | 'fail-closed';
    [key: string]: any;
}

export interface TradeManagementSignal {
    newStopLoss?: number;
    newTakeProfit?: number;
    action?: 'hold' | 'close';
    reasons: string[];
    activeStopLossReason?: string;
    forecast?: { triggerPrice: number; targetStopLoss: number; label: string };
    newState?: any;
}

export interface TradingPairList {
    id: string;
    name: string;
    pairs: string[];
    tradingMode: TradingMode;
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

export interface BollingerBandsOutput {
    upper: number;
    middle: number;
    lower: number;
    pb: number;
}

export interface MACDOutput {
    MACD?: number;
    signal?: number;
    histogram?: number;
}

export interface IchimokuCloudOutput {
    conversion: number;
    base: number;
    spanA: number;
    spanB: number;
    [key: string]: number | undefined;
}

export interface VortexIndicatorOutput {
    pdi: number[];
    ndi: number[];
}

export interface MarketStructureAnalysis {
    structure: 'Uptrend' | 'Downtrend' | 'Ranging' | 'Indeterminate';
    lastSignal: 'HH' | 'HL' | 'LH' | 'LL' | 'ChoCH_Bullish' | 'ChoCH_Bearish' | null;
    reason: string;
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
    activePatterns?: ChartPattern[];
    htf_trend?: 'bullish' | 'bearish' | 'neutral';
    fundingRate?: string;
    orderBook?: OrderBookAnalysis;
    tapeMetrics?: TapeMetrics;
    omega_metadata?: any;
    [key: string]: any;
}

export interface SetupTypeStats {
    setupType: string;
    count: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnl: number;
    avgPnl: number;
    avgWin: number;
    avgLoss: number;
    expectancy: number; // avgWin * winRate - avgLoss * (1 - winRate)
    profitFactor: number;
}

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
    setupBreakdown?: SetupTypeStats[];
}

export interface OptimizationResultItem {
    params: AgentParams;
    result: BacktestResult;
}

export interface RawWalletBalance {
    asset: string;
    free: number;
    locked: number;
    total: number;
    usdValue: number;
}

export interface LeverageBracket {
    symbol: string;
    brackets: {
        bracket: number;
        initialLeverage: number;
        notionalCap: number;
        notionalFloor: number;
        maintMarginRatio: number;
        cum: number;
    }[];
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
    [key: string]: any;
}

export interface BotLogEntry {
    timestamp: Date;
    message: string;
    type: LogType;
}

export interface SupportResistance {
    supports: { price: number; score: number; type: 'support' }[];
    resistances: { price: number; score: number; type: 'resistance' }[];
}

export interface ChartPattern {
    type: string;
    sentiment: 'Bullish' | 'Bearish' | 'Neutral';
    confidence: number;
    points: number[];
    reason: string;
    triggerPrice?: number;
    measuredTarget?: number;
    invalidationLevel?: number;
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

export interface UserPreferences {
    tradingPairLists: TradingPairList[];
    dailyLossLimit: number;
}
