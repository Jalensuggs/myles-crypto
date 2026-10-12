import { defineConfig } from "@playwright/test";

const PORT = 5183;

/**
 * 浏览器验收在模拟数据模式下运行，不访问外网。
 * 使用本机已安装的 Chrome，不需要额外下载浏览器。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    acceptDownloads: true,
  },
  webServer: {
    command: "npm run dev:mock",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: "desktop-1920", use: { viewport: { width: 1920, height: 1080 } } },
    { name: "laptop-1366", use: { viewport: { width: 1366, height: 768 } } },
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 }, hasTouch: false } },
  ],
});
