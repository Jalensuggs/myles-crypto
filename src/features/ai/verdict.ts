/**
 * 解析模型给出的结论。
 *
 * 模型按约定先输出一段 JSON，再写文字分析。这里把 JSON 取出来、校验一遍，
 * 剩下的文字留着显示。
 *
 * 校验这一步很重要：模型偶尔会写出图上根本没有的价格，或者做多却把止损设在入场价上方。
 * 这些都会被标出来，界面上直接显示提示，不会悄悄当成正常结果用。
 */
import { z } from "zod";

export const DIRECTIONS = ["long", "short", "wait"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIRECTION_LABELS: Record<Direction, string> = {
  long: "做多买入",
  short: "做空卖出",
  wait: "观望",
};

const verdictSchema = z.object({
  direction: z.enum(DIRECTIONS),
  entry: z.number().finite().positive(),
  stop: z.number().finite().positive(),
  targets: z.array(z.number().finite().positive()).min(1).max(5),
  confidence: z.number().min(0).max(100),
  horizon: z.string().max(60).default(""),
  invalidation: z.string().max(300).default(""),
});

export type Verdict = z.infer<typeof verdictSchema>;

export interface ParsedAnalysis {
  /** 解析成功的结论；模型还没写完或者格式不对时为 null */
  verdict: Verdict | null;
  /** 去掉 JSON 之后的正文 */
  text: string;
  /** 价位有问题时的提示，界面会直接显示出来 */
  issues: string[];
}

/** 入场价离现价超过这个比例就不合理了 */
const MAX_ENTRY_DRIFT = 0.2;
/** 止损、目标价离现价超过这个比例就不合理了 */
const MAX_LEVEL_DRIFT = 0.5;
/** 盈亏比低于这个值会提示 */
const MIN_REWARD_RATIO = 1;

/**
 * 从一段文字里取出第一个完整的 JSON 对象。
 * 边收边解析时内容可能只写到一半，这时返回 null。
 */
export function extractJson(raw: string): { json: string; start: number; end: number } | null {
  const fence = raw.indexOf("```");
  const from = fence >= 0 ? raw.indexOf("{", fence) : raw.indexOf("{");
  if (from < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { json: raw.slice(from, i + 1), start: from, end: i + 1 };
    }
  }
  return null;
}

/** 去掉 JSON 和包着它的代码块标记，留下正文 */
function stripJson(raw: string, start: number, end: number): string {
  let head = raw.slice(0, start);
  let tail = raw.slice(end);
  const fenceStart = head.lastIndexOf("```");
  if (fenceStart >= 0 && head.slice(fenceStart).trim().replace(/^```/, "").match(/^(json)?$/i)) {
    head = head.slice(0, fenceStart);
  }
  tail = tail.replace(/^\s*```/, "");
  return `${head}\n${tail}`.trim();
}

function checkLevels(verdict: Verdict, price: number): string[] {
  const issues: string[] = [];
  const drift = (value: number) => Math.abs(value - price) / price;

  if (drift(verdict.entry) > MAX_ENTRY_DRIFT) {
    issues.push(`入场价 ${verdict.entry} 离现价 ${price} 太远，可能不是图上的价格`);
  }
  for (const [label, value] of [["止损", verdict.stop], ...verdict.targets.map((t) => ["目标", t] as const)] as const) {
    if (drift(value) > MAX_LEVEL_DRIFT) issues.push(`${label}价 ${value} 离现价太远，可能不是图上的价格`);
  }

  if (verdict.direction === "long" || verdict.direction === "short") {
    const long = verdict.direction === "long";
    if (long ? verdict.stop >= verdict.entry : verdict.stop <= verdict.entry) {
      issues.push(`方向是${DIRECTION_LABELS[verdict.direction]}，止损却在入场价${long ? "上方" : "下方"}`);
    }
    const wrongTargets = verdict.targets.filter((t) => (long ? t <= verdict.entry : t >= verdict.entry));
    if (wrongTargets.length > 0) {
      issues.push(`方向是${DIRECTION_LABELS[verdict.direction]}，目标价却在入场价${long ? "下方" : "上方"}`);
    }

    const risk = Math.abs(verdict.entry - verdict.stop);
    const reward = Math.abs(verdict.targets[0]! - verdict.entry);
    if (risk > 0 && reward / risk < MIN_REWARD_RATIO) {
      issues.push(`盈亏比只有 ${(reward / risk).toFixed(2)}，赚的不如亏的多`);
    }
  }
  return issues;
}

/**
 * 解析模型的输出。
 * @param raw 模型已经输出的全部文字，可以是没写完的
 * @param price 当前价，用来检查模型给的价位是否靠谱
 */
export function parseAnalysis(raw: string, price: number): ParsedAnalysis {
  const found = extractJson(raw);
  if (!found) return { verdict: null, text: raw.trim(), issues: [] };

  let data: unknown;
  try {
    data = JSON.parse(found.json);
  } catch {
    return { verdict: null, text: raw.trim(), issues: [] };
  }

  const parsed = verdictSchema.safeParse(data);
  const text = stripJson(raw, found.start, found.end);
  if (!parsed.success) return { verdict: null, text, issues: ["模型给出的结论格式不对，只能看下面的文字分析"] };

  const verdict = parsed.data;
  // 目标价按方向由近到远排好，模型有时会倒着写
  const targets = [...new Set(verdict.targets)].sort((a, b) =>
    verdict.direction === "short" ? b - a : a - b,
  );
  const normalized: Verdict = { ...verdict, targets };

  return {
    verdict: normalized,
    text,
    issues: price > 0 ? checkLevels(normalized, price) : [],
  };
}
