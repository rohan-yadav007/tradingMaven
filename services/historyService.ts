
import { Trade } from '../types';

const HISTORY_KEY = 'tradeHistory_v2';
const MAX_HISTORY_LENGTH = 500;

const saveTrade = (trade: Trade): Trade[] => {
    try {
        const allTrades = loadTrades();
        
        const updatedTrades = [trade, ...allTrades.filter(t => t.id !== trade.id)];
        
        const sortedAndCapped = updatedTrades
            .sort((a, b) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime())
            .slice(0, MAX_HISTORY_LENGTH);

        localStorage.setItem(HISTORY_KEY, JSON.stringify(sortedAndCapped));
        return sortedAndCapped;
    } catch (error) {
        console.error("Failed to save trade to localStorage:", error);
        return loadTrades();
    }
};

const loadTrades = (): Trade[] => {
    try {
        const storedTrades = localStorage.getItem(HISTORY_KEY);
        if (storedTrades) {
            return JSON.parse(storedTrades);
        }
        return [];
    } catch (error) {
        console.error("Failed to load trades from localStorage:", error);
        return [];
    }
};

const clearTrades = (): void => {
    try {
        localStorage.removeItem(HISTORY_KEY);
    } catch (error) {
        console.error("Failed to clear trade history from localStorage:", error);
    }
};

const removeTrades = (tradeIdsToRemove: number[]): Trade[] => {
    try {
        let allTrades = loadTrades();
        const remainingTrades = allTrades.filter(t => !tradeIdsToRemove.includes(t.id));
        localStorage.setItem(HISTORY_KEY, JSON.stringify(remainingTrades));
        return remainingTrades;
    } catch (error) {
        console.error("Failed to remove trades from localStorage:", error);
        return loadTrades();
    }
};

const getDailyRealizedPnl = (): number => {
    try {
        const trades = loadTrades();
        const now = new Date();
        // UTC Midnight timestamp
        const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();
        
        return trades.reduce((sum, trade) => {
            if (new Date(trade.exitTime).getTime() >= startOfDay) {
                return sum + trade.pnl;
            }
            return sum;
        }, 0);
    } catch (error) {
        console.error("Failed to calculate daily PnL:", error);
        return 0;
    }
};


export const historyService = {
    saveTrade,
    loadTrades,
    clearTrades,
    removeTrades,
    getDailyRealizedPnl,
};
