# 电商选品分析系统（ds）

Ozon 跨境选品的数据采集、商品库与智能筛选系统。
数据来源是「中实跨境ERP」插件注入在 Ozon 商品卡片上的数据属性，程序通过接管本机 Chrome 的调试端口读取。

技术栈与 `college-application` 保持一致：

| 层 | 技术 |
| --- | --- |
| 后端 | NestJS 10 + Prisma 5 + MySQL 8 |
| 鉴权 | JWT（passport-jwt）+ 全局守卫 + `@Public()` 放行 |
| 文档 | Swagger（`/api`） |
| 前端 | Next.js 14（App Router）+ React 18 + Ant Design 5 + Tailwind + axios |
| 数据库 | MySQL 8（Docker） |

## 目录结构

```
ds/
├── backend/                          # NestJS 后端
│   ├── prisma/schema.prisma          # 数据模型
│   ├── prisma/seed.ts                # 初始管理员 + 默认规则预设 + 物流渠道
│   └── src/
│       ├── main.ts                   # 入口（CORS / 全局过滤器 / Swagger）
│       ├── app.module.ts
│       ├── prisma/                   # PrismaService
│       ├── common/                   # 过滤器、装饰器、守卫
│       └── modules/
│           ├── auth/                 # 登录、注册、JWT 策略
│           ├── users/               # 用户管理（仅 admin）
│           ├── browser/             # 接管本机 Chrome（调试端口生命周期）
│           ├── collect/             # 采集任务：滚动加载 → 读插件数据 → 入库
│           ├── products/            # 商品库查询与指标历史
│           ├── screening/           # 规则预设、打分分级、结果导出
│           ├── pricing/             # 定价：找货源(1688) + 物流渠道库 + 定价计算 + 定价记录
│           │   ├── pricing.calc.ts  # 纯函数计算引擎（运费 / 利润 / 反算定价）
│           │   └── channels.data.ts # 内置渠道种子（来自《定价表模版》）
│           └── stats/               # 首页概览
└── frontend/                         # Next.js 前端
    └── src/app/{page,collect,products,screening,pricing}
```

## 快速开始

### 1. 数据库

MySQL 已通过 Docker 运行（`playlish-mysql`，端口 3306，root / root123），数据库名 `ds`。
如需另起容器，仓库里带了 `docker-compose.yml`。

```bash
docker exec playlish-mysql mysql -uroot -proot123 -e "CREATE DATABASE IF NOT EXISTS ds DEFAULT CHARSET utf8mb4;"
```

