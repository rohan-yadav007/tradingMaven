
import { Kline, SymbolInfo, SymbolFilter, WalletBalance, RawWalletBalance, AccountInfo, LeverageBracket, BinanceOrderResponse, MarginAccountInfo } from '../types';

// --- Configuration ---
const SPOT_BASE_URL = '/proxy-spot';
const FUTURES_BASE_URL = '/proxy-futures';
// Trim keys to prevent issues with whitespace from .env files
const apiKey = ((import.meta as any).env.VITE_BINANCE_API_KEY || '').trim();
const apiSecret = ((import.meta as any).env.VITE_BINANCE_API_SECRET || '').trim();

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

// --- Private Helper Functions ---

/**
 * Translates a Binance API error object or a generic error into a human-readable string.
 * @param error - The error object, which can be from the Binance API (with code/msg) or a standard JS Error.
 * @returns A user-friendly error message.
 */
export const interpretBinanceError = (error: any): string => {
    // Check if it's a structured error object from our fetcher
    if (error && typeof error === 'object' && 'code' in error && 'msg' in error) {
        const code = error.code as number;
        const msg = error.msg as string;
        switch (code) {
            case -1013: return `Invalid Order Size. The quantity is either too small, too large, or not a valid multiple for this asset.`;
            case -1111: return `Precision Error. The price or quantity has too many decimal places for this asset.`;
            case -2010: return `API Order Creation Failed. This is often due to insufficient funds or other exchange-side issues.`;
            case -2015: return `Authentication Error. Invalid API key, IP, or permissions. Ensure the key is active and has trading enabled.`;
            case -4003: return `Order quantity is less than the minimum allowed for this asset.`;
            case -4048: return `Margin type cannot be changed if there are open orders or positions.`;
            case -4164: return `This operation is not supported in Multi-Assets Mode.`;
            case -4167: return `Unable to adjust to Multi-Assets mode with symbols of USDⓈ-M Futures under isolated-margin mode.`;
            default: return `${msg} (Code: ${code})`;
        }
    }
    // Fallback for regular JS Error objects
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

async function fetchSigned(endpoint: string, params: Record<string, any> = {}, method: 'GET' | 'POST' = 'GET', baseUrl: string = SPOT_BASE_URL): Promise<any> {
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

    if (method === 'GET') {
        const finalParams = { ...filteredParams, timestamp, recvWindow: 5000 };
        const stringParams = Object.fromEntries(Object.entries(finalParams).map(([k, v]) => [k, String(v)]));
        const queryString = new URLSearchParams(stringParams).toString();
        const signature = await hmacSha256(apiSecret, queryString);
        url = `${url}?${queryString}&signature=${signature}`;
    } else { // POST, PUT, DELETE etc.
        const finalParams = { ...filteredParams, timestamp, recvWindow: 5000 };
        const stringParams = Object.fromEntries(Object.entries(finalParams).map(([k, v]) => [k, String(v)]));
        const bodyString = new URLSearchParams(stringParams).toString();
        const signature = await hmacSha256(apiSecret, bodyString);
        fetchOptions.body = `${bodyString}&signature=${signature}`;
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
        try {
            // Throw the raw JSON error from Binance to be handled by the caller
            const errorData = await response.json();
            throw errorData;
        } catch (e) {
            // If parsing fails, throw a generic HTTP error
            throw new Error(`An HTTP error occurred: ${response.status} ${response.statusText}`);
        }
    }
    
    const text = await response.text();
    return text ? JSON.parse(text) : {};
}


async function initializeTimeSync() {
    try {
        const response = await fetch(`${SPOT_BASE_URL}/api/v3/time`);
        if (!response.ok) throw new Error('Failed to fetch server time');
        const data = await response.json();
        timeOffset = data.serverTime - Date.now();
        isTimeSynced = true;
    } catch (error) {
        console.error("Failed to synchronize time with Binance server:", error);
        throw new Error("Could not sync time with Binance. API requests will fail.");
    }
}

// --- Mode-aware Data Fetching ---

const getSpotExchangeInfo = async (): Promise<SymbolInfo[]> => {
    const now = Date.now();
    if (spotExchangeInfoCache && (now - spotCacheTimestamp < CACHE_DURATION_LONG)) {
        return spotExchangeInfoCache;
    }
    const response = await fetch(`${SPOT_BASE_URL}/api/v3/exchangeInfo`);
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    spotExchangeInfoCache = data.symbols;
    spotCacheTimestamp = now;
    return spotExchangeInfoCache!;
};

const getFuturesExchangeInfo = async (): Promise<any[]> => {
    const now = Date.now();
    if (futuresExchangeInfoCache && (now - futuresCacheTimestamp < CACHE_DURATION_LONG)) {
        return futuresExchangeInfoCache;
    }
    const response = await fetch(`${FUTURES_BASE_URL}/fapi/v1/exchangeInfo`);
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
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

export const fetchMarginPairs = async (quoteAsset: string = 'USDT'): Promise<string[]> => {
    const info = await getSpotExchangeInfo();
    return info
        .filter(s => s.status === 'TRADING' && s.quoteAsset === quoteAsset && s.isMarginTradingAllowed)
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

export const fetchKlines = async (symbol: string, interval: string, options?: { limit?: number; startTime?: number; endTime?: number }): Promise<Kline[]> => {
    const params = new URLSearchParams({ symbol, interval });
    if(options?.limit) params.set('limit', String(options.limit));
    if(options?.startTime) params.set('startTime', String(options.startTime));
    if(options?.endTime) params.set('endTime', String(options.endTime));

    // Determine if it's a futures or spot symbol
    const isFutures = symbol.endsWith('USDT') && !symbol.includes('/');
    const baseUrl = isFutures ? FUTURES_BASE_URL : SPOT_BASE_URL;
    const path = isFutures ? '/fapi/v1/klines' : '/api/v3/klines';

    const response = await fetch(`${baseUrl}${path}?${params.toString()}`);
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    return data.map((k: any) => ({
        time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]),
        close: parseFloat(k[4]), volume: parseFloat(k[5]), isFinal: true,
    }));
};

/**
 * Fetches a complete set of k-lines for a given date range, handling API pagination.
 * @param symbol The trading symbol (e.g., 'BTCUSDT').
 * @param interval The k-line interval (e.g., '1m').
 * @param startTime The start of the date range (Unix timestamp).
 * @param endTime The end of the date range (Unix timestamp).
 * @returns A promise that resolves to an array of all k-lines in the range.
 */
export const fetchFullKlines = async (symbol: string, interval: string, startTime: number, endTime: number): Promise<Kline[]> => {
    let allKlines: Kline[] = [];
    let currentStartTime = startTime;
    const MAX_LIMIT = 1000; // Binance API kline limit

    while (currentStartTime <= endTime) {
        const klines = await fetchKlines(symbol, interval, { 
            startTime: currentStartTime, 
            endTime: endTime, 
            limit: MAX_LIMIT 
        });
        
        if (klines.length === 0) {
            break;
        }
        
        allKlines.push(...klines);
        
        const lastKlineTime = klines[klines.length - 1].time;
        // Move to the next potential start time. Add 1ms to avoid re-fetching the last candle.
        currentStartTime = lastKlineTime + 1;
    }
    
    // De-duplicate and sort to ensure data integrity
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

const fetchAllTickerPrices = async (): Promise<Map<string, number>> => {
    const now = Date.now();
    if (now - tickerPriceCacheTimestamp < CACHE_DURATION_SHORT) {
        return tickerPriceCache;
    }
    const response = await fetch(`${SPOT_BASE_URL}/api/v3/ticker/price`);
    if (!response.ok) throw new Error(await response.text());
    const data: { symbol: string, price: string }[] = await response.json();
    const newCache = new Map<string, number>();
    data.forEach(ticker => newCache.set(ticker.symbol, parseFloat(ticker.price)));
    tickerPriceCache = newCache;
    tickerPriceCacheTimestamp = now;
    return newCache;
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
    // Add the open positions from the account response for safety checks
    return { ...accountResponse, balances, accountType: 'USDT_FUTURES', positions: accountResponse.positions };
};

export const fetchMarginWalletBalance = async (): Promise<MarginAccountInfo> => {
    const accountData = await fetchSigned('/sapi/v1/margin/account');
    const btcTickerResponse = await fetch(`${SPOT_BASE_URL}/api/v3/ticker/price?symbol=BTCUSDT`).then(res => res.json());
    const rawBalances = accountData.userAssets.map((b: any) => ({ asset: b.asset, free: parseFloat(b.free), locked: parseFloat(b.locked) }));
    const balances = await mapBalances(rawBalances);
    return { ...accountData, balances, btcUsdPrice: parseFloat(btcTickerResponse.price), accountType: 'MARGIN' };
};

export const fetchFundingWalletBalance = async (): Promise<AccountInfo> => {
    // SAPI endpoints are on the same base URL as SPOT
    const responseData = await fetchSigned('/sapi/v1/asset/get-funding-asset', {}, 'POST'); 
    
    // The response is an array of objects.
    const rawBalances = responseData.map((b: any) => ({
        asset: b.asset,
        free: parseFloat(b.free),
        // Funding wallet has 'locked', 'freeze' and 'withdrawing'
        locked: parseFloat(b.locked || '0') + parseFloat(b.freeze || '0') + parseFloat(b.withdrawing || '0')
    }));

    const balances = await mapBalances(rawBalances);

    // Funding wallet doesn't have a single "account info" object like others.
    // We construct a mock one with the necessary details.
    return {
        canTrade: false, // You don't trade from funding wallet
        canWithdraw: true,
        canDeposit: true,
        updateTime: Date.now(),
        accountType: 'FUNDING',
        balances,
    };
};

export const createSpotOrder = async (symbol: string, side: 'BUY' | 'SELL', quantity: number): Promise<BinanceOrderResponse> => {
    const params = { symbol: symbol.replace('/', ''), side, type: 'MARKET', quantity };
    return fetchSigned('/api/v3/order', params, 'POST');
};

export const createFuturesOrder = async (symbol: string, side: 'BUY' | 'SELL', quantity: number, reduceOnly?: boolean): Promise<BinanceOrderResponse> => {
    const params: Record<string, any> = { symbol: symbol.replace('/', ''), side, type: 'MARKET', quantity };
    if (reduceOnly) params.reduceOnly = 'true';
    return fetchSigned('/fapi/v1/order', params, 'POST', FUTURES_BASE_URL);
};

export const createMarginOrder = async (symbol: string, side: 'BUY' | 'SELL', quantity: number, options?: { sideEffectType?: 'AUTO_REPAY' | 'MARGIN_BUY' }): Promise<BinanceOrderResponse> => {
    const params: Record<string, any> = { symbol: symbol.replace('/', ''), side, type: 'MARKET', quantity };
    if (options?.sideEffectType) {
        params.sideEffectType = options.sideEffectType;
    }
    return fetchSigned('/sapi/v1/margin/order', params, 'POST');
};

export const setFuturesLeverage = async (symbol: string, leverage: number): Promise<any> => {
    return fetchSigned('/fapi/v1/leverage', { symbol: symbol.replace('/', ''), leverage }, 'POST', FUTURES_BASE_URL);
};

export const setMarginType = async (symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<any> => {
    return fetchSigned('/fapi/v1/marginType', { symbol: symbol.replace('/', ''), marginType }, 'POST', FUTURES_BASE_URL);
};

export const getFuturesPositionRisk = async (symbol: string): Promise<{ marginType: string; leverage: string; liquidationPrice: number; } | null> => {
    try {
        const data = await fetchSigned('/fapi/v2/positionRisk', { symbol: symbol.replace('/', '') }, 'GET', FUTURES_BASE_URL);
        if (Array.isArray(data) && data.length > 0) {
            // The API returns an array, we need the first element for a single symbol query.
            return {
                marginType: data[0].marginType,
                leverage: data[0].leverage,
                liquidationPrice: parseFloat(data[0].liquidationPrice),
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
    return 2;
};

export const getQuantityPrecision = (symbolInfo?: SymbolInfo): number => {
    // For futures, the field is quantityPrecision
    if (symbolInfo && 'quantityPrecision' in symbolInfo) {
        return (symbolInfo as any).quantityPrecision;
    }
    
    // For spot, it's from LOT_SIZE filter
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
    return 0.00000001; // fallback to a very small step size
};

export const getMultiAssetsMargin = async (): Promise<{ multiAssetsMargin: boolean }> => {
    return fetchSigned('/fapi/v1/multiAssetsMargin', {}, 'GET', FUTURES_BASE_URL);
};

export const setMultiAssetsMargin = async (isEnabled: boolean): Promise<any> => {
    return fetchSigned('/fapi/v1/multiAssetsMargin', { multiAssetsMargin: String(isEnabled) }, 'POST', FUTURES_BASE_URL);
};
