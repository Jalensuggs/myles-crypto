import { describe, expect, it } from "vitest";
import { extractJson, parseAnalysis } from "./verdict";

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

  it("观望时不检查方向一致性，但仍检查价格范围", () => {
    const result = parseAnalysis(reply({ ...good, direction: "wait", stop: 104 }), 100);
    expect(result.verdict?.direction).toBe("wait");
    expect(result.issues).toEqual([]);
  });
});
