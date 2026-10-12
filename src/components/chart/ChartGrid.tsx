import { useWorkspaceStore } from "@/stores/workspace.store";
import { ChartPane } from "./ChartPane";

export function ChartGrid() {
  const layout = useWorkspaceStore((s) => s.layout);
  const panes = useWorkspaceStore((s) => s.panes);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const focused = useWorkspaceStore((s) => s.focused);

  return (
    <main className="grid" data-layout={layout} data-testid="chart-grid">
      {panes.map((tabId, index) => {
        const tab = tabs.find((t) => t.id === tabId) ?? tabs[0]!;
        // 以面板位置为 key：切换标的时复用同一个图表实例，只换数据
        return <ChartPane key={index} tab={tab} index={index} focused={index === focused} multi={layout > 1} />;
      })}
    </main>
  );
}
