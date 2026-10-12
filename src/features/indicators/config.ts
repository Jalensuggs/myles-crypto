/** 技术指标的参数、默认值、配色和用户输入的解析 */

export const DEFAULT_MA_PERIODS = [7, 25, 99];
export const DEFAULT_EMA_PERIODS = [12, 26];
export const DEFAULT_VOL_MA_PERIODS = [5, 10];
export const DEFAULT_BOLL: [number, number] = [20, 2];
export const DEFAULT_MACD: [number, number, number] = [12, 26, 9];
export const DEFAULT_KDJ: [number, number, number] = [9, 3, 3];
export const DEFAULT_RSI_PERIOD = 14;

export const MAX_MA_LINES = 8;
export const MAX_EMA_LINES = 4;
export const MAX_VOL_MA_LINES = 4;
export const MIN_MA_PERIOD = 2;
export const MAX_MA_PERIOD = 500;

export const RSI_OVERBOUGHT = 70;
export const RSI_OVERSOLD = 30;
export const KDJ_OVERBOUGHT = 80;
export const KDJ_OVERSOLD = 20;

/** 按顺序分给各条均线的颜色，前七个与常见股票软件的配色接近 */
export const MA_COLORS = [
  "#ff9f1a",
  "#3fa9ff",
  "#ff5fd2",
  "#7c8cff",
  "#2ecc71",
  "#ff6b5e",
  "#2ee6e6",
  "#c9b037",
] as const;
export const EMA_COLORS = ["#ffd166", "#06d6a0", "#ef476f", "#73a9ff"] as const;
export const VOL_MA_COLORS = ["#f0b90b", "#3fa9ff", "#ff5fd2", "#2ee6e6"] as const;
export const BOLL_COLORS = { upper: "#f0b90b", mid: "#e7eaf0", lower: "#b388ff" } as const;
export const MACD_DIF_COLOR = "#f0b90b";
export const MACD_DEA_COLOR = "#e056fd";
export const KDJ_COLORS = { k: "#f0b90b", d: "#3fa9ff", j: "#ff5fd2" } as const;
export const RSI_COLOR = "#b388ff";

/** 常用的均线组合，设置里可以一键套用 */
export const MA_PRESETS: { label: string; periods: number[] }[] = [
  { label: "股票软件常用", periods: [5, 10, 20, 30, 60, 120, 250] },
  { label: "交易所常用", periods: [7, 25, 99] },
];

/** 图表上实际要画哪些指标。空数组或 null 表示不显示。 */
export interface IndicatorConfig {
  ma: number[];
  ema: number[];
  boll: { period: number; multiplier: number } | null;
  volMa: number[];
  macd: { fast: number; slow: number; signal: number } | null;
  kdj: { period: number; k: number; d: number } | null;
  /** RSI 的周期 */
  rsi: number | null;
}

function tokens(text: string): string[] {
  return text
    .split(/[\s,，、;；]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

interface ListRule {
  min: number;
  max: number;
  maxCount: number;
}

/**
 * 解析一组周期，例如 "7, 25，99" 或 "5 10 20 60"。
 * 结果去重并从小到大排列；输入不合法时返回 null。
 */
export function parsePeriodList(text: string, rule: ListRule): number[] | null {
  const parts = tokens(text);
  if (parts.length === 0) return null;
  const periods = new Set<number>();
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < rule.min || n > rule.max) return null;
    periods.add(n);
  }
  if (periods.size > rule.maxCount) return null;
  return [...periods].sort((a, b) => a - b);
}

export const parseMaPeriods = (text: string) =>
  parsePeriodList(text, { min: MIN_MA_PERIOD, max: MAX_MA_PERIOD, maxCount: MAX_MA_LINES });
export const parseEmaPeriods = (text: string) =>
  parsePeriodList(text, { min: MIN_MA_PERIOD, max: MAX_MA_PERIOD, maxCount: MAX_EMA_LINES });
export const parseVolMaPeriods = (text: string) =>
  parsePeriodList(text, { min: MIN_MA_PERIOD, max: MAX_MA_PERIOD, maxCount: MAX_VOL_MA_LINES });

/** 解析固定个数的整数，顺序保留 */
function parseInts(text: string, count: number, min: number, max: number): number[] | null {
  const parts = tokens(text);
  if (parts.length !== count) return null;
  const out: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < min || n > max) return null;
    out.push(n);
  }
  return out;
}

/** MACD 的三个参数：快线、慢线、信号线。快线必须小于慢线。 */
export function parseMacd(text: string): [number, number, number] | null {
  const v = parseInts(text, 3, 2, 500);
  if (!v || v[0]! >= v[1]!) return null;
  return [v[0]!, v[1]!, v[2]!];
}

/** KDJ 的三个参数：周期、K 的平滑、D 的平滑 */
export function parseKdj(text: string): [number, number, number] | null {
  const v = parseInts(text, 3, 1, 200);
  if (!v || v[0]! < 2) return null;
  return [v[0]!, v[1]!, v[2]!];
}

export function parseRsiPeriod(text: string): number | null {
  const v = parseInts(text, 1, 2, 200);
  return v ? v[0]! : null;
}

/** 布林带的两个参数：周期（整数）和标准差倍数（可以是小数） */
export function parseBoll(text: string): [number, number] | null {
  const parts = tokens(text);
  if (parts.length !== 2) return null;
  if (!/^\d+$/.test(parts[0]!) || !/^\d+(\.\d+)?$/.test(parts[1]!)) return null;
  const period = Number(parts[0]);
  const multiplier = Number(parts[1]);
  if (period < 2 || period > 500 || multiplier < 0.1 || multiplier > 10) return null;
  return [period, multiplier];
}
