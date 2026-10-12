import { useState } from "react";
import { MAX_MA_LINES, MAX_MA_PERIOD, MA_PRESETS, MIN_MA_PERIOD, parseMaPeriods } from "@/features/indicators/config";
import { clearAllStored } from "@/lib/storage";
import { useDrawingsStore } from "@/stores/drawings.store";
import { useFeedStore } from "@/stores/feed.store";
import { DEFAULT_PREFERENCES, usePreferencesStore } from "@/stores/preferences.store";
import { useUiStore } from "@/stores/ui.store";
import { useWatchlistStore } from "@/stores/watchlist.store";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { Dialog } from "./Dialog";

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
  const maPeriods = usePreferencesStore((s) => s.maPeriods);
  // 边输入边生效：内容合法就立刻应用到图表，不需要再按回车或点别处；
  // 不合法时保留上一次的设置，并在输入框下面提示。
  const [maDraft, setMaDraft] = useState<string | null>(null);
  const maInvalid = maDraft !== null && parseMaPeriods(maDraft) === null;

  const onMaChange = (text: string) => {
    setMaDraft(text);
    const parsed = parseMaPeriods(text);
    if (parsed) update({ maPeriods: parsed });
  };

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

      <div className="field">
        <span className="field__label">
          均线周期
          {maInvalid ? (
            <span className="field__hint field__hint--error" data-testid="ma-periods-error" role="alert">
              格式不对，暂未生效。请填 1 到 {MAX_MA_LINES} 个 {MIN_MA_PERIOD}–{MAX_MA_PERIOD} 的整数，用逗号分隔
            </span>
          ) : (
            <span className="field__hint">
              最多 {MAX_MA_LINES} 条，用逗号分隔，改完立即生效。数字是当前周期的 K 线根数，不是天数
            </span>
          )}
          <span className="field__presets">
            {MA_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="chip"
                aria-pressed={preset.periods.join() === maPeriods.join()}
                title={preset.periods.join(" / ")}
                onClick={() => {
                  update({ maPeriods: preset.periods });
                  setMaDraft(null);
                }}
              >
                {preset.label}
              </button>
            ))}
          </span>
        </span>
        <span className="field__control">
          <input
            className="input"
            type="text"
            inputMode="numeric"
            aria-label="均线周期"
            aria-invalid={maInvalid}
            data-testid="ma-periods"
            style={{ width: 190 }}
            value={maDraft ?? maPeriods.join(", ")}
            onChange={(e) => onMaChange(e.target.value)}
            onBlur={() => setMaDraft(null)}
          />
        </span>
      </div>

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
