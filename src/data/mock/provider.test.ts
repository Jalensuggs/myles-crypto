import { describe, expect, it } from "vitest";
import { isValidCandle } from "@/data/candles";
import { perp } from "@/types/market";
import { MockProvider, mockPrice } from "./provider";

const NOW = 1_800_000_000_000;
const provider = () => new MockProvider(() => NOW);

describe("MockProvider", () => {
  it("返回请求数量的合法 K 线，时间严格递增", async () => {
    const page = await provider().getCandles({ market: perp("BTCUSDT"), timeframe: "15m", limit: 300 });
    expect(page.candles).toHaveLength(300);
    expect(page.candles.every(isValidCandle)).toBe(true);
    for (let i = 1; i < page.candles.length; i++) {
      expect(page.candles[i]!.time - page.candles[i - 1]!.time).toBe(900);
    }
  });

  it("相邻两页首尾相接，没有重叠也没有缺口", async () => {
    const p = provider();
    const market = perp("ETHUSDT");
    const latest = await p.getCandles({ market, timeframe: "1h", limit: 100 });
    const first = latest.candles[0]!;
    const older = await p.getCandles({ market, timeframe: "1h", limit: 100, endTime: first.time * 1000 - 1 });
    const lastOlder = older.candles[older.candles.length - 1]!;
    expect(first.time - lastOlder.time).toBe(3600);
    expect(lastOlder.close).toBeCloseTo(first.open, 8);
  });

  it("同样的参数总是得到同样的数据", async () => {
    const a = await provider().getCandles({ market: perp("SOLUSDT"), timeframe: "1d", limit: 50 });
    const b = await provider().getCandles({ market: perp("SOLUSDT"), timeframe: "1d", limit: 50 });
    expect(a).toEqual(b);
  });

  it("最新一根 K 线的收盘价等于当前模拟价格", async () => {
    const page = await provider().getCandles({ market: perp("BTCUSDT"), timeframe: "1m", limit: 10 });
    expect(page.candles[page.candles.length - 1]!.close).toBeCloseTo(mockPrice("BTCUSDT", NOW / 1000), 6);
  });

  it("标的列表按成交额降序", async () => {
    const list = await provider().getSymbols("perp");
    expect(list.length).toBeGreaterThan(8);
    expect(list[0]!.symbol).toBe("BTCUSDT");
    for (let i = 1; i < list.length; i++) expect(list[i]!.quoteVolume).toBeLessThanOrEqual(list[i - 1]!.quoteVolume);
  });

  it("合约列表里有美股和商品，现货列表里只有加密货币", async () => {
    const perps = await provider().getSymbols("perp");
    expect(perps.find((s) => s.symbol === "AAPLUSDT")?.category).toBe("stock");
    expect(perps.find((s) => s.symbol === "XAUUSDT")?.category).toBe("commodity");
    expect(perps.every((s) => s.market === "perp")).toBe(true);
    const spots = await provider().getSymbols("spot");
    expect(spots.length).toBeGreaterThan(5);
    expect(spots.every((s) => s.category === "crypto" && s.market === "spot")).toBe(true);
  });
});
