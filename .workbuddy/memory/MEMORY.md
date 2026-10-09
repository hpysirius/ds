# ds 项目长期约定

## 服务与地址
- 本地：前端 3100、后端 3101（**无** /api 前缀）；`bash restart.sh [--no-build]` 起，`bash stop.sh` 停。
- 线上：http://ozon.qinxianty.com（admin/admin123），备用 114.132.99.141；API 前缀 `/api`（nginx 反代 3101）；`./deploy.sh` 一键部署。
- 前端 API 用相对路径 `/api`（deploy.sh 写 `frontend/.env.local`），**别写死 http://IP/api**。后端 CORS = `FRONTEND_URL`+`PUBLIC_SITE_URL`+`EXTRA_CORS_ORIGINS`。
- 数据在 MySQL，**线上库与本地库独立**。

## 后端约定
- ValidationPipe：`whitelist+forbidNonWhitelisted+transform+enableImplicitConversion`。**布尔 query 别声明 boolean**（`'false'`→true）→ 用 `@IsIn(['true','false','1','0'])` 在 service 判。
- 更新走字段白名单；`fmtRecord` 派生的非数据库列（如 `weightG`）**别 spread 回 Prisma**（Unknown arg）。
- JSON 写 null 用 `Prisma.DbNull`；**可空列「唯一约束+upsert」不可靠**（MySQL 对 NULL 不生效）→ `findFirst`+update/create。
- 登录响应 token 字段 **`accessToken`**（非 access_token），user 同级。
- JSON 数组统计用 MySQL 8 `JSON_TABLE`（线上 8.0.45 ✓），try/catch 兜底。
- **新增模块**：`src/modules/<x>/` + `app.module.ts` imports 注册。@Public 要按员工 token 归店 → module 里 `JwtModule.registerAsync({ secret: JWT_SECRET })`（照抄 `pricing.module.ts`），service 用 `resolveStoreId(authHeader)`。
- 多租户 helper 在 `common/constants/permissions.ts`：`storeWhereClause/inStoreScope/currentStoreId/clampPage/clampPageSize`。
- 自定义错误带 `code`/额外字段 → 全局过滤器 `common/filters/all-exceptions.filter.ts` 原样透传。

## 前端约定
- `http`（axios，`src/lib/api.ts`）保留 `err.response`。带登录态下载用 `downloadFile(path, fallbackName, params)`。
- 定价：`src/app/pricing/page.tsx`（Tab 记录/渠道/参数）+ `Workbench.tsx`。
- 列表操作列 `Button type="link" size="small"` + `Popconfirm`。
- **列宽可拖拽**：`components/ResizableTable.tsx` 的 `useResizableColumns(storageKey, baseColumns)` + `RESIZABLE_TABLE_COMPONENTS`（`/products` 已落地）。
- **静态资源放 `frontend/public/`**（→ `/plugin/x.zip`），`next start` 运行时读，已在 `.gitignore`。
- **多租户**：数据页请求带 `storeId`，从 `useStore()` 取 `storeParam`（`{storeId}` 或 `{}`）。
- **商品图一律走同源代理** `proxyImageUrl(u)`（防盗链 403 裂图且控制台无错）。白名单 `sourcing.service.ts` 的 `ALLOWED_IMAGE_HOSTS`，**改前先统计真实域名**；紧急放行 `IMAGE_PROXY_HOSTS=a.com,b.com`。
- **全员可见页面**：**不登记**进 `lib/permissions.ts` 的 `PERMISSIONS`，只在 `AppShell.tsx` menus 无条件 push。示范：`/guide`、`/rules`、`/self-purchase`。

## 产品边界（运营决定，勿擅自恢复）
- **不做「自动去 1688 抓取」**（风控严必触发滑块，2026-10-03 下线）。保留的 1688 交互是「人工触发、单次、有明确 URL」；加新自动化前先问运营。
- 后端 1688 接口都还在（`sourcing/search-keyword`、`scan-tabs`、`prepare-search`、`trigger-search`、`cookie`、`sync-cookie`、`products/fill-info`、`sourcing/product-info`），只是前端没入口。

