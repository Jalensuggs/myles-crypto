import { forwardRef, useEffect, useImperativeHandle, useState, type RefObject } from "react";
import { MACD_DEA_COLOR, MACD_DIF_COLOR, MACD_PARAMS, RSI_COLOR, RSI_PERIOD } from "@/features/indicators/config";
import { formatPrice } from "@/lib/format";
import type { ChartBridge } from "./bridge";
import type { IndicatorLayer, IndicatorValues } from "./indicator-layer";

export interface IndicatorLabelsHandle {
  set: (values: IndicatorValues | null) => void;
}

interface IndicatorLabelsProps {
  bridge: ChartBridge;
  layer: RefObject<IndicatorLayer | null>;
  container: RefObject<HTMLDivElement | null>;
  precision: number;
}

interface Tops {
  macd: number | null;
  rsi: number | null;
}

/** MACD 和 RSI 副图左上角的文字标签。位置跟着副图走，用户拖动分隔线后也会更新。 */
export const IndicatorLabels = forwardRef<IndicatorLabelsHandle, IndicatorLabelsProps>(function IndicatorLabels(
  { bridge, layer, container, precision },
  ref,
) {
  const [values, setValues] = useState<IndicatorValues | null>(null);
  const [tops, setTops] = useState<Tops>({ macd: null, rsi: null });
  useImperativeHandle(ref, () => ({ set: setValues }), []);

  useEffect(() => {
    const measure = () => {
      const host = container.current;
      const current = layer.current;
      if (!host || !current) return;
      const base = host.getBoundingClientRect().top;
      const topOf = (kind: "macd" | "rsi") => {
        const el = current.paneElement(kind);
        return el ? Math.round(el.getBoundingClientRect().top - base) : null;
      };
      const next = { macd: topOf("macd"), rsi: topOf("rsi") };
      setTops((prev) => (prev.macd === next.macd && prev.rsi === next.rsi ? prev : next));
    };
    measure();
    return bridge.onViewChange(measure);
  }, [bridge, layer, container]);

  const macdDigits = Math.min(8, precision + 1);
  const number = (value: number | null | undefined, digits: number) =>
    value === null || value === undefined ? "--" : formatPrice(value, digits);

  return (
    <>
      {tops.macd !== null && values?.macd && (
        <div className="pane__sublabel" data-testid="indicator-label-macd" style={{ top: tops.macd + 4 }}>
          <span className="legend__label">
            MACD({MACD_PARAMS.fast},{MACD_PARAMS.slow},{MACD_PARAMS.signal})
          </span>
          <span style={{ color: MACD_DIF_COLOR }}>DIF {number(values.macd.dif, macdDigits)}</span>
          <span style={{ color: MACD_DEA_COLOR }}>DEA {number(values.macd.dea, macdDigits)}</span>
          <span className={values.macd.hist === null ? "muted" : values.macd.hist >= 0 ? "up" : "down"}>
            MACD {number(values.macd.hist, macdDigits)}
          </span>
        </div>
      )}
      {tops.rsi !== null && values && values.rsi !== undefined && (
        <div className="pane__sublabel" data-testid="indicator-label-rsi" style={{ top: tops.rsi + 4 }}>
          <span className="legend__label">RSI({RSI_PERIOD})</span>
          <span style={{ color: RSI_COLOR }}>{number(values.rsi, 2)}</span>
        </div>
      )}
    </>
  );
});
