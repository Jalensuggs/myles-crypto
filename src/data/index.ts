import { QueryClient } from "@tanstack/react-query";
import type { Candle, CandlePage, MarketRef, Timeframe } from "@/types/market";
import { marketKey } from "@/types/market";
import { BinanceProvider } from "./binance/provider";
import { MockProvider } from "./mock/provider";
import type { MarketDataProvider } from "./provider";

export const USE_MOCK = import.meta.env.VITE_USE_MOCK_DATA === "true";

export const provider: MarketDataProvider = USE_MOCK ? new MockProvider() : new BinanceProvider();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      retryDelay: 800,
      refetchOnWindowFocus: false,
      gcTime: 10 * 60_000,
    },
  },
});

if (typeof window !== "undefined" && provider instanceof BinanceProvider) {
  const live = provider;
  window.addEventListener("online", () => live.retryNow());
}

/**
 * 取一页 K 线。相同参数的并发请求会被合并成一次；
 * 历史页不会变化所以长期缓存，最新一页只缓存几秒。
 */
export function fetchCandlePage(
  market: MarketRef,
  timeframe: Timeframe,
  endTime?: number,
  options: { fresh?: boolean } = {},
): Promise<CandlePage> {
  const latest = endTime === undefined;
  return queryClient.fetchQuery({
    queryKey: ["candles", marketKey(market), timeframe, endTime ?? "latest"],
    queryFn: ({ signal }) => provider.getCandles({ market, timeframe, endTime }, signal),
    staleTime: options.fresh ? 0 : latest ? 3_000 : Infinity,
  });
}

/**
 * 美股的官方历史 K 线。取不到（接口失效、被限流、没有这只股票）时返回 null，不抛错：
 * 这项数据是锦上添花，没有它图表照样能用合约数据画出来。
 */
export function fetchOfficialHistory(symbol: string, timeframe: Timeframe): Promise<Candle[] | null> {
  return queryClient
    .fetchQuery({
      queryKey: ["stock-history", symbol, timeframe],
      queryFn: ({ signal }) => provider.getStockHistory(symbol, timeframe, signal),
      staleTime: 5 * 60_000,
      retry: 0,
    })
    .catch(() => null);
}
