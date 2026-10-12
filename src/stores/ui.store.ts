import { create } from "zustand";

/** add：添加标签；replace：替换当前标签的标的；watch：管理自选 */
export type PickerMode = "add" | "replace" | "watch";

interface UiState {
  picker: PickerMode | null;
  settingsOpen: boolean;
  /** 需要登录的功能名称，非空时显示登录占位弹窗 */
  authFeature: string | null;
  toast: { id: number; text: string } | null;
  /** 窄屏下右侧抽屉是否展开 */
  dockDrawerOpen: boolean;
  setDockDrawerOpen: (open: boolean) => void;
  openPicker: (mode: PickerMode) => void;
  closePicker: () => void;
  setSettingsOpen: (open: boolean) => void;
  requireAuth: (feature: string | null) => void;
  showToast: (text: string) => void;
}

let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useUiStore = create<UiState>((set) => ({
  picker: null,
  settingsOpen: false,
  authFeature: null,
  toast: null,
  dockDrawerOpen: false,
  setDockDrawerOpen: (dockDrawerOpen) => set({ dockDrawerOpen }),
  openPicker: (mode) => set({ picker: mode }),
  closePicker: () => set({ picker: null }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  requireAuth: (authFeature) => set({ authFeature }),
  showToast: (text) => {
    toastSeq += 1;
    set({ toast: { id: toastSeq, text } });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 2600);
  },
}));
