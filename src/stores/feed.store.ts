import { create } from "zustand";
import { z } from "zod";
import { STORAGE_KEYS, loadStored, saveStored } from "@/lib/storage";
import type { MarketEvent } from "@/types/market";

export const MAX_EVENTS = 200;

export const eventSchema = z.object({
  id: z.string(),
  kind: z.enum(["liquidation", "price-move", "funding", "range-break", "big-trade", "flow-pattern"]),
  symbol: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  tone: z.enum(["positive", "negative", "neutral", "warning"]),
  createdAt: z.number(),
});

const feedRecordSchema = z.object({ events: z.array(eventSchema).max(MAX_EVENTS) });

interface FeedState {
  events: MarketEvent[];
  push: (events: MarketEvent[]) => void;
  clear: () => void;
}

/** 新事件放在最前面，总数不超过上限 */
export function prependEvents(existing: MarketEvent[], incoming: MarketEvent[], max = MAX_EVENTS): MarketEvent[] {
  if (incoming.length === 0) return existing;
  return [...incoming].reverse().concat(existing).slice(0, max);
}

export const useFeedStore = create<FeedState>((set) => ({
  events: loadStored(STORAGE_KEYS.feed, feedRecordSchema, { events: [] }).events,
  push: (events) => set((s) => ({ events: prependEvents(s.events, events) })),
  clear: () => set({ events: [] }),
}));

let saveTimer: ReturnType<typeof setTimeout> | null = null;
useFeedStore.subscribe(() => {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveStored(STORAGE_KEYS.feed, { events: useFeedStore.getState().events });
  }, 2000);
});
