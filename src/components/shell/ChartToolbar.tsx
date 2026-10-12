import {
  Bell,
  Camera,
  ChartArea,
  ChartCandlestick,
  ChartLine,
  ChartNoAxesColumn,
  ChevronDown,
  Clock,
  Cloud,
  Columns2,
  Grid2x2,
  Maximize,
  Minimize,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  Square,
  Star,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { screenshotRegistry } from "@/components/chart/bridge";
import { CoinIcon } from "@/components/common/CoinIcon";
import { Menu, type MenuOption } from "@/components/common/Menu";
import { USE_MOCK } from "@/data";
import { overallStatus, useConnectionStore, type OverallStatus } from "@/stores/connection.store";
import { usePreferencesStore } from "@/stores/preferences.store";
import { useUiStore } from "@/stores/ui.store";
import { IndicatorMenu } from "./IndicatorMenu";
import { useDock } from "./use-dock";
import { MAX_WATCHLIST, isWatched } from "@/stores/watchlist.logic";
import { useWatchlistStore } from "@/stores/watchlist.store";
import type { LayoutMode } from "@/stores/workspace.logic";
import { selectActiveTab, useWorkspaceStore } from "@/stores/workspace.store";
import {
  CHART_TYPE_LABELS,
  categoryOf,
  TIMEFRAMES,
  TIMEFRAME_LABELS,
  displayName,
  marketTypeLabel,
  type ChartType,
} from "@/types/market";

const CHART_ICONS: Record<ChartType, ReactNode> = {
  candles: <ChartCandlestick size={15} />,
  bars: <ChartNoAxesColumn size={15} />,
  line: <ChartLine size={15} />,
  area: <ChartArea size={15} />,
};

const CHART_OPTIONS: MenuOption<ChartType>[] = (Object.keys(CHART_TYPE_LABELS) as ChartType[]).map((value) => ({
  value,
  label: CHART_TYPE_LABELS[value],
  icon: CHART_ICONS[value],
}));

const LAYOUTS: { value: LayoutMode; label: string; icon: ReactNode }[] = [
  { value: 1, label: "单图", icon: <Square size={15} /> },
  { value: 2, label: "双图", icon: <Columns2 size={15} /> },
  { value: 4, label: "四图", icon: <Grid2x2 size={15} /> },
];

const STATUS_TEXT: Record<OverallStatus, string> = {
  open: "实时连接正常",
  connecting: "正在连接…",
  reconnecting: "连接中断，正在重连…",
  idle: "未连接",
};

function timestampForFile(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function ChartToolbar() {
  const tab = useWorkspaceStore(selectActiveTab);
  const layout = useWorkspaceStore((s) => s.layout);
  const focused = useWorkspaceStore((s) => s.focused);
  const status = useConnectionStore((s) => overallStatus(s.status));
  const { open: dockOpen, setOpen: setDockOpen } = useDock();
  const openPicker = useUiStore((s) => s.openPicker);
  const showToast = useUiStore((s) => s.showToast);
  const requireAuth = useUiStore((s) => s.requireAuth);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const sessionOnly = usePreferencesStore((s) => s.stockSessionOnly);
  const isStock = categoryOf(tab.market) === "stock";
  const watched = useWatchlistStore((s) => isWatched(s.items, tab.market));
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const update = useWorkspaceStore.getState().updateTab;
  const name = displayName(tab.market);

  const takeScreenshot = () => {
    const canvas = screenshotRegistry.get(focused)?.();
    if (!canvas) {
      showToast("图表还没准备好，稍后再试");
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        showToast("截图失败");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `myles-crypto-${name}-${tab.timeframe}-${timestampForFile()}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("截图已保存到下载文件夹");
    }, "image/png");
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => showToast("当前浏览器不允许全屏"));
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="图表控制" data-testid="chart-toolbar">
      <button
        type="button"
        className="tbtn tbtn--symbol"
        data-testid="symbol-button"
        aria-label={`当前标的 ${name}，点击切换`}
        title="切换标的"
        onClick={() => openPicker("replace")}
      >
        <CoinIcon symbol={tab.market.symbol} />
        {name}
        <span className="tbtn__tag">{marketTypeLabel(tab.market)}</span>
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        className="tbtn tbtn--icon"
        data-testid="watch-toggle"
        data-active={watched}
        aria-pressed={watched}
        aria-label={watched ? `把 ${name} 移出自选` : `把 ${name} 加入自选`}
        title={watched ? "移出自选" : "加入自选"}
        onClick={() => {
          const change = useWatchlistStore.getState().toggle(tab.market);
          if (change === "full") showToast(`自选最多 ${MAX_WATCHLIST} 个`);
          else showToast(change === "added" ? `已把 ${name} 加入自选` : `已把 ${name} 移出自选`);
        }}
      >
        <Star size={16} fill={watched ? "currentColor" : "none"} />
      </button>

      <span className="toolbar__sep" />

      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          type="button"
          className="tbtn"
          data-testid={`tf-${tf}`}
          data-active={tab.timeframe === tf}
          aria-pressed={tab.timeframe === tf}
          title={`周期 ${TIMEFRAME_LABELS[tf]}`}
          onClick={() => update(tab.id, { timeframe: tf })}
        >
          {TIMEFRAME_LABELS[tf]}
        </button>
      ))}

      <span className="toolbar__sep" />

      <Menu label="图表类型" value={tab.chartType} options={CHART_OPTIONS} onChange={(v) => update(tab.id, { chartType: v })}>
        {CHART_ICONS[tab.chartType]}
        {CHART_TYPE_LABELS[tab.chartType]}
        <ChevronDown size={14} />
      </Menu>

      <IndicatorMenu />

      {isStock && (
        <button
          type="button"
          className="tbtn"
          data-testid="session-toggle"
          data-active={sessionOnly}
          aria-pressed={sessionOnly}
          aria-label="美股只显示常规交易时段"
          title={
            sessionOnly
              ? "现在只显示美东 9:30–16:00 的 K 线，均线和股票软件接近。点击改为显示 24 小时"
              : "现在显示合约 24 小时的全部 K 线。点击改为只显示美股交易时段"
          }
          onClick={() => usePreferencesStore.getState().update({ stockSessionOnly: !sessionOnly })}
        >
          <Clock size={15} />
          {sessionOnly ? "交易时段" : "24 小时"}
        </button>
      )}

      <span className="toolbar__sep" />

      {LAYOUTS.map((item) => (
        <button
          key={item.value}
          type="button"
          className="tbtn tbtn--icon"
          data-testid={`layout-${item.value}`}
          data-active={layout === item.value}
          aria-pressed={layout === item.value}
          aria-label={`${item.label}布局`}
          title={`${item.label}布局`}
          onClick={() => useWorkspaceStore.getState().setLayout(item.value)}
        >
          {item.icon}
        </button>
      ))}

      <span className="toolbar__spacer" />

      {USE_MOCK && (
        <span className="badge-mock" data-testid="mock-badge" title="当前显示的不是真实行情">
          模拟数据
        </span>
      )}
      <span className="status" data-state={status} data-testid="connection-status" role="status">
        <span className="status__dot" />
        {STATUS_TEXT[status]}
      </span>

      <span className="toolbar__sep" />

      <button type="button" className="tbtn tbtn--icon" aria-label="截图" title="保存图表截图" onClick={takeScreenshot}>
        <Camera size={16} />
      </button>
      <button
        type="button"
        className="tbtn tbtn--icon"
        aria-label="价格提醒"
        title="价格提醒"
        data-testid="alert-button"
        onClick={() => requireAuth("价格提醒")}
      >
        <Bell size={16} />
      </button>
      <button
        type="button"
        className="tbtn tbtn--icon"
        aria-label="云端同步"
        title="云端同步"
        onClick={() => requireAuth("云端同步")}
      >
        <Cloud size={16} />
      </button>
      <button
        type="button"
        className="tbtn tbtn--icon"
        aria-label={fullscreen ? "退出全屏" : "全屏"}
        title={fullscreen ? "退出全屏" : "全屏"}
        onClick={toggleFullscreen}
      >
        {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
      </button>
      <button
        type="button"
        className="tbtn tbtn--icon"
        aria-label="设置"
        title="设置"
        data-testid="settings-button"
        onClick={() => setSettingsOpen(true)}
      >
        <Settings size={16} />
      </button>
      <button
        type="button"
        className="tbtn tbtn--icon"
        aria-label={dockOpen ? "收起右侧栏" : "展开右侧栏"}
        aria-pressed={dockOpen}
        title={dockOpen ? "收起右侧栏" : "展开右侧栏"}
        data-testid="dock-toggle"
        onClick={() => setDockOpen(!dockOpen)}
      >
        {dockOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
      </button>
    </div>
  );
}
