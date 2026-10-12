import type { CandleQuery, FearGreed, MarketDataProvider, Unsubscribe } from "@/data/provider";
import { StreamConnection } from "@/data/realtime/stream-connection";
import { fetchStockHistory, fetchStockRecentDays } from "@/data/stock/yahoo";
import { useConnectionStore } from "@/stores/connection.store";
import type {
  AssetCategory,
  Candle,
  CandlePage,
  Derivatives,
  Liquidation,
  MarketKind,
  MarketRef,
  OpenInterestPoint,
  SymbolInfo,
  Ticker,
  Timeframe,
  Trade,
} from "@/types/market";
import {
  FEAR_GREED_URL,
  exchangeInfoUrl,
  klinesUrl,
  openInterestHistUrl,
  openInterestUrl,
  streams,
  ticker24hUrl,
  wsUrl,
} from "./endpoints";
import {
  parseContractCategories,
  parseKlines,
  parseOpenInterestHistory,
  parseSymbols,
  parseTickerSnapshot,
  parseWsDerivatives,
  parseWsKline,
  parseWsLiquidation,
  parseWsTicker,
  parseWsTrade,
} from "./parse";
import { fearGreedSchema, openInterestSchema } from "./schemas";

const REQUEST_TIMEOUT_MS = 12_000;
const CATEGORY_TTL_MS = 60 * 60_000;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function describeError(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 429 || error.status === 418) return "请求过于频繁，请稍后再试";
    if (error.status === 451 || error.status === 403) return "当前网络无法访问 Binance";
    if (error.status === 400) return "该标的不存在或已下架";
    if (error.status >= 500) return "行情服务暂时不可用";
    return `请求失败（${error.status}）`;
  }
  if (error instanceof DOMException && error.name === "TimeoutError") return "请求超时";
  if (error instanceof TypeError) return "网络连接失败";
  if (error instanceof Error && error.name === "ZodError") return "行情数据格式异常";
  return "加载失败";
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const res = await fetch(url, { signal: combined });
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`);
  return res.json();
}

export class BinanceProvider implements MarketDataProvider {
  readonly isMock = false;
  private readonly connections: Partial<Record<MarketKind, StreamConnection>> = {};
  private categories: { at: number; value: Promise<Map<string, AssetCategory>> } | null = null;

  /** 合约的资产分类变化很慢，一小时取一次 */
  private contractCategories(): Promise<Map<string, AssetCategory>> {
    const now = Date.now();
    if (!this.categories || now - this.categories.at > CATEGORY_TTL_MS) {
      const value = getJson(exchangeInfoUrl()).then(parseContractCategories);
      this.categories = { at: now, value };
      // 失败的结果不缓存，下次重新取
      value.catch(() => {
        if (this.categories?.value === value) this.categories = null;
      });
    }
    return this.categories.value;
  }

  private connection(market: MarketKind): StreamConnection {
    let conn = this.connections[market];
    if (!conn) {
      conn = new StreamConnection({
        url: wsUrl(market),
        onStatus: (status) => useConnectionStore.getState().setStatus(market, status),
      });
      this.connections[market] = conn;
    }
    return conn;
  }

  /** 浏览器恢复联网时调用，跳过退避等待 */
  retryNow(): void {
    for (const conn of Object.values(this.connections)) conn?.retryNow();
  }

  async getCandles(query: CandleQuery, signal?: AbortSignal): Promise<CandlePage> {
    const json = await getJson(
      klinesUrl({
        market: query.market.market,
        symbol: query.market.symbol,
        timeframe: query.timeframe,
        endTime: query.endTime,
        limit: query.limit,
      }),
      signal,
    );
    return parseKlines(json);
  }

  async getSymbols(market: MarketKind, signal?: AbortSignal): Promise<SymbolInfo[]> {
    if (market === "spot") return parseSymbols(await getJson(ticker24hUrl("spot"), signal), "spot");
    const [tickers, categories] = await Promise.all([
      getJson(ticker24hUrl("perp"), signal),
      // 分类取不到时仍然给出列表，只是全部归为加密货币
      this.contractCategories().catch(() => undefined),
    ]);
    return parseSymbols(tickers, "perp", categories);
  }

  async getOpenInterest(symbol: string, signal?: AbortSignal): Promise<number> {
    const data = openInterestSchema.parse(await getJson(openInterestUrl(symbol), signal));
    return Number(data.openInterest);
  }

  async getOpenInterestHistory(
    symbol: string,
    timeframe: Timeframe,
    signal?: AbortSignal,
  ): Promise<OpenInterestPoint[] | null> {
    const url = openInterestHistUrl(symbol, timeframe);
    if (!url) return null;
    return parseOpenInterestHistory(await getJson(url, signal));
  }

  subscribeTrades(market: MarketRef, handler: (trade: Trade) => void): Unsubscribe {
    return this.connection(market.market).subscribe(streams.aggTrade(market.symbol), (data) => {
      const parsed = parseWsTrade(data);
      if (parsed) handler(parsed);
    });
  }

  getStockHistory(symbol: string, timeframe: Timeframe, signal?: AbortSignal): Promise<Candle[] | null> {
    return fetchStockHistory(symbol, timeframe, signal);
  }

  getStockRecentDays(symbol: string, signal?: AbortSignal): Promise<Candle[] | null> {
    return fetchStockRecentDays(symbol, signal);
  }

  async getFearGreed(signal?: AbortSignal): Promise<FearGreed> {
    const data = fearGreedSchema.parse(await getJson(FEAR_GREED_URL, signal));
    const first = data.data[0]!;
    return { value: Number(first.value), label: first.value_classification };
  }

  subscribeCandles(
    market: MarketRef,
    timeframe: Timeframe,
    handler: (candle: Candle, closed: boolean) => void,
  ): Unsubscribe {
    return this.connection(market.market).subscribe(streams.kline(market.symbol, timeframe), (data) => {
      const parsed = parseWsKline(data);
      if (parsed) handler(parsed.candle, parsed.closed);
    });
  }

  subscribeTicker(market: MarketRef, handler: (ticker: Ticker) => void): Unsubscribe {
    let live = false;
    let active = true;
    const off = this.connection(market.market).subscribe(streams.miniTicker(market.symbol), (data) => {
      const parsed = parseWsTicker(data);
      if (!parsed) return;
      live = true;
      handler(parsed);
    });
    // 实时流只在价格变动时推送，成交清淡的标的可能很久没有第一条消息，
    // 所以先用 HTTP 取一次快照垫底。实时数据先到的话就不用快照了。
    getJson(ticker24hUrl(market.market, undefined, market.symbol))
      .then((json) => {
        if (active && !live) handler(parseTickerSnapshot(json));
      })
      .catch(() => {
        // 快照取不到不影响实时流
      });
    return () => {
      active = false;
      off();
    };
  }

  subscribeDerivatives(symbol: string, handler: (data: Derivatives) => void): Unsubscribe {
    return this.connection("perp").subscribe(streams.markPrice(symbol), (data) => {
      const parsed = parseWsDerivatives(data);
      if (parsed) handler(parsed);
    });
  }

  subscribeLiquidations(symbol: string, handler: (liq: Liquidation) => void): Unsubscribe {
    const wanted = symbol.toUpperCase();
    return this.connection("perp").subscribe(streams.allForceOrders, (data) => {
      const parsed = parseWsLiquidation(data);
      if (parsed && parsed.symbol === wanted) handler(parsed);
    });
  }

  onReconnect(market: MarketKind, listener: () => void): Unsubscribe {
    return this.connection(market).onReconnect(listener);
  }
}
