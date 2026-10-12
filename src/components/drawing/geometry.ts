import type { Logical } from "lightweight-charts";
import type { ChartBridge } from "@/components/chart/bridge";
import { formatPrice } from "@/lib/format";
import { indexToTime, timeToIndex } from "@/lib/time-index";
import { DASH_PATTERN, FIB_LEVELS, type DrawingObject, type DrawingPoint } from "@/types/drawing";

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

export interface FibLevel {
  ratio: number;
  y: number;
  price: number;
}

/** 图形在屏幕上的几何形状，由绘图对象和当前视口算出 */
export type Shape =
  | { type: "trend-line"; x1: number; y1: number; x2: number; y2: number }
  /** 射线：(x2, y2) 已经延长到了图表边缘 */
  | { type: "ray"; x1: number; y1: number; x2: number; y2: number }
  | { type: "horizontal-line"; y: number; price: number }
  | { type: "rectangle"; x1: number; y1: number; x2: number; y2: number }
  /** 平行通道：第二条线是第一条线在纵向平移 offset 像素 */
  | { type: "channel"; x1: number; y1: number; x2: number; y2: number; offset: number }
  | { type: "fib"; x1: number; x2: number; levels: FibLevel[] }
  | { type: "text"; x: number; y: number; text: string };

interface Pt {
  x: number;
  y: number;
}

function toPoint(point: DrawingPoint | undefined, p: Projector): Pt | null {
  if (!point) return null;
  const x = p.toX(point.time);
  const y = p.toY(point.price);
  return x === null || y === null ? null : { x, y };
}

/** 把从 a 出发、经过 b 的射线延长到图表边缘 */
export function extendRay(a: Pt, b: Pt, width: number, height: number): Pt | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return null;
  if (dx === 0) return { x: a.x, y: dy > 0 ? height : 0 };
  const edge = dx > 0 ? Math.max(width, b.x) : Math.min(0, b.x);
  const t = (edge - a.x) / dx;
  return { x: edge, y: a.y + dy * t };
}

/**
 * 把绘图对象换算成屏幕上的形状。
 * 画到一半时点数还不够：平行通道只有两个点时先按一条线显示，其余情况返回 null。
 */
export function projectDrawing(drawing: Pick<DrawingObject, "type" | "points" | "text">, p: Projector): Shape | null {
  const a = toPoint(drawing.points[0], p);
  if (!a) return null;
  const first = drawing.points[0]!;

  if (drawing.type === "horizontal-line") return { type: "horizontal-line", y: a.y, price: first.price };
  if (drawing.type === "text") return { type: "text", x: a.x, y: a.y, text: drawing.text ?? "" };

  const b = toPoint(drawing.points[1], p);
  if (!b) return null;
  const second = drawing.points[1]!;

  switch (drawing.type) {
    case "trend-line":
    case "rectangle":
      return { type: drawing.type, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    case "ray": {
      const end = extendRay(a, b, p.width, p.height);
      return end ? { type: "ray", x1: a.x, y1: a.y, x2: end.x, y2: end.y } : null;
    }
    case "channel": {
      const c = toPoint(drawing.points[2], p);
      if (!c) return { type: "trend-line", x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      // 第三个点到基线的纵向距离，就是两条线之间的间隔
      const onBase = b.x === a.x ? a.y : a.y + ((b.y - a.y) * (c.x - a.x)) / (b.x - a.x);
      return { type: "channel", x1: a.x, y1: a.y, x2: b.x, y2: b.y, offset: c.y - onBase };
    }
    case "fib": {
      const levels: FibLevel[] = [];
      for (const ratio of FIB_LEVELS) {
        // 0 在终点（第二个点），1 在起点（第一个点）
        const price = second.price - (second.price - first.price) * ratio;
        const y = p.toY(price);
        if (y !== null) levels.push({ ratio, y, price });
      }
      return levels.length > 0 ? { type: "fib", x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), levels } : null;
    }
  }
}

/** 各个控制点在屏幕上的位置，选中时用来画可以拖动的圆点 */
export function handlePoints(drawing: Pick<DrawingObject, "points">, p: Projector): Pt[] {
  const out: Pt[] = [];
  for (const point of drawing.points) {
    const pt = toPoint(point, p);
    if (pt) out.push(pt);
  }
  return out;
}

export function pointAt(p: Projector, x: number, y: number): DrawingPoint | null {
  const time = p.toTime(x);
  const price = p.toPrice(y);
  if (time === null || price === null) return null;
  return { time, price };
}

export function fibLabel(level: FibLevel, precision: number): string {
  return `${level.ratio} (${formatPrice(level.price, precision)})`;
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export interface PaintItem {
  shape: Shape;
  color: string;
  stroke: number;
  dash: boolean;
}

/** 把图形画到截图画布上，样式与屏幕上的 SVG 保持一致 */
export function paintShapes(
  ctx: CanvasRenderingContext2D,
  items: readonly PaintItem[],
  width: number,
  height: number,
  pixelRatio: number,
  precision = 2,
): void {
  ctx.save();
  ctx.scale(pixelRatio, pixelRatio);
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  for (const { shape: s, color, stroke, dash } of items) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = stroke;
    ctx.setLineDash(dash ? DASH_PATTERN.split(" ").map(Number) : []);
    ctx.font = '11px "Inter", "PingFang SC", system-ui, sans-serif';
    ctx.textBaseline = "alphabetic";

    switch (s.type) {
      case "horizontal-line":
        line(0, s.y, width, s.y);
        ctx.textAlign = "right";
        ctx.fillText(formatPrice(s.price, precision), width - 6, s.y - 5);
        break;
      case "trend-line":
      case "ray":
        line(s.x1, s.y1, s.x2, s.y2);
        break;
      case "channel":
        line(s.x1, s.y1, s.x2, s.y2);
        line(s.x1, s.y1 + s.offset, s.x2, s.y2 + s.offset);
        break;
      case "rectangle": {
        const x = Math.min(s.x1, s.x2);
        const y = Math.min(s.y1, s.y2);
        const w = Math.abs(s.x2 - s.x1);
        const h = Math.abs(s.y2 - s.y1);
        ctx.fillStyle = withAlpha(color, 0.12);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        break;
      }
      case "fib":
        ctx.textAlign = "left";
        for (const level of s.levels) {
          line(s.x1, level.y, s.x2, level.y);
          ctx.fillText(fibLabel(level, precision), s.x1 + 4, level.y - 4);
        }
        break;
      case "text":
        ctx.setLineDash([]);
        ctx.textAlign = "left";
        ctx.font = '600 13px "Inter", "PingFang SC", system-ui, sans-serif';
        ctx.fillText(s.text, s.x, s.y);
        break;
    }
  }
  ctx.restore();
}
