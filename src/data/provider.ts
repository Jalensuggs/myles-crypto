import type {
  Candle,
  CandlePage,
  Derivatives,
  Liquidation,
  MarketKind,
  MarketRef,
  SymbolInfo,
  Ticker,
  Timeframe,
} from "@/types/market";

export interface CandleQuery {
  market: MarketRef;
  timeframe: Timeframe;
  /** Unix 毫秒，只返回开盘时间不晚于它的 K 线；省略表示最新一页 */
  endTime?: number;
  limit?: number;
}

export interface FearGreed {
  value: number;
  label: string;
}

export type Unsubscribe = () => void;

/**
 * 应用访问行情的唯一入口。界面和 store 只依赖这个接口，
 * 不知道背后是 Binance 还是模拟数据。
 */
export interface MarketDataProvider {
  readonly isMock: boolean;

  getCandles(query: CandleQuery, signal?: AbortSignal): Promise<CandlePage>;
  getSymbols(market: MarketKind, signal?: AbortSignal): Promise<SymbolInfo[]>;
  /** 持仓量，单位为标的币数量 */
  getOpenInterest(symbol: string, signal?: AbortSignal): Promise<number>;
  getFearGreed(signal?: AbortSignal): Promise<FearGreed>;
  /**
   * 美股的官方历史 K 线（只含常规交易时段，已按图表周期整理好）。
   * 没有这项数据或取不到时返回 null，调用方退回合约数据。
   */
  getStockHistory(symbol: string, timeframe: Timeframe, signal?: AbortSignal): Promise<Candle[] | null>;
  /** 美股最近若干个交易日的真实日线（不复权），用来算相对收盘价的涨跌幅；取不到时返回 null */
  getStockRecentDays(symbol: string, signal?: AbortSignal): Promise<Candle[] | null>;

  subscribeCandles(
    market: MarketRef,
    timeframe: Timeframe,
    handler: (candle: Candle, closed: boolean) => void,
  ): Unsubscribe;
  subscribeTicker(market: MarketRef, handler: (ticker: Ticker) => void): Unsubscribe;
  subscribeDerivatives(symbol: string, handler: (data: Derivatives) => void): Unsubscribe;
  subscribeLiquidations(symbol: string, handler: (liq: Liquidation) => void): Unsubscribe;

  /** 实时连接断线重连成功后触发，用来补拉断线期间的数据 */
  onReconnect(market: MarketKind, listener: () => void): Unsubscribe;
}
