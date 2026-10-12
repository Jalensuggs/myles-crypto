import { describe, expect, it } from "vitest";
import { isUsMarketOpen, isUsRegularSession, isUsTradingDay, nyseHolidays, sessionPosition } from "./us-session";

const at = (iso: string) => Date.parse(iso) / 1000;
const M1 = 60;
const M15 = 900;
const H1 = 3600;
const H4 = 14400;
const D1 = 86400;

describe("夏令时期间（美东 = UTC−4，常规时段 13:30–20:00 UTC）", () => {
  // 2026-10-12 是周一
  it("15 分钟线：9:30 开盘那根算，开盘前一根不算", () => {
    expect(isUsRegularSession(at("2026-10-12T13:30:00Z"), M15)).toBe(true);
    expect(isUsRegularSession(at("2026-10-12T13:15:00Z"), M15)).toBe(false);
  });

  it("15 分钟线：15:45 那根算，16:00 那根不算", () => {
    expect(isUsRegularSession(at("2026-10-12T19:45:00Z"), M15)).toBe(true);
    expect(isUsRegularSession(at("2026-10-12T20:00:00Z"), M15)).toBe(false);
  });

  it("1 分钟线的边界", () => {
    expect(isUsRegularSession(at("2026-10-12T13:29:00Z"), M1)).toBe(false);
    expect(isUsRegularSession(at("2026-10-12T13:30:00Z"), M1)).toBe(true);
    expect(isUsRegularSession(at("2026-10-12T19:59:00Z"), M1)).toBe(true);
    expect(isUsRegularSession(at("2026-10-12T20:00:00Z"), M1)).toBe(false);
  });

  it("一个交易日有 26 根 15 分钟线、390 根 1 分钟线", () => {
    const day = at("2026-10-12T00:00:00Z");
    const count = (step: number) => {
      let n = 0;
      for (let t = day; t < day + D1; t += step) if (isUsRegularSession(t, step)) n++;
      return n;
    };
    expect(count(M15)).toBe(26);
    expect(count(M1)).toBe(390);
  });

  it("1 小时线：与交易时段有重叠的都算，共 7 根", () => {
    expect(isUsRegularSession(at("2026-10-12T12:00:00Z"), H1)).toBe(false);
    expect(isUsRegularSession(at("2026-10-12T13:00:00Z"), H1)).toBe(true);
    expect(isUsRegularSession(at("2026-10-12T19:00:00Z"), H1)).toBe(true);
    expect(isUsRegularSession(at("2026-10-12T20:00:00Z"), H1)).toBe(false);
  });

  it("4 小时线：一天两根", () => {
    const kept = ["00", "04", "08", "12", "16", "20"].filter((h) =>
      isUsRegularSession(at(`2026-10-12T${h}:00:00Z`), H4),
    );
    expect(kept).toEqual(["12", "16"]);
  });
});

describe("冬令时期间（美东 = UTC−5，常规时段 14:30–21:00 UTC）", () => {
  // 2026-12-01 是周二
  it("时段整体晚一小时", () => {
    expect(isUsRegularSession(at("2026-12-01T13:30:00Z"), M15)).toBe(false);
    expect(isUsRegularSession(at("2026-12-01T14:15:00Z"), M15)).toBe(false);
    expect(isUsRegularSession(at("2026-12-01T14:30:00Z"), M15)).toBe(true);
    expect(isUsRegularSession(at("2026-12-01T20:45:00Z"), M15)).toBe(true);
    expect(isUsRegularSession(at("2026-12-01T21:00:00Z"), M15)).toBe(false);
  });

  it("换时间后的第一个周一按新时差判断", () => {
    // 2026-11-01 周日结束夏令时，11-02 是周一
    expect(isUsRegularSession(at("2026-11-02T13:30:00Z"), M15)).toBe(false);
    expect(isUsRegularSession(at("2026-11-02T14:30:00Z"), M15)).toBe(true);
    // 2026-03-08 周日开始夏令时，03-09 是周一
    expect(isUsRegularSession(at("2026-03-09T13:30:00Z"), M15)).toBe(true);
    expect(isUsRegularSession(at("2026-03-06T13:30:00Z"), M15)).toBe(false);
    expect(isUsRegularSession(at("2026-03-06T14:30:00Z"), M15)).toBe(true);
  });
});