## 多租户「店铺」隔离
- `Store` + 业务表 `storeId Int?`（User/CollectTask/Product/PricingRecord/SelfPurchase/FilterPreset/ScreeningRun）；员工 `User.storeId` 一对一。
- 超管切店 = 前端传 `storeId`；**DTO 必须显式声明该字段**。仅超管可建/改/删店（`系统管理 → 店铺管理`）。员工无店 → storeId:-1 必空。
- 插件带员工 token 上报按 `resolveStoreId` 归店；无 token → `storeId=null`。存量历史商品 storeId 全 null，归属迁移未做。

## 自采购模块（`/self-purchase`）
- 定位：与「商品库/跟单比价」**完全隔离**的独立表 `self_purchases`（`SelfPurchase`）。**不做跟卖比价**，核心「1688 选品 → 算价 → 备俄语文案 → 上架」。
- **SKU 是主标识**：`sku String?`（Ozon 商品 id，普通索引**不唯一**）。三端同逻辑 `extractOzonSku(url)`：优先 `?sku=`，其次 path 末段尾部 4–20 位数字；**取不到返回 null 不瞎猜**（`888888888.html` 不认）。守卫：「SKU/名称/货源链接/Ozon 链接 任一即可」。
- **同 SKU 自动合并**：同 `(storeId, sku)` 只一条。`mergeBySku()` create/memo 共用，**只补空字段、绝不覆盖非空**；name/supplyUrl/retailUrl 冲突 → 写 `remark`（别名/备选货源/Ozon 备选）。返回 `merged`/`mergedFields`；update 改 SKU 撞车 → 400。迁移 `scripts/migration/2026-10-10-merge-self-purchase-by-sku.sql`。
- **上架字段**：`status`（editing/listed/delisted）、`titleRu`/`descRu`/`tagsRu`（俄语，**手工填+一键复制，不接 AI**）、`packageText`。**留痕**：`caughtAt`/`listedAt`/`statusAt`/`pricedAt`；service `applyTrace(data, prevStatus, fromCapture)`（DTO `fromCapture:boolean`，非数据库列）。
- **算价不重造**：`SelfPurchaseService` 注入 `PricingService`（module import `PricingModule`），抽私有 `computePrice(input)`。**⚠ 坑**：选渠道看「货值 valueRub」，自采购没跟卖价 → 不传被判「货值低于下限」→ `best=null`。解法**跑两遍**：① `valueRub=成本×(1+加价率)/汇率` 种子 → 拿定价；② 用①定价当货值收敛。必须带 `includeUnavailable:true`。
- **落库即自动算价**（2026-10-10）：`create`/`memo`/`update` 落库后统一调 `autoPriceRecord(rec)` —— 有「成本 + 重量」就算出 运费/定价(¥·₽)/毛利/净利/利润率/渠道 写进记录；**已有 `netProfit`/`shippingFee` 则跳过不覆盖**；缺成本或缺重量不算。**⚠ 引擎返回体渠道名在 `name` 字段（非 channelName）、且无 `markupRate`** → 必须手动映射（`channelName: best.name`、`best.markupRate = markup`）。页面「算定价」改调 `POST /self-purchase/price-preview`（返回 `{best}`），不再前端跑两遍。
- **导出**：`GET /self-purchase/export`（`@Res()` 写 CSV，带 `\uFEFF` BOM），列头 27 列（含 SKU/状态/俄语三列/包装/货源/毛利润/运费利润比/加35%/时间），与列表同筛选。列表另加「毛利润 / 运费利润比 / 加35%」列，后两者前端纯函数现算（不落库）。
- **跟卖价（2026-10-10）**：`retailPriceRub`/`retailPriceCny`/`retailPriceAt`。插件在 Ozon 页采集时抓在售价；**⚠ 页面可能渲染成 ¥** → 插件只上报「原值 + 币种符号」，后端 `normalizeRetail()` 按汇率折算（`¥`⇒`rub=raw/rate`），**绝不在插件侧换算**。取价优先级：DOM 含 ₽ 的价格文本 > JSON-LD `offers.price+priceCurrency` > DOM ¥。列表/CSV 都展示 ₽（主）+ ¥（副）。
- 后端 `src/modules/self-purchase/`：CRUD + `@Public` `POST /self-purchase/memo`（插件，token 归店，source='plugin'）+ export。
- **⚠「取当前页」按站点分字段**：`memoUrl`=1688 货源，`memoOzon`=Ozon 链接。popup.js `detectSite()` 用**严格域名后缀 + 先排除 ds 自身域**（`ozon.qinxianty.com` 含 "ozon" 会误判 → 返回 `self` 不填）。
- 插件「📝 记一笔」区含 `memoName/memoSku/memoUrl/memoOzon/memoCost/memoWt/memoRetail(跟卖价)/memoL/memoW/memoH`；**「抓 1688 页」(`memoGrab1688`)** 复用 `DS_COLLECT_1688` 填标题/链接/成本/重量/尺寸 + `packageText`（带 `fromCapture=true` → 写 `caughtAt`）；**「抓 Ozon 页」(`memoGrabOzon`)** 走 `DS_COLLECT_OZON` → `collector-lib.js` 的 `collectOzonRetail()`，填跟卖价/标题/链接/SKU/主图。**「取当前页」在 Ozon 站会顺带静默抓跟卖价**。manifest → 1.7.8。

