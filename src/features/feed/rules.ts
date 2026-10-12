import { formatPct, formatPrice, formatUsd, guessPrecision, uid } from "@/lib/format";
import type { Liquidation, MarketEvent, Ticker } from "@/types/market";

export interface FeedThresholds {
  liquidationMinUsd: number;
  moveThresholdPct: number;
}

export const FUNDING_THRESHOLD = 0.0005;
export const MOVE_WINDOW_MS = 5 * 60_000;
export const MOVE_COOLDOWN_MS = 10 * 60_000;
export const FUNDING_COOLDOWN_MS = 4 * 3600_000;
export const BREAK_COOLDOWN_MS = 30 * 60_000;
const SAMPLE_SPACING_MS = 5_000;

interface Sample {
  t: number;
  price: number;
}

interface SymbolState {
  samples: Sample[];
  high24h?: number;
  low24h?: number;
}

/**
 * 根据实时行情生成"市场异动"事件。不依赖界面和网络，
 * 时间由调用方传入，方便测试。
 */
export class FeedEngine {
  private readonly symbols = new Map<string, SymbolState>();
  private readonly cooldowns = new Map<string, number>();

  constructor(private readonly thresholds: () => FeedThresholds) {}

  onLiquidation(liq: Liquidation, label: string): MarketEvent[] {
    if (liq.notional < this.thresholds().liquidationMinUsd) return [];
    const long = liq.side === "long";
    return [
      this.make({
        kind: "liquidation",
        symbol: label,
        title: `${long ? "多单" : "空单"}爆仓 ${formatUsd(liq.notional)}`,
        detail: `成交价 ${formatPrice(liq.price, guessPrecision(liq.price))}`,
        tone: long ? "negative" : "positive",
        createdAt: liq.time,
      }),
    ];
  }

  onFunding(label: string, rate: number, now: number): MarketEvent[] {
    if (Math.abs(rate) < FUNDING_THRESHOLD) return [];
    if (!this.passCooldown(`funding:${label}`, now, FUNDING_COOLDOWN_MS)) return [];
    const pct = formatPct(rate * 100, 4);
    return [
      this.make({
        kind: "funding",
        symbol: label,
        title: rate > 0 ? `资金费率偏高 ${pct}` : `资金费率为负 ${pct}`,
        detail: rate > 0 ? "多头向空头付费，多头较拥挤" : "空头向多头付费，空头较拥挤",
        tone: "warning",
        createdAt: now,
      }),
    ];
  }

  onTicker(label: string, ticker: Ticker, now: number): MarketEvent[] {
    const state = this.stateOf(label);
    const events: MarketEvent[] = [];
    const precision = guessPrecision(ticker.last);

    // 突破 24 小时区间：与上一次看到的高低点比较，首次样本只做记录
    if (state.high24h !== undefined && ticker.high24h > state.high24h && ticker.last >= state.high24h) {
      if (this.passCooldown(`break-up:${label}`, now, BREAK_COOLDOWN_MS)) {
        events.push(
          this.make({
            kind: "range-break",
            symbol: label,
            title: "突破 24 小时新高",
            detail: `现价 ${formatPrice(ticker.last, precision)}`,
            tone: "positive",
            createdAt: now,
          }),
        );
      }
    }
    if (state.low24h !== undefined && ticker.low24h < state.low24h && ticker.last <= state.low24h) {
      if (this.passCooldown(`break-down:${label}`, now, BREAK_COOLDOWN_MS)) {
        events.push(
          this.make({
            kind: "range-break",
            symbol: label,
            title: "跌破 24 小时新低",
            detail: `现价 ${formatPrice(ticker.last, precision)}`,
            tone: "negative",
            createdAt: now,
          }),
        );
      }
    }
    state.high24h = ticker.high24h;
    state.low24h = ticker.low24h;

    // 急涨急跌：与 5 分钟窗口内最早的样本比较
    const samples = state.samples;
    while (samples.length > 0 && now - samples[0]!.t > MOVE_WINDOW_MS) samples.shift();
    const oldest = samples[0];
    if (oldest && oldest.price > 0) {
      const changePct = ((ticker.last - oldest.price) / oldest.price) * 100;
      if (Math.abs(changePct) >= this.thresholds().moveThresholdPct) {
        const up = changePct > 0;
        if (this.passCooldown(`move-${up ? "up" : "down"}:${label}`, now, MOVE_COOLDOWN_MS)) {
          const minutes = Math.max(1, Math.round((now - oldest.t) / 60_000));
          events.push(
            this.make({
              kind: "price-move",
              symbol: label,
              title: `${minutes} 分钟${up ? "急涨" : "急跌"} ${formatPct(changePct)}`,
              detail: `现价 ${formatPrice(ticker.last, precision)}`,
              tone: up ? "positive" : "negative",
              createdAt: now,
            }),
          );
        }
      }
    }
    const newest = samples[samples.length - 1];
    if (!newest || now - newest.t >= SAMPLE_SPACING_MS) samples.push({ t: now, price: ticker.last });

    return events;
  }

  forget(label: string): void {
    this.symbols.delete(label);
  }

  private stateOf(label: string): SymbolState {
    let state = this.symbols.get(label);
    if (!state) {
      state = { samples: [] };
      this.symbols.set(label, state);
    }
    return state;
  }

  private passCooldown(key: string, now: number, cooldownMs: number): boolean {
    const last = this.cooldowns.get(key);
    if (last !== undefined && now - last < cooldownMs) return false;
    this.cooldowns.set(key, now);
    return true;
  }

  private make(event: Omit<MarketEvent, "id">): MarketEvent {
    return { ...event, id: uid(event.kind) };
  }
}
