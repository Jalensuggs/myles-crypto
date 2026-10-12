import { describe, expect, it } from "vitest";
import { displayName, perp, spot } from "@/types/market";
import {
  MAX_TABS,
  activate,
  activeTabId,
  addTab,
  closeTab,
  defaultWorkspace,
  focusPane,
  reconcile,
  setLayout,
  tabsRecordSchema,
  updateTab,
  type WorkspaceData,
} from "./workspace.logic";

function mustAdd(data: WorkspaceData, symbol: string, id: string): WorkspaceData {
  const r = addTab(data, perp(symbol), id);
  if (!r.ok) throw new Error("标签已满");
  return r.data;
}

describe("默认工作区", () => {
  it("有 6 个标签：比特币现货、两个加密合约和三只美股，单图显示第一个", () => {
    const ws = defaultWorkspace();
    expect(ws.tabs).toHaveLength(6);
    expect(ws.tabs.map((t) => displayName(t.market))).toEqual(["BTCUSDT", "ETHUSDT.P", "SOLUSDT.P", "AAPL", "NVDA", "TSLA"]);
    expect(ws.tabs[0]!.market.market).toBe("spot");
    expect(ws.tabs.slice(3).every((t) => t.market.category === "stock")).toBe(true);
    expect(ws.layout).toBe(1);
    expect(activeTabId(ws)).toBe(ws.tabs[0]!.id);
  });
});

describe("addTab", () => {
  it("新增后自动切到新标签", () => {
    const ws = mustAdd(defaultWorkspace(), "AVAXUSDT", "t7");
    expect(ws.tabs).toHaveLength(7);
    expect(activeTabId(ws)).toBe("t7");
  });

  it("最多 8 个，第 9 个被拒绝且状态不变", () => {
    let ws = defaultWorkspace();
    ws = mustAdd(ws, "AVAXUSDT", "t7");
    ws = mustAdd(ws, "LINKUSDT", "t8");
    expect(ws.tabs).toHaveLength(MAX_TABS);
    const r = addTab(ws, perp("SUIUSDT"), "t9");
    expect(r).toEqual({ ok: false, reason: "full" });
  });

  it("标的已存在时不重复添加，直接切过去", () => {
    const ws = defaultWorkspace();
    const r = addTab(ws, perp("ETHUSDT"), "dup");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.tabs).toHaveLength(6);
    expect(activeTabId(r.data)).toBe(ws.tabs[1]!.id);
  });

  it("满 8 个时切到已有标的仍然可以", () => {
    let ws = defaultWorkspace();
    ws = mustAdd(ws, "AVAXUSDT", "t7");
    ws = mustAdd(ws, "LINKUSDT", "t8");
    expect(addTab(ws, spot("BTCUSDT"), "x").ok).toBe(true);
  });

  it("同名的现货和合约算两个不同的标的", () => {
    const r = addTab(defaultWorkspace(), perp("BTCUSDT"), "s1");
    expect(r.ok && r.data.tabs).toHaveLength(7);
    expect(addTab(defaultWorkspace(), spot("ETHUSDT"), "s2").ok).toBe(true);
  });
});

describe("closeTab", () => {
  it("关闭当前标签后切到右边相邻的标签", () => {
    const ws = defaultWorkspace();
    const next = closeTab(ws, ws.tabs[0]!.id);
    expect(next.tabs).toHaveLength(5);
    expect(activeTabId(next)).toBe(ws.tabs[1]!.id);
  });

  it("关闭最后一个标签后切到左边相邻的标签", () => {
    let ws = defaultWorkspace();
    const last = ws.tabs[5]!.id;
    ws = activate(ws, last);
    const next = closeTab(ws, last);
    expect(activeTabId(next)).toBe(ws.tabs[4]!.id);
  });

  it("关闭非当前标签不影响当前标签", () => {
    const ws = defaultWorkspace();
    const next = closeTab(ws, ws.tabs[3]!.id);
    expect(activeTabId(next)).toBe(ws.tabs[0]!.id);
  });

  it("只剩一个标签时不能关闭", () => {
    let ws = defaultWorkspace();
    while (ws.tabs.length > 1) ws = closeTab(ws, ws.tabs[0]!.id);
    expect(closeTab(ws, ws.tabs[0]!.id)).toBe(ws);
  });

  it("关闭不存在的标签时状态不变", () => {
    const ws = defaultWorkspace();
    expect(closeTab(ws, "nope")).toBe(ws);
  });

  it("多图布局下关闭一个正在显示的标签后，各面板仍指向存在的标签", () => {
    const ws = setLayout(defaultWorkspace(), 4);
    const next = closeTab(ws, ws.panes[1]!);
    const ids = new Set(next.tabs.map((t) => t.id));
    expect(next.panes).toHaveLength(4);
    expect(next.panes.every((id) => ids.has(id))).toBe(true);
  });
});

