import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  wide?: boolean;
  flush?: boolean;
  testId?: string;
  children: ReactNode;
}

export function Dialog({ open, title, onClose, wide, flush, testId, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // 原生弹窗默认把焦点给第一个可聚焦元素（关闭按钮），这里改为指定的输入框
      el.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? " dialog--wide" : ""}`}
      aria-label={title}
      data-testid={testId}
      onClose={onClose}
      onClick={(e) => {
        // 点击遮罩关闭
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog__head">
        <h2 className="dialog__title">{title}</h2>
        <button type="button" className="tbtn tbtn--icon dialog__close" aria-label="关闭" title="关闭" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className={`dialog__body${flush ? " dialog__body--flush" : ""}`}>{children}</div>
    </dialog>
  );
}
