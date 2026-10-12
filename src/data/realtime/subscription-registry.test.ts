import { describe, expect, it } from "vitest";
import { SubscriptionRegistry } from "./subscription-registry";

describe("SubscriptionRegistry", () => {
  it("只有第一个订阅者需要真正订阅", () => {
    const r = new SubscriptionRegistry<() => void>();
    const a = () => {};
    const b = () => {};
    expect(r.add("btc@kline_1m", a)).toBe(true);
    expect(r.add("btc@kline_1m", b)).toBe(false);
    expect(r.handlers("btc@kline_1m")).toHaveLength(2);
    expect(r.size).toBe(1);
  });

  it("只有最后一个订阅者离开才需要退订", () => {
    const r = new SubscriptionRegistry<() => void>();
    const a = () => {};
    const b = () => {};
    r.add("s", a);
    r.add("s", b);
    expect(r.remove("s", a)).toBe(false);
    expect(r.has("s")).toBe(true);
    expect(r.remove("s", b)).toBe(true);
    expect(r.has("s")).toBe(false);
    expect(r.activeStreams()).toEqual([]);
  });

  it("重复移除或移除不存在的订阅不会出错，也不会重复退订", () => {
    const r = new SubscriptionRegistry<() => void>();
    const a = () => {};
    r.add("s", a);
    expect(r.remove("s", a)).toBe(true);
    expect(r.remove("s", a)).toBe(false);
    expect(r.remove("missing", a)).toBe(false);
  });

  it("同一个处理函数重复加入只算一次", () => {
    const r = new SubscriptionRegistry<() => void>();
    const a = () => {};
    r.add("s", a);
    r.add("s", a);
    expect(r.handlers("s")).toHaveLength(1);
    expect(r.remove("s", a)).toBe(true);
  });

  it("列出全部活跃的流", () => {
    const r = new SubscriptionRegistry<() => void>();
    r.add("a", () => {});
    r.add("b", () => {});
    expect(r.activeStreams().sort()).toEqual(["a", "b"]);
  });
});
