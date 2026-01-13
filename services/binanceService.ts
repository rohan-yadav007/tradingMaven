
import { Kline, SymbolInfo, SymbolFilter, WalletBalance, RawWalletBalance, AccountInfo, LeverageBracket, BinanceOrderResponse, TradingMode, OpenInterestKline } from '../types';

// --- Configuration ---
const SPOT_BASE_URL = '/proxy-spot';
const FUTURES_BASE_URL = '/proxy-futures';
// The execution environment provides API keys via import.meta.env
const apiKey = (import.meta.env?.VITE_BINANCE_API_KEY || '').trim();
const apiSecret = (import.meta.env?.VITE_BINANCE_API_SECRET || '').trim();

let timeOffset = 0;
let isTimeSynced = false;

// --- Caching Layer ---
let spotExchangeInfoCache: SymbolInfo[] | null = null;
let spotCacheTimestamp = 0;
let futuresExchangeInfoCache: any[] | null = null;
let futuresCacheTimestamp = 0;
let tickerPriceCache = new Map<string, number>();
let tickerPriceCacheTimestamp = 0;
const CACHE_DURATION_SHORT = 1 * 60 * 1000;
const CACHE_DURATION_MEDIUM = 5 * 60 * 1000;
const CACHE_DURATION_LONG = 60 * 60 * 1000; // 1 hour for exchange info
let leverageBracketCache = new Map<string, { data: any, timestamp: number }>();
let openInterestHistoryCache = new Map<string, { data: OpenInterestKline[], timestamp: number }>();
const OI_CACHE_DURATION = 60 * 1000; // 1 minute cache for OI history
const OI_ERROR_CACHE_DURATION = 10 * 1000; // 10 seconds cache for failed requests

// --- Rate Limiter ---
class RateLimiter {
    private queue: (() => Promise<void>)[] = [];
    private processing = false;
    private lastRequestTime = 0;
    // 60ms delay ~= ~16 requests/sec max. Safe for IP limit of 1200/min.
    private delayMs = 60; 
    private pausedUntil = 0;

    async schedule<T>(fn: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.queue.push(async () => {
                if (Date.now() < this.pausedUntil) {
                    const wait = this.pausedUntil - Date.now();
                    console.warn(`[RateLimiter] Paused for ${wait}ms due to 429/418.`);
                    await new Promise(r => setTimeout(r, wait));
                }

                try {
                    const result = await fn();
                    resolve(result);
                } catch (e: any) {
                    // Handle Rate Limit (429) or IP Ban (418)
                    if (e && (e.code === 429 || e.code === 418 || (e.message && (e.message.includes('429') || e.message.includes('418'))))) {
                        console.error("[RateLimiter] Hit Rate Limit! Backing off for 1 minute.");
                        this.pausedUntil = Date.now() + 60000; // Backoff for 1 minute
                    }
                    reject(e);
                }
            });
            this.process();
        });
    }

    private async process() {
        if (this.processing) return;
        this.processing = true;

        while (this.queue.length > 0) {
            const now = Date.now();
            const timeSinceLast = now - this.lastRequestTime;
            
            if (timeSinceLast < this.delayMs) {
                await new Promise(r => setTimeout(r, this.delayMs - timeSinceLast));
            }

            const task = this.queue.shift();
            if (task) {
                this.lastRequestTime = Date.now();
                await task(); // Execute the task (which resolves the promise wrapper)
            }
        }

        this.processing = false;
    }
}

const rateLimiter = new RateLimiter();

// --- Private Helper Functions ---

/**
 * Translates a Binance API error object or a generic error into a human-readable string.
 */
