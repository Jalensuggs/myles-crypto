import { describe, expect, it } from "vitest";
import { indexToTime, timeToIndex } from "./time-index";

const bars = [1000, 1060, 1120, 1180].map((time) => ({ time }));

describe("timeToIndex", () => {
  it("K 线上的时间对应整数序号", () => {
    expect(timeToIndex(bars, 1000, 60)).toBe(0);
    expect(timeToIndex(bars, 1120, 60)).toBe(2);
    expect(timeToIndex(bars, 1180, 60)).toBe(3);
  });

  it("两根 K 线之间按比例插值", () => {
    expect(timeToIndex(bars, 1030, 60)).toBeCloseTo(0.5);
    expect(timeToIndex(bars, 1165, 60)).toBeCloseTo(2.75);
  });

  it("最后一根右侧（未来）按周期外推", () => {
    expect(timeToIndex(bars, 1240, 60)).toBe(4);
    expect(timeToIndex(bars, 1480, 60)).toBe(8);
  });

  it("第一根左侧按周期外推为负数", () => {
    expect(timeToIndex(bars, 880, 60)).toBe(-2);
  });

  it("没有数据时返回 null", () => {
    expect(timeToIndex([], 1000, 60)).toBeNull();
  });

  it("中间缺了几根 K 线时仍然落在正确的两根之间", () => {
    const gappy = [1000, 1060, 1300, 1360].map((time) => ({ time }));
    expect(timeToIndex(gappy, 1180, 60)).toBeCloseTo(1.5);
  });

  it("换成更大的周期后，同一个时间落在包含它的那根 K 线里", () => {
    const hourly = [0, 3600, 7200].map((time) => ({ time }));
    const index = timeToIndex(hourly, 3600 + 900, 3600)!;
    expect(Math.floor(index)).toBe(1);
  });
});

describe("indexToTime", () => {
  it("与 timeToIndex 互为逆运算", () => {
    for (const t of [1000, 1030, 1120, 1175, 1180, 1300, 940]) {
      const index = timeToIndex(bars, t, 60)!;
      expect(indexToTime(bars, index, 60)).toBeCloseTo(t);
    }
  });

  it("超出范围的序号按周期外推", () => {
    expect(indexToTime(bars, 5, 60)).toBe(1300);
    expect(indexToTime(bars, -1, 60)).toBe(940);
  });

  it("没有数据时返回 null", () => {
    expect(indexToTime([], 0, 60)).toBeNull();
  });
});
