export function formatPrice(value: number | undefined, precision = 2): string {
  if (value === undefined || !Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

export function formatPct(value: number | undefined, digits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

/** 中文习惯的大数缩写：万、亿 */
export function formatCompact(value: number | undefined, digits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${(value / 1e8).toFixed(digits)}亿`;
  if (abs >= 1e4) return `${(value / 1e4).toFixed(digits)}万`;
  if (abs >= 100) return value.toFixed(0);
  return value.toFixed(digits);
}

export function formatUsd(value: number | undefined, digits = 1): string {
  if (value === undefined || !Number.isFinite(value)) return "--";
  return `$${formatCompact(value, digits)}`;
}

export function formatRelativeTime(timestampMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (seconds < 10) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function formatCountdown(targetMs: number, nowMs: number): string {
  const total = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** 根据价格量级估算小数位数，仅在没有原始字符串可参考时使用 */
export function guessPrecision(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 2;
  if (price >= 100) return 2;
  if (price >= 10) return 3;
  if (price >= 1) return 4;
  if (price >= 0.01) return 5;
  return 7;
}

/** 数字字符串去掉尾部多余的 0 之后的小数位数 */
export function decimalsOf(text: string): number {
  const dot = text.indexOf(".");
  if (dot < 0) return 0;
  let end = text.length;
  while (end > dot + 1 && text.charCodeAt(end - 1) === 48) end--;
  return end - dot - 1;
}

let counter = 0;
export function uid(prefix = "id"): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