## 浏览器插件 ds-collector（MV3）
- 文件：`popup.html/js`、`rules.html/js`+`rules-lib.js`、`identity-bridge.js`、`background.js`、`collector-lib.js`、`manifest.json`。上报 `/pricing/extension/*`、`/self-purchase/memo`（`saveMemo`）；本地经 3100 中继绕 Chrome LNA。
- **归属店铺**：`identity-bridge.js` 读 ds 页 `localStorage.ds_token`/`ds_user` 推给 background 存 `ds_identity`，`safeFetch` 自动带 Bearer。**插件后端地址须与登录的 ds 站点同源（同一 JWT_SECRET）**。
- 规则默认只「打标签」不「过滤」；`syncRules()` 全量 `POST /rules/sync`（静默失败）。`rules-lib.js` 的 `RULE_DEFS` 必须与 `backend/.../rule-defs.ts` **逐项对齐（key+顺序）**。过滤开关 `chrome.storage.local.ds_filter_mode`，默认关。
- 改插件后到 `chrome://extensions` **重新加载**；**版本号只在 `manifest.json` 改**。
- `LEGACY_API_MAP` 把旧 `114.132.99.141[/api]` 静默升级为域名；`host_permissions` 与 `content_scripts.matches` 须含所有站点 origin。坑：`await` 不能写在 `Array.filter` 非 async 回调里。
- **分发**：`bash scripts/pack-extension.sh`（deploy.sh 自动调用）出 `frontend/public/plugin/ds-collector.zip`+`plugin-info.json`；入口 `components/PluginDownload.tsx`+`/guide`。

