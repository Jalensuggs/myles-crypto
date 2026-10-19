import { describe, expect, it } from "vitest";
import type { Candle } from "@/types/market";
import { clusterPivots, findPivots, keyLevels, toleranceFor, type Pivot } from "./levels";

const BAR = 3600;

/** 按收盘价序列造一组 K 线，高低点在收盘价上下各留一点空间 */
function series(closes: readonly number[], spread = 0): Candle[] {
  return closes.map((close, i) => ({
    time: 1_700_000_000 + i * BAR,
    open: close,
    high: close + spread,
    low: close - spread,
    close,
    volume: 100,
  }));
}

describe("findPivots", () => {
  it("找出被左右包住的高点和低点", () => {
    const candles = series([10, 11, 12, 11, 10, 9, 8, 9, 10]);
    const pivots = findPivots(candles, 2);
    expect(pivots).toEqual([
      { time: candles[2]!.time, price: 12, kind: "high" },
      { time: candles[6]!.time, price: 8, kind: "low" },
    ]);
  });

  it("价格走平时只记最左边那根，不把一个顶算成好几个", () => {
    const candles = series([10, 11, 12, 12, 12, 11, 10]);
    const highs = findPivots(candles, 2).filter((p) => p.kind === "high");
    expect(highs).toHaveLength(1);
    expect(highs[0]!.time).toBe(candles[2]!.time);
  });

  it("左右凑不满 lookback 根的位置不算拐点", () => {
    // 最高点在最后一根，右边没有 K 线可比
    expect(findPivots(series([10, 11, 12]), 2)).toEqual([]);
  });
});

describe("clusterPivots", () => {
  const pivot = (price: number, time: number): Pivot => ({ price, time, kind: "high" });

  it("把价格相近的拐点归成一组，并记下触碰次数和最近一次时间", () => {
    const clusters = clusterPivots([pivot(100, 10), pivot(100.3, 30), pivot(120, 20)], 0.01);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.touches).toBe(2);
    expect(clusters[0]!.price).toBeCloseTo(100.15, 6);
    expect(clusters[0]!.low).toBe(100);
    expect(clusters[0]!.high).toBe(100.3);
    expect(clusters[0]!.lastTouch).toBe(30);
    expect(clusters[1]!.touches).toBe(1);
  });

  it("差距超过容差就拆成两组", () => {
    const clusters = clusterPivots([pivot(100, 1), pivot(101, 2)], 0.005);
    expect(clusters.map((c) => c.touches)).toEqual([1, 1]);
  });
});

describe("toleranceFor", () => {
  it("波动越大，容差越宽", () => {
    expect(toleranceFor(100, 1)).toBeGreaterThan(toleranceFor(100, 0.5));
  });

  it("限制在 0.2% 到 1.5% 之间", () => {
    expect(toleranceFor(100, 0.001)).toBeCloseTo(0.002, 6);
    expect(toleranceFor(100, 50)).toBeCloseTo(0.015, 6);
  });

  it("没有波动数据时给一个默认值", () => {
    expect(toleranceFor(100, null)).toBeCloseTo(0.004, 6);
  });
});

describe("keyLevels", () => {
  it("把现价下方的归为支撑，上方的归为阻力", () => {
    // 在 90 和 110 之间来回几轮，形成明确的上下边界
    const closes: number[] = [];
    for (let i = 0; i < 4; i++) closes.push(100, 105, 110, 105, 100, 95, 90, 95);
    closes.push(100);
    const candles = series(closes);
    const result = keyLevels(candles, 100, { lookback: 2, tolerance: 0.01 });

    expect(result.support.length).toBeGreaterThan(0);
    expect(result.resistance.length).toBeGreaterThan(0);
    for (const level of result.support) expect(level.price).toBeLessThan(100);
    for (const level of result.resistance) expect(level.price).toBeGreaterThan(100);
    expect(result.resistance[0]!.price).toBeCloseTo(110, 6);
    expect(result.support[0]!.price).toBeCloseTo(90, 6);
    // 四轮来回，上下边界各被碰过四次
    expect(result.resistance[0]!.touches).toBe(4);
  });

  it("按离现价由近到远排列", () => {
    const closes: number[] = [];
    for (let i = 0; i < 3; i++) closes.push(100, 120, 100, 140, 100, 160);
    closes.push(100);
    const result = keyLevels(series(closes), 100, { lookback: 1, tolerance: 0.01, max: 3 });
    const prices = result.resistance.map((l) => l.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it("每边最多返回 max 个", () => {
    const closes: number[] = [];
    for (let i = 0; i < 3; i++) closes.push(100, 110, 100, 120, 100, 130, 100, 140);
    const result = keyLevels(series(closes), 100, { lookback: 1, tolerance: 0.005, max: 2 });
    expect(result.resistance.length).toBeLessThanOrEqual(2);
  });

  it("数据不足时返回空", () => {
    expect(keyLevels([], 100)).toEqual({ support: [], resistance: [] });
    expect(keyLevels(series([100, 101]), 0)).toEqual({ support: [], resistance: [] });
  });
});
