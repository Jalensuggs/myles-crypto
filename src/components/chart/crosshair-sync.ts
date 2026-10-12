/**
 * 多图布局下的十字光标联动。鼠标在一张图上移动时，把所在 K 线的时间广播出去，
 * 其他图把十字光标放到同一时刻。time 为 null 表示鼠标离开了图表。
 */
export interface CrosshairEvent {
  /** 发出事件的面板序号，接收方据此忽略自己发出的事件 */
  source: number;
  /** K 线的真实开盘时间（Unix 秒） */
  time: number | null;
}

type Listener = (event: CrosshairEvent) => void;

const listeners = new Set<Listener>();

export function publishCrosshair(event: CrosshairEvent): void {
  for (const listener of [...listeners]) listener(event);
}

export function subscribeCrosshair(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 在一串按时间升序排列的 K 线里，找到包含指定时刻的那一根的序号。
 * 周期不同的两张图也能对上：15 分钟图上的 10:40 落在 1 小时图 10:00 那一根里。
 * 时刻早于第一根或晚于最后一根的结束时间时返回 -1。
 */
export function barIndexAt(bars: readonly { time: number }[], time: number, stepSeconds: number): number {
  const n = bars.length;
  if (n === 0 || time < bars[0]!.time) return -1;
  if (time >= bars[n - 1]!.time) return time < bars[n - 1]!.time + stepSeconds ? n - 1 : -1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.time <= time) lo = mid;
    else hi = mid;
  }
  return lo;
}