### 2. 后端

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev          # 或 npx prisma db push
npm run prisma:seed             # 创建 admin/admin123 与两个默认规则预设
npm run start:dev               # http://localhost:3101  API 文档 /api
```

### 3. 前端

```bash
cd frontend
npm install
npm run dev                     # http://localhost:3100
```

默认账号：**admin / admin123**

## 启动方式（生产 / 开发两种，别混用）

| 场景 | 用哪个 | 说明 |
| --- | --- | --- |
| 日常使用 | 双击 `一键启动.command` | 生产模式。缺构建产物会自动 build，然后起前后端并打开页面 |
| 只起一边 | `启动后端.command` / `启动前端.command` | 同样会自动补齐构建产物；端口被占用时会提示 |
| 改代码调试 | 双击 `开发模式.command` | `nest start --watch` + `next dev`，热更新 |
| 停止 | `停止服务.command` | 释放 3100 / 3101 端口 |

**注意 `npm run dev` 与 `npm run start` 不能直接混用：**
`next dev` 会把 `.next` 改写成开发态（没有 `BUILD_ID`），此时再跑 `npm start` 会报
`ENOENT: .next/BUILD_ID`。解决办法就是重新 `npm run build`，
或者直接用上面的启动脚本（它们会自动检测并构建）。

```bash
# 手动等价操作
cd frontend && rm -rf .next && npm run build && npm run start
```

### 常见报错

**`ENOENT: .next/BUILD_ID`** —— `next dev` 与 `next start` 混用导致。开发模式会把 `.next` 改成开发态，生产模式需要 `BUILD_ID`。
解决：`cd frontend && rm -rf .next && npm run build`，然后重跑。启动脚本已内置自动检测，不会踩这个坑。

**`EADDRINUSE :::3100` / `3101`** —— 端口被上次没退干净的进程占着（常见于 `npm` 被中断、但子进程 `next-server` / `dist/main` 还活着）。
解决：双击 `停止服务.command`，或执行：

```bash
bash scripts/free-ports.sh          # 只清理属于本项目的进程
lsof -nP -iTCP:3100 -sTCP:LISTEN   # 查看是谁占着
```

端口守卫脚本 `scripts/port-guard.sh` 会判断占用者是否属于本项目：属于则自动清理，不属于则明确报出 PID 和命令，不会误杀别的应用。

## 采集原理（这一块是整套系统的命门）

Ozon 前台不公开月销、加购率、退货率、上架天数、广告占比这些指标，官方接口也不给。
但「中实跨境ERP」插件会在每个商品卡片上挂一个属性：

```html
<div data-s2-card-data-json='{"sku":...,"soldCount":8,"convToCartPdp":"32.60",...}'>
```

所以采集流程是：

1. `browser` 模块把 Chrome 用 `--remote-debugging-port=9222` 拉起（使用**复制出来的**配置目录，
   保留插件与登录态；Chrome 不允许在默认配置目录上开调试端口）；
2. `collect` 模块通过 CDP 连接，滚屏触发懒加载，读取所有 `data-s2-card-data-json`；
3. 商品 upsert 进 `products`，每次采集另存一条 `product_metrics` 作为历史。

> 注意：接管前需要**完全退出 Chrome（Cmd+Q）**，否则配置目录被占用。
> 首次运行会自动复制配置，约 40 秒。

## 筛选规则

规则全部可在界面上调，存在 `filter_presets.rules`（JSON）。分为两层：

**硬性红线（命中即淘汰）**
| 指标 | 默认 |
| --- | --- |
| 评论数 | = 0 |
| 退货取消率 | ≤ 20% |
| 商品卡加购率 | ≥ 5% |
| 上架天数 | ≤ 100 |
| 品牌 | 必须无品牌 |
| 发货方式 | 必须 FBS |
| 广告费占比 | = 0（可关掉） |

**加权打分（默认阈值）**
| 项 | 得分 |
| --- | --- |
| 加购率 ≥15 / ≥10 / 5–10 | +35 / +30 / +10 |
| 月销 5–10 / 2–4 或 11–20 / 21–40 / >40 | +30 / +15 / 0 / −10 |
| 月销 ≥70 且零广告（C 档） | +30 |
| 月销 1 且上架 ≤4 天（B 档） | +30 |
| 零广告 / 轻广告 / 重广告 | +20 / +5 / −5 |
| 上架 45–75 天 / 30–44 或 76–90 / <30 / >90 | +20 / +10 / +10 / −5 |

分数映射分级：≥70 优先跟进，≥50 可跟进，≥30 观察，其余淘汰。
档位标记：A 主筛、B 新品首单、C 自然流爆款、D 有广告需卷价格。

## 接口一览

| 模块 | 接口 |
| --- | --- |
| 认证 | `POST /auth/login`、`POST /auth/register`、`GET /auth/profile` |
| 用户 | `GET/POST/PATCH/DELETE /users`（admin） |
| 浏览器 | `GET /browser/status`、`POST /browser/start`、`POST /browser/stop` |
| 采集 | `POST /collect/tasks`、`GET /collect/tasks`、`GET /collect/tasks/:id`、`DELETE /collect/tasks/:id` |
| 商品库 | `GET /products`、`GET /products/categories`、`GET /products/:sku`、`GET /products/:sku/history` |
| 筛选 | `GET/POST/PATCH/DELETE /screening/presets`、`POST /screening/run`、`GET /screening/runs`、`GET /screening/runs/:id`、`GET /screening/runs/:id/export` |
| 定价 | `GET /pricing/meta`、`GET/PATCH /pricing/settings`、`GET /pricing/products`、`GET/POST/PATCH/DELETE /pricing/channels`、`POST /pricing/channels/reset`、`POST /pricing/price`、`POST /pricing/quote`、`POST /pricing/calc`、`GET /pricing/sourcing/cookie-status`、`POST /pricing/sourcing/sync-cookie`、`POST /pricing/sourcing/search-keyword`、`POST /pricing/sourcing/prepare-search`、`POST /pricing/sourcing/trigger-search`、`POST /pricing/sourcing/scan-tabs`、`POST /pricing/sourcing/image-search`、`POST /pricing/sourcing/product-image`、`POST /pricing/sourcing/offer`、`GET /pricing/from-product/:sku`、`GET/POST/PATCH/DELETE /pricing/records`、`GET /pricing/records/export` |
| 概览 | `GET /stats/overview` |

## 定价（选品 → 找货源 → 算定价）

入口在侧边栏「定价」→「定价工作台」，走的是一条完整链路：

1. **选品**：从商品库搜 SKU / 标题，带出主图、卢布售价、类目、月销、退货率、三边尺寸与重量
2. **找货源（纯 HTTP，秒级）**：关键词搜同款 —— 关键词默认取商品库里的中文末级类目（如「儿童泡泡机」），搜 1688 移动端 SSR 页面，一次返回 20 条货源（图/标题/价格/成交/城市）；你对某条点「选这个」后，系统用纯 HTTP 抓该货品的**采购价**与**包装信息（长宽高/重量）**回填（约 0.7 秒）。这两项来自货品页内联 JSON（`priceDisplay` / `pieceWeightScaleInfo`），不爬 DOM、不用浏览器。
   - 登录态：1688 搜索需要 cookie，点「同步 1688 登录态」从调试 Chrome 里读一次存库即可（只读 cookie，不渲染页面），之后**全程不需要浏览器**
   - **三条找货源路径**（按推荐度）：
  1. **关键词搜同款**（纯 HTTP，0.5 秒出 20 条）—— 关键词用商品的中文末级类目，命中率最高
  2. **以图搜款（更准）**：系统在调试 Chrome 里打开 1688 图搜页、自动把商品主图放进上传框、自动点「搜索图片」，你只要回系统点「读取浏览器里的结果」，系统会把浏览器里的 1688 货源接回来（标题/价格/包装仍是 HTTP 秒抓）
  3. **直接粘贴 1688 链接** → 抓取（最稳，永远可用。Ozon 主图因服务端被 307 拦截，只能由浏览器抓一次）
- **1688 登录态**：搜索接口需要 cookie。两种方式任选：
  - 点「同步 1688 登录态」→ 系统从调试 Chrome 里读一次（只读 cookie、不渲染页面，0.15 秒）
  - 或点「粘贴 Cookie」手动粘贴：登录 1688 → F12 → Network → 刷新页面 → 点第一条 www.1688.com 请求 →
    Request Headers 里的 **Cookie** → 复制值 → 粘进来
- **风控提醒**：1688 搜索接口对同 IP 高频请求会返回滑块惩罚页（`_____tmd_____/punish`）。
  代码里加了 1.5 秒最小间隔、同关键词 5 分钟缓存、命中后 3 分钟冷却；**但货品详情抓取不受风控影响**，
  所以就算搜索被拦，粘贴链接后照样能秒抓价格与包装信息
3. **算定价**：按渠道算运费 → 用加价规则反推定价 → 算毛利/净利/利润率/运费利润比/加35%
4. **保存**：一条记录含 Ozon 链接、1688 链接、成本、重量尺寸、渠道、定价与全部利润指标，可导出 CSV（列头与《9月定价表》一致）

公式照搬《9月定价表.xlsx》：

```
计费重量 = 计抛渠道 ? max(实重, 长×宽×高 / 12000) : 实重
国际运费 = 计费重量 × 元/kg + 元/票        （兴远 XY 再 ROUNDUP 到 2 位）
毛利润   = 定价 − 采购成本 − 国际运费 − 贴单费 − 定价×平台佣金 − 定价×Ozon代理佣金
净利润   = 毛利润 − (采购成本 + 毛利润) × 提现费率
利润率   = 净利润 / 采购成本
运费利润比 = 净利润 / 国际运费
加 35%   = 定价 / 0.65
```

定价规则（已用表内真实行校验：成本21.8、运费13.21、贴单2、加价10%、佣金12%、代理3.5% → 定价47）：

```
建议定价 = ceil( (采购成本×(1+加价率) + 国际运费 + 贴单费) / (1 − 平台佣金 − 代理佣金) )
```

渠道对比表列出该国所有渠道的运费与对应定价，点行即切换；定价可手动改，利润指标实时重算。
（旧的反算定价接口 POST /pricing/calc 仍保留，可按目标利润率反推。）

**内置渠道**（111 条，来自模版，可在「物流渠道」页改）：

| 国家 | GUOO | 兴远 XY |
| --- | --- | --- |
| 俄罗斯 | 15 | 36 |
| 白俄罗斯 | 12 | — |
| 哈萨克斯坦 | 12 | — |
| 吉尔吉斯斯坦 | — | 36 |

渠道按品类（Extra Small / Budget / Small / Big / Premium Small / Premium Big）校验
重量区间、货值区间（₽）、三边之和、单边长度，不合规的渠道会直接给出原因。

- 「定价记录」保存每次结果，导出 CSV 的列头与《9月定价表》一致（含加价率、货源标题）
- 「参数设置」里可改汇率、贴单费、佣金、代理佣金、提现费率与**成本加价率**（默认 10%）
- 以图搜款依赖「浏览器接管」启动的调试 Chrome，且需要在这个 Chrome 里登录 1688；没登录或出现验证时接口会明确提示
- 1688 抓取**默认走纯 HTTP**：货品详情页是 SSR、匿名可抓（0.6s），关键词搜索走 m.1688.com 的 SSR 页（需登录态 cookie，0.5s）
- 「以图搜款」是遗留的浏览器链路（1688 图搜页加载 10 秒后渲染进程会忙到不回应 CDP，很慢），仅在 HTTP 搜索不可用时用；CDP 命令一律带超时+重试，页面一能求值就抢着做

## 数据模型

`users`、`collect_tasks`、`products`、`product_metrics`、`filter_presets`、`screening_runs`、`screening_items`、`logistics_channels`、`pricing_records`、`pricing_settings`

- `products` 存每个 SKU 的最新状态（含 60+ 字段的原始 JSON 在 `raw` 列）
- `product_metrics` 是时间序列，用于看一个品的月销/加购率变化趋势
- `screening_runs` / `screening_items` 记录每一轮筛选的规则快照与逐条判定，可回溯对比
- `logistics_channels` 是物流渠道库，`pricing_records` 是核价记录，`pricing_settings` 是默认参数（单条）
