import { forwardRef, useImperativeHandle, useState } from "react";
import { CoinIcon } from "@/components/common/CoinIcon";
import { isUsMarketOpen } from "@/features/session/us-session";
import { formatCompact, formatPct, formatPrice } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import type { IndicatorValues } from "./indicator-layer";
import {
  TIMEFRAME_LABELS,
  displayName,
  marketTypeLongLabel,
  type Candle,
  type MarketRef,
  type Timeframe,
} from "@/types/market";

export interface LegendValue {
  candle: Candle;
  previousClose?: number;
  indicators?: IndicatorValues;
}

export interface LegendHandle {
  set: (value: LegendValue | null) => void;
}

interface LegendProps {
  market: MarketRef;
  timeframe: Timeframe;
  precision: number;
  /** 美股是否只显示常规交易时段 */
  sessionOnly?: boolean;
  /** 历史部分是否来自官方股价数据 */
  official?: boolean;
}

/**
 * 图表左上角的 OHLC 信息。十字光标移动非常频繁，
 * 所以通过命令式句柄更新，只重渲染这一小块。
 */
export const Legend = forwardRef<LegendHandle, LegendProps>(function Legend(
  { market, timeframe, precision, sessionOnly, official },
  ref,
) {
  const [value, setValue] = useState<LegendValue | null>(null);
  useImperativeHandle(ref, () => ({ set: setValue }), []);

  const c = value?.candle;
  const base = value?.previousClose ?? c?.open;
  const change = c && base ? c.close - base : undefined;
  const changePct = change !== undefined && base ? (change / base) * 100 : undefined;
  const tone = change === undefined ? "" : change >= 0 ? "up" : "down";

  return (
    <div className="pane__legend" data-testid="legend">
      <span className="legend__title">
        <CoinIcon symbol={market.symbol} size={15} />
        {displayName(market)}
        <span className="legend__tf">
          {TIMEFRAME_LABELS[timeframe]} · {marketTypeLongLabel(market)}
          {sessionOnly && <SessionNote official={official === true} />}
        </span>
      </span>
      {c && (
        <>
          <Item label="开" value={formatPrice(c.open, precision)} tone={tone} />
          <Item label="高" value={formatPrice(c.high, precision)} tone={tone} />
          <Item label="低" value={formatPrice(c.low, precision)} tone={tone} />
          <Item label="收" value={formatPrice(c.close, precision)} tone={tone} />
          <span className={`legend__item ${tone}`}>
            {change !== undefined && `${change >= 0 ? "+" : "−"}${formatPrice(Math.abs(change), precision)}`}{" "}
            {changePct !== undefined && `(${formatPct(changePct)})`}
          </span>
          <Item label="量" value={formatCompact(c.volume)} tone="" />
          {value?.indicators?.ma.map((ma) => (
            <span key={ma.period} className="legend__item" data-testid={`legend-ma-${ma.period}`} style={{ color: ma.color }}>
              MA{ma.period} {ma.value === null ? "--" : formatPrice(ma.value, precision)}
            </span>
          ))}
        </>
      )}
    </div>
  );
});

/** 提示当前只显示交易时段；休市时图表不会动，要特别说明，免得以为卡住了 */
function SessionNote({ official }: { official: boolean }) {
  const open = isUsMarketOpen(useNow(30_000));
  return (
    <span
      data-testid="session-note"
      data-open={open}
      title={
        official
          ? "历史 K 线来自官方股价数据，最新一根来自合约的实时价格"
          : "没有取到官方股价数据，全部 K 线来自合约，历史只从合约上线那天开始"
      }
    >
      {" · 仅交易时段"}
      {official && " · 官方历史"}
      {!open && "（休市中）"}
    </span>
  );
}

function Item({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span className="legend__item">
      <span className="legend__label">{label}</span>
      <span className={tone}>{value}</span>
    </span>
  );
}
