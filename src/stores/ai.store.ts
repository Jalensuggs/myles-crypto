import { create } from "zustand";
import { AiError, streamAnalysis } from "@/data/ai/client";
import type { MarketSnapshot } from "@/features/ai/snapshot";
import { parseAnalysis, type Verdict } from "@/features/ai/verdict";
import type { Timeframe } from "@/types/market";

export type AiStatus = "idle" | "waiting" | "streaming" | "done" | "error";

export interface AiResult {
  /** 分析的是哪个标的（marketKey）和周期 */
  key: string;
  name: string;
  timeframe: Timeframe;
  /** 分析时的价格，结论里的价位都以它为基准校验 */
  price: number;
  precision: number;
  model: string;
  /** Unix 毫秒 */
  at: number;
  /** 模型输出的正文（已去掉 JSON） */
  text: string;
  verdict: Verdict | null;
  issues: string[];
}

export type ResultMeta = Omit<AiResult, "text" | "verdict" | "issues">;

interface AiState {
  status: AiStatus;
  /** 正在分析哪个标的 */
  pending: string | null;
  /** 模型在思考，还没开始写 */
  thinking: boolean;
  error: string | null;
  /** 以 marketKey 为键保留每个标的最近一次结果 */
  results: Record<string, AiResult>;
  run: (meta: ResultMeta, snapshot: MarketSnapshot, effort: "low" | "high") => Promise<void>;
  stop: () => void;
  clear: (key: string) => void;
}

let controller: AbortController | null = null;

export const useAiStore = create<AiState>((set, get) => ({
  status: "idle",
  pending: null,
  thinking: false,
  error: null,
  results: {},

  run: async (meta, snapshot, effort) => {
    // 网关同时只能跑很少的对话，所以一次只分析一个
    controller?.abort();
    controller = new AbortController();
    const mine = controller;

    const write = (patch: Partial<AiResult>) =>
      set((s) => {
        const previous = s.results[meta.key];
        const base: AiResult = previous?.at === meta.at ? previous : { ...meta, text: "", verdict: null, issues: [] };
        return { results: { ...s.results, [meta.key]: { ...base, ...patch } } };
      });

    set({ status: "waiting", pending: meta.key, thinking: false, error: null });
    write({ text: "", verdict: null, issues: [] });

    try {
      await streamAnalysis(
        { snapshot, model: meta.model || undefined, effort },
        {
          onText: (raw) => {
            if (mine.signal.aborted) return;
            const parsed = parseAnalysis(raw, meta.price);
            set((s) => (s.status === "waiting" ? { status: "streaming", thinking: false } : {}));
            write({ text: parsed.text, verdict: parsed.verdict, issues: parsed.issues });
          },
          onThinking: () => {
            if (!mine.signal.aborted) set({ thinking: true });
          },
        },
        mine.signal,
      );
      if (mine.signal.aborted) return;
      set({ status: "done", pending: null, thinking: false });
    } catch (error) {
      if (mine.signal.aborted) return;
      const message =
        error instanceof AiError
          ? error.message
          : error instanceof Error && error.name === "AbortError"
            ? "已停止"
            : "分析失败，检查网络后再试";
      set({ status: "error", pending: null, thinking: false, error: message });
    } finally {
      if (controller === mine) controller = null;
    }
  },

  stop: () => {
    controller?.abort();
    controller = null;
    set({ status: get().results[get().pending ?? ""] ? "done" : "idle", pending: null, thinking: false });
  },

  clear: (key) =>
    set((s) => {
      if (!s.results[key]) return {};
      const results = { ...s.results };
      delete results[key];
      return { results, ...(s.pending === key ? { status: "idle" as const, pending: null, error: null } : {}) };
    }),
}));

export const selectResult = (key: string) => (s: AiState) => s.results[key];
