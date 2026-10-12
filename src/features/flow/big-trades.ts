import type { Trade } from "@/types/market";

/** 自动门槛：24 小时成交额的万分之二，但不低于这个数 */
export const BIG_TRADE_FLOOR_USD = 100_000;
const BIG_TRADE_VOLUME_SHARE = 2e-4;
/** 同一方向、间隔不超过这么久的成交视为同一笔大单拆出来的 */
export const CLUSTER_GAP_MS = 200;
/** 一组最长持续这么久。行情密集时同方向的成交会一笔接一笔，不设上限就会无休止地合并下去。 */
export const CLUSTER_MAX_MS = 2000;

/**
 * 多大的成交算大单。
 * BTC 一分钟就有上百笔 10 万美元以上的成交，小币种可能一天都没有一笔，
 * 所以门槛跟着每个标的自己的成交额走；用户也可以填一个固定金额。
 */
export function bigTradeThreshold(quoteVolume24h: number | undefined, fixedUsd: number): number {
  if (fixedUsd > 0) return fixedUsd;
  if (!quoteVolume24h || !(quoteVolume24h > 0)) return BIG_TRADE_FLOOR_USD;
  return Math.max(BIG_TRADE_FLOOR_USD, quoteVolume24h * BIG_TRADE_VOLUME_SHARE);
}

/** 合并后的一笔成交 */
export interface TradeCluster {
  side: "buy" | "sell";
  /** 第一笔成交的时间，Unix 毫秒 */
  time: number;
  lastTime: number;
  quantity: number;
  /** 成交金额（美元） */
  notional: number;
  /** 成交均价 */
  price: number;
  /** 由几笔成交合并而成 */
  fills: number;
}

/**
 * 把连续的成交合并成"一笔单子"。
 * 一笔很大的市价单要吃掉好几个价位，交易所会把它报成好几笔成交；
 * 不合并的话，一笔 200 万的单子会显示成几笔几十万的。
 */
export class TradeClusterer {
  private current: TradeCluster | null = null;

  /** 加入一笔成交。如果它开启了新的一组，返回刚结束的上一组。 */
  add(trade: Trade): TradeCluster | null {
    const notional = trade.price * trade.quantity;
    const cur = this.current;
    if (
      cur &&
      cur.side === trade.side &&
      trade.time - cur.lastTime <= CLUSTER_GAP_MS &&
      trade.time - cur.time <= CLUSTER_MAX_MS
    ) {
      cur.quantity += trade.quantity;
      cur.notional += notional;
      cur.price = cur.notional / cur.quantity;
      cur.lastTime = trade.time;
      cur.fills += 1;
      return null;
    }
    this.current = {
      side: trade.side,
      time: trade.time,
      lastTime: trade.time,
      quantity: trade.quantity,
      notional,
      price: trade.price,
      fills: 1,
    };
    return cur;
  }

  /** 一段时间没有新成交时调用，把还没结束的那一组交出来 */
  flush(nowMs: number): TradeCluster | null {
    const cur = this.current;
    if (!cur || nowMs - cur.lastTime <= CLUSTER_GAP_MS) return null;
    this.current = null;
    return cur;
  }
}

export interface BigTrade {
  /** Unix 毫秒 */
  time: number;
  side: "buy" | "sell";
  notional: number;
  price: number;
}

export interface BigTradeSummary {
  buyUsd: number;
  sellUsd: number;
  netUsd: number;
  buyCount: number;
  sellCount: number;
}

/** 统计某个时间点之后的大单：买了多少、卖了多少、净流入多少 */
export function summarizeBigTrades(trades: readonly BigTrade[], sinceMs: number): BigTradeSummary {
  const out: BigTradeSummary = { buyUsd: 0, sellUsd: 0, netUsd: 0, buyCount: 0, sellCount: 0 };
  for (const t of trades) {
    if (t.time < sinceMs) continue;
    if (t.side === "buy") {
      out.buyUsd += t.notional;
      out.buyCount += 1;
    } else {
      out.sellUsd += t.notional;
      out.sellCount += 1;
    }
  }
  out.netUsd = out.buyUsd - out.sellUsd;
  return out;
}
