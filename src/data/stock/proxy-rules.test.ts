import { describe, expect, it } from "vitest";
import { TIMEFRAMES } from "@/types/market";
import { upstreamUrl } from "./proxy-rules";
import { yahooChartUrl } from "./yahoo";

const q = (text: string) => new URLSearchParams(text);

describe("线上转发的放行规则", () => {
  it("放行股票图表请求，只带上固定的三个参数", () => {
    expect(upstreamUrl("v8/finance/chart/AAPL", q("interval=1d&range=10y&includePrePost=false"))).toBe(
      "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=10y&includePrePost=false",
    );
    expect(upstreamUrl("/v8/finance/chart/BRK-B", q("interval=15m&range=60d"))).toContain("/chart/BRK-B?interval=15m");
  });

  it("多余的参数不会被转发", () => {
    const url = upstreamUrl("v8/finance/chart/MU", q("interval=1d&range=1mo&crumb=abc&events=div&includePrePost=true"))!;
    expect(new URL(url).search).toBe("?interval=1d&range=1mo&includePrePost=false");
  });

  it("应用实际会发出的每一种请求都在放行范围内", () => {
    for (const timeframe of TIMEFRAMES) {
      const url = new URL(yahooChartUrl("NVDAUSDT", timeframe, "https://x.test/yahoo"));
      const path = url.pathname.replace(/^\/yahoo\//, "");
      expect(upstreamUrl(path, url.searchParams), timeframe).not.toBeNull();
    }
    // 取最近几天日线用的范围
    expect(upstreamUrl("v8/finance/chart/NVDA", q("interval=1d&range=1mo"))).not.toBeNull();
  });

  it("拒绝其他接口和路径穿越", () => {
    const ok = q("interval=1d&range=10y");
    expect(upstreamUrl("v7/finance/quote", ok)).toBeNull();
    expect(upstreamUrl("v8/finance/chart/AAPL/../../v1/test", ok)).toBeNull();
    expect(upstreamUrl("v8/finance/chart/", ok)).toBeNull();
    expect(upstreamUrl("v8/finance/chart/aapl", ok)).toBeNull();
    expect(upstreamUrl("v8/finance/chart/AAPL?x=1", ok)).toBeNull();
    expect(upstreamUrl("https://evil.example/v8/finance/chart/AAPL", ok)).toBeNull();
    expect(upstreamUrl("", ok)).toBeNull();
  });

  it("拒绝不在固定取值里的周期和范围", () => {
    expect(upstreamUrl("v8/finance/chart/AAPL", q("interval=1s&range=10y"))).toBeNull();
    expect(upstreamUrl("v8/finance/chart/AAPL", q("interval=1d&range=max"))).toBeNull();
    expect(upstreamUrl("v8/finance/chart/AAPL", q("interval=1d"))).toBeNull();
    expect(upstreamUrl("v8/finance/chart/AAPL", q(""))).toBeNull();
  });
});
