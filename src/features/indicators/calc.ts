/**
 * 技术指标的计算。全部是纯函数，输入收盘价数组，输出与输入等长的数组，
 * 数据不足以计算的位置为 null。
 */

/** 简单移动平均（MA） */
export function sma(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period < 1) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 指数移动平均。第一个值用前 period 个数的简单平均做种子。 */
export function ema(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period < 1 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export interface MacdPoint {
  /** 快线：快慢两条 EMA 之差 */
  dif: number | null;
  /** 慢线：DIF 的 EMA */
  dea: number | null;
  /** 柱：DIF − DEA */
  hist: number | null;
}

export function macd(closes: readonly number[], fast = 12, slow = 26, signal = 9): MacdPoint[] {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const out: MacdPoint[] = closes.map(() => ({ dif: null, dea: null, hist: null }));

  const start = slow - 1;
  const difs: number[] = [];
  for (let i = start; i < closes.length; i++) {
    const f = fastEma[i];
    const s = slowEma[i];
    if (f === null || f === undefined || s === null || s === undefined) continue;
    difs.push(f - s);
    out[i]!.dif = f - s;
  }
  const dea = ema(difs, signal);
  for (let j = 0; j < difs.length; j++) {
    const d = dea[j];
    if (d === null || d === undefined) continue;
    const point = out[start + j]!;
    point.dea = d;
    point.hist = difs[j]! - d;
  }
  return out;
}

/** 相对强弱指标，使用 Wilder 平滑，取值 0 到 100 */
export function rsi(closes: readonly number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (period < 1 || closes.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) gain += change;
    else loss -= change;
  }
  gain /= period;
  loss /= period;
  out[period] = toRsi(gain, loss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = toRsi(gain, loss);
  }
  return out;
}

function toRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export interface BollPoint {
  upper: number | null;
  mid: number | null;
  lower: number | null;
}

/** 布林带：中轨是 MA，上下轨是中轨加减若干倍标准差（总体标准差） */
export function boll(closes: readonly number[], period = 20, multiplier = 2): BollPoint[] {
  const mid = sma(closes, period);
  return closes.map((_, i) => {
    const m = mid[i];
    if (m === null || m === undefined) return { upper: null, mid: null, lower: null };
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += (closes[j]! - m) ** 2;
    const deviation = Math.sqrt(sum / period) * multiplier;
    return { upper: m + deviation, mid: m, lower: m - deviation };
  });
}

export interface KdjPoint {
  k: number | null;
  d: number | null;
  j: number | null;
}

/**
 * KDJ 随机指标。先算 RSV =（收盘 − N 日最低）/（N 日最高 − N 日最低）× 100，
 * K 是 RSV 的平滑，D 是 K 的平滑，J = 3K − 2D。K、D 的初值取 50。
 */
export function kdj(
  bars: readonly { high: number; low: number; close: number }[],
  period = 9,
  kSmooth = 3,
  dSmooth = 3,
): KdjPoint[] {
  const out: KdjPoint[] = bars.map(() => ({ k: null, d: null, j: null }));
  let k = 50;
  let d = 50;
  for (let i = period - 1; i < bars.length; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j]!.high > highest) highest = bars[j]!.high;
      if (bars[j]!.low < lowest) lowest = bars[j]!.low;
    }
    // 这段时间价格完全没动时 RSV 没有定义，取中间值
    const rsv = highest === lowest ? 50 : ((bars[i]!.close - lowest) / (highest - lowest)) * 100;
    k = ((kSmooth - 1) * k + rsv) / kSmooth;
    d = ((dSmooth - 1) * d + k) / dSmooth;
    out[i] = { k, d, j: 3 * k - 2 * d };
  }
  return out;
}
