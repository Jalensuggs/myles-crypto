export const DEFAULT_MA_PERIODS = [7, 25, 99];
export const MAX_MA_LINES = 8;
export const MIN_MA_PERIOD = 2;
export const MAX_MA_PERIOD = 500;

export const MACD_PARAMS = { fast: 12, slow: 26, signal: 9 } as const;
export const RSI_PERIOD = 14;
export const RSI_OVERBOUGHT = 70;
export const RSI_OVERSOLD = 30;

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

/** 常用的均线组合，设置里可以一键套用 */
export const MA_PRESETS: { label: string; periods: number[] }[] = [
  { label: "股票软件常用", periods: [5, 10, 20, 30, 60, 120, 250] },
  { label: "交易所常用", periods: [7, 25, 99] },
];
export const MACD_DIF_COLOR = "#f0b90b";
export const MACD_DEA_COLOR = "#e056fd";
export const RSI_COLOR = "#b388ff";

export interface IndicatorConfig {
  /** 要画的均线周期，空数组表示不显示均线 */
  ma: number[];
  macd: boolean;
  rsi: boolean;
}

/**
 * 解析用户输入的均线周期，例如 "7, 25，99" 或 "5 10 20 60"。
 * 结果去重并从小到大排列；输入不合法时返回 null。
 */
export function parseMaPeriods(text: string): number[] | null {
  const parts = text
    .split(/[\s,，、;；]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const periods = new Set<number>();
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < MIN_MA_PERIOD || n > MAX_MA_PERIOD) return null;
    periods.add(n);
  }
  if (periods.size > MAX_MA_LINES) return null;
  return [...periods].sort((a, b) => a - b);
}
