export type MarketKind = "perp" | "spot";

export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
  // 月线每根的长度不固定，这里取 30 天，只用于估算（比如把画线延伸到未来）
  "1M": 2592000,
};

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "1m": "1分",
  "5m": "5分",
  "15m": "15分",
  "30m": "30分",
  "1h": "1时",
  "4h": "4时",
  "1d": "1日",
  "1w": "1周",
  "1M": "1月",
};

export const CHART_TYPES = ["candles", "bars", "line", "area"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  candles: "蜡烛图",
  bars: "美国线",
  line: "折线图",
  area: "面积图",
};

export const ASSET_CATEGORIES = ["crypto", "stock", "commodity", "other"] as const;
/** 标的背后的资产类型。美股、商品等在 Binance 上以永续合约的形式交易。 */
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export interface MarketRef {
  exchange: "binance";
  market: MarketKind;
  symbol: string;
  /** 省略时按加密货币处理 */
  category?: AssetCategory;
}

export interface Candle {
  /** 开盘时间，Unix 秒 */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandlePage {
  candles: Candle[];
  /** 价格小数位数 */
  precision: number;
}

export interface Ticker {
  last: number;
  open24h: number;
  high24h: number;
  low24h: number;
  quoteVolume24h: number;
  changePct: number;
}

export interface Derivatives {
  markPrice: number;
  fundingRate: number;
  /** Unix 毫秒 */
  nextFundingTime: number;
}

export interface Liquidation {
  symbol: string;
  /** long 表示多单被强平，short 表示空单被强平 */
  side: "long" | "short";
  price: number;
  quantity: number;
  notional: number;
  /** Unix 毫秒 */
  time: number;
}

export interface SymbolInfo {
  symbol: string;
  market: MarketKind;
  category: AssetCategory;
  last: number;
  changePct: number;
  quoteVolume: number;
}

export type EventKind = "liquidation" | "price-move" | "funding" | "range-break";
export type EventTone = "positive" | "negative" | "neutral" | "warning";

export interface MarketEvent {
  id: string;
  kind: EventKind;
  symbol: string;
  title: string;
  detail?: string;
  tone: EventTone;
  /** Unix 毫秒 */
  createdAt: number;
}

export interface MarketTab {
  id: string;
  market: MarketRef;
  timeframe: Timeframe;
  chartType: ChartType;
}

export function marketKey(m: MarketRef): string {
  return `${m.exchange}:${m.market}:${m.symbol}`;
}

export function categoryOf(m: MarketRef): AssetCategory {
  return m.category ?? "crypto";
}

/**
 * 界面上显示的名称。加密永续合约带 .P 后缀以区别于现货；
 * 美股、商品只显示代码本身，例如 AAPL、XAU。
 */
export function displayName(m: MarketRef): string {
  if (m.market === "spot") return m.symbol;
  return categoryOf(m) === "crypto" ? `${m.symbol}.P` : baseAsset(m.symbol);
}

const TYPE_LABELS: Record<AssetCategory, string> = {
  crypto: "永续",
  stock: "美股",
  commodity: "商品",
  other: "其他",
};

const LONG_TYPE_LABELS: Record<AssetCategory, string> = {
  crypto: "永续合约",
  stock: "美股合约",
  commodity: "商品合约",
  other: "其他合约",
};

/** 图表图例里用的完整说明 */
export function marketTypeLongLabel(m: MarketRef): string {
  return m.market === "spot" ? "现货" : LONG_TYPE_LABELS[categoryOf(m)];
}

/** 标的类型的短标签：现货、永续、美股、商品、其他 */
export function marketTypeLabel(m: MarketRef): string {
  return m.market === "spot" ? "现货" : TYPE_LABELS[categoryOf(m)];
}

const QUOTES = ["USDT", "USDC", "FDUSD", "TUSD", "BUSD", "BTC", "ETH", "BNB"];

export function baseAsset(symbol: string): string {
  for (const q of QUOTES) {
    if (symbol.length > q.length && symbol.endsWith(q)) return symbol.slice(0, -q.length);
  }
  return symbol;
}

export function perp(symbol: string, category?: AssetCategory): MarketRef {
  return category && category !== "crypto"
    ? { exchange: "binance", market: "perp", symbol, category }
    : { exchange: "binance", market: "perp", symbol };
}

export function spot(symbol: string): MarketRef {
  return { exchange: "binance", market: "spot", symbol };
}
