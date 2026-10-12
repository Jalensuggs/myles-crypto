export type DrawingType = "trend-line" | "horizontal-line" | "rectangle";
export type DrawingTool = "cursor" | DrawingType;

export interface DrawingPoint {
  /** Unix 秒 */
  time: number;
  price: number;
}

export interface DrawingObject {
  id: string;
  type: DrawingType;
  points: DrawingPoint[];
  locked: boolean;
  hidden: boolean;
  /** 线条颜色，形如 #2edb83；旧数据没有这一项时用默认色 */
  color?: string;
}

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

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

export function colorOf(drawing: Pick<DrawingObject, "color">): string {
  return isHexColor(drawing.color) ? drawing.color : DEFAULT_DRAWING_COLOR;
}

export const POINTS_REQUIRED: Record<DrawingType, number> = {
  "trend-line": 2,
  "horizontal-line": 1,
  rectangle: 2,
};

export const TOOL_LABELS: Record<DrawingTool, string> = {
  cursor: "光标",
  "trend-line": "趋势线",
  "horizontal-line": "水平线",
  rectangle: "矩形",
};
