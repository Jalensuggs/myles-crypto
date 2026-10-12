/**
 * K 线序号（可以是小数，也可以超出已加载范围）与时间戳之间的换算。
 * 绘图对象用时间锚定，图表用序号定位，两者通过这里互转。
 * 已加载范围内按相邻两根 K 线插值，范围外按周期秒数外推。
 */
export interface TimedBar {
  time: number;
}

export function timeToIndex(bars: readonly TimedBar[], time: number, stepSeconds: number): number | null {
  const n = bars.length;
  if (n === 0) return null;
  const first = bars[0]!.time;
  const last = bars[n - 1]!.time;
  if (time <= first) return (time - first) / stepSeconds;
  if (time >= last) return n - 1 + (time - last) / stepSeconds;

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.time <= time) lo = mid;
    else hi = mid;
  }
  const a = bars[lo]!.time;
  const b = bars[hi]!.time;
  return lo + (time - a) / (b - a);
}

export function indexToTime(bars: readonly TimedBar[], index: number, stepSeconds: number): number | null {
  const n = bars.length;
  if (n === 0) return null;
  const first = bars[0]!.time;
  const last = bars[n - 1]!.time;
  if (index <= 0) return first + index * stepSeconds;
  if (index >= n - 1) return last + (index - (n - 1)) * stepSeconds;
  const lo = Math.floor(index);
  const a = bars[lo]!.time;
  const b = bars[lo + 1]!.time;
  return a + (index - lo) * (b - a);
}
