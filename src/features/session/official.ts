import type { Candle } from "@/types/market";

/** 两个来源重叠的 K 线里，收盘价之比的中位数允许偏离 1 的最大幅度 */
const MAX_PRICE_DEVIATION = 0.03;
const MIN_OVERLAP = 3;

/**
 * 核对官方数据和合约数据是不是同一只股票。
 * 合约代码和股票代码大多相同，但不能保证；万一对应到了另一只股票，价格会差得很远。
 * 重叠的 K 线太少或价格对不上时返回 false，调用方应放弃官方数据。
 */
export function matchesContract(official: readonly Candle[], contract: readonly Candle[]): boolean {
  const byTime = new Map(contract.map((c) => [c.time, c.close]));
  const ratios: number[] = [];
  for (const o of official) {
    const close = byTime.get(o.time);
    if (close !== undefined && o.close > 0) ratios.push(close / o.close);
  }
  if (ratios.length < MIN_OVERLAP) return false;
  ratios.sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)]!;
  return Math.abs(median - 1) <= MAX_PRICE_DEVIATION;
}

/**
 * 把官方历史和合约 K 线拼成一条序列：
 * - 官方数据覆盖的历史部分用官方的（开高低收和成交量都是股票的真实数据）；
 * - 官方数据的最后一根如果还没走完，就从这一根起改用合约的，保证实时；
 *   已经走完（比如休市期间）则保留官方的，只把它之后的部分交给合约；
 * - 比官方数据更早的部分（官方的日内数据只有最近几十天）用合约的补上。
 *
 * isComplete 判断官方的一根 K 线是否已经走完；不传时一律按没走完处理。
 */
export function mergeOfficial(
  contract: readonly Candle[],
  official: readonly Candle[],
  isComplete: (candle: Candle) => boolean = () => false,
): Candle[] {
  if (official.length < 2) return [...contract];
  const first = official[0]!.time;
  const last = official[official.length - 1]!;
  const head = contract.filter((c) => c.time < first);
  if (isComplete(last)) return [...head, ...official, ...contract.filter((c) => c.time > last.time)];

  const body = official.filter((c) => c.time < last.time);
  const tail = contract.filter((c) => c.time >= last.time);
  // 合约这边没有对应的那一根时（比如刚好卡在翻页边界），保留官方的最后一根
  if (tail.length === 0 || tail[0]!.time !== last.time) return [...head, ...body, last, ...tail];
  return [...head, ...body, ...tail];
}
