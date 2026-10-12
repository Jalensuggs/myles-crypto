import type { CandleQuery, FearGreed, MarketDataProvider, Unsubscribe } from "@/data/provider";
import { aggregateSession, sessionPlan } from "@/features/session/aggregate";
import { isUsTradingDay, sessionOpenTime, sessionPosition } from "@/features/session/us-session";
import { guessPrecision } from "@/lib/format";
import { useConnectionStore } from "@/stores/connection.store";
import {
  TIMEFRAME_SECONDS,
  type AssetCategory,
  type Candle,
  type CandlePage,
  type Derivatives,
  type Liquidation,
  type MarketKind,
  type MarketRef,
  type SymbolInfo,
  type Ticker,
  type Timeframe,
} from "@/types/market";

const BASE_PRICES: Record<string, number> = {
  BTCUSDT: 84000,
  ETHUSDT: 3200,
  SOLUSDT: 180,
  BNBUSDT: 650,
  XRPUSDT: 2.4,
  DOGEUSDT: 0.19,
  ADAUSDT: 0.72,
  AVAXUSDT: 34,
  LINKUSDT: 18.5,
  SUIUSDT: 3.1,
  LTCUSDT: 96,
  TRXUSDT: 0.24,
  AAPLUSDT: 338,
  NVDAUSDT: 230,
  TSLAUSDT: 383,
  MSFTUSDT: 512,
  QQQUSDT: 752,
  XAUUSDT: 4180,
  CLUSDT: 92,
  SAMSUNGUSDT: 188,
};

