import { Check, ChevronDown, Sigma } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MACD_PARAMS, RSI_PERIOD } from "@/features/indicators/config";
import { usePreferencesStore } from "@/stores/preferences.store";

/** 技术指标的多选菜单。选择对所有图表生效，并记在本地。 */
export function IndicatorMenu() {
  const ma = usePreferencesStore((s) => s.indicatorMa);
  const macd = usePreferencesStore((s) => s.indicatorMacd);
  const rsi = usePreferencesStore((s) => s.indicatorRsi);
  const maPeriods = usePreferencesStore((s) => s.maPeriods);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const count = Number(ma) + Number(macd) + Number(rsi);

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

  const update = usePreferencesStore.getState().update;
  const items = [
    {
      id: "ma",
      checked: ma,
      label: "MA 均线",
      hint: maPeriods.join(" / "),
      toggle: () => update({ indicatorMa: !ma }),
    },
    {
      id: "macd",
      checked: macd,
      label: "MACD",
      hint: `${MACD_PARAMS.fast} / ${MACD_PARAMS.slow} / ${MACD_PARAMS.signal}`,
      toggle: () => update({ indicatorMacd: !macd }),
    },
    { id: "rsi", checked: rsi, label: "RSI 相对强弱", hint: String(RSI_PERIOD), toggle: () => update({ indicatorRsi: !rsi }) },
  ];

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
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={item.checked}
              data-testid={`indicator-${item.id}`}
              className="menu__item"
              onClick={item.toggle}
            >
              <span className="menu__box" aria-hidden="true">
                {item.checked && <Check size={12} />}
              </span>
              {item.label}
              <span className="menu__hint">{item.hint}</span>
            </button>
          ))}
          <div className="menu__foot">
            均线的数字是 K 线根数，不是天数：日线图上的 MA120 是 120 个交易日，15 分图上的 MA120 只有 120 根 15
            分钟线（约 4.6 个交易日），所以会贴着 K 线走。周期可以在设置里修改。
          </div>
        </div>
      )}
    </div>
  );
}
