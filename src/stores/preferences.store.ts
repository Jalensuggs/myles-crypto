import { create } from "zustand";
import { z } from "zod";
import { DEFAULT_MA_PERIODS, MAX_MA_LINES, MAX_MA_PERIOD, MIN_MA_PERIOD } from "@/features/indicators/config";
import { STORAGE_KEYS, loadStored, saveStored } from "@/lib/storage";
import { DEFAULT_DRAWING_COLOR } from "@/types/drawing";

export const preferencesSchema = z.object({
  /** green：绿涨红跌；red：红涨绿跌 */
  upColor: z.enum(["green", "red"]),
  /** 爆仓事件的最小名义价值（美元） */
  liquidationMinUsd: z.number().min(1000).max(1e9),
  /** 5 分钟涨跌幅阈值（百分比） */
  moveThresholdPct: z.number().min(0.1).max(50),
  rightDockOpen: z.boolean(),
  /** 右侧栏下半部分显示哪一页。旧记录里没有这一项时取默认值。 */
  dockTab: z.enum(["watchlist", "feed"]).default("watchlist"),
  /** 技术指标开关，对所有图表生效 */
  indicatorMa: z.boolean().default(true),
  indicatorMacd: z.boolean().default(false),
  indicatorRsi: z.boolean().default(false),
  /** 新画的线用什么颜色 */
  drawingColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default(DEFAULT_DRAWING_COLOR),
  /** 美股图表只显示常规交易时段的 K 线 */
  stockSessionOnly: z.boolean().default(true),
  /** 均线周期，最多 4 条 */
  maPeriods: z
    .array(z.number().int().min(MIN_MA_PERIOD).max(MAX_MA_PERIOD))
    .min(1)
    .max(MAX_MA_LINES)
    .default(DEFAULT_MA_PERIODS),
});

export type Preferences = z.infer<typeof preferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = {
  upColor: "green",
  liquidationMinUsd: 20_000,
  moveThresholdPct: 0.8,
  rightDockOpen: true,
  dockTab: "watchlist",
  indicatorMa: true,
  indicatorMacd: false,
  indicatorRsi: false,
  drawingColor: DEFAULT_DRAWING_COLOR,
  stockSessionOnly: true,
  maPeriods: DEFAULT_MA_PERIODS,
};

interface PreferencesState extends Preferences {
  update: (patch: Partial<Preferences>) => void;
  reset: () => void;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  ...loadStored(STORAGE_KEYS.preferences, preferencesSchema, DEFAULT_PREFERENCES),
  update: (patch) => set(patch),
  reset: () => set(DEFAULT_PREFERENCES),
}));

usePreferencesStore.subscribe((s) => {
  saveStored(STORAGE_KEYS.preferences, {
    upColor: s.upColor,
    liquidationMinUsd: s.liquidationMinUsd,
    moveThresholdPct: s.moveThresholdPct,
    rightDockOpen: s.rightDockOpen,
    dockTab: s.dockTab,
    indicatorMa: s.indicatorMa,
    indicatorMacd: s.indicatorMacd,
    indicatorRsi: s.indicatorRsi,
    drawingColor: s.drawingColor,
    stockSessionOnly: s.stockSessionOnly,
    maPeriods: s.maPeriods,
  } satisfies Preferences);
});

export interface TrendColors {
  up: string;
  down: string;
}

const GREEN = "#2edb83";
const RED = "#ff526b";

export function trendColors(upColor: Preferences["upColor"]): TrendColors {
  return upColor === "green" ? { up: GREEN, down: RED } : { up: RED, down: GREEN };
}
