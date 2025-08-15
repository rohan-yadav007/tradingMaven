
interface ImportMetaEnv {
  readonly VITE_BINANCE_API_KEY: string;
  readonly VITE_BINANCE_API_SECRET: string;
  readonly PROD: boolean;
  readonly VITE_TELEGRAM_BOT_TOKEN: string;
  readonly VITE_TELEGRAM_CHAT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}