import { formatPct, formatPrice, formatUsd, guessPrecision, uid } from "@/lib/format";
import type { MarketEvent } from "@/types/market";
import type { TradeCluster } from "./big-trades";
import type { Absorption, PanicAbsorbed } from "./patterns";

/** 把识别结果写成"市场异动"里的一条事件 */

export function bigTradeEvent(label: string, cluster: TradeCluster): MarketEvent {
  const buy = cluster.side === "buy";
  const price = formatPrice(cluster.price, guessPrecision(cluster.price));
  return {
    id: uid("big-trade"),
    kind: "big-trade",
    symbol: label,
    title: `${buy ? "大单买入" : "大单卖出"} ${formatUsd(cluster.notional)}`,
    detail: cluster.fills > 1 ? `均价 ${price} · 合并 ${cluster.fills} 笔成交` : `成交价 ${price}`,
    tone: buy ? "positive" : "negative",
    createdAt: cluster.lastTime,
  };
}

export function absorptionEvent(label: string, absorption: Absorption, hours: number, now: number): MarketEvent {
  const buy = absorption.side === "buy";
  const share = formatPct(Math.abs(absorption.imbalance) * 100, 1).replace("+", "");
  return {
    id: uid("flow"),
    kind: "flow-pattern",
    symbol: label,
    title: buy ? "卖压被吸收，疑似有人接货" : "买盘被吸收，疑似有人出货",
    detail: buy
      ? `近 ${hours} 小时价格横盘不破低，主动卖出比买入多 ${share}`
      : `近 ${hours} 小时价格横盘不破高，主动买入比卖出多 ${share}`,
    tone: buy ? "positive" : "negative",
    createdAt: now,
  };
}

export function panicEvent(label: string, panic: PanicAbsorbed, minutes: number, now: number): MarketEvent {
  const long = panic.side === "long";
  return {
    id: uid("flow"),
    kind: "flow-pattern",
    symbol: label,
    title: long ? "恐慌盘被接走" : "逼空后冲高回落",
    detail: long
      ? `${minutes} 分钟内多单爆仓 ${formatUsd(panic.liquidatedUsd)}，价格留下长下影线收回`
      : `${minutes} 分钟内空单爆仓 ${formatUsd(panic.liquidatedUsd)}，价格留下长上影线回落`,
    tone: long ? "positive" : "negative",
    createdAt: now,
  };
}
