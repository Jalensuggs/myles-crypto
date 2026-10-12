import { describe, expect, it } from "vitest";
import type { Candle, Liquidation, Trade } from "@/types/market";
import {
  BIG_TRADE_FLOOR_USD,
  CLUSTER_GAP_MS,
  CLUSTER_MAX_MS,
  TradeClusterer,
  bigTradeThreshold,
  summarizeBigTrades,
} from "./big-trades";
import { candleDelta, cumulativeDelta } from "./cvd";
import { absorptionEvent, bigTradeEvent, panicEvent } from "./events";
import {
  BUCKET_KEEP_SECONDS,
  addLiquidation,
  earliestBucketTime,
  pruneBuckets,
  sumLiquidations,
  type LiquidationBuckets,
} from "./liquidation-buckets";
import { ABSORPTION_WINDOW, detectAbsorption, detectPanicAbsorbed } from "./patterns";

const candle = (time: number, o: number, h: number, l: number, c: number, volume: number, takerBuy?: number): Candle => ({
  time,
  open: o,
  high: h,
  low: l,
  close: c,
  volume,
  ...(takerBuy === undefined ? {} : { takerBuyVolume: takerBuy }),
});

describe("CVD", () => {
  it("一根 K 线的差额 = 主动买入 − 主动卖出", () => {
    // 总量 100，主动买入 70，主动卖出 30，差额 +40
    expect(candleDelta(candle(0, 1, 1, 1, 1, 100, 70))).toBe(40);
    expect(candleDelta(candle(0, 1, 1, 1, 1, 100, 20))).toBe(-60);
    expect(candleDelta(candle(0, 1, 1, 1, 1, 100, 50))).toBe(0);
  });

  it("没有主动买入数据时为 null", () => {
    expect(candleDelta(candle(0, 1, 1, 1, 1, 100))).toBeNull();
  });

  it("逐根累加", () => {
    const candles = [candle(0, 1, 1, 1, 1, 100, 70), candle(60, 1, 1, 1, 1, 100, 20), candle(120, 1, 1, 1, 1, 50, 40)];
    expect(cumulativeDelta(candles)).toEqual([40, -20, 10]);
  });

  it("全部没有数据时返回全 null，个别缺失按 0 处理", () => {
    expect(cumulativeDelta([candle(0, 1, 1, 1, 1, 100), candle(60, 1, 1, 1, 1, 100)])).toEqual([null, null]);
    expect(cumulativeDelta([candle(0, 1, 1, 1, 1, 100, 70), candle(60, 1, 1, 1, 1, 100)])).toEqual([40, 40]);
    expect(cumulativeDelta([])).toEqual([]);
  });
});

describe("大单门槛", () => {
  it("自动：24 小时成交额的万分之二，最低 10 万美元", () => {
    expect(bigTradeThreshold(8e9, 0)).toBe(1_600_000);
    expect(bigTradeThreshold(1.5e9, 0)).toBe(300_000);
    expect(bigTradeThreshold(5e7, 0)).toBe(BIG_TRADE_FLOOR_USD);
    expect(bigTradeThreshold(undefined, 0)).toBe(BIG_TRADE_FLOOR_USD);
  });

  it("填了固定金额就用固定金额", () => {
    expect(bigTradeThreshold(8e9, 250_000)).toBe(250_000);
    expect(bigTradeThreshold(undefined, 5_000)).toBe(5_000);
  });
});

describe("TradeClusterer", () => {
  const trade = (time: number, price: number, quantity: number, side: Trade["side"]): Trade => ({ time, price, quantity, side });

  it("同一方向、紧挨着的成交合并成一笔，均价按金额加权", () => {
    const c = new TradeClusterer();
    expect(c.add(trade(1000, 100, 10, "buy"))).toBeNull();
    expect(c.add(trade(1050, 101, 10, "buy"))).toBeNull();
    expect(c.add(trade(1100, 102, 20, "buy"))).toBeNull();
    const done = c.flush(1100 + CLUSTER_GAP_MS + 1)!;
    expect(done).toMatchObject({ side: "buy", time: 1000, lastTime: 1100, quantity: 40, notional: 4050, fills: 3 });
    expect(done.price).toBeCloseTo(101.25, 10);
  });

  it("方向变了就结束上一组", () => {
    const c = new TradeClusterer();
    c.add(trade(1000, 100, 10, "buy"));
    const done = c.add(trade(1010, 100, 5, "sell"));
    expect(done).toMatchObject({ side: "buy", notional: 1000, fills: 1 });
  });

  it("间隔太久也结束上一组", () => {
    const c = new TradeClusterer();
    c.add(trade(1000, 100, 10, "buy"));
    expect(c.add(trade(1000 + CLUSTER_GAP_MS, 100, 1, "buy"))).toBeNull();
    const done = c.add(trade(1000 + CLUSTER_GAP_MS * 2 + 1, 100, 1, "buy"));
    expect(done).toMatchObject({ quantity: 11, fills: 2 });
  });

  it("同方向的成交连绵不断时，一组最多合并 2 秒", () => {
    const c = new TradeClusterer();
    let done = null;
    let t = 0;
    // 每 100 毫秒一笔，持续 3 秒
    for (; t <= 3000 && !done; t += 100) done = c.add(trade(t, 100, 1, "buy"));
    expect(done).toMatchObject({ time: 0, lastTime: CLUSTER_MAX_MS, fills: 21 });
  });

  it("还在合并中的不会被提前交出来，交出来之后不会重复", () => {
    const c = new TradeClusterer();
    c.add(trade(1000, 100, 10, "sell"));
    expect(c.flush(1000 + CLUSTER_GAP_MS)).toBeNull();
    expect(c.flush(1000 + CLUSTER_GAP_MS + 1)).not.toBeNull();
    expect(c.flush(5000)).toBeNull();
  });
});

