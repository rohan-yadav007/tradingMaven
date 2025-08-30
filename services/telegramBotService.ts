import { BotConfig, TradingMode, RiskMode } from '../types';
import { historyService } from './historyService';
import * as constants from '../constants';
import * as binanceService from './binanceService';

const bots = [
    { token: import.meta.env.VITE_TELEGRAM_BOT_TOKEN, chatId: import.meta.env.VITE_TELEGRAM_CHAT_ID },
    { token: import.meta.env.VITE_TELEGRAM_BOT_TOKEN_2, chatId: import.meta.env.VITE_TELEGRAM_CHAT_ID_2 },
    { token: import.meta.env.VITE_TELEGRAM_BOT_TOKEN_3, chatId: import.meta.env.VITE_TELEGRAM_CHAT_ID_3 },
].filter(bot => bot.token && bot.chatId);

const lastUpdateIds = new Map<string, number>();
let isStarted = false; // Guard to prevent multiple initializations

let _botManagerService: any;


/**
 * Sends a message via Telegram. Can broadcast to all bots or send to a specific one.
 * @param text The message content (Markdown formatted).
 * @param specificChatId If provided, sends the message only to this chat ID. Otherwise, broadcasts to all.
 */
async function sendMessage(text: string, specificChatId?: string) {
    const targets = specificChatId 
        ? bots.filter(b => b.chatId === specificChatId)
        : bots;

    if (targets.length === 0) {
        if(specificChatId) console.error(`Telegram: No bot configured for chat ID ${specificChatId}`);
        return;
    }

    for (const bot of bots) {
        try {
            await fetch(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: bot.chatId, text, parse_mode: 'Markdown' }),
            });
        } catch (error) {
            console.error(`Telegram: Failed to send message with bot ${bot.token.substring(0,10)}...:`, error);
        }
    }
}


