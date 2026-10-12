import { memo, useEffect, useMemo } from "react";
import { fetchCandlePage, provider } from "@/data";
import { mergeCandle } from "@/data/candles";
import { TradeClusterer, bigTradeThreshold, type TradeCluster } from "@/features/flow/big-trades";
import { absorptionEvent, bigTradeEvent, panicEvent } from "@/features/flow/events";
import { sumLiquidations } from "@/features/flow/liquidation-buckets";
import { ABSORPTION_WINDOW, detectAbsorption, detectPanicAbsorbed } from "@/features/flow/patterns";
import { useFeedStore } from "@/stores/feed.store";
import { useFlowStore } from "@/stores/flow.store";
import { usePreferencesStore } from "@/stores/preferences.store";
import { useTickersStore } from "@/stores/tickers.store";
import { useWorkspaceStore } from "@/stores/workspace.store";
import {
  TIMEFRAME_SECONDS,
  categoryOf,
  displayName,
  marketKey,
  type Candle,
  type MarketKind,
  type MarketRef,
  type Timeframe,
} from "@/types/market";

/** 形态识别固定在 15 分钟线上做，和图表当前看的周期无关 */
const PATTERN_TIMEFRAME: Timeframe = "15m";
const PATTERN_STEP = TIMEFRAME_SECONDS[PATTERN_TIMEFRAME];
const ABSORPTION_COOLDOWN_MS = 2 * 3600_000;
const PANIC_COOLDOWN_MS = 30 * 60_000;
const FLUSH_INTERVAL_MS = 250;

/**
 * 资金面的后台监听，只针对已打开标签里的加密货币：
 * 逐笔成交里的大单，以及 15 分钟线上的"吸收"形态。美股和商品的合约成交太小，不做。
 */
export function FlowStreams() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const markets = useMemo(() => {
    const seen = new Map<string, MarketRef>();
    for (const tab of tabs) if (categoryOf(tab.market) === "crypto") seen.set(marketKey(tab.market), tab.market);
    return [...seen.entries()];
  }, [tabs]);

  return (
    <>
      {markets.map(([key, market]) => (
        <FlowStream key={key} market={market.market} symbol={market.symbol} />
      ))}
    </>
  );
}

const FlowStream = memo(function FlowStream({ market, symbol }: { market: MarketKind; symbol: string }) {
  useEffect(() => {
    const ref: MarketRef = { exchange: "binance", market, symbol };
    const key = marketKey(ref);
    const label = displayName(ref);
    const prefs = () => usePreferencesStore.getState();
    const volume24h = () => useTickersStore.getState().tickers[key]?.quoteVolume24h;
    const push = useFeedStore.getState().push;
    const cooldowns = new Map<string, number>();
    const pass = (name: string, now: number, ms: number) => {
      const last = cooldowns.get(name);
      if (last !== undefined && now - last < ms) return false;
      cooldowns.set(name, now);
      return true;
    };

    // ── 大单 ──
    const clusterer = new TradeClusterer();
    const onCluster = (cluster: TradeCluster) => {
      if (cluster.notional < bigTradeThreshold(volume24h(), prefs().bigTradeMinUsd)) return;
      useFlowStore
        .getState()
        .addBigTrade(key, { time: cluster.lastTime, side: cluster.side, notional: cluster.notional, price: cluster.price });
      if (prefs().bigTradeAlerts) push([bigTradeEvent(label, cluster)]);
    };
    const offTrades = provider.subscribeTrades(ref, (trade) => {
      const done = clusterer.add(trade);
      if (done) onCluster(done);
    });
    const flushTimer = setInterval(() => {
      const done = clusterer.flush(Date.now());
      if (done) onCluster(done);
    }, FLUSH_INTERVAL_MS);

    // ── 吸收形态 ──
    let candles: Candle[] = [];
    let alive = true;
    void fetchCandlePage(ref, PATTERN_TIMEFRAME)
      .then((page) => {
        if (alive) candles = [...page.candles];
      })
      .catch(() => {
        // 取不到历史就等实时 K 线慢慢攒够
      });

    const evaluate = () => {
      if (!prefs().flowPatternAlerts) return;
      const now = Date.now();
      const absorption = detectAbsorption(candles);
      if (absorption && pass(`absorb:${absorption.side}`, now, ABSORPTION_COOLDOWN_MS)) {
        push([absorptionEvent(label, absorption, (ABSORPTION_WINDOW * PATTERN_STEP) / 3600, now)]);
      }
      const last = candles[candles.length - 1];
      if (market === "perp" && last) {
        const buckets = useFlowStore.getState().liquidations[symbol] ?? {};
        const liquidated = sumLiquidations(buckets, last.time, last.time + PATTERN_STEP);
        const panic = detectPanicAbsorbed(last, liquidated, volume24h());
        if (panic && pass(`panic:${panic.side}`, now, PANIC_COOLDOWN_MS)) {
          push([panicEvent(label, panic, PATTERN_STEP / 60, now)]);
        }
      }
    };

    const offCandles = provider.subscribeCandles(ref, PATTERN_TIMEFRAME, (candle, closed) => {
      mergeCandle(candles, candle);
      // 只在一根 K 线走完时判断，避免同一根反复触发
      if (closed) evaluate();
    });

    return () => {
      alive = false;
      offTrades();
      offCandles();
      clearInterval(flushTimer);
    };
  }, [market, symbol]);

  return null;
});
