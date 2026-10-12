import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  type AreaSeriesPartialOptions,
  type BarSeriesPartialOptions,
  type CandlestickSeriesPartialOptions,
  type ChartOptions,
  type DeepPartial,
  type IChartApi,
  type ISeriesApi,
  type LineSeriesPartialOptions,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import type { TrendColors } from "@/stores/preferences.store";
import type { Candle, ChartType } from "@/types/market";

const TEXT = "#8b929d";
const GRID = "rgba(37, 42, 49, 0.6)";
const BORDER = "#252a31";
const ACCENT = "#4f7cff";

export const FONT_FAMILY =
  '"Inter", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

export function chartOptions(): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "#111316" },
      textColor: TEXT,
      fontFamily: FONT_FAMILY,
      fontSize: 11,
      attributionLogo: true,
    },
    grid: {
      vertLines: { color: GRID },
      horzLines: { color: GRID },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: "#5e6672", style: LineStyle.Dashed, labelBackgroundColor: "#343b45" },
      horzLine: { color: "#5e6672", style: LineStyle.Dashed, labelBackgroundColor: "#343b45" },
    },
    rightPriceScale: {
      borderColor: BORDER,
      scaleMargins: { top: 0.12, bottom: 0.24 },
    },
    timeScale: {
      borderColor: BORDER,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 6,
      barSpacing: 7,
      minBarSpacing: 1,
    },
    localization: { locale: "zh-CN" },
  };
}

export function createMainSeries(
  chart: IChartApi,
  type: ChartType,
  colors: TrendColors,
  precision: number,
): ISeriesApi<SeriesType> {
  const priceFormat = { type: "price" as const, precision, minMove: 1 / 10 ** precision };
  switch (type) {
    case "candles":
      return chart.addSeries(CandlestickSeries, { ...candleColors(colors), priceFormat });
    case "bars":
      return chart.addSeries(BarSeries, { ...barColors(colors), priceFormat });
    case "line":
      return chart.addSeries(LineSeries, { ...lineColors(), priceFormat });
    case "area":
      return chart.addSeries(AreaSeries, { ...areaColors(), priceFormat });
  }
}

function candleColors(c: TrendColors): CandlestickSeriesPartialOptions {
  return {
    upColor: c.up,
    downColor: c.down,
    wickUpColor: c.up,
    wickDownColor: c.down,
    borderVisible: false,
  };
}

function barColors(c: TrendColors): BarSeriesPartialOptions {
  return { upColor: c.up, downColor: c.down, thinBars: false };
}

function lineColors(): LineSeriesPartialOptions {
  return { color: ACCENT, lineWidth: 2 };
}

function areaColors(): AreaSeriesPartialOptions {
  return {
    lineColor: ACCENT,
    lineWidth: 2,
    topColor: "rgba(79, 124, 255, 0.32)",
    bottomColor: "rgba(79, 124, 255, 0.02)",
  };
}

export function applySeriesStyle(
  series: ISeriesApi<SeriesType>,
  type: ChartType,
  colors: TrendColors,
  precision: number,
): void {
  const priceFormat = { type: "price" as const, precision, minMove: 1 / 10 ** precision };
  const style =
    type === "candles" ? candleColors(colors) : type === "bars" ? barColors(colors) : type === "line" ? lineColors() : areaColors();
  series.applyOptions({ ...style, priceFormat });
}

/**
 * 图表库按 UTC 显示时间。日内周期统一加上本地时区偏移，让坐标轴显示本地时间；
 * 日线保持 UTC 日期。全部 K 线用同一个偏移量，保证时间严格递增。
 */
export function chartTimeOffset(stepSeconds: number): number {
  return stepSeconds >= 86400 ? 0 : -new Date().getTimezoneOffset() * 60;
}

export function toMainData(candles: readonly Candle[], type: ChartType, offset: number) {
  if (type === "line" || type === "area") {
    return candles.map((c) => ({ time: (c.time + offset) as UTCTimestamp, value: c.close }));
  }
  return candles.map((c) => ({
    time: (c.time + offset) as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

export function toMainPoint(c: Candle, type: ChartType, offset: number) {
  const time = (c.time + offset) as UTCTimestamp;
  if (type === "line" || type === "area") return { time, value: c.close };
  return { time, open: c.open, high: c.high, low: c.low, close: c.close };
}

function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function toVolumePoint(c: Candle, colors: TrendColors, offset: number) {
  return {
    time: (c.time + offset) as UTCTimestamp,
    value: c.volume,
    color: alpha(c.close >= c.open ? colors.up : colors.down, 0.4),
  };
}

export function toVolumeData(candles: readonly Candle[], colors: TrendColors, offset: number) {
  return candles.map((c) => toVolumePoint(c, colors, offset));
}
