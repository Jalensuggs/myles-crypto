import { describe, expect, it } from "vitest";
import type { Candle } from "@/types/market";
import { buildMessages, renderSnapshot } from "./prompt";
import { SNAPSHOT_BARS, buildSnapshot, describeStructure, formatUtc, snapshotSchema } from "./snapshot";

const START = 1_700_000_000;
const BAR = 3600;

function series(closes: readonly number[], takerShare?: number): Candle[] {
  return closes.map((close, i) => ({
    time: START + i * BAR,
    open: i === 0 ? close : closes[i - 1]!,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
    ...(takerShare === undefined ? {} : { takerBuyVolume: 100 * takerShare }),
  }));
}

/** 把几个转折价位连成 K 线，每段走 barsPerLeg 根 */
function zigzag(points: readonly number[], barsPerLeg = 5): Candle[] {
  const closes: number[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!;
    const step = (points[i]! - from) / barsPerLeg;
    for (let k = 1; k <= barsPerLeg; k++) closes.push(from + step * k);
  }
  return series(closes);
}

/** 一段来回震荡再收在中间的行情，长度够算出所有指标 */
function wavy(): Candle[] {
  const closes: number[] = [];
  for (let i = 0; i < 20; i++) closes.push(100, 104, 108, 104, 100, 96, 92, 96);
  return series(closes);
}

const base = {
  name: "BTCUSDT",
  kind: "现货",
  category: "crypto" as const,
  timeframe: "1h" as const,
  timeframeLabel: "1时",
  precision: 2,
  maPeriods: [7, 25, 99],
  now: (START + 160 * BAR) * 1000,
};

describe("formatUtc", () => {
  it("按 UTC 输出，日线以上不带时分", () => {
    expect(formatUtc(START, true)).toBe("11-14 22:13");
    expect(formatUtc(START, false)).toBe("2023-11-14");
  });
});

describe("describeStructure", () => {
  it("高点和低点都在抬高是上升结构", () => {
    // 顶 20 → 26，底 12 → 18，一浪比一浪高
    expect(describeStructure(zigzag([10, 20, 12, 26, 18, 24])).trend).toBe("up");
  });

  it("高点和低点都在降低是下降结构", () => {
    // 顶 28 → 22，底 20 → 14，一浪比一浪低
    expect(describeStructure(zigzag([30, 20, 28, 14, 22, 16])).trend).toBe("down");
  });

  it("高点抬高但低点在降时算震荡", () => {
    expect(describeStructure(zigzag([20, 26, 18, 30, 12, 20])).trend).toBe("range");
  });

  it("转折点不够时按震荡处理", () => {
    const result = describeStructure(series([10, 11, 12]));
    expect(result.trend).toBe("range");
    expect(result.detail).toContain("不足");
  });
});

describe("buildSnapshot", () => {
  const candles = wavy();
  const snapshot = buildSnapshot({ ...base, candles, price: 96 });

  it("产出的快照符合约定的结构", () => {
    expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("只带最近若干根 K 线，按时间由早到晚", () => {
    expect(snapshot.bars).toHaveLength(SNAPSHOT_BARS);
    expect(snapshot.bars[0]!.t < snapshot.bars[snapshot.bars.length - 1]!.t).toBe(true);
    expect(snapshot.range.bars).toBe(candles.length);
  });

  it("算出均线、RSI、MACD、ATR", () => {
    expect(snapshot.indicators.ma.map((m) => m.period)).toEqual([7, 25, 99]);
    expect(snapshot.indicators.rsi).toBeGreaterThan(0);
    expect(snapshot.indicators.macd).toBeDefined();
    expect(snapshot.indicators.atr).toBeGreaterThan(0);
    expect(snapshot.indicators.atrPct).toBeGreaterThan(0);
  });

  it("算出现价上下的支撑和阻力", () => {
    expect(snapshot.levels.resistance.length).toBeGreaterThan(0);
    expect(snapshot.levels.support.length).toBeGreaterThan(0);
    for (const level of snapshot.levels.resistance) expect(level.price).toBeGreaterThan(96);
    for (const level of snapshot.levels.support) expect(level.price).toBeLessThan(96);
  });

  it("标出现价在整个区间的位置", () => {
    // 区间是 91 ~ 109，96 在偏下的位置
    expect(snapshot.range.low).toBe(91);
    expect(snapshot.range.high).toBe(109);
    expect(snapshot.range.positionPct).toBeCloseTo(27.8, 1);
  });

  it("均线周期长于 K 线数量时跳过那一条", () => {
    const short = buildSnapshot({ ...base, candles: series([100, 101, 102, 103]), price: 103 });
    expect(short.indicators.ma).toEqual([]);
    expect(snapshotSchema.safeParse(short).success).toBe(true);
  });

  it("主动买入持续占优时 CVD 标为买方占优", () => {
    const buying = buildSnapshot({ ...base, candles: series(wavy().map((c) => c.close), 0.8), price: 96 });
    expect(buying.flow?.cvdTrend).toBe("up");
  });

  it("价格在涨但买盘在缩时指出背离", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const candles2 = series(closes, 0.35);
    const divergent = buildSnapshot({ ...base, candles: candles2, price: closes[closes.length - 1]! });
    expect(divergent.flow?.cvdNote).toContain("背离");
  });

  it("带上资金面数据和需要注意的说明", () => {
    const full = buildSnapshot({
      ...base,
      candles,
      price: 96,
      day: { changePct: -1.5, high: 109, low: 91, quoteVolume: 1234567 },
      flow: {
        openInterest: 5000,
        oiChangePct: 3.2,
        fundingRate: 0.0001,
        bigTrades1h: { buyUsd: 200, sellUsd: 50, netUsd: 150, count: 4 },
        liquidation24h: { long: 900, short: 100 },
        liquidationSince: START,
      },
      notes: ["爆仓数据只从打开页面起统计"],
    });
    expect(full.flow?.fundingRate).toBeCloseTo(0.01, 6);
    expect(full.flow?.liquidationSince).toBe("11-14 22:13");
    expect(full.day?.changePct).toBe(-1.5);
    expect(full.notes).toHaveLength(1);
    expect(snapshotSchema.safeParse(full).success).toBe(true);
  });
});

describe("renderSnapshot", () => {
  const snapshot = buildSnapshot({
    ...base,
    candles: wavy(),
    price: 96,
    day: { changePct: -1.5, high: 109, low: 91, quoteVolume: 1234567 },
    flow: { openInterest: 5000, oiChangePct: 3.2, fundingRate: 0.0001 },
    notes: ["美股休市中"],
  });
  const text = renderSnapshot(snapshot);

  it("把关键信息都写进文字里", () => {
    expect(text).toContain("BTCUSDT（现货）");
    expect(text).toContain("现价：96");
    expect(text).toContain("上方阻力");
    expect(text).toContain("下方支撑");
    expect(text).toContain("持仓量：5000，24 小时变化 3.2%");
    expect(text).toContain("美股休市中");
    expect(text).toContain("最近 60 根 K 线");
  });

  it("每根 K 线一行", () => {
    const lines = text.split("\n");
    const header = lines.findIndex((l) => l.startsWith("最近 60 根"));
    expect(lines.length - header - 1).toBe(60);
  });
});

describe("buildMessages", () => {
  it("第一条是规则，第二条是行情", () => {
    const messages = buildMessages(buildSnapshot({ ...base, candles: wavy(), price: 96 }));
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain('"direction"');
    expect(messages[1]!.role).toBe("user");
    expect(messages[1]!.content).toContain("现价：96");
    expect(messages[1]!.content).toContain("请根据以上数据");
  });
});
