import { describe, expect, it } from "vitest";
import { baseAsset, displayName, marketKey, marketTypeLabel, marketTypeLongLabel, perp, spot } from "./market";

describe("标的名称", () => {
  it("加密永续合约带 .P，现货不带", () => {
    expect(displayName(perp("BTCUSDT"))).toBe("BTCUSDT.P");
    expect(displayName(spot("BTCUSDT"))).toBe("BTCUSDT");
  });

  it("美股和商品只显示代码本身", () => {
    expect(displayName(perp("AAPLUSDT", "stock"))).toBe("AAPL");
    expect(displayName(perp("XAUUSDT", "commodity"))).toBe("XAU");
    expect(displayName(perp("SAMSUNGUSDT", "other"))).toBe("SAMSUNG");
  });

  it("类型标签", () => {
    expect(marketTypeLabel(spot("BTCUSDT"))).toBe("现货");
    expect(marketTypeLabel(perp("BTCUSDT"))).toBe("永续");
    expect(marketTypeLabel(perp("AAPLUSDT", "stock"))).toBe("美股");
    expect(marketTypeLabel(perp("XAUUSDT", "commodity"))).toBe("商品");
    expect(marketTypeLongLabel(perp("AAPLUSDT", "stock"))).toBe("美股合约");
    expect(marketTypeLongLabel(spot("BTCUSDT"))).toBe("现货");
  });

  it("分类不参与标的的唯一标识", () => {
    expect(marketKey(perp("AAPLUSDT", "stock"))).toBe("binance:perp:AAPLUSDT");
    expect(marketKey(perp("AAPLUSDT"))).toBe("binance:perp:AAPLUSDT");
    expect(marketKey(spot("BTCUSDT"))).not.toBe(marketKey(perp("BTCUSDT")));
  });

  it("perp 不会给加密货币写多余的分类字段", () => {
    expect(perp("BTCUSDT", "crypto")).toEqual({ exchange: "binance", market: "perp", symbol: "BTCUSDT" });
  });

  it("去掉计价币种得到代码", () => {
    expect(baseAsset("BTCUSDT")).toBe("BTC");
    expect(baseAsset("1000PEPEUSDT")).toBe("1000PEPE");
    expect(baseAsset("USDT")).toBe("USDT");
  });
});