describe("summarizeBigTrades", () => {
  it("只统计指定时间之后的，分别给出买卖金额、笔数和净流入", () => {
    const trades = [
      { time: 1000, side: "buy" as const, notional: 500, price: 1 },
      { time: 2000, side: "buy" as const, notional: 300, price: 1 },
      { time: 2500, side: "sell" as const, notional: 1000, price: 1 },
      { time: 3000, side: "buy" as const, notional: 200, price: 1 },
    ];
    expect(summarizeBigTrades(trades, 2000)).toEqual({ buyUsd: 500, sellUsd: 1000, netUsd: -500, buyCount: 2, sellCount: 1 });
    expect(summarizeBigTrades([], 0)).toEqual({ buyUsd: 0, sellUsd: 0, netUsd: 0, buyCount: 0, sellCount: 0 });
  });
});

describe("爆仓按分钟累计", () => {
  const liq = (timeSec: number, side: Liquidation["side"], notional: number): Liquidation => ({
    symbol: "BTCUSDT",
    side,
    price: 1,
    quantity: notional,
    notional,
    time: timeSec * 1000,
  });

  it("同一分钟内的累加，多单和空单分开", () => {
    let b: LiquidationBuckets = {};
    b = addLiquidation(b, liq(600, "long", 100));
    b = addLiquidation(b, liq(630, "long", 50));
    b = addLiquidation(b, liq(659, "short", 70));
    b = addLiquidation(b, liq(660, "long", 9));
    expect(b[10]).toEqual([150, 70]);
    expect(b[11]).toEqual([9, 0]);
  });

  it("不修改传入的对象", () => {
    const b: LiquidationBuckets = { 10: [1, 2] };
    addLiquidation(b, liq(600, "long", 5));
    expect(b).toEqual({ 10: [1, 2] });
  });

  it("按时间段求和，含起点不含终点", () => {
    const b: LiquidationBuckets = { 10: [100, 0], 11: [50, 20], 14: [0, 300], 15: [7, 7] };
    expect(sumLiquidations(b, 600, 900)).toEqual({ long: 150, short: 320 });
    expect(sumLiquidations(b, 900, 1800)).toEqual({ long: 7, short: 7 });
    expect(sumLiquidations(b, 0, 600)).toEqual({ long: 0, short: 0 });
  });

  it("时间段很长、记录很稀疏时结果一样", () => {
    const b: LiquidationBuckets = { 10: [100, 0], 5000: [1, 2] };
    expect(sumLiquidations(b, 0, 86400 * 30)).toEqual({ long: 101, short: 2 });
  });

  it("清掉三天以前的记录，并能找到最早的一条", () => {
    const now = 10 * 86400;
    const old = Math.floor((now - BUCKET_KEEP_SECONDS - 120) / 60);
    const recent = Math.floor((now - 3600) / 60);
    const pruned = pruneBuckets({ [old]: [1, 1], [recent]: [2, 2] }, now);
    expect(Object.keys(pruned)).toEqual([String(recent)]);
    expect(earliestBucketTime(pruned)).toBe(recent * 60);
    expect(earliestBucketTime({})).toBeNull();
  });
});

