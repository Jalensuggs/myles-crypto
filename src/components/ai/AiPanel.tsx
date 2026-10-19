import { useQuery } from "@tanstack/react-query";
import { Loader2, Sparkles, Square } from "lucide-react";
import { useCallback, useMemo } from "react";
import { paneDataFor } from "@/components/chart/bridge";
import { provider, queryClient } from "@/data";
import { fetchModels } from "@/data/ai/client";
import { summarizeBigTrades } from "@/features/flow/big-trades";
import { earliestBucketTime, sumLiquidations } from "@/features/flow/liquidation-buckets";
import { PHASE_LABELS } from "@/features/session/stock-quote";
import { buildSnapshot } from "@/features/ai/snapshot";
import { DIRECTION_LABELS, type Verdict } from "@/features/ai/verdict";
import { formatPrice, formatRelativeTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { useStockQuote } from "@/lib/use-stock-quote";
import { useAiStore } from "@/stores/ai.store";
import { selectBigTrades, selectLiquidations, useFlowStore } from "@/stores/flow.store";
import { usePreferencesStore } from "@/stores/preferences.store";
import { useTickersStore } from "@/stores/tickers.store";
import { selectActiveTab, useWorkspaceStore } from "@/stores/workspace.store";
import {
  TIMEFRAME_LABELS,
  categoryOf,
  displayName,
  marketKey,
  marketTypeLongLabel,
} from "@/types/market";

const HOUR_MS = 3600_000;
const DAY_SECONDS = 86_400;

/** 正文里模型可能写了 markdown 的记号，显示时去掉 */
function clean(text: string): string[] {
  return text
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function riskReward(verdict: Verdict): number | null {
  const risk = Math.abs(verdict.entry - verdict.stop);
  const reward = Math.abs(verdict.targets[0]! - verdict.entry);
  return risk > 0 ? reward / risk : null;
}

export function AiPanel() {
  const tab = useWorkspaceStore(selectActiveTab);
  const { market, timeframe } = tab;
  const key = marketKey(market);
  const now = useNow(10_000);

  const model = usePreferencesStore((s) => s.aiModel);
  const effort = usePreferencesStore((s) => s.aiEffort);
  const drawLines = usePreferencesStore((s) => s.aiLines);
  const maPeriods = usePreferencesStore((s) => s.maPeriods);

  const status = useAiStore((s) => s.status);
  const pending = useAiStore((s) => s.pending);
  const thinking = useAiStore((s) => s.thinking);
  const error = useAiStore((s) => s.error);
  const result = useAiStore((s) => s.results[key]);
  const busy = (status === "waiting" || status === "streaming") && pending === key;
  const otherBusy = (status === "waiting" || status === "streaming") && pending !== key;

  const ticker = useTickersStore((s) => s.tickers[key]);
  const precision = useTickersStore((s) => s.precision[key]) ?? 2;
  const derivatives = useTickersStore((s) => s.derivatives[market.symbol]);
  const bigTradeSelector = useMemo(() => selectBigTrades(key), [key]);
  const bigTradeList = useFlowStore(bigTradeSelector);
  const liquidationSelector = useMemo(() => selectLiquidations(market.symbol), [market.symbol]);
  const buckets = useFlowStore(liquidationSelector);
  const quote = useStockQuote(market);

  // 模拟数据模式下不调用模型：那个模式的意义就是完全不访问外网
  const mock = provider.isMock;
  const catalog = useQuery({
    queryKey: ["ai-models"],
    queryFn: ({ signal }) => fetchModels(signal),
    enabled: !mock,
    staleTime: 10 * 60_000,
    retry: 0,
  });

  const analyze = useCallback(async () => {
    const pane = paneDataFor(tab.id);
    const candles = pane?.candles() ?? [];
    const price = ticker?.last ?? candles[candles.length - 1]?.close;
    if (candles.length < 30 || !price) return;

    const isCrypto = categoryOf(market) === "crypto";
    const notes: string[] = [];
    if (quote) notes.push(`这是美股，当前是${PHASE_LABELS[quote.phase] || "交易时段"}，历史 K 线用官方数据`);
    if (market.market === "spot" && isCrypto) notes.push("资金面数据来自同一个币的永续合约");

    const nowMs = Date.now();
    const flow: Parameters<typeof buildSnapshot>[0]["flow"] = {};
    if (isCrypto) {
      const trades = summarizeBigTrades(bigTradeList, nowMs - HOUR_MS);
      if (trades.buyCount + trades.sellCount > 0) {
        flow.bigTrades1h = {
          buyUsd: trades.buyUsd,
          sellUsd: trades.sellUsd,
          netUsd: trades.netUsd,
          count: trades.buyCount + trades.sellCount,
        };
      }
      const since = earliestBucketTime(buckets);
      if (since !== null) {
        const liq = sumLiquidations(buckets, nowMs / 1000 - DAY_SECONDS, nowMs / 1000);
        flow.liquidation24h = liq;
        flow.liquidationSince = since;
        notes.push("爆仓数据只从页面打开后开始统计，不是全天完整数据");
      }
      if (derivatives) flow.fundingRate = derivatives.fundingRate;

      const history = await queryClient
        .fetchQuery({
          queryKey: ["oi-history", market.symbol, "1h"],
          queryFn: ({ signal }) => provider.getOpenInterestHistory(market.symbol, "1h", signal),
          staleTime: 5 * 60_000,
          retry: 0,
        })
        .catch(() => null);
      if (history && history.length > 1) {
        const last = history[history.length - 1]!;
        const ago = history[Math.max(0, history.length - 25)]!;
        flow.openInterest = last.value;
        if (ago.value > 0) flow.oiChangePct = ((last.value - ago.value) / ago.value) * 100;
      }
    }

    const snapshot = buildSnapshot({
      name: displayName(market),
      kind: marketTypeLongLabel(market),
      category: categoryOf(market),
      timeframe,
      timeframeLabel: TIMEFRAME_LABELS[timeframe],
      candles,
      price,
      precision,
      maPeriods,
      ...(ticker
        ? {
            day: {
              changePct: ticker.changePct,
              high: ticker.high24h,
              low: ticker.low24h,
              quoteVolume: ticker.quoteVolume24h,
            },
          }
        : {}),
      ...(Object.keys(flow).length > 0 ? { flow } : {}),
      notes,
      now: nowMs,
    });

    await useAiStore.getState().run(
      {
        key,
        name: displayName(market),
        timeframe,
        price,
        precision,
        model: model || catalog.data?.default || "",
        at: nowMs,
      },
      snapshot,
      effort,
    );
  }, [
    bigTradeList,
    buckets,
    catalog.data,
    derivatives,
    effort,
    key,
    maPeriods,
    market,
    model,
    precision,
    quote,
    tab.id,
    ticker,
    timeframe,
  ]);

  const verdict = result?.verdict;
  const ratio = verdict ? riskReward(verdict) : null;
  const unavailable = mock || catalog.isError;

  return (
    <section className="ai" aria-label="AI 交易信号" data-testid="ai-panel">
      <div className="ai__bar">
        <select
          className="ai__model"
          aria-label="选择模型"
          data-testid="ai-model"
          value={model}
          onChange={(e) => usePreferencesStore.getState().update({ aiModel: e.target.value })}
        >
          <option value="">默认模型{catalog.data?.default ? `（${catalog.data.default}）` : ""}</option>
          {(catalog.data?.models ?? []).map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <div className="segmented ai__effort" role="group" aria-label="思考档位">
          <button
            type="button"
            aria-pressed={effort === "low"}
            onClick={() => usePreferencesStore.getState().update({ aiEffort: "low" })}
          >
            快
          </button>
          <button
            type="button"
            aria-pressed={effort === "high"}
            onClick={() => usePreferencesStore.getState().update({ aiEffort: "high" })}
          >
            细
          </button>
        </div>
      </div>

      {busy ? (
        <button type="button" className="btn btn--sm ai__run" onClick={() => useAiStore.getState().stop()}>
          <Square size={13} /> 停止
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--primary btn--sm ai__run"
          data-testid="ai-run"
          disabled={unavailable || otherBusy}
          onClick={() => void analyze()}
        >
          <Sparkles size={13} /> 分析 {displayName(market)} {TIMEFRAME_LABELS[timeframe]}
        </button>
      )}

      {unavailable && (
        <p className="ai__hint" data-testid="ai-unavailable">
          {mock ? "当前是模拟数据模式，不调用模型。" : "服务端还没有配置模型网关，AI 分析暂时用不了。"}
        </p>
      )}
      {otherBusy && !busy && <p className="ai__hint">正在分析另一个标的，等它结束再试。</p>}
      {busy && (
        <p className="ai__hint ai__hint--busy">
          <Loader2 size={13} className="spin" />
          {thinking ? "模型正在思考……" : status === "waiting" ? "正在连接模型……" : "正在输出……"}
        </p>
      )}
      {status === "error" && pending === null && error && !busy && (
        <p className="ai__hint ai__hint--error" data-testid="ai-error">
          {error}
        </p>
      )}

      {result && (
        <div className="ai__result" data-testid="ai-result">
          <div className="ai__meta">
            <span>
              {result.name} {TIMEFRAME_LABELS[result.timeframe]} · {formatPrice(result.price, result.precision)}
            </span>
            <span className="muted">
              {formatRelativeTime(result.at, now)}
              {result.model ? ` · ${result.model}` : ""}
            </span>
          </div>

          {verdict && (
            <div className="ai__verdict" data-direction={verdict.direction} data-testid="ai-verdict">
              <div className="ai__call">
                <strong>{DIRECTION_LABELS[verdict.direction]}</strong>
                <span className="ai__confidence">把握 {Math.round(verdict.confidence)}%</span>
              </div>
              <dl className="ai__levels">
                <dt>入场</dt>
                <dd data-testid="ai-entry">{formatPrice(verdict.entry, result.precision)}</dd>
                <dt>止损</dt>
                <dd className="down">{formatPrice(verdict.stop, result.precision)}</dd>
                <dt>目标</dt>
                <dd className="up">
                  {verdict.targets.map((t) => formatPrice(t, result.precision)).join(" → ")}
                </dd>
                {ratio !== null && (
                  <>
                    <dt title="目标价赚的钱是止损亏的钱的几倍">盈亏比</dt>
                    <dd>{ratio.toFixed(2)} : 1</dd>
                  </>
                )}
                {verdict.horizon && (
                  <>
                    <dt>持有</dt>
                    <dd>{verdict.horizon}</dd>
                  </>
                )}
              </dl>
              {verdict.invalidation && <p className="ai__invalid">看错的信号：{verdict.invalidation}</p>}
              {drawLines && <p className="ai__drawn">这三个价位已经画到图上</p>}
            </div>
          )}

          {result.issues.length > 0 && (
            <ul className="ai__issues" data-testid="ai-issues">
              {result.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}

          {result.text && (
            <div className="ai__text">
              {clean(result.text).map((line, i) => (
                <p key={`${i}-${line.slice(0, 8)}`}>{line}</p>
              ))}
            </div>
          )}

          {!busy && (
            <button
              type="button"
              className="btn btn--ghost btn--sm ai__clear"
              onClick={() => useAiStore.getState().clear(key)}
            >
              清除
            </button>
          )}
        </div>
      )}

      {!result && !busy && !unavailable && (
        <p className="ai__hint">
          读取当前图上的 K 线、指标、支撑阻力{categoryOf(market) === "crypto" ? "和资金面数据" : ""}，
          让模型给出方向、入场、止损和目标价。
        </p>
      )}
    </section>
  );
}
