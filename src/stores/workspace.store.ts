import { create } from "zustand";
import { STORAGE_KEYS, loadStored, saveStored } from "@/lib/storage";
import { uid } from "@/lib/format";
import type { MarketRef, MarketTab } from "@/types/market";
import {
  activate,
  activeTabId,
  addTab,
  closeTab,
  defaultWorkspace,
  focusPane,
  layoutRecordSchema,
  reconcile,
  setLayout,
  tabsRecordSchema,
  updateTab,
  type LayoutMode,
  type WorkspaceData,
} from "./workspace.logic";

interface WorkspaceState extends WorkspaceData {
  addTab: (market: MarketRef) => boolean;
  closeTab: (tabId: string) => void;
  activate: (tabId: string) => void;
  focusPane: (index: number) => void;
  setLayout: (layout: LayoutMode) => void;
  updateTab: (tabId: string, patch: Partial<Omit<MarketTab, "id">>) => void;
  reset: () => void;
}

function loadInitial(): WorkspaceData {
  const defaults = defaultWorkspace();
  const tabs = loadStored(STORAGE_KEYS.tabs, tabsRecordSchema, { tabs: defaults.tabs }).tabs;
  const layout = loadStored(STORAGE_KEYS.layout, layoutRecordSchema, {
    layout: defaults.layout,
    panes: defaults.panes,
    focused: defaults.focused,
  });
  return reconcile({ tabs, ...layout });
}

const pick = (s: WorkspaceData): WorkspaceData => ({
  tabs: s.tabs,
  layout: s.layout,
  panes: s.panes,
  focused: s.focused,
});

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...loadInitial(),
  addTab: (market) => {
    const result = addTab(pick(get()), market, uid("tab"));
    if (!result.ok) return false;
    set(result.data);
    return true;
  },
  closeTab: (tabId) => set((s) => closeTab(pick(s), tabId)),
  activate: (tabId) => set((s) => activate(pick(s), tabId)),
  focusPane: (index) => set((s) => focusPane(pick(s), index)),
  setLayout: (layout) => set((s) => setLayout(pick(s), layout)),
  updateTab: (tabId, patch) => set((s) => updateTab(pick(s), tabId, patch)),
  reset: () => set(defaultWorkspace()),
}));

useWorkspaceStore.subscribe((state, prev) => {
  if (state.tabs !== prev.tabs) saveStored(STORAGE_KEYS.tabs, { tabs: state.tabs });
  if (state.layout !== prev.layout || state.panes !== prev.panes || state.focused !== prev.focused) {
    saveStored(STORAGE_KEYS.layout, { layout: state.layout, panes: state.panes, focused: state.focused });
  }
});

export const selectActiveTabId = (s: WorkspaceData): string => activeTabId(s);
export const selectActiveTab = (s: WorkspaceData): MarketTab => {
  const id = activeTabId(s);
  return s.tabs.find((t) => t.id === id) ?? s.tabs[0]!;
};
