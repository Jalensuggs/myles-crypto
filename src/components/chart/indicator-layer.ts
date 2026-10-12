import {
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { macd, rsi, sma, type MacdPoint } from "@/features/indicators/calc";
import {
  MACD_DEA_COLOR,
  MACD_DIF_COLOR,
  MACD_PARAMS,
  MA_COLORS,
  RSI_COLOR,
  RSI_OVERBOUGHT,
  RSI_OVERSOLD,
  RSI_PERIOD,
  type IndicatorConfig,
} from "@/features/indicators/config";
import type { TrendColors } from "@/stores/preferences.store";
import type { Candle } from "@/types/market";

type Line = ISeriesApi<"Line">;

/** 某一根 K 线上各指标的数值，用于图例显示。没开启的指标对应字段为 undefined。 */
export interface IndicatorValues {
  ma: { period: number; color: string; value: number | null }[];
  macd?: MacdPoint;
  rsi?: number | null;
}

const MAIN_PANE_STRETCH = 3;

function priceFormat(precision: number) {
  return { type: "price" as const, precision, minMove: 1 / 10 ** precision };
}

function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * 管理一张图表上的技术指标：均线叠加在主图上，MACD 和 RSI 各占一个副图。
 * 只负责序列的创建、销毁和数据写入，计算本身在 features/indicators/calc.ts。
 */
export class IndicatorLayer {
  private config: IndicatorConfig = { ma: [], macd: false, rsi: false };
  private colors: TrendColors = { up: "#2edb83", down: "#ff526b" };

  private readonly maLines = new Map<number, Line>();
  private macdSeries: { hist: ISeriesApi<"Histogram">; dif: Line; dea: Line } | null = null;
  private rsiLine: Line | null = null;

  private maData = new Map<number, (number | null)[]>();
  private macdData: MacdPoint[] = [];
  private rsiData: (number | null)[] = [];

  constructor(private readonly chart: IChartApi) {}

  /** 按配置增删序列。调用后需要再调用 setData 填入数据。 */
  configure(config: IndicatorConfig, colors: TrendColors, precision: number): void {
    this.colors = colors;
    const format = priceFormat(precision);

    for (const [period, line] of [...this.maLines]) {
      if (!config.ma.includes(period)) {
        this.maLines.delete(period);
        this.chart.removeSeries(line);
      }
    }
    config.ma.forEach((period, i) => {
      const color = MA_COLORS[i % MA_COLORS.length]!;
      const existing = this.maLines.get(period);
      if (existing) {
        existing.applyOptions({ color, priceFormat: format });
        return;
      }
      this.maLines.set(
        period,
        this.chart.addSeries(
          LineSeries,
          {
            color,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            priceFormat: format,
          },
          0,
        ),
      );
    });

    // 小数位比价格多一位，低价币的 MACD 数值很小
    const macdFormat = priceFormat(Math.min(8, precision + 1));
    if (config.macd && !this.macdSeries) {
      const pane = this.chart.panes().length;
      const common = { priceLineVisible: false, lastValueVisible: false, priceFormat: macdFormat };
      const hist = this.chart.addSeries(HistogramSeries, common, pane);
      const lineOptions = { ...common, lineWidth: 1 as const, crosshairMarkerVisible: false };
      this.macdSeries = {
        hist,
        dif: this.chart.addSeries(LineSeries, { ...lineOptions, color: MACD_DIF_COLOR }, pane),
        dea: this.chart.addSeries(LineSeries, { ...lineOptions, color: MACD_DEA_COLOR }, pane),
      };
    } else if (!config.macd && this.macdSeries) {
      // 先清掉引用再移除：移除过程中图表会触发重绘回调，那时不能再访问正在移除的序列
      const removing = Object.values(this.macdSeries);
      this.macdSeries = null;
      for (const series of removing) this.chart.removeSeries(series);
    } else if (this.macdSeries) {
      for (const series of Object.values(this.macdSeries)) series.applyOptions({ priceFormat: macdFormat });
    }

    if (config.rsi && !this.rsiLine) {
      const line = this.chart.addSeries(
        LineSeries,
        {
          color: RSI_COLOR,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          priceFormat: priceFormat(1),
          // 纵轴固定为 0 到 100，方便对照超买超卖线
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
        },
        this.chart.panes().length,
      );
      for (const price of [RSI_OVERBOUGHT, RSI_OVERSOLD]) {
        line.createPriceLine({
          price,
          color: "#5e6672",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "",
        });
      }
      this.rsiLine = line;
    } else if (!config.rsi && this.rsiLine) {
      const removing = this.rsiLine;
      this.rsiLine = null;
      this.chart.removeSeries(removing);
    }

    this.config = { ma: [...config.ma], macd: config.macd, rsi: config.rsi };
    this.balancePanes();
  }

  /** 重新计算并写入全部数据 */
  setData(candles: readonly Candle[], offset: number): void {
    this.compute(candles);
    const time = (i: number) => (candles[i]!.time + offset) as UTCTimestamp;

    for (const [period, line] of this.maLines) {
      const values = this.maData.get(period) ?? [];
      const data: { time: UTCTimestamp; value: number }[] = [];
      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (value !== null && value !== undefined) data.push({ time: time(i), value });
      }
      line.setData(data);
    }

    if (this.macdSeries) {
      const hist: { time: UTCTimestamp; value: number; color: string }[] = [];
      const dif: { time: UTCTimestamp; value: number }[] = [];
      const dea: { time: UTCTimestamp; value: number }[] = [];
      for (let i = 0; i < this.macdData.length; i++) {
        const p = this.macdData[i]!;
        if (p.dif !== null) dif.push({ time: time(i), value: p.dif });
        if (p.dea !== null) dea.push({ time: time(i), value: p.dea });
        if (p.hist !== null) hist.push({ time: time(i), value: p.hist, color: this.histColor(p.hist) });
      }
      this.macdSeries.hist.setData(hist);
      this.macdSeries.dif.setData(dif);
      this.macdSeries.dea.setData(dea);
    }

    if (this.rsiLine) {
      const data: { time: UTCTimestamp; value: number }[] = [];
      for (let i = 0; i < this.rsiData.length; i++) {
        const value = this.rsiData[i];
        if (value !== null && value !== undefined) data.push({ time: time(i), value });
      }
      this.rsiLine.setData(data);
    }
  }

  /** 实时更新：重新计算后只把最后 count 根 K 线对应的点写进图表 */
  updateTail(candles: readonly Candle[], offset: number, count: number): void {
    if (!this.hasAny() || candles.length === 0) return;
    this.compute(candles);
    const from = Math.max(0, candles.length - Math.max(1, count));
    for (let i = from; i < candles.length; i++) {
      const time = (candles[i]!.time + offset) as UTCTimestamp;
      for (const [period, line] of this.maLines) {
        const value = this.maData.get(period)?.[i];
        if (value !== null && value !== undefined) line.update({ time, value });
      }
      if (this.macdSeries) {
        const p = this.macdData[i];
        if (p && p.dif !== null) this.macdSeries.dif.update({ time, value: p.dif });
        if (p && p.dea !== null) this.macdSeries.dea.update({ time, value: p.dea });
        if (p && p.hist !== null) this.macdSeries.hist.update({ time, value: p.hist, color: this.histColor(p.hist) });
      }
      if (this.rsiLine) {
        const value = this.rsiData[i];
        if (value !== null && value !== undefined) this.rsiLine.update({ time, value });
      }
    }
  }

  valuesAt(index: number): IndicatorValues {
    return {
      ma: this.config.ma.map((period, i) => ({
        period,
        color: MA_COLORS[i % MA_COLORS.length]!,
        value: this.maData.get(period)?.[index] ?? null,
      })),
      macd: this.config.macd ? (this.macdData[index] ?? { dif: null, dea: null, hist: null }) : undefined,
      rsi: this.config.rsi ? (this.rsiData[index] ?? null) : undefined,
    };
  }

  /** 副图在页面里对应的元素，用来给副图的文字标签定位 */
  paneElement(kind: "macd" | "rsi"): HTMLElement | null {
    const series = kind === "macd" ? this.macdSeries?.dif : this.rsiLine;
    if (!series) return null;
    try {
      return series.getPane().getHTMLElement();
    } catch {
      // 序列刚创建或正在移除、还没有归属的副图
      return null;
    }
  }

  private hasAny(): boolean {
    return this.maLines.size > 0 || this.macdSeries !== null || this.rsiLine !== null;
  }

  private compute(candles: readonly Candle[]): void {
    const closes = candles.map((c) => c.close);
    this.maData = new Map(this.config.ma.map((period) => [period, sma(closes, period)]));
    this.macdData = this.config.macd ? macd(closes, MACD_PARAMS.fast, MACD_PARAMS.slow, MACD_PARAMS.signal) : [];
    this.rsiData = this.config.rsi ? rsi(closes, RSI_PERIOD) : [];
  }

  private histColor(value: number): string {
    return alpha(value >= 0 ? this.colors.up : this.colors.down, 0.7);
  }

  /** 有副图时让主图占更大的比例 */
  private balancePanes(): void {
    const panes = this.chart.panes();
    panes.forEach((pane, i) => pane.setStretchFactor(i === 0 && panes.length > 1 ? MAIN_PANE_STRETCH : 1));
  }
}
