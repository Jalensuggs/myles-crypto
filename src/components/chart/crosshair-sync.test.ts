import { describe, expect, it, vi } from "vitest";
import { barIndexAt, publishCrosshair, subscribeCrosshair } from "./crosshair-sync";

const bars = [1000, 1900, 2800, 3700].map((time) => ({ time }));

describe("barIndexAt", () => {
  it("正好在某根 K 线的开盘时刻", () => {
    expect(barIndexAt(bars, 1000, 900)).toBe(0);
    expect(barIndexAt(bars, 2800, 900)).toBe(2);
    expect(barIndexAt(bars, 3700, 900)).toBe(3);
  });

  it("落在一根 K 线中间时返回这一根（不同周期的图靠这个对齐）", () => {
    expect(barIndexAt(bars, 1450, 900)).toBe(0);
    expect(barIndexAt(bars, 1899, 900)).toBe(0);
    expect(barIndexAt(bars, 3699, 900)).toBe(2);
  });

  it("最后一根只在它的时间范围内算数", () => {
    expect(barIndexAt(bars, 4599, 900)).toBe(3);
    expect(barIndexAt(bars, 4600, 900)).toBe(-1);
  });

  it("早于第一根或没有数据时返回 -1", () => {
    expect(barIndexAt(bars, 999, 900)).toBe(-1);
    expect(barIndexAt([], 1000, 900)).toBe(-1);
  });

  it("中间有缺口（比如美股隔夜）时落在缺口前的那一根", () => {
    const gappy = [1000, 1900, 90000].map((time) => ({ time }));
    expect(barIndexAt(gappy, 50000, 900)).toBe(1);
  });
});

describe("广播", () => {
  it("订阅者收到事件，取消订阅后不再收到", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeCrosshair(a);
    const offB = subscribeCrosshair(b);
    publishCrosshair({ source: 0, time: 1000 });
    expect(a).toHaveBeenCalledWith({ source: 0, time: 1000 });
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    publishCrosshair({ source: 1, time: null });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenLastCalledWith({ source: 1, time: null });
    offB();
  });

  it("在回调里取消订阅不会影响其他订阅者", () => {
    const seen: string[] = [];
    const offA = subscribeCrosshair(() => {
      seen.push("a");
      offA();
    });
    const offB = subscribeCrosshair(() => seen.push("b"));
    publishCrosshair({ source: 0, time: 1 });
    publishCrosshair({ source: 0, time: 2 });
    expect(seen).toEqual(["a", "b", "b"]);
    offB();
  });
});
