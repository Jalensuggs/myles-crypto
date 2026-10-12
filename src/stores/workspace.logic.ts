import {
  ASSET_CATEGORIES,
  CHART_TYPES,
  TIMEFRAMES,
  marketKey,
  perp,
  spot,
  type MarketRef,
  type MarketTab,
} from "@/types/market";
import { z } from "zod";

export const MAX_TABS = 8;
export type LayoutMode = 1 | 2 | 4;

export interface WorkspaceData {
  tabs: MarketTab[];
  layout: LayoutMode;
  /** 每个图表面板显示的标签 id，长度等于 layout */
  panes: string[];
  /** 当前聚焦的面板序号 */
  focused: number;
}

export const marketRefSchema = z.object({
  exchange: z.literal("binance"),
  market: z.enum(["perp", "spot"]),
  symbol: z.string().regex(/^[A-Z0-9]{2,24}$/),
  category: z.enum(ASSET_CATEGORIES).optional(),
});

export const tabSchema = z.object({
  id: z.string().min(1),
  market: marketRefSchema,
  timeframe: z.enum(TIMEFRAMES),
  chartType: z.enum(CHART_TYPES),
});

export const tabsRecordSchema = z.object({
  tabs: z.array(tabSchema).min(1).max(MAX_TABS),
});

export const layoutRecordSchema = z.object({
  layout: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  panes: z.array(z.string()),
  focused: z.number().int().min(0),
});

/** 默认标签：比特币看现货价，另外带两个主流合约和三只美股 */
export const DEFAULT_MARKETS: MarketRef[] = [
  spot("BTCUSDT"),
  perp("ETHUSDT"),
  perp("SOLUSDT"),
  perp("AAPLUSDT", "stock"),
  perp("NVDAUSDT", "stock"),
  perp("TSLAUSDT", "stock"),
];

export function makeTab(market: MarketRef, id: string): MarketTab {
  return { id, market, timeframe: "15m", chartType: "candles" };
}

export function defaultWorkspace(): WorkspaceData {
  const tabs = DEFAULT_MARKETS.map((market, i) => makeTab(market, `tab_default_${i}`));
  return reconcile({ tabs, layout: 1, panes: [], focused: 0 });
}

/**
 * 让面板分配重新自洽：数量等于布局格数，每格指向存在的标签，
 * 尽量不让两格显示同一个标签。
 */
export function reconcile(data: WorkspaceData): WorkspaceData {
  const ids = new Set(data.tabs.map((t) => t.id));
  const panes: string[] = [];
  for (let i = 0; i < data.layout; i++) {
    const wanted = data.panes[i];
    if (wanted && ids.has(wanted) && !panes.includes(wanted)) {
      panes.push(wanted);
      continue;
    }
    const unused = data.tabs.find((t) => !panes.includes(t.id));
    panes.push((unused ?? data.tabs[0]!).id);
  }
  const focused = Math.min(Math.max(0, data.focused), panes.length - 1);
  return { ...data, panes, focused };
}

export function activeTabId(data: WorkspaceData): string {
  return data.panes[data.focused] ?? data.tabs[0]!.id;
}

export type AddResult = { ok: true; data: WorkspaceData; tabId: string } | { ok: false; reason: "full" };

/** 新增标签并在当前面板显示。标的已存在时直接切过去，不重复添加。 */
export function addTab(data: WorkspaceData, market: MarketRef, newId: string): AddResult {
  const existing = data.tabs.find((t) => marketKey(t.market) === marketKey(market));
  if (existing) return { ok: true, data: activate(data, existing.id), tabId: existing.id };
  if (data.tabs.length >= MAX_TABS) return { ok: false, reason: "full" };
  const tab = makeTab(market, newId);
  const next = { ...data, tabs: [...data.tabs, tab] };
  return { ok: true, data: activate(next, tab.id), tabId: tab.id };
}

/** 在当前聚焦的面板里显示指定标签 */
export function activate(data: WorkspaceData, tabId: string): WorkspaceData {
  if (!data.tabs.some((t) => t.id === tabId)) return data;
  const shownAt = data.panes.indexOf(tabId);
  if (shownAt >= 0) return { ...data, focused: shownAt };
  const panes = [...data.panes];
  panes[data.focused] = tabId;
  return { ...data, panes };
}

/** 关闭标签。至少保留一个；关闭的是当前标签时切到相邻标签。 */
export function closeTab(data: WorkspaceData, tabId: string): WorkspaceData {
  const index = data.tabs.findIndex((t) => t.id === tabId);
  if (index < 0 || data.tabs.length <= 1) return data;
  const tabs = data.tabs.filter((t) => t.id !== tabId);
  const neighbor = (tabs[index] ?? tabs[index - 1])!.id;
  const panes = data.panes.map((id) => (id === tabId ? neighbor : id));
  return reconcile({ ...data, tabs, panes });
}

export function setLayout(data: WorkspaceData, layout: LayoutMode): WorkspaceData {
  const active = activeTabId(data);
  const next = reconcile({ ...data, layout, panes: data.panes.slice(0, layout) });
  const at = next.panes.indexOf(active);
  if (at >= 0) return { ...next, focused: at };
  const panes = [...next.panes];
  panes[0] = active;
  return reconcile({ ...next, panes, focused: 0 });
}

export function focusPane(data: WorkspaceData, index: number): WorkspaceData {
  if (index < 0 || index >= data.panes.length || index === data.focused) return data;
  return { ...data, focused: index };
}

export function updateTab(data: WorkspaceData, tabId: string, patch: Partial<Omit<MarketTab, "id">>): WorkspaceData {
  if (patch.market) {
    const key = marketKey(patch.market);
    const duplicate = data.tabs.find((t) => t.id !== tabId && marketKey(t.market) === key);
    // 目标标的已经有标签时不产生重复，直接切过去
    if (duplicate) return activate(data, duplicate.id);
  }
  return { ...data, tabs: data.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)) };
}
