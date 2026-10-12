import { useState, type ReactNode } from "react";

interface ParamFieldProps<T> {
  label: string;
  hint: string;
  /** 输入不合法时显示的说明 */
  errorHint: string;
  /** 当前生效的值，显示在输入框里 */
  value: string;
  /** 解析用户输入；不合法时返回 null */
  parse: (text: string) => T | null;
  onValid: (value: T) => void;
  testId: string;
  width?: number;
  children?: ReactNode;
}

/**
 * 指标参数的输入框。边输入边生效：内容合法就立刻应用到图表，不需要按回车或点别处；
 * 不合法时保留上一次的设置，并在下面提示。
 */
export function ParamField<T>({ label, hint, errorHint, value, parse, onValid, testId, width = 130, children }: ParamFieldProps<T>) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parse(draft) === null;

  return (
    // 这一栏里可能有按钮，不能用 label 包裹：否则点击文字会触发第一个按钮
    <div className="field">
      <span className="field__label">
        {label}
        {invalid ? (
          <span className="field__hint field__hint--error" data-testid={`${testId}-error`} role="alert">
            格式不对，暂未生效。{errorHint}
          </span>
        ) : (
          <span className="field__hint">{hint}</span>
        )}
        {children}
      </span>
      <span className="field__control">
        <input
          className="input"
          type="text"
          inputMode="decimal"
          aria-label={label}
          aria-invalid={invalid}
          data-testid={testId}
          style={{ width }}
          value={draft ?? value}
          onChange={(e) => {
            setDraft(e.target.value);
            const parsed = parse(e.target.value);
            if (parsed !== null) onValid(parsed);
          }}
          onBlur={() => setDraft(null)}
        />
      </span>
    </div>
  );
}
