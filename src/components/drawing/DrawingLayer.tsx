import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { ChartBridge } from "@/components/chart/bridge";
import { formatPrice, uid } from "@/lib/format";
import { selectDrawings, useDrawingsStore } from "@/stores/drawings.store";
import { usePreferencesStore } from "@/stores/preferences.store";
import {
  DASH_PATTERN,
  MAX_TEXT_LENGTH,
  POINTS_REQUIRED,
  colorOf,
  strokeOf,
  type DrawingObject,
  type DrawingPoint,
  type DrawingType,
} from "@/types/drawing";
import {
  fibLabel,
  handlePoints,
  makeProjector,
  paintShapes,
  pointAt,
  projectDrawing,
  type PaintItem,
  type Projector,
  type Shape,
} from "./geometry";

/** 画到一半的图形：已经点下的点，加上鼠标当前所在的点 */
interface Draft {
  type: DrawingType;
  points: DrawingPoint[];
  cursor: DrawingPoint;
  downAt: { x: number; y: number };
}

interface Drag {
  id: string;
  /** move 表示整体拖动，数字表示拖动第几个控制点 */
  mode: "move" | number;
  startX: number;
  startY: number;
  origin: DrawingPoint[];
  moved: boolean;
}

interface DrawingLayerProps {
  bridge: ChartBridge;
  marketKey: string;
  precision: number;
}

const DRAG_THRESHOLD = 3;
const DRAW_DRAG_THRESHOLD = 6;
/** 选中时线条加粗这么多像素 */
const SELECTED_EXTRA = 0.75;

function safeProjector(bridge: ChartBridge): Projector | null {
  try {
    return makeProjector(bridge);
  } catch {
    return null;
  }
}

function askText(current = ""): string | null {
  const input = window.prompt(`输入要标注的文字（最多 ${MAX_TEXT_LENGTH} 个字）`, current);
  if (input === null) return null;
  const text = input.trim().slice(0, MAX_TEXT_LENGTH);
  return text === "" ? null : text;
}

