import { expect, test, type Page } from "@playwright/test";

const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) > 1100;

async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("pane-0")).toHaveAttribute("data-phase", "ready");
}

async function addSymbol(page: Page, keyword: string) {
  await page.getByTestId("tab-add").click();
  const picker = page.getByTestId("symbol-picker");
  await expect(picker).toBeVisible();
  await picker.getByLabel("搜索标的").fill(keyword);
  await picker.locator(".picker__main").first().click();
  await expect(picker).toBeHidden();
}

/** 网络请求里不应该出现任何外部域名 */
function trackExternalRequests(page: Page): string[] {
  const external: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol !== "data:") external.push(req.url());
  });
  return external;
}

test.describe("首屏", () => {
  test("各区域都在，并且不访问外网", async ({ page }) => {
    const external = trackExternalRequests(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await open(page);

    await expect(page).toHaveTitle("Myles crypto");
    await expect(page.getByTestId("top-tabs")).toBeVisible();
    await expect(page.getByTestId("chart-toolbar")).toBeVisible();
    await expect(page.getByTestId("drawing-toolbar")).toBeVisible();
    await expect(page.getByTestId("pane-0").locator("canvas").first()).toBeVisible();
    await expect(page.getByTestId("mock-badge")).toHaveText("模拟数据");
    await expect(page.getByTestId("tab")).toHaveCount(6);
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-symbol", "BTCUSDT");
    await expect(page.getByTestId("legend")).toContainText("现货");
    await expect(page.getByTestId("legend")).toContainText("收");
    await expect(page.getByTestId("tab").nth(3)).toHaveAttribute("data-symbol", "AAPL");

    if (isWide(page)) {
      await expect(page.getByTestId("right-dock")).toBeVisible();
      await expect(page.getByTestId("market-overview")).toContainText("24h 成交额");
      await expect(page.getByTestId("dock-tab-feed")).toContainText("市场异动");
      await expect(page.getByTestId("watchlist")).toBeVisible();
    } else {
      await expect(page.getByTestId("right-dock")).toHaveCount(0);
    }

    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("页面本身不滚动", async ({ page }) => {
    await open(page);
    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - window.innerWidth,
      y: document.documentElement.scrollHeight - window.innerHeight,
    }));
    expect(overflow.x).toBeLessThanOrEqual(0);
    expect(overflow.y).toBeLessThanOrEqual(0);
  });

  test("每个按钮都有可读的名称", async ({ page }) => {
    await open(page);
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((b) => !b.getAttribute("aria-label") && !(b.textContent ?? "").trim())
        .map((b) => b.outerHTML.slice(0, 120)),
    );
    expect(unnamed).toEqual([]);
  });
});

test.describe("标签", () => {
  test("最多 8 个，第 9 个被阻止", async ({ page }) => {
    await open(page);
    await addSymbol(page, "AVAX");
    await addSymbol(page, "LINK");
    await expect(page.getByTestId("tab")).toHaveCount(8);
    await expect(page.getByTestId("tab-add")).toBeDisabled();
    await expect(page.getByTestId("tab").last()).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-symbol", "LINKUSDT.P");
  });

  test("添加已经打开的标的不会重复", async ({ page }) => {
    await open(page);
    await addSymbol(page, "ETH");
    await expect(page.getByTestId("tab")).toHaveCount(6);
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-symbol", "ETHUSDT.P");
  });

  test("关闭当前标签后切到相邻标签", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "关闭 BTCUSDT", exact: true }).click();
    await expect(page.getByTestId("tab")).toHaveCount(5);
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-symbol", "ETHUSDT.P");
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-phase", "ready");
  });

  test("标签和周期在刷新后保留", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "切换到 SOLUSDT.P" }).click();
    await page.getByTestId("tf-4h").click();
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-timeframe", "4h");
    await page.reload();
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-symbol", "SOLUSDT.P");
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-timeframe", "4h");
  });
});

test.describe("图表", () => {
  test("切换周期后图表更新，且不重建图表实例", async ({ page }) => {
    await open(page);
    const pane = page.getByTestId("pane-0");
    await pane.locator("canvas").first().evaluate((el) => ((window as unknown as { __canvas: Element }).__canvas = el));

    await page.getByTestId("tf-15m").click();
    await expect(pane).toHaveAttribute("data-timeframe", "15m");
    await page.getByTestId("tf-1h").click();
    await expect(pane).toHaveAttribute("data-timeframe", "1h");
    await expect(pane).toHaveAttribute("data-phase", "ready");
    await expect(page.getByTestId("legend")).toContainText("1时");
    await expect(page.getByTestId("tf-1h")).toHaveAttribute("aria-pressed", "true");

    const same = await pane
      .locator("canvas")
      .first()
      .evaluate((el) => el === (window as unknown as { __canvas: Element }).__canvas);
    expect(same).toBe(true);
  });

  test("实时行情更新最新价，图表实例保持不变", async ({ page }) => {
    await open(page);
    const pane = page.getByTestId("pane-0");
    await pane.locator("canvas").first().evaluate((el) => ((window as unknown as { __canvas: Element }).__canvas = el));
    const price = page.getByTestId("tab").first().locator(".tab__price");
    await expect(price).not.toHaveText("--");
    const before = await price.textContent();
    await expect(price).not.toHaveText(before ?? "", { timeout: 10_000 });
    const same = await pane
      .locator("canvas")
      .first()
      .evaluate((el) => el === (window as unknown as { __canvas: Element }).__canvas);
    expect(same).toBe(true);
  });

  test("四图布局显示四个不同的标的", async ({ page }) => {
    await open(page);
    await page.getByTestId("layout-4").click();
    const panes = page.locator('[data-testid^="pane-"]');
    await expect(panes).toHaveCount(4);
    for (let i = 0; i < 4; i++) await expect(page.getByTestId(`pane-${i}`)).toHaveAttribute("data-phase", "ready");
    const symbols = await panes.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.symbol));
    expect(new Set(symbols).size).toBe(4);

    await page.getByTestId("layout-1").click();
    await expect(panes).toHaveCount(1);
  });

  test("切换图表类型", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "图表类型" }).click();
    await page.getByRole("menuitemradio", { name: "折线图" }).click();
    await expect(page.getByRole("button", { name: "图表类型" })).toContainText("折线图");
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-phase", "ready");
  });

  test("截图会下载一张带标的和周期的图片", async ({ page }) => {
    await open(page);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "截图" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^myles-crypto-BTCUSDT-15m-\d{8}-\d{6}\.png$/);
  });
});

