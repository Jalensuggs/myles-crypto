import { z } from "zod";
import { aggregateSession } from "@/features/session/aggregate";
import { isUsRegularSession, isUsTradingDay, sessionOpenTime, sessionPosition } from "@/features/session/us-session";
import { baseAsset, type Candle, type Timeframe } from "@/types/market";

/**
 * 美股的官方历史 K 线，来自 Yahoo 财经的图表接口。
 * 这不是一个正式对外的接口：没有文档、没有可用性保证，随时可能变化或限流。
 * 所以这里的任何失败都只意味着"没有官方历史"，调用方会退回合约数据。
 */

const env: Record<string, string | undefined> =
  (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

/** 转发地址的前缀；设为 off 表示不使用官方历史 */
export const STOCK_HISTORY_BASE = (env.VITE_STOCK_HISTORY_BASE ?? "/yahoo").replace(/\/+$/, "");

const REQUEST_TIMEOUT_MS = 8_000;
const RETRY_DELAY_MS = 700;

interface YahooPlan {
  interval: string;
  /** 这个周期能取到的最长范围 */
  range: string;
  stepSeconds: number;
  /** 需要再合成时，每多少分钟一根 */
  groupMinutes: number | null;
}

const PLANS: Record<Timeframe, YahooPlan> = {
  "1m": { interval: "1m", range: "7d", stepSeconds: 60, groupMinutes: null },
  "5m": { interval: "5m", range: "60d", stepSeconds: 300, groupMinutes: null },
  "15m": { interval: "15m", range: "60d", stepSeconds: 900, groupMinutes: null },
  "30m": { interval: "30m", range: "60d", stepSeconds: 1800, groupMinutes: null },
  // 它的 60 分钟线从 9:30 起算，和这里合成小时线的切法一致
  "1h": { interval: "60m", range: "730d", stepSeconds: 3600, groupMinutes: null },
  "4h": { interval: "60m", range: "730d", stepSeconds: 3600, groupMinutes: 240 },
  "1d": { interval: "1d", range: "10y", stepSeconds: 86400, groupMinutes: null },
  // 周线和月线由日线归并而来，取数时和日线相同
  "1w": { interval: "1d", range: "10y", stepSeconds: 86400, groupMinutes: null },
  "1M": { interval: "1d", range: "10y", stepSeconds: 86400, groupMinutes: null },
};

/** 合约名对应的股票代码，例如 AAPLUSDT → AAPL */
export function stockTicker(symbol: string): string {
  return baseAsset(symbol.toUpperCase());
}

export function yahooChartUrl(symbol: string, timeframe: Timeframe, base: string = STOCK_HISTORY_BASE): string {
  const plan = PLANS[timeframe];
  const params = new URLSearchParams({ interval: plan.interval, range: plan.range, includePrePost: "false" });
  return `${base}/v8/finance/chart/${encodeURIComponent(stockTicker(symbol))}?${params.toString()}`;
}

const column = z.array(z.number().nullable());

export const yahooChartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          timestamp: z.array(z.number()).optional(),
          indicators: z.object({
            quote: z.array(z.object({ open: column, high: column, low: column, close: column, volume: column })).min(1),
            // 只有日线有：考虑分红后的收盘价
            adjclose: z.array(z.object({ adjclose: column })).optional(),
          }),
        }),
      )
      .nullable(),
  }),
});

/**
 * 把接口返回的数据整理成图表周期对应的、只含常规交易时段的 K 线。
 * adjust 为 false 时日线不做前复权，保留真实的收盘价（用作涨跌幅的基准）。
 */
export function parseYahooChart(json: unknown, timeframe: Timeframe, adjust = true): Candle[] {
  const result = yahooChartSchema.parse(json).chart.result?.[0];
  const times = result?.timestamp;
  if (!result || !times) return [];
  const quote = result.indicators.quote[0]!;
  const adjusted = result.indicators.adjclose?.[0]?.adjclose;
  const plan = PLANS[timeframe];
  const daily = plan.stepSeconds >= 86400;
  const byTime = new Map<number, Candle>();

  for (let i = 0; i < times.length; i++) {
    const open = quote.open[i];
    const high = quote.high[i];
    const low = quote.low[i];
    const close = quote.close[i];
    // 停牌或没有成交的时段各项为 null
    if (open == null || high == null || low == null || close == null) continue;
    if (!(open > 0 && high > 0 && low > 0 && close > 0)) continue;

    let time = times[i]!;
    if (daily) {
      // 日线统一以当天 9:30 开盘的时刻为时间，和用合约合成的日线对齐。
      // 当天还没收盘时，接口给的是最新成交时间而不是开盘时间，这里一并校正。
      const { day } = sessionPosition(time);
      if (!isUsTradingDay(day)) continue;
      time = sessionOpenTime(day);
    } else if (!isUsRegularSession(time, plan.stepSeconds)) {
      // 去掉 16:00 整那一笔收盘竞价等不属于交易时段的记录
      continue;
    }

    // 日线做前复权：历史价格按分红比例下调，和国内股票软件的默认口径一致。
    // 越靠近现在比例越接近 1，所以和合约的实时价格之间不会出现断层。
    const adj = daily && adjust ? adjusted?.[i] : null;
    const factor = adj != null && adj > 0 ? adj / close : 1;

    byTime.set(time, {
      time,
      open: open * factor,
      // 偶尔会出现最高价略低于开盘价这类舍入误差，这里修正而不是丢弃整根 K 线
      high: Math.max(open, high, low, close) * factor,
      low: Math.min(open, high, low, close) * factor,
      close: close * factor,
      volume: Math.max(0, quote.volume[i] ?? 0),
    });
  }

  const candles = [...byTime.values()].sort((a, b) => a.time - b.time);
  return plan.groupMinutes ? aggregateSession(candles, plan.groupMinutes) : candles;
}

async function getChart(url: string, signal?: AbortSignal): Promise<unknown | null> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const options = { signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
  let res = await fetch(url, options);
  if (res.status === 429) {
    // 偶发的限流，稍等再试一次；还不行就放弃，由调用方退回合约数据
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    res = await fetch(url, options);
  }
  return res.ok ? res.json() : null;
}

export async function fetchStockHistory(
  symbol: string,
  timeframe: Timeframe,
  signal?: AbortSignal,
  base: string = STOCK_HISTORY_BASE,
): Promise<Candle[] | null> {
  if (base === "off") return null;
  const json = await getChart(yahooChartUrl(symbol, timeframe, base), signal);
  if (json === null) return null;
  const candles = parseYahooChart(json, timeframe);
  return candles.length >= 2 ? candles : null;
}

/** 最近十来个交易日的真实日线（不复权），用来算"相对收盘价"的涨跌幅 */
export async function fetchStockRecentDays(
  symbol: string,
  signal?: AbortSignal,
  base: string = STOCK_HISTORY_BASE,
): Promise<Candle[] | null> {
  if (base === "off") return null;
  const params = new URLSearchParams({ interval: "1d", range: "1mo", includePrePost: "false" });
  const json = await getChart(`${base}/v8/finance/chart/${encodeURIComponent(stockTicker(symbol))}?${params}`, signal);
  if (json === null) return null;
  const candles = parseYahooChart(json, "1d", false);
  return candles.length >= 1 ? candles : null;
}
