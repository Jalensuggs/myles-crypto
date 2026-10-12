import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { CoinIcon } from "@/components/common/CoinIcon";
import { provider } from "@/data";
import { summarizeBigTrades } from "@/features/flow/big-trades";
import { PHASE_LABELS } from "@/features/session/stock-quote";
import { formatCompact, formatCountdown, formatPct, formatPrice, formatUsd, guessPrecision } from "@/lib/format";
import { useStockQuote } from "@/lib/use-stock-quote";
import { useNow } from "@/lib/use-now";
import { selectBigTrades, useFlowStore } from "@/stores/flow.store";
import { useTickersStore } from "@/stores/tickers.store";
import { selectActiveTab, useWorkspaceStore } from "@/stores/workspace.store";
import { baseAsset, categoryOf, displayName, marketKey, marketTypeLabel } from "@/types/market";

const FEAR_GREED_LABELS: Record<string, string> = {
  "Extreme Fear": "极度恐惧",
  Fear: "恐惧",
  Neutral: "中性",
  Greed: "贪婪",
  "Extreme Greed": "极度贪婪",
};

export function MarketOverview() {
  const tab = useWorkspaceStore(selectActiveTab);
  const { market } = tab;
  const key = marketKey(market);
  const isPerp = market.market === "perp";
  const ticker = useTickersStore((s) => s.tickers[key]);
  const storedPrecision = useTickersStore((s) => s.precision[key]);
  const derivatives = useTickersStore((s) => (isPerp ? s.derivatives[market.symbol] : undefined));
  const now = useNow(1000);

  const openInterest = useQuery({
    queryKey: ["open-interest", market.symbol],
    queryFn: ({ signal }) => provider.getOpenInterest(market.symbol, signal),
    enabled: isPerp,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const fearGreed = useQuery({
    queryKey: ["fear-greed"],
    queryFn: ({ signal }) => provider.getFearGreed(signal),
    staleTime: 60 * 60_000,
    refetchInterval: 60 * 60_000,
  });

  const isCrypto = categoryOf(market) === "crypto";
  const bigTradeSelector = useMemo(() => selectBigTrades(key), [key]);
  const bigTradeList = useFlowStore(bigTradeSelector);
  const bigTrades = summarizeBigTrades(bigTradeList, now - 3600_000);
  const bigTradeCount = bigTrades.buyCount + bigTrades.sellCount;
  const precision = storedPrecision ?? (ticker ? guessPrecision(ticker.last) : 2);
  const quote = useStockQuote(market);
  const changePct = quote ? quote.changePct : ticker?.changePct;
  const tone = changePct === undefined ? "muted" : changePct >= 0 ? "up" : "down";
  const phase = quote ? PHASE_LABELS[quote.phase] : "";
  const refDate = quote ? new Date(quote.refTime * 1000) : null;
  const rate = derivatives?.fundingRate;
  const oiValue =
    openInterest.data !== undefined && (derivatives?.markPrice ?? ticker?.last) !== undefined
      ? openInterest.data * (derivatives?.markPrice ?? ticker!.last)
      : undefined;

  return (
    <section className="overview" aria-label="市场概览" data-testid="market-overview">
      <div className="overview__head">
        <CoinIcon symbol={market.symbol} size={20} />
        <span className="overview__name">{displayName(market)}</span>
        <span className="tbtn__tag">{marketTypeLabel(market)}</span>
        <span className={`overview__price ${tone}`}>{formatPrice(ticker?.last, precision)}</span>
      </div>
      <dl className="overview__rows">
        {quote && refDate ? (
          <>
            <dt>{phase ? `${phase}涨跌` : "今日涨跌"}</dt>
            <dd className={tone} data-testid="overview-change">
              {formatPct(quote.changePct)}
            </dd>
            <dt>
              {quote.phase === "open" ? "昨收" : "收盘价"}（{refDate.getUTCMonth() + 1}/{refDate.getUTCDate()}）
            </dt>
            <dd data-testid="overview-ref-close">
              {formatPrice(quote.refClose, precision)}
              {quote.refDayChangePct !== undefined && quote.phase !== "open" && (
                <span className={quote.refDayChangePct >= 0 ? "up" : "down"}> {formatPct(quote.refDayChangePct)}</span>
              )}
            </dd>
          </>
        ) : (
          <>
            <dt>24h 涨跌</dt>
            <dd className={tone}>{formatPct(ticker?.changePct)}</dd>
          </>
        )}
        <dt>24h 最高 / 最低</dt>
        <dd>
          {formatPrice(ticker?.high24h, precision)} / {formatPrice(ticker?.low24h, precision)}
        </dd>
        <dt>24h 成交额</dt>
        <dd>{formatUsd(ticker?.quoteVolume24h, 2)}</dd>
        {isCrypto && (
          <>
            <dt title="最近一小时里大单主动买入减去主动卖出的金额，从打开页面起统计">大单净流入（1 小时）</dt>
            <dd data-testid="overview-big-trades">
              {bigTradeCount === 0 ? (
                <span className="muted">暂无大单</span>
              ) : (
                <>
                  <span className={bigTrades.netUsd >= 0 ? "up" : "down"}>
                    {bigTrades.netUsd >= 0 ? "+" : "−"}
                    {formatUsd(Math.abs(bigTrades.netUsd))}
                  </span>
                  <span className="muted">
                    {" "}
                    · 买 {bigTrades.buyCount} 卖 {bigTrades.sellCount}
                  </span>
                </>
              )}
            </dd>
          </>
        )}
        {isPerp && (
          <>
            <dt>标记价格</dt>
            <dd>{formatPrice(derivatives?.markPrice, precision)}</dd>
            <dt>资金费率</dt>
            <dd>
              <span className={rate === undefined ? "muted" : rate >= 0 ? "up" : "down"}>
                {rate === undefined ? "--" : formatPct(rate * 100, 4)}
              </span>
              {derivatives && <span className="muted"> · {formatCountdown(derivatives.nextFundingTime, now)}</span>}
            </dd>
            <dt>持仓量</dt>
            <dd title={openInterest.isError ? "持仓量加载失败" : undefined}>
              {formatUsd(oiValue, 2)}
              {openInterest.data !== undefined && (
                <span className="muted">
                  {" "}
                  · {formatCompact(openInterest.data)} {baseAsset(market.symbol)}
                </span>
              )}
            </dd>
          </>
        )}
        <dt>恐惧贪婪指数</dt>
        <dd>
          {fearGreed.data ? (
            <span className="gauge">
              <span className="gauge__bar" aria-hidden="true">
                <span className="gauge__pin" style={{ left: `${Math.min(100, Math.max(0, fearGreed.data.value))}%` }} />
              </span>
              {fearGreed.data.value} {FEAR_GREED_LABELS[fearGreed.data.label] ?? fearGreed.data.label}
            </span>
          ) : (
            <span className="muted">{fearGreed.isError ? "暂时无法获取" : "--"}</span>
          )}
        </dd>
      </dl>
      {isPerp && categoryOf(market) !== "crypto" && (
        <p className="overview__note">
          {categoryOf(market) === "stock"
            ? "实时价格来自 24 小时交易的合约，和交易所官方报价会有小幅偏差；涨跌幅以最近一次官方收盘价为基准，历史 K 线用官方股价。"
            : "这是跟踪其价格的永续合约，24 小时交易，和交易所官方报价会有小幅偏差。"}
        </p>
      )}
    </section>
  );
}
