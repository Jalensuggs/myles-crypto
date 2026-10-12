import { describe, expect, it } from "vitest";
import {
  parseTickerSnapshot,
  parseContractCategories,
  parseKlines,
  parseSymbols,
  parseWsDerivatives,
  parseWsKline,
  parseWsLiquidation,
  parseWsTicker,
} from "./parse";

const row = (t: number, o: string, h: string, l: string, c: string, v = "1.5") => [t, o, h, l, c, v, t + 59999, "0", 1, "0", "0", "0"];

describe("parseKlines", () => {
  it("把毫秒时间转成秒并解析数字", () => {
    const page = parseKlines([row(1700000040000, "100.10", "101.00", "99.50", "100.70")]);
    expect(page.candles).toEqual([{ time: 1700000040, open: 100.1, high: 101, low: 99.5, close: 100.7, volume: 1.5 }]);
  });

  it("从原始字符串推断价格精度，忽略尾部的 0", () => {
    expect(parseKlines([row(60000, "84224.02000000", "84344.00000000", "83962.00000000", "83991.51000000")]).precision).toBe(2);
    expect(parseKlines([row(60000, "0.08724", "0.08730", "0.08710", "0.08725")]).precision).toBe(5);
    expect(parseKlines([row(60000, "100", "101", "99", "100")]).precision).toBe(1);
  });

  it("乱序和重复的数据会被整理好", () => {
    const page = parseKlines([row(120000, "1", "2", "1", "2"), row(60000, "1", "2", "1", "1"), row(120000, "1", "3", "1", "3")]);
    expect(page.candles.map((c) => c.time)).toEqual([60, 120]);
    expect(page.candles[1]!.close).toBe(3);
  });

  it("格式不对时抛出错误而不是返回脏数据", () => {
    expect(() => parseKlines({ code: -1121, msg: "Invalid symbol." })).toThrow();
    expect(() => parseKlines([[1, "abc", "1", "1", "1", "1"]])).toThrow();
  });
});

const tickers = [
  { symbol: "ETHUSDT", lastPrice: "2500", priceChangePercent: "1.5", quoteVolume: "100" },
  { symbol: "BTCUSDT", lastPrice: "84000", priceChangePercent: "-0.5", quoteVolume: "900" },
  { symbol: "AAPLUSDT", lastPrice: "338", priceChangePercent: "0.2", quoteVolume: "300" },
  { symbol: "XAUUSDT", lastPrice: "4180", priceChangePercent: "-0.1", quoteVolume: "200" },
  { symbol: "SAMSUNGUSDT", lastPrice: "188", priceChangePercent: "0", quoteVolume: "50" },
  { symbol: "OLDUSDT", lastPrice: "1", priceChangePercent: "0", quoteVolume: "70" },
  { symbol: "ETHBTC", lastPrice: "0.03", priceChangePercent: "0", quoteVolume: "5000" },
  { symbol: "DEADUSDT", lastPrice: "0", priceChangePercent: "0", quoteVolume: "0" },
  { symbol: "BTCUSDT_261225", lastPrice: "85000", priceChangePercent: "0", quoteVolume: "50" },
];

const contract = (symbol: string, underlyingType: string | undefined, extra: Record<string, string> = {}) => ({
  symbol,
  status: "TRADING",
  quoteAsset: "USDT",
  contractType: "PERPETUAL",
  ...(underlyingType ? { underlyingType } : {}),
  ...extra,
});

describe("parseContractCategories", () => {
  const categories = parseContractCategories({
    symbols: [
      contract("BTCUSDT", "COIN"),
      contract("BTCDOMUSDT", "INDEX"),
      contract("AAPLUSDT", "EQUITY", { contractType: "TRADIFI_PERPETUAL" }),
      contract("XAUUSDT", "COMMODITY", { contractType: "TRADIFI_PERPETUAL" }),
      contract("SAMSUNGUSDT", "KR_EQUITY"),
      contract("USDBRLUSDT", "FX"),
      contract("NEWTHINGUSDT", "SOMETHING_NEW"),
      contract("NOTYPEUSDT", undefined),
      contract("OLDUSDT", "COIN", { status: "SETTLING" }),
      contract("BTCUSDC", "COIN", { quoteAsset: "USDC" }),
      contract("BTCUSDT_261225", "COIN", { contractType: "CURRENT_QUARTER" }),
    ],
  });

  it("美股、商品和加密货币各归各类", () => {
    expect(categories.get("BTCUSDT")).toBe("crypto");
    expect(categories.get("BTCDOMUSDT")).toBe("crypto");
    expect(categories.get("AAPLUSDT")).toBe("stock");
    expect(categories.get("XAUUSDT")).toBe("commodity");
  });

  it("韩股、外汇和不认识的类型归为其他，没写类型的按加密货币处理", () => {
    expect(categories.get("SAMSUNGUSDT")).toBe("other");
    expect(categories.get("USDBRLUSDT")).toBe("other");
    expect(categories.get("NEWTHINGUSDT")).toBe("other");
    expect(categories.get("NOTYPEUSDT")).toBe("crypto");
  });

  it("排除已下架、非 USDT 计价和交割合约", () => {
    expect(categories.has("OLDUSDT")).toBe(false);
    expect(categories.has("BTCUSDC")).toBe(false);
    expect(categories.has("BTCUSDT_261225")).toBe(false);
  });

  it("格式不对时抛出错误", () => {
    expect(() => parseContractCategories({ code: -1 })).toThrow();
  });
});