describe("周末", () => {
  it("周六周日全天都不算", () => {
    for (const day of ["2026-10-10", "2026-10-11"]) {
      for (let h = 0; h < 24; h++) {
        const t = at(`${day}T${String(h).padStart(2, "0")}:00:00Z`);
        expect(isUsRegularSession(t, M15)).toBe(false);
        expect(isUsRegularSession(t, H1)).toBe(false);
      }
    }
  });

  it("UTC 已经是周六凌晨、但纽约还是周五晚上时不算（已收盘）", () => {
    expect(isUsRegularSession(at("2026-10-10T01:00:00Z"), M15)).toBe(false);
  });

  it("日线：周一到周五保留，周六周日去掉", () => {
    const days = ["05", "06", "07", "08", "09", "10", "11", "12"].map((d) =>
      isUsRegularSession(at(`2026-10-${d}T00:00:00Z`), D1),
    );
    // 10-05 周一 … 10-09 周五，10-10 周六，10-11 周日，10-12 周一
    expect(days).toEqual([true, true, true, true, true, false, false, true]);
  });
});

describe("isUsMarketOpen", () => {
  it("开盘期间为 true，盘前、盘后和周末为 false", () => {
    expect(isUsMarketOpen(Date.parse("2026-10-12T15:00:00Z"))).toBe(true);
    expect(isUsMarketOpen(Date.parse("2026-10-12T10:00:00Z"))).toBe(false);
    expect(isUsMarketOpen(Date.parse("2026-10-12T20:00:00Z"))).toBe(false);
    expect(isUsMarketOpen(Date.parse("2026-10-11T15:00:00Z"))).toBe(false);
  });
});

describe("纽交所休市日", () => {
  const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
  const list = (year: number) =>
    [...nyseHolidays(year)].sort((a, b) => a - b).map((d) => new Date(d * 86400000).toISOString().slice(0, 10));

  it("2026 年的 10 个休市日", () => {
    expect(list(2026)).toEqual([
      "2026-01-01",
      "2026-01-19",
      "2026-02-16",
      "2026-04-03",
      "2026-05-25",
      "2026-06-19",
      "2026-07-03", // 独立日是周六，提前到周五
      "2026-09-07",
      "2026-11-26",
      "2026-12-25",
    ]);
  });

  it("2027 年：六月节和圣诞节在周六提前到周五，独立日在周日顺延到周一", () => {
    expect(list(2027)).toEqual([
      "2027-01-01",
      "2027-01-18",
      "2027-02-15",
      "2027-03-26",
      "2027-05-31",
      "2027-06-18",
      "2027-07-05",
      "2027-09-06",
      "2027-11-25",
      "2027-12-24",
    ]);
  });

  it("元旦落在周六时不补休", () => {
    // 2022-01-01 是周六，2021-12-31 照常开市
    expect(list(2022)).not.toContain("2022-01-01");
    expect(list(2022)).not.toContain("2021-12-31");
    expect(isUsTradingDay(day("2021-12-31"))).toBe(true);
    expect(list(2022)).toHaveLength(9);
  });

  it("六月节从 2022 年才开始休市", () => {
    expect(list(2021)).not.toContain("2021-06-18");
    expect(list(2022)).toContain("2022-06-20");
  });

  it("休市日和周末都不是交易日", () => {
    expect(isUsTradingDay(day("2026-09-07"))).toBe(false);
    expect(isUsTradingDay(day("2026-09-08"))).toBe(true);
    expect(isUsTradingDay(day("2026-10-10"))).toBe(false);
  });

  it("休市日当天的 K 线不算交易时段", () => {
    // 2026-09-07 劳动节，周一
    expect(isUsRegularSession(at("2026-09-07T14:00:00Z"), M15)).toBe(false);
    expect(isUsRegularSession(at("2026-09-07T00:00:00Z"), D1)).toBe(false);
    expect(isUsRegularSession(at("2026-09-08T14:00:00Z"), M15)).toBe(true);
    expect(isUsMarketOpen(Date.parse("2026-09-07T15:00:00Z"))).toBe(false);
  });
});

describe("sessionPosition", () => {
  it("给出纽约日期和距开盘的分钟数", () => {
    expect(sessionPosition(at("2026-10-12T13:30:00Z")).minute).toBe(0);
    expect(sessionPosition(at("2026-10-12T19:30:00Z")).minute).toBe(360);
    expect(sessionPosition(at("2026-10-12T13:00:00Z")).minute).toBe(-30);
    expect(sessionPosition(at("2026-12-01T14:30:00Z")).minute).toBe(0);
    expect(sessionPosition(at("2026-10-12T13:30:00Z")).day).toBe(Math.floor(at("2026-10-12T00:00:00Z") / 86400));
  });
});
