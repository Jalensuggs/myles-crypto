import { describe, expect, it } from "vitest";
import { DEFAULT_DRAWING_COLOR, DRAWING_COLORS, colorOf, isHexColor, type DrawingObject } from "@/types/drawing";
import {
  MAX_HISTORY,
  commit,
  countAll,
  drawingsRecordSchema,
  redo,
  undo,
  withAdded,
  withCleared,
  withRemoved,
  withUpdated,
  type DrawingHistory,
} from "./drawings.logic";

const line = (id: string): DrawingObject => ({
  id,
  type: "horizontal-line",
  points: [{ time: 60, price: 100 }],
  locked: false,
  hidden: false,
});

const empty: DrawingHistory = { byMarket: {}, past: [], future: [] };
const K = "binance:perp:BTCUSDT";

describe("绘图增删改", () => {
  it("按标的分别保存", () => {
    let by = withAdded({}, K, line("a"));
    by = withAdded(by, "binance:perp:ETHUSDT", line("b"));
    expect(by[K]).toHaveLength(1);
    expect(countAll(by)).toBe(2);
  });

  it("修改只影响指定的绘图", () => {
    const by = withAdded(withAdded({}, K, line("a")), K, line("b"));
    const next = withUpdated(by, K, "b", { points: [{ time: 120, price: 200 }] });
    expect(next[K]![0]!.points[0]!.price).toBe(100);
    expect(next[K]![1]!.points[0]!.price).toBe(200);
  });

  it("操作不存在的绘图时返回原对象", () => {
    const by = withAdded({}, K, line("a"));
    expect(withUpdated(by, K, "zzz", { locked: true })).toBe(by);
    expect(withRemoved(by, K, "zzz")).toBe(by);
    expect(withCleared(by, "other")).toBe(by);
  });

  it("删除和清空", () => {
    const by = withAdded(withAdded({}, K, line("a")), K, line("b"));
    expect(withRemoved(by, K, "a")[K]!.map((d) => d.id)).toEqual(["b"]);
    expect(withCleared(by, K)[K]).toEqual([]);
  });
});

describe("撤销与重做", () => {
  it("撤销回到上一步，重做再回来", () => {
    const h1 = commit(empty, withAdded(empty.byMarket, K, line("a")));
    const h2 = commit(h1, withAdded(h1.byMarket, K, line("b")));
    expect(h2.byMarket[K]).toHaveLength(2);

    const u1 = undo(h2);
    expect(u1.byMarket[K]!.map((d) => d.id)).toEqual(["a"]);
    const u2 = undo(u1);
    expect(u2.byMarket[K]).toBeUndefined();
    expect(undo(u2)).toBe(u2);

    const r1 = redo(u2);
    expect(r1.byMarket[K]!.map((d) => d.id)).toEqual(["a"]);
    const r2 = redo(r1);
    expect(r2.byMarket[K]!.map((d) => d.id)).toEqual(["a", "b"]);
    expect(redo(r2)).toBe(r2);
  });

  it("撤销后做了新修改，重做记录被清空", () => {
    const h1 = commit(empty, withAdded({}, K, line("a")));
    const h2 = commit(h1, withAdded(h1.byMarket, K, line("b")));
    const u = undo(h2);
    const h3 = commit(u, withAdded(u.byMarket, K, line("c")));
    expect(h3.future).toEqual([]);
    expect(h3.byMarket[K]!.map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("没有实际变化时不产生撤销记录", () => {
    const h1 = commit(empty, withAdded({}, K, line("a")));
    expect(commit(h1, h1.byMarket)).toBe(h1);
  });

  it("撤销记录有上限", () => {
    let h = empty;
    for (let i = 0; i < MAX_HISTORY + 20; i++) h = commit(h, withAdded(h.byMarket, K, line(`d${i}`)));
    expect(h.past).toHaveLength(MAX_HISTORY);
  });
});

describe("颜色", () => {
  it("没有颜色或颜色不合法时用默认色", () => {
    expect(colorOf(line("a"))).toBe(DEFAULT_DRAWING_COLOR);
    expect(colorOf({ color: "red" })).toBe(DEFAULT_DRAWING_COLOR);
    expect(colorOf({ color: "#2edb83" })).toBe("#2edb83");
  });

  it("只接受 #rrggbb 形式", () => {
    expect(isHexColor("#FF526B")).toBe(true);
    expect(isHexColor("#fff")).toBe(false);
    expect(isHexColor("ff526b")).toBe(false);
    expect(isHexColor("rgb(1,2,3)")).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });

  it("调色板里的颜色都合法且不重复，绿色和红色排在最前", () => {
    expect(DRAWING_COLORS.every((c) => isHexColor(c.value))).toBe(true);
    expect(new Set(DRAWING_COLORS.map((c) => c.value)).size).toBe(DRAWING_COLORS.length);
    expect(DRAWING_COLORS.slice(0, 2).map((c) => c.label)).toEqual(["绿色", "红色"]);
  });

  it("改颜色不影响其他绘图，并且可以撤销", () => {
    const h1 = commit(empty, withAdded(withAdded({}, K, line("a")), K, line("b")));
    const h2 = commit(h1, withUpdated(h1.byMarket, K, "a", { color: "#ff526b" }));
    expect(h2.byMarket[K]!.map((d) => d.color)).toEqual(["#ff526b", undefined]);
    expect(undo(h2).byMarket[K]![0]!.color).toBeUndefined();
  });
});

describe("持久化校验", () => {
  it("带颜色和不带颜色（旧数据）的记录都接受，颜色格式不对的拒绝", () => {
    expect(drawingsRecordSchema.safeParse({ byMarket: { [K]: [{ ...line("a"), color: "#2edb83" }] } }).success).toBe(true);
    expect(drawingsRecordSchema.safeParse({ byMarket: { [K]: [line("a")] } }).success).toBe(true);
    expect(drawingsRecordSchema.safeParse({ byMarket: { [K]: [{ ...line("a"), color: "green" }] } }).success).toBe(false);
  });

  it("接受合法记录，拒绝缺字段或类型未知的记录", () => {
    expect(drawingsRecordSchema.safeParse({ byMarket: { [K]: [line("a")] } }).success).toBe(true);
    expect(drawingsRecordSchema.safeParse({ byMarket: { [K]: [{ ...line("a"), type: "circle" }] } }).success).toBe(false);
    expect(drawingsRecordSchema.safeParse({ byMarket: { [K]: [{ ...line("a"), points: [] }] } }).success).toBe(false);
    expect(
      drawingsRecordSchema.safeParse({ byMarket: { [K]: [{ ...line("a"), points: [{ time: "x", price: 1 }] }] } }).success,
    ).toBe(false);
  });
});
