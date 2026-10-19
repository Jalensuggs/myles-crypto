import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin, ViteDevServer } from "vite";

/**
 * 本机开发时让 /api/... 也能用。
 *
 * 线上这些文件由 Vercel 直接当函数运行，开发服务器不会；
 * 这个插件把 Node 的请求转成标准的 Request 交给同一个函数处理，
 * 再把结果（包括流式输出）写回去，所以开发和线上跑的是同一份代码。
 */
const PREFIX = "/api/";

function toRequest(req: IncomingMessage, body: Buffer | undefined): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  return new Request(url, {
    method: req.method,
    headers,
    ...(body && body.length > 0 ? { body: new Uint8Array(body) } : {}),
  });
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function middleware(server: ViteDevServer): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (!path.startsWith(PREFIX)) return next();
    const name = path.slice(PREFIX.length);
    if (!/^[a-z0-9-]+$/.test(name)) return next();

    void (async () => {
      try {
        const module = (await server.ssrLoadModule(`/api/${name}.ts`)) as {
          default: (request: Request) => Promise<Response>;
        };
        const response = await module.default(toRequest(req, await readBody(req)));

        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.flushHeaders?.();

        if (!response.body) {
          res.end();
          return;
        }
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } catch (error) {
        server.config.logger.error(`[api] ${name} 出错: ${String(error)}`);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json; charset=utf-8");
        }
        res.end(JSON.stringify({ error: "本机接口出错，详见终端" }));
      }
    })();
  };
}

export function apiRoutes(): Plugin {
  return {
    name: "mc-api-routes",
    configureServer(server) {
      server.middlewares.use(middleware(server));
    },
  };
}
