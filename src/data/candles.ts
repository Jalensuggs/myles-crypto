import type { Candle } from "@/types/market";

export function isValidCandle(c: Candle): boolean {
  return (
    Number.isFinite(c.time) &&
    Number.isFinite(c.open) &&
    Number.isFinite(c.high) &&
    Number.isFinite(c.low) &&
    Number.isFinite(c.close) &&
    Number.isFinite(c.volume) &&
    c.time > 0 &&
    c.low > 0 &&
    c.high >= c.low &&
    c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) &&
    c.volume >= 0
  );
}

/** 过滤非法数据，按时间升序排列，同一时间保留最后出现的一条 */
export function normalizeCandles(input: readonly Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of input) {
    if (isValidCandle(c)) byTime.set(c.time, c);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export type MergeResult = "updated" | "appended" | "ignored";

/** 把一根实时 K 线并入已排序的数组（原地修改） */
export function mergeCandle(list: Candle[], candle: Candle): MergeResult {
  if (!isValidCandle(candle)) return "ignored";
  const last = list[list.length - 1];
  if (!last || candle.time > last.time) {
    list.push(candle);
    return "appended";
  }
  if (candle.time === last.time) {
    list[list.length - 1] = candle;
    return "updated";
  }
  return "ignored";
}

/** 合并两段 K 线，时间相同以 incoming 为准 */
export function mergeCandleLists(existing: readonly Candle[], incoming: readonly Candle[]): Candle[] {
  return normalizeCandles([...existing, ...incoming]);
}
