import { describe, expect, it } from "vitest";
import { exchangeInfoUrl, klinesUrl, openInterestUrl, streams, ticker24hUrl, wsUrl } from "./endpoints";

const cfg = {
  futuresRest: "https://f.example",
  spotRest: "https://s.example",
  futuresWs: "wss://f.example/market/stream",
  spotWs: "wss://s.example/stream",
};

describe("klinesUrl", () => {
  it("合约走 fapi，默认每页 1000 根", () => {
    expect(klinesUrl({ market: "perp", symbol: "BTCUSDT", timeframe: "15m" }, cfg)).toBe(
      "https://f.example/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=1000",
    );
  });

  it("现货走 api/v3", () => {
    expect(klinesUrl({ market: "spot", symbol: "ETHUSDT", timeframe: "1d", limit: 50 }, cfg)).toBe(
      "https://s.example/api/v3/klines?symbol=ETHUSDT&interval=1d&limit=50",
    );
  });

  it("翻页时带上取整后的 endTime", () => {
    const url = klinesUrl({ market: "perp", symbol: "BTCUSDT", timeframe: "1h", endTime: 1700000000123.9 }, cfg);
    expect(new URL(url).searchParams.get("endTime")).toBe("1700000000123");
  });

  it("标的名统一转成大写", () => {
    expect(klinesUrl({ market: "perp", symbol: "btcusdt", timeframe: "1m" }, cfg)).toContain("symbol=BTCUSDT");
  });

  it("切换周期会体现在 interval 参数上", () => {
    const a = klinesUrl({ market: "perp", symbol: "BTCUSDT", timeframe: "15m" }, cfg);
    const b = klinesUrl({ market: "perp", symbol: "BTCUSDT", timeframe: "1h" }, cfg);
    expect(new URL(a).searchParams.get("interval")).toBe("15m");
    expect(new URL(b).searchParams.get("interval")).toBe("1h");
  });
});

describe("其他地址", () => {
  it("按市场选择行情列表和 WebSocket 地址", () => {
    expect(ticker24hUrl("perp", cfg)).toBe("https://f.example/fapi/v1/ticker/24hr");
    expect(ticker24hUrl("spot", cfg)).toBe("https://s.example/api/v3/ticker/24hr");
    expect(ticker24hUrl("perp", cfg, "aaplusdt")).toBe("https://f.example/fapi/v1/ticker/24hr?symbol=AAPLUSDT");
    expect(wsUrl("perp", cfg)).toBe("wss://f.example/market/stream");
    expect(wsUrl("spot", cfg)).toBe("wss://s.example/stream");
    expect(openInterestUrl("btcusdt", cfg)).toBe("https://f.example/fapi/v1/openInterest?symbol=BTCUSDT");
    expect(exchangeInfoUrl(cfg)).toBe("https://f.example/fapi/v1/exchangeInfo");
  });

  it("流名使用小写标的", () => {
    expect(streams.kline("BTCUSDT", "1m")).toBe("btcusdt@kline_1m");
    expect(streams.miniTicker("BTCUSDT")).toBe("btcusdt@miniTicker");
    expect(streams.markPrice("BTCUSDT")).toBe("btcusdt@markPrice@1s");
    expect(streams.allForceOrders).toBe("!forceOrder@arr");
  });
});
