import type { Liquidation } from "@/types/market";

/**
 * 爆仓金额按分钟累计。交易所不提供爆仓的历史数据，只能从页面打开之后一笔一笔地记，
 * 所以这里按分钟存下来（并保存在本地），需要时再合并成任意周期。
 * 结构：分钟序号（Unix 秒 ÷ 60）→ [多单爆仓金额, 空单爆仓金额]
 */
export type LiquidationBuckets = Record<number, [number, number]>;

export const BUCKET_SECONDS = 60;
/** 只保留最近这么久的记录 */
export const BUCKET_KEEP_SECONDS = 3 * 86400;

export function addLiquidation(buckets: LiquidationBuckets, liq: Liquidation): LiquidationBuckets {
  const minute = Math.floor(liq.time / 1000 / BUCKET_SECONDS);
  const [long, short] = buckets[minute] ?? [0, 0];
  return {
    ...buckets,
    [minute]: liq.side === "long" ? [long + liq.notional, short] : [long, short + liq.notional],
  };
}

export function pruneBuckets(buckets: LiquidationBuckets, nowSec: number): LiquidationBuckets {
  const oldest = Math.floor((nowSec - BUCKET_KEEP_SECONDS) / BUCKET_SECONDS);
  const out: LiquidationBuckets = {};
  for (const key of Object.keys(buckets)) {
    const minute = Number(key);
    if (minute >= oldest) out[minute] = buckets[minute]!;
  }
  return out;
}

export interface LiquidationSum {
  long: number;
  short: number;
}

/** [fromSec, toSec) 这段时间里的爆仓金额 */
export function sumLiquidations(buckets: LiquidationBuckets, fromSec: number, toSec: number): LiquidationSum {
  const out: LiquidationSum = { long: 0, short: 0 };
  const first = Math.floor(fromSec / BUCKET_SECONDS);
  const last = Math.ceil(toSec / BUCKET_SECONDS);
  // 记录很稀疏时逐个键扫一遍更快；时间段短时按分钟查更快
  if (last - first > Object.keys(buckets).length) {
    for (const key of Object.keys(buckets)) {
      const minute = Number(key);
      if (minute >= first && minute < last) {
        out.long += buckets[minute]![0];
        out.short += buckets[minute]![1];
      }
    }
    return out;
  }
  for (let minute = first; minute < last; minute++) {
    const bucket = buckets[minute];
    if (bucket) {
      out.long += bucket[0];
      out.short += bucket[1];
    }
  }
  return out;
}

/** 最早的一条记录是什么时候（Unix 秒）；没有记录时返回 null */
export function earliestBucketTime(buckets: LiquidationBuckets): number | null {
  let min = Infinity;
  for (const key of Object.keys(buckets)) min = Math.min(min, Number(key));
  return Number.isFinite(min) ? min * BUCKET_SECONDS : null;
}
