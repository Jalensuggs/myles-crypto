import { z } from "zod";
import { marketKey, perp, spot, type MarketRef } from "@/types/market";
import { marketRefSchema } from "./workspace.logic";

export const MAX_WATCHLIST = 30;

export const watchlistRecordSchema = z.object({
  items: z.array(marketRefSchema).max(MAX_WATCHLIST),
});

export const DEFAULT_WATCHLIST: MarketRef[] = [
  spot("BTCUSDT"),
  perp("ETHUSDT"),
  perp("SOLUSDT"),
  perp("BNBUSDT"),
  perp("XRPUSDT"),
  perp("DOGEUSDT"),
  perp("AAPLUSDT", "stock"),
  perp("NVDAUSDT", "stock"),
  perp("TSLAUSDT", "stock"),
  perp("QQQUSDT", "stock"),
  perp("XAUUSDT", "commodity"),
];

export function isWatched(items: readonly MarketRef[], market: MarketRef): boolean {
  const key = marketKey(market);
  return items.some((m) => marketKey(m) === key);
}

export type ToggleResult = { items: MarketRef[]; change: "added" | "removed" | "full" };

/** 已在自选里就移除，不在就加到末尾；满了则不变 */
export function toggleWatch(items: readonly MarketRef[], market: MarketRef): ToggleResult {
  const key = marketKey(market);
  if (items.some((m) => marketKey(m) === key)) {
    return { items: items.filter((m) => marketKey(m) !== key), change: "removed" };
  }
  if (items.length >= MAX_WATCHLIST) return { items: [...items], change: "full" };
  return { items: [...items, market], change: "added" };
}
