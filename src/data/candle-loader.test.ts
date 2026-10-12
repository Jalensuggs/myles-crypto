import { describe, expect, it } from "vitest";
import type { Candle, CandlePage } from "@/types/market";
import { loadLatest, loadOlder, type PageFetcher } from "./candle-loader";

const STEP = 60;
const PAGE = 10;

const candle = (time: number): Candle => ({ time, open: 1, high: 2, low: 1, close: 1.5, volume: 1 });

/** 模拟一个从 firstTime 到 lastTime、每分钟一根的数据源 */
function source(firstTime: number, lastTime: number) {
  const calls: (number | undefined)[] = [];
  const fetchPage: PageFetcher = async (endTimeMs) => {
    calls.push(endTimeMs);
    const end = endTimeMs === undefined ? lastTime : Math.min(lastTime, Math.floor(endTimeMs / 1000 / STEP) * STEP);
    const candles: Candle[] = [];
    for (let t = end - (PAGE - 1) * STEP; t <= end; t += STEP) if (t >= firstTime) candles.push(candle(t));
    return { candles, precision: 2 } satisfies CandlePage;
  };
  return { fetchPage, calls };
}

const base = { pageSize: PAGE, minBars: 6, maxPages: 5 };

describe("loadLatest", () => {
  it("没有过滤条件时只取一页", async () => {
    const { fetchPage, calls } = source(0, 6000);
    const r = await loadLatest(fetchPage, base);
    expect(calls).toEqual([undefined]);
    expect(r.candles).toHaveLength(10);
    expect(r.candles[9]!.time).toBe(6000);
    expect(r.oldestRaw).toBe(6000 - 9 * STEP);
    expect(r.hasMore).toBe(true);
  });

  it("最新一页全被过滤掉时继续往前翻，直到凑够", async () => {
    const { fetchPage, calls } = source(0, 6000);
    // 只保留时间不晚于 4800 的，相当于最近 20 分钟都在休市
    const r = await loadLatest(fetchPage, { ...base, keep: (c) => c.time <= 4800 });
    expect(calls).toHaveLength(3);
    expect(r.candles).toHaveLength(10);
    expect(r.candles.every((c) => c.time <= 4800)).toBe(true);
    expect(r.candles[r.candles.length - 1]!.time).toBe(4800);
    for (let i = 1; i < r.candles.length; i++) expect(r.candles[i]!.time).toBeGreaterThan(r.candles[i - 1]!.time);
  });

  it("各页之间不重复、不遗漏", async () => {
    const { fetchPage } = source(0, 6000);
    const r = await loadLatest(fetchPage, { ...base, minBars: 25, keep: () => true });
    expect(r.candles).toHaveLength(30);
    const times = r.candles.map((c) => c.time);
    expect(new Set(times).size).toBe(30);
    expect(times[29]! - times[0]!).toBe(29 * STEP);
  });

  it("最多翻 maxPages 页就停，即使还没凑够", async () => {
    const { fetchPage, calls } = source(0, 60000);
    const r = await loadLatest(fetchPage, { ...base, keep: () => false });
    expect(calls).toHaveLength(5);
    expect(r.candles).toEqual([]);
    expect(r.hasMore).toBe(true);
  });

  it("数据到头时停止并标记没有更多", async () => {
    const { fetchPage, calls } = source(5400, 6000);
    const r = await loadLatest(fetchPage, { ...base, minBars: 100, keep: () => true });
    expect(r.candles).toHaveLength(11);
    expect(r.candles[0]!.time).toBe(5400);
    expect(r.hasMore).toBe(false);
    expect(calls.length).toBeLessThanOrEqual(3);
  });

  it("没有任何数据时返回空结果", async () => {
    const r = await loadLatest(async () => ({ candles: [], precision: 2 }), base);
    expect(r).toEqual({ candles: [], oldestRaw: null, hasMore: false, precision: 2 });
  });
});

describe("loadOlder", () => {
  it("从指定位置往前取，不包含已有的那一根", async () => {
    const { fetchPage } = source(0, 6000);
    const r = await loadOlder(fetchPage, 3000, { ...base, minBars: 1, maxPages: 1 });
    expect(r.candles).toHaveLength(10);
    expect(r.candles[9]!.time).toBe(3000 - STEP);
    expect(r.oldestRaw).toBe(3000 - 10 * STEP);
  });

  it("过滤后不够时继续翻页", async () => {
    const { fetchPage, calls } = source(0, 6000);
    const r = await loadOlder(fetchPage, 3000, { ...base, minBars: 5, keep: (c) => c.time <= 2000 });
    expect(r.candles.length).toBeGreaterThanOrEqual(5);
    expect(r.candles.every((c) => c.time <= 2000)).toBe(true);
    expect(calls.length).toBeGreaterThan(1);
  });

  it("已经到头时返回空并标记没有更多", async () => {
    const { fetchPage } = source(3000, 6000);
    const r = await loadOlder(fetchPage, 3000, base);
    expect(r.candles).toEqual([]);
    expect(r.hasMore).toBe(false);
  });

  it("没有起点时什么都不做", async () => {
    const { fetchPage, calls } = source(0, 6000);
    const r = await loadOlder(fetchPage, null, base);
    expect(calls).toEqual([]);
    expect(r.hasMore).toBe(false);
  });
});