async function handleCommand(command: string, args: string[], chatId: string) {
    if (!_botManagerService) {
        await sendMessage("Bot manager is not available. Please wait a moment and try again.", chatId);
        return;
    }

    switch (command) {
        case '/help':
        case '/start':
            await sendMessage(
`*Binni Trading Assistant Commands*

*/status* - View all running bots.
*/agents* - List available trading agents.
*/create* \`agent_id pair amount leverage mode [platform]\`
  • \`mode\`: paper | live
  • \`platform\`: spot | futures (optional, defaults to futures)
  _Ex (Futures): /create 9 SOL/USDT 50 20x live futures_
  _Ex (Spot): /create 7 BTC/USDT 500 1x paper spot_
*/pause* \`bot_id\` - Pause a running bot.
*/resume* \`bot_id\` - Resume a paused bot.
*/stop* \`bot_id\` - Stop a bot (can't be resumed).
*/delete* \`bot_id\` - Delete a stopped bot.
*/pnl_today* - See today's net PNL.
*/pnl_week* - See last 7 days' net PNL.`,
                chatId
            );
            break;

        case '/status':
            const runningBots = _botManagerService.getRunningBots();
            if (runningBots.length === 0) {
                await sendMessage("No bots are currently running.", chatId);
                return;
            }
            const statusText = runningBots.map((bot: any) => {
                const winRate = bot.closedTradesCount > 0 ? (bot.wins / bot.closedTradesCount) * 100 : 0;
                let pnlText = `Total PNL: *$${bot.totalPnl.toFixed(2)}*`;
                if (bot.openPosition && bot.livePrice) {
                    const isLong = bot.openPosition.direction === 'LONG';
                    const unrealizedPnl = (bot.livePrice - bot.openPosition.entryPrice) * bot.openPosition.size * (isLong ? 1 : -1);
                    pnlText += ` (Unrealized: $${unrealizedPnl.toFixed(2)})`;
                }
                return `*${bot.config.pair}* (${bot.config.agent.name}) - \`${bot.config.executionMode.toUpperCase()}\`
Status: _${bot.status}_
${pnlText}
Trades: ${bot.wins}W / ${bot.losses}L (${winRate.toFixed(1)}% WR)
ID: \`${bot.id}\``;
            }).join('\n\n');
            await sendMessage(statusText, chatId);
            break;

        case '/agents':
            const agentsList = constants.AGENTS.map(agent => `*${agent.name}*\nID: \`${agent.id}\``).join('\n\n');
            await sendMessage(`*Available Trading Agents*\n\n${agentsList}`, chatId);
            break;
            
        case '/create':
            try {
                if (args.length < 5) {
                    await sendMessage("Invalid format. Use: `/create agent_id pair amount leverage mode [platform]`\n_Ex: /create 9 SOL/USDT 50 20x paper futures_", chatId);
                    return;
                }
                const [agentIdStr, pair, amountStr, leverageStr, modeStr, platformStr] = args;
                const agentId = parseInt(agentIdStr);
                const agent = constants.AGENTS.find(a => a.id === agentId);
                if (!agent) {
                    await sendMessage(`Error: Agent with ID ${agentId} not found. Use /agents to see available agents.`, chatId);
                    return;
                }
                const investmentAmount = parseFloat(amountStr);
                const leverage = parseInt(leverageStr.replace('x', ''));
                if (isNaN(investmentAmount) || isNaN(leverage) || investmentAmount <= 0 || leverage <= 0) {
                    await sendMessage("Error: Invalid investment amount or leverage.", chatId);
                    return;
                }

                const executionMode = modeStr.toLowerCase();
                if (executionMode !== 'paper' && executionMode !== 'live') {
                    await sendMessage("Error: Invalid mode. Use 'paper' or 'live'.", chatId);
                    return;
                }

                const tradingMode = (platformStr || 'futures').toLowerCase();
                let finalTradingMode: TradingMode;
                if (tradingMode === 'futures') {
                    finalTradingMode = TradingMode.USDSM_Futures;
                } else if (tradingMode === 'spot') {
                    finalTradingMode = TradingMode.Spot;
                } else {
                    await sendMessage("Error: Invalid platform. Use 'spot' or 'futures'.", chatId);
                    return;
                }
                
                await sendMessage(`_Creating ${executionMode} ${finalTradingMode} bot for ${pair}..._`, chatId);

                const formattedPair = pair.replace('/', '');
                 const symbolInfo = finalTradingMode === TradingMode.USDSM_Futures 
                    ? await binanceService.getFuturesSymbolInfo(formattedPair) 
                    : await binanceService.getSymbolInfo(formattedPair);

                 if (!symbolInfo) {
                    await sendMessage(`Error: Could not find symbol info for ${pair} on the ${finalTradingMode} platform.`, chatId);
                    return;
                }

                const config: BotConfig = {
                    pair,
                    agent,
                    investmentAmount,
                    leverage: finalTradingMode === TradingMode.Spot ? 1 : leverage,
                    mode: finalTradingMode,
                    executionMode: executionMode as 'paper' | 'live',
                    timeFrame: '5m', // Default
                    maxMarginLossPercent: constants.MAX_MARGIN_LOSS_PERCENT,
                    isHtfConfirmationEnabled: false,
                    isUniversalProfitTrailEnabled: true,
                    isMinRrEnabled: true,
                    isInvalidationCheckEnabled: true,
                    isReanalysisEnabled: true,
                    // FIX: Add missing properties to satisfy BotConfig type.
                    isAgentTrailEnabled: true,
                    isBreakevenTrailEnabled: true,
                    pricePrecision: binanceService.getPricePrecision(symbolInfo),
                    quantityPrecision: binanceService.getQuantityPrecision(symbolInfo),
                    stepSize: binanceService.getStepSize(symbolInfo),
                    takerFeeRate: constants.TAKER_FEE_RATE,
                    entryTiming: 'onNextCandle',
                    // Default legacy TP properties
                    takeProfitMode: RiskMode.Percent,
                    takeProfitValue: 0,
                    isTakeProfitLocked: false,
                };
                
                const newBot = _botManagerService.startBot(config);
                await sendMessage(`*${executionMode.toUpperCase()} bot created successfully!*
Pair: ${pair} (${finalTradingMode})
Agent: ${agent.name}
ID: \`${newBot.id}\``, chatId);

            } catch (error) {
                await sendMessage(`Failed to create bot: ${error instanceof Error ? error.message : 'Unknown error'}`, chatId);
            }
            break;

        case '/pause':
        case '/resume':
        case '/stop':
        case '/delete':
             if (args.length === 0) {
                await sendMessage(`Please provide a bot ID. Use /status to see IDs.`, chatId);
                return;
            }
            const botId = args[0];
            const botInstance = _botManagerService.getBot(botId);
            if (!botInstance) {
                await sendMessage(`Error: Bot with ID \`${botId}\` not found.`, chatId);
                return;
            }
            
            let actionText = '';
            switch(command) {
                case '/pause': _botManagerService.pauseBot(botId); actionText = 'paused'; break;
                case '/resume': _botManagerService.resumeBot(botId); actionText = 'resumed'; break;
                case '/stop': _botManagerService.stopBot(botId); actionText = 'stopped'; break;
                case '/delete': _botManagerService.deleteBot(botId); actionText = 'deleted'; break;
            }
            await sendMessage(`Bot \`${botId}\` has been ${actionText}.`, chatId);
            break;

        case '/pnl_today':
        case '/pnl_week':
            const trades = historyService.loadTrades();
            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            
            const relevantTrades = trades.filter(trade => {
                const exitTime = new Date(trade.exitTime);
                return command === '/pnl_today' ? exitTime >= startOfToday : exitTime >= sevenDaysAgo;
            });

            if (relevantTrades.length === 0) {
                await sendMessage(`No trades closed in the period.`, chatId);
                return;
            }

            const totalPnl = relevantTrades.reduce((acc, trade) => acc + trade.pnl, 0);
            const wins = relevantTrades.filter(t => t.pnl > 0).length;
            const losses = relevantTrades.filter(t => t.pnl < 0).length;
            
            await sendMessage(
`*PNL Report (${command === '/pnl_today' ? 'Today' : 'Last 7 Days'})*
Net PNL: *$${totalPnl.toFixed(2)}*
Total Trades: ${relevantTrades.length}
Wins: ${wins} | Losses: ${losses}`,
                chatId
            );
            break;

        default:
            await sendMessage("Unknown command. Use /help to see available commands.", chatId);
            break;
    }
}

