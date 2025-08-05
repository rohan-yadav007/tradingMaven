
import React, { useState } from 'react';
import { TradingMode, Agent, Kline, AccountInfo, AgentParams, RiskMode } from '../types';
import { SettingsIcon, WalletIcon } from './icons';
import { ControlPanel } from './ControlPanel';
import { WalletDashboard } from './WalletDashboard';

interface SidebarProps {
    // Execution Mode
    executionMode: 'live' | 'paper';
    setExecutionMode: (mode: 'live' | 'paper') => void;
    availableBalance: number;

    // Control Panel Props
    tradingMode: TradingMode;
    setTradingMode: (mode: TradingMode) => void;
    allPairs: string[];
    selectedPair: string;
    setSelectedPair: (pair: string) => void;
    leverage: number;
    setLeverage: (leverage: number) => void;
    marginType: 'ISOLATED' | 'CROSSED';
    setMarginType: (type: 'ISOLATED' | 'CROSSED') => void;
    futuresSettingsError: string | null;
    isMultiAssetMode: boolean;
    onSetMultiAssetMode: (isEnabled: boolean) => void;
    multiAssetModeError: string | null;
    investmentAmount: number;
    setInvestmentAmount: (amount: number) => void;
    stopLossMode: RiskMode;
    setStopLossMode: (mode: RiskMode) => void;
    stopLossValue: number;
    setStopLossValue: (value: number) => void;
    takeProfitMode: RiskMode;
    setTakeProfitMode: (mode: RiskMode) => void;
    takeProfitValue: number;
    setTakeProfitValue: (value: number) => void;
    isStopLossLocked: boolean;
    setIsStopLossLocked: (locked: boolean) => void;
    isTakeProfitLocked: boolean;
    setIsTakeProfitLocked: (locked: boolean) => void;
    isCooldownEnabled: boolean;
    setIsCooldownEnabled: (enabled: boolean) => void;
    timeFrame: string;
    setTimeFrame: (timeFrame: string) => void;
    selectedAgent: Agent;
    setSelectedAgent: (agent: Agent) => void;
    onStartBot: () => void;
    klines: Kline[];
    isBotCombinationActive: boolean;
    agentParams: AgentParams;
    setAgentParams: (params: AgentParams | ((p: AgentParams) => AgentParams)) => void;
    theme: 'light' | 'dark';

    // Wallet Dashboard Props
    walletViewMode: TradingMode;
    setWalletViewMode: (mode: TradingMode) => void;
    isApiConnected: boolean;
    pricePrecision: number;
    accountInfo: AccountInfo | null;
    isWalletLoading: boolean;
    walletError: string | null;
}


export const Sidebar: React.FC<SidebarProps> = (props) => {
    const [activeTab, setActiveTab] = useState<'trade' | 'wallet'>('trade');

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
                        executionMode={props.executionMode}
                        setExecutionMode={props.setExecutionMode}
                        availableBalance={props.availableBalance}
                        tradingMode={props.tradingMode}
                        setTradingMode={props.setTradingMode}
                        allPairs={props.allPairs}
                        selectedPair={props.selectedPair}
                        setSelectedPair={props.setSelectedPair}
                        leverage={props.leverage}
                        setLeverage={props.setLeverage}
                        marginType={props.marginType}
                        setMarginType={props.setMarginType}
                        futuresSettingsError={props.futuresSettingsError}
                        isMultiAssetMode={props.isMultiAssetMode}
                        onSetMultiAssetMode={props.onSetMultiAssetMode}
                        multiAssetModeError={props.multiAssetModeError}
                        investmentAmount={props.investmentAmount}
                        setInvestmentAmount={props.setInvestmentAmount}
                        stopLossMode={props.stopLossMode}
                        setStopLossMode={props.setStopLossMode}
                        stopLossValue={props.stopLossValue}
                        setStopLossValue={props.setStopLossValue}
                        takeProfitMode={props.takeProfitMode}
                        setTakeProfitMode={props.setTakeProfitMode}
                        takeProfitValue={props.takeProfitValue}
                        setTakeProfitValue={props.setTakeProfitValue}
                        isStopLossLocked={props.isStopLossLocked}
                        setIsStopLossLocked={props.setIsStopLossLocked}
                        isTakeProfitLocked={props.isTakeProfitLocked}
                        setIsTakeProfitLocked={props.setIsTakeProfitLocked}
                        isCooldownEnabled={props.isCooldownEnabled}
                        setIsCooldownEnabled={props.setIsCooldownEnabled}
                        timeFrame={props.timeFrame}
                        setTimeFrame={props.setTimeFrame}
                        selectedAgent={props.selectedAgent}
                        setSelectedAgent={props.setSelectedAgent}
                        onStartBot={props.onStartBot}
                        klines={props.klines}
                        isBotCombinationActive={props.isBotCombinationActive}
                        agentParams={props.agentParams}
                        theme={props.theme}
                    />
                )}
                {activeTab === 'wallet' && (
                    <WalletDashboard
                        executionMode={props.executionMode}
                        walletViewMode={props.walletViewMode}
                        setWalletViewMode={props.setWalletViewMode}
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