test.describe("周线和月线", () => {
  test("加密货币可以切到周线和月线", async ({ page }) => {
    await open(page);
    const pane = page.getByTestId("pane-0");
    for (const [tf, label] of [
      ["1w", "1周"],
      ["1M", "1月"],
    ] as const) {
      await page.getByTestId(`tf-${tf}`).click();
      await expect(pane).toHaveAttribute("data-timeframe", tf);
      await expect(pane).toHaveAttribute("data-phase", "ready");
      await expect(page.getByTestId("legend")).toContainText(label);
      await expect(page.getByTestId("legend-ma-99")).toHaveText(/^MA99 [\d,.]+$/);
    }
    // 1 分和 1 月的按钮只差大小写，不能串
    await page.getByTestId("tf-1m").click();
    await expect(pane).toHaveAttribute("data-timeframe", "1m");
    await expect(page.getByTestId("legend")).toContainText("1分");
  });

  test("美股的周线和月线由日线归并，同样带官方历史", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "切换到 AAPL", exact: true }).click();
    const pane = page.getByTestId("pane-0");
    await page.getByTestId("tf-1w").click();
    await expect(pane).toHaveAttribute("data-timeframe", "1w");
    await expect(pane).toHaveAttribute("data-phase", "ready");
    await expect(pane).toHaveAttribute("data-history", "official");
    await expect(page.getByTestId("legend-ma-25")).toHaveText(/^MA25 [\d,.]+$/);

    await page.getByTestId("tf-1M").click();
    await expect(pane).toHaveAttribute("data-timeframe", "1M");
    await expect(pane).toHaveAttribute("data-phase", "ready");
    await expect(page.getByTestId("legend-ma-7")).toHaveText(/^MA7 [\d,.]+$/);

    await page.reload();
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-timeframe", "1M");
  });
});

test.describe("多图十字光标联动", () => {
  test("在一张图上移动鼠标，另一张图的数值跟到同一时刻；移开后恢复", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 760, "手机宽度下多图是上下排列的，单独验证意义不大");
    await open(page);
    await page.getByTestId("layout-2").click();
    const left = page.getByTestId("pane-0");
    const right = page.getByTestId("pane-1");
    await expect(left).toHaveAttribute("data-phase", "ready");
    await expect(right).toHaveAttribute("data-phase", "ready");
    const rightLegend = right.getByTestId("legend");
    const leftLegend = left.getByTestId("legend");
    await expect(rightLegend).toContainText("收");

    // 先把鼠标放到别处，记下两张图各自"最新一根"的数值
    await page.getByTestId("top-tabs").hover();
    const rightLatest = await rightLegend.textContent();
    const leftLatest = await leftLegend.textContent();

    const box = (await left.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await expect(leftLegend).not.toHaveText(leftLatest ?? "");
    await expect(rightLegend).not.toHaveText(rightLatest ?? "");
    const rightAtFirst = await rightLegend.textContent();

    // 换一个位置，右图跟着变
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
    await expect(rightLegend).not.toHaveText(rightAtFirst ?? "");
    await expect(rightLegend).not.toHaveText(rightLatest ?? "");

    // 移出图表，两张图都回到最新一根
    await page.getByTestId("top-tabs").hover();
    await expect(leftLegend).toContainText("收");
    await expect(rightLegend).toHaveText(/MA7 [\d,.]+/);
    const num = (text: string | null) => (text ?? "").match(/开([\d,.]+)/)?.[1];
    await expect.poll(async () => num(await rightLegend.textContent())).toBe(num(rightLatest));
  });

  test("反方向也联动，且单图布局下不受影响", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 760, "同上");
    await open(page);
    await page.getByTestId("layout-2").click();
    const left = page.getByTestId("pane-0");
    const right = page.getByTestId("pane-1");
    await expect(right).toHaveAttribute("data-phase", "ready");
    await page.getByTestId("top-tabs").hover();
    const leftLatest = await left.getByTestId("legend").textContent();

    const box = (await right.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await expect(left.getByTestId("legend")).not.toHaveText(leftLatest ?? "");

    await page.getByTestId("layout-1").click();
    await expect(page.locator('[data-testid^="pane-"]')).toHaveCount(1);
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-phase", "ready");
  });
});

