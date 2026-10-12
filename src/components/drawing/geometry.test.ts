import { describe, expect, it } from "vitest";
import { FIB_LEVELS, strokeOf } from "@/types/drawing";
import { extendRay, fibLabel, handlePoints, projectDrawing, type Projector } from "./geometry";

/** 一个简单的换算器：时间每 60 秒对应 10 像素，价格每 1 对应 2 像素（价格越高越靠上） */
const projector: Projector = {
  width: 800,
  height: 400,
  barSpacing: 10,
  toX: (time) => time / 6,
  toY: (price) => 400 - price * 2,
  toTime: (x) => Math.round(x / 10) * 60,
  toPrice: (y) => (400 - y) / 2,
  shiftTime: (time, dx) => time + Math.round(dx / 10) * 60,
};

const pt = (time: number, price: number) => ({ time, price });

describe("extendRay", () => {
  it("向右的射线延长到右边缘", () => {
    expect(extendRay({ x: 100, y: 300 }, { x: 200, y: 250 }, 800, 400)).toEqual({ x: 800, y: -50 });
  });

  it("向左的射线延长到左边缘", () => {
    expect(extendRay({ x: 200, y: 100 }, { x: 100, y: 150 }, 800, 400)).toEqual({ x: 0, y: 200 });
  });

  it("竖直的射线延长到上边缘或下边缘", () => {
    expect(extendRay({ x: 100, y: 100 }, { x: 100, y: 200 }, 800, 400)).toEqual({ x: 100, y: 400 });
    expect(extendRay({ x: 100, y: 200 }, { x: 100, y: 100 }, 800, 400)).toEqual({ x: 100, y: 0 });
  });

  it("水平的射线保持高度不变", () => {
    expect(extendRay({ x: 100, y: 120 }, { x: 300, y: 120 }, 800, 400)).toEqual({ x: 800, y: 120 });
  });

  it("第二个点已经在边缘之外时不会缩回来", () => {
    expect(extendRay({ x: 100, y: 100 }, { x: 900, y: 100 }, 800, 400)).toEqual({ x: 900, y: 100 });
  });

  it("两个点重合时没有方向", () => {
    expect(extendRay({ x: 5, y: 5 }, { x: 5, y: 5 }, 800, 400)).toBeNull();
  });
});

describe("projectDrawing", () => {
  it("趋势线和矩形：两个点直接换算", () => {
    expect(projectDrawing({ type: "trend-line", points: [pt(600, 100), pt(1200, 150)] }, projector)).toEqual({
      type: "trend-line",
      x1: 100,
      y1: 200,
      x2: 200,
      y2: 100,
    });
    expect(projectDrawing({ type: "rectangle", points: [pt(600, 100), pt(1200, 150)] }, projector)?.type).toBe("rectangle");
  });

  it("射线：终点在图表右边缘，且和两个点在一条直线上", () => {
    const shape = projectDrawing({ type: "ray", points: [pt(600, 100), pt(1200, 150)] }, projector);
    expect(shape).toMatchObject({ type: "ray", x1: 100, y1: 200, x2: 800 });
    // 斜率 -1：每向右 100 像素上升 100 像素
    expect(shape).toMatchObject({ y2: -500 });
  });

  it("水平线只看价格", () => {
    expect(projectDrawing({ type: "horizontal-line", points: [pt(0, 120)] }, projector)).toEqual({
      type: "horizontal-line",
      y: 160,
      price: 120,
    });
  });

  it("平行通道：第三个点决定两条线的间距", () => {
    // 基线从 (100,200) 到 (200,100)。第三个点 x=150 处基线高度是 150，点在 y=190，间距 +40
    const shape = projectDrawing({ type: "channel", points: [pt(600, 100), pt(1200, 150), pt(900, 105)] }, projector);
    expect(shape).toEqual({ type: "channel", x1: 100, y1: 200, x2: 200, y2: 100, offset: 40 });
  });

  it("平行通道画到一半（只有两个点）时先显示成一条线", () => {
    expect(projectDrawing({ type: "channel", points: [pt(600, 100), pt(1200, 150)] }, projector)?.type).toBe("trend-line");
  });

  it("斐波那契回撤：0 在第二个点，1 在第一个点，中间按比例", () => {
    const shape = projectDrawing({ type: "fib", points: [pt(600, 100), pt(1200, 200)] }, projector);
    if (shape?.type !== "fib") throw new Error("应该得到斐波那契回撤");
    expect(shape.x1).toBe(100);
    expect(shape.x2).toBe(200);
    expect(shape.levels.map((l) => l.ratio)).toEqual([...FIB_LEVELS]);
    expect(shape.levels[0]).toMatchObject({ ratio: 0, price: 200 });
    expect(shape.levels[6]).toMatchObject({ ratio: 1, price: 100 });
    expect(shape.levels.find((l) => l.ratio === 0.618)!.price).toBeCloseTo(138.2, 6);
    expect(shape.levels.find((l) => l.ratio === 0.5)!.price).toBe(150);
  });

  it("斐波那契回撤从高点画到低点时方向相反", () => {
    const shape = projectDrawing({ type: "fib", points: [pt(1200, 200), pt(600, 100)] }, projector);
    if (shape?.type !== "fib") throw new Error("应该得到斐波那契回撤");
    expect(shape.x1).toBe(100);
    expect(shape.levels[0]!.price).toBe(100);
    expect(shape.levels[6]!.price).toBe(200);
  });

  it("文字标注带上内容", () => {
    expect(projectDrawing({ type: "text", points: [pt(600, 100)], text: "支撑位" }, projector)).toEqual({
      type: "text",
      x: 100,
      y: 200,
      text: "支撑位",
    });
  });

  it("点数不够时返回 null", () => {
    expect(projectDrawing({ type: "trend-line", points: [pt(600, 100)] }, projector)).toBeNull();
    expect(projectDrawing({ type: "fib", points: [] }, projector)).toBeNull();
  });
});

describe("其他", () => {
  it("控制点的位置和点一一对应", () => {
    expect(handlePoints({ points: [pt(600, 100), pt(1200, 150), pt(900, 105)] }, projector)).toEqual([
      { x: 100, y: 200 },
      { x: 200, y: 100 },
      { x: 150, y: 190 },
    ]);
  });

  it("斐波那契的标签带比例和价格", () => {
    expect(fibLabel({ ratio: 0.618, y: 0, price: 1038.2 }, 2)).toBe("0.618 (1,038.20)");
  });

  it("粗细对应的像素宽度", () => {
    expect(strokeOf({})).toBe(1.5);
    expect(strokeOf({ width: 2 })).toBe(2.5);
    expect(strokeOf({ width: 3 })).toBe(4);
  });
});
