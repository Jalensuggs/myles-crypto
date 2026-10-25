import { DEFAULT_MODEL, MAX_OUTPUT_TOKENS, analyzeRequestSchema } from "../src/features/ai/contract";
import { buildMessages } from "../src/features/ai/prompt";

/**
 * AI 分析的服务端。页面把行情快照发到这里，由这里加上提示词转给模型网关。
 *
 * 网关只要是 OpenAI 兼容的接口就行，换一家只用改环境变量。目前用的是 Groq。
 * 密钥只存在服务器的环境变量里，不会出现在页面代码或网络请求里。
 * 本机开发时不走这里，由 tooling/api-plugin.ts 用同一个函数处理。
 */
/**
 * 固定在悉尼节点。Groq 会按 IP 地区封锁，香港和部分亚洲节点一律返回 403；
 * 不指定的话函数会就近在请求方所在地运行，从香港过来就正好撞在枪口上。
 */
export const config = { runtime: "edge", regions: ["syd1"] };

/** 模型从开始思考到吐出第一个字可能要几十秒 */
const TIMEOUT_MS = 180_000;
/** 等待期间每隔这么久发一个心跳，免得中间的网络设备把连接当成挂掉了 */
const HEARTBEAT_MS = 10_000;
const MODELS_CACHE_SECONDS = 300;

/** 网关 /models 里我们会看的字段，各家给的不完全一样，所以都是可选的 */
interface GatewayModel {
  id: string;
  active?: boolean;
  context_window?: number;
  output_modalities?: string[];
  supported_features?: string[];
}

interface Gateway {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function readGateway(): Gateway | null {
  const env = process.env;
  const baseUrl = env.AI_GATEWAY_BASE_URL?.replace(/\/+$/, "");
  const apiKey = env.AI_GATEWAY_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, model: env.AI_GATEWAY_MODEL || DEFAULT_MODEL };
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

/** 把上游的报错整理成一句中文，同时不泄露密钥之类的细节 */
function upstreamMessage(status: number): string {
  if (status === 401) return "网关拒绝了密钥，检查服务器上的 AI_GATEWAY_API_KEY";
  if (status === 400) return "网关不接受这个请求，可能是模型名不对";
  if (status === 429) return "触发了限流或者今天的免费额度用完了，过一会儿再试";
  if (status >= 500) return "网关或模型暂时不可用，过一会儿再试";
  return `网关返回了 ${status}`;
}

export default async function handler(request: Request): Promise<Response> {
  const gateway = readGateway();
  if (!gateway) return json({ error: "服务器还没有配置模型网关" }, 503);

  if (request.method === "GET") return listModels(gateway);
  if (request.method !== "POST") return json({ error: "只支持 GET 和 POST" }, 405, { allow: "GET, POST" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式不对" }, 400);
  }

  const parsed = analyzeRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: "请求内容不符合约定" }, 400);

  const { snapshot, model, effort } = parsed.data;
  return streamCompletion(gateway, {
    model: model ?? gateway.model,
    messages: buildMessages(snapshot),
    max_tokens: MAX_OUTPUT_TOKENS,
    stream: true,
    stream_options: { include_usage: true },
    ...(effort ? { reasoning_effort: effort } : {}),
  });
}

/**
 * 能用来对话的模型。网关的清单里混着语音转写、语音合成和安全分类模型，
 * 它们在这个页面上点了只会出乱码，所以不往下发。
 */
function isChatModel(item: GatewayModel): boolean {
  if (item.active === false) return false;
  if (/guard|whisper|orpheus|tts|embed/i.test(item.id)) return false;
  // 输出得是文字，而且要支持正常的对话能力
  const outputs = item.output_modalities;
  if (Array.isArray(outputs) && !outputs.includes("text")) return false;
  const features = item.supported_features;
  if (Array.isArray(features) && !features.includes("tools")) return false;
  // 行情快照本身就有几千字，上下文太小的放不下
  return (item.context_window ?? 0) >= 16_000;
}

/** 把网关的模型清单转给页面，只留下能对话的那些 */
async function listModels(gateway: Gateway): Promise<Response> {
  try {
    const upstream = await fetch(`${gateway.baseUrl}/models`, {
      headers: { authorization: `Bearer ${gateway.apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!upstream.ok) return json({ error: upstreamMessage(upstream.status) }, 502);
    const data = (await upstream.json()) as { data?: GatewayModel[] };
    const models = (data.data ?? [])
      .filter((item) => typeof item?.id === "string" && isChatModel(item))
      .map((item) => item.id)
      .sort();
    return json({ models, default: gateway.model }, 200, {
      "cache-control": `public, s-maxage=${MODELS_CACHE_SECONDS}, stale-while-revalidate=600`,
    });
  } catch {
    return json({ error: "连不上模型网关" }, 502);
  }
}

function streamCompletion(gateway: Gateway, payload: unknown): Response {
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const stream = new ReadableStream<Uint8Array>({
    async start(out) {
      const send = (text: string) => out.enqueue(encoder.encode(text));
      const fail = (message: string) => send(`data: ${JSON.stringify({ mc_error: message })}\n\n`);
      // 立刻把响应头发出去：模型思考期间连接要先建立起来，否则中间环节会按超时处理
      send(": 已连接\n\n");
      const heartbeat = setInterval(() => send(": 等待模型\n\n"), HEARTBEAT_MS);

      try {
        const upstream = await fetch(`${gateway.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${gateway.apiKey}`,
            "content-type": "application/json",
            accept: "text/event-stream",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearInterval(heartbeat);

        if (!upstream.ok || !upstream.body) {
          fail(upstreamMessage(upstream.status));
          return;
        }

        const reader = upstream.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          out.enqueue(value);
        }
      } catch (error) {
        clearInterval(heartbeat);
        const aborted = error instanceof Error && error.name === "AbortError";
        fail(aborted ? "模型太久没有回应，已经中断" : "连不上模型网关");
      } finally {
        clearInterval(heartbeat);
        clearTimeout(timer);
        out.close();
      }
    },
    cancel() {
      clearTimeout(timer);
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      // 有些中间层会缓冲响应，这样流式输出就失去意义了
      "x-accel-buffering": "no",
    },
  });
}
