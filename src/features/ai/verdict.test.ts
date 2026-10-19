import { describe, expect, it } from "vitest";
import { extractJson, parseAnalysis, sideOf } from "./verdict";

const good = {
  direction: "long",
  entry: 100,
  stop: 96,
  targets: [108, 115],
  confidence: 70,
  horizon: "3-8 根K线",
  invalidation: "跌破 96 就是看错了",
};

const reply = (verdict: unknown, prose = "走势：上升。\n关键位置：100。\n资金面：买盘占优。\n风险：假突破。") =>
  `\`\`\`json\n${JSON.stringify(verdict, null, 2)}\n\`\`\`\n\n${prose}`;

describe("extractJson", () => {
  it("取出代码块里的 JSON", () => {
    const found = extractJson('前言\n```json\n{"a":1}\n```\n后文');
    expect(found?.json).toBe('{"a":1}');
  });

  it("没有代码块时也能取出第一个对象", () => {
    expect(extractJson('{"a":{"b":2}} 后面')?.json).toBe('{"a":{"b":2}}');
  });

  it("不会被字符串里的大括号骗到", () => {
    expect(extractJson('{"note":"}不是结尾"}')?.json).toBe('{"note":"}不是结尾"}');
    expect(extractJson('{"note":"反斜杠\\\\"}')?.json).toBe('{"note":"反斜杠\\\\"}');
  });

  it("JSON 还没写完时返回 null", () => {
    expect(extractJson('```json\n{"direction":"lo')).toBeNull();
    expect(extractJson("还没开始写")).toBeNull();
  });
});

describe("parseAnalysis", () => {
  it("解析出结论，正文里不再有 JSON", () => {
    const result = parseAnalysis(reply(good), 100);
    expect(result.verdict).toMatchObject({ direction: "long", entry: 100, stop: 96, confidence: 70 });
    expect(result.issues).toEqual([]);
    expect(result.text).not.toContain("direction");
    expect(result.text).toContain("走势：上升。");
    expect(result.text.startsWith("```")).toBe(false);
  });

  it("边收边解析：还没写完时只有文字，没有结论", () => {
    const partial = '```json\n{\n  "direction": "long",\n  "entry": 10';
    expect(parseAnalysis(partial, 100).verdict).toBeNull();
  });

  it("做多却把止损放在入场价上方会被标出来", () => {
    const result = parseAnalysis(reply({ ...good, stop: 104 }), 100);
    expect(result.verdict).not.toBeNull();
    expect(result.issues.join()).toContain("止损却在入场价上方");
  });

  it("做空却把目标价放在入场价上方会被标出来", () => {
    const result = parseAnalysis(reply({ ...good, direction: "short", stop: 104, targets: [110] }), 100);
    expect(result.issues.join()).toContain("目标价却在入场价上方");
  });

  it("价格离现价太远会被标出来", () => {
    const result = parseAnalysis(reply({ ...good, entry: 300, stop: 290, targets: [320] }), 100);
    expect(result.issues.join()).toContain("离现价");
  });

  it("盈亏比太低会被标出来", () => {
    const result = parseAnalysis(reply({ ...good, stop: 90, targets: [105] }), 100);
    expect(result.issues.join()).toContain("盈亏比");
  });

  it("目标价按方向由近到远排好", () => {
    expect(parseAnalysis(reply({ ...good, targets: [115, 108] }), 100).verdict?.targets).toEqual([108, 115]);
    const short = { ...good, direction: "short", stop: 104, targets: [85, 95] };
    expect(parseAnalysis(reply(short), 100).verdict?.targets).toEqual([95, 85]);
  });

  it("格式不对时保留文字分析并说明情况", () => {
    const result = parseAnalysis(reply({ direction: "上涨", entry: "大概 100" }), 100);
    expect(result.verdict).toBeNull();
    expect(result.issues.join()).toContain("格式不对");
    expect(result.text).toContain("走势：上升。");
  });

  it("模型说 wait 但价位是一套做空计划时，按做空显示", () => {
    // 这是 MU 日线上真实出现过的一次：现价 926，模型说"观望"，
    // 可它给的是入场 990、止损 1039、目标 853 和 892，分明是在讲做空。
    const mu = { ...good, direction: "wait", entry: 990.3, stop: 1039.5, targets: [853.66, 892.91] };
    const result = parseAnalysis(reply(mu), 926.11);
    expect(result.verdict?.direction).toBe("short");
    expect(result.verdict?.timing).toBe("wait");
    expect(result.verdict?.entryGapPct).toBeCloseTo(6.93, 1);
    expect(result.issues).toEqual([]);
  });

  it("入场价就在现价附近时算现在就能进", () => {
    const result = parseAnalysis(reply({ ...good, entry: 100.2 }), 100);
    expect(result.verdict?.timing).toBe("now");
    expect(result.verdict?.entryGapPct).toBeCloseTo(0.2, 2);
  });

  it("止损和目标在同一侧时看不出方向，标成没有可做的并提示", () => {
    const muddled = { ...good, direction: "wait", entry: 100, stop: 96, targets: [94] };
    const result = parseAnalysis(reply(muddled), 100);
    expect(result.verdict?.direction).toBe("none");
    expect(result.issues.join()).toContain("看不出模型想做多还是做空");
  });

  it("模型自己说了方向就按它说的来", () => {
    expect(parseAnalysis(reply(good), 100).verdict?.direction).toBe("long");
    const short = { ...good, direction: "short", stop: 104, targets: [92] };
    expect(parseAnalysis(reply(short), 100).verdict?.direction).toBe("short");
    expect(parseAnalysis(reply({ ...good, direction: "none" }), 100).verdict?.direction).toBe("long");
  });
});

describe("sideOf", () => {
  it("止损在下、目标在上是做多", () => {
    expect(sideOf(100, 96, [108])).toBe("long");
  });

  it("止损在上、目标在下是做空", () => {
    expect(sideOf(990.3, 1039.5, [853.66])).toBe("short");
  });

  it("止损和目标在同一侧时判断不出来", () => {
    expect(sideOf(100, 96, [94])).toBeNull();
    expect(sideOf(100, 104, [108])).toBeNull();
  });

  it("没有目标价时判断不出来", () => {
    expect(sideOf(100, 96, [])).toBeNull();
  });
});
