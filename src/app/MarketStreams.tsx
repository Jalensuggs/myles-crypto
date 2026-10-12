import { useQuery } from "@tanstack/react-query";
import { memo, useEffect, useMemo } from "react";
import { provider } from "@/data";
import { FeedEngine } from "@/features/feed/rules";
import { useFeedStore } from "@/stores/feed.store";
import { useFlowStore } from "@/stores/flow.store";
import { usePreferencesStore } from "@/stores/preferences.store";
import { useTickersStore } from "@/stores/tickers.store";
import { useWatchlistStore } from "@/stores/watchlist.store";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { categoryOf, displayName, marketKey, type MarketKind, type MarketRef } from "@/types/market";

const engine = new FeedEngine(() => {
  const p = usePreferencesStore.getState();
  return { liquidationMinUsd: p.liquidationMinUsd, moveThresholdPct: p.moveThresholdPct };
});

/**
 * 为每个用得到的标的维持行情订阅。不渲染任何界面，只负责把数据写进 store。
 * 已打开标签的标的：最新价、资金费率、爆仓单，并参与市场异动。
 * 只在自选里的标的：只订阅最新价。
 */
export function MarketStreams() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const watchlist = useWatchlistStore((s) => s.items);

  const entries = useMemo(() => {
    const map = new Map<string, { market: MarketRef; opened: boolean }>();
    for (const market of watchlist) map.set(marketKey(market), { market, opened: false });
    for (const tab of tabs) map.set(marketKey(tab.market), { market: tab.market, opened: true });
    return [...map.entries()];
  }, [tabs, watchlist]);

  return (
    <>
      {entries.map(([key, { market, opened }]) => (
        <MarketStream key={key} market={market.market} symbol={market.symbol} label={displayName(market)} opened={opened} />
      ))}
      {entries
        .filter(([, { market }]) => market.market === "perp" && categoryOf(market) === "stock")
        .map(([key, { market }]) => (
          <StockDays key={key} symbol={market.symbol} />
        ))}
    </>
  );
}

interface MarketStreamProps {
  market: MarketKind;
  symbol: string;
  /** 异动列表里显示的名称 */
  label: string;
  opened: boolean;
}

const MarketStream = memo(function MarketStream({ market, symbol, label, opened }: MarketStreamProps) {
  useEffect(() => {
    const ref: MarketRef = { exchange: "binance", market, symbol };
    const key = marketKey(ref);
    const tickers = useTickersStore.getState();
    const push = (events: ReturnType<FeedEngine["onTicker"]>) => {
      if (events.length > 0) useFeedStore.getState().push(events);
    };

    const offs = [
      provider.subscribeTicker(ref, (ticker) => {
        tickers.setTicker(key, ticker);
        if (opened) push(engine.onTicker(label, ticker, Date.now()));
      }),
    ];
    if (opened && market === "perp") {
      offs.push(
        provider.subscribeDerivatives(symbol, (data) => {
          tickers.setDerivatives(symbol, data);
          push(engine.onFunding(label, data.fundingRate, Date.now()));
        }),
        provider.subscribeLiquidations(symbol, (liq) => {
          useFlowStore.getState().addLiquidation(liq);
          push(engine.onLiquidation(liq, label));
        }),
      );
    }
    return () => {
      for (const off of offs) off();
      if (opened) engine.forget(label);
    };
  }, [market, symbol, label, opened]);

  return null;
});

const STOCK_DAYS_REFRESH_MS = 5 * 60_000;

/** 定期取美股最近的官方日线，供标签、自选和概览计算"相对收盘价"的涨跌幅 */
const StockDays = memo(function StockDays({ symbol }: { symbol: string }) {
  const { data } = useQuery({
    queryKey: ["stock-days", symbol],
    queryFn: ({ signal }) => provider.getStockRecentDays(symbol, signal),
    staleTime: STOCK_DAYS_REFRESH_MS - 30_000,
    refetchInterval: STOCK_DAYS_REFRESH_MS,
    retry: 0,
  });
  useEffect(() => {
    if (data) useTickersStore.getState().setStockDays(symbol, data);
  }, [symbol, data]);
  return null;
});
