
import { Trade } from '../types';

const HISTORY_KEY = 'tradeHistory_v2';
const MAX_HISTORY_LENGTH = 200;

const saveTrade = (trade: Trade): Trade[] => {
    try {
        const allTrades = loadTrades();
        
        // Add new trade and prevent duplicates
        const updatedTrades = [trade, ...allTrades.filter(t => t.id !== trade.id)];
        
        // Sort by exit time (most recent first) and cap the length
        const sortedAndCapped = updatedTrades
            .sort((a, b) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime())
            .slice(0, MAX_HISTORY_LENGTH);

        localStorage.setItem(HISTORY_KEY, JSON.stringify(sortedAndCapped));
        return sortedAndCapped;
    } catch (error) {
        console.error("Failed to save trade to localStorage:", error);
        return loadTrades(); // Return existing trades on failure
    }
};

const loadTrades = (): Trade[] => {
    try {
        const storedTrades = localStorage.getItem(HISTORY_KEY);
        if (storedTrades) {
            // Re-hydrate date objects
            return JSON.parse(storedTrades).map((trade: any) => ({
                ...trade,
                entryTime: new Date(trade.entryTime),
                exitTime: new Date(trade.exitTime),
            }));
        }
        return [];
    } catch (error) {
        console.error("Failed to load trades from localStorage:", error);
        return [];
    }
};

export const historyService = {
    saveTrade,
    loadTrades,
};
