import { describe, expect, it } from "vitest";
import { ema, macd, rsi, sma } from "./calc";
import { parseMaPeriods } from "./config";

describe("sma", () => {
  it("数据不足的位置为 null，之后是窗口内的平均值", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("周期为 1 时等于原值", () => {
    expect(sma([3, 5, 7], 1)).toEqual([3, 5, 7]);
  });

  it("数据比周期短时全部为 null", () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });

  it("长序列不会累积明显的浮点误差", () => {
    const values = Array.from({ length: 5000 }, (_, i) => 80000 + Math.sin(i / 7) * 500);
    const out = sma(values, 99);
    const i = 4999;
    const direct = values.slice(i - 98, i + 1).reduce((a, b) => a + b, 0) / 99;
    expect(out[i]).toBeCloseTo(direct, 6);
  });
});

describe("ema", () => {
  it("第一个值是前 period 个数的平均，之后按 2/(n+1) 加权", () => {
    // 种子 (1+2+3)/3 = 2，权重 0.5：4*0.5+2*0.5 = 3，5*0.5+3*0.5 = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("恒定的输入得到恒定的输出", () => {
    expect(ema([10, 10, 10, 10, 10, 10], 4).slice(3)).toEqual([10, 10, 10]);
  });

  it("数据不足时全部为 null", () => {
    expect(ema([1, 2], 3)).toEqual([null, null]);
  });
});

describe("macd", () => {
  it("手算的小例子：快 2、慢 3、信号 2", () => {
    // EMA2: -,1.5,2.5,3.5,4.5,5.5   EMA3: -,-,2,3,4,5   DIF 从第 3 个数开始恒为 0.5
    const out = macd([1, 2, 3, 4, 5, 6], 2, 3, 2);
    expect(out.map((p) => p.dif)).toEqual([null, null, 0.5, 0.5, 0.5, 0.5]);
    expect(out.map((p) => p.dea)).toEqual([null, null, null, 0.5, 0.5, 0.5]);
    expect(out.map((p) => p.hist)).toEqual([null, null, null, 0, 0, 0]);
  });

  it("价格不变时三条线都是 0", () => {
    const out = macd(new Array(60).fill(100));
    expect(out[59]).toEqual({ dif: 0, dea: 0, hist: 0 });
    expect(out[24]).toEqual({ dif: null, dea: null, hist: null });
    expect(out[25]!.dif).toBe(0);
    expect(out[32]!.dea).toBeNull();
    expect(out[33]!.dea).toBe(0);
  });

  it("持续上涨时 DIF 为正，由涨转跌后柱子变负", () => {
    const up = Array.from({ length: 80 }, (_, i) => 100 + i);
    const down = Array.from({ length: 40 }, (_, i) => 179 - i * 2);
    const out = macd([...up, ...down]);
    expect(out[79]!.dif!).toBeGreaterThan(0);
    expect(out[119]!.hist!).toBeLessThan(0);
    expect(out[119]!.hist!).toBeCloseTo(out[119]!.dif! - out[119]!.dea!, 10);
  });

  it("输出长度与输入相同", () => {
    expect(macd([1, 2, 3])).toHaveLength(3);
    expect(macd([])).toEqual([]);
  });
});

describe("rsi", () => {
  it("手算的小例子：周期 2", () => {
    // 涨跌 +1 -1 +2。首个平均：涨 0.5 跌 0.5 → 50
    // 下一个：涨 (0.5+2)/2 = 1.25，跌 0.5/2 = 0.25 → 100 - 100/(1+5) = 83.33
    const out = rsi([10, 11, 10, 12], 2);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBe(50);
    expect(out[3]).toBeCloseTo(83.3333, 3);
  });

  it("一直涨是 100，一直跌是 0，完全不动是 50", () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const down = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(rsi(up)[29]).toBe(100);
    expect(rsi(down)[29]).toBe(0);
    expect(rsi(new Array(30).fill(100))[29]).toBe(50);
  });

  it("默认周期 14，第 15 个数才有值，结果在 0 到 100 之间", () => {
    const closes = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 5) * 10 + Math.cos(i / 13) * 4);
    const out = rsi(closes);
    expect(out[13]).toBeNull();
    expect(out[14]).not.toBeNull();
    for (const v of out.slice(14)) {
      expect(v!).toBeGreaterThanOrEqual(0);
      expect(v!).toBeLessThanOrEqual(100);
    }
  });

  it("数据不足时全部为 null", () => {
    expect(rsi([1, 2, 3], 14)).toEqual([null, null, null]);
  });
});

describe("parseMaPeriods", () => {
  it("支持中英文逗号、顿号和空格", () => {
    expect(parseMaPeriods("7, 25, 99")).toEqual([7, 25, 99]);
    expect(parseMaPeriods("5，10、20 60")).toEqual([5, 10, 20, 60]);
  });

  it("去重并从小到大排列", () => {
    expect(parseMaPeriods("99,7,25,7")).toEqual([7, 25, 99]);
  });

  it("最多 8 条，股票软件常用的 7 条可以直接填", () => {
    expect(parseMaPeriods("5,10,20,30,60,120,250")).toEqual([5, 10, 20, 30, 60, 120, 250]);
    expect(parseMaPeriods("2,3,4,5,6,7,8,9")).toHaveLength(8);
    expect(parseMaPeriods("2,3,4,5,6,7,8,9,10")).toBeNull();
  });

  it("拒绝空输入、非数字和越界", () => {
    expect(parseMaPeriods("")).toBeNull();
    expect(parseMaPeriods("  ,  ")).toBeNull();
    expect(parseMaPeriods("7, abc")).toBeNull();
    expect(parseMaPeriods("7.5")).toBeNull();
    expect(parseMaPeriods("-7")).toBeNull();
    expect(parseMaPeriods("1")).toBeNull();
    expect(parseMaPeriods("501")).toBeNull();
  });
});
