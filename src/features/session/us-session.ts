/**
 * 美股常规交易时段的判断：美东时间周一到周五 9:30–16:00，不含纽交所休市日。
 * 美股合约 24 小时都在出 K 线，要让图表和均线接近股票软件，就得把时段外的 K 线去掉。
 * 休市日按纽交所的固定规则推算，不依赖外部日历。提前收盘的半日市（感恩节次日等）按全天处理。
 */

const OPEN_MINUTE = 9 * 60 + 30;
const CLOSE_MINUTE = 16 * 60;
const DAY = 86400;

const NY_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** 某一时刻纽约时间比 UTC 快多少分钟（夏令时 −240，冬令时 −300） */
function newYorkOffsetMinutes(utcMs: number): number {
  const parts: Record<string, number> = {};
  for (const part of NY_FORMAT.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return Math.round((wall - Math.floor(utcMs / 1000) * 1000) / 60000);
}

const offsetByDay = new Map<number, number>();

/**
 * 按 UTC 日期缓存时差，避免每根 K 线都做一次时区换算。
 * 夏令时在周日凌晨切换，当天本来就休市，所以取当天中午的时差不会判断错。
 */
function offsetFor(utcSec: number): number {
  const day = Math.floor(utcSec / DAY);
  let offset = offsetByDay.get(day);
  if (offset === undefined) {
    offset = newYorkOffsetMinutes((day * DAY + DAY / 2) * 1000);
    offsetByDay.set(day, offset);
  }
  return offset;
}

const dayNumber = (year: number, month: number, day: number) => Math.floor(Date.UTC(year, month - 1, day) / 86400000);

/** 某月第 n 个星期几（weekday：0 周日 … 6 周六）；n 为 -1 表示最后一个 */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  if (n > 0) {
    const first = dayNumber(year, month, 1);
    return first + ((weekday - weekdayOf(first) + 7) % 7) + (n - 1) * 7;
  }
  const last = dayNumber(year, month + 1, 0);
  return last - ((weekdayOf(last) - weekday + 7) % 7);
}

/** 复活节（公历），用来推算耶稣受难日 */
function easter(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dayNumber(year, month, day);
}

/** 固定日期的假日：落在周日顺延到周一；落在周六提前到周五 */
function observed(day: number): number {
  const weekday = weekdayOf(day);
  return weekday === 0 ? day + 1 : weekday === 6 ? day - 1 : day;
}

const holidaysByYear = new Map<number, Set<number>>();

/** 纽交所某一年的全天休市日，以"距 1970-01-01 的天数"表示 */
export function nyseHolidays(year: number): Set<number> {
  let set = holidaysByYear.get(year);
  if (set) return set;
  set = new Set<number>();
  const newYear = dayNumber(year, 1, 1);
  // 元旦落在周六时不补休（前一天是上一年的最后一个交易日，照常开市）
  if (weekdayOf(newYear) !== 6) set.add(observed(newYear));
  set.add(nthWeekday(year, 1, 1, 3)); // 马丁·路德·金纪念日
  set.add(nthWeekday(year, 2, 1, 3)); // 总统日
  set.add(easter(year) - 2); // 耶稣受难日
  set.add(nthWeekday(year, 5, 1, -1)); // 阵亡将士纪念日
  if (year >= 2022) set.add(observed(dayNumber(year, 6, 19))); // 六月节
  set.add(observed(dayNumber(year, 7, 4))); // 独立日
  set.add(nthWeekday(year, 9, 1, 1)); // 劳动节
  set.add(nthWeekday(year, 11, 4, 4)); // 感恩节
  set.add(observed(dayNumber(year, 12, 25))); // 圣诞节
  holidaysByYear.set(year, set);
  return set;
}

/** 这一天（距 1970-01-01 的天数，按纽约日期）是否开市 */
export function isUsTradingDay(day: number): boolean {
  const weekday = weekdayOf(day);
  if (weekday === 0 || weekday === 6) return false;
  return !nyseHolidays(new Date(day * 86400000).getUTCFullYear()).has(day);
}

/** 0 是周日，6 是周六 */
function weekdayOf(daysSinceEpoch: number): number {
  return (((daysSinceEpoch + 4) % 7) + 7) % 7;
}

export interface SessionPosition {
  /** 纽约日期，距 1970-01-01 的天数 */
  day: number;
  /** 距当天 9:30 开盘的分钟数，开盘前为负 */
  minute: number;
}

/** 一个时刻在纽约当天交易时段里的位置；不考虑是否开市 */
export function sessionPosition(timeSec: number): SessionPosition {
  const local = timeSec + offsetFor(timeSec) * 60;
  const day = Math.floor(local / DAY);
  return { day, minute: Math.floor((local - day * DAY) / 60) - OPEN_MINUTE };
}

/** 某个纽约日期 9:30 开盘对应的 UTC 时间（秒） */
export function sessionOpenTime(day: number): number {
  const local = day * DAY + OPEN_MINUTE * 60;
  return local - offsetFor(local) * 60;
}

const SESSION_MINUTES = CLOSE_MINUTE - OPEN_MINUTE;

/**
 * 一根 K 线是否属于美股常规交易时段。
 * 日线及以上：UTC 日期是交易日。
 * 日内周期：K 线覆盖的时间与交易日当天 9:30–16:00（美东）有重叠。
 */
export function isUsRegularSession(openTimeSec: number, stepSeconds: number): boolean {
  if (stepSeconds >= DAY) return isUsTradingDay(Math.floor(openTimeSec / DAY));
  const { day, minute } = sessionPosition(openTimeSec);
  return isUsTradingDay(day) && minute < SESSION_MINUTES && minute + stepSeconds / 60 > 0;
}

/** 此刻美股是否在常规交易时段内 */
export function isUsMarketOpen(nowMs: number): boolean {
  return isUsRegularSession(Math.floor(nowMs / 1000), 1);
}
