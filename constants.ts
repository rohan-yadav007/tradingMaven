


import { Agent, WalletBalance, AgentParams } from './types';

export const TRADING_PAIRS: string[] = [
    'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT'
];

export const TIME_FRAMES: string[] = ['1m', '3m', '5m', '15m', '1h', '4h', '1d'];

export const AGENTS: Agent[] = [
    {
        id: 1,
        name: 'Momentum Master',
        description: 'Trades aggressively on confirmed trends. Uses ADX to find trending markets, then enters on strong RSI and MACD signals.',
        indicators: ['RSI', 'MACD', 'EMA (20, 50)', 'ADX', 'ATR']
    },
    {
        id: 2,
        name: 'Volatility Voyager',
        description: 'Specializes in breakout trading. Detects periods of low volatility (Bollinger Band Squeeze) and trades the subsequent price breakout.',
        indicators: ['Bollinger Bands', 'Stochastic RSI', 'BBW', 'ATR']
    },
    {
        id: 3,
        name: 'Trend Surfer',
        description: 'A classic trend-following agent. Identifies long-term trends with EMA clouds and ADX, then uses Parabolic SAR for entries.',
        indicators: ['EMA (50, 200)', 'ADX', 'Parabolic SAR', 'ATR']
    },
    {
        id: 4,
        name: 'Scalping Expert',
        description: 'A high-frequency agent using a scoring system. Combines signals from SuperTrend, EMAs, MACD, and RSI to find high-probability scalps.',
        indicators: ['SuperTrend', 'EMA (5, 20)', 'MACD', 'RSI', 'Volume']
    },
    {
        id: 5,
        name: 'Smart Agent',
        description: 'An advanced, "superintelligent" agent using a confidence model. Synthesizes data from SuperTrend, MACD, RSI, and EMAs into a single score to make highly-informed trading decisions.',
        indicators: ['SuperTrend', 'EMA Crossover', 'MACD', 'RSI', 'Volume Analysis', 'ATR']
    },
    {
        id: 6,
        name: 'Profit Locker',
        description: 'Enters trades based on the Smart Agent logic, but uses an aggressive trailing stop-loss to lock in profits in strong trends. Exits quickly when momentum fades.',
        indicators: ['SuperTrend', 'EMA Crossover', 'MACD', 'RSI', 'ATR']
    },
    {
        id: 7,
        name: 'Market Structure Maven',
        description: 'A professional-grade agent that reads market structure. It identifies the high-timeframe trend, waits for a pullback, and enters on a confirmed "liquidity grab" pattern.',
        indicators: ['EMA (HTF)', 'Price Action', 'Market Structure', 'ATR']
    },
    {
        id: 8,
        name: 'Institutional Scalper',
        description: 'A high-precision scalping agent based on smart money concepts. It ignores traditional indicators, focusing purely on price action to identify liquidity sweeps followed by a powerful, engulfing confirmation candle. Allows for up to 2 re-entries if a setup re-appears after a stop-out.',
        indicators: ['Price Action', 'Liquidity Grabs', 'Engulfing Patterns']
    }
];

export const BOT_COOLDOWN_CANDLES = 3; // Number of candles a bot waits after closing a trade.