test.describe("绘图", () => {
  test("画一条水平线，刷新后仍在", async ({ page }) => {
    await open(page);
    const layer = page.getByTestId("drawing-layer");
    await expect(layer).toHaveAttribute("data-count", "0");

    await page.getByTestId("tool-horizontal-line").click();
    await expect(page.getByTestId("tool-horizontal-line")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("drawing-capture").click({ position: { x: 120, y: 160 } });

    await expect(layer).toHaveAttribute("data-count", "1");
    await expect(page.getByTestId("tool-cursor")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("drawing-horizontal-line")).toHaveCount(1);

    await page.reload();
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-phase", "ready");
    await expect(page.getByTestId("drawing-layer")).toHaveAttribute("data-count", "1");
    await expect(page.getByTestId("drawing-horizontal-line")).toHaveCount(1);
  });

  test("趋势线点两下完成，切换周期后仍然显示", async ({ page }) => {
    await open(page);
    await page.getByTestId("tool-trend-line").click();
    const capture = page.getByTestId("drawing-capture");
    await capture.click({ position: { x: 60, y: 220 } });
    await capture.click({ position: { x: 200, y: 140 } });
    await expect(page.getByTestId("drawing-layer")).toHaveAttribute("data-count", "1");
    await expect(page.getByTestId("drawing-trend-line")).toHaveCount(1);

    await page.getByTestId("tf-1h").click();
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-phase", "ready");
    await expect(page.getByTestId("drawing-trend-line")).toHaveCount(1);
  });

  test("删除、撤销和重做", async ({ page }) => {
    await open(page);
    await page.getByTestId("tool-rectangle").click();
    const capture = page.getByTestId("drawing-capture");
    await capture.click({ position: { x: 80, y: 120 } });
    await capture.click({ position: { x: 180, y: 220 } });
    const layer = page.getByTestId("drawing-layer");
    await expect(layer).toHaveAttribute("data-count", "1");

    // 点矩形的边框选中它，再按 Delete
    await page.getByTestId("drawing-rectangle").click({ position: { x: 3, y: 50 } });
    await expect(page.getByRole("button", { name: "删除选中的绘图" })).toBeEnabled();
    await page.keyboard.press("Delete");
    await expect(layer).toHaveAttribute("data-count", "0");

    await page.getByRole("button", { name: "撤销" }).click();
    await expect(layer).toHaveAttribute("data-count", "1");
    await page.getByRole("button", { name: "重做" }).click();
    await expect(layer).toHaveAttribute("data-count", "0");
  });

  test("按 Esc 取消画到一半的图形", async ({ page }) => {
    await open(page);
    await page.getByTestId("tool-trend-line").click();
    await page.getByTestId("drawing-capture").click({ position: { x: 60, y: 200 } });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tool-cursor")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("drawing-capture")).toHaveCount(0);
    await expect(page.getByTestId("drawing-layer")).toHaveAttribute("data-count", "0");
  });

  test("绘图按标的保存，换标的看不到别的标的的线", async ({ page }) => {
    await open(page);
    await page.getByTestId("tool-horizontal-line").click();
    await page.getByTestId("drawing-capture").click({ position: { x: 100, y: 180 } });
    await expect(page.getByTestId("drawing-layer")).toHaveAttribute("data-count", "1");

    await page.getByRole("button", { name: "切换到 ETHUSDT.P" }).click();
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-symbol", "ETHUSDT.P");
    await expect(page.getByTestId("drawing-layer")).toHaveAttribute("data-count", "0");

    await page.getByRole("button", { name: "切换到 BTCUSDT", exact: true }).click();
    await expect(page.getByTestId("drawing-layer")).toHaveAttribute("data-count", "1");
  });
});

test.describe("画线前的价格预览", () => {
  test("选了水平线后，鼠标所在位置显示虚线和价格，点下去的线就在这个价格", async ({ page }) => {
    await open(page);
    const preview = page.getByTestId("drawing-preview");
    await expect(preview).toHaveCount(0);

    await page.getByTestId("tool-horizontal-line").click();
    const capture = page.getByTestId("drawing-capture");
    await capture.hover({ position: { x: 150, y: 120 } });
    await expect(preview).toHaveCount(1);
    await expect(preview.locator("text")).toHaveText(/^[\d,]+\.\d+$/);
    await expect(preview.locator("line")).toHaveCount(1);
    await expect(preview.locator("line")).toHaveCSS("stroke-dasharray", "6px, 4px");
    const first = await preview.getAttribute("data-price");

    // 鼠标往下移，价格变低
    await capture.hover({ position: { x: 150, y: 220 } });
    const second = await preview.getAttribute("data-price");
    const num = (text: string | null) => Number((text ?? "").replace(/,/g, ""));
    expect(num(second)).toBeLessThan(num(first));

    await capture.click({ position: { x: 150, y: 220 } });
    await expect(preview).toHaveCount(0);
    await expect(page.getByTestId("drawing-horizontal-line")).toHaveCount(1);
    await expect(page.locator('[data-testid="drawing-layer"] .drawing__label')).toHaveText(second ?? "");
  });

  test("预览线用当前选的颜色，鼠标移出图表后消失", async ({ page }) => {
    await open(page);
    await page.getByTestId("color-button").click();
    await page.getByTestId("color-ff526b").click();
    await page.getByTestId("tool-horizontal-line").click();
    await page.getByTestId("drawing-capture").hover({ position: { x: 150, y: 120 } });
    const preview = page.getByTestId("drawing-preview");
    await expect(preview.locator("line")).toHaveCSS("stroke", "rgb(255, 82, 107)");

    await page.getByTestId("tool-horizontal-line").hover();
    await expect(preview).toHaveCount(0);
  });

  test("趋势线在点第一个点之前显示十字虚线，点下去后改为显示正在画的线", async ({ page }) => {
    await open(page);
    await page.getByTestId("tool-trend-line").click();
    const capture = page.getByTestId("drawing-capture");
    await capture.hover({ position: { x: 100, y: 150 } });
    const preview = page.getByTestId("drawing-preview");
    await expect(preview.locator("line")).toHaveCount(2);
    await expect(preview.locator("text")).toHaveText(/^[\d,]+\.\d+$/);

    await capture.click({ position: { x: 100, y: 150 } });
    await capture.hover({ position: { x: 200, y: 100 } });
    await expect(preview).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
  });
});

test.describe("绘图颜色", () => {
  const RED = "#ff526b";
  const GREEN = "#2edb83";
  const YELLOW = "#f0b90b";

  async function pickColor(page: Page, hex: string) {
    await page.getByTestId("color-button").click();
    await page.getByTestId(`color-${hex.slice(1)}`).click();
    await expect(page.getByTestId("color-palette")).toHaveCount(0);
  }

  async function drawHorizontal(page: Page, y: number) {
    await page.getByTestId("tool-horizontal-line").click();
    await page.getByTestId("drawing-capture").click({ position: { x: 120, y } });
  }

  test("选了颜色再画，线就是那个颜色；换颜色不会改掉已经画好的线", async ({ page }) => {
    await open(page);
    const lines = page.getByTestId("drawing-horizontal-line");

    await pickColor(page, GREEN);
    await expect(page.getByTestId("color-button")).toHaveAttribute("data-color", GREEN);
    await drawHorizontal(page, 200);
    await expect(lines).toHaveCount(1);
    await expect(lines.first()).toHaveAttribute("data-color", GREEN);

    await pickColor(page, RED);
    await drawHorizontal(page, 100);
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toHaveAttribute("data-color", GREEN);
    await expect(lines.nth(1)).toHaveAttribute("data-color", RED);

    // 屏幕上真正画出来的颜色也对
    const strokes = await page
      .locator('[data-testid="drawing-layer"] line.drawing')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).stroke));
    expect(strokes).toEqual(["rgb(46, 219, 131)", "rgb(255, 82, 107)"]);
    await expect(page.locator('[data-testid="drawing-layer"] .drawing__label').first()).toHaveCSS("fill", "rgb(46, 219, 131)");
  });

  test("选中一条线后改颜色，可以撤销，刷新后保留", async ({ page }) => {
    await open(page);
    const lines = page.getByTestId("drawing-horizontal-line");
    await pickColor(page, GREEN);
    await drawHorizontal(page, 200);
    await pickColor(page, RED);
    await drawHorizontal(page, 100);

    // 水平线没有高度，测试工具会认为它"不可见"而拒绝点击，所以按坐标点在线上
    const rect = await lines.first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(rect.x, rect.y);
    await expect(page.getByTestId("color-button")).toHaveAttribute("data-color", GREEN);
    await expect(page.getByTestId("color-button")).toHaveAttribute("aria-label", "修改选中绘图的颜色");
    await pickColor(page, YELLOW);
    await expect(lines.nth(0)).toHaveAttribute("data-color", YELLOW);
    await expect(lines.nth(1)).toHaveAttribute("data-color", RED);

    await page.getByRole("button", { name: "撤销" }).click();
    await expect(lines.nth(0)).toHaveAttribute("data-color", GREEN);
    await page.getByRole("button", { name: "重做" }).click();
    await expect(lines.nth(0)).toHaveAttribute("data-color", YELLOW);

    await page.reload();
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-phase", "ready");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toHaveAttribute("data-color", YELLOW);
    await expect(lines.nth(1)).toHaveAttribute("data-color", RED);
    await expect(page.getByTestId("color-button")).toHaveAttribute("data-color", YELLOW);
  });

  test("趋势线和矩形也跟随所选颜色，自定义颜色可用", async ({ page }) => {
    await open(page);
    await page.getByTestId("color-button").click();
    await page.getByLabel("自定义颜色").fill("#12abef");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("color-button")).toHaveAttribute("data-color", "#12abef");

    await page.getByTestId("tool-trend-line").click();
    const capture = page.getByTestId("drawing-capture");
    await capture.click({ position: { x: 60, y: 220 } });
    await capture.click({ position: { x: 200, y: 140 } });
    await expect(page.getByTestId("drawing-trend-line")).toHaveAttribute("data-color", "#12abef");

    await pickColor(page, RED);
    await page.getByTestId("tool-rectangle").click();
    await page.getByTestId("drawing-capture").click({ position: { x: 80, y: 60 } });
    await page.getByTestId("drawing-capture").click({ position: { x: 160, y: 120 } });
    await expect(page.getByTestId("drawing-rectangle")).toHaveAttribute("data-color", RED);
    await expect(page.locator('[data-testid="drawing-layer"] rect.drawing--rect')).toHaveCSS("fill", "rgb(255, 82, 107)");
  });

  test("没有颜色的旧绘图用默认的蓝色", async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem(
        "mc.drawings.v1",
        JSON.stringify({
          byMarket: {
            "binance:spot:BTCUSDT": [
              { id: "old", type: "horizontal-line", points: [{ time: 1700000000, price: 84000 }], locked: false, hidden: false },
            ],
          },
        }),
      );
    });
    await open(page);
    await expect(page.getByTestId("drawing-layer")).toHaveAttribute("data-count", "1");
    await expect(page.getByTestId("color-button")).toHaveAttribute("data-color", "#4f7cff");
  });
});

