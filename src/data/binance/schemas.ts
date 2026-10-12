import { z } from "zod";

const numeric = z.string().refine((s) => s !== "" && Number.isFinite(Number(s)), "不是数字");

/** [开盘时间, 开, 高, 低, 收, 成交量, ...] */
export const klineRowSchema = z.tuple([z.number(), numeric, numeric, numeric, numeric, numeric]).rest(z.unknown());
export const klinesSchema = z.array(klineRowSchema);
export type KlineRow = z.infer<typeof klineRowSchema>;

export const ticker24hSchema = z.array(
  z.object({
    symbol: z.string(),
    lastPrice: numeric,
    priceChangePercent: numeric,
    quoteVolume: numeric,
  }),
);

export const tickerSnapshotSchema = z.object({
  symbol: z.string(),
  lastPrice: numeric,
  openPrice: numeric,
  highPrice: numeric,
  lowPrice: numeric,
  quoteVolume: numeric,
});

/** 合约元数据，只取分类需要的字段 */
export const exchangeInfoSchema = z.object({
  symbols: z.array(
    z.object({
      symbol: z.string(),
      status: z.string(),
      quoteAsset: z.string(),
      contractType: z.string(),
      underlyingType: z.string().optional(),
    }),
  ),
});

export const openInterestSchema = z.object({
  symbol: z.string(),
  openInterest: numeric,
});

export const fearGreedSchema = z.object({
  data: z
    .array(
      z.object({
        value: numeric,
        value_classification: z.string(),
      }),
    )
    .min(1),
});

export const wsEnvelopeSchema = z.object({
  stream: z.string(),
  data: z.unknown(),
});

export const wsKlineSchema = z.object({
  e: z.literal("kline"),
  s: z.string(),
  k: z.object({
    t: z.number(),
    i: z.string(),
    o: numeric,
    h: numeric,
    l: numeric,
    c: numeric,
    v: numeric,
    x: z.boolean(),
  }),
});

export const wsMiniTickerSchema = z.object({
  e: z.literal("24hrMiniTicker"),
  s: z.string(),
  c: numeric,
  o: numeric,
  h: numeric,
  l: numeric,
  q: numeric,
});

export const wsMarkPriceSchema = z.object({
  e: z.literal("markPriceUpdate"),
  s: z.string(),
  p: numeric,
  r: z.string(),
  T: z.number(),
});

export const wsForceOrderSchema = z.object({
  e: z.literal("forceOrder"),
  o: z.object({
    s: z.string(),
    S: z.enum(["BUY", "SELL"]),
    q: numeric,
    p: numeric,
    ap: numeric,
    T: z.number(),
  }),
});