export const interpretBinanceError = (error: any): string => {
    if (error && typeof error === 'object' && 'code' in error && 'msg' in error) {
        const code = error.code as number;
        const msg = error.msg as string;
        switch (code) {
            case -1013: return `Invalid Order Size. The quantity is either too small, too large, or not a valid multiple for this asset.`;
            case -1111: return `Precision Error. The price or quantity has too many decimal places for this asset.`;
            case -2010: return `API Order Creation Failed. This is often due to insufficient funds or other exchange-side issues.`;
            case -2011: return `Order does not exist. It may have already been filled or canceled.`;
            case -2015: return `Authentication Error. Invalid API key, IP, or permissions. Ensure the key is active and has trading enabled.`;
            case -2022: return `ReduceOnly Order Rejected. This often means the position is already closed or being closed.`;
            case -4003: return `Order quantity is less than the minimum allowed for this asset.`;
            case -4048: return `Margin type cannot be changed if there are open orders or positions.`;
            case -4164: return `This operation is not supported in Multi-Assets Mode.`;
            case -4167: return `Unable to adjust to Multi-Assets mode with symbols of USDⓈ-M Futures under isolated-margin mode.`;
            default: return `${msg} (Code: ${code})`;
        }
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'An unknown execution error occurred.';
}


async function hmacSha256(key: string, data: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(key);
    const dataToSign = encoder.encode(data);
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, dataToSign);
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    return signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function fetchSigned(endpoint: string, params: Record<string, any> = {}, method: 'GET' | 'POST' | 'DELETE' = 'GET', baseUrl: string = SPOT_BASE_URL): Promise<any> {
    return rateLimiter.schedule(async () => {
        if (!apiKey || !apiSecret) {
            throw new Error("API Key or Secret is not configured in environment variables.");
        }
        if (!isTimeSynced) {
            await initializeTimeSync();
        }

        const timestamp = Date.now() + timeOffset;
        
        const headers: Record<string, string> = { 'X-MBX-APIKEY': apiKey };
        const fetchOptions: RequestInit = { method, headers };
        let url: string = `${baseUrl}${endpoint}`;

        // Filter out null/undefined values before processing
        const filteredParams = Object.fromEntries(Object.entries(params).filter(([_, v]) => v != null));

        const allParams = { ...filteredParams, timestamp, recvWindow: 5000 };
        const stringParams = Object.fromEntries(Object.entries(allParams).map(([k, v]) => [k, String(v)]));
        const queryString = new URLSearchParams(stringParams).toString();
        const signature = await hmacSha256(apiSecret, queryString);

        if (method === 'GET') {
            url = `${url}?${queryString}&signature=${signature}`;
        } else { // POST, DELETE etc.
            fetchOptions.body = `${queryString}&signature=${signature}`;
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }

        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
            try {
                const errorData = await response.json();
                throw errorData;
            } catch (e) {
                // Pass status code for RateLimiter to catch 429/418
                throw { message: `An HTTP error occurred: ${response.status} ${response.statusText}`, code: response.status };
            }
        }
        
        const text = await response.text();
        return text ? JSON.parse(text) : {};
    });
}

// Unsigned fetch with rate limiting
async function fetchPublic(url: string): Promise<any> {
    return rateLimiter.schedule(async () => {
        const response = await fetch(url);
        if (!response.ok) {
             throw { message: `HTTP ${response.status}: ${response.statusText}`, code: response.status };
        }
        return response.json();
    });
}


export async function initializeTimeSync(retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            // Using raw fetch here to avoid circular dependency or rate limit lock on init
            const response = await fetch(`${SPOT_BASE_URL}/api/v3/time`);
            if (!response.ok) throw new Error('Failed to fetch server time');
            const data = await response.json();
            const serverTime = data.serverTime;
            const localTime = Date.now();
            timeOffset = serverTime - localTime;
            isTimeSynced = true;
            console.log(`[BinanceService] Time synced. Offset: ${timeOffset}ms`);
            return;
        } catch (error) {
            console.warn(`[BinanceService] Time sync failed (attempt ${i + 1}/${retries}):`, error);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
        }
    }
    console.error("[BinanceService] Failed to synchronize time with Binance server after multiple attempts.");
}

