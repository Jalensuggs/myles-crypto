import type { Candle } from "@/types/market";
import { isUsTradingDay, sessionPosition } from "./us-session";

/** 美股此刻所处的时段（按美东时间，不含节假日的交易日） */
export type StockPhase = "open" | "pre" | "post" | "closed";

export const PHASE_LABELS: Record<StockPhase, string> = {
  open: "",
  pre: "盘前",
  post: "盘后",
  closed: "休市",
};

const SESSION_MINUTES = 390;
/** 盘前从 4:00 开始，即开盘前 330 分钟 */
const PRE_MARKET_MINUTES = 330;
/** 盘后到 20:00 结束，即收盘后 240 分钟 */
const POST_MARKET_MINUTES = 240;
const SESSION_SECONDS = SESSION_MINUTES * 60;

export function stockPhase(nowSec: number): StockPhase {
  const { day, minute } = sessionPosition(nowSec);
  if (!isUsTradingDay(day)) return "closed";
  if (minute >= 0 && minute < SESSION_MINUTES) return "open";
  if (minute >= -PRE_MARKET_MINUTES && minute < 0) return "pre";
  if (minute >= SESSION_MINUTES && minute < SESSION_MINUTES + POST_MARKET_MINUTES) return "post";
  return "closed";
}

export interface StockQuote {
  phase: StockPhase;
  /** 最近一个已经收盘的交易日的官方收盘价，涨跌幅以它为基准 */
  refClose: number;
  /** 那个交易日 9:30 开盘的时刻（Unix 秒） */
  refTime: number;
  /** 现价相对 refClose 的涨跌幅（百分比） */
  changePct: number;
  /** refClose 那一天自身的涨跌幅（相对再前一个交易日），没有更早的数据时为 undefined */
  refDayChangePct?: number;
}

/**
 * 股票的涨跌幅口径：相对"最近一个已收盘交易日的收盘价"。
 * 开盘期间它就是昨收；盘前、盘后、休市期间是最近那次收盘。
 * 这和合约自带的"24 小时涨跌"不是一回事，后者对股票没有意义。
 *
 * days 是按时间升序的官方日线，每根的 time 是当天 9:30 开盘的时刻。
 */
export function stockQuote(days: readonly Candle[], lastPrice: number, nowSec: number): StockQuote | null {
  let index = -1;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i]!.time + SESSION_SECONDS <= nowSec) {
      index = i;
      break;
    }
  }
  const ref = days[index];
  if (!ref || !(ref.close > 0) || !(lastPrice > 0)) return null;
  const previous = days[index - 1];
  return {
    phase: stockPhase(nowSec),
    refClose: ref.close,
    refTime: ref.time,
    changePct: ((lastPrice - ref.close) / ref.close) * 100,
    refDayChangePct: previous && previous.close > 0 ? ((ref.close - previous.close) / previous.close) * 100 : undefined,
  };
}
