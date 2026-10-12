import type { MarketKind, Timeframe } from "@/types/market";

interface EndpointConfig {
  futuresRest: string;
  spotRest: string;
  futuresWs: string;
  spotWs: string;
}

const env: Record<string, string | undefined> =
  (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

const trim = (url: string) => url.replace(/\/+$/, "");

export const endpoints: EndpointConfig = {
  futuresRest: trim(env.VITE_BINANCE_FUTURES_REST || "https://fapi.binance.com"),
  spotRest: trim(env.VITE_BINANCE_SPOT_REST || "https://data-api.binance.vision"),
  // 旧地址 /stream 能连上但不再推送数据，必须使用 /market/stream
  futuresWs: env.VITE_BINANCE_FUTURES_WS || "wss://fstream.binance.com/market/stream",
  spotWs: env.VITE_BINANCE_SPOT_WS || "wss://data-stream.binance.vision/stream",
};

export const KLINE_PAGE_SIZE = 1000;

export interface KlineQuery {
  market: MarketKind;
  symbol: string;
  timeframe: Timeframe;
  /** Unix 毫秒，返回开盘时间不晚于它的 K 线 */
  endTime?: number;
  limit?: number;
}

export function klinesUrl(q: KlineQuery, cfg: EndpointConfig = endpoints): string {
  const base = q.market === "perp" ? `${cfg.futuresRest}/fapi/v1/klines` : `${cfg.spotRest}/api/v3/klines`;
  const params = new URLSearchParams({
    symbol: q.symbol.toUpperCase(),
    interval: q.timeframe,
    limit: String(q.limit ?? KLINE_PAGE_SIZE),
  });
  if (q.endTime !== undefined) params.set("endTime", String(Math.floor(q.endTime)));
  return `${base}?${params.toString()}`;
}

/** 不传 symbol 返回全市场，传了只返回这一个标的 */
export function ticker24hUrl(market: MarketKind, cfg: EndpointConfig = endpoints, symbol?: string): string {
  const base = market === "perp" ? `${cfg.futuresRest}/fapi/v1/ticker/24hr` : `${cfg.spotRest}/api/v3/ticker/24hr`;
  return symbol ? `${base}?symbol=${encodeURIComponent(symbol.toUpperCase())}` : base;
}

export function exchangeInfoUrl(cfg: EndpointConfig = endpoints): string {
  return `${cfg.futuresRest}/fapi/v1/exchangeInfo`;
}

export function openInterestUrl(symbol: string, cfg: EndpointConfig = endpoints): string {
  return `${cfg.futuresRest}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol.toUpperCase())}`;
}

/** 持仓量历史支持的统计周期；1 分钟、周线和月线没有 */
const OI_PERIODS: Partial<Record<Timeframe, string>> = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

export function supportsOpenInterestHistory(timeframe: Timeframe): boolean {
  return OI_PERIODS[timeframe] !== undefined;
}

/** 持仓量历史。交易所只保留最近 30 天，每次最多 500 个点。 */
export function openInterestHistUrl(symbol: string, timeframe: Timeframe, cfg: EndpointConfig = endpoints): string | null {
  const period = OI_PERIODS[timeframe];
  if (!period) return null;
  const params = new URLSearchParams({ symbol: symbol.toUpperCase(), period, limit: "500" });
  return `${cfg.futuresRest}/futures/data/openInterestHist?${params.toString()}`;
}

export function wsUrl(market: MarketKind, cfg: EndpointConfig = endpoints): string {
  return market === "perp" ? cfg.futuresWs : cfg.spotWs;
}

export const FEAR_GREED_URL = "https://api.alternative.me/fng/?limit=1";

export const streams = {
  kline: (symbol: string, timeframe: Timeframe) => `${symbol.toLowerCase()}@kline_${timeframe}`,
  miniTicker: (symbol: string) => `${symbol.toLowerCase()}@miniTicker`,
  aggTrade: (symbol: string) => `${symbol.toLowerCase()}@aggTrade`,
  markPrice: (symbol: string) => `${symbol.toLowerCase()}@markPrice@1s`,
  /** 全市场爆仓流。实测有稳定推送，按标的过滤在客户端完成，多个标的共用一个订阅 */
  allForceOrders: "!forceOrder@arr",
};
