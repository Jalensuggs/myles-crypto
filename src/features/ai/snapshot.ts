/**
 * 行情快照：把图表上现有的数据整理成一份结构化的材料，交给模型判断。
 *
 * 模型不擅长从一长串数字里算均线、找支撑，所以这些都在这里先算好；
 * 模型只负责读这份材料、下结论。快照里出现的价格都来自真实数据，
 * 后面校验模型给出的价位时也以它为准。
 */
// 这几个文件线上也由服务端的 api/ai.ts 直接引用，所以用相对路径写，
// 不走只有打包页面时才认识的 @/ 别名。
import { z } from "zod";
import { atr, boll, macd, rsi, sma } from "../indicators/calc";
import { cumulativeDelta } from "../flow/cvd";
import { keyLevels, toleranceFor } from "./levels";
import { ASSET_CATEGORIES, TIMEFRAMES, type AssetCategory, type Candle, type Timeframe } from "../../types/market";

/** 交给模型的 K 线最多这么多根，再多既没用也费钱 */
export const SNAPSHOT_BARS = 60;
/** 判断趋势结构时看最近这么多根 */
const STRUCTURE_BARS = 80;

const levelSchema = z.object({
  price: z.number(),
  touches: z.number().int(),
  /** 距离现价百分之几 */
  distancePct: z.number(),
});