const MOCK_CATEGORIES: Record<string, AssetCategory> = {
  AAPLUSDT: "stock",
  NVDAUSDT: "stock",
  TSLAUSDT: "stock",
  MSFTUSDT: "stock",
  QQQUSDT: "stock",
  XAUUSDT: "commodity",
  CLUSDT: "commodity",
  SAMSUNGUSDT: "other",
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 0 到 1 之间的确定性伪随机数 */
function noise(seed: number, n: number): number {
  let x = (seed ^ Math.imul(n | 0, 0x9e3779b1)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function basePrice(symbol: string): number {
  return BASE_PRICES[symbol] ?? 0.5 + (hash(symbol) % 5000) / 100;
}

/**
 * 任意时刻的模拟价格。它是时间的连续函数，所以不同周期、
 * 不同分页以及实时推送之间的数据天然一致。
 */
export function mockPrice(symbol: string, timeSec: number): number {
  const seed = hash(symbol);
  const phase = (seed % 1000) / 100;
  const days = timeSec / 86400;
  const wave =
    0.12 * Math.sin(days / 9 + phase) +
    0.05 * Math.sin(days / 1.7 + phase * 2) +
    0.015 * Math.sin((timeSec / 3600) * 1.3 + phase * 3) +
    0.004 * Math.sin((timeSec / 300) * 1.1 + phase * 5) +
    0.0012 * Math.sin((timeSec / 20) * 1.7 + phase * 7);
  return basePrice(symbol) * (1 + wave);
}

function mockCandle(symbol: string, openTime: number, step: number, nowSec: number): Candle {
  const seed = hash(symbol);
  const end = Math.min(openTime + step, nowSec);
  const open = mockPrice(symbol, openTime);
  const close = mockPrice(symbol, end);
  let high = Math.max(open, close);
  let low = Math.min(open, close);
  const samples = 6;
  for (let i = 1; i < samples; i++) {
    const p = mockPrice(symbol, openTime + ((end - openTime) * i) / samples);
    if (p > high) high = p;
    if (p < low) low = p;
  }
  const bucket = Math.floor(openTime / step);
  const wick = basePrice(symbol) * 0.0006 * Math.sqrt(step / 60);
  high += wick * noise(seed, bucket);
  low -= wick * noise(seed, bucket + 7919);
  const volume = (200 + 900 * noise(seed, bucket + 104729)) * (step / 60) * ((end - openTime) / step);
  return { time: openTime, open, high, low, close, volume };
}

export class MockProvider implements MarketDataProvider {
  readonly isMock = true;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
    useConnectionStore.getState().setStatus("perp", "open");
  }

  private nowSec(): number {
    return Math.floor(this.now() / 1000);
  }

  async getCandles(query: CandleQuery): Promise<CandlePage> {
    const step = TIMEFRAME_SECONDS[query.timeframe];
    const limit = query.limit ?? 1000;
    const nowSec = this.nowSec();
    const endSec = query.endTime !== undefined ? Math.min(Math.floor(query.endTime / 1000), nowSec) : nowSec;
    const lastOpen = Math.floor(endSec / step) * step;
    const candles: Candle[] = [];
    for (let i = limit - 1; i >= 0; i--) {
      candles.push(mockCandle(query.market.symbol, lastOpen - i * step, step, nowSec));
    }
    return { candles, precision: guessPrecision(basePrice(query.market.symbol)) };
  }

  async getSymbols(market: MarketKind): Promise<SymbolInfo[]> {
    const nowSec = this.nowSec();
    return Object.keys(BASE_PRICES)
      .filter((symbol) => market === "perp" || !MOCK_CATEGORIES[symbol])
      .map((symbol, i) => {
        const last = mockPrice(symbol, nowSec);
        const open = mockPrice(symbol, nowSec - 86400);
        return {
          symbol,
          market,
          category: MOCK_CATEGORIES[symbol] ?? ("crypto" as const),
          last,
          changePct: ((last - open) / open) * 100,
          quoteVolume: 9e9 / (i + 1),
        };
      })
      .sort((a, b) => b.quoteVolume - a.quoteVolume);
  }

  async getOpenInterest(symbol: string): Promise<number> {
    return 2e9 / basePrice(symbol);
  }

  async getFearGreed(): Promise<FearGreed> {
    return { value: 62, label: "Greed" };
  }

  /** 模拟的"官方历史"：和合约用同一个价格函数，只是能回溯得更久 */
  async getStockHistory(symbol: string, timeframe: Timeframe): Promise<Candle[] | null> {
    if (MOCK_CATEGORIES[symbol] !== "stock") return null;
    const plan = sessionPlan(timeframe);
    const step = TIMEFRAME_SECONDS[plan.source];
    const daysBack = timeframe === "1d" ? 420 : timeframe === "1m" ? 6 : plan.groupMinutes ? 200 : 45;
    const nowSec = this.nowSec();
    const today = sessionPosition(nowSec).day;
    const source: Candle[] = [];
    for (let day = today - daysBack; day <= today; day++) {
      if (!isUsTradingDay(day)) continue;
      const open = sessionOpenTime(day);
      for (let t = open; t < open + 390 * 60 && t <= nowSec; t += step) {
        source.push(mockCandle(symbol, t, step, nowSec));
      }
    }
    const candles = plan.groupMinutes ? aggregateSession(source, plan.groupMinutes) : source;
    return candles.length >= 2 ? candles : null;
  }

  async getStockRecentDays(symbol: string): Promise<Candle[] | null> {
    const days = await this.getStockHistory(symbol, "1d");
    return days ? days.slice(-15) : null;
  }

  subscribeCandles(
    market: MarketRef,
    timeframe: Timeframe,
    handler: (candle: Candle, closed: boolean) => void,
  ): Unsubscribe {
    const step = TIMEFRAME_SECONDS[timeframe];
    let lastOpen = Math.floor(this.nowSec() / step) * step;
    const timer = setInterval(() => {
      const nowSec = this.nowSec();
      const open = Math.floor(nowSec / step) * step;
      if (open !== lastOpen) {
        handler(mockCandle(market.symbol, lastOpen, step, nowSec), true);
        lastOpen = open;
      }
      handler(mockCandle(market.symbol, open, step, nowSec), false);
    }, 1000);
    return () => clearInterval(timer);
  }

  subscribeTicker(market: MarketRef, handler: (ticker: Ticker) => void): Unsubscribe {
    const emit = () => {
      const nowSec = this.nowSec();
      const last = mockPrice(market.symbol, nowSec);
      const open = mockPrice(market.symbol, nowSec - 86400);
      let high = Math.max(last, open);
      let low = Math.min(last, open);
      for (let i = 1; i < 48; i++) {
        const p = mockPrice(market.symbol, nowSec - i * 1800);
        if (p > high) high = p;
        if (p < low) low = p;
      }
      handler({
        last,
        open24h: open,
        high24h: high,
        low24h: low,
        quoteVolume24h: basePrice(market.symbol) * 1.2e5,
        changePct: ((last - open) / open) * 100,
      });
    };
    emit();
    const timer = setInterval(emit, 1000);
    return () => clearInterval(timer);
  }

  subscribeDerivatives(symbol: string, handler: (data: Derivatives) => void): Unsubscribe {
    const emit = () => {
      const now = this.now();
      const eightHours = 8 * 3600 * 1000;
      handler({
        markPrice: mockPrice(symbol, Math.floor(now / 1000)),
        fundingRate: 0.0001 * (0.5 + noise(hash(symbol), Math.floor(now / eightHours))),
        nextFundingTime: (Math.floor(now / eightHours) + 1) * eightHours,
      });
    };
    emit();
    const timer = setInterval(emit, 1000);
    return () => clearInterval(timer);
  }

  subscribeLiquidations(symbol: string, handler: (liq: Liquidation) => void): Unsubscribe {
    const seed = hash(symbol);
    let tick = 0;
    const timer = setInterval(() => {
      tick += 1;
      if (noise(seed, tick) > 0.12) return;
      const now = this.now();
      const price = mockPrice(symbol, Math.floor(now / 1000));
      const notional = 60_000 + noise(seed, tick + 31) * 900_000;
      handler({
        symbol,
        side: noise(seed, tick + 17) > 0.5 ? "long" : "short",
        price,
        quantity: notional / price,
        notional,
        time: now,
      });
    }, 2000);
    return () => clearInterval(timer);
  }

  onReconnect(): Unsubscribe {
    return () => {};
  }
}
