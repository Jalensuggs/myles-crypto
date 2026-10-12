import type { ZodType } from "zod";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * 读取一条本地记录并校验。解析或校验失败时只丢弃这一条，返回 fallback。
 */
export function loadStored<T>(
  key: string,
  schema: ZodType<T>,
  fallback: T,
  store: KeyValueStore | null = defaultStore(),
): T {
  if (!store) return fallback;
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // 记录损坏，按未保存处理
  }
  try {
    store.removeItem(key);
  } catch {
    // 忽略
  }
  return fallback;
}

export function saveStored(
  key: string,
  value: unknown,
  store: KeyValueStore | null = defaultStore(),
): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // 存储已满或被禁用时不影响使用
  }
}

export const STORAGE_KEYS = {
  tabs: "mc.tabs.v1",
  layout: "mc.layout.v1",
  preferences: "mc.preferences.v1",
  drawings: "mc.drawings.v1",
  feed: "mc.feed.v1",
  watchlist: "mc.watchlist.v1",
} as const;

export function clearAllStored(store: KeyValueStore | null = defaultStore()): void {
  if (!store) return;
  for (const key of Object.values(STORAGE_KEYS)) {
    try {
      store.removeItem(key);
    } catch {
      // 忽略
    }
  }
}
