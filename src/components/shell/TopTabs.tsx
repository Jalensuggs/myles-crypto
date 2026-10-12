import { Plus, TrendingUp, X } from "lucide-react";
import { memo } from "react";
import { CoinIcon } from "@/components/common/CoinIcon";
import { PHASE_LABELS } from "@/features/session/stock-quote";
import { formatPct, formatPrice, guessPrecision } from "@/lib/format";
import { useStockQuote } from "@/lib/use-stock-quote";
import { useTickersStore } from "@/stores/tickers.store";
import { useUiStore } from "@/stores/ui.store";
import { MAX_TABS } from "@/stores/workspace.logic";
import { selectActiveTabId, useWorkspaceStore } from "@/stores/workspace.store";
import { displayName, marketKey, type MarketTab } from "@/types/market";

export function TopTabs() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const panes = useWorkspaceStore((s) => s.panes);
  const activeId = useWorkspaceStore(selectActiveTabId);
  const openPicker = useUiStore((s) => s.openPicker);
  const full = tabs.length >= MAX_TABS;

  return (
    <nav className="tabs" aria-label="标的标签" data-testid="top-tabs">
      <div className="brand">
        <TrendingUp size={16} strokeWidth={2.6} />
        <span>Myles crypto</span>
      </div>
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          active={tab.id === activeId}
          shown={panes.includes(tab.id)}
          closable={tabs.length > 1}
        />
      ))}
      <button
        type="button"
        className="tab-add"
        data-testid="tab-add"
        disabled={full}
        aria-label={full ? `最多 ${MAX_TABS} 个标签` : "添加标的"}
        title={full ? `最多同时打开 ${MAX_TABS} 个标签` : "添加标的"}
        onClick={() => openPicker("add")}
      >
        <Plus size={16} />
      </button>
      <div className="tabs__count" data-testid="tab-count">
        {tabs.length} / {MAX_TABS}
      </div>
    </nav>
  );
}

interface TabItemProps {
  tab: MarketTab;
  active: boolean;
  shown: boolean;
  closable: boolean;
}

/** 每个标签只订阅自己的行情，价格跳动时不会带动其他标签重渲染 */
const TabItem = memo(function TabItem({ tab, active, shown, closable }: TabItemProps) {
  const key = marketKey(tab.market);
  const ticker = useTickersStore((s) => s.tickers[key]);
  const precision = useTickersStore((s) => s.precision[key]);
  const name = displayName(tab.market);
  const digits = precision ?? (ticker ? guessPrecision(ticker.last) : 2);
  // 美股显示相对收盘价的涨跌幅，并标出盘前、盘后或休市；其他标的显示 24 小时涨跌幅
  const quote = useStockQuote(tab.market);
  const changePct = quote ? quote.changePct : ticker?.changePct;
  const phase = quote ? PHASE_LABELS[quote.phase] : "";
  const tone = changePct === undefined ? "muted" : changePct >= 0 ? "up" : "down";

  return (
    <div className="tab" data-testid="tab" data-symbol={name} data-active={active} data-shown={shown}>
      <button
        type="button"
        className="tab__main"
        aria-current={active ? "page" : undefined}
        aria-label={`切换到 ${name}`}
        onClick={() => useWorkspaceStore.getState().activate(tab.id)}
      >
        <CoinIcon symbol={tab.market.symbol} />
        <span className="tab__name">{name}</span>
        <span className="tab__price">{formatPrice(ticker?.last, digits)}</span>
        <span className={`tab__pct ${tone}`}>{formatPct(changePct)}</span>
        {phase && (
          <span className="phase" data-testid="tab-phase">
            {phase}
          </span>
        )}
      </button>
      {closable && (
        <button
          type="button"
          className="tab__close"
          aria-label={`关闭 ${name}`}
          title="关闭"
          onClick={() => useWorkspaceStore.getState().closeTab(tab.id)}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
});
