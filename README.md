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
│           ├── pricing/             # 核价：物流渠道库 + 运费试算 + 利润核算
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
| 核价 | `GET /pricing/meta`、`GET/PATCH /pricing/settings`、`GET/POST/PATCH/DELETE /pricing/channels`、`POST /pricing/channels/reset`、`POST /pricing/quote`、`POST /pricing/calc`、`GET /pricing/from-product/:sku`、`GET/POST/PATCH/DELETE /pricing/records`、`GET /pricing/records/export` |
| 概览 | `GET /stats/overview` |

## 核价

选完品之后要判断这个品能不能做，页面的入口在侧边栏「核价计算」。公式照搬原来的《定价表模版.xlsx》：

```
计费重量 = 计抛渠道 ? max(实重, 长×宽×高 / 12000) : 实重
国际运费 = 计费重量 × 元/kg + 元/票        （兴远 XY 再 ROUNDUP 到 2 位）
毛利润   = 定价 − 采购成本 − 国际运费 − 贴单费 − 定价×平台佣金 − 定价×Ozon代理佣金
净利润   = 毛利润 − (采购成本 + 毛利润) × 提现费率
利润率   = 净利润 / 采购成本
运费利润比 = 净利润 / 国际运费
加 35%   = 定价 / 0.65
```

页面一次算出当前国家下**所有可用渠道**的运费并排在一起对比，按净利润从高到低排；
点某一行就把它的运费填进结果卡。填了「目标利润率」还会反算建议定价：

```
定价 = [目标净利润 + 采购成本×提现费率 + (采购成本+运费+贴单费)(1−提现费率)]
       / [(1−平台佣金−代理佣金)(1−提现费率)]
```

**内置渠道**（111 条，来自模版，可在「物流渠道」页改）：

| 国家 | GUOO | 兴远 XY |
| --- | --- | --- |
| 俄罗斯 | 15 | 36 |
| 白俄罗斯 | 12 | — |
| 哈萨克斯坦 | 12 | — |
| 吉尔吉斯斯坦 | — | 36 |

渠道按品类（Extra Small / Budget / Small / Big / Premium Small / Premium Big）校验
重量区间、货值区间（₽）、三边之和、单边长度，不合规的渠道会直接给出原因。

- 「核价记录」保存每次算完的结果，导出 CSV 的列头与原定价表完全一致
- 「参数设置」里的汇率、贴单费、佣金、代理佣金、提现费率是核价页的默认值
- 核价页可以填商品库里的 SKU，一键带出重量、三边尺寸和卢布售价

## 数据模型

`users`、`collect_tasks`、`products`、`product_metrics`、`filter_presets`、`screening_runs`、`screening_items`、`logistics_channels`、`pricing_records`、`pricing_settings`

- `products` 存每个 SKU 的最新状态（含 60+ 字段的原始 JSON 在 `raw` 列）
- `product_metrics` 是时间序列，用于看一个品的月销/加购率变化趋势
- `screening_runs` / `screening_items` 记录每一轮筛选的规则快照与逐条判定，可回溯对比
- `logistics_channels` 是物流渠道库，`pricing_records` 是核价记录，`pricing_settings` 是默认参数（单条）
