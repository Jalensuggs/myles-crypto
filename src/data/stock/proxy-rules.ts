/**
 * 线上转发 Yahoo 财经请求时的放行规则。
 * 部署到公网后，这个转发地址任何人都能访问，所以只放行本应用实际会发出的那一种请求：
 * 某只股票的图表数据，且周期和时间范围都在固定的几个取值之内。其余一律拒绝，避免被当成通用代理。
 */

export const YAHOO_ORIGIN = "https://query1.finance.yahoo.com";
/** 用应用自己的标识。带常见浏览器标识的请求会和无数其他用户共用限流额度，经常被拒绝。 */
export const PROXY_USER_AGENT = "Mozilla/5.0 (compatible; MylesCrypto/0.1)";

const CHART_PATH = /^v8\/finance\/chart\/[A-Z][A-Z0-9.-]{0,11}$/;
const INTERVALS = new Set(["1m", "5m", "15m", "30m", "60m", "1d"]);
const RANGES = new Set(["7d", "60d", "730d", "1mo", "10y"]);

/**
 * 把收到的请求换算成要转发的上游地址；不在放行范围内时返回 null。
 * path 是去掉前缀之后的部分，例如 "v8/finance/chart/AAPL"。
 */
export function upstreamUrl(path: string, params: URLSearchParams): string | null {
  const clean = path.replace(/^\/+/, "");
  if (!CHART_PATH.test(clean)) return null;
  const interval = params.get("interval") ?? "";
  const range = params.get("range") ?? "";
  if (!INTERVALS.has(interval) || !RANGES.has(range)) return null;
  // 只带上这三个参数，其他的一概不转发
  const query = new URLSearchParams({ interval, range, includePrePost: "false" });
  return `${YAHOO_ORIGIN}/${clean}?${query.toString()}`;
}
