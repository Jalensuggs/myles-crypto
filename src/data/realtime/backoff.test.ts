import { describe, expect, it } from "vitest";
import { backoffDelay } from "./backoff";

describe("backoffDelay", () => {
  const mid = () => 0.5;

  it("按 1s 2s 4s 8s 15s 递增", () => {
    expect([0, 1, 2, 3, 4].map((n) => backoffDelay(n, mid))).toEqual([1000, 2000, 4000, 8000, 15000]);
  });

  it("超过最大次数后保持 15s", () => {
    expect(backoffDelay(5, mid)).toBe(15000);
    expect(backoffDelay(99, mid)).toBe(15000);
  });

  it("抖动范围是正负 20%", () => {
    expect(backoffDelay(0, () => 0)).toBe(800);
    expect(backoffDelay(0, () => 1)).toBe(1200);
    expect(backoffDelay(4, () => 0)).toBe(12000);
    expect(backoffDelay(4, () => 1)).toBe(18000);
  });

  it("非法次数按第一次处理", () => {
    expect(backoffDelay(-3, mid)).toBe(1000);
  });
});
