import type { Logical } from "lightweight-charts";
import type { ChartBridge } from "@/components/chart/bridge";
import { indexToTime, timeToIndex } from "@/lib/time-index";
import type { DrawingObject, DrawingPoint } from "@/types/drawing";

/** 某一时刻的坐标换算器。视口变化后需要重新创建。 */
export interface Projector {
  width: number;
  height: number;
  barSpacing: number;
  toX(time: number): number | null;
  toY(price: number): number | null;
  /** 横坐标对应的时间，吸附到最近的一根 K 线 */
  toTime(x: number): number | null;
  toPrice(y: number): number | null;
  /** 把一个时间按像素距离平移，结果仍然吸附到 K 线 */
  shiftTime(time: number, dx: number): number | null;
}

export function makeProjector(bridge: ChartBridge): Projector | null {
  const series = bridge.series();
  const candles = bridge.candles();
  if (!series || candles.length === 0) return null;

  const timeScale = bridge.chart.timeScale();
  const x0 = timeScale.logicalToCoordinate(0 as Logical);
  const x1 = timeScale.logicalToCoordinate(1 as Logical);
  if (x0 === null || x1 === null || x1 === x0) return null;
  const spacing = x1 - x0;
  const step = bridge.stepSeconds();
  const size = bridge.chart.paneSize(0);

  const toX = (time: number) => {
    const index = timeToIndex(candles, time, step);
    return index === null ? null : x0 + index * spacing;
  };

  return {
    width: size.width,
    height: size.height,
    barSpacing: spacing,
    toX,
    toY: (price) => series.priceToCoordinate(price),
    toTime: (x) => indexToTime(candles, Math.round((x - x0) / spacing), step),
    toPrice: (y) => series.coordinateToPrice(y),
    shiftTime: (time, dx) => {
      const index = timeToIndex(candles, time, step);
      if (index === null) return null;
      return indexToTime(candles, Math.round(index + dx / spacing), step);
    },
  };
}

export type Shape =
  | { type: "trend-line"; x1: number; y1: number; x2: number; y2: number }
  | { type: "horizontal-line"; y: number; price: number }
  | { type: "rectangle"; x1: number; y1: number; x2: number; y2: number };

export function projectDrawing(
  drawing: Pick<DrawingObject, "type" | "points">,
  p: Projector,
): Shape | null {
  const a = drawing.points[0];
  if (!a) return null;
  if (drawing.type === "horizontal-line") {
    const y = p.toY(a.price);
    return y === null ? null : { type: "horizontal-line", y, price: a.price };
  }
  const b = drawing.points[1];
  if (!b) return null;
  const x1 = p.toX(a.time);
  const y1 = p.toY(a.price);
  const x2 = p.toX(b.time);
  const y2 = p.toY(b.price);
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
  return { type: drawing.type, x1, y1, x2, y2 };
}

export function pointAt(p: Projector, x: number, y: number): DrawingPoint | null {
  const time = p.toTime(x);
  const price = p.toPrice(y);
  if (time === null || price === null) return null;
  return { time, price };
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export interface PaintItem {
  shape: Shape;
  color: string;
}

/** 把图形画到截图画布上，样式与屏幕上的 SVG 保持一致 */
export function paintShapes(
  ctx: CanvasRenderingContext2D,
  items: readonly PaintItem[],
  width: number,
  height: number,
  pixelRatio: number,
): void {
  ctx.save();
  ctx.scale(pixelRatio, pixelRatio);
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.lineWidth = 1.5;
  for (const { shape: s, color } of items) {
    ctx.strokeStyle = color;
    if (s.type === "horizontal-line") {
      ctx.beginPath();
      ctx.moveTo(0, s.y);
      ctx.lineTo(width, s.y);
      ctx.stroke();
    } else if (s.type === "trend-line") {
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    } else {
      const x = Math.min(s.x1, s.x2);
      const y = Math.min(s.y1, s.y2);
      const w = Math.abs(s.x2 - s.x1);
      const h = Math.abs(s.y2 - s.y1);
      ctx.fillStyle = withAlpha(color, 0.12);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
  }
  ctx.restore();
}