test.describe("右侧栏", () => {
  test("宽屏下收起后图表自动变宽", async ({ page }) => {
    test.skip(!isWide(page), "只在宽屏下适用");
    await open(page);
    const pane = page.getByTestId("pane-0");
    const before = (await pane.boundingBox())!.width;
    const canvasBefore = (await pane.locator("canvas").first().boundingBox())!.width;

    await page.getByTestId("dock-toggle").click();
    await expect(page.getByTestId("right-dock")).toHaveCount(0);
    await expect.poll(async () => (await pane.boundingBox())!.width).toBeGreaterThan(before + 200);
    await expect.poll(async () => (await pane.locator("canvas").first().boundingBox())!.width).toBeGreaterThan(canvasBefore + 200);

    await page.reload();
    await expect(page.getByTestId("right-dock")).toHaveCount(0);
  });

  test("窄屏下是默认收起的抽屉", async ({ page }) => {
    test.skip(isWide(page), "只在窄屏下适用");
    await open(page);
    await expect(page.getByTestId("right-dock")).toHaveCount(0);
    await page.getByTestId("dock-toggle").click();
    await expect(page.getByTestId("right-dock")).toBeVisible();
    // 点击抽屉左侧露出的遮罩关闭
    await page.locator(".dock__scrim").click({ position: { x: 5, y: 200 } });
    await expect(page.getByTestId("right-dock")).toHaveCount(0);
  });

  test("窄屏下绘图栏在图表下方", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) > 760, "只在手机宽度下适用");
    await open(page);
    const tools = (await page.getByTestId("drawing-toolbar").boundingBox())!;
    const pane = (await page.getByTestId("pane-0").boundingBox())!;
    expect(tools.y).toBeGreaterThanOrEqual(pane.y + pane.height - 1);
  });

  test("模拟行情会产生异动事件", async ({ page }) => {
    test.skip(!isWide(page), "只在宽屏下适用");
    await open(page);
    await page.getByTestId("dock-tab-feed").click();
    await expect(page.getByTestId("event-feed")).toBeVisible();
    await expect(page.locator(".event").first()).toBeVisible({ timeout: 25_000 });
    await expect(page.locator(".event").first()).toContainText("爆仓");
  });
});

