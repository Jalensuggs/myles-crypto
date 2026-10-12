import { describe, expect, it } from "vitest";
import { z } from "zod";
import { STORAGE_KEYS, clearAllStored, loadStored, saveStored, type KeyValueStore } from "./storage";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const schema = z.object({ count: z.number(), name: z.string() });
const fallback = { count: 0, name: "默认" };

describe("loadStored", () => {
  it("没有记录时返回默认值", () => {
    expect(loadStored("k", schema, fallback, memoryStore())).toBe(fallback);
  });

  it("记录合法时返回记录", () => {
    const store = memoryStore({ k: JSON.stringify({ count: 3, name: "abc" }) });
    expect(loadStored("k", schema, fallback, store)).toEqual({ count: 3, name: "abc" });
  });

  it("JSON 损坏时返回默认值并删掉这条记录", () => {
    const store = memoryStore({ k: "{not json", other: "keep" });
    expect(loadStored("k", schema, fallback, store)).toBe(fallback);
    expect(store.data.has("k")).toBe(false);
    expect(store.data.get("other")).toBe("keep");
  });

  it("结构不符（例如旧版本格式）时只重置这一条", () => {
    const store = memoryStore({ k: JSON.stringify({ count: "three" }), other: JSON.stringify({ count: 1, name: "x" }) });
    expect(loadStored("k", schema, fallback, store)).toBe(fallback);
    expect(store.data.has("k")).toBe(false);
    expect(loadStored("other", schema, fallback, store)).toEqual({ count: 1, name: "x" });
  });

  it("存储不可用或读取抛错时返回默认值", () => {
    expect(loadStored("k", schema, fallback, null)).toBe(fallback);
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(loadStored("k", schema, fallback, broken)).toBe(fallback);
  });
});

describe("saveStored", () => {
  it("写入后可以读回", () => {
    const store = memoryStore();
    saveStored("k", { count: 9, name: "z" }, store);
    expect(loadStored("k", schema, fallback, store)).toEqual({ count: 9, name: "z" });
  });

  it("存储已满时不抛错", () => {
    const full: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(() => saveStored("k", { a: 1 }, full)).not.toThrow();
  });
});

describe("clearAllStored", () => {
  it("只清除本应用的记录", () => {
    const store = memoryStore({ [STORAGE_KEYS.tabs]: "1", [STORAGE_KEYS.drawings]: "2", unrelated: "3" });
    clearAllStored(store);
    expect([...store.data.keys()]).toEqual(["unrelated"]);
  });
});
