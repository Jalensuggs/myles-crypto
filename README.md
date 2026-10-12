# Myles crypto

桌面优先的实时看盘终端，可以看加密货币，也可以看美股和商品。只看盘和分析，不下单。界面为简体中文。

行情来自 Binance 公开接口，美股的历史 K 线另外用了 Yahoo 财经的数据。全部免费、不用注册、不用 API key。除了一条转发规则，没有后端。

完整的产品与技术规格见 [SPEC.md](SPEC.md)。

## 启动

需要 Node.js 22 或更高版本。

```bash
npm install
```

```bash
npm run dev
```

然后打开终端里显示的地址（默认 `http://localhost:5173`）。

如果所在网络访问不了 Binance，可以先用模拟数据看界面：

```bash
npm run dev:mock
```

模拟数据模式下工具栏会显示"模拟数据"标记，价格是程序生成的，不是真实行情。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式，真实行情 |
| `npm run dev:mock` | 开发模式，模拟数据，端口 5183 |
| `npm run build` | 类型检查并打包到 `dist/` |
| `npm run typecheck` | 只做类型检查 |
| `npm run lint` | 代码检查 |
| `npm run test` | 单元测试 |
| `npm run test:e2e` | 浏览器验收测试（模拟数据，使用本机的 Chrome） |

## 已实现

- 最多 8 个标的标签，显示实时价格和 24 小时涨跌幅
- 加密合约、加密现货、美股、商品，按分类浏览，也可以直接搜索代码
- 自选列表：星标加入，实时价格，点击即可在图表里打开
- 周期 1 分、5 分、15 分、30 分、1 时、4 时、1 日、1 周、1 月
- 蜡烛图、美国线、折线图、面积图，带成交量
- 单图、双图、四图布局，每个面板独立的标的和周期
- 向左拖动自动加载更早的历史
- 技术指标：MA 均线（默认 7 / 25 / 99，可在设置里改，最多 8 条）、MACD（12, 26, 9）、RSI（14）
- 绘图：趋势线、水平线、矩形；画之前有虚线预览落点价格，可选颜色，可拖动、改端点、删除、撤销、重做、全部锁定、全部隐藏
- 右侧市场概览：标记价格、资金费率与结算倒计时、持仓量、24 小时高低和成交额、恐惧贪婪指数
- 右侧市场异动：大额爆仓、急涨急跌、资金费率异常、突破 24 小时区间
- 截图（包含绘图）、全屏、绿涨红跌与红涨绿跌切换
- 标签、布局、绘图、设置和异动记录保存在浏览器本地
- 断线自动重连并补齐断线期间的 K 线
- 宽屏、笔记本和手机三种宽度的布局

## 暂未实现

- 回放、价格提醒
- 其他技术指标（布林带、KDJ 等）和 MACD、RSI 的参数调整
- 登录和云端同步（入口已预留，点击会弹出说明）
- Binance 以外的交易所
- 斐波那契等高级绘图工具
- 外汇和市值指数类标的（没有稳定的免费数据源）

## 关于美股和商品

这里的美股（AAPL、NVDA、TSLA 等约 180 个）和商品（黄金、白银、原油等）用的是 Binance 上跟踪其价格的永续合约，所以免费、实时，也不需要另接数据源。使用时注意三点：

- 它们是合约，不是股票本身，以 USDT 计价。
- 24 小时交易，价格和交易所官方报价会有小幅偏差，休市时段也会波动。
- 历史数据只从合约上线那天开始，比如 AAPL 是 2026 年 4 月。

### 只显示交易时段

合约周末和夜里也在出 K 线，而股票软件只有交易时段的 K 线。如果不处理，同样是"MA99"覆盖的时间段完全不同，均线会和股票软件对不上。所以美股图表默认只保留美东时间周一到周五 9:30–16:00 的 K 线，工具栏上的"交易时段 / 24 小时"按钮可以切换。

### 历史用官方股价，实时用合约

只显示交易时段时，一张美股图表由两部分拼成：

- **历史 K 线来自官方股价数据**（Yahoo 财经）。日线能回溯 10 年，1 小时线约 2 年，5 到 30 分钟线 60 天，1 分钟线 7 天。日线做了前复权，和国内股票软件的默认口径一致。
- **最新一根 K 线来自 Binance 合约**，所以价格是实时跳动的。休市期间官方数据的最后一根已经定型，就直接用官方的。
- 比官方数据更早的部分（比如 60 天以前的 15 分钟线）仍然用合约数据补。

