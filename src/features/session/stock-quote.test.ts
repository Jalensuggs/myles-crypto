import { describe, expect, it } from "vitest";
import type { Candle } from "@/types/market";
import { stockPhase, stockQuote } from "./stock-quote";

const at = (iso: string) => Date.parse(iso) / 1000;

const day = (date: string, close: number): Candle => ({
  time: at(`${date}T13:30:00Z`),
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
});

// 2026-10-08 周四、10-09 周五、10-12 周一，都在夏令时内（开盘 13:30 UTC，收盘 20:00 UTC）
const days = [day("2026-10-07", 1088), day("2026-10-08", 1035.84), day("2026-10-09", 1029)];

describe("stockPhase", () => {
  it("按美东时间划分盘前、盘中、盘后和休市", () => {
    expect(stockPhase(at("2026-10-12T07:59:00Z"))).toBe("closed"); // 3:59
    expect(stockPhase(at("2026-10-12T08:00:00Z"))).toBe("pre"); // 4:00
    expect(stockPhase(at("2026-10-12T13:29:00Z"))).toBe("pre");
    expect(stockPhase(at("2026-10-12T13:30:00Z"))).toBe("open");
    expect(stockPhase(at("2026-10-12T19:59:00Z"))).toBe("open");
    expect(stockPhase(at("2026-10-12T20:00:00Z"))).toBe("post");
    expect(stockPhase(at("2026-10-12T23:59:00Z"))).toBe("post");
    expect(stockPhase(at("2026-10-13T00:00:00Z"))).toBe("closed"); // 20:00
  });

  it("周末和休市日全天都是休市", () => {
    expect(stockPhase(at("2026-10-10T15:00:00Z"))).toBe("closed");
    expect(stockPhase(at("2026-10-11T10:00:00Z"))).toBe("closed");
    expect(stockPhase(at("2026-09-07T15:00:00Z"))).toBe("closed"); // 劳动节
  });

  it("冬令时整体晚一小时", () => {
    expect(stockPhase(at("2026-12-01T14:00:00Z"))).toBe("pre");
    expect(stockPhase(at("2026-12-01T14:30:00Z"))).toBe("open");
    expect(stockPhase(at("2026-12-01T21:00:00Z"))).toBe("post");
  });
});

describe("stockQuote", () => {
  it("盘前：相对上一个交易日的收盘价", () => {
    // 周一盘前，最近一次收盘是周五的 1029
    const q = stockQuote(days, 1007, at("2026-10-12T10:18:00Z"))!;
    expect(q.phase).toBe("pre");
    expect(q.refClose).toBe(1029);
    expect(q.changePct).toBeCloseTo(-2.138, 3);
    // 周五自身相对周四的涨跌
    expect(q.refDayChangePct).toBeCloseTo(-0.6603, 3);
  });

  it("盘中：相对昨收，不能用今天还没走完的那根", () => {
    const withToday = [...days, day("2026-10-12", 1010)];
    const q = stockQuote(withToday, 1015, at("2026-10-12T15:00:00Z"))!;
    expect(q.phase).toBe("open");
    expect(q.refClose).toBe(1029);
    expect(q.changePct).toBeCloseTo(((1015 - 1029) / 1029) * 100, 6);
  });

  it("盘后：相对今天的收盘价", () => {
    const withToday = [...days, day("2026-10-12", 1010)];
    const q = stockQuote(withToday, 1012, at("2026-10-12T21:00:00Z"))!;
    expect(q.phase).toBe("post");
    expect(q.refClose).toBe(1010);
    expect(q.changePct).toBeCloseTo(((1012 - 1010) / 1010) * 100, 6);
  });

  it("周末：相对周五的收盘价", () => {
    const q = stockQuote(days, 1020, at("2026-10-11T12:00:00Z"))!;
    expect(q.phase).toBe("closed");
    expect(q.refClose).toBe(1029);
  });

  it("刚好在收盘那一刻起，今天就算已收盘", () => {
    const withToday = [...days, day("2026-10-12", 1010)];
    expect(stockQuote(withToday, 1010, at("2026-10-12T19:59:59Z"))!.refClose).toBe(1029);
    expect(stockQuote(withToday, 1010, at("2026-10-12T20:00:00Z"))!.refClose).toBe(1010);
  });

  it("只有一根日线时没有前一日的涨跌", () => {
    const q = stockQuote([day("2026-10-09", 1029)], 1000, at("2026-10-12T10:00:00Z"))!;
    expect(q.refClose).toBe(1029);
    expect(q.refDayChangePct).toBeUndefined();
  });

  it("没有可用的收盘价或现价时返回 null", () => {
    expect(stockQuote([], 1000, at("2026-10-12T10:00:00Z"))).toBeNull();
    expect(stockQuote([day("2026-10-12", 1010)], 1000, at("2026-10-12T15:00:00Z"))).toBeNull();
    expect(stockQuote(days, 0, at("2026-10-12T10:00:00Z"))).toBeNull();
  });
});
