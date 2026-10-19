/**
 * 把行情快照写成交给模型的提示词。
 *
 * 浏览器只负责把快照（结构化数据）发给自己的服务端，提示词在这里统一生成，
 * 服务端和测试用的是同一份，改措辞不用改两处。
 */
import { formatUtc, type MarketSnapshot } from "./snapshot";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const DIRECTION_RULES = `输出要求（务必照做）：
1. 先输出一个 \`\`\`json 代码块，只包含下面这些字段，不要加注释：
{
  "direction": "long" | "short" | "wait",   // long=做多买入，short=做空卖出，wait=观望
  "entry": 数字,        // 建议入场价
  "stop": 数字,         // 止损价
  "targets": [数字],    // 一到三个目标价，由近到远
  "confidence": 0-100,  // 把握程度
  "horizon": "文字",    // 这笔交易打算拿多久，例如"3-8 根K线"
  "invalidation": "文字" // 什么情况出现就说明这个判断错了
}
2. 代码块之后用中文写分析，分成四小段，每段一两句话：
   「走势」「关键位置」「资金面」「风险」。
3. 必须给出明确的方向。只有在行情确实没有可操作的位置时才用 wait，
   这时 entry 填你认为值得进场的价格，stop 和 targets 照常给。
4. 所有价格必须落在快照给出的价格范围附近，不要凭空编造；
   小数位数和快照里的价格保持一致。
5. 做多时 stop 必须低于 entry、targets 必须高于 entry；做空时反过来。
6. 止损距离参考快照里的 ATR（一根 K 线的平均波动），不要设得比它还窄。
7. 全部用简体中文，不要写免责声明和客套话，直接给结论。`;

export function systemPrompt(): string {
  return `你是一名经验丰富的交易员，擅长用技术面和资金面做短线到波段的判断。
用户会给你一份行情快照，里面的均线、指标、支撑阻力都已经由程序算好，数据真实可信。
你的任务是读完快照后直接给出可以执行的交易决策：做多、做空还是观望，以及入场、止损、目标价。

判断时重点看这几件事：
- 走势结构：高点和低点是在抬高还是降低，现价在整个区间的什么位置。
- 关键位置：最近的支撑和阻力，被触碰的次数越多越重要；价格贴近哪一边。
- 指标：均线的排列和价格相对均线的位置、RSI 是否超买超卖、MACD 的方向。
- 资金面（如果有）：CVD 说明主动买卖哪边更强，持仓量变化说明是新资金进场还是平仓，
  爆仓数据说明哪一边被挤出去了，大单净流入说明大户在做什么，资金费率说明多空情绪。
- 风险收益比：目标价到入场价的距离，至少要是入场价到止损距离的 1.5 倍，否则宁可换个入场价。

${DIRECTION_RULES}`;
}

function levelLine(levels: MarketSnapshot["levels"]["support"], label: string): string {
  if (levels.length === 0) return `${label}：暂时没有识别到`;
  const parts = levels.map((l) => `${l.price}（碰过 ${l.touches} 次，距现价 ${l.distancePct}%）`);
  return `${label}：${parts.join("、")}`;
}

const TREND_LABELS = { up: "上升", down: "下降", range: "震荡" } as const;
const CVD_LABELS = { up: "主动买入占优", down: "主动卖出占优", flat: "多空力量接近" } as const;

/** 把快照写成模型读的那段文字 */
export function renderSnapshot(s: MarketSnapshot): string {
  const lines: string[] = [];
  lines.push(`标的：${s.name}（${s.kind}） 周期：${s.timeframeLabel} 快照时间：${s.at} UTC`);
  lines.push(`现价：${s.price}`);
  if (s.day) {
    lines.push(
      `24 小时：涨跌 ${s.day.changePct}%，最高 ${s.day.high}，最低 ${s.day.low}，成交额 ${s.day.quoteVolume}`,
    );
  }
  lines.push(
    `已加载 ${s.range.bars} 根 K 线（从 ${s.range.from} 起）：区间 ${s.range.low} ~ ${s.range.high}，` +
      `现价处在区间的 ${s.range.positionPct}% 位置`,
  );
  lines.push(`走势结构：${TREND_LABELS[s.structure.trend]}——${s.structure.detail}`);

  const ind = s.indicators;
  const indicatorParts: string[] = [];
  if (ind.ma.length > 0) indicatorParts.push(ind.ma.map((m) => `MA${m.period}=${m.value}`).join("，"));
  if (ind.rsi !== undefined) indicatorParts.push(`RSI14=${ind.rsi}`);
  if (ind.macd) indicatorParts.push(`MACD：DIF=${ind.macd.dif}，DEA=${ind.macd.dea}，柱=${ind.macd.hist}`);
  if (ind.boll) indicatorParts.push(`布林带：上轨 ${ind.boll.upper}，中轨 ${ind.boll.mid}，下轨 ${ind.boll.lower}`);
  if (ind.atr !== undefined) indicatorParts.push(`ATR14=${ind.atr}（约为现价的 ${ind.atrPct}%）`);
  if (indicatorParts.length > 0) lines.push(`指标：${indicatorParts.join("；")}`);

  lines.push(levelLine(s.levels.resistance, "上方阻力（由近到远）"));
  lines.push(levelLine(s.levels.support, "下方支撑（由近到远）"));

  if (s.flow) {
    const f = s.flow;
    const parts: string[] = [];
    if (f.cvdTrend) parts.push(`CVD：${CVD_LABELS[f.cvdTrend]}${f.cvdNote ? `，${f.cvdNote}` : ""}`);
    if (f.openInterest !== undefined) {
      const change = f.oiChangePct === undefined ? "" : `，24 小时变化 ${f.oiChangePct}%`;
      parts.push(`持仓量：${f.openInterest}${change}`);
    }
    if (f.fundingRate !== undefined) parts.push(`资金费率：${f.fundingRate}%`);
    if (f.bigTrades1h) {
      parts.push(
        `最近 1 小时大单：买入 ${f.bigTrades1h.buyUsd} 美元，卖出 ${f.bigTrades1h.sellUsd} 美元，` +
          `净 ${f.bigTrades1h.netUsd} 美元（共 ${f.bigTrades1h.count} 笔）`,
      );
    }
    if (f.liquidation24h) {
      const since = f.liquidationSince ? `，从 ${f.liquidationSince} UTC 起统计` : "";
      parts.push(`爆仓：多单 ${f.liquidation24h.long} 美元，空单 ${f.liquidation24h.short} 美元${since}`);
    }
    if (parts.length > 0) lines.push(`资金面：\n- ${parts.join("\n- ")}`);
  }

  if (s.notes.length > 0) lines.push(`需要注意：\n- ${s.notes.join("\n- ")}`);

  lines.push("");
  lines.push(`最近 ${s.bars.length} 根 K 线（时间 开 高 低 收 量，时间为 UTC）：`);
  for (const bar of s.bars) lines.push(`${bar.t} ${bar.o} ${bar.h} ${bar.l} ${bar.c} ${bar.v}`);

  return lines.join("\n");
}

export function buildMessages(snapshot: MarketSnapshot): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt() },
    {
      role: "user",
      content: `${renderSnapshot(snapshot)}\n\n请根据以上数据给出你的交易决策。`,
    },
  ];
}

/** 给界面显示用的快照时间 */
export function snapshotTime(nowMs: number): string {
  return formatUtc(nowMs / 1000, true);
}