export function getTimeOffset(): number {
    return timeOffset;
}

/**
 * Returns the current timestamp synchronized with Binance server time.
 * Use this instead of Date.now() for anything related to trade timing or logs.
 */
export const getSyncedNow = (): number => {
    return Date.now() + timeOffset;
};

// --- Mode-aware Data Fetching ---

const getSpotExchangeInfo = async (): Promise<SymbolInfo[]> => {
    const now = Date.now();
    if (spotExchangeInfoCache && (now - spotCacheTimestamp < CACHE_DURATION_LONG)) {
        return spotExchangeInfoCache;
    }
    const data = await fetchPublic(`${SPOT_BASE_URL}/api/v3/exchangeInfo`);
    spotExchangeInfoCache = data.symbols;
    spotCacheTimestamp = now;
    return spotExchangeInfoCache!;
};

const getFuturesExchangeInfo = async (): Promise<any[]> => {
    const now = Date.now();
    if (futuresExchangeInfoCache && (now - futuresCacheTimestamp < CACHE_DURATION_LONG)) {
        return futuresExchangeInfoCache;
    }
    const data = await fetchPublic(`${FUTURES_BASE_URL}/fapi/v1/exchangeInfo`);
    futuresExchangeInfoCache = data.symbols;
    futuresCacheTimestamp = now;
    return futuresExchangeInfoCache!;
};

export const fetchSpotPairs = async (quoteAsset: string = 'USDT'): Promise<string[]> => {
    const info = await getSpotExchangeInfo();
    return info
        .filter(s => s.status === 'TRADING' && s.quoteAsset === quoteAsset && s.isSpotTradingAllowed)
        .map(s => `${s.baseAsset}/${s.quoteAsset}`)
        .sort();
};

export const fetchFuturesPairs = async (quoteAsset: string = 'USDT'): Promise<string[]> => {
    const info = await getFuturesExchangeInfo();
    return info
        .filter(s => s.contractType === 'PERPETUAL' && s.status === 'TRADING' && s.quoteAsset === quoteAsset)
        .map(s => s.symbol.replace(quoteAsset, `/${quoteAsset}`))
        .sort();
};


// --- Public Functions ---
export const checkApiConnection = async (): Promise<boolean> => {
    if (!apiKey) return false;
    try {
        await fetchSigned('/api/v3/account');
        return true;
    } catch (e: any) {
         if (e.code === -2015) { // Specific check for permission errors
            try {
                await fetchSigned('/fapi/v2/account', {}, 'GET', FUTURES_BASE_URL);
                return true;
            } catch (futuresError) {
                 return false;
            }
        }
        return false;
    }
};

export const fetchKlines = async (symbol: string, interval: string, options: { limit?: number; startTime?: number; endTime?: number; mode: TradingMode }): Promise<Kline[]> => {
    const { mode, ...restOptions } = options;
    const params = new URLSearchParams({ symbol, interval });
    if(restOptions.limit) params.set('limit', String(restOptions.limit));
    if(restOptions.startTime) params.set('startTime', String(restOptions.startTime));
    if(restOptions.endTime) params.set('endTime', String(restOptions.endTime));

    const isFutures = mode === TradingMode.USDSM_Futures;
    const baseUrl = isFutures ? FUTURES_BASE_URL : SPOT_BASE_URL;
    const path = isFutures ? '/fapi/v1/klines' : '/api/v3/klines';

    const data = await fetchPublic(`${baseUrl}${path}?${params.toString()}`);
    
    const klinesResult: Kline[] = data.map((k: any) => ({
        time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]),
        close: parseFloat(k[4]), volume: parseFloat(k[5]), isFinal: true,
        // Added Index 9 for Taker Buy Base Asset Volume (Omega V2.1)
        takerBuyVolume: parseFloat(k[9])
    }));
    
    return klinesResult;
};

