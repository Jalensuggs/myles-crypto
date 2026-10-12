import { create } from "zustand";
import { z } from "zod";
import type { BigTrade } from "@/features/flow/big-trades";
import { addLiquidation, pruneBuckets, type LiquidationBuckets } from "@/features/flow/liquidation-buckets";
import { STORAGE_KEYS, loadStored, saveStored } from "@/lib/storage";
import type { Liquidation } from "@/types/market";

/** 每个标的最多保留这么多笔大单，足够统计最近一小时 */
const MAX_BIG_TRADES = 400;

const flowRecordSchema = z.object({
  liquidations: z.record(z.string(), z.record(z.string(), z.tuple([z.number(), z.number()]))),
});

interface FlowState {
  /** 以 marketKey 为键：页面打开以来识别到的大单 */
  bigTrades: Record<string, BigTrade[]>;
  /** 以合约标的名为键：按分钟累计的爆仓金额 */
  liquidations: Record<string, LiquidationBuckets>;
  addBigTrade: (key: string, trade: BigTrade) => void;
  addLiquidation: (liq: Liquidation) => void;
}

function loadLiquidations(): Record<string, LiquidationBuckets> {
  const stored = loadStored(STORAGE_KEYS.flow, flowRecordSchema, { liquidations: {} }).liquidations;
  const nowSec = Date.now() / 1000;
  const out: Record<string, LiquidationBuckets> = {};
  for (const [symbol, buckets] of Object.entries(stored)) {
    out[symbol] = pruneBuckets(buckets as unknown as LiquidationBuckets, nowSec);
  }
  return out;
}

export const useFlowStore = create<FlowState>((set) => ({
  bigTrades: {},
  liquidations: loadLiquidations(),
  addBigTrade: (key, trade) =>
    set((s) => ({ bigTrades: { ...s.bigTrades, [key]: [...(s.bigTrades[key] ?? []), trade].slice(-MAX_BIG_TRADES) } })),
  addLiquidation: (liq) =>
    set((s) => ({
      liquidations: { ...s.liquidations, [liq.symbol]: addLiquidation(s.liquidations[liq.symbol] ?? {}, liq) },
    })),
}));

let saveTimer: ReturnType<typeof setTimeout> | null = null;
useFlowStore.subscribe((state, prev) => {
  if (state.liquidations === prev.liquidations || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const nowSec = Date.now() / 1000;
    const pruned: Record<string, LiquidationBuckets> = {};
    for (const [symbol, buckets] of Object.entries(useFlowStore.getState().liquidations)) {
      pruned[symbol] = pruneBuckets(buckets, nowSec);
    }
    saveStored(STORAGE_KEYS.flow, { liquidations: pruned });
  }, 5000);
});

const NO_TRADES: BigTrade[] = [];
const NO_BUCKETS: LiquidationBuckets = {};
export const selectBigTrades = (key: string) => (s: FlowState) => s.bigTrades[key] ?? NO_TRADES;
export const selectLiquidations = (symbol: string) => (s: FlowState) => s.liquidations[symbol] ?? NO_BUCKETS;
