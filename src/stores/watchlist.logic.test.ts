import { describe, expect, it } from "vitest";
import { perp, spot, type MarketRef } from "@/types/market";
import {
  DEFAULT_WATCHLIST,
  MAX_WATCHLIST,
  isWatched,
  toggleWatch,
  watchlistRecordSchema,
} from "./watchlist.logic";

describe("自选", () => {
  it("默认自选里有比特币现货、加密合约、美股和黄金，且没有重复", () => {
    expect(isWatched(DEFAULT_WATCHLIST, spot("BTCUSDT"))).toBe(true);
    expect(isWatched(DEFAULT_WATCHLIST, perp("AAPLUSDT", "stock"))).toBe(true);
    expect(isWatched(DEFAULT_WATCHLIST, perp("XAUUSDT", "commodity"))).toBe(true);
    const keys = DEFAULT_WATCHLIST.map((m) => `${m.market}:${m.symbol}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(watchlistRecordSchema.safeParse({ items: DEFAULT_WATCHLIST }).success).toBe(true);
  });

  it("不在自选里就加到末尾", () => {
    const r = toggleWatch([spot("BTCUSDT")], perp("MSFTUSDT", "stock"));
    expect(r.change).toBe("added");
    expect(r.items).toEqual([spot("BTCUSDT"), perp("MSFTUSDT", "stock")]);
  });

  it("已在自选里就移除", () => {
    const r = toggleWatch([spot("BTCUSDT"), perp("ETHUSDT")], perp("ETHUSDT"));
    expect(r.change).toBe("removed");
    expect(r.items).toEqual([spot("BTCUSDT")]);
  });

  it("同名的现货和合约是两个不同的自选", () => {
    const items = [spot("BTCUSDT")];
    expect(isWatched(items, perp("BTCUSDT"))).toBe(false);
    expect(toggleWatch(items, perp("BTCUSDT")).items).toHaveLength(2);
  });

  it("是否带分类不影响判断是不是同一个标的", () => {
    const withCategory = perp("AAPLUSDT", "stock");
    const without: MarketRef = { exchange: "binance", market: "perp", symbol: "AAPLUSDT" };
    expect(isWatched([withCategory], without)).toBe(true);
    expect(toggleWatch([withCategory], without).change).toBe("removed");
  });

  it("满了之后不能再加，但仍然可以移除", () => {
    const full = Array.from({ length: MAX_WATCHLIST }, (_, i) => perp(`COIN${i}USDT`));
    const r = toggleWatch(full, perp("EXTRAUSDT"));
    expect(r.change).toBe("full");
    expect(r.items).toHaveLength(MAX_WATCHLIST);
    expect(toggleWatch(full, full[0]!).change).toBe("removed");
  });

  it("不修改传入的数组", () => {
    const items = [spot("BTCUSDT")];
    toggleWatch(items, perp("ETHUSDT"));
    toggleWatch(items, spot("BTCUSDT"));
    expect(items).toEqual([spot("BTCUSDT")]);
  });

  it("拒绝超过上限或标的非法的记录", () => {
    const tooMany = Array.from({ length: MAX_WATCHLIST + 1 }, (_, i) => perp(`COIN${i}USDT`));
    expect(watchlistRecordSchema.safeParse({ items: tooMany }).success).toBe(false);
    expect(watchlistRecordSchema.safeParse({ items: [{ exchange: "binance", market: "perp", symbol: "aapl" }] }).success).toBe(false);
    expect(watchlistRecordSchema.safeParse({ items: [] }).success).toBe(true);
  });
});
