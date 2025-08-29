import React, { useState } from 'react';
import { Kline, AccountInfo } from '../types';
import { SettingsIcon, WalletIcon } from './icons';
import { ControlPanel } from './ControlPanel';
import { WalletDashboard } from './WalletDashboard';
import { useTradingConfigState, useTradingConfigActions } from '../contexts/TradingConfigContext';

interface SidebarProps {
    onStartBot: () => void;
    klines: Kline[];
    livePrice: number;
    botsToCreateCount: number;
    selectedPairsCount: number;
    theme: 'light' | 'dark';

    // Wallet Dashboard Props
    isApiConnected: boolean;
    pricePrecision: number;
    accountInfo: AccountInfo | null;
    isWalletLoading: boolean;
    walletError: string | null;
}


export const Sidebar: React.FC<SidebarProps> = (props) => {
    const [activeTab, setActiveTab] = useState<'trade' | 'wallet'>('trade');
    const { executionMode, walletViewMode } = useTradingConfigState();
    const { setWalletViewMode } = useTradingConfigActions();

    const getTabClass = (tabName: 'trade' | 'wallet') => {
        const baseClass = "flex-1 flex items-center justify-center gap-2 p-3 text-sm font-semibold transition-colors duration-200";
        if (activeTab === tabName) {
            return `${baseClass} text-sky-600 dark:text-sky-400 border-b-2 border-sky-500 bg-sky-100/50 dark:bg-slate-700/50`;
        }
        return `${baseClass} text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 border-b-2 border-transparent hover:bg-slate-100/50 dark:hover:bg-slate-800/50`;
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm flex flex-col h-full">
            <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex" aria-label="Tabs">
                    <button onClick={() => setActiveTab('trade')} className={getTabClass('trade')}>
                        <SettingsIcon className="w-5 h-5"/>
                        <span>Trade</span>
                    </button>
                    <button onClick={() => setActiveTab('wallet')} className={getTabClass('wallet')}>
                        <WalletIcon className="w-5 h-5"/>
                        <span>Wallet</span>
                    </button>
                </nav>
            </div>
            <div className="flex-grow p-4 overflow-y-auto">
                {activeTab === 'trade' && (
                    <ControlPanel
                        klines={props.klines}
                        livePrice={props.livePrice}
                        botsToCreateCount={props.botsToCreateCount}
                        selectedPairsCount={props.selectedPairsCount}
                        onStartBot={props.onStartBot}
                        theme={props.theme}
                    />
                )}
                {activeTab === 'wallet' && (
                    <WalletDashboard
                        executionMode={executionMode}
                        walletViewMode={walletViewMode}
                        setWalletViewMode={setWalletViewMode}
                        isApiConnected={props.isApiConnected}
                        pricePrecision={props.pricePrecision}
                        accountInfo={props.accountInfo}
                        isWalletLoading={props.isWalletLoading}
                        walletError={props.walletError}
                    />
                )}
            </div>
        </div>
    );
};