const barSchema = z.object({
  /** UTC 时间标签，例如 "10-20 14:00" */
  t: z.string(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  /** 成交量 */
  v: z.number(),
});

export const snapshotSchema = z.object({
  /** 标的显示名 */
  name: z.string().min(1).max(32),
  /** 现货、永续合约、美股合约…… */
  kind: z.string().max(16),
  category: z.enum(ASSET_CATEGORIES),
  timeframe: z.enum(TIMEFRAMES),
  timeframeLabel: z.string().max(8),
  /** 快照生成时间（UTC） */
  at: z.string().max(32),
  price: z.number(),
  /** 价格小数位数 */
  precision: z.number().int().min(0).max(10),
  day: z
    .object({
      changePct: z.number(),
      high: z.number(),
      low: z.number(),
      quoteVolume: z.number(),
    })
    .optional(),
  /** 最近若干根 K 线，由早到晚 */
  bars: z.array(barSchema).max(SNAPSHOT_BARS),
  /** 已加载区间的整体高低点 */
  range: z.object({
    high: z.number(),
    low: z.number(),
    bars: z.number().int(),
    from: z.string().max(32),
    /** 现价处在这个区间的什么位置，0 是最低，100 是最高 */
    positionPct: z.number(),
  }),
  indicators: z.object({
    ma: z.array(z.object({ period: z.number().int(), value: z.number() })).max(8),
    rsi: z.number().optional(),
    macd: z.object({ dif: z.number(), dea: z.number(), hist: z.number() }).optional(),
    boll: z.object({ upper: z.number(), mid: z.number(), lower: z.number() }).optional(),
    atr: z.number().optional(),
    /** ATR 占现价的百分比，衡量一根 K 线平均走多少 */
    atrPct: z.number().optional(),
  }),
  structure: z.object({
    trend: z.enum(["up", "down", "range"]),
    detail: z.string().max(120),
  }),
  levels: z.object({
    support: z.array(levelSchema).max(5),
    resistance: z.array(levelSchema).max(5),
  }),
  flow: z
    .object({
      /** CVD（主动买卖差额累计）最近的方向 */
      cvdTrend: z.enum(["up", "down", "flat"]).optional(),
      /** CVD 与价格是否背离 */
      cvdNote: z.string().max(80).optional(),
      openInterest: z.number().optional(),
      oiChangePct: z.number().optional(),
      fundingRate: z.number().optional(),
      bigTrades1h: z
        .object({ buyUsd: z.number(), sellUsd: z.number(), netUsd: z.number(), count: z.number().int() })
        .optional(),
      liquidation24h: z.object({ long: z.number(), short: z.number() }).optional(),
      /** 爆仓数据从什么时候开始记的 */
      liquidationSince: z.string().max(32).optional(),
    })
    .optional(),
  /** 需要让模型知道的特殊情况，例如美股休市 */
  notes: z.array(z.string().max(120)).max(5),
});

export type MarketSnapshot = z.infer<typeof snapshotSchema>;

export interface SnapshotInput {
  name: string;
  kind: string;
  category: AssetCategory;
  timeframe: Timeframe;
  timeframeLabel: string;
  candles: readonly Candle[];
  price: number;
  precision: number;
  maPeriods: readonly number[];
  day?: { changePct: number; high: number; low: number; quoteVolume: number };
  flow?: {
    openInterest?: number;
    oiChangePct?: number;
    fundingRate?: number;
    bigTrades1h?: { buyUsd: number; sellUsd: number; netUsd: number; count: number };
    liquidation24h?: { long: number; short: number };
    liquidationSince?: number;
  };
  notes?: string[];
  /** Unix 毫秒 */
  now: number;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 成交量只要看个量级，保留四位有效数字就够 */
function roundVolume(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  const digits = Math.max(0, 4 - Math.ceil(Math.log10(Math.abs(value))));
  return round(value, Math.min(digits, 6));
}

/** 统一用 UTC 显示，避免模型按本地时区理解 */
export function formatUtc(unixSeconds: number, withTime: boolean): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (!withTime) return `${d.getUTCFullYear()}-${date}`;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * 判断走势结构：对比最近两个高点和两个低点。
 * 高点和低点都在抬高就是上升趋势，都在降低就是下降趋势，其余算震荡。
 */
export function describeStructure(candles: readonly Candle[]): { trend: "up" | "down" | "range"; detail: string } {
  const recent = candles.slice(-STRUCTURE_BARS);
  const highs: number[] = [];
  const lows: number[] = [];
  const lookback = 2;
  for (let i = lookback; i + lookback < recent.length; i++) {
    const bar = recent[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (recent[j]!.high >= bar.high) isHigh = false;
      if (recent[j]!.low <= bar.low) isLow = false;
    }
    if (isHigh) highs.push(bar.high);
    if (isLow) lows.push(bar.low);
  }

  const lastTwo = (list: number[]): [number, number] | null =>
    list.length >= 2 ? [list[list.length - 2]!, list[list.length - 1]!] : null;
  const h = lastTwo(highs);
  const l = lastTwo(lows);
  if (!h || !l) return { trend: "range", detail: "转折点不足，看不出明确结构" };

  const higherHigh = h[1] > h[0];
  const higherLow = l[1] > l[0];
  if (higherHigh && higherLow) return { trend: "up", detail: "高点和低点都在抬高（上升结构）" };
  if (!higherHigh && !higherLow) return { trend: "down", detail: "高点和低点都在降低（下降结构）" };
  return {
    trend: "range",
    detail: higherHigh ? "高点抬高但低点在降，结构混乱" : "低点抬高但高点在降，区间收窄",
  };
}

/** CVD 最近的方向，以及它和价格有没有背离 */
function describeCvd(candles: readonly Candle[]): { cvdTrend?: "up" | "down" | "flat"; cvdNote?: string } {
  const window = candles.slice(-30);
  if (window.length < 10) return {};
  const cvd = cumulativeDelta(window);
  const first = cvd[0];
  const last = cvd[cvd.length - 1];
  if (first == null || last == null) return {};

  const scale = window.reduce((sum, c) => sum + c.volume, 0);
  const delta = last - first;
  // 变化量不到这段时间总成交量的 2% 就算没有明显方向
  const flat = scale > 0 && Math.abs(delta) / scale < 0.02;
  const cvdTrend = flat ? "flat" : delta > 0 ? "up" : "down";

  const priceUp = window[window.length - 1]!.close > window[0]!.close;
  let cvdNote: string | undefined;
  if (!flat && priceUp && cvdTrend === "down") cvdNote = "价格在涨但主动买盘在减少（顶背离）";
  else if (!flat && !priceUp && cvdTrend === "up") cvdNote = "价格在跌但主动买盘在增加（底背离）";
  return { cvdTrend, ...(cvdNote ? { cvdNote } : {}) };
}

export function buildSnapshot(input: SnapshotInput): MarketSnapshot {
  const { candles, price, precision, timeframe } = input;
  const withTime = timeframe !== "1d" && timeframe !== "1w" && timeframe !== "1M";
  const closes = candles.map((c) => c.close);

  const atrSeries = atr(candles, 14);
  const atrValue = atrSeries[atrSeries.length - 1] ?? null;
  const rsiSeries = rsi(closes, 14);
  const macdSeries = macd(closes);
  const bollSeries = boll(closes);
  const lastMacd = macdSeries[macdSeries.length - 1];
  const lastBoll = bollSeries[bollSeries.length - 1];

  const ma = input.maPeriods
    .map((period) => {
      const series = sma(closes, period);
      const value = series[series.length - 1];
      return value === null || value === undefined ? null : { period, value: round(value, precision) };
    })
    .filter((item): item is { period: number; value: number } => item !== null);

  let high = -Infinity;
  let low = Infinity;
  for (const c of candles) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  const span = high - low;

  const tolerance = toleranceFor(price, atrValue);
  const levels = keyLevels(candles, price, { tolerance });
  const toLevel = (level: { price: number; touches: number }) => ({
    price: round(level.price, precision),
    touches: level.touches,
    distancePct: round(((level.price - price) / price) * 100, 2),
  });

  const lastRsi = rsiSeries[rsiSeries.length - 1];
  const snapshot: MarketSnapshot = {
    name: input.name,
    kind: input.kind,
    category: input.category,
    timeframe,
    timeframeLabel: input.timeframeLabel,
    at: formatUtc(input.now / 1000, true),
    price: round(price, precision),
    precision,
    ...(input.day
      ? {
          day: {
            changePct: round(input.day.changePct, 2),
            high: round(input.day.high, precision),
            low: round(input.day.low, precision),
            quoteVolume: Math.round(input.day.quoteVolume),
          },
        }
      : {}),
    bars: candles.slice(-SNAPSHOT_BARS).map((c) => ({
      t: formatUtc(c.time, withTime),
      o: round(c.open, precision),
      h: round(c.high, precision),
      l: round(c.low, precision),
      c: round(c.close, precision),
      v: roundVolume(c.volume),
    })),
    range: {
      high: round(Number.isFinite(high) ? high : price, precision),
      low: round(Number.isFinite(low) ? low : price, precision),
      bars: candles.length,
      from: candles.length > 0 ? formatUtc(candles[0]!.time, withTime) : "",
      positionPct: span > 0 ? round(((price - low) / span) * 100, 1) : 50,
    },
    indicators: {
      ma,
      ...(lastRsi === null || lastRsi === undefined ? {} : { rsi: round(lastRsi, 1) }),
      ...(lastMacd?.dif != null && lastMacd.dea != null && lastMacd.hist != null
        ? {
            macd: {
              dif: round(lastMacd.dif, precision),
              dea: round(lastMacd.dea, precision),
              hist: round(lastMacd.hist, precision),
            },
          }
        : {}),
      ...(lastBoll?.upper != null && lastBoll.mid != null && lastBoll.lower != null
        ? {
            boll: {
              upper: round(lastBoll.upper, precision),
              mid: round(lastBoll.mid, precision),
              lower: round(lastBoll.lower, precision),
            },
          }
        : {}),
      ...(atrValue === null
        ? {}
        : { atr: round(atrValue, precision), atrPct: round((atrValue / price) * 100, 2) }),
    },
    structure: describeStructure(candles),
    levels: {
      support: levels.support.map(toLevel),
      resistance: levels.resistance.map(toLevel),
    },
    notes: input.notes ?? [],
  };

  const cvd = describeCvd(candles);
  const flow = input.flow;
  const hasFlow = cvd.cvdTrend !== undefined || (flow !== undefined && Object.keys(flow).length > 0);
  if (hasFlow) {
    snapshot.flow = {
      ...cvd,
      ...(flow?.openInterest === undefined ? {} : { openInterest: Math.round(flow.openInterest) }),
      ...(flow?.oiChangePct === undefined ? {} : { oiChangePct: round(flow.oiChangePct, 2) }),
      ...(flow?.fundingRate === undefined ? {} : { fundingRate: round(flow.fundingRate * 100, 4) }),
      ...(flow?.bigTrades1h === undefined
        ? {}
        : {
            bigTrades1h: {
              buyUsd: Math.round(flow.bigTrades1h.buyUsd),
              sellUsd: Math.round(flow.bigTrades1h.sellUsd),
              netUsd: Math.round(flow.bigTrades1h.netUsd),
              count: flow.bigTrades1h.count,
            },
          }),
      ...(flow?.liquidation24h === undefined
        ? {}
        : {
            liquidation24h: {
              long: Math.round(flow.liquidation24h.long),
              short: Math.round(flow.liquidation24h.short),
            },
          }),
      ...(flow?.liquidationSince === undefined
        ? {}
        : { liquidationSince: formatUtc(flow.liquidationSince, true) }),
    };
  }

  return snapshot;
}