test.describe("弹窗与设置", () => {
  test("需要登录的功能会弹出说明", async ({ page }) => {
    await open(page);
    await page.getByTestId("alert-button").click();
    const dialog = page.getByTestId("auth-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("价格提醒");
    await dialog.getByRole("button", { name: "知道了" }).click();
    await expect(dialog).toBeHidden();
  });

  test("切换为红涨绿跌并在刷新后保留", async ({ page }) => {
    await open(page);
    await page.getByTestId("settings-button").click();
    const dialog = page.getByTestId("settings-dialog");
    await dialog.getByRole("button", { name: "红涨绿跌" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-up-color", "red");
    await dialog.getByRole("button", { name: "完成" }).click();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-up-color", "red");
  });

  test("按 Esc 关闭标的选择", async ({ page }) => {
    await open(page);
    await page.getByTestId("symbol-button").click();
    await expect(page.getByTestId("symbol-picker")).toBeVisible();
    await expect(page.getByLabel("搜索标的")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("symbol-picker")).toBeHidden();
  });
});

test.describe("标的分类与美股", () => {
  test("按分类浏览：美股、商品、加密现货", async ({ page }) => {
    await open(page);
    await page.getByTestId("tab-add").click();
    const picker = page.getByTestId("symbol-picker");
    const symbols = () => picker.getByTestId("picker-row").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.symbol));

    await picker.getByTestId("group-stock").click();
    await expect(picker.getByTestId("picker-row").first()).toBeVisible();
    expect(await symbols()).toEqual(expect.arrayContaining(["AAPL", "NVDA", "TSLA", "MSFT", "QQQ"]));
    expect(await symbols()).not.toContain("BTCUSDT.P");
    await expect(picker).toContainText("永续合约");

    await picker.getByTestId("group-commodity").click();
    await expect.poll(symbols).toEqual(expect.arrayContaining(["XAU", "CL"]));
    expect(await symbols()).not.toContain("AAPL");

    await picker.getByTestId("group-spot").click();
    await expect.poll(symbols).toContain("BTCUSDT");
    expect(await symbols()).not.toContain("AAPL");

    await picker.getByTestId("group-crypto").click();
    await expect.poll(symbols).toContain("BTCUSDT.P");
    expect(await symbols()).not.toContain("XAU");
  });

  test("从美股分类添加一只股票", async ({ page }) => {
    await open(page);
    await page.getByTestId("tab-add").click();
    const picker = page.getByTestId("symbol-picker");
    await picker.getByTestId("group-stock").click();
    await picker.locator('[data-testid="picker-row"][data-symbol="MSFT"] .picker__main').click();
    await expect(picker).toBeHidden();

    const pane = page.getByTestId("pane-0");
    await expect(page.getByTestId("tab")).toHaveCount(7);
    await expect(pane).toHaveAttribute("data-symbol", "MSFT");
    await expect(pane).toHaveAttribute("data-phase", "ready");
    await expect(page.getByTestId("legend")).toContainText("美股合约");

    await page.reload();
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-symbol", "MSFT");
    await expect(page.getByTestId("legend")).toContainText("美股合约");
  });

  test("搜索不受当前分类限制", async ({ page }) => {
    await open(page);
    await page.getByTestId("tab-add").click();
    const picker = page.getByTestId("symbol-picker");
    await picker.getByTestId("group-commodity").click();
    await picker.getByLabel("搜索标的").fill("nvda");
    await expect(picker.getByTestId("picker-row").first()).toHaveAttribute("data-symbol", "NVDA");
    await picker.getByLabel("搜索标的").fill("zzzz");
    await expect(picker).toContainText("没有找到匹配的标的");
  });
});

test.describe("美股交易时段", () => {
  test("美股默认只显示交易时段，均线有足够的数据", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "切换到 AAPL", exact: true }).click();
    const pane = page.getByTestId("pane-0");
    await expect(pane).toHaveAttribute("data-symbol", "AAPL");
    await expect(pane).toHaveAttribute("data-phase", "ready");
    await expect(pane).toHaveAttribute("data-session", "regular");
    await expect(page.getByTestId("session-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("session-toggle")).toContainText("交易时段");
    await expect(page.getByTestId("session-note")).toContainText("仅交易时段");
    await expect(pane).toHaveAttribute("data-history", "official");
    await expect(page.getByTestId("session-note")).toContainText("官方历史");
    // 过滤后一页里剩下的 K 线不多，要自动往前多取几页，最长的均线才算得出来
    await expect(page.getByTestId("legend-ma-99")).toHaveText(/^MA99 [\d,.]+$/);

    for (const tf of ["1m", "30m", "1h", "4h", "1d"]) {
      await page.getByTestId(`tf-${tf}`).click();
      await expect(pane).toHaveAttribute("data-timeframe", tf);
      await expect(pane).toHaveAttribute("data-phase", "ready");
      await expect(page.getByTestId("legend-ma-99")).toHaveText(/^MA99 [\d,.]+$/);
    }
  });

  test("可以切回 24 小时，刷新后保留", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "切换到 NVDA", exact: true }).click();
    const pane = page.getByTestId("pane-0");
    await expect(pane).toHaveAttribute("data-session", "regular");

    await page.getByTestId("session-toggle").click();
    await expect(pane).toHaveAttribute("data-session", "all");
    await expect(pane).toHaveAttribute("data-phase", "ready");
    // 24 小时视图看的是合约本身，不混入官方股价历史
    await expect(pane).toHaveAttribute("data-history", "contract");
    await expect(page.getByTestId("session-toggle")).toContainText("24 小时");
    await expect(page.getByTestId("session-note")).toHaveCount(0);
    await expect(page.getByTestId("legend-ma-99")).toHaveText(/^MA99 [\d,.]+$/);

    await page.reload();
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-symbol", "NVDA");
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-session", "all");

    await page.getByTestId("session-toggle").click();
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-session", "regular");
  });

  test("有官方历史时，日线能算出 250 日均线", async ({ page }) => {
    await open(page);
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-dialog").getByRole("button", { name: "股票软件常用" }).click();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "切换到 AAPL", exact: true }).click();
    await page.getByTestId("tf-1d").click();
    const pane = page.getByTestId("pane-0");
    await expect(pane).toHaveAttribute("data-timeframe", "1d");
    await expect(pane).toHaveAttribute("data-phase", "ready");
    await expect(pane).toHaveAttribute("data-history", "official");
    for (const period of [5, 10, 20, 30, 60, 120, 250]) {
      await expect(page.getByTestId(`legend-ma-${period}`)).toHaveText(new RegExp(`^MA${period} [\\d,.]+$`));
    }

    // 切到 24 小时后只剩合约数据，模拟的合约历史足够长，这里只确认图表仍然正常
    await page.getByTestId("session-toggle").click();
    await expect(pane).toHaveAttribute("data-history", "contract");
    await expect(pane).toHaveAttribute("data-phase", "ready");
  });

  test("加密货币和商品不受影响，也没有这个开关", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-session", "all");
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-history", "contract");
    await expect(page.getByTestId("session-toggle")).toHaveCount(0);

    await page.getByRole("button", { name: "切换到 ETHUSDT.P" }).click();
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-session", "all");
    await expect(page.getByTestId("session-toggle")).toHaveCount(0);

    await addSymbol(page, "XAU");
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-symbol", "XAU");
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-session", "all");
    await expect(page.getByTestId("session-toggle")).toHaveCount(0);
  });

  test("只看交易时段时画线和副图仍然正常", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "切换到 TSLA", exact: true }).click();
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-phase", "ready");
    await page.getByTestId("indicator-button").click();
    await page.getByTestId("indicator-macd").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("indicator-label-macd")).toHaveText(/DIF -?[\d,.]+/);

    await page.getByTestId("tool-trend-line").click();
    const capture = page.getByTestId("drawing-capture");
    await capture.click({ position: { x: 60, y: 120 } });
    await capture.click({ position: { x: 220, y: 60 } });
    await expect(page.getByTestId("drawing-trend-line")).toHaveCount(1);

    await page.getByTestId("tf-1h").click();
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-phase", "ready");
    await expect(page.getByTestId("drawing-trend-line")).toHaveCount(1);
  });
});

