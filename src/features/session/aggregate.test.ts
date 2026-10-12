import { describe, expect, it } from "vitest";
import type { Candle } from "@/types/market";
import { aggregateLast, aggregateSession, regroupCalendar, regroupCalendarLast, sessionPlan } from "./aggregate";
import { isUsRegularSession } from "./us-session";

const at = (iso: string) => Date.parse(iso) / 1000;
const M30 = 1800;

/** 生成某个 UTC 日期全天的 30 分钟线，价格随序号递增，方便核对 */
function day30m(date: string, base: number): Candle[] {
  const start = at(`${date}T00:00:00Z`);
  return Array.from({ length: 48 }, (_, i) => ({
    time: start + i * M30,
    open: base + i,
    high: base + i + 0.8,
    low: base + i - 0.5,
    close: base + i + 0.5,
    volume: 10,
  }));
}

const session = (candles: Candle[]) => candles.filter((c) => isUsRegularSession(c.time, M30));

// 2026-10-08 周四、10-09 周五，夏令时，交易时段 13:30–20:00 UTC，即第 27 到 39 根 30 分钟线
const thu = session(day30m("2026-10-08", 100));
const fri = session(day30m("2026-10-09", 200));

describe("sessionPlan", () => {
  it("1 分到 30 分直接用原始 K 线", () => {
    for (const tf of ["1m", "5m", "15m", "30m"] as const) {
      expect(sessionPlan(tf)).toEqual({ source: tf, groupMinutes: null, barsPerGroup: 1, calendar: null });
    }
  });

  it("1 时、4 时、1 日用 30 分钟线合成", () => {
    expect(sessionPlan("1h")).toMatchObject({ source: "30m", groupMinutes: 60 });
    expect(sessionPlan("4h")).toMatchObject({ source: "30m", groupMinutes: 240 });
    expect(sessionPlan("1d")).toMatchObject({ source: "30m", barsPerGroup: 13, calendar: null });
  });

  it("周线和月线先合成日线，再按自然周、自然月归并", () => {
    expect(sessionPlan("1w")).toMatchObject({ source: "30m", barsPerGroup: 13, calendar: "week" });
    expect(sessionPlan("1M")).toMatchObject({ source: "30m", barsPerGroup: 13, calendar: "month" });
    expect(sessionPlan("1w").groupMinutes).toBe(sessionPlan("1d").groupMinutes);
  });
});

describe("aggregateSession", () => {
  it("一个交易日有 13 根 30 分钟线", () => {
    expect(thu).toHaveLength(13);
    expect(thu[0]!.time).toBe(at("2026-10-08T13:30:00Z"));
    expect(thu[12]!.time).toBe(at("2026-10-08T19:30:00Z"));
  });

  it("日线：开盘取 9:30 那根的开盘价，收盘取 16:00 前最后一根的收盘价", () => {
    const [d1, d2] = aggregateSession([...thu, ...fri], sessionPlan("1d").groupMinutes!);
    expect(d1).toEqual({
      time: at("2026-10-08T13:30:00Z"),
      open: 127,
      high: 139.8,
      low: 126.5,
      close: 139.5,
      volume: 130,
    });
    expect(d2!.open).toBe(227);
    expect(d2!.close).toBe(239.5);
  });

  it("1 小时线从 9:30 起算，一天 7 根，最后一根只有半小时", () => {
    const bars = aggregateSession(thu, 60);
    expect(bars).toHaveLength(7);
    expect(bars.map((b) => new Date(b.time * 1000).toISOString().slice(11, 16))).toEqual([
      "13:30",
      "14:30",
      "15:30",
      "16:30",
      "17:30",
      "18:30",
      "19:30",
    ]);
    expect(bars[0]).toMatchObject({ open: 127, close: 128.5, high: 128.8, low: 126.5, volume: 20 });
    expect(bars[6]).toMatchObject({ open: 139, close: 139.5, volume: 10 });
  });

  it("4 小时线：一天两根，9:30–13:30 和 13:30–16:00", () => {
    const bars = aggregateSession(thu, 240);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ time: at("2026-10-08T13:30:00Z"), open: 127, close: 134.5, volume: 80 });
    expect(bars[1]).toMatchObject({ time: at("2026-10-08T17:30:00Z"), open: 135, close: 139.5, volume: 50 });
  });

  it("不同交易日不会合到一起", () => {
    expect(aggregateSession([...thu, ...fri], 60)).toHaveLength(14);
    expect(aggregateSession([...thu, ...fri], 240)).toHaveLength(4);
  });

  it("最早一组如果被截断了就丢掉，后面的不受影响", () => {
    const cut = [...thu.slice(5), ...fri];
    const days = aggregateSession(cut, sessionPlan("1d").groupMinutes!);
    expect(days).toHaveLength(1);
    expect(days[0]!.open).toBe(227);

    // 小时线：从半小时处截断，丢掉残缺的那一小时
    const hours = aggregateSession(thu.slice(1), 60);
    expect(hours).toHaveLength(6);
    expect(hours[0]!.time).toBe(at("2026-10-08T14:30:00Z"));
  });

  it("当天还没走完时，最后一根是到目前为止的结果", () => {
    const partial = aggregateSession([...thu, ...fri.slice(0, 3)], sessionPlan("1d").groupMinutes!);
    expect(partial).toHaveLength(2);
    expect(partial[1]).toMatchObject({ open: 227, close: 229.5, volume: 30 });
  });

  it("冬令时同样从 9:30 起算", () => {
    const winter = session(day30m("2026-12-01", 100));
    expect(winter[0]!.time).toBe(at("2026-12-01T14:30:00Z"));
    expect(aggregateSession(winter, 60)).toHaveLength(7);
  });

  it("空输入返回空数组", () => {
    expect(aggregateSession([], 60)).toEqual([]);
  });
});

