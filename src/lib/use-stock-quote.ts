import { stockQuote, type StockQuote } from "@/features/session/stock-quote";
import { useTickersStore } from "@/stores/tickers.store";
import { categoryOf, marketKey, type MarketRef } from "@/types/market";

/**
 * 美股按"相对收盘价"口径算出的涨跌幅；不是美股或官方数据还没取到时返回 null，
 * 调用方此时继续用合约自带的 24 小时涨跌幅。
 * 组件会随行情推送不断重渲染，所以这里直接取当前时间，不另外计时。
 */
export function useStockQuote(market: MarketRef): StockQuote | null {
  const isStock = market.market === "perp" && categoryOf(market) === "stock";
  const days = useTickersStore((s) => (isStock ? s.stockDays[market.symbol] : undefined));
  const last = useTickersStore((s) => (isStock ? s.tickers[marketKey(market)]?.last : undefined));
  if (!days || last === undefined) return null;
  return stockQuote(days, last, Date.now() / 1000);
}
