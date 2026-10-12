import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";
import type { Candle } from "@/types/market";

export type OverlayPainter = (ctx: CanvasRenderingContext2D, pixelRatio: number) => void;

/**
 * 图表面板暴露给绘图层的最小接口。绘图层只通过它读取坐标换算所需的信息，
 * 不直接接触图表的数据加载逻辑。
 */
export interface ChartBridge {
  chart: IChartApi;
  series: () => ISeriesApi<SeriesType> | null;
  candles: () => readonly Candle[];
  stepSeconds: () => number;
  /** 视口发生任何变化（平移、缩放、价格轴变化、数据更新）时回调 */
  onViewChange: (listener: () => void) => () => void;
  /** 登记一个把绘图画到截图上的函数 */
  setOverlayPainter: (painter: OverlayPainter | null) => void;
}

/** 以面板序号登记的截图函数，供控制栏调用 */
export const screenshotRegistry = new Map<number, () => HTMLCanvasElement | null>();
