export const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 15000] as const;
const JITTER = 0.2;

/** 第 attempt 次重连（从 0 开始）前应等待的毫秒数，带 ±20% 随机抖动 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const index = Math.min(Math.max(0, Math.floor(attempt)), BACKOFF_STEPS_MS.length - 1);
  const base = BACKOFF_STEPS_MS[index]!;
  const factor = 1 - JITTER + random() * JITTER * 2;
  return Math.round(base * factor);
}
