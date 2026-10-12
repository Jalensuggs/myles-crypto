import { EventFeed } from "@/components/feed/EventFeed";
import { MarketOverview } from "@/components/feed/MarketOverview";
import { WatchList } from "@/components/feed/WatchList";
import { useFeedStore } from "@/stores/feed.store";
import { usePreferencesStore } from "@/stores/preferences.store";
import { useWatchlistStore } from "@/stores/watchlist.store";
import { useDock } from "./use-dock";

export function RightDock() {
  const { open, narrow, setOpen } = useDock();
  const tab = usePreferencesStore((s) => s.dockTab);
  const watchCount = useWatchlistStore((s) => s.items.length);
  const eventCount = useFeedStore((s) => s.events.length);
  if (!open) return null;

  const select = (next: "watchlist" | "feed") => usePreferencesStore.getState().update({ dockTab: next });

  return (
    <>
      {narrow && <button type="button" className="dock__scrim" aria-label="收起右侧栏" onClick={() => setOpen(false)} />}
      <aside className="dock" aria-label="行情、自选与异动" data-testid="right-dock">
        <MarketOverview />
        <div className="dock__tabs" role="tablist" aria-label="右侧栏内容">
          <button
            type="button"
            role="tab"
            className="dock__tab"
            data-testid="dock-tab-watchlist"
            aria-selected={tab === "watchlist"}
            onClick={() => select("watchlist")}
          >
            自选 <span className="muted">{watchCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            className="dock__tab"
            data-testid="dock-tab-feed"
            aria-selected={tab === "feed"}
            onClick={() => select("feed")}
          >
            市场异动 <span className="muted">{eventCount}</span>
          </button>
        </div>
        {tab === "watchlist" ? <WatchList /> : <EventFeed />}
      </aside>
    </>
  );
}
