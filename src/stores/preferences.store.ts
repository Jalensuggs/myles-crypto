import { create } from "zustand";
import { z } from "zod";
import {
  DEFAULT_BOLL,
  DEFAULT_EMA_PERIODS,
  DEFAULT_KDJ,
  DEFAULT_MACD,
  DEFAULT_MA_PERIODS,
  DEFAULT_RSI_PERIOD,
  DEFAULT_VOL_MA_PERIODS,
  MAX_EMA_LINES,
  MAX_MA_LINES,
  MAX_MA_PERIOD,
  MAX_VOL_MA_LINES,
  MIN_MA_PERIOD,
} from "@/features/indicators/config";
import { STORAGE_KEYS, loadStored, saveStored } from "@/lib/storage";
import { DEFAULT_DRAWING_COLOR } from "@/types/drawing";

const period = (max: number) => z.number().int().min(2).max(max);
const periodList = (maxCount: number) =>
  z.array(z.number().int().min(MIN_MA_PERIOD).max(MAX_MA_PERIOD)).min(1).max(maxCount);

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
  // 以下几个指标默认不开
  indicatorEma: z.boolean().default(false),
  indicatorBoll: z.boolean().default(false),
  indicatorVolMa: z.boolean().default(false),
  indicatorKdj: z.boolean().default(false),
  emaPeriods: periodList(MAX_EMA_LINES).default(DEFAULT_EMA_PERIODS),
  volMaPeriods: periodList(MAX_VOL_MA_LINES).default(DEFAULT_VOL_MA_PERIODS),
  /** 布林带：[周期, 标准差倍数] */
  bollParams: z.tuple([z.number().int().min(2).max(500), z.number().min(0.1).max(10)]).default(DEFAULT_BOLL),
  /** MACD：[快线, 慢线, 信号线] */
  macdParams: z.tuple([period(500), period(500), period(500)]).default(DEFAULT_MACD),
  /** KDJ：[周期, K 的平滑, D 的平滑] */
  kdjParams: z
    .tuple([period(200), z.number().int().min(1).max(200), z.number().int().min(1).max(200)])
    .default(DEFAULT_KDJ),
  rsiPeriod: period(200).default(DEFAULT_RSI_PERIOD),
  /** 新画的线用什么颜色 */
  drawingColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default(DEFAULT_DRAWING_COLOR),
  /** 新画的线的粗细和虚实 */
  drawingWidth: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  drawingDash: z.boolean().default(false),
  /** 美股图表只显示常规交易时段的 K 线 */
  stockSessionOnly: z.boolean().default(true),
  /** 均线周期，最多 4 条 */
  maPeriods: periodList(MAX_MA_LINES).default(DEFAULT_MA_PERIODS),
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
  indicatorEma: false,
  indicatorBoll: false,
  indicatorVolMa: false,
  indicatorKdj: false,
  emaPeriods: DEFAULT_EMA_PERIODS,
  volMaPeriods: DEFAULT_VOL_MA_PERIODS,
  bollParams: DEFAULT_BOLL,
  macdParams: DEFAULT_MACD,
  kdjParams: DEFAULT_KDJ,
  rsiPeriod: DEFAULT_RSI_PERIOD,
  drawingColor: DEFAULT_DRAWING_COLOR,
  drawingWidth: 1,
  drawingDash: false,
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

const PREFERENCE_KEYS = Object.keys(DEFAULT_PREFERENCES) as (keyof Preferences)[];

usePreferencesStore.subscribe((s) => {
  // 只保存偏好本身，不保存 store 上的方法
  saveStored(STORAGE_KEYS.preferences, Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, s[key]])));
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
