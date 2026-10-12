import { create } from "zustand";
import { STORAGE_KEYS, loadStored, saveStored } from "@/lib/storage";
import type { DrawingObject, DrawingTool } from "@/types/drawing";
import {
  commit,
  drawingsRecordSchema,
  redo,
  undo,
  withAdded,
  withCleared,
  withRemoved,
  withUpdated,
  type DrawingHistory,
  type DrawingsByMarket,
} from "./drawings.logic";

interface DrawingsState extends DrawingHistory {
  tool: DrawingTool;
  selected: { key: string; id: string } | null;
  lockedAll: boolean;
  hiddenAll: boolean;
  /** 拖动过程中的临时状态，拖动开始时保存一份用于撤销 */
  dragOrigin: DrawingsByMarket | null;

  setTool: (tool: DrawingTool) => void;
  select: (selection: { key: string; id: string } | null) => void;
  add: (key: string, drawing: DrawingObject) => void;
  remove: (key: string, id: string) => void;
  removeSelected: () => void;
  clear: (key: string) => void;
  setColor: (key: string, id: string, color: string) => void;
  beginDrag: () => void;
  dragUpdate: (key: string, id: string, patch: Partial<Omit<DrawingObject, "id" | "type">>) => void;
  endDrag: () => void;
  undo: () => void;
  redo: () => void;
  toggleLockAll: () => void;
  toggleHideAll: () => void;
  resetAll: () => void;
}

const history = (s: DrawingHistory): DrawingHistory => ({ byMarket: s.byMarket, past: s.past, future: s.future });

export const useDrawingsStore = create<DrawingsState>((set, get) => ({
  byMarket: loadStored(STORAGE_KEYS.drawings, drawingsRecordSchema, { byMarket: {} }).byMarket,
  past: [],
  future: [],
  tool: "cursor",
  selected: null,
  lockedAll: false,
  hiddenAll: false,
  dragOrigin: null,

  setTool: (tool) => set({ tool, selected: tool === "cursor" ? get().selected : null }),
  select: (selected) => set({ selected }),
  // 画完后不选中新图形：用户常常接着换一种颜色画下一条线，
  // 如果刚画的那条还处于选中状态，换颜色会把它也改掉。
  add: (key, drawing) => set((s) => ({ ...commit(history(s), withAdded(s.byMarket, key, drawing)), selected: null })),
  remove: (key, id) =>
    set((s) => ({
      ...commit(history(s), withRemoved(s.byMarket, key, id)),
      selected: s.selected?.id === id ? null : s.selected,
    })),
  removeSelected: () => {
    const { selected } = get();
    if (selected) get().remove(selected.key, selected.id);
  },
  clear: (key) => set((s) => ({ ...commit(history(s), withCleared(s.byMarket, key)), selected: null })),
  setColor: (key, id, color) => set((s) => commit(history(s), withUpdated(s.byMarket, key, id, { color }))),

  beginDrag: () => set((s) => ({ dragOrigin: s.byMarket })),
  dragUpdate: (key, id, patch) => set((s) => ({ byMarket: withUpdated(s.byMarket, key, id, patch) })),
  endDrag: () =>
    set((s) => {
      const origin = s.dragOrigin;
      if (!origin || origin === s.byMarket) return { dragOrigin: null };
      // 整个拖动过程只算一步撤销
      return { ...commit({ byMarket: origin, past: s.past, future: s.future }, s.byMarket), dragOrigin: null };
    }),

  undo: () => set((s) => ({ ...undo(history(s)), selected: null })),
  redo: () => set((s) => ({ ...redo(history(s)), selected: null })),
  toggleLockAll: () => set((s) => ({ lockedAll: !s.lockedAll, selected: null })),
  toggleHideAll: () => set((s) => ({ hiddenAll: !s.hiddenAll, selected: null })),
  resetAll: () => set({ byMarket: {}, past: [], future: [], selected: null, lockedAll: false, hiddenAll: false }),
}));

let saveTimer: ReturnType<typeof setTimeout> | null = null;
useDrawingsStore.subscribe((state, prev) => {
  if (state.byMarket === prev.byMarket || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveStored(STORAGE_KEYS.drawings, { byMarket: useDrawingsStore.getState().byMarket });
  }, 300);
});

const EMPTY: DrawingObject[] = [];
export const selectDrawings = (key: string) => (s: { byMarket: DrawingsByMarket }) => s.byMarket[key] ?? EMPTY;

if (typeof window !== "undefined") {
  // 关闭或刷新页面前把还没落盘的修改写进去
  window.addEventListener("pagehide", () => {
    saveStored(STORAGE_KEYS.drawings, { byMarket: useDrawingsStore.getState().byMarket });
  });
}
