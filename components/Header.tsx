import React from 'react';
import { BotIcon, SunIcon, MoonIcon, FlaskIcon, ChartIcon } from './icons';

interface HeaderProps {
    isApiConnected: boolean;
    executionMode: 'live' | 'paper';
    theme: 'light' | 'dark';
    setTheme: (theme: 'light' | 'dark') => void;
    activeView: 'trading' | 'backtesting';
    setActiveView: (view: 'trading' | 'backtesting') => void;
}

export const Header: React.FC<HeaderProps> = ({ isApiConnected, executionMode, theme, setTheme, activeView, setActiveView }) => {
    const toggleTheme = () => {
        setTheme(theme === 'light' ? 'dark' : 'light');
    };
    
    const navLinkClasses = "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-semibold transition-colors duration-200";
    const activeLinkClasses = "bg-sky-600 text-white shadow-inner";
    const inactiveLinkClasses = "text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700";

    const status = executionMode === 'paper' 
        ? { text: 'Paper Mode', color: 'sky' as const } 
        : isApiConnected 
        ? { text: 'Live Trading', color: 'emerald' as const }
        : { text: 'API Disconnected', color: 'rose' as const };
    
    const colorClasses = {
        sky: 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300',
        emerald: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300',
        rose: 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300'
    };
    
    const pingColor = {
        sky: 'bg-sky-400',
        emerald: 'bg-emerald-400',
        rose: 'bg-rose-400'
    };

    const dotColor = {
        sky: 'bg-sky-500',
        emerald: 'bg-emerald-500',
        rose: 'bg-rose-500'
    };


    return (
        <header className="bg-white dark:bg-slate-800/80 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700/80 shadow-sm sticky top-0 z-40">
            <div className="container mx-auto px-3 lg:px-4">
                <div className="flex items-center justify-between h-16">
                    <div className="flex items-center gap-3">
                        <BotIcon className="w-8 h-8 text-sky-500" />
                        <span className="font-bold text-lg text-slate-900 dark:text-white">Jo Gira Hai, Wo Uthega</span>
                    </div>

                    <div className="hidden md:flex items-center gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-lg">
                        <button 
                            onClick={() => setActiveView('trading')}
                            className={`${navLinkClasses} ${activeView === 'trading' ? activeLinkClasses : inactiveLinkClasses}`}
                            aria-current={activeView === 'trading' ? 'page' : undefined}
                        >
                            <ChartIcon className="w-4 h-4" />
                            Trading
                        </button>
                        <button 
                             onClick={() => setActiveView('backtesting')}
                             className={`${navLinkClasses} ${activeView === 'backtesting' ? activeLinkClasses : inactiveLinkClasses}`}
                             aria-current={activeView === 'backtesting' ? 'page' : undefined}
                        >
                            <FlaskIcon className="w-4 h-4" />
                            Backtesting
                        </button>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${colorClasses[status.color]}`}>
                            <span className="relative flex h-2.5 w-2.5">
                                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${pingColor[status.color]} opacity-75`}></span>
                                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${dotColor[status.color]}`}></span>
                            </span>
                            {status.text}
                        </div>
                        <button onClick={toggleTheme} className="p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" aria-label="Toggle theme">
                            {theme === 'light' ? <MoonIcon className="w-5 h-5" /> : <SunIcon className="w-5 h-5" />}
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
};