async function longPoll(bot: { token: string; chatId: string; }) {
    if (!isStarted) return;
    const currentUpdateId = lastUpdateIds.get(bot.token) || 0;

    try {
        const response = await fetch(`https://api.telegram.org/bot${bot.token}/getUpdates?offset=${currentUpdateId + 1}&timeout=30`);
        const data = await response.json();

        if (data.ok && data.result.length > 0) {
            let maxUpdateId = currentUpdateId;
            for (const update of data.result) {
                maxUpdateId = Math.max(maxUpdateId, update.update_id);
                const message = update.message;

                if (message && message.text && message.chat.id.toString() === bot.chatId) {
                    try {
                        const [command, ...args] = message.text.split(' ');
                        await handleCommand(command.toLowerCase(), args, message.chat.id.toString());
                    } catch (e) {
                        console.error(`Telegram: Error handling command "${message.text}":`, e);
                        await sendMessage(`An internal error occurred while processing your command: \`${message.text}\`. The issue has been logged.`, message.chat.id.toString());
                    }
                }
            }
            lastUpdateIds.set(bot.token, maxUpdateId);
        } else if (!data.ok && data.error_code === 409) {
            // This is the conflict error. Stop polling from this instance.
            console.warn(`[Telegram Bot ${bot.token.substring(0,10)}...] 409 Conflict: Terminated by another getUpdates request. This instance will stop polling.`);
            isStarted = false; // Stop this instance's loop
            return;
        }
    } catch (error) {
        console.error(`Telegram: Long poll error for bot ${bot.token.substring(0,10)}...:`, error);
        await new Promise(resolve => setTimeout(resolve, 5000));
    } finally {
        if (isStarted) {
            setTimeout(() => longPoll(bot), 1000);
        }
    }
}


function start() {
    if (isStarted) return; 

    if (bots.length > 0) {
        isStarted = true;
        console.log(`Telegram bot service starting with ${bots.length} bot(s)...`);
        sendMessage("Trading Assistant is online. Use /help for commands.");
        
        for (const bot of bots) {
            lastUpdateIds.set(bot.token, 0);
            longPoll(bot);
            console.log(`- Listening for commands on bot with chat ID: ${bot.chatId}`);
        }
    } else {
        console.warn("Telegram bot credentials not found in environment variables. Service will not start.");
    }
}

export const telegramBotService = {
    start,
    sendMessage,
    register(instance: any) {
        _botManagerService = instance;
    },
};