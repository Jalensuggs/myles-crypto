import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDrawingsStore } from "@/stores/drawings.store";
import { usePreferencesStore } from "@/stores/preferences.store";
import { WIDTH_LABELS, type DrawingWidth } from "@/types/drawing";

const WIDTHS: DrawingWidth[] = [1, 2, 3];
const PREVIEW_STROKE: Record<DrawingWidth, number> = { 1: 1.5, 2: 2.5, 3: 4 };

/**
 * 线的粗细和虚实。和颜色一样：没有选中绘图时，选的是接下来画的线的样式；
 * 选中了某个绘图时，同时把它改成这个样式。
 */
export function StylePicker() {
  const currentWidth = usePreferencesStore((s) => s.drawingWidth);
  const currentDash = usePreferencesStore((s) => s.drawingDash);
  const selected = useDrawingsStore((s) => {
    if (!s.selected) return null;
    return s.byMarket[s.selected.key]?.find((d) => d.id === s.selected!.id) ?? null;
  });
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const width: DrawingWidth = selected ? (selected.width ?? 1) : currentWidth;
  const dash = selected ? selected.dash === true : currentDash;

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const w = 168;
    const h = 130;
    // 竖排工具栏时弹在右边，手机上工具栏在底部时弹在上方
    const beside = rect.right + 6 + w <= window.innerWidth && rect.top + h <= window.innerHeight;
    setPos(
      beside
        ? { left: rect.right + 6, top: rect.top }
        : { left: Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)), top: Math.max(8, rect.top - h - 6) },
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const apply = (patch: { width?: DrawingWidth; dash?: boolean }) => {
    const prefs = usePreferencesStore.getState();
    if (patch.width !== undefined) prefs.update({ drawingWidth: patch.width });
    if (patch.dash !== undefined) prefs.update({ drawingDash: patch.dash });
    const drawings = useDrawingsStore.getState();
    if (drawings.selected) drawings.patch(drawings.selected.key, drawings.selected.id, patch);
  };

  const label = selected ? "修改选中绘图的粗细和线型" : "选择画线的粗细和线型";

  return (
    <div ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="tool"
        data-testid="style-button"
        data-width={width}
        data-dash={dash}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <line
            x1="2"
            x2="16"
            y1="9"
            y2="9"
            stroke="currentColor"
            strokeWidth={PREVIEW_STROKE[width]}
            strokeDasharray={dash ? "4 3" : undefined}
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <div className="palette palette--style" style={pos} data-testid="style-palette">
          <div className="palette__title">粗细</div>
          <div className="segmented" role="group" aria-label="粗细">
            {WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                data-testid={`width-${w}`}
                aria-pressed={width === w}
                onClick={() => apply({ width: w })}
              >
                {WIDTH_LABELS[w]}
              </button>
            ))}
          </div>
          <div className="palette__title" style={{ marginTop: 10 }}>
            线型
          </div>
          <div className="segmented" role="group" aria-label="线型">
            <button type="button" data-testid="dash-off" aria-pressed={!dash} onClick={() => apply({ dash: false })}>
              实线
            </button>
            <button type="button" data-testid="dash-on" aria-pressed={dash} onClick={() => apply({ dash: true })}>
              虚线
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