用富途的美光（MU）日线核对过（2026-10-12）：MA5 / 10 / 20 / 30 / 60 / 120 / 250 七条均线全部一致。

图例里显示"官方历史"表示这部分生效了。如果官方数据取不到，图表会自动退回只用合约数据，这时历史只从合约上线那天开始，图例里也不会有"官方历史"几个字。

需要注意：

- Yahoo 的这个接口不是正式对外的，没有文档和可用性保证，可能失效或限流。
- 接入前会核对官方数据和合约是不是同一只股票（重叠部分价格相差超过 3% 就不用），避免代码相同但其实是另一只股票。
- 最新一根的成交量是合约的成交量，比股票的小得多，所以最右边那根成交量柱会很矮。
- 提前收盘的半日市（感恩节次日、平安夜）按全天处理。
- 用合约数据补的那部分（以及官方数据取不到时的全部），1 小时、4 小时和日线是用 30 分钟的交易时段 K 线从 9:30 起合成的，切分方式和股票软件一致。

切到"24 小时"后看的是合约本身，不混入官方数据。

### 部署到线上时的转发规则

浏览器不能直接访问 Yahoo（它不允许跨域），所以页面请求的是本站的 `/yahoo/...`，由服务器转给 `https://query1.finance.yahoo.com`。本机运行 `npm run dev` 或 `npm run preview` 时已经配好（见 `vite.config.ts`）。

部署成静态网站时需要在服务器上加一条等价的规则。以 Caddy 为例：

```caddy
handle_path /yahoo/* {
	reverse_proxy https://query1.finance.yahoo.com {
		header_up Host query1.finance.yahoo.com
		header_up User-Agent "Mozilla/5.0 (compatible; MylesCrypto/0.1)"
		header_up -Origin
		header_up -Referer
		header_up -Cookie
	}
}
```

`User-Agent` 这一行不能省：实测带常见浏览器标识的请求经常被限流（返回 429），换成自己的标识就稳定。不想配的话，把环境变量 `VITE_STOCK_HISTORY_BASE` 设为 `off`，美股就只用合约数据。

## 数据接入

界面和状态管理只依赖 `src/data/provider.ts` 里的 `MarketDataProvider` 接口，不知道背后是哪个数据源。

| 实现 | 文件 | 用途 |
|---|---|---|
| `BinanceProvider` | `src/data/binance/provider.ts` | 真实行情 |
| `MockProvider` | `src/data/mock/provider.ts` | 模拟数据，测试和离线演示用 |

由环境变量 `VITE_USE_MOCK_DATA` 决定用哪个，见 `.env.example`。接口地址也可以通过环境变量覆盖，用于走代理或镜像。

所有外部 JSON 都先经过 `src/data/binance/schemas.ts` 里的 Zod 校验，格式不对会报错，不会把脏数据写进图表。

要接入新的数据源，实现 `MarketDataProvider` 接口并在 `src/data/index.ts` 里切换即可。

### 用到的接口

| 用途 | 地址 |
|---|---|
| 合约 K 线 | `GET https://fapi.binance.com/fapi/v1/klines` |
| 现货 K 线 | `GET https://data-api.binance.vision/api/v3/klines` |
| 标的列表和单个标的的行情快照 | 同域名下的 `ticker/24hr` |
| 合约的资产分类（加密、美股、商品） | `GET https://fapi.binance.com/fapi/v1/exchangeInfo` |
| 持仓量 | `GET https://fapi.binance.com/fapi/v1/openInterest` |
| 恐惧贪婪指数 | `GET https://api.alternative.me/fng/?limit=1` |
| 美股官方历史 K 线（经本站 `/yahoo` 转发） | `GET https://query1.finance.yahoo.com/v8/finance/chart/{代码}` |
| 合约实时流 | `wss://fstream.binance.com/market/stream` |
| 现货实时流 | `wss://data-stream.binance.vision/stream` |

合约实时流必须用带 `/market` 的地址。旧地址 `wss://fstream.binance.com/stream` 能连上也会返回订阅确认，但实测不推送数据。