describe("parseSymbols", () => {
  it("只保留 USDT 计价、有成交的标的并按成交额降序", () => {
    const list = parseSymbols(tickers, "spot");
    expect(list.map((s) => s.symbol)).toEqual(["BTCUSDT", "AAPLUSDT", "XAUUSDT", "ETHUSDT", "OLDUSDT", "SAMSUNGUSDT"]);
    expect(list[0]).toEqual({
      symbol: "BTCUSDT",
      market: "spot",
      category: "crypto",
      last: 84000,
      changePct: -0.5,
      quoteVolume: 900,
    });
  });

  it("有分类表时带上分类，并去掉表里没有的标的（例如已下架的）", () => {
    const categories = new Map([
      ["BTCUSDT", "crypto"],
      ["ETHUSDT", "crypto"],
      ["AAPLUSDT", "stock"],
      ["XAUUSDT", "commodity"],
      ["SAMSUNGUSDT", "other"],
    ] as const);
    const list = parseSymbols(tickers, "perp", categories);
    expect(list.map((s) => [s.symbol, s.category])).toEqual([
      ["BTCUSDT", "crypto"],
      ["AAPLUSDT", "stock"],
      ["XAUUSDT", "commodity"],
      ["ETHUSDT", "crypto"],
      ["SAMSUNGUSDT", "other"],
    ]);
    expect(list.every((s) => s.market === "perp")).toBe(true);
  });
});

describe("parseTickerSnapshot", () => {
  it("解析单个标的的行情快照", () => {
    const t = parseTickerSnapshot({
      symbol: "AAPLUSDT",
      lastPrice: "337.86000",
      openPrice: "330.00000",
      highPrice: "339.10000",
      lowPrice: "329.50000",
      quoteVolume: "10200000.5",
      priceChangePercent: "2.382",
    });
    expect(t.last).toBe(337.86);
    expect(t.open24h).toBe(330);
    expect(t.high24h).toBe(339.1);
    expect(t.low24h).toBe(329.5);
    expect(t.quoteVolume24h).toBe(10200000.5);
    expect(t.changePct).toBeCloseTo(2.3818, 3);
  });

  it("格式不对时抛出错误", () => {
    expect(() => parseTickerSnapshot({ code: -1121, msg: "Invalid symbol." })).toThrow();
  });
});

describe("WebSocket 消息", () => {
  it("解析 K 线", () => {
    const parsed = parseWsKline({
      e: "kline",
      s: "BTCUSDT",
      k: { t: 1700000040000, i: "1m", o: "100", h: "102", l: "99", c: "101", v: "12", x: true },
    });
    expect(parsed).toEqual({
      candle: { time: 1700000040, open: 100, high: 102, low: 99, close: 101, volume: 12 },
      closed: true,
    });
  });

  it("解析最新价并计算 24 小时涨跌幅", () => {
    const t = parseWsTicker({ e: "24hrMiniTicker", s: "BTCUSDT", c: "110", o: "100", h: "112", l: "98", q: "5000" });
    expect(t).toEqual({ last: 110, open24h: 100, high24h: 112, low24h: 98, quoteVolume24h: 5000, changePct: 10 });
  });

  it("解析资金费率，空字符串按 0 处理", () => {
    expect(parseWsDerivatives({ e: "markPriceUpdate", s: "BTCUSDT", p: "83673.8", r: "0.00002670", T: 1700 })).toEqual({
      markPrice: 83673.8,
      fundingRate: 0.0000267,
      nextFundingTime: 1700,
    });
    expect(parseWsDerivatives({ e: "markPriceUpdate", s: "BTCUSDT", p: "1", r: "", T: 1 })?.fundingRate).toBe(0);
  });

  it("强平卖单是多单爆仓，买单是空单爆仓", () => {
    const sell = parseWsLiquidation({ e: "forceOrder", o: { s: "BTCUSDT", S: "SELL", q: "2", p: "83000", ap: "84000", T: 5 } });
    expect(sell).toEqual({ symbol: "BTCUSDT", side: "long", price: 84000, quantity: 2, notional: 168000, time: 5 });
    const buy = parseWsLiquidation({ e: "forceOrder", o: { s: "BTCUSDT", S: "BUY", q: "1", p: "83000", ap: "0", T: 5 } });
    expect(buy?.side).toBe("short");
    expect(buy?.price).toBe(83000);
  });

  it("无法识别的消息返回 null", () => {
    expect(parseWsKline({ result: null, id: 1 })).toBeNull();
    expect(parseWsTicker({ e: "kline" })).toBeNull();
    expect(parseWsDerivatives(null)).toBeNull();
    expect(parseWsLiquidation("oops")).toBeNull();
  });
});
