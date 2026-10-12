import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDrawingsStore } from "@/stores/drawings.store";
import { usePreferencesStore } from "@/stores/preferences.store";
import { DRAWING_COLORS, colorOf, isHexColor } from "@/types/drawing";

/**
 * 绘图颜色。没有选中绘图时，选的是"接下来画的线用什么颜色"；
 * 选中了某个绘图时，同时把它改成这个颜色。
 */
export function ColorPicker() {
  const current = usePreferencesStore((s) => s.drawingColor);
  const selectedColor = useDrawingsStore((s) => {
    if (!s.selected) return null;
    const drawing = s.byMarket[s.selected.key]?.find((d) => d.id === s.selected!.id);
    return drawing ? colorOf(drawing) : null;
  });
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const shown = selectedColor ?? current;

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const width = 148;
    const height = 150;
    // 竖排工具栏时弹在右边，手机上工具栏在底部时弹在上方
    const beside = rect.right + 6 + width <= window.innerWidth && rect.top + height <= window.innerHeight;
    setPos(
      beside
        ? { left: rect.right + 6, top: rect.top }
        : { left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: Math.max(8, rect.top - height - 6) },
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

  const pick = (color: string) => {
    if (!isHexColor(color)) return;
    const value = color.toLowerCase();
    usePreferencesStore.getState().update({ drawingColor: value });
    const drawings = useDrawingsStore.getState();
    if (drawings.selected) drawings.patch(drawings.selected.key, drawings.selected.id, { color: value });
  };

  return (
    <div ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="tool"
        data-testid="color-button"
        data-color={shown}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={selectedColor ? "修改选中绘图的颜色" : "选择画线的颜色"}
        title={selectedColor ? "修改选中绘图的颜色" : "选择画线的颜色"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="swatch" style={{ background: shown }} />
      </button>
      {open && (
        <div className="palette" style={pos} data-testid="color-palette">
          <div className="palette__title">{selectedColor ? "选中绘图的颜色" : "画线颜色"}</div>
          <div className="palette__grid" role="radiogroup" aria-label="颜色">
            {DRAWING_COLORS.map((color) => (
              <button
                key={color.value}
                type="button"
                role="radio"
                className="palette__color"
                data-testid={`color-${color.value.slice(1)}`}
                aria-checked={shown === color.value}
                aria-label={color.label}
                title={color.label}
                onClick={() => {
                  pick(color.value);
                  setOpen(false);
                }}
              >
                <span className="swatch" style={{ background: color.value }} />
              </button>
            ))}
          </div>
          <label className="palette__custom">
            <input type="color" aria-label="自定义颜色" value={shown} onChange={(e) => pick(e.target.value)} />
            自定义
          </label>
        </div>
      )}
    </div>
  );
}