## 沙箱/构建坑
- 常驻服务必须 `Bash(run_in_background)` + **`dangerouslyDisableSandbox`** 跑 `bash scripts/start.sh --no-build --foreground`：沙箱内常驻进程 outbound fetch 全挂（image-proxy 全 Timeout，同机 curl 通）。
- 本地后端改完**必须重启进程**（只 tsc 不重启=跑旧代码）。诊断本地服务 `curl --noproxy '*'`（沙箱注入 HTTP_PROXY 会 502）。
- **本地库直连**：`docker exec playlish-mysql mysql -uroot -proot123 -N -e "..." ds`；表名 snake_case。
- **本机签 token**：读 `backend/.env` 的 `JWT_SECRET`（**带双引号，必须剥掉**否则 401），用 `backend/node_modules/jsonwebtoken` 签 `{sub,username,role}`。
- nest 构建清 dist 触发 safe-delete 拦截 → 用 `npx tsc -p tsconfig.build.json`。
- **`npx prisma db push` 被杀（137）→ 直接 `docker exec ... mysql ALTER TABLE`**（String 默认 VARCHAR(191)，DateTime 是 `DATETIME(3)`，索引名 `<table>_<col>_idx`）；`prisma generate` 正常。
- `next build` 前清 `.next` 会被拦 → `mv .next /tmp/ds-next-old-$(date +%s)`；构建 `env -u NODE_OPTIONS npx next build`。
- npm registry 不通 → 用 `registry.npmmirror.com`。macOS 无 `setsid`。
- 校验前端页面别 curl 页面 URL（SSR 只输出「加载中…」）→ grep `.next/static/chunks/app/<route>/*.js`。

## 浏览器 Agent（1688 图搜核价）— 仅本机
- 后端子进程跑 `scripts/browser-agent/src/agent.mjs`，经 CDP 连 **127.0.0.1:9222**；**只有后端与 Chrome 同机可用**，服务器必失败。
- `AGENT_ENABLED`：deploy.sh 服务器写 `false`（默认 true 本机）；`GET /agent/doctor` 返回 enabled；关闭时 `POST /agent/find` 返回 400；前端卡片隐藏。服务器还缺 puppeteer-core。
- **Chrome 154+ 禁止默认 profile 开调试** → 必须非默认 `--user-data-dir`（已复制到 `~/chrome-debug-profile`）。命令须用户自己跑：`open -a "Google Chrome" --args --user-data-dir="$HOME/chrome-debug-profile" --remote-debugging-port=9222`。WorkBuddy shell 里 `open --args` 会吞参数；headless 图搜返回空。
- **1688 图搜流程**（`air.1688.com/.../pc-image-search`）：① 上传 `#img-search-upload`；② **必须点「搜索图片」**（class 是 hash，按可见文本定位）；③ 结果卡片 `[data-renderkey]`（末段数字=offerId），URL 自建 `https://detail.1688.com/offer/{id}.html`；④ 候选图 `cbu01.alicdn.com`，前端走 `proxyImageUrl`。

## 1688 出口限制（硬约束）
- **1688 把云服务器机房 IP 段整体拉黑**（`ALI_RISK`/`IP_BAN`/`cloud_ip_bl`）→ 服务器上任何访问 1688 都不可用（含手工抓价）。换 IP/UA/cookie 无效；只有本机出口或住宅代理可用。
- 「算价+落库」纯计算/DB 在服务器即可；卡的只是「找货+抓价」。方案文档 `docs/服务器模式1688找货核价-技术方案.md`：短期 A（云控本机浏览器），长期 D（官方开放 API）。

## ⚠️ 币种口径：products.price 统一 ₽
- 判别**唯一依据 = `raw.priceSymbol`**（`¥` ⇒ 存的是人民币）。`products.currency` 恒 `RUB` 不可用。
- 修复：① 插件选价 `pickPriceText(true)||pickPriceText(false)`（优先 ₽）；② 后端 `ingestProductList`：`¥` → `price=round(price×rubPerCny)`，原值存 `raw.priceCny`；③ 历史 608 条迁移（备份 `products_price_migrate_bak_20261009`）。
- 遗留：① 跟卖价单元格渲染顺序「¥/₽」（用户想 ₽ 在前，未改）；② `retailPriceCny` 用记录汇率快照；③ `raw.pluginCard` 的 `historicalAvgPrice/offerMinPrice` 是 ¥ 口径。
- **⚠ 汇率待修（未动，等确认）**：代码/schema 默认已 0.0788/12.69，但**现存 `pricing_settings` 行仍 0.0862/11.6**，运行时读行 → 实际用旧汇率。改前确认（影响所有金额）。
