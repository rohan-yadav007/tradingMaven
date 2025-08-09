interface ImportMetaEnv {
  readonly VITE_BINANCE_API_KEY: string;
  readonly VITE_BINANCE_API_SECRET: string;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}