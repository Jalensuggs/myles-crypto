import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Node 的请求响应和标准 Request/Response 之间的转换。
 *
 * `api/` 里的函数写成标准形式（收一个 Request，返回一个 Response），
 * 线上由 Vercel 直接运行；本机开发和自建服务器上就靠这里转一道，
 * 三种环境跑的是同一份代码。
 */

export function toRequest(req: IncomingMessage, body: Buffer, url?: URL): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const target = url ?? new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  return new Request(target, {
    method: req.method,
    headers,
    ...(body.length > 0 ? { body: new Uint8Array(body) } : {}),
  });
}

export async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** 把 Response 写回去，流式内容边收边写 */
export async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.flushHeaders?.();

  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}