/**
 * Fetch Open Interest for Futures (Omega V2.1)
 * Note: Only works for Futures.
 */
export const fetchOpenInterest = async (symbol: string): Promise<{ openInterest: number, time: number } | null> => {
    try {
        // Strip the '/' for API call if it exists
        const cleanSymbol = symbol.replace('/', '');
        const data = await fetchPublic(`${FUTURES_BASE_URL}/fapi/v1/openInterest?symbol=${cleanSymbol}`);
        return { openInterest: parseFloat(data.openInterest), time: data.time };
    } catch (e) { return null; }
};

/**
 * Fetch Open Interest History (Omega V4.0)
 * Only works for Futures. Returns recent OI data to detect trends.
 * NOTE: Binance does NOT provide a public WebSocket for OI History, so we must use REST.
 * We cache the result to prevent rate limit issues.
 */
export const fetchOpenInterestHistory = async (symbol: string, period: string, limit: number = 30): Promise<OpenInterestKline[]> => {
    const cleanSymbol = symbol.replace('/', '');
    const cacheKey = `${cleanSymbol}:${period}`;
    const now = Date.now();
    const cached = openInterestHistoryCache.get(cacheKey);

    // 1. Check for valid cache
    if (cached && (now - cached.timestamp < OI_CACHE_DURATION)) {
        // Check if we cached a "failure" state (empty array)
        // If it was a failure, use shorter error cache duration
        if (cached.data.length === 0 && (now - cached.timestamp < OI_ERROR_CACHE_DURATION)) {
            return [];
        }
        // If it was a success, use standard cache duration
        if (cached.data.length > 0) {
            return cached.data;
        }
    }

    try {
        const params = new URLSearchParams({ symbol: cleanSymbol, period, limit: String(limit) });
        // FIXED: Endpoint is /futures/data/openInterestHist, not /fapi/v1/openInterestHist
        const data = await fetchPublic(`${FUTURES_BASE_URL}/futures/data/openInterestHist?${params.toString()}`);
        
        // Map to typed array
        const result: OpenInterestKline[] = data.map((d: any) => ({
            symbol: d.symbol,
            sumOpenInterest: d.sumOpenInterest,
            sumOpenInterestValue: d.sumOpenInterestValue,
            timestamp: d.timestamp
        }));

        openInterestHistoryCache.set(cacheKey, { data: result, timestamp: now });
        return result;
    } catch (e) {
        // Log the error but don't crash.
        // Important: Cache the failure (empty array) for 10 seconds to prevent
        // rapid-fire retries in the analysis loop if the API is returning 404/500.
        console.warn(`[BinanceService] Failed to fetch OI history for ${symbol}. Caching failure for 10s.`);
        openInterestHistoryCache.set(cacheKey, { data: [], timestamp: now }); 
        return [];
    }
};

export const fetchFullKlines = async (symbol: string, interval: string, startTime: number, endTime: number, mode: TradingMode): Promise<Kline[]> => {
    let allKlines: Kline[] = [];
    let currentStartTime = startTime;
    const MAX_LIMIT = 1000;

    const isFutures = mode === TradingMode.USDSM_Futures;
    const baseUrl = isFutures ? FUTURES_BASE_URL : SPOT_BASE_URL;
    const path = isFutures ? '/fapi/v1/klines' : '/api/v3/klines';

    while (currentStartTime <= endTime) {
        const params = new URLSearchParams({ 
            symbol, 
            interval, 
            startTime: String(currentStartTime), 
            endTime: String(endTime),
            limit: String(MAX_LIMIT) 
        });

        const data = await fetchPublic(`${baseUrl}${path}?${params.toString()}`);

        if (data.length === 0) {
            break;
        }

        const klines: Kline[] = data.map((k: any) => ({
            time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]),
            close: parseFloat(k[4]), volume: parseFloat(k[5]), isFinal: true,
            // Added Index 9 for Taker Buy Base Asset Volume (Omega V2.1)
            takerBuyVolume: parseFloat(k[9])
        }));
        
        allKlines.push(...klines);
        
        const lastKlineTime = klines[klines.length - 1].time;
        currentStartTime = lastKlineTime + 1;
        
        // Gentle delay between chunks in backtesting
        await new Promise(r => setTimeout(r, 100));
    }
    
    const uniqueKlinesMap = new Map<number, Kline>();
    allKlines.forEach(k => uniqueKlinesMap.set(k.time, k));
    return Array.from(uniqueKlinesMap.values()).sort((a, b) => a.time - b.time);
};

