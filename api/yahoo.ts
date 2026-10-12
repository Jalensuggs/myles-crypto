import { PROXY_USER_AGENT, upstreamUrl } from "../src/data/stock/proxy-rules";

/**
 * 线上的 Yahoo 财经转发。浏览器不能跨域直接访问 Yahoo，所以页面请求本站的 /yahoo/...，
 * 由 vercel.json 里的规则交给这个函数，再由它去取数据。
 * 本机开发时不走这里，由 vite.config.ts 里的转发规则处理。
 */
export const config = { runtime: "edge" };

const TIMEOUT_MS = 8_000;

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ error: "只支持 GET" }, 405, { allow: "GET" });

  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "";
  const target = upstreamUrl(path, url.searchParams);
  if (!target) return json({ error: "不支持的请求" }, 400);

  try {
    const upstream = await fetch(target, {
      headers: { "user-agent": PROXY_USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
        // 行情数据短时间内不会变，让边缘节点缓存一会儿，减少对上游的请求
        "cache-control": upstream.ok ? "public, s-maxage=20, stale-while-revalidate=40" : "no-store",
      },
    });
  } catch {
    return json({ error: "上游没有响应" }, 502, { "cache-control": "no-store" });
  }
}
