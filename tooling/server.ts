/**
 * 自建服务器上的接口服务。
 *
 * 部署到 Vercel 时不用它：那里 `api/` 下的文件本身就是函数。
 * 部署到自己的服务器时，由这个小服务把请求交给同样那两个函数处理。
 * 静态页面不归它管，由 Caddy 直接托管，详见 README。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import aiHandler from "../api/ai";
import yahooHandler from "../api/yahoo";
import { readBody, sendResponse, toRequest } from "./node-adapter";

const PORT = Number(process.env.PORT ?? 3400);
const HOST = process.env.HOST ?? "0.0.0.0";

function notFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "没有这个接口" }));
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // 探活用，不碰上游，方便部署后确认服务起来了
  if (url.pathname === "/healthz") {
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("ok");
    return;
  }

  if (url.pathname === "/api/ai") {
    await sendResponse(res, await aiHandler(toRequest(req, await readBody(req), url)));
    return;
  }

  // 页面请求的是 /yahoo/v8/finance/chart/AAPL?...，函数那边按 ?path= 取，
  // 线上这一步由 vercel.json 的改写规则完成，这里自己做一次同样的改写。
  if (url.pathname.startsWith("/yahoo/")) {
    const target = new URL("/api/yahoo", url.origin);
    target.search = url.search;
    target.searchParams.set("path", url.pathname.slice("/yahoo/".length));
    await sendResponse(res, await yahooHandler(toRequest(req, Buffer.alloc(0), target)));
    return;
  }

  notFound(res);
}

const server = createServer((req, res) => {
  void route(req, res).catch((error: unknown) => {
    console.error("[server]", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
    }
    res.end(JSON.stringify({ error: "服务器内部错误" }));
  });
});

// 模型要想很久，别让 Node 自己先把连接掐了
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 75_000;

server.listen(PORT, HOST, () => {
  console.log(`接口服务已启动：http://${HOST}:${PORT}`);
});
