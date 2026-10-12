import { useQuery } from "@tanstack/react-query";
import { Search, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { provider } from "@/data";
import { describeError } from "@/data/binance/provider";
import { formatPct, formatPrice, formatUsd, guessPrecision } from "@/lib/format";
import { useUiStore, type PickerMode } from "@/stores/ui.store";
import { MAX_WATCHLIST } from "@/stores/watchlist.logic";
import { useWatchlistStore } from "@/stores/watchlist.store";
import { MAX_TABS } from "@/stores/workspace.logic";
import { selectActiveTab, useWorkspaceStore } from "@/stores/workspace.store";
import {
  baseAsset,
  categoryOf,
  displayName,
  marketKey,
  marketTypeLabel,
  type MarketRef,
  type SymbolInfo,
} from "@/types/market";
import { CoinIcon } from "./CoinIcon";
import { Dialog } from "./Dialog";

/** 一次最多渲染的行数。美股约 180 个，要能在分类里全部看到。 */
const MAX_ROWS = 300;

type Group = "watch" | "crypto" | "spot" | "stock" | "commodity" | "other";

const GROUPS: { id: Group; label: string }[] = [
  { id: "watch", label: "自选" },
  { id: "crypto", label: "加密合约" },
  { id: "spot", label: "加密现货" },
  { id: "stock", label: "美股" },
  { id: "commodity", label: "商品" },
  { id: "other", label: "其他" },
];

const TITLES: Record<PickerMode, string> = {
  add: "添加标的",
  replace: "切换标的",
  watch: "管理自选",
};

function groupOf(market: MarketRef): Group {
  return market.market === "spot" ? "spot" : categoryOf(market);
}

function refOf(info: SymbolInfo): MarketRef {
  const ref: MarketRef = { exchange: "binance", market: info.market, symbol: info.symbol };
  if (info.category !== "crypto") ref.category = info.category;
  return ref;
}

interface Row {
  ref: MarketRef;
  info?: SymbolInfo;
}

/** 搜索结果排序：代码完全相同的最前，其次是以关键词开头的，再按成交额 */
function rank(info: SymbolInfo, keyword: string): number {
  const base = baseAsset(info.symbol);
  if (base === keyword || info.symbol === keyword) return 0;
  if (base.startsWith(keyword)) return 1;
  return 2;
}

export function SymbolPicker() {
  const mode = useUiStore((s) => s.picker);
  if (mode === null) return null;
  return <PickerContent mode={mode} />;
}

function PickerContent({ mode }: { mode: PickerMode }) {
  const close = useUiStore((s) => s.closePicker);
  const showToast = useUiStore((s) => s.showToast);
  const active = useWorkspaceStore(selectActiveTab);
  const watchlist = useWatchlistStore((s) => s.items);
  const [group, setGroup] = useState<Group>(mode === "watch" ? "watch" : groupOf(active.market));
  const [keyword, setKeyword] = useState("");
  const k = keyword.trim().toUpperCase();

  const perps = useQuery({
    queryKey: ["symbols", "perp"],
    queryFn: ({ signal }) => provider.getSymbols("perp", signal),
    staleTime: 60_000,
  });
  // 现货列表比较大，只在用得到的时候才加载
  const spots = useQuery({
    queryKey: ["symbols", "spot"],
    queryFn: ({ signal }) => provider.getSymbols("spot", signal),
    staleTime: 60_000,
    enabled: group === "spot" || group === "watch" || k !== "",
  });

  const watchedKeys = useMemo(() => new Set(watchlist.map(marketKey)), [watchlist]);

  const rows = useMemo<Row[]>(() => {
    const all = [...(perps.data ?? []), ...(spots.data ?? [])];
    if (k) {
      return all
        .filter((s) => s.symbol.includes(k))
        .sort((a, b) => rank(a, k) - rank(b, k) || b.quoteVolume - a.quoteVolume)
        .slice(0, MAX_ROWS)
        .map((info) => ({ ref: refOf(info), info }));
    }
    if (group === "watch") {
      const byKey = new Map(all.map((info) => [marketKey(refOf(info)), info]));
      return watchlist.map((ref) => ({ ref, info: byKey.get(marketKey(ref)) }));
    }
    return all
      .filter((info) => groupOf(refOf(info)) === group)
      .slice(0, MAX_ROWS)
      .map((info) => ({ ref: refOf(info), info }));
  }, [perps.data, spots.data, k, group, watchlist]);

  const toggleWatch = (ref: MarketRef) => {
    if (useWatchlistStore.getState().toggle(ref) === "full") showToast(`自选最多 ${MAX_WATCHLIST} 个`);
  };

  const choose = (ref: MarketRef) => {
    if (mode === "watch") {
      toggleWatch(ref);
      return;
    }
    const ws = useWorkspaceStore.getState();
    if (mode === "replace") {
      ws.updateTab(active.id, { market: ref });
    } else if (!ws.addTab(ref)) {
      showToast(`最多同时打开 ${MAX_TABS} 个标签`);
      return;
    }
    close();
  };

  const source = group === "spot" && !k ? spots : perps;
  const loading = source.isPending && rows.length === 0;
  const failed = source.isError && rows.length === 0;
  const activeKey = marketKey(active.market);
  const showNote = !k && (group === "stock" || group === "commodity" || group === "other");

  return (
    <Dialog open wide flush title={TITLES[mode]} onClose={close} testId="symbol-picker">
      <div className="picker__search">
        <Search size={15} />
        <input
          data-autofocus
          type="search"
          placeholder="搜索代码，例如 BTC、AAPL、XAU"
          aria-label="搜索标的"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && rows[0]) choose(rows[0].ref);
          }}
        />
      </div>
      <div className="picker__groups" role="tablist" aria-label="标的分类">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            className="chip"
            data-testid={`group-${g.id}`}
            aria-selected={!k && group === g.id}
            onClick={() => {
              setGroup(g.id);
              setKeyword("");
            }}
          >
            {g.label}
            {g.id === "watch" && watchlist.length > 0 && <span className="muted"> {watchlist.length}</span>}
          </button>
        ))}
      </div>
      <div className="picker__list">
        {loading && <div className="picker__state">正在加载标的列表…</div>}
        {failed && (
          <div className="picker__state">
            {describeError(source.error)}
            <div style={{ marginTop: 10 }}>
              <button type="button" className="btn" onClick={() => void source.refetch()}>
                重试
              </button>
            </div>
          </div>
        )}
        {!loading && !failed && rows.length === 0 && (
          <div className="picker__state">
            {k ? "没有找到匹配的标的" : group === "watch" ? "还没有自选。点标的左边的星标就能加入。" : "这个分类下暂时没有标的"}
          </div>
        )}
        {rows.map(({ ref, info }) => {
          const key = marketKey(ref);
          const watched = watchedKeys.has(key);
          const name = displayName(ref);
          return (
            <div key={key} className="picker__row" data-testid="picker-row" data-symbol={name} data-current={key === activeKey}>
              <button
                type="button"
                className="picker__star"
                aria-pressed={watched}
                aria-label={watched ? `把 ${name} 移出自选` : `把 ${name} 加入自选`}
                title={watched ? "移出自选" : "加入自选"}
                onClick={() => toggleWatch(ref)}
              >
                <Star size={15} fill={watched ? "currentColor" : "none"} />
              </button>
              <button type="button" className="picker__main" onClick={() => choose(ref)}>
                <CoinIcon symbol={ref.symbol} size={20} />
                <span className="picker__name">
                  {name}
                  <span className="tbtn__tag">{marketTypeLabel(ref)}</span>
                </span>
                <span>{info ? formatPrice(info.last, guessPrecision(info.last)) : "--"}</span>
                <span className={!info ? "muted" : info.changePct >= 0 ? "up" : "down"}>{formatPct(info?.changePct)}</span>
                <span className="muted">{formatUsd(info?.quoteVolume)}</span>
              </button>
            </div>
          );
        })}
      </div>
      {showNote && (
        <div className="picker__note">这里的美股、商品是跟踪其价格的永续合约，24 小时交易，价格和交易所官方报价会有小幅偏差。</div>
      )}
    </Dialog>
  );
}
