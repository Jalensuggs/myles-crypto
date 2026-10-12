import type { Candle } from "@/types/market";
import { candleDelta } from "./cvd";

/**
 * 从 K 线和爆仓数据里识别"有人在接货"或"有人在出货"的迹象。
 * 这些都是概率性的提示：说明当时卖压（或买压）被对手盘吃掉了，不代表价格之后一定怎么走。
 */

/** 看最近多少根 K 线 */
export const ABSORPTION_WINDOW = 16;
/** 这段时间的价格振幅不超过这个比例，才算横盘 */
const MAX_RANGE_PCT = 1.6;
/** 主动买卖的净差额占总成交量的比例达到这个数，才算一边倒 */
const MIN_IMBALANCE = 0.06;
/** 最近几根用来确认"没有再创新低/新高" */
const RECENT_BARS = 4;

export type AbsorptionSide = "buy" | "sell";

export interface Absorption {
  /** buy：卖压被吸收（有人在接货）；sell：买盘被吸收（有人在出货） */
  side: AbsorptionSide;
  /** 净差额占总成交量的比例，负数表示主动卖出占多 */
  imbalance: number;
  rangePct: number;
}

/**
 * 横盘吸收：价格在窄幅区间里不创新低，但主动卖出明显多于主动买入。
 * 一直有人砸、价格却不跌，说明下方有人挂单接走了。反过来就是出货。
 */
export function detectAbsorption(candles: readonly Candle[]): Absorption | null {
  if (candles.length < ABSORPTION_WINDOW) return null;
  const window = candles.slice(-ABSORPTION_WINDOW);
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  let delta = 0;
  for (const c of window) {
    const d = candleDelta(c);
    if (d === null) return null;
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
    volume += c.volume;
    delta += d;
  }
  if (!(volume > 0) || !(low > 0)) return null;
  const rangePct = ((high - low) / low) * 100;
  if (rangePct > MAX_RANGE_PCT) return null;
  const imbalance = delta / volume;

  const earlier = window.slice(0, -RECENT_BARS);
  const recent = window.slice(-RECENT_BARS);
  const earlierLow = Math.min(...earlier.map((c) => c.low));
  const earlierHigh = Math.max(...earlier.map((c) => c.high));
  const recentLow = Math.min(...recent.map((c) => c.low));
  const recentHigh = Math.max(...recent.map((c) => c.high));
  const first = window[0]!;
  const last = window[window.length - 1]!;

  // 卖得多，但最近没有创新低，收盘也没有比开头低多少
  if (imbalance <= -MIN_IMBALANCE && recentLow >= earlierLow && last.close >= first.open * (1 - rangePct / 400)) {
    return { side: "buy", imbalance, rangePct };
  }
  if (imbalance >= MIN_IMBALANCE && recentHigh <= earlierHigh && last.close <= first.open * (1 + rangePct / 400)) {
    return { side: "sell", imbalance, rangePct };
  }
  return null;
}

/** 多单爆仓金额达到 24 小时成交额的这个比例（且不低于下面的下限），才算集中爆仓 */
const PANIC_VOLUME_SHARE = 1e-4;
const PANIC_FLOOR_USD = 200_000;
/** 下影线至少占整根 K 线的这个比例 */
const MIN_WICK_SHARE = 0.5;

export interface PanicAbsorbed {
  /** long：多单被集中爆仓后价格收回（有人接走了强平盘）；short 则相反 */
  side: "long" | "short";
  liquidatedUsd: number;
}

/**
 * 恐慌盘被接走：一根 K 线里多单集中爆仓，卖压极大，但价格留下长下影线收了回来。
 * 强平的卖单不看价格，谁用挂单把它们接走，谁就是在抄底。空单集中爆仓后冲高回落则相反。
 */
export function detectPanicAbsorbed(
  candle: Candle,
  liquidated: { long: number; short: number },
  quoteVolume24h: number | undefined,
): PanicAbsorbed | null {
  const range = candle.high - candle.low;
  if (!(range > 0)) return null;
  const threshold = Math.max(PANIC_FLOOR_USD, (quoteVolume24h ?? 0) * PANIC_VOLUME_SHARE);
  const bodyLow = Math.min(candle.open, candle.close);
  const bodyHigh = Math.max(candle.open, candle.close);

  if (liquidated.long >= threshold && (bodyLow - candle.low) / range >= MIN_WICK_SHARE) {
    return { side: "long", liquidatedUsd: liquidated.long };
  }
  if (liquidated.short >= threshold && (candle.high - bodyHigh) / range >= MIN_WICK_SHARE) {
    return { side: "short", liquidatedUsd: liquidated.short };
  }
  return null;
}
