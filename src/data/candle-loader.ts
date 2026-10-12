import type { Candle, CandlePage } from "@/types/market";

/** 取一页 K 线。不传 endTime 取最新一页，传了取开盘时间不晚于它的一页。 */
export type PageFetcher = (endTimeMs?: number) => Promise<CandlePage>;

export interface LoaderOptions {
  /** 只保留返回 true 的 K 线；不传表示全部保留 */
  keep?: (candle: Candle) => boolean;
  /** 接口每页的根数，返回不足一页说明已经到头 */
  pageSize: number;
  /** 过滤后至少要凑够这么多根才停 */
  minBars: number;
  /** 一次最多翻这么多页，避免无止境地请求 */
  maxPages: number;
}

export interface LoadResult {
  /** 过滤后的 K 线，时间升序 */
  candles: Candle[];
  /** 已经取到的最早一根原始 K 线的时间（秒），用来继续往前翻页 */
  oldestRaw: number | null;
  hasMore: boolean;
  precision: number;
}

/**
 * 加载最新的 K 线。有过滤条件时，一页里能留下的可能很少（比如周末打开美股的 1 分钟线，
 * 最新一页全在休市时段），所以要继续往前翻，直到凑够 minBars 根。
 */
export async function loadLatest(fetchPage: PageFetcher, options: LoaderOptions): Promise<LoadResult> {
  const first = await fetchPage();
  const result: LoadResult = {
    candles: options.keep ? first.candles.filter(options.keep) : [...first.candles],
    oldestRaw: first.candles[0]?.time ?? null,
    hasMore: first.candles.length >= options.pageSize,
    precision: first.precision,
  };
  if (!options.keep) return result;

  for (let page = 1; page < options.maxPages && result.hasMore && result.candles.length < options.minBars; page++) {
    const older = await loadOlder(fetchPage, result.oldestRaw, { ...options, minBars: 0, maxPages: 1 });
    result.candles = [...older.candles, ...result.candles];
    result.oldestRaw = older.oldestRaw;
    result.hasMore = older.hasMore;
    result.precision = Math.max(result.precision, older.precision);
  }
  return result;
}

/** 从 oldestRaw 往前加载更早的 K 线，凑够 minBars 根或翻满 maxPages 页为止 */
export async function loadOlder(
  fetchPage: PageFetcher,
  oldestRaw: number | null,
  options: LoaderOptions,
): Promise<LoadResult> {
  const result: LoadResult = { candles: [], oldestRaw, hasMore: oldestRaw !== null, precision: 0 };
  for (let page = 0; page < options.maxPages && result.hasMore && result.oldestRaw !== null; page++) {
    const before = result.oldestRaw;
    const raw = (await fetchPage(before * 1000 - 1)).candles.filter((c) => c.time < before);
    if (raw.length === 0) {
      result.hasMore = false;
      break;
    }
    result.oldestRaw = raw[0]!.time;
    result.hasMore = raw.length >= options.pageSize;
    result.candles = [...(options.keep ? raw.filter(options.keep) : raw), ...result.candles];
    if (result.candles.length >= options.minBars) break;
  }
  return result;
}
