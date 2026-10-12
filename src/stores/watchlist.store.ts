import { create } from "zustand";
import { STORAGE_KEYS, loadStored, saveStored } from "@/lib/storage";
import type { MarketRef } from "@/types/market";
import { DEFAULT_WATCHLIST, toggleWatch, watchlistRecordSchema, type ToggleResult } from "./watchlist.logic";

interface WatchlistState {
  items: MarketRef[];
  toggle: (market: MarketRef) => ToggleResult["change"];
  reset: () => void;
}

export const useWatchlistStore = create<WatchlistState>((set, get) => ({
  items: loadStored(STORAGE_KEYS.watchlist, watchlistRecordSchema, { items: DEFAULT_WATCHLIST }).items,
  toggle: (market) => {
    const result = toggleWatch(get().items, market);
    if (result.change !== "full") set({ items: result.items });
    return result.change;
  },
  reset: () => set({ items: DEFAULT_WATCHLIST }),
}));

useWatchlistStore.subscribe((state, prev) => {
  if (state.items !== prev.items) saveStored(STORAGE_KEYS.watchlist, { items: state.items });
});
