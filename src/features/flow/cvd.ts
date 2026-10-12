import type { Candle } from "@/types/market";

/**
 * 一根 K 线里"主动买入 − 主动卖出"的成交量。
 * 总成交量 = 主动买入 + 主动卖出，所以差额 = 2 × 主动买入 − 总成交量。
 * 没有主动买入数据的 K 线返回 null。
 */
export function candleDelta(candle: Candle): number | null {
  if (candle.takerBuyVolume === undefined) return null;
  return 2 * candle.takerBuyVolume - candle.volume;
}

/**
 * CVD：把每根 K 线的主动买卖差额累加起来。
 * 它从已加载的第一根 K 线开始算，所以绝对数值没有意义，要看的是走势以及它和价格是否背离。
 * 中间有 K 线缺数据时按 0 处理；全部都没有数据时返回全 null。
 */
export function cumulativeDelta(candles: readonly Candle[]): (number | null)[] {
  if (!candles.some((c) => c.takerBuyVolume !== undefined)) return candles.map(() => null);
  let sum = 0;
  return candles.map((c) => {
    sum += candleDelta(c) ?? 0;
    return sum;
  });
}
