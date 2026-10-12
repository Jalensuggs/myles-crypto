import {
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { cumulativeDelta } from "@/features/flow/cvd";
import type { LiquidationSum } from "@/features/flow/liquidation-buckets";
import { boll, ema, kdj, macd, rsi, sma } from "@/features/indicators/calc";
import {
  BOLL_COLORS,
  CVD_COLOR,
  EMA_COLORS,
  KDJ_COLORS,
  KDJ_OVERBOUGHT,
  KDJ_OVERSOLD,
  MACD_DEA_COLOR,
  MACD_DIF_COLOR,
  MA_COLORS,
  OPEN_INTEREST_COLOR,
  RSI_COLOR,
  RSI_OVERBOUGHT,
  RSI_OVERSOLD,
  VOL_MA_COLORS,
  type IndicatorConfig,
} from "@/features/indicators/config";
import type { TrendColors } from "@/stores/preferences.store";
import type { Candle } from "@/types/market";

type AnySeries = ISeriesApi<"Line"> | ISeriesApi<"Histogram">;

/** 指标画在哪里：主图、成交量的刻度上，或各自的副图 */
export type SubPaneId = "macd" | "kdj" | "rsi" | "cvd" | "oi" | "liq";
export const SUB_PANES: SubPaneId[] = ["macd", "kdj", "rsi", "cvd", "oi", "liq"];

/**
 * 不能从 K 线算出来、要另外提供的资金面数据。
 * openInterest：K 线开盘时间 → 持仓量；liquidations：给定一根 K 线的开盘时间，返回这根里的爆仓金额，
 * 那个时候还没有开始记录则返回 null。
 */
export interface FlowSeries {
  openInterest: ReadonlyMap<number, number>;
  liquidations: (candleTime: number) => LiquidationSum | null;
}
type Place = "main" | "volume" | SubPaneId;

interface Spec {
  /** 唯一标识，例如 ma:7、boll:upper、macd:dif */
  key: string;
  place: Place;
  kind: "line" | "histogram";
  label: string;
  color: string;
}

export interface IndicatorItem {
  /** 用于测试定位，例如 ma-7、ema-12 */
  id: string;
  label: string;
  color: string;
  value: number | null;
  /** 不用固定颜色时的着色方式：signed 按数值正负，up、down 固定为涨色、跌色 */
  tone?: "signed" | "up" | "down";
}

export interface IndicatorPaneValues {
  id: SubPaneId;
  title: string;
  /** 数值怎么显示：price 按小数位数，compact 用万、亿缩写，usd 再加上美元符号 */
  format: "price" | "compact" | "usd";
  /** format 为 price 时显示几位小数 */
  digits: number;
  items: IndicatorItem[];
}

/** 某一根 K 线上各指标的数值，用于图例显示 */
export interface IndicatorValues {
  main: IndicatorItem[];
  volume: IndicatorItem[];
  panes: IndicatorPaneValues[];
}

const MAIN_PANE_STRETCH = 3;
const EMPTY_CONFIG: IndicatorConfig = {
  ma: [],
  ema: [],
  boll: null,
  volMa: [],
  macd: null,
  kdj: null,
  rsi: null,
  cvd: false,
  openInterest: false,
  liquidations: false,
};

function priceFormat(precision: number) {
  return { type: "price" as const, precision, minMove: 1 / 10 ** precision };
}

function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const pick = <T>(colors: readonly T[], i: number): T => colors[i % colors.length]!;

/** 配置对应要画哪些线。顺序决定了创建顺序：副图里柱子先于线，这样线压在柱子上面。 */
function specsOf(config: IndicatorConfig): Spec[] {
  const specs: Spec[] = [];
  config.ma.forEach((p, i) =>
    specs.push({ key: `ma:${p}`, place: "main", kind: "line", label: `MA${p}`, color: pick(MA_COLORS, i) }),
  );
  config.ema.forEach((p, i) =>
    specs.push({ key: `ema:${p}`, place: "main", kind: "line", label: `EMA${p}`, color: pick(EMA_COLORS, i) }),
  );
  if (config.boll) {
    specs.push({ key: "boll:upper", place: "main", kind: "line", label: "上轨", color: BOLL_COLORS.upper });
    specs.push({ key: "boll:mid", place: "main", kind: "line", label: "中轨", color: BOLL_COLORS.mid });
    specs.push({ key: "boll:lower", place: "main", kind: "line", label: "下轨", color: BOLL_COLORS.lower });
  }
  config.volMa.forEach((p, i) =>
    specs.push({ key: `volma:${p}`, place: "volume", kind: "line", label: `量MA${p}`, color: pick(VOL_MA_COLORS, i) }),
  );
  if (config.macd) {
    specs.push({ key: "macd:hist", place: "macd", kind: "histogram", label: "MACD", color: "#8b929d" });
    specs.push({ key: "macd:dif", place: "macd", kind: "line", label: "DIF", color: MACD_DIF_COLOR });
    specs.push({ key: "macd:dea", place: "macd", kind: "line", label: "DEA", color: MACD_DEA_COLOR });
  }
  if (config.kdj) {
    specs.push({ key: "kdj:k", place: "kdj", kind: "line", label: "K", color: KDJ_COLORS.k });
    specs.push({ key: "kdj:d", place: "kdj", kind: "line", label: "D", color: KDJ_COLORS.d });
    specs.push({ key: "kdj:j", place: "kdj", kind: "line", label: "J", color: KDJ_COLORS.j });
  }
  if (config.rsi !== null) {
    specs.push({ key: "rsi", place: "rsi", kind: "line", label: "RSI", color: RSI_COLOR });
  }
  if (config.cvd) specs.push({ key: "cvd", place: "cvd", kind: "line", label: "CVD", color: CVD_COLOR });
  if (config.openInterest) {
    specs.push({ key: "oi", place: "oi", kind: "line", label: "持仓量", color: OPEN_INTEREST_COLOR });
  }
  if (config.liquidations) {
    // 多单爆仓画在零线下方，空单爆仓画在上方
    specs.push({ key: "liq:long", place: "liq", kind: "histogram", label: "多单", color: "#8b929d" });
    specs.push({ key: "liq:short", place: "liq", kind: "histogram", label: "空单", color: "#8b929d" });
  }
  return specs;
}

/**
 * 管理一张图表上的技术指标：均线、EMA、布林带叠加在主图上，成交量均线画在成交量上，
 * MACD、KDJ、RSI 各占一个副图。只负责序列的创建、销毁和数据写入，
 * 计算本身在 features/indicators/calc.ts。
 */
export class IndicatorLayer {
  private config: IndicatorConfig = EMPTY_CONFIG;
  private specs: Spec[] = [];
  private colors: TrendColors = { up: "#2edb83", down: "#ff526b" };
  private precision = 2;
  private readonly series = new Map<string, AnySeries>();
  private data = new Map<string, (number | null)[]>();
  private flow: FlowSeries | null = null;

  constructor(private readonly chart: IChartApi) {}

  /** 按配置增删序列。调用后需要再调用 setData 填入数据。 */
  configure(config: IndicatorConfig, colors: TrendColors, precision: number): void {
    this.colors = colors;
    this.precision = precision;
    const specs = specsOf(config);
    const wanted = new Set(specs.map((s) => s.key));

    for (const [key, series] of [...this.series]) {
      if (wanted.has(key)) continue;
      // 先从表里删掉再移除：移除过程中图表会触发重绘回调，那时不能再访问正在移除的序列
      this.series.delete(key);
      this.chart.removeSeries(series);
    }

    for (const spec of specs) {
      const existing = this.series.get(spec.key);
      if (existing) {
        existing.applyOptions({ color: spec.color, priceFormat: this.formatOf(spec.place) });
        continue;
      }
      this.series.set(spec.key, this.create(spec));
    }

    this.config = config;
    this.specs = specs;
    this.balancePanes();
  }

  /** 提供持仓量和爆仓数据。调用后需要再调用 setData 才会画出来。 */
  setFlow(flow: FlowSeries | null): void {
    this.flow = flow;
  }

  /** 重新计算并写入全部数据 */
  setData(candles: readonly Candle[], offset: number): void {
    this.compute(candles);
    for (const spec of this.specs) {
      const series = this.series.get(spec.key);
      const values = this.data.get(spec.key);
      if (!series || !values) continue;
      const points: { time: UTCTimestamp; value: number; color?: string }[] = [];
      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (value === null || value === undefined) continue;
        points.push(this.point(spec, (candles[i]!.time + offset) as UTCTimestamp, value));
      }
      series.setData(points);
    }
  }

  /** 实时更新：重新计算后只把最后 count 根 K 线对应的点写进图表 */
  updateTail(candles: readonly Candle[], offset: number, count: number): void {
    if (this.series.size === 0 || candles.length === 0) return;
    this.compute(candles);
    const from = Math.max(0, candles.length - Math.max(1, count));
    for (let i = from; i < candles.length; i++) {
      const time = (candles[i]!.time + offset) as UTCTimestamp;
      for (const spec of this.specs) {
        const value = this.data.get(spec.key)?.[i];
        if (value === null || value === undefined) continue;
        this.series.get(spec.key)?.update(this.point(spec, time, value));
      }
    }
  }

  valuesAt(index: number): IndicatorValues {
    const item = (spec: Spec): IndicatorItem => {
      const value = this.data.get(spec.key)?.[index] ?? null;
      const base = { id: spec.key.replace(":", "-"), label: spec.label, color: spec.color };
      if (spec.key === "macd:hist") return { ...base, value, tone: "signed" };
      // 爆仓金额显示绝对值，颜色表示是哪一边被爆
      if (spec.key === "liq:long") return { ...base, value: value === null ? null : Math.abs(value), tone: "down" };
      if (spec.key === "liq:short") return { ...base, value, tone: "up" };
      return { ...base, value };
    };
    const at = (place: Place) => this.specs.filter((s) => s.place === place).map(item);
    const panes: IndicatorPaneValues[] = [];
    const { macd: m, kdj: k, rsi: r, cvd, openInterest, liquidations } = this.config;
    if (m) {
      // 柱子放在最后显示，和常见软件的顺序一致：DIF、DEA、MACD
      const items = at("macd");
      panes.push({
        id: "macd",
        title: `MACD(${m.fast},${m.slow},${m.signal})`,
        format: "price",
        digits: Math.min(8, this.precision + 1),
        items: [...items.slice(1), items[0]!],
      });
    }
    if (k) panes.push({ id: "kdj", title: `KDJ(${k.period},${k.k},${k.d})`, format: "price", digits: 2, items: at("kdj") });
    if (r !== null) panes.push({ id: "rsi", title: `RSI(${r})`, format: "price", digits: 2, items: at("rsi") });
    if (cvd) panes.push({ id: "cvd", title: "CVD 主动买卖累计差", format: "compact", digits: 2, items: at("cvd") });
    if (openInterest) panes.push({ id: "oi", title: "持仓量", format: "compact", digits: 2, items: at("oi") });
    if (liquidations) panes.push({ id: "liq", title: "爆仓", format: "usd", digits: 1, items: at("liq") });
    return { main: at("main"), volume: at("volume"), panes };
  }

  /** 副图在页面里对应的元素，用来给副图的文字标签定位 */
  paneElement(id: SubPaneId): HTMLElement | null {
    const spec = this.specs.find((s) => s.place === id);
    const series = spec ? this.series.get(spec.key) : undefined;
    if (!series) return null;
    try {
      return series.getPane().getHTMLElement();
    } catch {
      // 序列刚创建或正在移除、还没有归属的副图
      return null;
    }
  }

  private formatOf(place: Place) {
    // 成交量和资金面的数值很大，用带单位的缩写
    if (place === "volume" || place === "cvd" || place === "oi" || place === "liq") return { type: "volume" as const };
    if (place === "main") return priceFormat(this.precision);
    // 小数位比价格多一位，低价币的 MACD 数值很小
    if (place === "macd") return priceFormat(Math.min(8, this.precision + 1));
    return priceFormat(2);
  }

  /** 副图已经存在就加进去，否则在最下面新开一个 */
  private paneIndexOf(place: Place): number {
    if (place === "main" || place === "volume") return 0;
    for (const [key, series] of this.series) {
      if (key.startsWith(`${place}:`) || key === place) return series.getPane().paneIndex();
    }
    return this.chart.panes().length;
  }

  private create(spec: Spec): AnySeries {
    const pane = this.paneIndexOf(spec.place);
    const common = {
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: this.formatOf(spec.place),
      ...(spec.place === "volume" ? { priceScaleId: "volume" } : {}),
    };
    if (spec.kind === "histogram") return this.chart.addSeries(HistogramSeries, common, pane);

    const line = this.chart.addSeries(
      LineSeries,
      {
        ...common,
        color: spec.color,
        lineWidth: 1,
        crosshairMarkerVisible: false,
        // RSI 的纵轴固定为 0 到 100，方便对照超买超卖线
        ...(spec.place === "rsi" ? { autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) } : {}),
      },
      pane,
    );
    const guides = spec.key === "rsi" ? [RSI_OVERBOUGHT, RSI_OVERSOLD] : spec.key === "kdj:k" ? [KDJ_OVERBOUGHT, KDJ_OVERSOLD] : [];
    for (const price of guides) {
      line.createPriceLine({
        price,
        color: "#5e6672",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "",
      });
    }
    return line;
  }

  private point(spec: Spec, time: UTCTimestamp, value: number) {
    if (spec.kind !== "histogram") return { time, value };
    // 多单爆仓是被迫卖出，用跌色；空单爆仓是被迫买入，用涨色；MACD 的柱子按正负
    const up = spec.key === "liq:long" ? false : spec.key === "liq:short" ? true : value >= 0;
    return { time, value, color: alpha(up ? this.colors.up : this.colors.down, 0.7) };
  }

  private compute(candles: readonly Candle[]): void {
    const { ma, ema: emaPeriods, boll: b, volMa, macd: m, kdj: k, rsi: r } = this.config;
    const closes = candles.map((c) => c.close);
    const data = new Map<string, (number | null)[]>();
    for (const p of ma) data.set(`ma:${p}`, sma(closes, p));
    for (const p of emaPeriods) data.set(`ema:${p}`, ema(closes, p));
    if (b) {
      const bands = boll(closes, b.period, b.multiplier);
      data.set("boll:upper", bands.map((x) => x.upper));
      data.set("boll:mid", bands.map((x) => x.mid));
      data.set("boll:lower", bands.map((x) => x.lower));
    }
    if (volMa.length > 0) {
      const volumes = candles.map((c) => c.volume);
      for (const p of volMa) data.set(`volma:${p}`, sma(volumes, p));
    }
    if (m) {
      const points = macd(closes, m.fast, m.slow, m.signal);
      data.set("macd:hist", points.map((x) => x.hist));
      data.set("macd:dif", points.map((x) => x.dif));
      data.set("macd:dea", points.map((x) => x.dea));
    }
    if (k) {
      const points = kdj(candles, k.period, k.k, k.d);
      data.set("kdj:k", points.map((x) => x.k));
      data.set("kdj:d", points.map((x) => x.d));
      data.set("kdj:j", points.map((x) => x.j));
    }
    if (r !== null) data.set("rsi", rsi(closes, r));

    const flow = this.flow;
    if (this.config.cvd) data.set("cvd", cumulativeDelta(candles));
    if (this.config.openInterest) {
      data.set("oi", candles.map((c) => flow?.openInterest.get(c.time) ?? null));
    }
    if (this.config.liquidations) {
      const sums = candles.map((c) => flow?.liquidations(c.time) ?? null);
      // 没有爆仓的 K 线不画柱子
      data.set("liq:long", sums.map((x) => (x && x.long > 0 ? -x.long : null)));
      data.set("liq:short", sums.map((x) => (x && x.short > 0 ? x.short : null)));
    }
    this.data = data;
  }

  /** 有副图时让主图占更大的比例 */
  private balancePanes(): void {
    const panes = this.chart.panes();
    panes.forEach((pane, i) => pane.setStretchFactor(i === 0 && panes.length > 1 ? MAIN_PANE_STRETCH : 1));
  }
}
