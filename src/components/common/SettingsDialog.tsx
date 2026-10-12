import {
  MAX_EMA_LINES,
  MAX_MA_LINES,
  MAX_MA_PERIOD,
  MAX_VOL_MA_LINES,
  MA_PRESETS,
  MIN_MA_PERIOD,
  parseBoll,
  parseEmaPeriods,
  parseKdj,
  parseMaPeriods,
  parseMacd,
  parseRsiPeriod,
  parseVolMaPeriods,
} from "@/features/indicators/config";
import { clearAllStored } from "@/lib/storage";
import { useDrawingsStore } from "@/stores/drawings.store";
import { useFeedStore } from "@/stores/feed.store";
import { DEFAULT_PREFERENCES, usePreferencesStore } from "@/stores/preferences.store";
import { useUiStore } from "@/stores/ui.store";
import { useWatchlistStore } from "@/stores/watchlist.store";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { Dialog } from "./Dialog";
import { ParamField } from "./ParamField";

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const showToast = useUiStore((s) => s.showToast);
  const upColor = usePreferencesStore((s) => s.upColor);
  const liquidationMinUsd = usePreferencesStore((s) => s.liquidationMinUsd);
  const moveThresholdPct = usePreferencesStore((s) => s.moveThresholdPct);
  const update = usePreferencesStore((s) => s.update);
  const bigTradeAlerts = usePreferencesStore((s) => s.bigTradeAlerts);
  const flowPatternAlerts = usePreferencesStore((s) => s.flowPatternAlerts);
  const bigTradeMinUsd = usePreferencesStore((s) => s.bigTradeMinUsd);
  const maPeriods = usePreferencesStore((s) => s.maPeriods);
  const emaPeriods = usePreferencesStore((s) => s.emaPeriods);
  const volMaPeriods = usePreferencesStore((s) => s.volMaPeriods);
  const bollParams = usePreferencesStore((s) => s.bollParams);
  const macdParams = usePreferencesStore((s) => s.macdParams);
  const kdjParams = usePreferencesStore((s) => s.kdjParams);
  const rsiPeriod = usePreferencesStore((s) => s.rsiPeriod);
  const periodRule = `${MIN_MA_PERIOD}–${MAX_MA_PERIOD} 的整数，用逗号分隔`;

  const resetEverything = () => {
    if (!window.confirm("确定要清空本机保存的标签、布局、自选、绘图、异动记录和设置吗？此操作无法撤销。")) return;
    useWorkspaceStore.getState().reset();
    useWatchlistStore.getState().reset();
    useDrawingsStore.getState().resetAll();
    useFeedStore.getState().clear();
    usePreferencesStore.getState().reset();
    clearAllStored();
    setOpen(false);
    showToast("已恢复默认设置");
  };

  return (
    <Dialog open={open} title="设置" onClose={() => setOpen(false)} testId="settings-dialog">
      <div className="field">
        <span className="field__label">涨跌颜色</span>
        <div className="field__control segmented" role="group" aria-label="涨跌颜色">
          <button type="button" aria-pressed={upColor === "green"} onClick={() => update({ upColor: "green" })}>
            绿涨红跌
          </button>
          <button type="button" aria-pressed={upColor === "red"} onClick={() => update({ upColor: "red" })}>
            红涨绿跌
          </button>
        </div>
      </div>

      <label className="field">
        <span className="field__label">
          爆仓提醒阈值
          <span className="field__hint">单笔爆仓金额达到这个数才显示在市场异动里</span>
        </span>
        <span className="field__control">
          <input
            className="input"
            type="number"
            min={1000}
            step={1000}
            value={liquidationMinUsd}
            onChange={(e) =>
              update({
                liquidationMinUsd: clamp(e.target.valueAsNumber, 1000, 1e9, DEFAULT_PREFERENCES.liquidationMinUsd),
              })
            }
          />
          美元
        </span>
      </label>

      <label className="field">
        <span className="field__label">
          急涨急跌阈值
          <span className="field__hint">5 分钟内涨跌幅达到这个数才提醒</span>
        </span>
        <span className="field__control">
          <input
            className="input"
            type="number"
            min={0.1}
            max={50}
            step={0.1}
            value={moveThresholdPct}
            onChange={(e) =>
              update({
                moveThresholdPct: clamp(e.target.valueAsNumber, 0.1, 50, DEFAULT_PREFERENCES.moveThresholdPct),
              })
            }
          />
          %
        </span>
      </label>

      <h3 className="dialog__section">加密货币资金面</h3>

      <div className="field">
        <span className="field__label">
          大单提醒
          <span className="field__hint">大额的主动买入、主动卖出显示在市场异动里</span>
        </span>
        <div className="field__control segmented" role="group" aria-label="大单提醒">
          <button type="button" aria-pressed={bigTradeAlerts} onClick={() => update({ bigTradeAlerts: true })}>
            开
          </button>
          <button type="button" aria-pressed={!bigTradeAlerts} onClick={() => update({ bigTradeAlerts: false })}>
            关
          </button>
        </div>
      </div>

      <label className="field">
        <span className="field__label">
          大单门槛
          <span className="field__hint">
            填 0 表示自动：每个币按自己 24 小时成交额的万分之二算，最低 10 万美元
          </span>
        </span>
        <span className="field__control">
          <input
            className="input"
            type="number"
            min={0}
            step={50000}
            data-testid="big-trade-min"
            value={bigTradeMinUsd}
            onChange={(e) => update({ bigTradeMinUsd: clamp(e.target.valueAsNumber, 0, 1e9, 0) })}
          />
          美元
        </span>
      </label>

      <div className="field">
        <span className="field__label">
          吸收形态提示
          <span className="field__hint">砸盘但跌不动、集中爆仓后收回这类情况，显示在市场异动里</span>
        </span>
        <div className="field__control segmented" role="group" aria-label="吸收形态提示">
          <button type="button" aria-pressed={flowPatternAlerts} onClick={() => update({ flowPatternAlerts: true })}>
            开
          </button>
          <button type="button" aria-pressed={!flowPatternAlerts} onClick={() => update({ flowPatternAlerts: false })}>
            关
          </button>
        </div>
      </div>

      <h3 className="dialog__section">指标参数</h3>

      <ParamField
        label="MA 均线周期"
        hint={`最多 ${MAX_MA_LINES} 条，用逗号分隔，改完立即生效。数字是当前周期的 K 线根数，不是天数`}
        errorHint={`请填 1 到 ${MAX_MA_LINES} 个 ${periodRule}`}
        value={maPeriods.join(", ")}
        parse={parseMaPeriods}
        onValid={(v) => update({ maPeriods: v })}
        testId="ma-periods"
        width={190}
      >
        <span className="field__presets">
          {MA_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="chip"
              aria-pressed={preset.periods.join() === maPeriods.join()}
              title={preset.periods.join(" / ")}
              onClick={() => update({ maPeriods: preset.periods })}
            >
              {preset.label}
            </button>
          ))}
        </span>
      </ParamField>

      <ParamField
        label="EMA 周期"
        hint={`最多 ${MAX_EMA_LINES} 条`}
        errorHint={`请填 1 到 ${MAX_EMA_LINES} 个 ${periodRule}`}
        value={emaPeriods.join(", ")}
        parse={parseEmaPeriods}
        onValid={(v) => update({ emaPeriods: v })}
        testId="ema-periods"
      />

      <ParamField
        label="布林带"
        hint="周期, 标准差倍数"
        errorHint="请填两个数，例如 20, 2。周期 2–500，倍数 0.1–10"
        value={bollParams.join(", ")}
        parse={parseBoll}
        onValid={(v) => update({ bollParams: v })}
        testId="boll-params"
      />

      <ParamField
        label="成交量均线周期"
        hint={`最多 ${MAX_VOL_MA_LINES} 条`}
        errorHint={`请填 1 到 ${MAX_VOL_MA_LINES} 个 ${periodRule}`}
        value={volMaPeriods.join(", ")}
        parse={parseVolMaPeriods}
        onValid={(v) => update({ volMaPeriods: v })}
        testId="volma-periods"
      />

      <ParamField
        label="MACD"
        hint="快线, 慢线, 信号线"
        errorHint="请填三个整数，例如 12, 26, 9。快线要小于慢线"
        value={macdParams.join(", ")}
        parse={parseMacd}
        onValid={(v) => update({ macdParams: v })}
        testId="macd-params"
      />

      <ParamField
        label="KDJ"
        hint="周期, K 平滑, D 平滑"
        errorHint="请填三个整数，例如 9, 3, 3"
        value={kdjParams.join(", ")}
        parse={parseKdj}
        onValid={(v) => update({ kdjParams: v })}
        testId="kdj-params"
      />

      <ParamField
        label="RSI 周期"
        hint="常用 6、12、14、24"
        errorHint="请填一个 2–200 的整数"
        value={String(rsiPeriod)}
        parse={parseRsiPeriod}
        onValid={(v) => update({ rsiPeriod: v })}
        testId="rsi-period"
      />

      <div className="dialog__foot">
        <button type="button" className="btn btn--ghost" onClick={resetEverything}>
          恢复默认并清空本地数据
        </button>
        <button type="button" className="btn btn--primary" onClick={() => setOpen(false)}>
          完成
        </button>
      </div>
    </Dialog>
  );
}
