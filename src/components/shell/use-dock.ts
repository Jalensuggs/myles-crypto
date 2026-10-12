import { useCallback, useSyncExternalStore } from "react";
import { usePreferencesStore } from "@/stores/preferences.store";
import { useUiStore } from "@/stores/ui.store";

const NARROW_QUERY = "(max-width: 1100px)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const getSnapshot = () => window.matchMedia(NARROW_QUERY).matches;

/**
 * 右侧栏的开合状态。宽屏时它占据固定一列，开合状态会被记住；
 * 窄屏时它是盖在图表上的抽屉，默认收起，且不改动记住的偏好。
 */
export function useDock() {
  const narrow = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const pinned = usePreferencesStore((s) => s.rightDockOpen);
  const drawer = useUiStore((s) => s.dockDrawerOpen);
  const open = narrow ? drawer : pinned;

  const setOpen = useCallback(
    (next: boolean) => {
      if (narrow) useUiStore.getState().setDockDrawerOpen(next);
      else usePreferencesStore.getState().update({ rightDockOpen: next });
    },
    [narrow],
  );

  return { open, narrow, setOpen };
}
