
import React, { useState } from 'react';
import { Kline, AccountInfo } from '../types';
import { SettingsIcon, WalletIcon, SidebarOpenIcon, SidebarCloseIcon } from './icons';
import { ControlPanel } from './ControlPanel';
import { WalletDashboard } from './WalletDashboard';
import { useTradingConfigState, useTradingConfigActions } from '../contexts/TradingConfigContext';

interface SidebarProps {
    onStartBot: () => void;
    klines: Kline[];
    botsToCreateCount: number;
    selectedPairsCount: number;
    theme: 'light' | 'dark';

    // Wallet Dashboard Props
    isApiConnected: boolean;
    pricePrecision: number;
    accountInfo: AccountInfo | null;
    isWalletLoading: boolean;
    walletError: string | null;
    
    // Collapsible State
    isOpen: boolean;
    onToggle: () => void;
}


export const Sidebar: React.FC<SidebarProps> = (props) => {
    const { isOpen, onToggle } = props;
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
    
    const handleCollapsedTabClick = (tabName: 'trade' | 'wallet') => {
        setActiveTab(tabName);
        if (!isOpen) onToggle();
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm flex flex-col h-full transition-all duration-300">
            {/* Header / Toggle Row */}
            <div className="border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                {isOpen ? (
                    <nav className="flex flex-1" aria-label="Tabs">
                        <button onClick={() => setActiveTab('trade')} className={getTabClass('trade')}>
                            <SettingsIcon className="w-5 h-5"/>
                            <span>Trade</span>
                        </button>
                        <button onClick={() => setActiveTab('wallet')} className={getTabClass('wallet')}>
                            <WalletIcon className="w-5 h-5"/>
                            <span>Wallet</span>
                        </button>
                    </nav>
                ) : (
                    <div className="flex-1 flex justify-center py-3 text-slate-400 dark:text-slate-500">
                        {/* Placeholder or small indication if needed when collapsed */}
                    </div>
                )}
                
                <button 
                    onClick={onToggle} 
                    className="p-3 text-slate-400 hover:text-sky-500 dark:hover:text-sky-400 transition-colors border-l border-slate-200 dark:border-slate-700"
                    title={isOpen ? "Collapse Sidebar" : "Expand Sidebar"}
                >
                    {isOpen ? <SidebarCloseIcon className="w-5 h-5" /> : <SidebarOpenIcon className="w-5 h-5" />}
                </button>
            </div>

            {/* Content Area */}
            {isOpen ? (
                <div className="flex-grow p-4 overflow-y-auto">
                    {/* Conditionally render components based on activeTab */}
                    {activeTab === 'trade' && (
                        <ControlPanel
                            klines={props.klines}
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
            ) : (
                // Collapsed State: Show Icon Buttons to switch tabs and re-open
                <div className="flex flex-col items-center py-4 gap-4">
                    <button 
                        onClick={() => handleCollapsedTabClick('trade')} 
                        className={`p-3 rounded-lg transition-colors ${activeTab === 'trade' ? 'bg-sky-100 dark:bg-slate-700 text-sky-600 dark:text-sky-400' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                        title="Trade Settings"
                    >
                        <SettingsIcon className="w-6 h-6"/>
                    </button>
                    <button 
                        onClick={() => handleCollapsedTabClick('wallet')} 
                        className={`p-3 rounded-lg transition-colors ${activeTab === 'wallet' ? 'bg-sky-100 dark:bg-slate-700 text-sky-600 dark:text-sky-400' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                        title="Wallet Dashboard"
                    >
                        <WalletIcon className="w-6 h-6"/>
                    </button>
                </div>
            )}
        </div>
    );
};
