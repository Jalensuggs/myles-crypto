/**
 * 调用自己服务端的 AI 分析接口，并把模型边想边说的内容实时交给界面。
 * 密钥在服务端，这里只发行情快照。
 */
import { AI_PATH, isStreamError, type AnalyzeRequest } from "@/features/ai/contract";
import { SseParser } from "./sse";

/** 界面能直接显示给用户看的错误 */
export class AiError extends Error {}

export interface ModelCatalog {
  models: string[];
  /** 服务端配置的默认模型 */
  default: string;
}

/** 文字刷新得太快反而看不清，也浪费渲染，攒这么久再更新一次 */
const FLUSH_MS = 60;

interface Delta {
  content?: unknown;
  reasoning_content?: unknown;
  reasoning?: unknown;
}

export interface StreamHandlers {
  /** 已经收到的全部正文 */
  onText: (text: string) => void;
  /** 模型在思考但还没开始写正文 */
  onThinking?: () => void;
}

export async function fetchModels(signal?: AbortSignal): Promise<ModelCatalog> {
  const response = await fetch(AI_PATH, { signal });
  const data = (await response.json().catch(() => null)) as Partial<ModelCatalog> & { error?: string };
  if (!response.ok) throw new AiError(data?.error ?? "取不到模型列表");
  return { models: data?.models ?? [], default: data?.default ?? "" };
}

/**
 * 发起一次分析。返回模型写完的全文；中途出错会抛出 AiError。
 */
export async function streamAnalysis(
  request: AnalyzeRequest,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(AI_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new AiError(data?.error ?? `服务端返回了 ${response.status}`);
  }
  if (!response.body) throw new AiError("服务端没有返回内容");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  let text = "";
  let thinking = false;
  let lastFlush = 0;
  let finish: string | null = null;

  const flush = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastFlush < FLUSH_MS) return;
    lastFlush = now;
    handlers.onText(text);
  };

  const handle = (payload: string) => {
    if (payload === "[DONE]") return;
    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }
    if (isStreamError(data)) throw new AiError(data.mc_error);

    const choice = (data as { choices?: { delta?: Delta; finish_reason?: unknown }[] }).choices?.[0];
    if (typeof choice?.finish_reason === "string") finish = choice.finish_reason;
    const delta = choice?.delta;
    if (!delta) return;
    if (typeof delta.content === "string" && delta.content.length > 0) {
      text += delta.content;
      flush(false);
    } else if (!thinking && (typeof delta.reasoning_content === "string" || typeof delta.reasoning === "string")) {
      thinking = true;
      handlers.onThinking?.();
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const payload of parser.push(decoder.decode(value, { stream: true }))) handle(payload);
    }
    for (const payload of parser.flush()) handle(payload);
  } finally {
    reader.cancel().catch(() => undefined);
  }

  flush(true);
  if (text.trim().length === 0) {
    // 会推理的模型可能把输出额度全用在思考上，正文就一个字都没留下
    throw new AiError(
      finish === "length"
        ? "模型想得太久，没来得及写出结论。把思考档位调成「快」，或者换一个模型再试"
        : "模型没有返回内容，可能是额度用完或者这个模型当前不可用",
    );
  }
  return text;
}
