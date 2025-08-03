
import { Trade } from '../types';

const HISTORY_KEY_PREFIX = 'tradeHistory_';

// Helper to get a date key in YYYY-MM-DD format
const getDateKey = (date: Date): string => {
    return date.toISOString().split('T')[0];
};

const saveTrade = (trade: Trade): void => {
    try {
        const dateKey = getDateKey(trade.exitTime);
        const storageKey = `${HISTORY_KEY_PREFIX}${dateKey}`;
        const tradesForDay: Trade[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
        
        // Avoid duplicates
        if (!tradesForDay.some(t => t.id === trade.id)) {
            tradesForDay.push(trade);
            localStorage.setItem(storageKey, JSON.stringify(tradesForDay));
        }
    } catch (error) {
        console.error("Failed to save trade to localStorage:", error);
    }
};

const loadTrades = (startDate?: Date, daysToLoad: number = 10): { trades: Trade[], lastDate: Date | null } => {
    const loadedTrades: Trade[] = [];
    const currentDate = startDate ? new Date(startDate) : new Date();
    
    if (startDate) { // When loading more, start from the day before the last loaded date
        currentDate.setDate(currentDate.getDate() - 1);
    }

    let daysChecked = 0;
    let lastDateChecked: Date | null = null;
    
    while (daysChecked < daysToLoad) {
        try {
            const dateKey = getDateKey(currentDate);
            const storageKey = `${HISTORY_KEY_PREFIX}${dateKey}`;
            const tradesForDay: Trade[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
            loadedTrades.push(...tradesForDay);
        } catch (error) {
            console.error(`Failed to load trades for ${currentDate.toISOString()}:`, error);
        }

        lastDateChecked = new Date(currentDate);
        currentDate.setDate(currentDate.getDate() - 1);
        daysChecked++;

        // Stop if we go too far back in time (e.g., 5 years)
        if ((new Date().getTime() - currentDate.getTime()) > 5 * 365 * 24 * 60 * 60 * 1000) {
            break;
        }
    }
    
    // Sort trades by exit time, descending (most recent first)
    loadedTrades.sort((a, b) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime());

    return { trades: loadedTrades, lastDate: lastDateChecked };
};

export const historyService = {
    saveTrade,
    loadTrades,
};
