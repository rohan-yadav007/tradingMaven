

import React, { useState, useMemo, useEffect } from 'react';
import { useTradingConfigState, useTradingConfigActions } from '../contexts/TradingConfigContext';
import { TradingMode, TradingPairList } from '../types';
import { SearchableDropdown } from './SearchableDropdown';
import { SettingsIcon, TrashIcon } from './icons';

const formGroupClass = "flex flex-col gap-1.5";
const formLabelClass = "text-sm font-medium text-slate-700 dark:text-slate-300";
const formInputClass = "w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500";
const buttonClass = "flex items-center justify-center gap-2 px-4 py-2 text-white font-semibold rounded-md shadow-sm transition-colors";
const primaryButtonClass = `${buttonClass} bg-sky-600 hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 focus:ring-offset-slate-50 dark:dark:focus:ring-offset-slate-800 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed`;


const ListEditor: React.FC<{
    listToEdit: Omit<TradingPairList, 'id'> | TradingPairList | null;
    onSave: (list: Omit<TradingPairList, 'id'> | TradingPairList) => void;
    onCancel: () => void;
    theme: 'light' | 'dark';
}> = ({ listToEdit, onSave, onCancel, theme }) => {
    // FIX: Removed 'theme' from useTradingConfigState as it will be passed via props.
    const { allPairs, isPairsLoading } = useTradingConfigState();
    const [name, setName] = useState('');
    const [selectedPairs, setSelectedPairs] = useState<string[]>([]);
    const [tradingMode, setTradingMode] = useState<TradingMode>(TradingMode.USDSM_Futures);

    useEffect(() => {
        if (listToEdit) {
            setName(listToEdit.name);
            setSelectedPairs(listToEdit.pairs);
            setTradingMode(listToEdit.tradingMode);
        } else {
            setName('');
            setSelectedPairs([]);
            setTradingMode(TradingMode.USDSM_Futures);
        }
    }, [listToEdit]);

    const handleSave = () => {
        if (!name || selectedPairs.length === 0) {
            alert('Please provide a name and select at least one pair.');
            return;
        }
        onSave({ ...listToEdit, name, pairs: selectedPairs, tradingMode });
    };

    const isEditing = listToEdit && 'id' in listToEdit;

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold">{isEditing ? 'Edit Trading Pair List' : 'Create New List'}</h3>
            <div className={formGroupClass}>
                <label htmlFor="list-name" className={formLabelClass}>List Name</label>
                <input id="list-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Meme Coins, Top Alts" className={formInputClass} />
            </div>
            <div className={formGroupClass}>
                <label htmlFor="trading-mode-pref" className={formLabelClass}>Platform</label>
                <select id="trading-mode-pref" value={tradingMode} onChange={e => setTradingMode(e.target.value as TradingMode)} className={formInputClass}>
                    {Object.values(TradingMode).map(mode => <option key={mode} value={mode}>{mode}</option>)}
                </select>
            </div>
             <div className={formGroupClass}>
                <label htmlFor="market-pair-pref" className={formLabelClass}>Select Pairs</label>
                <SearchableDropdown
                    isMulti
                    options={allPairs}
                    value={selectedPairs}
                    onChange={(newPairs) => setSelectedPairs(newPairs as string[])}
                    theme={theme}
                    disabled={isPairsLoading}
                />
            </div>
            <div className="flex gap-3 pt-2">
                <button onClick={handleSave} className={`${primaryButtonClass} flex-1`} disabled={!name || selectedPairs.length === 0}>
                    {isEditing ? 'Update List' : 'Save List'}
                </button>
                <button onClick={onCancel} className={`${buttonClass} bg-slate-500 hover:bg-slate-600 flex-1`}>
                    Cancel
                </button>
            </div>
        </div>
    );
};