## 实时连接

实现在 `src/data/realtime/stream-connection.ts`，合约和现货各一条连接，没有订阅时不建立连接。

```text
idle ──第一次订阅──▶ connecting ──打开──▶ open
                                           │
                        ┌──────断开或假死──┘
                        ▼
                   reconnecting ──等待 1s/2s/4s/8s/15s（±20% 抖动）──▶ 重新连接 ──▶ open
                        │
                        └──期间订阅全部取消──▶ idle

open ──全部退订并超过 3 秒──▶ idle
```

- 订阅按流名做引用计数：第一个订阅者才向服务端订阅，最后一个离开才退订。
- 订阅和退订消息合并后限速发送，每 250 毫秒最多一条。
- 重连成功后一次性重订全部活跃的流，不会重复订阅。
- 有订阅但 30 秒没有任何消息时视为假死，主动断开重连。
- 重连成功后图表会重新拉取最新一页 K 线并按时间合并；如果断线太久导致接不上，就整体换成新数据，不留断层。
- 浏览器恢复联网时跳过等待，立即重连。

## 设计决策

- **模拟数据只在显式开启时使用。** 真实接口失败时显示错误和重试按钮，不会悄悄换成假价格。
- **绘图用时间和价格锚定，不存像素。** 时间与横坐标通过 K 线序号换算，范围外按周期外推，所以能画到未来，换周期后位置也正确。绘图按标的保存，同一标的在不同周期和不同面板里共用。
- **市场异动由前端按规则生成。** 规则是不依赖界面和网络的纯函数，在 `src/features/feed/rules.ts`，阈值可在设置里调整。
- **爆仓数据订阅全市场流再按标的过滤。** 多个标签共用一个订阅。
- **实时价格先用一次 HTTP 快照垫底。** 实时流只在价格变动时推送，成交清淡的标的可能很久没有第一条消息。
- **比特币默认看现货价。** 合约和现货有价差，现货价和大多数行情网站显示的一致。
- **自选保存在本地，不需要登录。** 只在自选里的标的只订阅最新价，不参与市场异动。
- **图表实例和 K 线数组不进入 React 渲染树。** 实时更新按帧批量写入图表；每个标签只订阅自己的行情，价格跳动不会带动整页重渲染。
- **日内周期按本地时区显示。** 所有 K 线使用同一个时区偏移，夏令时切换前的历史数据会有一小时偏差；日线按 UTC 日期显示。
- **指标的计算和绘制分开。** 计算是 `src/features/indicators/calc.ts` 里的纯函数；`src/components/chart/indicator-layer.ts` 只负责在图表上增删序列和写入数据。均线叠在主图上，MACD 和 RSI 各占一个副图，分隔线可以拖动调整高度。
- **指标开关对所有图表生效。** 这样多图布局下不用逐个设置。MACD 的柱子取 DIF − DEA（和 Binance、TradingView 一致，不是国内软件常见的两倍）。
- **美股的历史用官方股价，实时用合约。** 取数和整理在 `src/data/stock/yahoo.ts`，两部分怎么拼在 `src/features/session/official.ts`。官方数据是可有可无的增强：取不到、对不上都只是退回合约数据，不影响图表可用。
- **美股默认只显示交易时段。** 判断规则在 `src/features/session/us-session.ts`，按纽约时区计算，自动处理夏令时。过滤后一页里能留下的 K 线很少，所以加载时会自动往前多取几页（`src/data/candle-loader.ts`）；1 时、4 时、1 日由 30 分钟线合成（`src/features/session/aggregate.ts`）。
- **图表库保留 TradingView 署名。** 这是 Lightweight Charts 的许可要求。

## 目录

```text
src/
  app/            应用入口、行情订阅
  components/     shell（外壳）、chart（图表）、drawing（绘图）、feed（右侧栏）、common（通用）
  data/           binance、realtime、mock、K 线处理、数据源接口
  features/       feed（异动规则）、indicators（指标计算）、session（美股交易时段）
  stores/         workspace、watchlist、drawings、tickers、feed、preferences、connection、ui
  lib/            格式化、本地存储、时间换算
  styles/         设计令牌和全局样式
e2e/              浏览器验收测试
```