test.describe("美股的涨跌口径与实时更新", () => {
  // 把页面里的时间拨到指定时刻（夏令时：开盘 13:30 UTC，收盘 20:00 UTC）
  async function openAt(page: Page, iso: string) {
    await page.clock.install({ time: new Date(iso) });
    await open(page);
  }

  const aapl = (page: Page) => page.locator('[data-testid="tab"][data-symbol="AAPL"]');

  test("盘前：美股标出盘前，涨跌幅以最近一次收盘价为基准", async ({ page }) => {
    await openAt(page, "2026-10-12T10:18:00Z");
    await expect(aapl(page).getByTestId("tab-phase")).toHaveText("盘前");
    // 加密货币不受影响
    await expect(page.locator('[data-testid="tab"][data-symbol="BTCUSDT"]').getByTestId("tab-phase")).toHaveCount(0);

    if (!isWide(page)) return;
    await page.getByRole("button", { name: "切换到 AAPL", exact: true }).click();
    const overview = page.getByTestId("market-overview");
    await expect(overview).toContainText("盘前涨跌");
    await expect(overview).toContainText("收盘价（10/9）");
    await expect(overview).not.toContainText("24h 涨跌");

    // 概览里的涨跌幅 = (现价 − 收盘价) / 收盘价
    const num = (text: string | null) => Number((text ?? "").replace(/[,+%]/g, "").replace("−", "-").trim().split(" ")[0]);
    const refClose = num(await page.getByTestId("overview-ref-close").textContent());
    const price = num(await overview.locator(".overview__price").textContent());
    const shown = num(await page.getByTestId("overview-change").textContent());
    expect(refClose).toBeGreaterThan(0);
    expect(shown).toBeCloseTo(((price - refClose) / refClose) * 100, 1);
  });

  test("盘中不标时段，盘后和周末分别标出", async ({ page }) => {
    await openAt(page, "2026-10-08T15:00:00Z");
    await expect(aapl(page).locator(".tab__pct")).not.toHaveText("--");
    await expect(aapl(page).getByTestId("tab-phase")).toHaveCount(0);
    if (isWide(page)) {
      await page.getByRole("button", { name: "切换到 AAPL", exact: true }).click();
      await expect(page.getByTestId("market-overview")).toContainText("今日涨跌");
      await expect(page.getByTestId("market-overview")).toContainText("昨收（10/7）");
      await expect(page.getByTestId("session-note")).toHaveAttribute("data-open", "true");
    }

    await page.clock.setSystemTime(new Date("2026-10-08T21:00:00Z"));
    await page.reload();
    await expect(aapl(page).getByTestId("tab-phase")).toHaveText("盘后");

    await page.clock.setSystemTime(new Date("2026-10-10T15:00:00Z"));
    await page.reload();
    await expect(aapl(page).getByTestId("tab-phase")).toHaveText("休市");
  });

  test("开盘期间每走完一根 K 线，自动补取一次官方数据", async ({ page }) => {
    // 15:00:45，再过 15 秒这根 1 分钟线就走完
    await openAt(page, "2026-10-08T15:00:45Z");
    await page.getByRole("button", { name: "切换到 AAPL", exact: true }).click();
    await page.getByTestId("tf-1m").click();
    const pane = page.getByTestId("pane-0");
    await expect(pane).toHaveAttribute("data-timeframe", "1m");
    await expect(pane).toHaveAttribute("data-phase", "ready");
    await expect(pane).toHaveAttribute("data-history", "official");
    await expect(pane).toHaveAttribute("data-official-refreshes", "0");

    // 走过整分钟，再过完等待时间
    await page.clock.fastForward(20_000);
    await page.clock.fastForward(65_000);
    await expect(pane).toHaveAttribute("data-official-refreshes", "1");
    await expect(pane).toHaveAttribute("data-phase", "ready");
    await expect(page.getByTestId("legend-ma-7")).toHaveText(/^MA7 [\d,.]+$/);

    // 换标的后计数重新开始
    await page.getByRole("button", { name: "切换到 NVDA", exact: true }).click();
    await expect(pane).toHaveAttribute("data-symbol", "NVDA");
    await expect(pane).toHaveAttribute("data-official-refreshes", "0");
  });

  test("休市期间不会去补取官方数据", async ({ page }) => {
    await openAt(page, "2026-10-10T15:00:45Z");
    await page.getByRole("button", { name: "切换到 AAPL", exact: true }).click();
    await page.getByTestId("tf-1m").click();
    const pane = page.getByTestId("pane-0");
    await expect(pane).toHaveAttribute("data-phase", "ready");
    await page.clock.fastForward(20_000);
    await page.clock.fastForward(65_000);
    await expect(pane).toHaveAttribute("data-official-refreshes", "0");
  });
});

