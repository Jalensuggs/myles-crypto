import {
  HistogramSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type ISeriesPrimitive,
  type LogicalRange,
  type MouseEventParams,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import { ChevronsRight } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { DrawingLayer } from "@/components/drawing/DrawingLayer";
import { fetchCandlePage, fetchOfficialHistory, hasPerpContract, provider } from "@/data";
import { KLINE_PAGE_SIZE, supportsOpenInterestHistory } from "@/data/binance/endpoints";
import { describeError } from "@/data/binance/provider";
import { loadLatest, loadOlder, type LoaderOptions, type PageFetcher } from "@/data/candle-loader";
import { mergeCandle, mergeCandleLists } from "@/data/candles";
import {
  aggregateLast,
  aggregateSession,
  regroupCalendar,
  regroupCalendarLast,
  sessionPlan,
} from "@/features/session/aggregate";
import { matchesContract, mergeOfficial } from "@/features/session/official";
import { earliestBucketTime, sumLiquidations } from "@/features/flow/liquidation-buckets";
import { isUsRegularSession } from "@/features/session/us-session";
import { useAiStore } from "@/stores/ai.store";
import { useDrawingsStore } from "@/stores/drawings.store";
import { useFlowStore } from "@/stores/flow.store";
import { useIndicatorConfig } from "@/stores/indicator-config";
import { trendColors, usePreferencesStore, type TrendColors } from "@/stores/preferences.store";
import { useTickersStore } from "@/stores/tickers.store";
import { useWorkspaceStore } from "@/stores/workspace.store";
import {
  TIMEFRAME_LABELS,
  TIMEFRAME_SECONDS,
  categoryOf,
  displayName,
  marketKey,
  type Candle,
  type ChartType,
  type MarketTab,
  type Timeframe,
} from "@/types/market";
import { paneDataRegistry, screenshotRegistry, type ChartBridge, type OverlayPainter } from "./bridge";
import { barIndexAt, publishCrosshair, subscribeCrosshair } from "./crosshair-sync";
import {
  FONT_FAMILY,
  applySeriesStyle,
  chartOptions,
  chartTimeOffset,
  createMainSeries,
  toMainData,
  toMainPoint,
  toVolumeData,
  toVolumePoint,
} from "./chart-theme";
import { IndicatorLabels, type IndicatorLabelsHandle } from "./IndicatorLabels";
import { IndicatorLayer } from "./indicator-layer";
import { Legend, type LegendHandle } from "./Legend";

interface ChartPaneProps {
  tab: MarketTab;
  index: number;
  focused: boolean;
  multi: boolean;
}

/** 回调里需要读到的最新值。放在 ref 里，避免为了它们重建图表或重订数据。 */
interface LiveState {
  chartType: ChartType;
  colors: TrendColors;
  precision: number;
  /** 图表时间相对真实时间的偏移（秒） */
  offset: number;
  stepSeconds: number;
  /** 当前图表上实际显示的数据属于哪个标的和周期 */
  shown: string;
  title: string;
  token: number;
  /** 已取到的最早一根原始 K 线的时间，过滤掉的也算，用来继续往前翻页 */
  oldestRaw: number | null;
  hasMore: boolean;
  loadingMore: boolean;
  hovering: boolean;
}

const INITIAL_VISIBLE_BARS = 140;
const LOAD_MORE_MARGIN = 20;
/** 只看交易时段时，首屏至少凑够这么多根，够画出最长的那条均线 */
const MIN_SESSION_BARS = 300;
const MAX_INITIAL_PAGES = 8;
/** 合成的周期（1 时、4 时、1 日）需要更多原始 K 线，允许多翻几页 */
const MAX_INITIAL_PAGES_GROUPED = 12;
const SESSION_SECONDS = 6.5 * 3600;
/** 一根 K 线走完后等这么久再去取官方数据，给对方留出发布的时间 */
const OFFICIAL_REFRESH_DELAY_MS = 20_000;
/** 两次补取之间至少间隔这么久 */
const OFFICIAL_REFRESH_MIN_GAP_MS = 60_000;
const OPEN_INTEREST_REFRESH_MS = 30_000;
const MIN_MORE_BARS = 100;
const MAX_MORE_PAGES = 5;

export const ChartPane = memo(function ChartPane({ tab, index, focused, multi }: ChartPaneProps) {
  const { market, timeframe, chartType } = tab;
  const key = marketKey(market);
  const upColor = usePreferencesStore((s) => s.upColor);
  const colors = useMemo(() => trendColors(upColor), [upColor]);
  const precision = useTickersStore((s) => s.precision[key]) ?? 2;
  const isStock = categoryOf(market) === "stock";
  const sessionOnly = usePreferencesStore((s) => s.stockSessionOnly) && isStock;
  const aiResult = useAiStore((s) => s.results[key]);
  const aiLines = usePreferencesStore((s) => s.aiLines);
  // 资金面的三个副图只对加密货币有效：持仓量和爆仓只有合约才有，持仓量历史还受周期限制
  const baseIndicatorConfig = useIndicatorConfig();
  const isCrypto = categoryOf(market) === "crypto";
  const isSpot = market.market === "spot";
  const wantsOpenInterest = baseIndicatorConfig.openInterest && isCrypto;
  const wantsLiquidations = baseIndicatorConfig.liquidations && isCrypto;
  // 持仓量和爆仓来自合约。现货图表上显示的是同一个币的合约数据，前提是这个币有合约。
  const [perpMissing, setPerpMissing] = useState(false);
  useEffect(() => {
    setPerpMissing(false);
    if (!isSpot || !(wantsOpenInterest || wantsLiquidations)) return;
    let active = true;
    void hasPerpContract(market.symbol).then((exists) => {
      if (active) setPerpMissing(!exists);
    });
    return () => {
      active = false;
    };
  }, [isSpot, market.symbol, wantsOpenInterest, wantsLiquidations]);
  const oiSupported = supportsOpenInterestHistory(timeframe);
  const showOpenInterest = wantsOpenInterest && oiSupported && !perpMissing;
  const showLiquidations = wantsLiquidations && !perpMissing;
  // 开了却没法显示时，在图上说明原因，免得以为是坏了
  const flowNote = perpMissing
    ? "这个币没有合约，所以没有持仓量和爆仓量"
    : wantsOpenInterest && !oiSupported
      ? "持仓量在 1 分、1 周、1 月这三个周期没有数据"
      : null;
  const indicatorConfig = useMemo(
    () => ({
      ...baseIndicatorConfig,
      cvd: baseIndicatorConfig.cvd && isCrypto,
      openInterest: showOpenInterest,
      liquidations: showLiquidations,
    }),
    [baseIndicatorConfig, isCrypto, showOpenInterest, showLiquidations],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<LegendHandle>(null);
  const labelsRef = useRef<IndicatorLabelsHandle>(null);
  const indicatorsRef = useRef<IndicatorLayer | null>(null);
  /** 在图例里显示第 index 根 K 线的数值，传 null 表示显示最新一根 */
  const showRef = useRef<(index: number | null) => void>(() => {});
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const primitiveRef = useRef<ISeriesPrimitive<Time> | null>(null);
  const painterRef = useRef<OverlayPainter | null>(null);
  const loadMoreRef = useRef<() => void>(() => {});
  const live = useRef<LiveState>({
    chartType,
    colors,
    precision,
    offset: 0,
    stepSeconds: TIMEFRAME_SECONDS[timeframe],
    shown: "",
    title: "",
    token: 0,
    oldestRaw: null,
    hasMore: true,
    loadingMore: false,
    hovering: false,
  });

  const [bridge, setBridge] = useState<ChartBridge | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [hasData, setHasData] = useState(false);
  const [switching, setSwitching] = useState(false);
  /** 当前图表的历史部分是否来自官方股价数据 */
  const [officialOn, setOfficialOn] = useState(false);
  /** 打开图表之后又补取了几次官方数据（开盘期间每走完一根 K 线补一次） */
  const [officialRefreshes, setOfficialRefreshes] = useState(0);
  const [atLatest, setAtLatest] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);

  // 先同步最新的样式参数，后面的 effect 创建序列时要用
  useEffect(() => {
    live.current.colors = colors;
    live.current.precision = precision;
  });

  // ── 创建图表（每个面板只创建一次）──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const L = live.current;
    const index_ = index;
    const chart = createChart(container, chartOptions());
    chartRef.current = chart;

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    volumeRef.current = volume;
    indicatorsRef.current = new IndicatorLayer(chart);

    const listeners = new Set<() => void>();
    // 这些回调是在图表内部的重绘流程里被调用的，任何一个抛错都会打断图表自身的逻辑，所以逐个兜住
    const notify = () => {
      for (const listener of listeners) {
        try {
          listener();
        } catch (e) {
          console.error("图表视图回调出错", e);
        }
      }
    };
    // 这个图元不画任何东西，只借用图表的重绘时机通知绘图层刷新坐标
    primitiveRef.current = {
      updateAllViews: notify,
      paneViews: () => [{ zOrder: () => "bottom", renderer: () => ({ draw: notify }) }],
    };

    const show = (index: number | null) => {
      const list = candlesRef.current;
      const i = index ?? list.length - 1;
      const candle = list[i];
      const indicators = candle ? indicatorsRef.current?.valuesAt(i) : undefined;
      legendRef.current?.set(candle ? { candle, previousClose: list[i - 1]?.close, indicators } : null);
      labelsRef.current?.set(indicators ?? null);
    };
    showRef.current = show;

    // 这个回调有三种来源：用户的鼠标移动（带 sourceEvent）、其他面板联动过来的位置（不带）、
    // 以及光标被清除（没有坐标）。只有第一种需要广播给其他面板，否则会来回触发。
    let userHovering = false;
    const onCrosshair = (param: MouseEventParams) => {
      const index = param.point && param.logical !== undefined ? Math.round(param.logical) : -1;
      const candle = candlesRef.current[index];
      if (!candle) {
        L.hovering = false;
        show(null);
        if (userHovering) {
          userHovering = false;
          publishCrosshair({ source: index_, time: null });
        }
        return;
      }
      L.hovering = true;
      show(index);
      if (param.sourceEvent) {
        userHovering = true;
        publishCrosshair({ source: index_, time: candle.time });
      }
    };

    // 其他面板的十字光标移动时，把本面板的光标放到同一时刻
    const offSync = subscribeCrosshair((event) => {
      if (event.source === index_) return;
      const main = mainRef.current;
      const at = event.time === null ? -1 : barIndexAt(candlesRef.current, event.time, L.stepSeconds);
      const candle = candlesRef.current[at];
      if (!main || !candle) {
        chart.clearCrosshairPosition();
        // 清除光标不一定会触发上面的回调，这里直接把图例恢复到最新一根
        L.hovering = false;
        show(null);
        return;
      }
      chart.setCrosshairPosition(candle.close, (candle.time + L.offset) as Time, main);
      // 联动过来的位置不一定会触发上面的回调，这里直接把图例更新到这一根
      L.hovering = true;
      show(at);
    });

    const onRange = (range: LogicalRange | null) => {
      setAtLatest(chart.timeScale().scrollPosition() > -3);
      if (range && range.from < LOAD_MORE_MARGIN) loadMoreRef.current();
    };

    chart.subscribeCrosshairMove(onCrosshair);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    setBridge({
      chart,
      series: () => mainRef.current,
      candles: () => candlesRef.current,
      stepSeconds: () => L.stepSeconds,
      onViewChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      setOverlayPainter: (painter) => {
        painterRef.current = painter;
      },
    });

    screenshotRegistry.set(index, () => {
      const canvas = chart.takeScreenshot();
      const ctx = canvas.getContext("2d");
      const cssWidth = container.clientWidth;
      if (ctx && cssWidth > 0) {
        const ratio = canvas.width / cssWidth;
        painterRef.current?.(ctx, ratio);
        ctx.save();
        ctx.scale(ratio, ratio);
        ctx.font = `600 13px ${FONT_FAMILY}`;
        ctx.fillStyle = "#e7eaf0";
        ctx.textBaseline = "top";
        ctx.fillText(`${L.title} · Myles crypto`, 12, 10);
        ctx.restore();
      }
      return canvas;
    });

    return () => {
      screenshotRegistry.delete(index);
      offSync();
      chart.unsubscribeCrosshairMove(onCrosshair);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      listeners.clear();
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      volumeRef.current = null;
      indicatorsRef.current = null;
      showRef.current = () => {};
      primitiveRef.current = null;
      setBridge(null);
    };
  }, [index]);

  // 让 AI 分析能读到这个面板上的 K 线
  useEffect(() => {
    paneDataRegistry.set(index, { tabId: tab.id, candles: () => candlesRef.current });
    return () => {
      paneDataRegistry.delete(index);
    };
  }, [index, tab.id]);

  // ── 主序列：图表类型变化时重建 ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const L = live.current;
    const series = createMainSeries(chart, chartType, L.colors, L.precision);
    if (primitiveRef.current) series.attachPrimitive(primitiveRef.current);
    L.chartType = chartType;
    series.setData(toMainData(candlesRef.current, chartType, L.offset));
    // 新建的序列默认在最上层，把它放回成交量之上、均线之下
    if (series.getPane().getSeries().length > 2) series.setSeriesOrder(1);
    mainRef.current = series;
    return () => {
      if (mainRef.current === series) mainRef.current = null;
      // 图表已经销毁时序列也跟着没了，不需要再移除
      if (chartRef.current === chart) chart.removeSeries(series);
    };
  }, [chartType]);

  // ── AI 给出的入场、止损、目标价，画成价格线 ──
  useEffect(() => {
    const series = mainRef.current;
    const verdict = aiResult?.verdict;
    // 只画给当前这个周期的结论，换了周期就不显示了，免得对不上
    if (!series || !aiLines || !verdict || verdict.direction === "none" || aiResult.timeframe !== timeframe) return;

    const style = { lineWidth: 1 as const, lineStyle: LineStyle.Dashed, axisLabelVisible: true };
    const lines = [
      series.createPriceLine({ ...style, price: verdict.entry, color: "#4f7cff", title: "入场" }),
      series.createPriceLine({ ...style, price: verdict.stop, color: "#ff526b", title: "止损" }),
      ...verdict.targets.map((target, i) =>
        series.createPriceLine({
          ...style,
          price: target,
          color: "#2edb83",
          title: verdict.targets.length > 1 ? `目标${i + 1}` : "目标",
        }),
      ),
    ];

    return () => {
      for (const line of lines) {
        // 图表或序列已经被销毁时这些线也跟着没了
        try {
          series.removePriceLine(line);
        } catch {
          break;
        }
      }
    };
  }, [aiResult, aiLines, timeframe, chartType]);

  // ── 颜色与精度 ──
  useEffect(() => {
    const main = mainRef.current;
    if (main) applySeriesStyle(main, chartType, colors, precision);
  }, [chartType, colors, precision]);

  useEffect(() => {
    volumeRef.current?.setData(toVolumeData(candlesRef.current, colors, live.current.offset));
  }, [colors]);

  // ── 技术指标：开关、均线周期、颜色或精度变化时重建并重算 ──
  useEffect(() => {
    const layer = indicatorsRef.current;
    if (!layer) return;
    layer.configure(indicatorConfig, colors, precision);
    layer.setData(candlesRef.current, live.current.offset);
    if (!live.current.hovering) showRef.current(null);
  }, [indicatorConfig, colors, precision]);

  // ── 资金面数据：持仓量历史和爆仓累计，不在 K 线里，要另外取 ──
  useEffect(() => {
    const layer = indicatorsRef.current;
    if (!layer) return;
    if (!showOpenInterest && !showLiquidations) {
      layer.setFlow(null);
      return;
    }
    const step = TIMEFRAME_SECONDS[timeframe];
    const symbol = market.symbol;
    const openInterest = new Map<number, number>();
    let active = true;
    const redraw = () => {
      if (!active || !indicatorsRef.current) return;
      indicatorsRef.current.setData(candlesRef.current, live.current.offset);
      if (!live.current.hovering) showRef.current(null);
    };

    layer.setFlow({
      // 现货图表上要注明这两项是合约的数据
      note: isSpot ? "合约" : undefined,
      openInterest,
      liquidations: (candleTime) => {
        const buckets = useFlowStore.getState().liquidations[symbol];
        const earliest = buckets ? earliestBucketTime(buckets) : null;
        // 这根 K 线结束时还没有开始记录爆仓，就不画（而不是画成 0）
        if (!buckets || earliest === null || candleTime + step <= earliest) return null;
        return sumLiquidations(buckets, candleTime, candleTime + step);
      },
    });
    redraw();

    const timers: ReturnType<typeof setInterval>[] = [];
    if (showOpenInterest) {
      void provider
        .getOpenInterestHistory(symbol, timeframe)
        .then((points) => {
          if (!active || !points) return;
          for (const point of points) openInterest.set(Math.floor(point.time / step) * step, point.value);
          redraw();
        })
        .catch(() => {
          // 取不到历史时这个副图暂时是空的，下面的定时刷新会慢慢补上最新的点
        });
      // 历史数据不含正在走的这一根，定时取当前持仓量补上
      const refreshLatest = () => {
        void provider
          .getOpenInterest(symbol)
          .then((value) => {
            const last = candlesRef.current[candlesRef.current.length - 1];
            if (!active || !last) return;
            openInterest.set(last.time, value);
            redraw();
          })
          .catch(() => {});
      };
      refreshLatest();
      timers.push(setInterval(refreshLatest, OPEN_INTEREST_REFRESH_MS));
    }

    // 有新的爆仓时重画，最多每秒一次
    let dirty = false;
    const offFlow = showLiquidations
      ? useFlowStore.subscribe((state, prev) => {
          if (state.liquidations[symbol] !== prev.liquidations[symbol]) dirty = true;
        })
      : () => {};
    timers.push(
      setInterval(() => {
        if (!dirty) return;
        dirty = false;
        redraw();
      }, 1000),
    );

    return () => {
      active = false;
      offFlow();
      for (const timer of timers) clearInterval(timer);
    };
    // market 的内容由 key 唯一确定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, timeframe, isSpot, showOpenInterest, showLiquidations]);

  // ── 数据：标的或周期变化时重新加载并订阅 ──
  useEffect(() => {
    const L = live.current;
    const token = ++L.token;
    const step = TIMEFRAME_SECONDS[timeframe];
    const target = `${key}|${timeframe}|${sessionOnly ? "session" : "all"}`;
    const sameAsShown = L.shown === target;
    // 美股只保留常规交易时段的 K 线，这样 K 线根数和均线才和股票软件对得上。
    // 1 时、4 时、1 日还要用 30 分钟线从 9:30 起重新合成，见 features/session/aggregate.ts
    const plan = sessionOnly ? sessionPlan(timeframe) : null;
    const sourceTimeframe = plan?.source ?? timeframe;
    const sourceStep = TIMEFRAME_SECONDS[sourceTimeframe];
    const group = plan?.groupMinutes ?? null;
    const perGroup = plan?.barsPerGroup ?? 1;
    // 周线和月线：先得到日线（合约合成 + 官方历史），再按自然周、自然月归并
    const calendar = plan?.calendar ?? null;
    const officialTimeframe: Timeframe = calendar ? "1d" : timeframe;
    const keep = sessionOnly ? (c: Candle) => isUsRegularSession(c.time, sourceStep) : undefined;
    const fetchPage: PageFetcher = (endTime) => fetchCandlePage(market, sourceTimeframe, endTime);
    const loader: LoaderOptions = {
      keep,
      pageSize: KLINE_PAGE_SIZE,
      minBars: MIN_SESSION_BARS * perGroup,
      maxPages: group ? MAX_INITIAL_PAGES_GROUPED : MAX_INITIAL_PAGES,
    };
    // source 是从合约数据源取来（并过滤后）的 K 线。图表上显示的 candlesRef 由它得来：
    // 需要合成的周期先合成，有官方股价历史时再把历史部分换成官方数据。
    let source: Candle[] = [];
    let official: Candle[] | null = null;
    const toTargets = (list: Candle[]) => (group ? aggregateSession(list, group) : list);
    // 一根 K 线最长也就一个交易时段（6.5 小时）。过了这个时间就算走完，官方数据不会再变。
    const barSpan = Math.min(TIMEFRAME_SECONDS[officialTimeframe], SESSION_SECONDS);
    const isComplete = (c: Candle) => c.time + barSpan <= Date.now() / 1000;
    // base 是拼好官方历史、但还没有按周或月归并的序列
    let base: Candle[] = [];
    const rebuild = () => {
      const contract = toTargets(source);
      base = official ? mergeOfficial(contract, official, isComplete) : contract;
      candlesRef.current = calendar ? regroupCalendar(base, calendar) : base;
    };
    L.hasMore = true;
    L.loadingMore = false;
    L.title = `${displayName(market)} · ${TIMEFRAME_LABELS[timeframe]}`;

    setPhase("loading");
    setOfficialRefreshes(0);
    setError(null);
    setSwitching(!sameAsShown && candlesRef.current.length > 0);

    const offs: (() => void)[] = [];
    const queue: Candle[] = [];
    let raf = 0;
    const alive = () => token === L.token;

    const renderAll = () => {
      mainRef.current?.setData(toMainData(candlesRef.current, L.chartType, L.offset));
      volumeRef.current?.setData(toVolumeData(candlesRef.current, L.colors, L.offset));
      indicatorsRef.current?.setData(candlesRef.current, L.offset);
    };

    const showLast = () => showRef.current(null);

    const flush = () => {
      raf = 0;
      const main = mainRef.current;
      const volume = volumeRef.current;
      if (main && volume) {
        for (const candle of queue) {
          main.update(toMainPoint(candle, L.chartType, L.offset));
          volume.update(toVolumePoint(candle, L.colors, L.offset));
        }
        indicatorsRef.current?.updateTail(candlesRef.current, L.offset, queue.length);
      }
      queue.length = 0;
      if (!L.hovering) showLast();
    };

    // 实时 K 线先并入数组，再按帧批量写进图表
    // 开盘期间每走完一根 K 线，就把刚走完的那根换成官方数据，
    // 这样不管页面开多久，只有正在走的那一根来自合约。一开始没取到官方数据时也借这个机会重试。
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let lastRefreshAt = 0;
    const refreshOfficial = async () => {
      refreshTimer = null;
      lastRefreshAt = Date.now();
      const fresh = await fetchOfficialHistory(market.symbol, officialTimeframe, { fresh: true });
      if (!alive() || !fresh || !matchesContract(fresh, toTargets(source))) return;
      official = fresh;
      queue.length = 0;
      rebuild();
      renderAll();
      if (!L.hovering) showLast();
      setOfficialOn(true);
      setOfficialRefreshes((n) => n + 1);
    };
    const scheduleOfficialRefresh = () => {
      if (!sessionOnly || refreshTimer) return;
      const sinceLast = Date.now() - lastRefreshAt;
      const wait = Math.max(OFFICIAL_REFRESH_DELAY_MS, OFFICIAL_REFRESH_MIN_GAP_MS - sinceLast);
      refreshTimer = setTimeout(() => void refreshOfficial(), wait);
    };

    const onLive = (incoming: Candle, closed: boolean) => {
      if (!alive() || (keep && !keep(incoming))) return;
      if (closed) scheduleOfficialRefresh();
      if (mergeCandle(source, incoming) === "ignored") return;
      let candle = incoming;
      if (group) {
        const merged = aggregateLast(source, group);
        if (!merged) return;
        candle = merged;
      }
      // 没有合成也没有官方历史时，base 和 source 是同一个数组，上面已经更新过了
      if (base !== source && mergeCandle(base, candle) === "ignored") return;
      if (calendar) {
        const merged = regroupCalendarLast(base, calendar);
        if (!merged || mergeCandle(candlesRef.current, merged) === "ignored") return;
        candle = merged;
      }
      const tail = queue[queue.length - 1];
      if (tail && tail.time === candle.time) queue[queue.length - 1] = candle;
      else queue.push(candle);
      if (!raf) raf = requestAnimationFrame(flush);
    };

    // 断线重连后补上缺口
    const refill = async () => {
      try {
        const page = await fetchCandlePage(market, sourceTimeframe, undefined, { fresh: true });
        if (!alive() || page.candles.length === 0) return;
        const last = source[source.length - 1];
        const gap = last !== undefined && page.candles[0]!.time > last.time + sourceStep;
        const fresh = keep ? page.candles.filter(keep) : page.candles;
        if (!gap) {
          source = mergeCandleLists(source, fresh);
        } else if (fresh.length > 0) {
          // 断线太久导致新旧数据接不上时，直接以新数据为准，不留断层
          source = [...fresh];
          L.oldestRaw = page.candles[0]!.time;
          L.hasMore = page.candles.length >= KLINE_PAGE_SIZE;
        }
        rebuild();
        queue.length = 0;
        renderAll();
        setError(null);
        setPhase("ready");
      } catch (e) {
        if (!alive()) return;
        setError(`${describeError(e)}，断线期间的数据可能不完整`);
        setPhase("error");
      }
    };

    loadMoreRef.current = () => {
      if (!alive() || L.loadingMore || !L.hasMore || L.shown !== target) return;
      L.loadingMore = true;
      void loadOlder(fetchPage, L.oldestRaw, {
        ...loader,
        minBars: MIN_MORE_BARS * perGroup,
        maxPages: MAX_MORE_PAGES,
      })
        .then((older) => {
          if (!alive()) return;
          L.oldestRaw = older.oldestRaw;
          L.hasMore = older.hasMore;
          if (older.candles.length === 0) return;
          source = [...older.candles, ...source];
          rebuild();
          renderAll();
        })
        .catch(() => {
          // 向左加载失败不打断看盘，下次滚动到边界时会再试
        })
        .finally(() => {
          if (alive()) L.loadingMore = false;
        });
    };

    void (async () => {
      try {
        // 官方历史和合约的最新一页同时取，互不等待
        const [history, firstPage] = await Promise.all([
          sessionOnly ? fetchOfficialHistory(market.symbol, officialTimeframe) : null,
          loadLatest(fetchPage, { ...loader, minBars: 0, maxPages: 1 }),
        ]);
        if (!alive()) return;
        let page = firstPage;
        let usable = history !== null && matchesContract(history, toTargets(firstPage.candles));
        if (!usable && keep) {
          // 没有官方历史，或最新一页里重叠的 K 线太少还无法核对：按原来的方式多取几页合约数据
          page = await loadLatest(fetchPage, loader);
          if (!alive()) return;
          usable = history !== null && matchesContract(history, toTargets(page.candles));
        }
        official = usable ? history : null;
        source = page.candles;
        rebuild();
        L.offset = chartTimeOffset(step);
        L.stepSeconds = step;
        L.shown = target;
        L.precision = page.precision;
        // 官方历史已经覆盖的那一段不用再向合约要，更早的历史从官方数据的起点往前接
        L.oldestRaw = official ? Math.min(page.oldestRaw ?? Infinity, official[0]!.time) : page.oldestRaw;
        L.hasMore = official ? true : page.hasMore;
        setOfficialOn(official !== null);
        useTickersStore.getState().setPrecision(key, page.precision);
        if (mainRef.current) applySeriesStyle(mainRef.current, L.chartType, L.colors, page.precision);
        renderAll();

        const chart = chartRef.current;
        chart?.applyOptions({ timeScale: { timeVisible: step < 86400 } });
        if (chart && !sameAsShown) {
          const n = candlesRef.current.length;
          chart.priceScale("right").applyOptions({ autoScale: true });
          chart.timeScale().setVisibleLogicalRange({ from: n - INITIAL_VISIBLE_BARS, to: n + 6 });
        }
        showLast();
        setHasData(candlesRef.current.length > 0);
        setSwitching(false);
        setPhase("ready");

        offs.push(provider.subscribeCandles(market, sourceTimeframe, onLive));
        offs.push(provider.onReconnect(market.market, () => void refill()));
      } catch (e) {
        if (!alive()) return;
        if (!sameAsShown) {
          // 新标的没加载出来时不能继续显示旧标的的图
          source = [];
          candlesRef.current = [];
          L.shown = "";
          renderAll();
          showRef.current(null);
          setHasData(false);
        }
        setSwitching(false);
        setError(describeError(e));
        setPhase("error");
      }
    })();

    return () => {
      L.token += 1;
      for (const off of offs) off();
      if (raf) cancelAnimationFrame(raf);
      if (refreshTimer) clearTimeout(refreshTimer);
      loadMoreRef.current = () => {};
    };
    // market 的内容由 key 唯一确定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, timeframe, sessionOnly, reloadNonce]);

  const retry = () => setReloadNonce((n) => n + 1);

  return (
    <section
      className="pane"
      aria-label={`${displayName(market)} ${TIMEFRAME_LABELS[timeframe]} 图表`}
      data-testid={`pane-${index}`}
      data-symbol={displayName(market)}
      data-timeframe={timeframe}
      data-phase={phase}
      data-session={sessionOnly ? "regular" : "all"}
      data-history={sessionOnly && officialOn ? "official" : "contract"}
      data-official-refreshes={officialRefreshes}
      data-focused={focused}
      data-multi={multi}
      data-switching={switching}
      onPointerDownCapture={() => useWorkspaceStore.getState().focusPane(index)}
      onPointerDown={() => {
        const drawings = useDrawingsStore.getState();
        if (drawings.selected) drawings.select(null);
      }}
    >
      {phase === "loading" && <div className="pane__loading" role="progressbar" aria-label="正在加载行情" />}
      <Legend
        ref={legendRef}
        market={market}
        timeframe={timeframe}
        precision={precision}
        sessionOnly={sessionOnly}
        official={sessionOnly && officialOn}
      />
      <div className="pane__chart" ref={containerRef} />
      {bridge && <DrawingLayer bridge={bridge} marketKey={key} precision={precision} />}
      {bridge && (
        <IndicatorLabels
          ref={labelsRef}
          bridge={bridge}
          layer={indicatorsRef}
          container={containerRef}
        />
      )}

      {phase === "error" && !hasData && (
        <div className="pane__notice" role="alert">
          <div>{error}</div>
          <button type="button" className="btn" onClick={retry}>
            重试
          </button>
        </div>
      )}
      {phase === "error" && hasData && (
        <div className="pane__banner" role="alert">
          {error}
          <button type="button" className="btn btn--sm" onClick={retry}>
            重试
          </button>
        </div>
      )}
      {phase === "ready" && !hasData && <div className="pane__notice">这个标的暂时没有 K 线数据</div>}
      {flowNote && (
        <div className="pane__flow-note" data-testid="flow-note" role="note">
          {flowNote}
        </div>
      )}

      {!atLatest && hasData && (
        <button
          type="button"
          className="pane__latest"
          onClick={() => chartRef.current?.timeScale().scrollToRealTime()}
        >
          回到最新
          <ChevronsRight size={14} />
        </button>
      )}
    </section>
  );
});
