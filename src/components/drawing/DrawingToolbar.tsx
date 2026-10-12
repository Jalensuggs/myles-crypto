import {
  AlignJustify,
  Equal,
  Eraser,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Minus,
  MousePointer2,
  MoveUpRight,
  Redo2,
  Square,
  Trash2,
  TrendingUp,
  Type,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useDrawingsStore } from "@/stores/drawings.store";
import { ColorPicker } from "./ColorPicker";
import { StylePicker } from "./StylePicker";
import { selectActiveTab, useWorkspaceStore } from "@/stores/workspace.store";
import { TOOL_LABELS, type DrawingTool } from "@/types/drawing";
import { marketKey } from "@/types/market";

const TOOLS: { tool: DrawingTool; icon: ReactNode }[] = [
  { tool: "cursor", icon: <MousePointer2 size={17} /> },
  { tool: "trend-line", icon: <TrendingUp size={17} /> },
  { tool: "ray", icon: <MoveUpRight size={17} /> },
  { tool: "horizontal-line", icon: <Minus size={17} /> },
  // 两条斜着的平行线
  { tool: "channel", icon: <Equal size={17} style={{ transform: "rotate(-30deg)" }} /> },
  { tool: "rectangle", icon: <Square size={16} /> },
  { tool: "fib", icon: <AlignJustify size={17} /> },
  { tool: "text", icon: <Type size={16} /> },
];

export function DrawingToolbar() {
  const tool = useDrawingsStore((s) => s.tool);
  const canUndo = useDrawingsStore((s) => s.past.length > 0);
  const canRedo = useDrawingsStore((s) => s.future.length > 0);
  const lockedAll = useDrawingsStore((s) => s.lockedAll);
  const hiddenAll = useDrawingsStore((s) => s.hiddenAll);
  const hasSelection = useDrawingsStore((s) => s.selected !== null);
  const key = marketKey(useWorkspaceStore(selectActiveTab).market);
  const count = useDrawingsStore((s) => s.byMarket[key]?.length ?? 0);
  const actions = useDrawingsStore.getState();

  const removeAll = () => {
    if (count === 0) return;
    if (window.confirm(`确定删除当前标的上的全部 ${count} 个绘图吗？可以用撤销恢复。`)) actions.clear(key);
  };

  return (
    <div className="tools" role="toolbar" aria-label="绘图工具" aria-orientation="vertical" data-testid="drawing-toolbar">
      {TOOLS.map(({ tool: t, icon }) => (
        <button
          key={t}
          type="button"
          className="tool"
          data-testid={`tool-${t}`}
          aria-pressed={tool === t}
          aria-label={TOOL_LABELS[t]}
          title={TOOL_LABELS[t]}
          onClick={() => actions.setTool(t)}
        >
          {icon}
        </button>
      ))}
      <span className="tools__sep" />
      <ColorPicker />
      <StylePicker />
      <span className="tools__sep" />
      <button type="button" className="tool" aria-label="撤销" title="撤销" disabled={!canUndo} onClick={actions.undo}>
        <Undo2 size={17} />
      </button>
      <button type="button" className="tool" aria-label="重做" title="重做" disabled={!canRedo} onClick={actions.redo}>
        <Redo2 size={17} />
      </button>
      <span className="tools__sep" />
      <button
        type="button"
        className="tool"
        aria-pressed={lockedAll}
        aria-label={lockedAll ? "解锁全部绘图" : "锁定全部绘图"}
        title={lockedAll ? "解锁全部绘图" : "锁定全部绘图"}
        onClick={actions.toggleLockAll}
      >
        {lockedAll ? <Lock size={17} /> : <LockOpen size={17} />}
      </button>
      <button
        type="button"
        className="tool"
        aria-pressed={hiddenAll}
        aria-label={hiddenAll ? "显示全部绘图" : "隐藏全部绘图"}
        title={hiddenAll ? "显示全部绘图" : "隐藏全部绘图"}
        onClick={actions.toggleHideAll}
      >
        {hiddenAll ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
      <button
        type="button"
        className="tool"
        aria-label="删除选中的绘图"
        title="删除选中的绘图（Delete）"
        disabled={!hasSelection}
        onClick={actions.removeSelected}
      >
        <Trash2 size={17} />
      </button>
      <button
        type="button"
        className="tool"
        data-testid="tool-clear"
        aria-label="删除当前标的的全部绘图"
        title="删除当前标的的全部绘图"
        disabled={count === 0}
        onClick={removeAll}
      >
        <Eraser size={17} />
      </button>
    </div>
  );
}
