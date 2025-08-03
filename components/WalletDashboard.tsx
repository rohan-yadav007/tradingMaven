
import React from 'react';
import { TradingMode, WalletBalance, AccountInfo, MarginAccountInfo } from '../types';
import { MOCK_PAPER_SPOT_WALLET, MOCK_PAPER_FUTURES_WALLET, MOCK_PAPER_FUNDING_WALLET } from '../constants';
import { SettingsIcon, CheckCircleIcon, XCircleIcon, GenericCoinIcon } from './icons';
import { AssetAllocationChart } from './AssetAllocationChart';

interface WalletDashboardProps {
    executionMode: 'live' | 'paper';
    walletViewMode: TradingMode;
    setWalletViewMode: (mode: TradingMode) => void;
    isApiConnected: boolean;
    pricePrecision: number;
    accountInfo: AccountInfo | null;
    isWalletLoading: boolean;
    walletError: string | null;
}

const formInputClass = "w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
const formLabelClass = "text-sm font-medium text-gray-700 dark:text-gray-300";

const COIN_ID_MAP: { [key: string]: string } = {
    USDT: '825', BTC: '1', ETH: '1027', BNB: '1839', BUSD: '4687', LTC: '2',
    XRP: '52', SOL: '5426', DOGE: '74', ADA: '2010', AVAX: '5805',
    LINK: '1975', DOT: '6636', MATIC: '3890', SHIB: '5994', TRX: '1958', NEAR: '6535'
};

const getCoinImageUrl = (asset: string): string | null => {
    const displayAsset = asset.startsWith('LD') ? asset.substring(2) : asset;
    const coinId = COIN_ID_MAP[displayAsset];
    if (!coinId) return null;
    return `https://s2.coinmarketcap.com/static/img/coins/64x64/${coinId}.png`;
};


const AccountStatusItem: React.FC<{ label: string, enabled: boolean }> = ({ label, enabled }) => (
    <div className={`flex items-center gap-1 p-2 rounded ${enabled ? 'bg-green-100 dark:bg-green-900/50' : 'bg-red-100 dark:bg-red-900/50'}`}>
        {enabled 
            ? <CheckCircleIcon className="w-4 h-4 text-green-600 dark:text-green-400" /> 
            : <XCircleIcon className="w-4 h-4 text-red-600 dark:text-red-400" />
        }
        <span className={`text-sm font-medium ${enabled ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}`}>{label}</span>
    </div>
);

