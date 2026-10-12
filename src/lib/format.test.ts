import { describe, expect, it } from "vitest";
import {
  decimalsOf,
  formatCompact,
  formatCountdown,
  formatPct,
  formatPrice,
  formatRelativeTime,
  formatUsd,
  guessPrecision,
} from "./format";

describe("格式化", () => {
  it("价格带千分位和固定小数位", () => {
    expect(formatPrice(83482.3, 1)).toBe("83,482.3");
    expect(formatPrice(0.08724, 5)).toBe("0.08724");
    expect(formatPrice(undefined)).toBe("--");
    expect(formatPrice(Number.NaN)).toBe("--");
  });

  it("涨跌幅带正负号", () => {
    expect(formatPct(0.546)).toBe("+0.55%");
    expect(formatPct(-1.2)).toBe("−1.20%");
    expect(formatPct(0)).toBe("0.00%");
    expect(formatPct(undefined)).toBe("--");
  });

  it("大数用万和亿", () => {
    expect(formatCompact(7_943_000_000)).toBe("79.43亿");
    expect(formatCompact(94_000)).toBe("9.40万");
    expect(formatCompact(723)).toBe("723");
    expect(formatUsd(523_000)).toBe("$52.3万");
  });

  it("相对时间", () => {
    const now = 1_000_000_000;
    expect(formatRelativeTime(now - 3_000, now)).toBe("刚刚");
    expect(formatRelativeTime(now - 42_000, now)).toBe("42 秒前");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 分钟前");
    expect(formatRelativeTime(now - 3 * 3600_000, now)).toBe("3 小时前");
    expect(formatRelativeTime(now + 5_000, now)).toBe("刚刚");
  });

  it("倒计时", () => {
    expect(formatCountdown(7 * 3600_000 + 2 * 60_000 + 34_000, 0)).toBe("07:02:34");
    expect(formatCountdown(0, 5000)).toBe("00:00:00");
  });

  it("小数位数", () => {
    expect(decimalsOf("84224.02000000")).toBe(2);
    expect(decimalsOf("0.08724")).toBe(5);
    expect(decimalsOf("100")).toBe(0);
    expect(decimalsOf("100.00")).toBe(0);
    expect(guessPrecision(84000)).toBe(2);
    expect(guessPrecision(337.86)).toBe(2);
    expect(guessPrecision(11.02)).toBe(3);
    expect(guessPrecision(1.4)).toBe(4);
    expect(guessPrecision(0.087)).toBe(5);
  });
});