test.describe("自选", () => {
  test("默认有自选，点击一行在图表里打开", async ({ page }) => {
    test.skip(!isWide(page), "只在宽屏下适用");
    await open(page);
    const rows = page.getByTestId("watch-row");
    await expect(rows).toHaveCount(11);
    await expect(rows.first()).toHaveAttribute("data-symbol", "BTCUSDT");
    await expect(rows.first().locator(".watch__main")).not.toContainText("--");

    // XAU 不在默认标签里，点击后新开一个标签
    await page.getByRole("button", { name: "打开 XAU", exact: true }).click();
    await expect(page.getByTestId("tab")).toHaveCount(7);
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-symbol", "XAU");
    await expect(page.getByTestId("legend")).toContainText("商品合约");

    // ETH 已经有标签，点击只是切过去
    await page.getByRole("button", { name: "打开 ETHUSDT.P", exact: true }).click();
    await expect(page.getByTestId("tab")).toHaveCount(7);
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-symbol", "ETHUSDT.P");
  });

  test("用工具栏的星标加入和移出自选，刷新后保留", async ({ page }) => {
    test.skip(!isWide(page), "只在宽屏下适用");
    await open(page);
    await addSymbol(page, "LINK");
    const star = page.getByTestId("watch-toggle");
    await expect(star).toHaveAttribute("aria-pressed", "false");

    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("watch-row")).toHaveCount(12);
    await expect(page.getByTestId("watch-row").last()).toHaveAttribute("data-symbol", "LINKUSDT.P");

    await page.reload();
    await expect(page.getByTestId("watch-row")).toHaveCount(12);

    await page.getByRole("button", { name: "把 LINKUSDT.P 移出自选" }).first().click();
    await expect(page.getByTestId("watch-row")).toHaveCount(11);
  });

  test("在搜索里点星标加入自选，不会关闭弹窗也不会新开标签", async ({ page }) => {
    test.skip(!isWide(page), "只在宽屏下适用");
    await open(page);
    await page.getByTestId("watch-add").click();
    const picker = page.getByTestId("symbol-picker");
    await expect(picker).toContainText("管理自选");
    await expect(picker.getByTestId("picker-row")).toHaveCount(11);

    await picker.getByTestId("group-stock").click();
    const msft = picker.locator('[data-testid="picker-row"][data-symbol="MSFT"]');
    await msft.locator(".picker__star").click();
    await expect(msft.locator(".picker__star")).toHaveAttribute("aria-pressed", "true");
    await expect(picker).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("watch-row")).toHaveCount(12);
    await expect(page.getByTestId("tab")).toHaveCount(6);
  });

  test("标签满了时从自选打开会替换当前标签", async ({ page }) => {
    test.skip(!isWide(page), "只在宽屏下适用");
    await open(page);
    await addSymbol(page, "AVAX");
    await addSymbol(page, "LINK");
    await expect(page.getByTestId("tab")).toHaveCount(8);
    await page.getByRole("button", { name: "打开 XAU", exact: true }).click();
    await expect(page.getByTestId("tab")).toHaveCount(8);
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-symbol", "XAU");
  });
});