describe("aggregateLast", () => {
  it("和完整合成的最后一根一致", () => {
    for (const minutes of [60, 240, 1440]) {
      for (const n of [1, 2, 3, 8, 13, 14, 20, 26]) {
        const source = [...thu, ...fri].slice(0, n);
        const all = aggregateSession(source, minutes);
        expect(aggregateLast(source, minutes)).toEqual(all[all.length - 1]);
      }
    }
  });

  it("最后一组残缺时返回 null", () => {
    expect(aggregateLast(thu.slice(5, 8), 1440)).toBeNull();
    expect(aggregateLast([], 60)).toBeNull();
  });
});

describe("regroupCalendar", () => {
  const daily = (date: string, open: number, high: number, low: number, close: number): Candle => ({
    time: at(`${date}T13:30:00Z`),
    open,
    high,
    low,
    close,
    volume: 100,
  });

  // 2026-09-28 周一 … 10-02 周五；10-05 周一 … 10-09 周五；10-12 周一
  const days = [
    daily("2026-09-28", 100, 105, 99, 104),
    daily("2026-09-29", 104, 108, 103, 107),
    daily("2026-09-30", 107, 109, 101, 102),
    daily("2026-10-01", 102, 106, 100, 105),
    daily("2026-10-02", 105, 112, 104, 111),
    daily("2026-10-05", 111, 113, 110, 112),
    daily("2026-10-06", 112, 115, 111, 114),
    daily("2026-10-07", 114, 116, 108, 109),
    daily("2026-10-08", 109, 110, 105, 106),
    daily("2026-10-09", 106, 107, 98, 99),
    daily("2026-10-12", 99, 101, 97, 100),
  ];

  it("周线：周一到周五归为一根，开盘取周一、收盘取周五", () => {
    const weeks = regroupCalendar(days, "week");
    expect(weeks).toHaveLength(3);
    expect(weeks[0]).toEqual({ time: at("2026-09-28T13:30:00Z"), open: 100, high: 112, low: 99, close: 111, volume: 500 });
    expect(weeks[1]).toMatchObject({ time: at("2026-10-05T13:30:00Z"), open: 111, high: 116, low: 98, close: 99 });
    // 本周只走了一天
    expect(weeks[2]).toMatchObject({ time: at("2026-10-12T13:30:00Z"), open: 99, close: 100, volume: 100 });
  });

  it("月线：按自然月归并，一周跨月时拆开", () => {
    const months = regroupCalendar(days, "month");
    expect(months).toHaveLength(2);
    expect(months[0]).toMatchObject({ time: at("2026-09-28T13:30:00Z"), open: 100, high: 109, low: 99, close: 102, volume: 300 });
    expect(months[1]).toMatchObject({ time: at("2026-10-01T13:30:00Z"), open: 102, high: 116, low: 97, close: 100, volume: 800 });
  });

  it("周一是休市日时，那一周从周二开始", () => {
    // 2026-09-07 劳动节
    const weeks = regroupCalendar([daily("2026-09-04", 1, 2, 1, 2), daily("2026-09-08", 2, 3, 2, 3), daily("2026-09-09", 3, 4, 3, 4)], "week");
    expect(weeks.map((w) => w.time)).toEqual([at("2026-09-04T13:30:00Z"), at("2026-09-08T13:30:00Z")]);
  });

  it("跨年时月份不会混在一起", () => {
    const months = regroupCalendar(
      [daily("2025-12-31", 1, 2, 1, 2), daily("2026-01-02", 2, 3, 2, 3), daily("2027-01-04", 3, 4, 3, 4)],
      "month",
    );
    expect(months).toHaveLength(3);
  });

  it("regroupCalendarLast 和完整归并的最后一根一致", () => {
    for (const unit of ["week", "month"] as const) {
      for (let n = 1; n <= days.length; n++) {
        const part = days.slice(0, n);
        const all = regroupCalendar(part, unit);
        expect(regroupCalendarLast(part, unit)).toEqual(all[all.length - 1]);
      }
    }
    expect(regroupCalendarLast([], "week")).toBeNull();
    expect(regroupCalendar([], "month")).toEqual([]);
  });
});