describe("布局", () => {
  it("切到四图时四个面板显示不同的标签，当前标签保持聚焦", () => {
    const ws = activate(defaultWorkspace(), "tab_default_2");
    const next = setLayout(ws, 4);
    expect(next.panes).toHaveLength(4);
    expect(new Set(next.panes).size).toBe(4);
    expect(activeTabId(next)).toBe("tab_default_2");
  });

  it("从四图切回单图时保留当前聚焦的标签", () => {
    let ws = setLayout(defaultWorkspace(), 4);
    ws = focusPane(ws, 2);
    const active = activeTabId(ws);
    const next = setLayout(ws, 1);
    expect(next.panes).toEqual([active]);
    expect(next.focused).toBe(0);
  });

  it("点击已经显示在其他面板的标签时只移动聚焦，不产生重复", () => {
    const ws = setLayout(defaultWorkspace(), 2);
    const next = activate(ws, ws.panes[1]!);
    expect(next.focused).toBe(1);
    expect(next.panes).toEqual(ws.panes);
  });

  it("点击没有显示的标签时替换当前聚焦的面板", () => {
    const ws = setLayout(defaultWorkspace(), 2);
    const next = activate(ws, "tab_default_5");
    expect(next.panes[ws.focused]).toBe("tab_default_5");
  });

  it("标签数量少于面板数量时允许重复显示", () => {
    let ws = defaultWorkspace();
    while (ws.tabs.length > 2) ws = closeTab(ws, ws.tabs[ws.tabs.length - 1]!.id);
    const next = setLayout(ws, 4);
    expect(next.panes).toHaveLength(4);
  });

  it("reconcile 会修正越界的聚焦序号和失效的面板", () => {
    const ws = defaultWorkspace();
    const fixed = reconcile({ ...ws, layout: 2, panes: ["ghost", "ghost2"], focused: 9 });
    expect(fixed.panes).toHaveLength(2);
    expect(fixed.focused).toBe(1);
    expect(fixed.panes.every((id) => ws.tabs.some((t) => t.id === id))).toBe(true);
  });
});

describe("updateTab", () => {
  it("修改周期只影响指定标签", () => {
    const ws = defaultWorkspace();
    const next = updateTab(ws, ws.tabs[0]!.id, { timeframe: "1h" });
    expect(next.tabs[0]!.timeframe).toBe("1h");
    expect(next.tabs[1]!.timeframe).toBe("15m");
  });

  it("把标签换成已经打开的标的时切过去而不是产生重复", () => {
    const ws = defaultWorkspace();
    const next = updateTab(ws, ws.tabs[0]!.id, { market: perp("SOLUSDT") });
    expect(next.tabs).toHaveLength(6);
    expect(activeTabId(next)).toBe(ws.tabs[2]!.id);
  });
});

describe("持久化校验", () => {
  it("拒绝超过 8 个标签或标的名非法的记录", () => {
    const tabs = defaultWorkspace().tabs;
    expect(tabsRecordSchema.safeParse({ tabs }).success).toBe(true);
    expect(tabsRecordSchema.safeParse({ tabs: [...tabs, ...tabs] }).success).toBe(false);
    expect(tabsRecordSchema.safeParse({ tabs: [] }).success).toBe(false);
    expect(
      tabsRecordSchema.safeParse({ tabs: [{ ...tabs[0]!, market: { ...tabs[0]!.market, symbol: "btc/usdt" } }] }).success,
    ).toBe(false);
    expect(tabsRecordSchema.safeParse({ tabs: [{ ...tabs[0]!, timeframe: "3m" }] }).success).toBe(false);
  });

  it("接受带分类和不带分类的标的，拒绝未知分类", () => {
    const tabs = defaultWorkspace().tabs;
    const withoutCategory = { ...tabs[1]!, market: { exchange: "binance", market: "perp", symbol: "AVAXUSDT" } };
    expect(tabsRecordSchema.safeParse({ tabs: [withoutCategory] }).success).toBe(true);
    expect(tabsRecordSchema.safeParse({ tabs: [tabs[3]!] }).data?.tabs[0]!.market.category).toBe("stock");
    expect(
      tabsRecordSchema.safeParse({ tabs: [{ ...tabs[3]!, market: { ...tabs[3]!.market, category: "bond" } }] }).success,
    ).toBe(false);
  });
});