describe("横盘吸收", () => {
  // 生成一段横盘：价格在 100 附近窄幅波动，buyShare 是主动买入占比
  const flat = (buyShare: number, lows: number[] = []): Candle[] =>
    Array.from({ length: ABSORPTION_WINDOW }, (_, i) => {
      const low = lows[i] ?? 99.6;
      return candle(i * 900, 100, 100.5, low, 100.1, 1000, 1000 * buyShare);
    });

  it("主动卖出明显偏多、价格却不破低：有人在接货", () => {
    const a = detectAbsorption(flat(0.44))!;
    expect(a.side).toBe("buy");
    expect(a.imbalance).toBeCloseTo(-0.12, 6);
  });

  it("主动买入明显偏多、价格却不破高：有人在出货", () => {
    expect(detectAbsorption(flat(0.56))?.side).toBe("sell");
  });

  it("买卖基本平衡时不提示", () => {
    expect(detectAbsorption(flat(0.5))).toBeNull();
    expect(detectAbsorption(flat(0.48))).toBeNull();
  });

  it("最近几根创了新低，说明没接住，不提示", () => {
    const lows = new Array(ABSORPTION_WINDOW).fill(99.6);
    lows[ABSORPTION_WINDOW - 1] = 99.2;
    expect(detectAbsorption(flat(0.44, lows))).toBeNull();
  });

  it("波动太大不算横盘", () => {
    const wide = flat(0.44).map((c, i) => (i === 3 ? { ...c, high: 103 } : c));
    expect(detectAbsorption(wide)).toBeNull();
  });

  it("K 线不够或缺少主动买入数据时不判断", () => {
    expect(detectAbsorption(flat(0.44).slice(1))).toBeNull();
    const missing = flat(0.44).map((c, i) => (i === 5 ? candle(c.time, c.open, c.high, c.low, c.close, c.volume) : c));
    expect(detectAbsorption(missing)).toBeNull();
  });

  it("只看最近的窗口，更早的行情不影响", () => {
    const earlier = Array.from({ length: 30 }, (_, i) => candle(-(i + 1) * 900, 80, 120, 60, 100, 5000, 4000)).reverse();
    expect(detectAbsorption([...earlier, ...flat(0.44).map((c) => ({ ...c, time: c.time + 1 }))])?.side).toBe("buy");
  });
});

describe("恐慌盘被接走", () => {
  const VOLUME = 8e9; // 门槛 = 80 万美元

  it("多单集中爆仓，K 线留下长下影线收回", () => {
    // 开 100，最低 96，收 99.5：下影线占 3.5/4.2
    const c = candle(0, 100, 100.2, 96, 99.5, 1000);
    expect(detectPanicAbsorbed(c, { long: 3_000_000, short: 0 }, VOLUME)).toEqual({ side: "long", liquidatedUsd: 3_000_000 });
  });

  it("爆仓金额不够大时不提示", () => {
    const c = candle(0, 100, 100.2, 96, 99.5, 1000);
    expect(detectPanicAbsorbed(c, { long: 700_000, short: 0 }, VOLUME)).toBeNull();
  });

  it("爆仓很多但价格没收回来（实体很长），不算接住", () => {
    const c = candle(0, 100, 100.2, 96, 96.3, 1000);
    expect(detectPanicAbsorbed(c, { long: 3_000_000, short: 0 }, VOLUME)).toBeNull();
  });

  it("空单集中爆仓后冲高回落", () => {
    const c = candle(0, 100, 104, 99.8, 100.4, 1000);
    expect(detectPanicAbsorbed(c, { long: 0, short: 2_000_000 }, VOLUME)).toEqual({ side: "short", liquidatedUsd: 2_000_000 });
  });

  it("小币种用最低门槛 20 万美元", () => {
    const c = candle(0, 100, 100.2, 96, 99.5, 1000);
    expect(detectPanicAbsorbed(c, { long: 250_000, short: 0 }, 1e7)?.side).toBe("long");
    expect(detectPanicAbsorbed(c, { long: 150_000, short: 0 }, undefined)).toBeNull();
  });

  it("没有波动的 K 线不判断", () => {
    expect(detectPanicAbsorbed(candle(0, 100, 100, 100, 100, 0), { long: 9e9, short: 0 }, VOLUME)).toBeNull();
  });
});

describe("事件文案", () => {
  it("大单：方向、金额、价格，合并了多笔时注明", () => {
    const e = bigTradeEvent("BTCUSDT.P", {
      side: "buy",
      time: 1,
      lastTime: 99,
      quantity: 22,
      notional: 1_860_000,
      price: 83500,
      fills: 4,
    });
    expect(e).toMatchObject({
      kind: "big-trade",
      symbol: "BTCUSDT.P",
      title: "大单买入 $186.0万",
      detail: "均价 83,500.00 · 合并 4 笔成交",
      tone: "positive",
      createdAt: 99,
    });
    const single = bigTradeEvent("ETHUSDT.P", { side: "sell", time: 1, lastTime: 1, quantity: 1, notional: 250_000, price: 2550, fills: 1 });
    expect(single.title).toBe("大单卖出 $25.0万");
    expect(single.detail).toBe("成交价 2,550.00");
    expect(single.tone).toBe("negative");
  });

  it("吸收和恐慌盘的说明", () => {
    const a = absorptionEvent("BTCUSDT.P", { side: "buy", imbalance: -0.083, rangePct: 1 }, 4, 5);
    expect(a.title).toBe("卖压被吸收，疑似有人接货");
    expect(a.detail).toBe("近 4 小时价格横盘不破低，主动卖出比买入多 8.3%");
    expect(absorptionEvent("X", { side: "sell", imbalance: 0.07, rangePct: 1 }, 4, 5).tone).toBe("negative");

    const p = panicEvent("BTCUSDT.P", { side: "long", liquidatedUsd: 3e7 }, 15, 5);
    expect(p.title).toBe("恐慌盘被接走");
    expect(p.detail).toBe("15 分钟内多单爆仓 $3000.0万，价格留下长下影线收回");
    expect(panicEvent("X", { side: "short", liquidatedUsd: 1e6 }, 15, 5).title).toBe("逼空后冲高回落");
  });
});
