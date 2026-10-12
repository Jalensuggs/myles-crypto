import { describe, expect, it } from "vitest";
import type { Candle } from "@/types/market";
import { isValidCandle, mergeCandle, mergeCandleLists, normalizeCandles } from "./candles";

const c = (time: number, close = 100, extra: Partial<Candle> = {}): Candle => ({
  time,
  open: 100,
  high: Math.max(100, close) + 1,
  low: Math.min(100, close) - 1,
  close,
  volume: 10,
  ...extra,
});

describe("isValidCandle", () => {
  it("接受正常的 K 线", () => {
    expect(isValidCandle(c(60))).toBe(true);
  });

  it("拒绝最高价低于收盘价、非数字和非正价格", () => {
    expect(isValidCandle(c(60, 100, { high: 99 }))).toBe(false);
    expect(isValidCandle(c(60, 100, { low: 101 }))).toBe(false);
    expect(isValidCandle(c(60, 100, { close: Number.NaN }))).toBe(false);
    expect(isValidCandle(c(60, 100, { low: 0 }))).toBe(false);
    expect(isValidCandle(c(60, 100, { volume: -1 }))).toBe(false);
  });
});

describe("normalizeCandles", () => {
  it("按时间升序排列", () => {
    expect(normalizeCandles([c(180), c(60), c(120)]).map((x) => x.time)).toEqual([60, 120, 180]);
  });

  it("同一时间只保留最后一条", () => {
    const out = normalizeCandles([c(60, 100), c(120, 100), c(60, 105)]);
    expect(out).toHaveLength(2);
    expect(out[0]!.close).toBe(105);
  });

  it("丢弃非法数据", () => {
    expect(normalizeCandles([c(60), c(120, 100, { high: 1 })]).map((x) => x.time)).toEqual([60]);
  });
});

describe("mergeCandle", () => {
  it("时间相同则覆盖最后一根", () => {
    const list = [c(60), c(120, 100)];
    expect(mergeCandle(list, c(120, 108))).toBe("updated");
    expect(list).toHaveLength(2);
    expect(list[1]!.close).toBe(108);
  });

  it("时间更新则追加", () => {
    const list = [c(60)];
    expect(mergeCandle(list, c(120))).toBe("appended");
    expect(list.map((x) => x.time)).toEqual([60, 120]);
  });

  it("时间更旧或数据非法则忽略", () => {
    const list = [c(60), c(120)];
    expect(mergeCandle(list, c(60, 150))).toBe("ignored");
    expect(mergeCandle(list, c(180, 100, { high: 1 }))).toBe("ignored");
    expect(list).toHaveLength(2);
    expect(list[0]!.close).toBe(100);
  });

  it("空数组时直接追加", () => {
    const list: Candle[] = [];
    expect(mergeCandle(list, c(60))).toBe("appended");
  });

  it("同一根 K 线反复推送不会产生重复", () => {
    const list = [c(60)];
    for (let i = 0; i < 5; i++) mergeCandle(list, c(120, 100 + i));
    expect(list.map((x) => x.time)).toEqual([60, 120]);
    expect(list[1]!.close).toBe(104);
  });
});

describe("mergeCandleLists", () => {
  it("合并两段并以新数据为准", () => {
    const merged = mergeCandleLists([c(60), c(120, 100)], [c(120, 107), c(180)]);
    expect(merged.map((x) => x.time)).toEqual([60, 120, 180]);
    expect(merged[1]!.close).toBe(107);
  });
});
