import { Plus, X } from "lucide-react";
import { memo } from "react";
import { CoinIcon } from "@/components/common/CoinIcon";
import { PHASE_LABELS } from "@/features/session/stock-quote";
import { formatPct, formatPrice, guessPrecision } from "@/lib/format";
import { useStockQuote } from "@/lib/use-stock-quote";
import { useTickersStore } from "@/stores/tickers.store";
import { useUiStore } from "@/stores/ui.store";
import { useWatchlistStore } from "@/stores/watchlist.store";
import { selectActiveTab, useWorkspaceStore } from "@/stores/workspace.store";
import { displayName, marketKey, marketTypeLabel, type MarketRef } from "@/types/market";

/** 在图表里打开一个标的：已有标签就切过去，标签满了就替换当前标签 */
function openMarket(market: MarketRef) {
  const ws = useWorkspaceStore.getState();
  if (ws.addTab(market)) return;
  ws.updateTab(selectActiveTab(ws).id, { market });
  useUiStore.getState().showToast("标签已满，已在当前标签里打开");
}

export function WatchList() {
  const items = useWatchlistStore((s) => s.items);
  const activeKey = marketKey(useWorkspaceStore(selectActiveTab).market);
  const openPicker = useUiStore((s) => s.openPicker);

  return (
    <section className="watch" aria-label="自选" data-testid="watchlist">
      {items.length === 0 ? (
        <div className="feed__empty">
          还没有自选。
          <br />
          点下面的按钮，或在搜索里点标的左边的星标。
        </div>
      ) : (
        <ul className="feed__list">
          {items.map((market) => (
            <WatchRow key={marketKey(market)} market={market} active={marketKey(market) === activeKey} />
          ))}
        </ul>
      )}
      <button type="button" className="watch__add" data-testid="watch-add" onClick={() => openPicker("watch")}>
        <Plus size={14} />
        添加自选
      </button>
    </section>
  );
}

/** 每一行只订阅自己的行情 */
const WatchRow = memo(function WatchRow({ market, active }: { market: MarketRef; active: boolean }) {
  const key = marketKey(market);
  const ticker = useTickersStore((s) => s.tickers[key]);
  const precision = useTickersStore((s) => s.precision[key]);
  const name = displayName(market);
  const digits = precision ?? (ticker ? guessPrecision(ticker.last) : 2);
  const quote = useStockQuote(market);
  const changePct = quote ? quote.changePct : ticker?.changePct;
  const phase = quote ? PHASE_LABELS[quote.phase] : "";
  const tone = changePct === undefined ? "muted" : changePct >= 0 ? "up" : "down";

  return (
    <li className="watch__row" data-testid="watch-row" data-symbol={name} data-active={active}>
      <button type="button" className="watch__main" aria-label={`打开 ${name}`} onClick={() => openMarket(market)}>
        <CoinIcon symbol={market.symbol} size={18} />
        <span className="watch__name">
          {name}
          {/* 加密永续合约的名称已经带 .P，不再重复标注 */}
          {!name.endsWith(".P") && <span className="tbtn__tag">{marketTypeLabel(market)}</span>}
        </span>
        <span>{formatPrice(ticker?.last, digits)}</span>
        <span className={`watch__pct ${tone}`} title={phase ? `${phase}，相对最近一次收盘价` : undefined}>
          {formatPct(changePct)}
        </span>
      </button>
      <button
        type="button"
        className="watch__remove"
        aria-label={`把 ${name} 移出自选`}
        title="移出自选"
        onClick={() => useWatchlistStore.getState().toggle(market)}
      >
        <X size={13} />
      </button>
    </li>
  );
});