export const DEFAULT_AGENT_PARAMS: Required<AgentParams> = {
    // General
    rsiPeriod: 14,
    atrPeriod: 14,
    adxPeriod: 14,
    macdFastPeriod: 12,
    macdSlowPeriod: 26,
    macdSignalPeriod: 9,

    // Agent 1: Momentum Master
    adxTrendThreshold: 25,
    mom_emaFastPeriod: 20,
    mom_emaSlowPeriod: 50,
    mom_rsiThresholdBullish: 55,
    mom_rsiThresholdBearish: 45,

    // Agent 2: Volatility Voyager
    vol_bbPeriod: 20,
    vol_bbStdDev: 2,
    vol_stochRsiRsiPeriod: 14,
    vol_stochRsiStochasticPeriod: 14,
    vol_stochRsiKPeriod: 3,
    vol_stochRsiDPeriod: 3,
    vol_stochRsiUpperThreshold: 70,
    vol_stochRsiLowerThreshold: 30,
    vol_emaTrendPeriod: 100,

    // Agent 3: Trend Surfer
    trend_emaFastPeriod: 50,
    trend_emaSlowPeriod: 200,
    trend_adxThreshold: 20,
    psarStep: 0.02,
    psarMax: 0.2,

    // Agent 4: Scalping Expert
    scalp_superTrendPeriod: 10,
    scalp_superTrendMultiplier: 3,
    scalp_emaFastPeriod: 5,
    scalp_emaSlowPeriod: 20,
    scalp_rsiPeriod: 14,
    scalp_rsiBuyThreshold: 40,
    scalp_rsiSellThreshold: 60,
    scalp_bbPeriod: 20,
    scalp_bbStdDev: 2,
    scalp_volumeSmaPeriod: 20,
    scalp_scoreThreshold: 14,
    
    // Agent 5 & 6: Smart Agent & Profit Locker
    smart_superTrendPeriod: 10,
    smart_superTrendMultiplier: 3,
    smart_emaFastPeriod: 9,
    smart_emaSlowPeriod: 20,
    smart_rsiPeriod: 14,
    smart_rsiBuyThreshold: 60, // higher for confirmation
    smart_rsiSellThreshold: 40, // lower for confirmation
    smart_volumeSmaPeriod: 20,
    smart_confidenceThreshold: 0.75,

    // Agent 7: Market Structure Maven
    msm_htfEmaPeriod: 200,
    msm_swingPointLookback: 5,

    // Agent 8: Institutional Scalper
    inst_lookbackPeriod: 5,
    inst_powerCandleMultiplier: 1.5,
};


// This configuration provides optimized parameters for different timeframes.
// These settings are merged on top of the defaults, and below user customizations.
export const TIMEFRAME_ADAPTIVE_SETTINGS: Record<string, AgentParams> = {
    // Shorter timeframes: more sensitive, quicker reactions
    '1m': {
        mom_rsiThresholdBullish: 60,
        mom_rsiThresholdBearish: 40,
        scalp_scoreThreshold: 15,
    },
    '3m': {
        mom_rsiThresholdBullish: 58,
        mom_rsiThresholdBearish: 42,
        scalp_scoreThreshold: 14,
        smart_confidenceThreshold: 0.7,
    },
    '5m': {
        mom_rsiThresholdBullish: 58,
        mom_rsiThresholdBearish: 42,
        scalp_scoreThreshold: 14,
        smart_confidenceThreshold: 0.7,
    },
    '15m': {
        // Uses default momentum/reversion thresholds
        scalp_scoreThreshold: 13,
        smart_confidenceThreshold: 0.75,
    },
    // Longer timeframes: more patient, looking for bigger moves
    '1h': {
        adxTrendThreshold: 22,
        mom_rsiThresholdBullish: 60,
        mom_rsiThresholdBearish: 40,
        smart_confidenceThreshold: 0.8,
        msm_htfEmaPeriod: 200, // on 1h, this approximates a 50 EMA on 4h
    },
    '4h': {
        adxTrendThreshold: 20,
        trend_adxThreshold: 18,
        mom_rsiThresholdBullish: 65,
        mom_rsiThresholdBearish: 35,
        msm_htfEmaPeriod: 200, // on 4h, this approximates an 80 EMA on 1D
    },
    '1d': {
        adxTrendThreshold: 18,
        trend_adxThreshold: 15,
        mom_rsiThresholdBullish: 70,
        mom_rsiThresholdBearish: 30,
        msm_htfEmaPeriod: 50, // on 1d, 50 EMA is a common trend indicator
    }
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

export const MOCK_PAPER_FUNDING_WALLET: WalletBalance[] = [
    { asset: 'USDT', free: 1500.00, locked: 0, total: 1500.00, usdValue: 1500.00 },
    { asset: 'ETH', free: 2, locked: 0, total: 2, usdValue: 7000.00 },
    { asset: 'BNB', free: 5, locked: 0, total: 5, usdValue: 3000.00 },
];