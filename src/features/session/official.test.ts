import { describe, expect, it } from "vitest";
import type { Candle } from "@/types/market";
import { matchesContract, mergeOfficial } from "./official";

const c = (time: number, close: number, volume = 1): Candle => ({
  time,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume,
});

describe("mergeOfficial", () => {
  const official = [c(10, 100, 9000), c(20, 101, 9000), c(30, 102, 9000), c(40, 103, 9000)];

  it("历史用官方的，从官方最后一根起用合约的", () => {
    const contract = [c(20, 101.1), c(30, 102.1), c(40, 103.1), c(50, 104.1)];
    const merged = mergeOfficial(contract, official);
    expect(merged.map((x) => [x.time, x.close])).toEqual([
      [10, 100],
      [20, 101],
      [30, 102],
      [40, 103.1],
      [50, 104.1],
    ]);
    // 历史部分的成交量也是官方的
    expect(merged[1]!.volume).toBe(9000);
    expect(merged[3]!.volume).toBe(1);
  });

  it("比官方数据更早的部分用合约补上", () => {
    const contract = [c(1, 90), c(5, 95), c(10, 100.1), c(40, 103.1)];
    expect(mergeOfficial(contract, official).map((x) => x.time)).toEqual([1, 5, 10, 20, 30, 40]);
    expect(mergeOfficial(contract, official)[2]!.close).toBe(100);
  });

  it("合约没有对应的最后一根时保留官方的", () => {
    expect(mergeOfficial([c(50, 104)], official).map((x) => [x.time, x.close])).toEqual([
      [10, 100],
      [20, 101],
      [30, 102],
      [40, 103],
      [50, 104],
    ]);
    expect(mergeOfficial([], official)).toEqual(official);
  });

  it("结果时间严格递增、没有重复", () => {
    const contract = [c(5, 95), c(10, 100), c(20, 101), c(30, 102), c(40, 103), c(50, 104)];
    const times = mergeOfficial(contract, official).map((x) => x.time);
    expect(times).toEqual([5, 10, 20, 30, 40, 50]);
  });

  it("官方最后一根已经走完时保留它，只把之后的交给合约", () => {
    const contract = [c(30, 102.1), c(40, 103.1), c(50, 104.1)];
    const merged = mergeOfficial(contract, official, () => true);
    expect(merged.map((x) => [x.time, x.close])).toEqual([
      [10, 100],
      [20, 101],
      [30, 102],
      [40, 103],
      [50, 104.1],
    ]);
    expect(merged[3]!.volume).toBe(9000);
  });

  it("是否走完只看官方的最后一根", () => {
    const seen: number[] = [];
    mergeOfficial([c(40, 103.1)], official, (candle) => {
      seen.push(candle.time);
      return false;
    });
    expect(seen).toEqual([40]);
  });

  it("官方数据太少时直接用合约的", () => {
    const contract = [c(10, 100), c(20, 101)];
    expect(mergeOfficial(contract, [c(10, 99)])).toEqual(contract);
    expect(mergeOfficial(contract, [])).toEqual(contract);
  });

  it("不修改传入的数组", () => {
    const contract = [c(40, 103.1), c(50, 104.1)];
    const before = JSON.stringify([contract, official]);
    mergeOfficial(contract, official);
    expect(JSON.stringify([contract, official])).toBe(before);
  });
});

describe("matchesContract", () => {
  const official = [c(10, 100), c(20, 101), c(30, 102), c(40, 103)];

  it("重叠的 K 线价格接近时认为是同一只股票", () => {
    expect(matchesContract(official, [c(20, 101.2), c(30, 101.9), c(40, 103.1)])).toBe(true);
  });

  it("价格差得远时拒绝（代码对应到了另一只股票）", () => {
    expect(matchesContract(official, [c(20, 55), c(30, 56), c(40, 57)])).toBe(false);
    expect(matchesContract(official, [c(20, 106), c(30, 107), c(40, 108.5)])).toBe(false);
  });

  it("个别 K 线偏差大不影响整体判断", () => {
    expect(matchesContract(official, [c(10, 100), c(20, 101), c(30, 102), c(40, 120)])).toBe(true);
  });

  it("重叠太少时无法核对，拒绝", () => {
    expect(matchesContract(official, [c(40, 103), c(50, 104)])).toBe(false);
    expect(matchesContract(official, [])).toBe(false);
    expect(matchesContract([], [c(10, 100)])).toBe(false);
  });
});
