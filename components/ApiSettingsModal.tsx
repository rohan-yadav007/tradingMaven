import React, { useState, useEffect } from 'react';
import { CloseIcon, SettingsIcon, CheckCircleIcon, XCircleIcon } from './icons';
import * as binanceService from '../services/binanceService';

interface ApiSettingsModalProps {
    onClose: () => void;
}

export const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({ onClose }) => {
    const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        binanceService.checkApiConnection()
            .then(setIsConnected)
            .finally(() => setIsLoading(false));
    }, []);

    return (
        <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
            aria-modal="true"
            role="dialog"
        >
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl w-full max-w-lg m-4 text-gray-800 dark:text-gray-200">
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                        <SettingsIcon className="w-6 h-6 text-cyan-500 dark:text-cyan-400" />
                        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">API Connection Settings</h2>
                    </div>
                    <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white" aria-label="Close modal">
                        <CloseIcon className="w-6 h-6" />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        This application connects to the Binance API using keys provided via environment variables.
                    </p>
                    <div className="p-4 rounded-md bg-gray-100 dark:bg-gray-900/50">
                        <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Connection Status</h3>
                        {isLoading ? (
                            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-cyan-500"></div>
                                <span>Checking connection...</span>
                            </div>
                        ) : isConnected ? (
                            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                                <CheckCircleIcon className="w-5 h-5"/>
                                <span>Successfully connected to Binance API.</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                                <XCircleIcon className="w-5 h-5"/>
                                <span>Not connected. Ensure `VITE_BINANCE_API_KEY` and `VITE_BINANCE_API_SECRET` are set correctly.</span>
                            </div>
                        )}
                    </div>
                     <p className="text-sm text-gray-600 dark:text-gray-400">
                        To enable live trading, you must create a `.env.local` file in the project root and add your Binance API keys:
                    </p>
                    <pre className="p-3 bg-gray-100 dark:bg-gray-900 rounded-md text-xs text-gray-700 dark:text-gray-300 overflow-x-auto">
                        <code>
                            {`VITE_BINANCE_API_KEY=your_api_key_here\nVITE_BINANCE_API_SECRET=your_api_secret_here`}
                        </code>
                    </pre>
                    <p className="text-xs text-gray-500 dark:text-gray-500">
                        After adding the keys, you will need to restart the application server. The keys are not exposed to the frontend client.
                    </p>
                </div>
                <div className="flex justify-end items-center p-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 rounded-b-lg">
                    <button onClick={onClose} className="py-2 px-4 rounded-md text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 transition-colors">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};
