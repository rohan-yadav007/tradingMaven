import { UserPreferences, TradingPairList, TradingMode } from '../types';

const PREFERENCES_KEY = 'userPreferences_v1';

const getPreferences = (): UserPreferences => {
    try {
        const stored = localStorage.getItem(PREFERENCES_KEY);
        if (stored) {
            const prefs = JSON.parse(stored);
            // Ensure defaults
            return {
                tradingPairLists: Array.isArray(prefs.tradingPairLists) ? prefs.tradingPairLists : [],
                dailyLossLimit: typeof prefs.dailyLossLimit === 'number' ? prefs.dailyLossLimit : 0
            };
        }
    } catch (error) {
        console.error("Failed to load user preferences:", error);
    }
    return { tradingPairLists: [], dailyLossLimit: 0 };
};

const savePreferences = (prefs: UserPreferences): void => {
    try {
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
    } catch (error) {
        console.error("Failed to save user preferences:", error);
    }
};

const getTradingPairLists = (): TradingPairList[] => {
    return getPreferences().tradingPairLists;
};

const addTradingPairList = (newList: Omit<TradingPairList, 'id'>): TradingPairList[] => {
    const prefs = getPreferences();
    const listWithId: TradingPairList = { ...newList, id: `tpl-${Date.now()}` };
    prefs.tradingPairLists.push(listWithId);
    savePreferences(prefs);
    return prefs.tradingPairLists;
};

const updateTradingPairList = (updatedList: TradingPairList): TradingPairList[] => {
    const prefs = getPreferences();
    const index = prefs.tradingPairLists.findIndex(l => l.id === updatedList.id);
    if (index !== -1) {
        prefs.tradingPairLists[index] = updatedList;
        savePreferences(prefs);
    }
    return prefs.tradingPairLists;
};

const deleteTradingPairList = (listId: string): TradingPairList[] => {
    const prefs = getPreferences();
    prefs.tradingPairLists = prefs.tradingPairLists.filter(l => l.id !== listId);
    savePreferences(prefs);
    return prefs.tradingPairLists;
};

export const userPreferencesService = {
    getPreferences,
    savePreferences,
    getTradingPairLists,
    addTradingPairList,
    updateTradingPairList,
    deleteTradingPairList,
};