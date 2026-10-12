import { forwardRef, useEffect, useImperativeHandle, useState, type RefObject } from "react";
import { formatPrice } from "@/lib/format";
import type { ChartBridge } from "./bridge";
import type { IndicatorItem, IndicatorLayer, IndicatorValues, SubPaneId } from "./indicator-layer";

export interface IndicatorLabelsHandle {
  set: (values: IndicatorValues | null) => void;
}

interface IndicatorLabelsProps {
  bridge: ChartBridge;
  layer: RefObject<IndicatorLayer | null>;
  container: RefObject<HTMLDivElement | null>;
}

type Tops = Partial<Record<SubPaneId, number>>;
const PANES: SubPaneId[] = ["macd", "kdj", "rsi"];

function toneOf(item: IndicatorItem): string {
  if (!item.signed) return "";
  return item.value === null ? "muted" : item.value >= 0 ? "up" : "down";
}

/** MACD、KDJ、RSI 副图左上角的文字标签。位置跟着副图走，用户拖动分隔线后也会更新。 */
export const IndicatorLabels = forwardRef<IndicatorLabelsHandle, IndicatorLabelsProps>(function IndicatorLabels(
  { bridge, layer, container },
  ref,
) {
  const [values, setValues] = useState<IndicatorValues | null>(null);
  const [tops, setTops] = useState<Tops>({});
  useImperativeHandle(ref, () => ({ set: setValues }), []);

  useEffect(() => {
    const measure = () => {
      const host = container.current;
      const current = layer.current;
      if (!host || !current) return;
      const base = host.getBoundingClientRect().top;
      const next: Tops = {};
      for (const id of PANES) {
        const el = current.paneElement(id);
        if (el) next[id] = Math.round(el.getBoundingClientRect().top - base);
      }
      setTops((prev) => (PANES.every((id) => prev[id] === next[id]) ? prev : next));
    };
    measure();
    return bridge.onViewChange(measure);
  }, [bridge, layer, container]);

  return (
    <>
      {values?.panes.map((pane) => {
        const top = tops[pane.id];
        if (top === undefined) return null;
        return (
          <div key={pane.id} className="pane__sublabel" data-testid={`indicator-label-${pane.id}`} style={{ top: top + 4 }}>
            <span className="legend__label">{pane.title}</span>
            {pane.items.map((item) => (
              <span key={item.id} className={toneOf(item)} style={item.signed ? undefined : { color: item.color }}>
                {/* 只有一条线的指标（RSI）标题已经说明了是什么，不再重复名称 */}
                {pane.items.length > 1 && `${item.label} `}
                {item.value === null ? "--" : formatPrice(item.value, pane.digits)}
              </span>
            ))}
          </div>
        );
      })}
    </>
  );
});