export const DrawingLayer = memo(function DrawingLayer({ bridge, marketKey: key, precision }: DrawingLayerProps) {
  const selector = useMemo(() => selectDrawings(key), [key]);
  const drawings = useDrawingsStore(selector);
  const tool = useDrawingsStore((s) => s.tool);
  const selectedId = useDrawingsStore((s) => (s.selected?.key === key ? s.selected.id : null));
  const lockedAll = useDrawingsStore((s) => s.lockedAll);
  const hiddenAll = useDrawingsStore((s) => s.hiddenAll);
  const currentColor = usePreferencesStore((s) => s.drawingColor);
  const currentWidth = usePreferencesStore((s) => s.drawingWidth);
  const currentDash = usePreferencesStore((s) => s.drawingDash);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  /** 这一次按下是否刚刚开始了一个新图形。只有这种情况下，松开时才考虑"按住拖出一条线"。 */
  const startedHereRef = useRef(false);
  const [, setTick] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** 选了绘图工具后鼠标所在的位置，用来画落点预览 */
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  // 视口变化时重新计算坐标。通知来自图表自身的重绘（每帧最多一次），
  // 同一轮里的多次 setState 会被 React 合并成一次渲染。
  useEffect(() => bridge.onViewChange(() => setTick((t) => (t + 1) % 1_000_000)), [bridge]);

  // 切换工具时丢弃画到一半的图形
  useEffect(
    () =>
      useDrawingsStore.subscribe((state, prev) => {
        if (state.tool !== prev.tool) {
          setDraft(null);
          setHover(null);
        }
      }),
    [],
  );

  // 截图时把绘图也画上去
  useEffect(() => {
    bridge.setOverlayPainter((ctx, pixelRatio) => {
      if (hiddenAll) return;
      const p = safeProjector(bridge);
      if (!p) return;
      const items: PaintItem[] = [];
      for (const drawing of drawings) {
        if (drawing.hidden) continue;
        const shape = projectDrawing(drawing, p);
        if (shape) {
          items.push({ shape, color: colorOf(drawing), stroke: strokeOf(drawing), dash: drawing.dash === true });
        }
      }
      paintShapes(ctx, items, p.width, p.height, pixelRatio, precision);
    });
    return () => bridge.setOverlayPainter(null);
  }, [bridge, drawings, hiddenAll, precision]);

  const projector = safeProjector(bridge);
  const drawingTool = tool === "cursor" ? null : tool;
  const activeDraft = draft && draft.type === drawingTool ? draft : null;

  const local = (e: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const commit = (type: DrawingType, points: DrawingPoint[], text?: string) => {
    const store = useDrawingsStore.getState();
    const prefs = usePreferencesStore.getState();
    const drawing: DrawingObject = {
      id: uid("d"),
      type,
      points,
      locked: false,
      hidden: false,
      color: prefs.drawingColor,
    };
    if (prefs.drawingWidth !== 1) drawing.width = prefs.drawingWidth;
    if (prefs.drawingDash) drawing.dash = true;
    if (text !== undefined) drawing.text = text;
    store.add(key, drawing);
    store.setTool("cursor");
    setDraft(null);
  };

  const samePoint = (a: DrawingPoint, b: DrawingPoint) => a.time === b.time && a.price === b.price;

  /** 把一个新点加进正在画的图形；点数够了就完成 */
  const addPoint = (current: Draft, point: DrawingPoint) => {
    const last = current.points[current.points.length - 1]!;
    if (samePoint(last, point)) return;
    const points = [...current.points, point];
    if (points.length >= POINTS_REQUIRED[current.type]) commit(current.type, points);
    else setDraft({ ...current, points, cursor: point });
  };

  const onCaptureDown = (e: ReactPointerEvent<SVGRectElement>) => {
    if (e.button !== 0 || !projector || !drawingTool) return;
    e.stopPropagation();
    const { x, y } = local(e);
    const point = pointAt(projector, x, y);
    if (!point) return;

    startedHereRef.current = false;
    if (drawingTool === "text") {
      const text = askText();
      if (text) commit("text", [point], text);
      else useDrawingsStore.getState().setTool("cursor");
      return;
    }
    if (POINTS_REQUIRED[drawingTool] === 1) {
      commit(drawingTool, [point]);
      return;
    }
    if (!activeDraft) {
      startedHereRef.current = true;
      setDraft({ type: drawingTool, points: [point], cursor: point, downAt: { x, y } });
    } else {
      startedHereRef.current = false;
      addPoint(activeDraft, point);
    }
  };

  const onCaptureMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const { x, y } = local(e);
    setHover({ x, y });
    if (!activeDraft || !projector) return;
    const point = pointAt(projector, x, y);
    if (point) setDraft({ ...activeDraft, cursor: point });
  };

  // 也支持按住拖出一条线：松开时移动距离足够，就把松开的位置当作第二个点
  const onCaptureUp = (e: ReactPointerEvent<SVGRectElement>) => {
    // 如果这次按下已经放下了一个点（第二下、第三下），松开时什么都不做。
    // 否则按下和松开挨得很近、界面还没来得及更新时，同一个点会被算两次，画出重复的图形。
    const startedHere = startedHereRef.current;
    startedHereRef.current = false;
    if (!startedHere || !activeDraft || !projector || activeDraft.points.length !== 1) return;
    const { x, y } = local(e);
    if (Math.hypot(x - activeDraft.downAt.x, y - activeDraft.downAt.y) < DRAW_DRAG_THRESHOLD) return;
    const point = pointAt(projector, x, y);
    if (point) addPoint(activeDraft, point);
  };

  const onShapeDown = (e: ReactPointerEvent<SVGElement>, drawing: DrawingObject, mode: Drag["mode"]) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    useDrawingsStore.getState().select({ key, id: drawing.id });
    if (drawing.locked || lockedAll) return;
    const { x, y } = local(e);
    dragRef.current = { id: drawing.id, mode, startX: x, startY: y, origin: drawing.points, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onShapeMove = (e: ReactPointerEvent<SVGElement>) => {
    const drag = dragRef.current;
    if (!drag || !projector) return;
    const { x, y } = local(e);
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    const store = useDrawingsStore.getState();
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      store.beginDrag();
    }
    let points: DrawingPoint[];
    if (drag.mode === "move") {
      points = drag.origin.map((origin) => {
        const time = projector.shiftTime(origin.time, dx);
        const y0 = projector.toY(origin.price);
        const price = y0 === null ? null : projector.toPrice(y0 + dy);
        return time === null || price === null ? origin : { time, price };
      });
    } else {
      const point = pointAt(projector, x, y);
      if (!point) return;
      const at = drag.mode;
      points = drag.origin.map((origin, i) => (i === at ? point : origin));
    }
    store.dragUpdate(key, drag.id, { points });
  };

  const onShapeUp = (e: ReactPointerEvent<SVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (drag.moved) useDrawingsStore.getState().endDrag();
  };

  const editText = (drawing: DrawingObject) => {
    if (drawing.locked || lockedAll) return;
    const text = askText(drawing.text ?? "");
    if (text && text !== drawing.text) useDrawingsStore.getState().patch(key, drawing.id, { text });
  };

  const width = projector?.width ?? 0;
  const height = projector?.height ?? 0;

  /** 画出图形本身。stroke 和 dash 用行内样式，才能盖过样式表里的默认值。 */
  const renderShape = (shape: Shape, style: CSSProperties) => {
    switch (shape.type) {
      case "horizontal-line":
        return (
          <>
            <line className="drawing" style={style} x1={0} x2={width} y1={shape.y} y2={shape.y} />
            <text className="drawing__label" x={width - 6} y={shape.y - 5} textAnchor="end">
              {formatPrice(shape.price, precision)}
            </text>
          </>
        );
      case "trend-line":
      case "ray":
        return <line className="drawing" style={style} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} />;
      case "channel":
        return (
          <>
            <line className="drawing" style={style} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} />
            <line
              className="drawing"
              style={style}
              x1={shape.x1}
              y1={shape.y1 + shape.offset}
              x2={shape.x2}
              y2={shape.y2 + shape.offset}
            />
            <polygon
              className="drawing__fill"
              points={`${shape.x1},${shape.y1} ${shape.x2},${shape.y2} ${shape.x2},${shape.y2 + shape.offset} ${shape.x1},${shape.y1 + shape.offset}`}
            />
          </>
        );
      case "rectangle":
        return (
          <rect
            className="drawing drawing--rect"
            style={style}
            x={Math.min(shape.x1, shape.x2)}
            y={Math.min(shape.y1, shape.y2)}
            width={Math.abs(shape.x2 - shape.x1)}
            height={Math.abs(shape.y2 - shape.y1)}
          />
        );
      case "fib":
        return (
          <>
            {shape.levels.map((level) => (
              <g key={level.ratio}>
                <line className="drawing" style={style} x1={shape.x1} x2={shape.x2} y1={level.y} y2={level.y} />
                <text className="drawing__label" x={shape.x1 + 4} y={level.y - 4}>
                  {fibLabel(level, precision)}
                </text>
              </g>
            ))}
          </>
        );
      case "text":
        return (
          <text className="drawing__text" x={shape.x} y={shape.y}>
            {shape.text}
          </text>
        );
    }
  };

  /** 透明的加粗区域，方便用鼠标点中细线。每种图形可能有多条。 */
  const renderHits = (drawing: DrawingObject, shape: Shape) => {
    const common = {
      className: "drawing__hit",
      "data-locked": drawing.locked || lockedAll,
      "data-testid": `drawing-${drawing.type}`,
      "data-color": colorOf(drawing),
      onPointerDown: (e: ReactPointerEvent<SVGElement>) => onShapeDown(e, drawing, "move"),
      onPointerMove: onShapeMove,
      onPointerUp: onShapeUp,
      onPointerCancel: onShapeUp,
    };
    switch (shape.type) {
      case "horizontal-line":
        return <line {...common} x1={0} x2={width} y1={shape.y} y2={shape.y} />;
      case "trend-line":
      case "ray":
        return <line {...common} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} />;
      case "channel":
        return (
          <>
            <line {...common} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} />
            <line {...common} x1={shape.x1} y1={shape.y1 + shape.offset} x2={shape.x2} y2={shape.y2 + shape.offset} />
          </>
        );
      case "rectangle":
        return (
          <rect
            {...common}
            x={Math.min(shape.x1, shape.x2)}
            y={Math.min(shape.y1, shape.y2)}
            width={Math.abs(shape.x2 - shape.x1)}
            height={Math.abs(shape.y2 - shape.y1)}
          />
        );
      case "fib":
        return (
          <>
            {shape.levels.map((level) => (
              <line key={level.ratio} {...common} x1={shape.x1} x2={shape.x2} y1={level.y} y2={level.y} />
            ))}
          </>
        );
      case "text":
        return (
          <text
            {...common}
            className="drawing__text drawing__text--hit"
            x={shape.x}
            y={shape.y}
            onDoubleClick={() => editText(drawing)}
          >
            {shape.text}
          </text>
        );
    }
  };

  const renderHandles = (drawing: DrawingObject) => {
    // 水平线和文字整体拖动就够了，不需要单独的控制点
    if (!projector || drawing.type === "horizontal-line" || drawing.type === "text") return null;
    if (drawing.locked || lockedAll) return null;
    return handlePoints(drawing, projector).map((pt, i) => (
      <circle
        key={i}
        className="drawing__handle"
        cx={pt.x}
        cy={pt.y}
        r={5}
        onPointerDown={(e) => onShapeDown(e, drawing, i)}
        onPointerMove={onShapeMove}
        onPointerUp={onShapeUp}
        onPointerCancel={onShapeUp}
      />
    ));
  };

  const styleOf = (stroke: number, dash: boolean, selected: boolean): CSSProperties => ({
    strokeWidth: stroke + (selected ? SELECTED_EXTRA : 0),
    strokeDasharray: dash ? DASH_PATTERN : undefined,
  });

  const draftShape =
    activeDraft && projector
      ? projectDrawing({ type: activeDraft.type, points: [...activeDraft.points, activeDraft.cursor] }, projector)
      : null;
  const draftStroke = strokeOf({ width: currentWidth });

  // 落点预览：选了工具、还没点下去时，用虚线标出鼠标所在的价格。
  // 水平线画一整条虚线（就是点下去后那条线的位置）；其他工具画十字虚线帮助对准第一个点。
  const hoverPrice = drawingTool && hover && projector && !activeDraft ? projector.toPrice(hover.y) : null;
  const preview =
    drawingTool && hover && hoverPrice !== null ? (
      <g
        className="drawing-preview"
        data-testid="drawing-preview"
        data-price={formatPrice(hoverPrice, precision)}
        style={{ color: currentColor }}
      >
        <line className="drawing drawing--dashed" x1={0} x2={width} y1={hover.y} y2={hover.y} />
        {drawingTool !== "horizontal-line" && (
          <line className="drawing drawing--dashed" x1={hover.x} x2={hover.x} y1={0} y2={height} />
        )}
        <text className="drawing__label" x={width - 6} y={hover.y - 5} textAnchor="end">
          {formatPrice(hoverPrice, precision)}
        </text>
      </g>
    ) : null;

  return (
    <svg
      ref={svgRef}
      className="drawings"
      data-testid="drawing-layer"
      data-count={drawings.length}
      width={width}
      height={height}
      aria-hidden="true"
    >
      {projector &&
        !hiddenAll &&
        drawings.map((drawing) => {
          if (drawing.hidden) return null;
          const shape = projectDrawing(drawing, projector);
          if (!shape) return null;
          const selected = drawing.id === selectedId;
          return (
            <g
              key={drawing.id}
              data-testid="drawing-item"
              data-type={drawing.type}
              data-width={drawing.width ?? 1}
              data-dash={drawing.dash === true}
              data-selected={selected}
              style={{ color: colorOf(drawing) }}
            >
              {renderShape(shape, styleOf(strokeOf(drawing), drawing.dash === true, selected))}
              {!drawingTool && renderHits(drawing, shape)}
              {selected && !drawingTool && renderHandles(drawing)}
            </g>
          );
        })}
      {drawingTool && (
        <rect
          className="drawings__capture"
          data-testid="drawing-capture"
          x={0}
          y={0}
          width={width}
          height={height}
          onPointerDown={onCaptureDown}
          onPointerMove={onCaptureMove}
          onPointerLeave={() => setHover(null)}
          onPointerUp={onCaptureUp}
        />
      )}
      {draftShape && (
        <g style={{ pointerEvents: "none", color: currentColor }}>
          {renderShape(draftShape, styleOf(draftStroke, currentDash, true))}
        </g>
      )}
      {preview}
    </svg>
  );
});
