interface ImportMetaEnv {
  readonly VITE_BINANCE_API_KEY: string;
  readonly VITE_BINANCE_API_SECRET: string;
  readonly VITE_TELEGRAM_BOT_TOKEN: string;
  readonly VITE_TELEGRAM_CHAT_ID: string;
  readonly VITE_TELEGRAM_BOT_TOKEN_2: string;
  readonly VITE_TELEGRAM_CHAT_ID_2: string;
  readonly VITE_TELEGRAM_BOT_TOKEN_3: string;
  readonly VITE_TELEGRAM_CHAT_ID_3: string;

  // Manually define Vite's built-in env variables to fix type errors
  readonly MODE: string;
  readonly BASE_URL: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}