import { Check, ChevronDown, Sigma } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePreferencesStore, type Preferences } from "@/stores/preferences.store";

type ToggleKey = {
  [K in keyof Preferences]: Preferences[K] extends boolean ? K : never;
}[keyof Preferences];

interface Item {
  id: string;
  key: ToggleKey;
  label: string;
  hint: (p: Preferences) => string;
}

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "主图",
    items: [
      { id: "ma", key: "indicatorMa", label: "MA 均线", hint: (p) => p.maPeriods.join(" / ") },
      { id: "ema", key: "indicatorEma", label: "EMA 指数均线", hint: (p) => p.emaPeriods.join(" / ") },
      { id: "boll", key: "indicatorBoll", label: "BOLL 布林带", hint: (p) => p.bollParams.join(" / ") },
    ],
  },
  {
    title: "成交量",
    items: [{ id: "volma", key: "indicatorVolMa", label: "成交量均线", hint: (p) => p.volMaPeriods.join(" / ") }],
  },
  {
    title: "副图",
    items: [
      { id: "macd", key: "indicatorMacd", label: "MACD", hint: (p) => p.macdParams.join(" / ") },
      { id: "kdj", key: "indicatorKdj", label: "KDJ", hint: (p) => p.kdjParams.join(" / ") },
      { id: "rsi", key: "indicatorRsi", label: "RSI 相对强弱", hint: (p) => String(p.rsiPeriod) },
    ],
  },
];

const ALL_ITEMS = GROUPS.flatMap((g) => g.items);

/** 技术指标的多选菜单。选择对所有图表生效，并记在本地。 */
export function IndicatorMenu() {
  const prefs = usePreferencesStore();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const count = ALL_ITEMS.filter((item) => prefs[item.key]).length;

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)), top: rect.bottom + 4 });
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
        data-testid="indicator-button"
        data-active={count > 0}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`技术指标，已开启 ${count} 个`}
        title="技术指标"
        onClick={() => setOpen((v) => !v)}
      >
        <Sigma size={15} />
        指标
        {count > 0 && <span className="tbtn__tag">{count}</span>}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="menu__list menu__list--wide" role="menu" aria-label="技术指标" style={pos}>
          {GROUPS.map((group) => (
            <div key={group.title} role="group" aria-label={group.title}>
              <div className="menu__group">{group.title}</div>
              {group.items.map((item) => {
                const checked = prefs[item.key];
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    data-testid={`indicator-${item.id}`}
                    className="menu__item"
                    onClick={() => prefs.update({ [item.key]: !checked })}
                  >
                    <span className="menu__box" aria-hidden="true">
                      {checked && <Check size={12} />}
                    </span>
                    {item.label}
                    <span className="menu__hint">{item.hint(prefs)}</span>
                  </button>
                );
              })}
            </div>
          ))}
          <div className="menu__foot">
            均线的数字是 K 线根数，不是天数：日线图上的 MA120 是 120 个交易日，15 分图上的 MA120 只有 120 根 15
            分钟线（约 4.6 个交易日），所以会贴着 K 线走。各项参数可以在设置里修改。
          </div>
        </div>
      )}
    </div>
  );
}