export const getSymbolInfo = async (symbol: string): Promise<SymbolInfo | undefined> => {
    const info = await getSpotExchangeInfo();
    return info?.find(s => s.symbol === symbol);
};

export const getFuturesSymbolInfo = async (symbol: string): Promise<any | undefined> => {
    const info = await getFuturesExchangeInfo();
    return info?.find(s => s.symbol === symbol);
};

export const fetchDepthSnapshot = async (symbol: string, mode: TradingMode, limit: number = 1000): Promise<any> => {
    const params = new URLSearchParams({ symbol, limit: String(limit) });
    const isFutures = mode === TradingMode.USDSM_Futures;
    const baseUrl = isFutures ? FUTURES_BASE_URL : SPOT_BASE_URL;
    const path = isFutures ? '/fapi/v1/depth' : '/api/v3/depth';

    return fetchPublic(`${baseUrl}${path}?${params.toString()}`);
};

const fetchAllTickerPrices = async (): Promise<Map<string, number>> => {
    const now = Date.now();
    if (now - tickerPriceCacheTimestamp < CACHE_DURATION_SHORT) {
        return tickerPriceCache;
    }
    const data: { symbol: string, price: string }[] = await fetchPublic(`${SPOT_BASE_URL}/api/v3/ticker/price`);
    const newCache = new Map<string, number>();
    data.forEach(ticker => newCache.set(ticker.symbol, parseFloat(ticker.price)));
    tickerPriceCache = newCache;
    tickerPriceCacheTimestamp = now;
    return newCache;
};

export const fetchTickerPrice = async (symbol: string): Promise<number | null> => {
    try {
        const data = await fetchPublic(`${SPOT_BASE_URL}/api/v3/ticker/price?symbol=${symbol}`);
        return parseFloat(data.price);
    } catch (e) {
        console.error(`Failed to fetch price for ${symbol}`, e);
        return null;
    }
};

export const fetchFuturesTickerPrice = async (symbol: string): Promise<number | null> => {
    try {
        const data = await fetchPublic(`${FUTURES_BASE_URL}/fapi/v1/ticker/price?symbol=${symbol}`);
        return parseFloat(data.price);
    } catch (e) {
        console.error(`Failed to fetch futures price for ${symbol}`, e);
        return null;
    }
};

export const fetchFundingRate = async (symbol: string): Promise<{ fundingTime: number; fundingRate: string } | null> => {
    try {
        const data = await fetchPublic(`${FUTURES_BASE_URL}/fapi/v1/premiumIndex?symbol=${symbol}`);
        const fundingData = Array.isArray(data) ? data.find(d => d.symbol === symbol) : data;
        
        if (fundingData && fundingData.nextFundingTime && fundingData.lastFundingRate) {
             return {
                fundingTime: Number(fundingData.nextFundingTime),
                fundingRate: (parseFloat(fundingData.lastFundingRate) * 100).toFixed(4),
             };
        }
        return null;
    } catch (e) {
        // console.error(`Failed to fetch funding rate for ${symbol}:`, e);
        return null;
    }
};

