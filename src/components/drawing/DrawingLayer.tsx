import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ChartBridge } from "@/components/chart/bridge";
import { formatPrice, uid } from "@/lib/format";
import { selectDrawings, useDrawingsStore } from "@/stores/drawings.store";
import { usePreferencesStore } from "@/stores/preferences.store";
import { POINTS_REQUIRED, colorOf, type DrawingObject, type DrawingPoint, type DrawingType } from "@/types/drawing";
import {
  makeProjector,
  paintShapes,
  pointAt,
  projectDrawing,
  type PaintItem,
  type Projector,
  type Shape,
} from "./geometry";

interface Draft {
  type: DrawingType;
  points: [DrawingPoint, DrawingPoint];
  downAt: { x: number; y: number };
}

interface Drag {
  id: string;
  /** move 表示整体拖动，数字表示拖动第几个端点 */
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

function safeProjector(bridge: ChartBridge): Projector | null {
  try {
    return makeProjector(bridge);
  } catch {
    return null;
  }
}

export const DrawingLayer = memo(function DrawingLayer({ bridge, marketKey: key, precision }: DrawingLayerProps) {
  const selector = useMemo(() => selectDrawings(key), [key]);
  const drawings = useDrawingsStore(selector);
  const tool = useDrawingsStore((s) => s.tool);
  const selectedId = useDrawingsStore((s) => (s.selected?.key === key ? s.selected.id : null));
  const lockedAll = useDrawingsStore((s) => s.lockedAll);
  const currentColor = usePreferencesStore((s) => s.drawingColor);
  const hiddenAll = useDrawingsStore((s) => s.hiddenAll);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
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

  useEffect(() => {
    bridge.setOverlayPainter((ctx, pixelRatio) => {
      if (hiddenAll) return;
      const p = safeProjector(bridge);
      if (!p) return;
      const items: PaintItem[] = [];
      for (const drawing of drawings) {
        if (drawing.hidden) continue;
        const shape = projectDrawing(drawing, p);
        if (shape) items.push({ shape, color: colorOf(drawing) });
      }
      paintShapes(ctx, items, p.width, p.height, pixelRatio);
    });
    return () => bridge.setOverlayPainter(null);
  }, [bridge, drawings, hiddenAll]);

  const projector = safeProjector(bridge);
  const drawingTool = tool === "cursor" ? null : tool;
  const activeDraft = draft && draft.type === drawingTool ? draft : null;

  const local = (e: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const commit = (type: DrawingType, points: DrawingPoint[]) => {
    const store = useDrawingsStore.getState();
    store.add(key, {
      id: uid("d"),
      type,
      points,
      locked: false,
      hidden: false,
      color: usePreferencesStore.getState().drawingColor,
    });
    store.setTool("cursor");
    setDraft(null);
  };

  const samePoint = (a: DrawingPoint, b: DrawingPoint) => a.time === b.time && a.price === b.price;

  const onCaptureDown = (e: ReactPointerEvent<SVGRectElement>) => {
    if (e.button !== 0 || !projector || !drawingTool) return;
    e.stopPropagation();
    const { x, y } = local(e);
    const point = pointAt(projector, x, y);
    if (!point) return;
    if (POINTS_REQUIRED[drawingTool] === 1) {
      commit(drawingTool, [point]);
      return;
    }
    if (!activeDraft) {
      setDraft({ type: drawingTool, points: [point, point], downAt: { x, y } });
      return;
    }
    if (!samePoint(activeDraft.points[0], point)) commit(drawingTool, [activeDraft.points[0], point]);
  };

  const onCaptureMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const { x, y } = local(e);
    setHover({ x, y });
    if (!activeDraft || !projector) return;
    const point = pointAt(projector, x, y);
    if (point) setDraft({ ...activeDraft, points: [activeDraft.points[0], point] });
  };

  // 也支持按住拖出一条线：松开时移动距离足够就直接完成
  const onCaptureUp = (e: ReactPointerEvent<SVGRectElement>) => {
    if (!activeDraft || !projector) return;
    const { x, y } = local(e);
    if (Math.hypot(x - activeDraft.downAt.x, y - activeDraft.downAt.y) < DRAW_DRAG_THRESHOLD) return;
    const point = pointAt(projector, x, y);
    if (point && !samePoint(activeDraft.points[0], point)) commit(activeDraft.type, [activeDraft.points[0], point]);
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

  const width = projector?.width ?? 0;
  const height = projector?.height ?? 0;

  const renderShape = (shape: Shape, selected: boolean, key?: string) => {
    const k = key ?? "draft";
    if (shape.type === "horizontal-line") {
      return (
        <g key={k}>
          <line className="drawing" data-selected={selected} x1={0} x2={width} y1={shape.y} y2={shape.y} />
          <text className="drawing__label" x={width - 6} y={shape.y - 5} textAnchor="end">
            {formatPrice(shape.price, precision)}
          </text>
        </g>
      );
    }
    if (shape.type === "trend-line") {
      return (
        <line
          key={k}
          className="drawing"
          data-selected={selected}
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
        />
      );
    }
    return (
      <rect
        key={k}
        className="drawing drawing--rect"
        data-selected={selected}
        x={Math.min(shape.x1, shape.x2)}
        y={Math.min(shape.y1, shape.y2)}
        width={Math.abs(shape.x2 - shape.x1)}
        height={Math.abs(shape.y2 - shape.y1)}
      />
    );
  };

  const renderHit = (drawing: DrawingObject, shape: Shape) => {
    const locked = drawing.locked || lockedAll;
    const common = {
      className: "drawing__hit",
      "data-locked": locked,
      "data-testid": `drawing-${drawing.type}`,
      "data-color": colorOf(drawing),
      onPointerDown: (e: ReactPointerEvent<SVGElement>) => onShapeDown(e, drawing, "move"),
      onPointerMove: onShapeMove,
      onPointerUp: onShapeUp,
      onPointerCancel: onShapeUp,
    };
    if (shape.type === "horizontal-line") return <line {...common} x1={0} x2={width} y1={shape.y} y2={shape.y} />;
    if (shape.type === "trend-line") return <line {...common} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} />;
    return (
      <rect
        {...common}
        x={Math.min(shape.x1, shape.x2)}
        y={Math.min(shape.y1, shape.y2)}
        width={Math.abs(shape.x2 - shape.x1)}
        height={Math.abs(shape.y2 - shape.y1)}
      />
    );
  };

  const renderHandles = (drawing: DrawingObject, shape: Shape) => {
    if (shape.type === "horizontal-line" || drawing.locked || lockedAll) return null;
    const ends: [number, number][] = [
      [shape.x1, shape.y1],
      [shape.x2, shape.y2],
    ];
    return ends.map(([cx, cy], i) => (
      <circle
        key={i}
        className="drawing__handle"
        cx={cx}
        cy={cy}
        r={5}
        onPointerDown={(e) => onShapeDown(e, drawing, i)}
        onPointerMove={onShapeMove}
        onPointerUp={onShapeUp}
        onPointerCancel={onShapeUp}
      />
    ));
  };

  const draftShape = activeDraft && projector ? projectDrawing(activeDraft, projector) : null;

  // 落点预览：选了工具、还没点下去时，用虚线标出鼠标所在的价格。
  // 水平线画一整条虚线（就是点下去后那条线的位置）；趋势线和矩形画十字虚线帮助对准第一个点。
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
            <g key={drawing.id} style={{ color: colorOf(drawing) }}>
              {renderShape(shape, selected, "shape")}
              {!drawingTool && renderHit(drawing, shape)}
              {selected && !drawingTool && renderHandles(drawing, shape)}
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
      {draftShape && <g style={{ pointerEvents: "none", color: currentColor }}>{renderShape(draftShape, true)}</g>}
      {preview}
    </svg>
  );
});