test.describe("技术指标", () => {
  test("默认显示三条均线，图例里有数值", async ({ page }) => {
    await open(page);
    for (const period of [7, 25, 99]) {
      await expect(page.getByTestId(`legend-ma-${period}`)).toHaveText(new RegExp(`^MA${period} [\\d,.]+$`));
    }
    await expect(page.getByTestId("indicator-label-macd")).toHaveCount(0);
    await expect(page.getByTestId("indicator-label-rsi")).toHaveCount(0);
  });

  test("开启 MACD 和 RSI 后出现副图和数值，刷新后保留", async ({ page }) => {
    await open(page);
    const layer = page.getByTestId("drawing-layer");
    const heightBefore = Number(await layer.getAttribute("height"));

    await page.getByTestId("indicator-button").click();
    await page.getByTestId("indicator-macd").click();
    await expect(page.getByTestId("indicator-macd")).toHaveAttribute("aria-checked", "true");
    const macd = page.getByTestId("indicator-label-macd");
    await expect(macd).toContainText("MACD(12,26,9)");
    await expect(macd).toHaveText(/DIF -?[\d,.]+/);
    await expect(macd).toHaveText(/DEA -?[\d,.]+/);

    await page.getByTestId("indicator-rsi").click();
    const rsi = page.getByTestId("indicator-label-rsi");
    await expect(rsi).toHaveText(/RSI\(14\)\s*\d+\.\d\d/);
    await page.keyboard.press("Escape");

    // 主图让出空间给两个副图，绘图层跟着主图变矮
    await expect.poll(async () => Number(await layer.getAttribute("height"))).toBeLessThan(heightBefore - 60);
    const macdTop = (await macd.boundingBox())!.y;
    const rsiTop = (await rsi.boundingBox())!.y;
    expect(rsiTop).toBeGreaterThan(macdTop + 30);
    await expect(page.getByTestId("indicator-button")).toContainText("3");

    await page.reload();
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-phase", "ready");
    await expect(page.getByTestId("indicator-label-macd")).toBeVisible();
    await expect(page.getByTestId("indicator-label-rsi")).toBeVisible();

    await page.getByTestId("indicator-button").click();
    await page.getByTestId("indicator-macd").click();
    await expect(page.getByTestId("indicator-label-macd")).toHaveCount(0);
    await expect(page.getByTestId("indicator-label-rsi")).toBeVisible();
  });

  test("关闭均线后图例里不再显示", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("legend-ma-7")).toBeVisible();
    await page.getByTestId("indicator-button").click();
    await page.getByTestId("indicator-ma").click();
    await expect(page.getByTestId("legend-ma-7")).toHaveCount(0);
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-phase", "ready");
  });

  test("在设置里修改均线周期：边输入边生效，填错时保持原样", async ({ page }) => {
    await open(page);
    await page.getByTestId("settings-button").click();
    const dialog = page.getByTestId("settings-dialog");
    const input = dialog.getByTestId("ma-periods");
    await expect(input).toHaveValue("7, 25, 99");

    // 不按回车、不点别处，输入合法内容后图表就已经变了
    await input.fill("60，5 10、20");
    for (const period of [5, 10, 20, 60]) await expect(page.getByTestId(`legend-ma-${period}`)).toBeVisible();
    await expect(page.getByTestId("legend-ma-7")).toHaveCount(0);
    await expect(page.getByTestId("legend-ma-99")).toHaveCount(0);

    await input.fill("5, abc");
    await expect(dialog.getByTestId("ma-periods-error")).toContainText("暂未生效");
    await expect(page.getByTestId("legend-ma-60")).toBeVisible();

    await input.fill("3, 7, 100");
    await expect(dialog.getByTestId("ma-periods-error")).toHaveCount(0);
    for (const period of [3, 7, 100]) await expect(page.getByTestId(`legend-ma-${period}`)).toHaveText(/^MA\d+ [\d,.]+$/);

    // 一键套用股票软件常用的 7 条
    await dialog.getByRole("button", { name: "股票软件常用" }).click();
    await expect(input).toHaveValue("5, 10, 20, 30, 60, 120, 250");
    for (const period of [5, 10, 20, 30, 60, 120, 250]) await expect(page.getByTestId(`legend-ma-${period}`)).toBeVisible();
    await input.fill("3, 7, 100");

    // 用 Esc 关掉弹窗也不会丢
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("legend-ma-100")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("legend-ma-100")).toBeVisible();
    await page.getByTestId("indicator-button").click();
    await expect(page.getByTestId("indicator-ma")).toContainText("3 / 7 / 100");
  });

  test("开着副图时画线仍然正常", async ({ page }) => {
    await open(page);
    await page.getByTestId("indicator-button").click();
    await page.getByTestId("indicator-macd").click();
    await page.getByTestId("indicator-rsi").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("indicator-label-rsi")).toBeVisible();

    await page.getByTestId("tool-horizontal-line").click();
    await page.getByTestId("drawing-capture").click({ position: { x: 120, y: 80 } });
    await expect(page.getByTestId("drawing-layer")).toHaveAttribute("data-count", "1");
    await expect(page.getByTestId("drawing-horizontal-line")).toHaveCount(1);
  });

  test("切换标的、周期和图表类型后指标仍然有数值", async ({ page }) => {
    await open(page);
    await page.getByTestId("indicator-button").click();
    await page.getByTestId("indicator-macd").click();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "切换到 ETHUSDT.P" }).click();
    await page.getByTestId("tf-1h").click();
    await expect(page.getByTestId("pane-0")).toHaveAttribute("data-phase", "ready");
    await expect(page.getByTestId("legend-ma-99")).toHaveText(/^MA99 [\d,.]+$/);
    await expect(page.getByTestId("indicator-label-macd")).toHaveText(/DIF -?[\d,.]+/);

    await page.getByRole("button", { name: "图表类型" }).click();
    await page.getByRole("menuitemradio", { name: "折线图" }).click();
    await expect(page.getByTestId("legend-ma-7")).toHaveText(/^MA7 [\d,.]+$/);
    await expect(page.getByTestId("indicator-label-macd")).toBeVisible();
  });
});

test.describe("本地数据损坏", () => {
  test("某一条记录损坏时只重置那一条", async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("mc.tabs.v1", "{这不是合法的 JSON");
      localStorage.setItem("mc.layout.v1", JSON.stringify({ layout: 7, panes: "x" }));
      localStorage.setItem(
        "mc.drawings.v1",
        JSON.stringify({
          byMarket: {
            "binance:spot:BTCUSDT": [
              { id: "keep", type: "horizontal-line", points: [{ time: 1700000000, price: 84000 }], locked: false, hidden: false },
            ],
          },
        }),
      );
    });
    await open(page);
    await expect(page.getByTestId("tab")).toHaveCount(6);
    await expect(page.locator('[data-testid^="pane-"]')).toHaveCount(1);
    await expect(page.getByTestId("drawing-layer")).toHaveAttribute("data-count", "1");
  });
});