const AssetRow: React.FC<{ balance: WalletBalance, totalPortfolioValue: number }> = ({ balance, totalPortfolioValue }) => {
    const allocation = totalPortfolioValue > 0 ? (balance.usdValue / totalPortfolioValue) * 100 : 0;
    const displayName = balance.asset.startsWith('LD') ? balance.asset.substring(2) : balance.asset;
    const imageUrl = getCoinImageUrl(balance.asset);
    
    return (
        <div className="flex items-center gap-3 p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors">
            {imageUrl ? (
                <img src={imageUrl} alt={displayName} className="w-8 h-8"/>
            ) : (
                 <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                    <GenericCoinIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                </div>
            )}
            <div className="flex-grow">
                <div className="flex justify-between items-baseline">
                    <span className="font-bold text-gray-900 dark:text-gray-100">{displayName}</span>
                    <span className="font-mono text-gray-900 dark:text-gray-100">${balance.usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between items-baseline text-sm text-gray-500 dark:text-gray-400">
                    <span>
                        {balance.total.toFixed(5)}
                        {balance.asset !== displayName && <span className="ml-1">({balance.asset})</span>}
                    </span>
                    <span>{allocation.toFixed(2)}%</span>
                </div>
                 <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1 mt-1">
                    <div className="bg-blue-500 h-1 rounded-full" style={{ width: `${allocation}%` }}></div>
                </div>
            </div>
        </div>
    );
};


const PaperWalletTable: React.FC<{ title: string; balances: WalletBalance[]; pricePrecision: number }> = ({ title, balances, pricePrecision }) => {
    const totalUsd = balances.reduce((acc, b) => acc + b.usdValue, 0);

    return (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <div className="flex justify-between items-baseline mb-2">
                <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200">{title}</h3>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100">${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-gray-500 dark:text-gray-400 uppercase">
                        <tr>
                            <th scope="col" className="py-2">Asset</th>
                            <th scope="col" className="py-2 text-right">Total</th>
                            <th scope="col" className="py-2 text-right">USD Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        {balances.map(b => {
                            const imageUrl = getCoinImageUrl(b.asset);
                            return (
                                <tr key={b.asset} className="border-t border-gray-200 dark:border-gray-700">
                                    <td className="py-2 font-medium flex items-center gap-2 text-gray-900 dark:text-gray-100">
                                        {imageUrl ? (
                                            <img src={imageUrl} alt={b.asset} className="w-5 h-5"/>
                                        ) : (
                                            <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
                                                <GenericCoinIcon className="w-3 h-3 text-gray-500 dark:text-gray-400" />
                                            </div>
                                        )}
                                        {b.asset}
                                    </td>
                                    <td className="py-2 text-right text-gray-600 dark:text-gray-400">{b.total.toFixed(4)}</td>
                                    <td className="py-2 text-right text-gray-600 dark:text-gray-400">${b.usdValue.toLocaleString('en-US', { minimumFractionDigits: pricePrecision, maximumFractionDigits: pricePrecision })}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const ConnectApiMessage: React.FC = () => (
    <div className="text-center h-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex flex-col justify-center p-6">
        <SettingsIcon className="w-8 h-8 mx-auto text-gray-400 dark:text-gray-500 mb-2"/>
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200">API Not Configured</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
            Binance API keys must be provided as environment variables to see live balances.
        </p>
    </div>
);

const LoadingMessage: React.FC = () => (
    <div className="text-center p-4 h-full flex flex-col justify-center items-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">Fetching wallet data...</p>
    </div>
);

const ErrorMessage: React.FC<{ message: string }> = ({ message }) => (
    <div className="bg-red-100 dark:bg-red-900/50 border-l-4 border-red-500 text-red-700 dark:text-red-300 p-4 rounded-r-lg" role="alert">
        <p className="font-bold">Connection Failed</p>
        <p className="text-sm">{message}</p>
    </div>
);

const LivePortfolioWallet: React.FC<{ info: AccountInfo, title: string }> = ({ info, title }) => {
    const totalUsdValue = info.balances.reduce((acc, b) => acc + b.usdValue, 0);
    const topAssets = info.balances.filter(b => b.usdValue > 1).slice(0, 6);
    const displayBalances = info.balances.filter(b => b.usdValue > 1);
    const hasAssetsForChart = topAssets.length > 0;

    return (
        <div className="flex flex-col gap-6">
             <div>
                <span className="text-sm text-gray-500 dark:text-gray-400">{title}</span>
                <p className="text-3xl font-bold mb-0 text-gray-900 dark:text-gray-100">${totalUsdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            
            <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 items-center`}>
                {hasAssetsForChart && (
                    <div className="h-48">
                        <AssetAllocationChart data={topAssets} />
                    </div>
                )}
                <div className={`${hasAssetsForChart ? '' : 'md:col-span-2'}`}>
                    <div className="flex flex-col gap-2">
                        <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400">Account Status</h4>
                        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
                            <AccountStatusItem label="Trade" enabled={info.canTrade} />
                            <AccountStatusItem label="Withdraw" enabled={info.canWithdraw} />
                            <AccountStatusItem label="Deposit" enabled={info.canDeposit} />
                        </div>
                    </div>
                </div>
            </div>

            <div>
                <h3 className="font-semibold text-base mb-2 text-gray-800 dark:text-gray-200">Assets</h3>
                <div className="flex flex-col gap-1 overflow-y-auto pr-2 -mr-2" style={{maxHeight: '256px'}}>
                    {displayBalances.length > 0 ? displayBalances.map(b => (
                        <AssetRow key={b.asset} balance={b} totalPortfolioValue={totalUsdValue} />
                    )) : (
                        <div className="text-center p-4 text-sm text-gray-500 dark:text-gray-400">No assets with a balance over $1.</div>
                    )}
                </div>
            </div>
        </div>
    );
};

const LiveFuturesWallet: React.FC<{ info: AccountInfo }> = ({ info }) => {
    const totalMarginBalance = parseFloat(info.totalMarginBalance || '0');
    const totalUnrealizedPnl = parseFloat(info.totalUnrealizedProfit || '0');
    const pnlIsProfit = totalUnrealizedPnl >= 0;

    const topAssets = info.balances.filter(b => b.usdValue > 1).slice(0, 6);
    const hasAssetsForChart = topAssets.length > 0;

    return (
        <div className="flex flex-col gap-6">
             <div>
                <span className="text-sm text-gray-500 dark:text-gray-400">Total Margin Balance</span>
                <p className="text-3xl font-bold mb-0 text-gray-900 dark:text-gray-100">${totalMarginBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <div className="flex items-center gap-2">
                     <span className="text-sm text-gray-500 dark:text-gray-400">Unrealized PNL:</span>
                     <span className={`text-sm font-semibold ${pnlIsProfit ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        ${totalUnrealizedPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                     </span>
                </div>
            </div>
            
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                {hasAssetsForChart && (
                    <div className="h-48">
                        <AssetAllocationChart data={topAssets} />
                    </div>
                )}
                 <div className={`${hasAssetsForChart ? '' : 'md:col-span-2'}`}>
                    <div className="flex flex-col gap-2">
                        <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400">Account Status</h4>
                        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
                            <AccountStatusItem label="Trade" enabled={info.canTrade} />
                            <AccountStatusItem label="Withdraw" enabled={info.canWithdraw} />
                            <AccountStatusItem label="Deposit" enabled={info.canDeposit} />
                        </div>
                    </div>
                </div>
             </div>

            <div>
                <h3 className="font-semibold text-base mb-2 text-gray-800 dark:text-gray-200">Assets</h3>
                <div className="flex flex-col gap-1 overflow-y-auto pr-2 -mr-2" style={{maxHeight: '256px'}}>
                    {info.balances.filter(b => b.usdValue > 1).length > 0 ? info.balances.filter(b => b.usdValue > 1).map(b => (
                        <AssetRow key={b.asset} balance={b} totalPortfolioValue={totalMarginBalance} />
                    )) : (
                        <div className="text-center p-4 text-sm text-gray-500 dark:text-gray-400">No assets with a balance over $1.</div>
                    )}
                </div>
            </div>
        </div>
    )
}

const LiveMarginWallet: React.FC<{ info: MarginAccountInfo }> = ({ info }) => {
    const totalNetAssetBtc = parseFloat(info.totalNetAssetOfBtc || '0');
    const btcPrice = info.btcUsdPrice || 0;
    const totalNetAssetUsd = totalNetAssetBtc * btcPrice;
    const displayBalances = info.balances.filter(b => b.usdValue > 1);
    
    const marginLevel = parseFloat(info.marginLevel);
    const getMarginLevelColor = (level: number) => {
        if (level > 5) return 'text-green-600 dark:text-green-400';
        if (level > 2) return 'text-yellow-600 dark:text-yellow-400';
        return 'text-red-600 dark:text-red-400';
    }

    return (
        <div className="flex flex-col gap-6">
             <div>
                <span className="text-sm text-gray-500 dark:text-gray-400">Net Asset Value</span>
                <p className="text-3xl font-bold mb-0 text-gray-900 dark:text-gray-100">${totalNetAssetUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <div className="flex items-center gap-4 text-sm mt-1">
                    <div>
                        <span className="text-gray-500 dark:text-gray-400">Margin Level: </span>
                        <span className={`font-bold ${getMarginLevelColor(marginLevel)}`}>{marginLevel.toFixed(2)}</span>
                    </div>
                    <div>
                        <span className="text-gray-500 dark:text-gray-400">Total Debt (BTC): </span>
                        <span className="font-mono">{parseFloat(info.totalLiabilityOfBtc).toFixed(6)}</span>
                    </div>
                </div>
            </div>
            
            <div className="flex flex-col gap-2">
                <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400">Account Status</h4>
                <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
                    <AccountStatusItem label="Trade" enabled={info.canTrade} />
                    <AccountStatusItem label="Withdraw" enabled={info.canWithdraw} />
                    <AccountStatusItem label="Deposit" enabled={info.canDeposit} />
                </div>
            </div>

            <div>
                <h3 className="font-semibold text-base mb-2 text-gray-800 dark:text-gray-200">Assets</h3>
                 <div className="flex flex-col gap-1 overflow-y-auto pr-2 -mr-2" style={{maxHeight: '288px'}}>
                    {displayBalances.length > 0 ? displayBalances.map(b => (
                        <AssetRow key={b.asset} balance={b} totalPortfolioValue={totalNetAssetUsd} />
                    )) : (
                        <div className="text-center p-4 text-sm text-gray-500 dark:text-gray-400">No assets with a balance over $1.</div>
                    )}
                </div>
            </div>
        </div>
    )
}

export const WalletDashboard: React.FC<WalletDashboardProps> = ({ executionMode, walletViewMode, setWalletViewMode, isApiConnected, pricePrecision, accountInfo, isWalletLoading, walletError }) => {
    
    const renderContent = () => {
        if (executionMode === 'paper') {
            return (
                <div className="flex flex-col gap-4">
                    <h3 className="font-semibold text-base text-gray-800 dark:text-gray-200">Paper Wallets</h3>
                    <PaperWalletTable title="Spot" balances={MOCK_PAPER_SPOT_WALLET} pricePrecision={pricePrecision} />
                    <PaperWalletTable title="Futures" balances={MOCK_PAPER_FUTURES_WALLET} pricePrecision={pricePrecision} />
                    <PaperWalletTable title="Funding" balances={MOCK_PAPER_FUNDING_WALLET} pricePrecision={pricePrecision} />
                </div>
            );
        }

        if (!isApiConnected) {
            return <ConnectApiMessage />;
        }

        if (isWalletLoading) {
            return <LoadingMessage />;
        }

        if (walletError) {
            return <ErrorMessage message={walletError} />;
        }

        if (!accountInfo) {
            return <LoadingMessage />; // Fallback if still null after loading
        }
        
        switch (walletViewMode) {
            case TradingMode.Spot:
                return <LivePortfolioWallet info={accountInfo} title="Spot Wallet Value" />;
            case TradingMode.Funding:
                return <LivePortfolioWallet info={accountInfo} title="Funding Wallet Value" />;
            case TradingMode.USDSM_Futures:
                return <LiveFuturesWallet info={accountInfo} />;
            case TradingMode.Margin:
                return <LiveMarginWallet info={accountInfo as MarginAccountInfo} />;
            default:
                return <div className="text-center p-4 text-sm text-gray-500 dark:text-gray-400">Select a wallet to view.</div>;
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
                <label htmlFor="wallet-account" className={formLabelClass}>Live Wallet Account</label>
                <select
                    id="wallet-account"
                    value={walletViewMode}
                    onChange={e => setWalletViewMode(e.target.value as TradingMode)}
                    className={formInputClass}
                    disabled={executionMode === 'paper'}
                >
                    {Object.values(TradingMode).map(mode => (
                        <option key={mode} value={mode}>{mode}</option>
                    ))}
                </select>
            </div>
            <div className="mt-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                {renderContent()}
            </div>
        </div>
    );
};
