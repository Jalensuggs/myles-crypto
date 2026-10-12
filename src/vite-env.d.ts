/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCK_DATA?: string;
  readonly VITE_BINANCE_FUTURES_REST?: string;
  readonly VITE_BINANCE_SPOT_REST?: string;
  readonly VITE_BINANCE_FUTURES_WS?: string;
  readonly VITE_BINANCE_SPOT_WS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
