import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import type { ProxyOptions } from "vite";
import { defineConfig } from "vitest/config";

/**
 * 美股的官方历史 K 线来自 Yahoo 财经。它不允许浏览器跨域直接访问，
 * 所以由开发服务器代为转发：页面请求 /yahoo/...，这里转给 Yahoo。
 * 部署到线上时需要在服务器上配一条同样的转发规则，见 README。
 */
const yahooProxy: Record<string, ProxyOptions> = {
  "/yahoo": {
    target: "https://query1.finance.yahoo.com",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/yahoo/, ""),
    configure: (proxy) => {
      proxy.on("proxyReq", (req) => {
        // 只转发行情请求本身，不带上页面的来源、Cookie 和浏览器指纹
        for (const name of req.getHeaderNames()) {
          if (name === "origin" || name === "referer" || name === "cookie" || name.startsWith("sec-")) {
            req.removeHeader(name);
          }
        }
        // 实测：带常见浏览器标识的请求会和无数其他用户共用限流额度，经常被拒绝（429）；
        // 用自己的标识则稳定。所以这里统一换成本应用的标识。
        req.setHeader("user-agent", "Mozilla/5.0 (compatible; MylesCrypto/0.1)");
      });
    },
  },
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { proxy: yahooProxy },
  preview: { proxy: yahooProxy },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