const mapBalances = async (rawBalances: RawWalletBalance[]): Promise<WalletBalance[]> => {
    const prices = await fetchAllTickerPrices();
    const balances = rawBalances
        .map(b => {
            const total = b.free + b.locked;
            if (total <= 0) return { ...b, total, usdValue: 0 }; // Quick filter for 0 balance assets

            const originalAsset = b.asset;
            const assetForPricing = originalAsset.startsWith('LD') ? originalAsset.substring(2) : originalAsset;

            let usdValue = 0;
             if (['USDT', 'BUSD', 'USDC', 'DAI', 'TUSD'].includes(assetForPricing)) {
                usdValue = total;
            } else {
                usdValue = total * (prices.get(`${assetForPricing}USDT`) || prices.get(`${assetForPricing}BUSD`) || 0);
            }
            return { ...b, asset: originalAsset, total, usdValue }; // Keep original asset name
        })
        .filter(b => b.total > 0.00001)
        .sort((a, b) => b.usdValue - a.usdValue);
    return balances;
};

export const fetchSpotWalletBalance = async (): Promise<AccountInfo> => {
    const rawAccountInfo = await fetchSigned('/api/v3/account');
    const balances = await mapBalances(rawAccountInfo.balances.map((b: any) => ({ asset: b.asset, free: parseFloat(b.free), locked: parseFloat(b.locked) })));
    return { ...rawAccountInfo, balances };
};

export const fetchFuturesWalletBalance = async (): Promise<AccountInfo> => {
    const [accountResponse, balanceResponse] = await Promise.all([
        fetchSigned('/fapi/v2/account', {}, 'GET', FUTURES_BASE_URL),
        fetchSigned('/fapi/v2/balance', {}, 'GET', FUTURES_BASE_URL)
    ]);
    const rawBalances = balanceResponse.map((b: any) => ({ asset: b.asset, free: parseFloat(b.availableBalance), locked: parseFloat(b.balance) - parseFloat(b.availableBalance) }));
    const balances = await mapBalances(rawBalances);
    return { ...accountResponse, balances, accountType: 'USDT_FUTURES', positions: accountResponse.positions };
};

export const createSpotOrder = async (symbol: string, side: 'BUY' | 'SELL', quantity: number): Promise<BinanceOrderResponse> => {
    const params = { symbol: symbol.replace('/', ''), side, type: 'MARKET', quantity, newOrderRespType: 'RESULT' };
    return fetchSigned('/api/v3/order', params, 'POST');
};

export const createFuturesOrder = async (symbol: string, side: 'BUY' | 'SELL', quantity: number, reduceOnly?: boolean): Promise<BinanceOrderResponse> => {
    const params: Record<string, any> = { symbol: symbol.replace('/', ''), side, type: 'MARKET', quantity, newOrderRespType: 'RESULT' };
    if (reduceOnly) params.reduceOnly = 'true';
    
    const rawResponse = await fetchSigned('/fapi/v1/order', params, 'POST', FUTURES_BASE_URL);
    
    const normalized: BinanceOrderResponse = {
        ...rawResponse,
        cummulativeQuoteQty: rawResponse.cumQuote || '0', 
        avgPrice: rawResponse.avgPrice,
    };
    
    return normalized;
};

export const setFuturesLeverage = async (symbol: string, leverage: number): Promise<any> => {
    return fetchSigned('/fapi/v1/leverage', { symbol: symbol.replace('/', ''), leverage }, 'POST', FUTURES_BASE_URL);
};

