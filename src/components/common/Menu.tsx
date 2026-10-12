import { Check } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface MenuOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface MenuProps<T extends string> {
  label: string;
  value: T;
  options: readonly MenuOption<T>[];
  onChange: (value: T) => void;
  children: ReactNode;
}

/** 单选下拉菜单。列表用 fixed 定位，不会被可滚动的工具栏裁掉。 */
export function Menu<T extends string>({ label, value, options, onChange, children }: MenuProps<T>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPos({ left: Math.min(rect.left, window.innerWidth - 160), top: rect.bottom + 4 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
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

  return (
    <div className="menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="tbtn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </button>
      {open && (
        <div className="menu__list" role="menu" aria-label={label} style={pos}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              className="menu__item"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.icon}
              {option.label}
              {option.value === value && <Check size={14} className="menu__check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
