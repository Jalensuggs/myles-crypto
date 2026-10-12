import { normalizeCandles } from "@/data/candles";
import { decimalsOf } from "@/lib/format";
import type {
  AssetCategory,
  Candle,
  CandlePage,
  Derivatives,
  Liquidation,
  MarketKind,
  OpenInterestPoint,
  SymbolInfo,
  Ticker,
  Trade,
} from "@/types/market";
import {
  exchangeInfoSchema,
  klinesSchema,
  openInterestHistSchema,
  ticker24hSchema,
  tickerSnapshotSchema,
  wsAggTradeSchema,
  wsForceOrderSchema,
  wsKlineSchema,
  wsMarkPriceSchema,
  wsMiniTickerSchema,
} from "./schemas";

const MAX_PRECISION = 8;

export function parseKlines(json: unknown): CandlePage {
  const rows = klinesSchema.parse(json);
  let precision = 0;
  const raw: Candle[] = rows.map((row) => {
    for (let i = 1; i <= 4; i++) {
      const d = decimalsOf(row[i] as string);
      if (d > precision) precision = d;
    }
    const candle: Candle = {
      time: Math.floor(row[0] / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    };
    // 第 10 列是主动买入的成交量，用来算主动买卖的差额
    const takerBuy = typeof row[9] === "string" ? Number(row[9]) : Number.NaN;
    if (Number.isFinite(takerBuy)) candle.takerBuyVolume = takerBuy;
    return candle;
  });
  return { candles: normalizeCandles(raw), precision: Math.min(Math.max(precision, 1), MAX_PRECISION) };
}

const CATEGORY_BY_UNDERLYING: Record<string, AssetCategory> = {
  COIN: "crypto",
  INDEX: "crypto",
  EQUITY: "stock",
  COMMODITY: "commodity",
};

/**
 * 从合约元数据里取出"正在交易的 USDT 永续合约"及其资产类型。
 * 美股是 EQUITY，商品是 COMMODITY，港股、韩股、外汇等归为其他。
 */
export function parseContractCategories(json: unknown): Map<string, AssetCategory> {
  const out = new Map<string, AssetCategory>();
  for (const s of exchangeInfoSchema.parse(json).symbols) {
    if (s.status !== "TRADING" || s.quoteAsset !== "USDT" || !s.contractType.endsWith("PERPETUAL")) continue;
    out.set(s.symbol, CATEGORY_BY_UNDERLYING[s.underlyingType ?? "COIN"] ?? "other");
  }
  return out;
}

/**
 * 解析全市场 24 小时行情。传入 categories 时只保留其中列出的标的并带上分类；
 * 不传（现货，或合约元数据暂时取不到）时全部按加密货币处理。
 */
export function parseSymbols(
  json: unknown,
  market: MarketKind = "perp",
  categories?: ReadonlyMap<string, AssetCategory>,
  quote = "USDT",
): SymbolInfo[] {
  const out: SymbolInfo[] = [];
  for (const t of ticker24hSchema.parse(json)) {
    if (!t.symbol.endsWith(quote) || !/^[A-Z0-9]+$/.test(t.symbol)) continue;
    const category = categories ? categories.get(t.symbol) : "crypto";
    if (!category) continue;
    const last = Number(t.lastPrice);
    const quoteVolume = Number(t.quoteVolume);
    if (!(last > 0) || !(quoteVolume > 0)) continue;
    out.push({ symbol: t.symbol, market, category, last, changePct: Number(t.priceChangePercent), quoteVolume });
  }
  return out.sort((a, b) => b.quoteVolume - a.quoteVolume);
}

export function parseWsKline(data: unknown): { candle: Candle; closed: boolean } | null {
  const r = wsKlineSchema.safeParse(data);
  if (!r.success) return null;
  const k = r.data.k;
  const candle: Candle = {
    time: Math.floor(k.t / 1000),
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
  };
  if (k.V !== undefined) candle.takerBuyVolume = Number(k.V);
  return { candle, closed: k.x };
}

export function parseWsTicker(data: unknown): Ticker | null {
  const r = wsMiniTickerSchema.safeParse(data);
  if (!r.success) return null;
  const last = Number(r.data.c);
  const open = Number(r.data.o);
  return {
    last,
    open24h: open,
    high24h: Number(r.data.h),
    low24h: Number(r.data.l),
    quoteVolume24h: Number(r.data.q),
    changePct: open > 0 ? ((last - open) / open) * 100 : 0,
  };
}

/** 单个标的的 24 小时行情快照（HTTP） */
export function parseTickerSnapshot(json: unknown): Ticker {
  const t = tickerSnapshotSchema.parse(json);
  const last = Number(t.lastPrice);
  const open = Number(t.openPrice);
  return {
    last,
    open24h: open,
    high24h: Number(t.highPrice),
    low24h: Number(t.lowPrice),
    quoteVolume24h: Number(t.quoteVolume),
    changePct: open > 0 ? ((last - open) / open) * 100 : 0,
  };
}

export function parseWsTrade(data: unknown): Trade | null {
  const r = wsAggTradeSchema.safeParse(data);
  if (!r.success) return null;
  return {
    time: r.data.T,
    price: Number(r.data.p),
    quantity: Number(r.data.q),
    side: r.data.m ? "sell" : "buy",
  };
}

export function parseOpenInterestHistory(json: unknown): OpenInterestPoint[] {
  return openInterestHistSchema
    .parse(json)
    .map((row) => ({ time: Math.floor(row.timestamp / 1000), value: Number(row.sumOpenInterest) }))
    .filter((p) => p.value > 0)
    .sort((a, b) => a.time - b.time);
}

export function parseWsDerivatives(data: unknown): Derivatives | null {
  const r = wsMarkPriceSchema.safeParse(data);
  if (!r.success) return null;
  const rate = Number(r.data.r);
  return {
    markPrice: Number(r.data.p),
    fundingRate: Number.isFinite(rate) ? rate : 0,
    nextFundingTime: r.data.T,
  };
}

export function parseWsLiquidation(data: unknown): Liquidation | null {
  const r = wsForceOrderSchema.safeParse(data);
  if (!r.success) return null;
  const o = r.data.o;
  const quantity = Number(o.q);
  const avg = Number(o.ap);
  const price = avg > 0 ? avg : Number(o.p);
  return {
    symbol: o.s,
    // 强平卖单说明被平掉的是多单
    side: o.S === "SELL" ? "long" : "short",
    price,
    quantity,
    notional: price * quantity,
    time: o.T,
  };
}
