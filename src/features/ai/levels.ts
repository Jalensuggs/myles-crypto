/**
 * 支撑位和阻力位的识别。
 *
 * 做法和看图的人一样：先找出价格转头的那些高点和低点（拐点），
 * 再把价格相近的拐点归成一组——同一个位置被反复触碰过多次，它就越重要。
 * 这里全部由代码算出来，不依赖模型，所以每次结果一样，也不会出现图上没有的价位。
 */
import type { Candle } from "../../types/market";

export type LevelKind = "support" | "resistance";

export interface Pivot {
  /** Unix 秒 */
  time: number;
  price: number;
  kind: "high" | "low";
}

export interface PriceLevel {
  /** 这一组拐点的代表价（组内均价） */
  price: number;
  /** 这一组覆盖的价格范围 */
  low: number;
  high: number;
  /** 被触碰过几次 */
  touches: number;
  /** 最近一次触碰的时间，Unix 秒 */
  lastTouch: number;
  kind: LevelKind;
}

export interface KeyLevelOptions {
  /** 判定拐点时左右各看几根 K 线 */
  lookback?: number;
  /** 价格相差在这个比例之内算同一个位置，例如 0.004 表示 0.4% */
  tolerance?: number;
  /** 支撑和阻力各取几个 */
  max?: number;
}

export interface KeyLevels {
  /** 价格下方的支撑，由近到远 */
  support: PriceLevel[];
  /** 价格上方的阻力，由近到远 */
  resistance: PriceLevel[];
}

const DEFAULT_LOOKBACK = 3;
const DEFAULT_MAX = 3;
/** 一个位置最久多久没被碰过还算数（按 K 线根数折算） */
const RECENCY_BARS = 200;

/**
 * 找出转折点。左右各 lookback 根都不比它更极端的高点就是一个顶，低点同理。
 * 价格走平时（几根的最高价一样）只保留最左边那根，避免同一个顶算成好几个。
 */
export function findPivots(candles: readonly Candle[], lookback = DEFAULT_LOOKBACK): Pivot[] {
  const out: Pivot[] = [];
  if (lookback < 1) return out;
  for (let i = lookback; i + lookback < candles.length; i++) {
    const bar = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback && (isHigh || isLow); j++) {
      if (j === i) continue;
      const other = candles[j]!;
      // 左边要求严格更低，这样价格走平时只记最左边的那一根
      if (j < i ? other.high >= bar.high : other.high > bar.high) isHigh = false;
      if (j < i ? other.low <= bar.low : other.low < bar.low) isLow = false;
    }
    if (isHigh) out.push({ time: bar.time, price: bar.high, kind: "high" });
    if (isLow) out.push({ time: bar.time, price: bar.low, kind: "low" });
  }
  return out;
}

interface Cluster {
  price: number;
  low: number;
  high: number;
  touches: number;
  lastTouch: number;
}

/** 把价格相近的拐点归成一组 */
export function clusterPivots(pivots: readonly Pivot[], tolerance: number): Cluster[] {
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const out: Cluster[] = [];
  let members: Pivot[] = [];

  const flush = () => {
    if (members.length === 0) return;
    let sum = 0;
    let lastTouch = 0;
    for (const p of members) {
      sum += p.price;
      if (p.time > lastTouch) lastTouch = p.time;
    }
    out.push({
      price: sum / members.length,
      low: members[0]!.price,
      high: members[members.length - 1]!.price,
      touches: members.length,
      lastTouch,
    });
    members = [];
  };

  for (const pivot of sorted) {
    const base = members[0];
    if (base && base.price > 0 && (pivot.price - base.price) / base.price > tolerance) flush();
    members.push(pivot);
  }
  flush();
  return out;
}

/**
 * 相近的价格算不算同一个位置，取决于这个标的平时波动多大。
 * 比特币日线一天波动两三个百分点，0.4% 的差距可以忽略；
 * 而一只走势很稳的股票，0.4% 已经是两个不同的位置了。
 */
export function toleranceFor(price: number, atrValue: number | null | undefined): number {
  if (!price || !atrValue || !Number.isFinite(atrValue)) return 0.004;
  return Math.min(0.015, Math.max(0.002, (atrValue / price) * 0.6));
}

/**
 * 算出当前价格上下最值得关注的几个位置。
 * 排序看三件事：被碰过几次、最近还有没有被碰过、离现价多远。
 */
export function keyLevels(
  candles: readonly Candle[],
  lastPrice: number,
  options: KeyLevelOptions = {},
): KeyLevels {
  const { lookback = DEFAULT_LOOKBACK, max = DEFAULT_MAX } = options;
  const empty: KeyLevels = { support: [], resistance: [] };
  if (candles.length === 0 || !(lastPrice > 0)) return empty;

  const tolerance = options.tolerance ?? 0.004;
  const clusters = clusterPivots(findPivots(candles, lookback), tolerance);
  if (clusters.length === 0) return empty;

  const newest = candles[candles.length - 1]!.time;
  const oldest = candles[0]!.time;
  const span = Math.max(1, newest - oldest);
  const barSeconds = span / Math.max(1, candles.length - 1);
  const recencyWindow = barSeconds * RECENCY_BARS;

  const scored = clusters.map((cluster) => {
    const kind: LevelKind = cluster.price < lastPrice ? "support" : "resistance";
    const age = Math.max(0, newest - cluster.lastTouch);
    const recency = Math.max(0, 1 - age / recencyWindow);
    const distance = Math.abs(cluster.price - lastPrice) / lastPrice;
    // 太远的位置短期内用不上，按距离打个折
    const proximity = 1 / (1 + distance * 25);
    return {
      level: { ...cluster, kind } satisfies PriceLevel,
      score: cluster.touches + recency * 1.5 + proximity * 2,
    };
  });

  const pick = (kind: LevelKind): PriceLevel[] =>
    scored
      .filter((item) => item.level.kind === kind)
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map((item) => item.level)
      // 由近到远，方便直接读
      .sort((a, b) => Math.abs(a.price - lastPrice) - Math.abs(b.price - lastPrice));

  return { support: pick("support"), resistance: pick("resistance") };
}
