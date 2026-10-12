import { describe, expect, it } from "vitest";
import type { Liquidation, Ticker } from "@/types/market";
import { BREAK_COOLDOWN_MS, FUNDING_COOLDOWN_MS, FeedEngine, MOVE_COOLDOWN_MS } from "./rules";

const thresholds = { liquidationMinUsd: 50_000, moveThresholdPct: 0.8 };
const engine = () => new FeedEngine(() => thresholds);
const S = "BTCUSDT.P";

const ticker = (last: number, high = 110, low = 90): Ticker => ({
  last,
  open24h: 100,
  high24h: high,
  low24h: low,
  quoteVolume24h: 1e9,
  changePct: last - 100,
});

const liq = (notional: number, side: "long" | "short" = "long"): Liquidation => ({
  symbol: "BTCUSDT",
  side,
  price: 80_000,
  quantity: notional / 80_000,
  notional,
  time: 1000,
});

describe("大额爆仓", () => {
  it("低于阈值不提醒，达到阈值提醒", () => {
    const e = engine();
    expect(e.onLiquidation(liq(49_999), S)).toEqual([]);
    const [event] = e.onLiquidation(liq(523_000), S);
    expect(event).toMatchObject({ kind: "liquidation", symbol: S, title: "多单爆仓 $52.3万", tone: "negative", createdAt: 1000 });
  });

  it("空单爆仓标为利多色", () => {
    const [event] = engine().onLiquidation(liq(80_000, "short"), S);
    expect(event!.title).toContain("空单爆仓");
    expect(event!.tone).toBe("positive");
  });

  it("连续的大额爆仓每一笔都提醒", () => {
    const e = engine();
    expect(e.onLiquidation(liq(60_000), S)).toHaveLength(1);
    expect(e.onLiquidation(liq(70_000), S)).toHaveLength(1);
  });
});

describe("资金费率", () => {
  it("绝对值达到 0.05% 才提醒", () => {
    const e = engine();
    expect(e.onFunding(S, 0.0001, 0)).toEqual([]);
    const [high] = e.onFunding(S, 0.0006, 0);
    expect(high).toMatchObject({ kind: "funding", tone: "warning", title: "资金费率偏高 +0.0600%" });
  });

  it("负费率有单独的说明", () => {
    const [neg] = engine().onFunding(S, -0.0007, 0);
    expect(neg!.title).toBe("资金费率为负 −0.0700%");
  });

  it("同一标的 4 小时内只提醒一次，不同标的互不影响", () => {
    const e = engine();
    expect(e.onFunding(S, 0.001, 0)).toHaveLength(1);
    expect(e.onFunding(S, 0.001, FUNDING_COOLDOWN_MS - 1)).toHaveLength(0);
    expect(e.onFunding("ETHUSDT.P", 0.001, 10)).toHaveLength(1);
    expect(e.onFunding(S, 0.001, FUNDING_COOLDOWN_MS)).toHaveLength(1);
  });
});

describe("急涨急跌", () => {
  it("5 分钟内涨幅达到阈值时提醒一次", () => {
    const e = engine();
    expect(e.onTicker(S, ticker(100), 0)).toEqual([]);
    expect(e.onTicker(S, ticker(100.5), 60_000)).toEqual([]);
    const events = e.onTicker(S, ticker(100.9), 120_000);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "price-move", tone: "positive", title: "2 分钟急涨 +0.90%" });
  });

  it("下跌同理", () => {
    const e = engine();
    e.onTicker(S, ticker(100), 0);
    const [event] = e.onTicker(S, ticker(99), 30_000);
    expect(event).toMatchObject({ tone: "negative", title: "1 分钟急跌 −1.00%" });
  });

  it("同方向 10 分钟内不重复提醒，反方向可以", () => {
    const e = engine();
    e.onTicker(S, ticker(100), 0);
    expect(e.onTicker(S, ticker(101), 10_000)).toHaveLength(1);
    expect(e.onTicker(S, ticker(101.2), 20_000)).toHaveLength(0);
    expect(e.onTicker(S, ticker(99), 30_000).map((x) => x.tone)).toEqual(["negative"]);
    const later = MOVE_COOLDOWN_MS + 10_000;
    e.onTicker(S, ticker(100), later);
    expect(e.onTicker(S, ticker(101), later + 10_000)).toHaveLength(1);
  });

  it("只和 5 分钟窗口内的价格比较", () => {
    const e = engine();
    e.onTicker(S, ticker(100), 0);
    e.onTicker(S, ticker(100.3), 200_000);
    // 距第一条样本已超过 5 分钟，只与 100.3 比较，涨幅不够
    expect(e.onTicker(S, ticker(100.9), 320_000)).toEqual([]);
  });

  it("关闭标签后重新打开不会用旧价格比较", () => {
    const e = engine();
    e.onTicker(S, ticker(100), 0);
    e.forget(S);
    expect(e.onTicker(S, ticker(105), 10_000)).toEqual([]);
  });
});

describe("突破 24 小时区间", () => {
  it("第一次看到行情只记录，不提醒", () => {
    expect(engine().onTicker(S, ticker(110, 110, 90), 0)).toEqual([]);
  });

  it("最高价被刷新时提醒新高", () => {
    const e = engine();
    e.onTicker(S, ticker(109.9, 110, 90), 0);
    const events = e.onTicker(S, ticker(110.2, 110.2, 90), 1000);
    expect(events.map((x) => x.title)).toEqual(["突破 24 小时新高"]);
  });

  it("最低价被刷新时提醒新低", () => {
    const e = engine();
    e.onTicker(S, ticker(90.1, 110, 90), 0);
    const events = e.onTicker(S, ticker(89.9, 110, 89.9), 1000);
    expect(events.map((x) => x.title)).toEqual(["跌破 24 小时新低"]);
  });

  it("30 分钟内连续创新高只提醒一次", () => {
    const e = engine();
    e.onTicker(S, ticker(109.99, 110, 90), 0);
    expect(e.onTicker(S, ticker(110.01, 110.01, 90), 1000)).toHaveLength(1);
    expect(e.onTicker(S, ticker(110.02, 110.02, 90), 2000)).toHaveLength(0);
    expect(e.onTicker(S, ticker(110.03, 110.03, 90), BREAK_COOLDOWN_MS + 1000)).toHaveLength(1);
  });

  it("24 小时窗口滚动导致最高价回落时不误报", () => {
    const e = engine();
    e.onTicker(S, ticker(105, 110, 90), 0);
    expect(e.onTicker(S, ticker(105, 108, 90), 1000)).toEqual([]);
  });
});

describe("事件编号", () => {
  it("每个事件的 id 都不同", () => {
    const e = engine();
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(e.onLiquidation(liq(60_000), S)[0]!.id);
    expect(ids.size).toBe(50);
  });
});
