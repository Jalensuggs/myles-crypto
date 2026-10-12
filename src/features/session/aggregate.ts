import type { Candle, Timeframe } from "@/types/market";
import { sessionPosition } from "./us-session";

/**
 * 股票软件里 1 小时、4 小时和日线都是从 9:30 开盘起算的：
 * 小时线是 9:30–10:30、10:30–11:30 …，日线的开盘价和收盘价是 9:30 和 16:00 的价格。
 * 合约自带的这些周期按 UTC 整点切分，日线还把盘后的涨跌算了进去，和股票软件对不上。
 * 所以这几个周期改为用 30 分钟的交易时段 K 线自己合成。
 */
export interface SessionPlan {
  /** 实际向数据源请求的周期 */
  source: Timeframe;
  /** 每多少分钟合成一根；null 表示直接用原始 K 线，不合成 */
  groupMinutes: number | null;
  /** 一根合成 K 线最多由几根原始 K 线组成 */
  barsPerGroup: number;
  /** 合成出日线之后，是否还要按自然周或自然月归并 */
  calendar: CalendarUnit | null;
}

export type CalendarUnit = "week" | "month";

const WHOLE_DAY = 24 * 60;

export function sessionPlan(timeframe: Timeframe): SessionPlan {
  switch (timeframe) {
    case "1h":
      return { source: "30m", groupMinutes: 60, barsPerGroup: 2, calendar: null };
    case "4h":
      return { source: "30m", groupMinutes: 240, barsPerGroup: 8, calendar: null };
    case "1d":
      return { source: "30m", groupMinutes: WHOLE_DAY, barsPerGroup: 13, calendar: null };
    case "1w":
      return { source: "30m", groupMinutes: WHOLE_DAY, barsPerGroup: 13, calendar: "week" };
    case "1M":
      return { source: "30m", groupMinutes: WHOLE_DAY, barsPerGroup: 13, calendar: "month" };
    default:
      return { source: timeframe, groupMinutes: null, barsPerGroup: 1, calendar: null };
  }
}

interface Slot {
  day: number;
  index: number;
  /** 这根原始 K 线是不是所在分组的第一根 */
  first: boolean;
}

function slotOf(candle: Candle, groupMinutes: number): Slot {
  const { day, minute } = sessionPosition(candle.time);
  const clamped = Math.max(0, minute);
  return { day, index: Math.floor(clamped / groupMinutes), first: clamped % groupMinutes === 0 };
}

function fold(group: readonly Candle[]): Candle {
  const first = group[0]!;
  let high = first.high;
  let low = first.low;
  let volume = 0;
  for (const c of group) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
    volume += c.volume;
  }
  // 用分组里第一根的时间作为合成 K 线的时间，保证唯一且递增
  return { time: first.time, open: first.open, high, low, close: group[group.length - 1]!.close, volume };
}

/**
 * 把按时间升序排列的交易时段 K 线合成更大的周期。
 * 最早的一组如果不是从分组起点开始的（翻页时从半中间截断），就丢掉，避免画出残缺的 K 线。
 */
export function aggregateSession(source: readonly Candle[], groupMinutes: number): Candle[] {
  const out: Candle[] = [];
  let group: Candle[] = [];
  let current: Slot | null = null;
  let complete = true;

  const flush = () => {
    if (group.length > 0 && complete) out.push(fold(group));
  };

  for (const candle of source) {
    const slot = slotOf(candle, groupMinutes);
    if (!current || slot.day !== current.day || slot.index !== current.index) {
      flush();
      group = [];
      // 只有整个序列的第一组可能是残缺的
      complete = current !== null || slot.first;
      current = slot;
    }
    group.push(candle);
  }
  flush();
  return out;
}

/** 只合成最后一组，用于实时更新 */
export function aggregateLast(source: readonly Candle[], groupMinutes: number): Candle | null {
  const last = source[source.length - 1];
  if (!last) return null;
  const target = slotOf(last, groupMinutes);
  let start = source.length - 1;
  while (start > 0) {
    const slot = slotOf(source[start - 1]!, groupMinutes);
    if (slot.day !== target.day || slot.index !== target.index) break;
    start--;
  }
  // 往前数到了序列开头，且这一组不是从分组起点开始的：残缺，不合成
  if (start === 0 && !slotOf(source[0]!, groupMinutes).first) return null;
  return fold(source.slice(start));
}

/** 一根日线属于哪一周（周一为一周的开始）或哪一个月，按纽约日期算 */
function calendarKey(candle: Candle, unit: CalendarUnit): number {
  const { day } = sessionPosition(candle.time);
  // 1970-01-01 是周四，加 3 天后整除 7，周一到周日落在同一个数上
  if (unit === "week") return Math.floor((day + 3) / 7);
  const date = new Date(day * 86400000);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

/** 把按时间升序排列的日线归并成周线或月线。最后一组没走完时就是到目前为止的结果。 */
export function regroupCalendar(days: readonly Candle[], unit: CalendarUnit): Candle[] {
  const out: Candle[] = [];
  let group: Candle[] = [];
  let key: number | null = null;
  for (const candle of days) {
    const k = calendarKey(candle, unit);
    if (key !== null && k !== key) {
      out.push(fold(group));
      group = [];
    }
    key = k;
    group.push(candle);
  }
  if (group.length > 0) out.push(fold(group));
  return out;
}

/** 只归并最后一周或最后一个月，用于实时更新 */
export function regroupCalendarLast(days: readonly Candle[], unit: CalendarUnit): Candle | null {
  const last = days[days.length - 1];
  if (!last) return null;
  const key = calendarKey(last, unit);
  let start = days.length - 1;
  while (start > 0 && calendarKey(days[start - 1]!, unit) === key) start--;
  return fold(days.slice(start));
}