export const PreferencesPanel: React.FC<{ theme: 'light' | 'dark' }> = ({ theme }) => {
    const { tradingPairLists } = useTradingConfigState();
    const { addTradingPairList, updateTradingPairList, deleteTradingPairList } = useTradingConfigActions();
    const [activeTab, setActiveTab] = useState<'lists' | 'create'>('lists');
    const [listToEdit, setListToEdit] = useState<TradingPairList | null>(null);

    useEffect(() => {
        if (tradingPairLists.length === 0) {
            setActiveTab('create');
        }
    }, [tradingPairLists]);

    const handleEdit = (list: TradingPairList) => {
        setListToEdit(list);
        setActiveTab('create');
    };

    const handleDelete = (list: TradingPairList) => {
        if (window.confirm(`Are you sure you want to delete the "${list.name}" list?`)) {
            deleteTradingPairList(list.id);
        }
    };
    
    const handleSave = (listData: Omit<TradingPairList, 'id'> | TradingPairList) => {
        if ('id' in listData) {
            updateTradingPairList(listData as TradingPairList);
        } else {
            addTradingPairList(listData);
        }
        setListToEdit(null);
        setActiveTab('lists');
    };

    const handleCancel = () => {
        setListToEdit(null);
        setActiveTab('lists');
    };
    
    const handleCreateNew = () => {
        setListToEdit(null);
        setActiveTab('create');
    };

    const tabClass = "px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors";
    const activeTabClass = "bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400";
    const inactiveTabClass = "bg-slate-100 dark:bg-slate-900/50 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700";

    return (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="md:col-span-1">
                <div className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm">
                    <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
                        <SettingsIcon />
                        <span>Preferences</span>
                    </h2>
                    <ul className="space-y-1">
                        <li>
                            <button className="w-full text-left px-3 py-2 rounded font-semibold bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300">
                                Trading Pair Lists
                            </button>
                        </li>
                    </ul>
                </div>
            </div>
            <div className="md:col-span-3">
                <div className="flex border-b border-slate-200 dark:border-slate-700">
                    <button onClick={() => setActiveTab('lists')} className={`${tabClass} ${activeTab === 'lists' ? activeTabClass : inactiveTabClass}`}>
                        Saved Lists ({tradingPairLists.length})
                    </button>
                     <button onClick={() => setActiveTab('create')} className={`${tabClass} ${activeTab === 'create' ? activeTabClass : inactiveTabClass}`}>
                        {listToEdit ? 'Edit List' : 'Create New'}
                    </button>
                </div>
                 <div className="bg-white dark:bg-slate-800 p-6 rounded-b-lg shadow-sm">
                    {activeTab === 'lists' && (
                        <div>
                             <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-semibold">My Pair Lists</h3>
                                <button onClick={handleCreateNew} className="text-sm font-semibold bg-sky-600 text-white px-3 py-1.5 rounded-md hover:bg-sky-700">
                                    + Create New
                                </button>
                            </div>
                            {tradingPairLists.length > 0 ? (
                                <ul className="space-y-3">
                                    {tradingPairLists.map(list => (
                                        <li key={list.id} className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg flex justify-between items-center">
                                            <div>
                                                <p className="font-semibold text-slate-800 dark:text-slate-200">{list.name}</p>
                                                <p className="text-xs text-slate-500 dark:text-slate-400">{list.pairs.length} pairs | {list.tradingMode}</p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={() => handleEdit(list)} className="text-sm font-medium text-sky-600 hover:underline">Edit</button>
                                                <button onClick={() => handleDelete(list)} className="p-1.5 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-full">
                                                    <TrashIcon className="w-4 h-4"/>
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-slate-500 text-center py-8">You haven't created any pair lists yet.</p>
                            )}
                        </div>
                    )}
                     {activeTab === 'create' && (
                        <ListEditor listToEdit={listToEdit} onSave={handleSave} onCancel={handleCancel} theme={theme} />
                     )}
                </div>
            </div>
        </div>
    );
};
