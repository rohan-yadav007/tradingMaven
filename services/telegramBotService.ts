
import { BotConfig, TradingMode, RiskMode } from '../types';
import { botManagerService } from './botManagerService';
import { historyService } from './historyService';
import * as constants from '../constants';
import * as binanceService from './binanceService';

const TOKEN = import.meta.env.VITE_TELEGRAM_BOT_TOKEN;
const CHAT_ID = import.meta.env.VITE_TELEGRAM_CHAT_ID;

const API_URL = `https://api.telegram.org/bot${TOKEN}`;

let lastUpdateId = 0;
let isStarted = false; // Guard to prevent multiple initializations

async function sendMessage(text: string) {
    if (!TOKEN || !CHAT_ID) return;
    try {
        await fetch(`${API_URL}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' }),
        });
    } catch (error) {
        console.error("Telegram: Failed to send message:", error);
    }
}

async function handleCommand(command: string, args: string[]) {
    switch (command) {
        case '/help':
        case '/start':
            await sendMessage(
`*Gemini Trading Assistant Commands*

*/status* - View all running bots.
*/create* \`agent_id pair amount leverage\`
  _Ex: /create 9 BTC/USDT 100 20x_
*/pause* \`bot_id\` - Pause a running bot.
*/resume* \`bot_id\` - Resume a paused bot.
*/stop* \`bot_id\` - Stop a bot (can't be resumed).
*/delete* \`bot_id\` - Delete a stopped bot.
*/pnl_today* - See today's net PNL.
*/pnl_week* - See last 7 days' net PNL.`
            );
            break;

        case '/status':
            const bots = botManagerService.getRunningBots();
            if (bots.length === 0) {
                await sendMessage("No bots are currently running.");
                return;
            }
            const statusText = bots.map(bot => {
                let pnlText = `PNL: $${bot.totalPnl.toFixed(2)}`;
                if (bot.openPosition && bot.livePrice) {
                    const isLong = bot.openPosition.direction === 'LONG';
                    const pnl = (bot.livePrice - bot.openPosition.entryPrice) * bot.openPosition.size * (isLong ? 1 : -1);
                    pnlText += ` (Unrealized: $${pnl.toFixed(2)})`;
                }
                return `*${bot.config.pair}* (${bot.config.agent.name})
Status: ${bot.status}
${pnlText}
ID: \`${bot.id}\``;
            }).join('\n\n');
            await sendMessage(statusText);
            break;
            
        case '/create':
            try {
                if (args.length < 4) {
                    await sendMessage("Invalid format. Use: `/create agent_id pair amount leverage`\n_Ex: /create 9 BTC/USDT 100 20x_");
                    return;
                }
                const [agentIdStr, pair, amountStr, leverageStr] = args;
                const agentId = parseInt(agentIdStr);
                const agent = constants.AGENTS.find(a => a.id === agentId);
                if (!agent) {
                    await sendMessage(`Error: Agent with ID ${agentId} not found.`);
                    return;
                }
                const investmentAmount = parseFloat(amountStr);
                const leverage = parseInt(leverageStr.replace('x', ''));
                if (isNaN(investmentAmount) || isNaN(leverage) || investmentAmount <= 0 || leverage <= 0) {
                    await sendMessage("Error: Invalid investment amount or leverage.");
                    return;
                }
                
                await sendMessage(`_Creating bot for ${pair}..._`);

                const formattedPair = pair.replace('/', '');
                const symbolInfo = await binanceService.getFuturesSymbolInfo(formattedPair);
                 if (!symbolInfo) {
                    await sendMessage(`Error: Could not find symbol info for ${pair}.`);
                    return;
                }

                const config: BotConfig = {
                    pair,
                    agent,
                    investmentAmount,
                    leverage,
                    mode: TradingMode.USDSM_Futures,
                    executionMode: 'paper',
                    timeFrame: '5m', // Default
                    takeProfitMode: RiskMode.Percent,
                    takeProfitValue: 5,
                    isTakeProfitLocked: false,
                    isCooldownEnabled: true,
                    isHtfConfirmationEnabled: false,
                    isAtrTrailingStopEnabled: true,
                    pricePrecision: binanceService.getPricePrecision(symbolInfo),
                    quantityPrecision: binanceService.getQuantityPrecision(symbolInfo),
                    stepSize: binanceService.getStepSize(symbolInfo),
                };
                
                const newBot = botManagerService.startBot(config);
                await sendMessage(`*Bot created successfully!*
Pair: ${pair}
Agent: ${agent.name}
ID: \`${newBot.id}\``);

            } catch (error) {
                await sendMessage(`Failed to create bot: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
            break;

        case '/pause':
        case '/resume':
        case '/stop':
        case '/delete':
             if (args.length === 0) {
                await sendMessage(`Please provide a bot ID. Use /status to see IDs.`);
                return;
            }
            const botId = args[0];
            const botInstance = botManagerService.getBot(botId);
            if (!botInstance) {
                await sendMessage(`Error: Bot with ID \`${botId}\` not found.`);
                return;
            }
            
            let actionText = '';
            switch(command) {
                case '/pause': botManagerService.pauseBot(botId); actionText = 'paused'; break;
                case '/resume': botManagerService.resumeBot(botId); actionText = 'resumed'; break;
                case '/stop': botManagerService.stopBot(botId); actionText = 'stopped'; break;
                case '/delete': botManagerService.deleteBot(botId); actionText = 'deleted'; break;
            }
            await sendMessage(`Bot \`${botId}\` has been ${actionText}.`);
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
                await sendMessage(`No trades closed in the period.`);
                return;
            }

            const totalPnl = relevantTrades.reduce((acc, trade) => acc + trade.pnl, 0);
            const wins = relevantTrades.filter(t => t.pnl > 0).length;
            const losses = relevantTrades.filter(t => t.pnl < 0).length;
            
            await sendMessage(
`*PNL Report (${command === '/pnl_today' ? 'Today' : 'Last 7 Days'})*
Net PNL: *$${totalPnl.toFixed(2)}*
Total Trades: ${relevantTrades.length}
Wins: ${wins} | Losses: ${losses}`
            );
            break;

        default:
            await sendMessage("Unknown command. Use /help to see available commands.");
            break;
    }
}

async function longPoll() {
    if (!isStarted || !TOKEN || !CHAT_ID) return;
    try {
        const response = await fetch(`${API_URL}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
        const data = await response.json();

        if (data.ok && data.result.length > 0) {
            for (const update of data.result) {
                lastUpdateId = update.update_id;
                const message = update.message;

                if (message && message.text && message.chat.id.toString() === CHAT_ID) {
                    const [command, ...args] = message.text.split(' ');
                    await handleCommand(command.toLowerCase(), args);
                }
            }
        }
    } catch (error) {
        console.error("Telegram: Long poll error:", error);
        await new Promise(resolve => setTimeout(resolve, 5000));
    } finally {
        if (isStarted) {
            setTimeout(longPoll, 1000);
        }
    }
}

function start() {
    if (isStarted) return; // Prevent multiple initializations

    if (TOKEN && CHAT_ID) {
        isStarted = true;
        console.log("Telegram bot service starting...");
        sendMessage("Trading Assistant is online. Use /help for commands.");
        longPoll();
    } else {
        console.warn("Telegram bot credentials not found in environment variables. Service will not start.");
    }
}

export const telegramBotService = {
    start,
};
