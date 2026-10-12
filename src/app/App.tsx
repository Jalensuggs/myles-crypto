import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { ChartGrid } from "@/components/chart/ChartGrid";
import { AuthDialog } from "@/components/common/AuthDialog";
import { SettingsDialog } from "@/components/common/SettingsDialog";
import { SymbolPicker } from "@/components/common/SymbolPicker";
import { Toast } from "@/components/common/Toast";
import { DrawingToolbar } from "@/components/drawing/DrawingToolbar";
import { ChartToolbar } from "@/components/shell/ChartToolbar";
import { RightDock } from "@/components/shell/RightDock";
import { TopTabs } from "@/components/shell/TopTabs";
import { queryClient } from "@/data";
import { useDrawingsStore } from "@/stores/drawings.store";
import { usePreferencesStore } from "@/stores/preferences.store";
import { MarketStreams } from "./MarketStreams";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector("dialog[open]")) return;
      const drawings = useDrawingsStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        drawings.setTool("cursor");
        drawings.select(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && drawings.selected) {
        e.preventDefault();
        drawings.removeSelected();
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) drawings.redo();
        else drawings.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        drawings.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function App() {
  const upColor = usePreferencesStore((s) => s.upColor);
  useGlobalShortcuts();

  useEffect(() => {
    document.documentElement.dataset.upColor = upColor;
  }, [upColor]);

  return (
    <QueryClientProvider client={queryClient}>
      <MarketStreams />
      <div className="terminal">
        <TopTabs />
        <ChartToolbar />
        <div className="workarea">
          <DrawingToolbar />
          <ChartGrid />
          <RightDock />
        </div>
      </div>
      <SymbolPicker />
      <SettingsDialog />
      <AuthDialog />
      <Toast />
    </QueryClientProvider>
  );
}