export const setMarginType = async (symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<any> => {
    return fetchSigned('/fapi/v1/marginType', { symbol: symbol.replace('/', ''), marginType }, 'POST', FUTURES_BASE_URL);
};

export const getFuturesPositionRisk = async (symbol: string): Promise<{ marginType: string; leverage: string; liquidationPrice: number; positionAmt: string; } | null> => {
    try {
        const data = await fetchSigned('/fapi/v2/positionRisk', { symbol: symbol.replace('/', '') }, 'GET', FUTURES_BASE_URL);
        if (Array.isArray(data) && data.length > 0) {
            return {
                marginType: data[0].marginType,
                leverage: data[0].leverage,
                liquidationPrice: parseFloat(data[0].liquidationPrice),
                positionAmt: data[0].positionAmt,
            };
        }
        return null;
    } catch (e) {
        console.error(`Failed to fetch position risk for ${symbol}:`, e);
        return null;
    }
};

export const getAllFuturesPositionRisk = async (): Promise<any[]> => {
    try {
        const data = await fetchSigned('/fapi/v2/positionRisk', {}, 'GET', FUTURES_BASE_URL);
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error('Failed to fetch all futures position risks:', e);
        return [];
    }
};


export const fetchFuturesLeverageBrackets = async (symbol: string): Promise<{ symbol: string; brackets: LeverageBracket[] } | null> => {
    const cacheKey = symbol.replace('/', '');
    const cached = leverageBracketCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_DURATION_MEDIUM)) {
        return cached.data;
    }
    
    try {
        const data = await fetchSigned('/fapi/v1/leverageBracket', { symbol: cacheKey }, 'GET', FUTURES_BASE_URL);
        const bracketData = (data as any[]).find(d => d.symbol === cacheKey);
        if (bracketData) {
            leverageBracketCache.set(cacheKey, { data: bracketData, timestamp: Date.now() });
            return bracketData;
        }
        return null;
    } catch (e) {
        console.error(`Failed to fetch leverage brackets for ${symbol}:`, e);
        return null;
    }
};

export const getPricePrecision = (symbolInfo?: SymbolInfo): number => {
    const priceFilter = symbolInfo?.filters.find((f: SymbolFilter) => f.filterType === 'PRICE_FILTER');
    if (priceFilter?.tickSize) {
        const tickSize = parseFloat(priceFilter.tickSize);
        if (tickSize > 0) return Math.abs(Math.log10(tickSize));
    }
    return 4; // Use a more sensible default for crypto
};

export const getQuantityPrecision = (symbolInfo?: any): number => {
    if (symbolInfo && 'quantityPrecision' in symbolInfo) {
        return (symbolInfo as any).quantityPrecision;
    }
    
    const lotSizeFilter = symbolInfo?.filters.find((f: SymbolFilter) => f.filterType === 'LOT_SIZE');
    if (lotSizeFilter?.stepSize) {
        const stepSize = parseFloat(lotSizeFilter.stepSize);
        if (stepSize > 0) return Math.round(Math.abs(Math.log10(stepSize)));
    }
    return 0;
};

export const getStepSize = (symbolInfo?: SymbolInfo): number => {
    const lotSizeFilter = symbolInfo?.filters.find((f: SymbolFilter) => f.filterType === 'LOT_SIZE');
    if (lotSizeFilter?.stepSize) {
        return parseFloat(lotSizeFilter.stepSize);
    }
    return 0.00000001;
};

export const getMultiAssetsMargin = async (): Promise<{ multiAssetsMargin: boolean }> => {
    return fetchSigned('/fapi/v1/multiAssetsMargin', {}, 'GET', FUTURES_BASE_URL);
};

export const setMultiAssetsMargin = async (isEnabled: boolean): Promise<any> => {
    return fetchSigned('/fapi/v1/multiAssetsMargin', { multiAssetsMargin: String(isEnabled) }, 'POST', FUTURES_BASE_URL);
};

export const fetchFuturesCommissionRate = async (symbol: string): Promise<{ takerCommissionRate: number } | null> => {
    try {
        const data = await fetchSigned('/fapi/v1/commissionRate', { symbol: symbol.replace('/', '') }, 'GET', FUTURES_BASE_URL);
        if (data && data.takerCommissionRate) {
            return {
                takerCommissionRate: parseFloat(data.takerCommissionRate)
            };
        }
        return null;
    } catch (e) {
        console.error(`Failed to fetch commission rate for ${symbol}:`, e);
        return null;
    }
};
