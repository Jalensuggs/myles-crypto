import { describe, expect, it } from "vitest";
import { parseYahooChart, stockTicker, yahooChartUrl } from "./yahoo";

const at = (iso: string) => Date.parse(iso) / 1000;

function chart(rows: [string, number | null, number | null, number | null, number | null, number | null][]) {
  return {
    chart: {
      result: [
        {
          meta: { symbol: "MU" },
          timestamp: rows.map((r) => at(r[0])),
          indicators: {
            quote: [
              {
                open: rows.map((r) => r[1]),
                high: rows.map((r) => r[2]),
                low: rows.map((r) => r[3]),
                close: rows.map((r) => r[4]),
                volume: rows.map((r) => r[5]),
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

describe("地址", () => {
  it("合约名换成股票代码", () => {
    expect(stockTicker("AAPLUSDT")).toBe("AAPL");
    expect(stockTicker("muusdt")).toBe("MU");
  });

  it("各周期请求能取到的最长范围", () => {
    expect(yahooChartUrl("MUUSDT", "1d", "/yahoo")).toBe(
      "/yahoo/v8/finance/chart/MU?interval=1d&range=10y&includePrePost=false",
    );
    expect(yahooChartUrl("MUUSDT", "15m", "/yahoo")).toContain("interval=15m&range=60d");
    expect(yahooChartUrl("MUUSDT", "1m", "/yahoo")).toContain("interval=1m&range=7d");
    // 没有现成的 4 小时线，用 60 分钟线合成
    expect(yahooChartUrl("MUUSDT", "1h", "/yahoo")).toContain("interval=60m&range=730d");
    expect(yahooChartUrl("MUUSDT", "4h", "/yahoo")).toContain("interval=60m&range=730d");
  });
});

describe("parseYahooChart", () => {
  it("日内：保留交易时段内的 K 线，去掉 16:00 整的收盘竞价记录", () => {
    const candles = parseYahooChart(
      chart([
        ["2026-10-09T13:30:00Z", 1052.51, 1053.58, 1037.03, 1039.27, 900000],
        ["2026-10-09T13:45:00Z", 1039.3, 1041, 1030.5, 1032, 500000],
        ["2026-10-09T19:45:00Z", 1027, 1030, 1026, 1029, 800000],
        ["2026-10-09T20:00:00Z", 1029, 1029, 1029, 1029, 0],
      ]),
      "15m",
    );
    expect(candles.map((c) => c.time)).toEqual([
      at("2026-10-09T13:30:00Z"),
      at("2026-10-09T13:45:00Z"),
      at("2026-10-09T19:45:00Z"),
    ]);
    expect(candles[0]).toEqual({
      time: at("2026-10-09T13:30:00Z"),
      open: 1052.51,
      high: 1053.58,
      low: 1037.03,
      close: 1039.27,
      volume: 900000,
    });
  });

  it("跳过没有成交的空记录", () => {
    const candles = parseYahooChart(
      chart([
        ["2026-10-09T13:30:00Z", 10, 11, 9, 10.5, 100],
        ["2026-10-09T13:45:00Z", null, null, null, null, null],
        ["2026-10-09T14:00:00Z", 10.5, 12, 10, 11, 200],
      ]),
      "15m",
    );
    expect(candles).toHaveLength(2);
  });

  it("修正最高价、最低价的舍入误差，而不是丢掉整根 K 线", () => {
    const [c] = parseYahooChart(chart([["2026-10-09T13:30:00Z", 100.02, 100.01, 99.5, 99.4, 10]]), "15m");
    expect(c).toMatchObject({ open: 100.02, high: 100.02, low: 99.4, close: 99.4 });
  });

  it("日线：时间统一为当天 9:30 开盘的时刻", () => {
    const candles = parseYahooChart(
      chart([
        ["2026-10-08T13:30:00Z", 1040, 1095, 1020, 1035.84, 3e7],
        // 当天未收盘时接口给的是最新成交时间
        ["2026-10-09T18:12:07Z", 1054.17, 1054.17, 1017, 1029, 2e7],
      ]),
      "1d",
    );
    expect(candles.map((c) => c.time)).toEqual([at("2026-10-08T13:30:00Z"), at("2026-10-09T13:30:00Z")]);
    expect(candles[1]!.close).toBe(1029);
  });

  it("日线做前复权：按分红后的收盘价等比例调整开高低收，成交量不变", () => {
    const json = chart([
      ["2025-10-09T13:30:00Z", 190, 195, 188, 192.77, 1000],
      ["2026-10-09T13:30:00Z", 1054.17, 1054.17, 1017, 1029, 2000],
    ]);
    (json.chart.result[0]!.indicators as Record<string, unknown>).adjclose = [{ adjclose: [192.582, 1029] }];
    const [old, recent] = parseYahooChart(json, "1d");
    const factor = 192.582 / 192.77;
    expect(old!.close).toBeCloseTo(192.582, 6);
    expect(old!.open).toBeCloseTo(190 * factor, 6);
    expect(old!.high).toBeCloseTo(195 * factor, 6);
    expect(old!.low).toBeCloseTo(188 * factor, 6);
    expect(old!.volume).toBe(1000);
    // 最近的 K 线比例为 1，价格不变
    expect(recent).toMatchObject({ open: 1054.17, high: 1054.17, low: 1017, close: 1029 });
  });

  it("日内周期不做复权", () => {
    const json = chart([["2026-10-09T13:30:00Z", 100, 101, 99, 100, 10]]);
    (json.chart.result[0]!.indicators as Record<string, unknown>).adjclose = [{ adjclose: [50] }];
    expect(parseYahooChart(json, "15m")[0]!.close).toBe(100);
  });

  it("日线：冬令时的开盘时刻是 14:30 UTC", () => {
    const [c] = parseYahooChart(chart([["2026-12-01T14:30:00Z", 10, 11, 9, 10, 1]]), "1d");
    expect(c!.time).toBe(at("2026-12-01T14:30:00Z"));
  });

  it("1 小时线直接使用，一天 7 根", () => {
    const hours = ["13:30", "14:30", "15:30", "16:30", "17:30", "18:30", "19:30"];
    const candles = parseYahooChart(
      chart(hours.map((h, i) => [`2026-10-09T${h}:00Z`, 100 + i, 101 + i, 99 + i, 100.5 + i, 10])),
      "1h",
    );
    expect(candles).toHaveLength(7);
  });

  it("4 小时线由 60 分钟线合成：9:30–13:30 和 13:30–16:00", () => {
    const hours = ["13:30", "14:30", "15:30", "16:30", "17:30", "18:30", "19:30"];
    const candles = parseYahooChart(
      chart(hours.map((h, i) => [`2026-10-09T${h}:00Z`, 100 + i, 101 + i, 99 + i, 100.5 + i, 10])),
      "4h",
    );
    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({ time: at("2026-10-09T13:30:00Z"), open: 100, close: 103.5, high: 104, low: 99, volume: 40 });
    expect(candles[1]).toMatchObject({ time: at("2026-10-09T17:30:00Z"), open: 104, close: 106.5, volume: 30 });
  });

  it("时间乱序或重复时整理好", () => {
    const candles = parseYahooChart(
      chart([
        ["2026-10-09T14:00:00Z", 2, 3, 1, 2, 1],
        ["2026-10-09T13:30:00Z", 1, 2, 1, 1.5, 1],
        ["2026-10-09T14:00:00Z", 2, 4, 1, 3, 1],
      ]),
      "30m",
    );
    expect(candles.map((c) => c.time)).toEqual([at("2026-10-09T13:30:00Z"), at("2026-10-09T14:00:00Z")]);
    expect(candles[1]!.close).toBe(3);
  });

  it("没有这只股票时返回空数组，格式不对时抛错", () => {
    expect(parseYahooChart({ chart: { result: null, error: { code: "Not Found" } } }, "1d")).toEqual([]);
    expect(parseYahooChart({ chart: { result: [{ indicators: { quote: [{ open: [], high: [], low: [], close: [], volume: [] }] } }] } }, "1d")).toEqual([]);
    expect(() => parseYahooChart("Too Many Requests", "1d")).toThrow();
    expect(() => parseYahooChart({ finance: {} }, "1d")).toThrow();
  });
});
