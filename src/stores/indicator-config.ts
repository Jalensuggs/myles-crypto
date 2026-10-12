import { useMemo } from "react";
import type { IndicatorConfig } from "@/features/indicators/config";
import { usePreferencesStore } from "./preferences.store";

/** 把偏好里的各个开关和参数组合成图表要用的指标配置 */
export function useIndicatorConfig(): IndicatorConfig {
  const maOn = usePreferencesStore((s) => s.indicatorMa);
  const maPeriods = usePreferencesStore((s) => s.maPeriods);
  const emaOn = usePreferencesStore((s) => s.indicatorEma);
  const emaPeriods = usePreferencesStore((s) => s.emaPeriods);
  const bollOn = usePreferencesStore((s) => s.indicatorBoll);
  const bollParams = usePreferencesStore((s) => s.bollParams);
  const volMaOn = usePreferencesStore((s) => s.indicatorVolMa);
  const volMaPeriods = usePreferencesStore((s) => s.volMaPeriods);
  const macdOn = usePreferencesStore((s) => s.indicatorMacd);
  const macdParams = usePreferencesStore((s) => s.macdParams);
  const kdjOn = usePreferencesStore((s) => s.indicatorKdj);
  const kdjParams = usePreferencesStore((s) => s.kdjParams);
  const rsiOn = usePreferencesStore((s) => s.indicatorRsi);
  const rsiPeriod = usePreferencesStore((s) => s.rsiPeriod);

  return useMemo<IndicatorConfig>(
    () => ({
      ma: maOn ? maPeriods : [],
      ema: emaOn ? emaPeriods : [],
      boll: bollOn ? { period: bollParams[0], multiplier: bollParams[1] } : null,
      volMa: volMaOn ? volMaPeriods : [],
      macd: macdOn ? { fast: macdParams[0], slow: macdParams[1], signal: macdParams[2] } : null,
      kdj: kdjOn ? { period: kdjParams[0], k: kdjParams[1], d: kdjParams[2] } : null,
      rsi: rsiOn ? rsiPeriod : null,
    }),
    [
      maOn,
      maPeriods,
      emaOn,
      emaPeriods,
      bollOn,
      bollParams,
      volMaOn,
      volMaPeriods,
      macdOn,
      macdParams,
      kdjOn,
      kdjParams,
      rsiOn,
      rsiPeriod,
    ],
  );
}
