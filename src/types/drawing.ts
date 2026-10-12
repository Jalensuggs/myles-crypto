export const DRAWING_TYPES = [
  "trend-line",
  "ray",
  "horizontal-line",
  "channel",
  "rectangle",
  "fib",
  "text",
] as const;
export type DrawingType = (typeof DRAWING_TYPES)[number];
export type DrawingTool = "cursor" | DrawingType;

export interface DrawingPoint {
  /** Unix 秒 */
  time: number;
  price: number;
}

export type DrawingWidth = 1 | 2 | 3;

export interface DrawingObject {
  id: string;
  type: DrawingType;
  points: DrawingPoint[];
  locked: boolean;
  hidden: boolean;
  /** 线条颜色，形如 #2edb83；旧数据没有这一项时用默认色 */
  color?: string;
  /** 粗细：1 细、2 中、3 粗；没有时为细 */
  width?: DrawingWidth;
  /** 是否画成虚线 */
  dash?: boolean;
  /** 文字标注的内容 */
  text?: string;
}

/** 每种图形需要点几下 */
export const POINTS_REQUIRED: Record<DrawingType, number> = {
  "trend-line": 2,
  ray: 2,
  "horizontal-line": 1,
  channel: 3,
  rectangle: 2,
  fib: 2,
  text: 1,
};

export const TOOL_LABELS: Record<DrawingTool, string> = {
  cursor: "光标",
  "trend-line": "趋势线",
  ray: "射线",
  "horizontal-line": "水平线",
  channel: "平行通道",
  rectangle: "矩形",
  fib: "斐波那契回撤",
  text: "文字标注",
};

/** 斐波那契回撤的各档比例。0 在终点，1 在起点。 */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export const MAX_TEXT_LENGTH = 60;

export const DEFAULT_DRAWING_COLOR = "#4f7cff";

/** 调色板。绿色和红色放在前面，画支撑线和压力线最常用。 */
export const DRAWING_COLORS: { value: string; label: string }[] = [
  { value: "#2edb83", label: "绿色" },
  { value: "#ff526b", label: "红色" },
  { value: "#4f7cff", label: "蓝色" },
  { value: "#f0b90b", label: "黄色" },
  { value: "#ff8a3d", label: "橙色" },
  { value: "#b388ff", label: "紫色" },
  { value: "#2ee6e6", label: "青色" },
  { value: "#e7eaf0", label: "白色" },
];

export const WIDTH_LABELS: Record<DrawingWidth, string> = { 1: "细", 2: "中", 3: "粗" };
const WIDTH_PIXELS: Record<DrawingWidth, number> = { 1: 1.5, 2: 2.5, 3: 4 };
export const DASH_PATTERN = "7 5";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

export function colorOf(drawing: Pick<DrawingObject, "color">): string {
  return isHexColor(drawing.color) ? drawing.color : DEFAULT_DRAWING_COLOR;
}

/** 线条的像素宽度 */
export function strokeOf(drawing: Pick<DrawingObject, "width">): number {
  return WIDTH_PIXELS[drawing.width ?? 1] ?? WIDTH_PIXELS[1];
}
