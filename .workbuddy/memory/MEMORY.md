# ds 项目长期约定

## 服务与地址
- 本地：前端 http://localhost:3100、后端 http://localhost:3101（后端**无** /api 前缀）；`bash restart.sh [--no-build]` 起，`bash stop.sh` 停。
- 线上（**主入口是域名**）：http://ozon.qinxianty.com（admin/admin123），备用 http://114.132.99.141。API 前缀 `/api`，nginx 反代到 3101；`./deploy.sh` 一键部署（服务器 npm install + prisma generate + build + db push + pm2 重启 + 重写 nginx）。
- **前端 API 用相对路径 `/api`**（`deploy.sh` 生成 `frontend/.env.local` 的 `NEXT_PUBLIC_API_URL="/api"`）：同源免跨域。**不要写死 `http://IP/api`**。
- 后端 CORS 白名单 = `FRONTEND_URL` + `PUBLIC_SITE_URL` + `EXTRA_CORS_ORIGINS`（`main.ts`）。「线上页面请求用户本机 3101」的依赖它（本地 `.env` 也设 `PUBLIC_SITE_URL`）。
- 数据在 MySQL（`backend/prisma/schema.prisma`），**线上库与本地库互相独立**。

## 后端约定
- 全局 ValidationPipe 开了 `whitelist + forbidNonWhitelisted + transform + enableImplicitConversion`。**布尔 query 参数不要声明成 boolean**（`'false'` 会被转成 `true`）→ 用字符串 `@IsIn(['true','false','1','0'])` 在 service 里判。
- 更新记录用「字段白名单」再写库；`fmtRecord` 会派生 `weightG` 等**非数据库列**字段，直接 spread 回 Prisma 会报 Unknown arg。
- 自定义错误带 `code`/额外字段时，全局过滤器 `common/filters/all-exceptions.filter.ts` 原样透传。
- **JSON 字段写 null 用 `Prisma.DbNull`**；**可空列「唯一约束+upsert」不可靠**（MySQL 唯一索引对 NULL 不生效）→ `findFirst` + update/create。
- 登录响应 token 字段名是 **`accessToken`**（非 `access_token`），user 在同级 `user`。
- 统计 `products.raw.tags` 这类 JSON 数组用 MySQL 8 `JSON_TABLE`（线上 8.0.45 ✓），`try/catch` 兜底。
- **新增模块**：`src/modules/<x>/`（module+controller+service）+ 在 `app.module.ts` imports 注册。给 @Public 接口解析员工 token 归店时，module 里 `JwtModule.registerAsync({ secret: JWT_SECRET })`（照抄 `pricing.module.ts`），service 用 `resolveStoreId(authHeader)`。

## 前端约定
- `http`（axios，`src/lib/api.ts`）拦截器保留 `err.response` 状态码，用来识别 401/业务 code。
- 定价页面：`src/app/pricing/page.tsx`（Tab：定价记录/物流渠道/参数设置）+ `src/app/pricing/Workbench.tsx`（工作台，含 1688 抓取与回填）。
- 列表操作列用 `Button type="link" size="small"` + `Popconfirm` 二次确认。
- **列宽可拖拽**：`components/ResizableTable.tsx` 的 `useResizableColumns(storageKey, baseColumns)` + `RESIZABLE_TABLE_COMPONENTS`（已在 `/products` 落地，其他列表换 key 照抄）。宽度存 localStorage（`ds.colWidths.v1.*`）。
- **静态资源放 `frontend/public/`**（`public/plugin/x.zip` → `/plugin/x.zip`），`next start` 运行时读取无需重构建；是生成物，已在 `.gitignore` 排除。
- **多租户隔离**：数据页请求都要带 `storeId`（超管可切店、员工锁定本店），从 `useStore()` 取 `storeParam`。
- **全员可见页面**：**不要**登记进 `lib/permissions.ts` 的 `PERMISSIONS`（不登记 → `ROUTE_PERMISSION` 无它 → 路由守卫放行），只在 `AppShell.tsx` 的 `menus` 里无条件 `items.push(...)`。示范：`/guide`、`/rules`。
- **商品图一律走同源代理**：用 `lib/api.ts` 的 `proxyImageUrl(u)`，**不要直连原图地址**（Ozon/1688 防盗链 → 403 裂图，控制台看不出错）。后端代理是 `@Public` 的 `GET pricing/sourcing/image-proxy`。
- **改图片代理白名单前先统计真实域名**：白名单在 `sourcing.service.ts` 的 `ALLOWED_IMAGE_HOSTS`。**漏一个域名 = 整站商品图静默裂图**（2026-10-02 因漏 `ozonstatic.cn` 出过线上故障）。统计：`select substring_index(substring_index(imageUrl,'/',3),'//',-1) host, count(*) from ds.products group by host`。紧急放行用环境变量 `IMAGE_PROXY_HOSTS=a.com,b.com`。

## 产品边界（运营决定，勿擅自恢复）
- **不要做「自动去 1688 抓取」**。1688 风控极严，自动化必然触发滑块验证。2026-10-03 已整体下线：商品库无「自动核价/补信息」；工作台 1688 行**只保留「复制图片」**。
- **保留的 1688 交互是「人工触发、单次、有明确 URL」的**：手工贴 `detail.1688.com/offer/xxx` 后点「抓取 1688 价格/包装信息」。加新 1688 自动化前先问运营。
- 后端接口（`pricing/sourcing/search-keyword`、`scan-tabs`、`prepare-search`、`trigger-search`、`cookie`、`sync-cookie`、`pricing/products/fill-info`、`sourcing/product-info`）**都还在**，只是前端没入口。

## 多租户「店铺」隔离（核心架构，2026-10-02）
- 隔离维度：`Store` + 各业务表 `storeId Int?`（User/CollectTask/Product/PricingRecord/FilterPreset/ScreeningRun）；员工 `User.storeId` 一对一挂店。
- 核心：`common/constants/permissions.ts` 的 `storeWhereClause(user, reqStoreId?)` 与 `currentStoreId(user, reqStoreId?)`（员工无店→storeId:-1 必空）。各 service 用 `scope(user)` 注入 where，越权返回 404。
- 超管切店 = 前端传 `storeId`；**ValidationPipe 下必须为接收 storeId 的 DTO 显式声明该字段**。
- 仅超管可建/改/删店铺（`StoresModule`，删除时外键 SetNull）；前端在 `系统管理 → 店铺管理`（`/system/stores`）。
- 插件上报带员工 token 时按 `resolveStoreId` 归店；无 token → `storeId=null`（超管「全部」视图）。
- **存量数据**：线上 625 / 本地 739 条历史商品 storeId 全 null；归属迁移**未做**。

## 浏览器插件 ds-collector（`extension/ds-collector`，MV3）
- 文件：`popup.html/js`、`rules.html/js`+`rules-lib.js`、`identity-bridge.js`、`background.js`、`collector-lib.js`、`manifest.json`。上报走 `@Public` 的 `/pricing/extension/*`；本地需经 localhost:3100 中继绕过 Chrome LNA 限制。
- **归属店铺**：`identity-bridge.js` 读 ds 网页 `localStorage.ds_token`/`ds_user` 推给 background 存 `ds_identity`，`safeFetch` 自动带 Bearer。**插件后端地址须与所登录 ds 站点同源（同一 JWT_SECRET）**，否则归不了店。
- **规则默认只「打标签」不「过滤」**：`applyRulesToItem` 命中加 `item.tags`（存 `products.raw.tags`）。
- **规则同步后台（2026-10-05）**：`background.js` 的 `syncRules()` 全量 `POST /rules/sync`（静默失败）；触发点 = 打开弹窗 / 规则增删改启停 / 每次采集成功。`rules-lib.js` 的 `RULE_DEFS` 必须与 `backend/src/modules/rules/rule-defs.ts` **逐项对齐（key+顺序）**。
- **过滤模式**：`chrome.storage.local.ds_filter_mode` 开关；开时 `passesFilter(item, rules)` 入库前丢弃未命中；`ruleHasConstraints` 保证只有带条件的规则当过滤器。默认关。
- 改插件后必须到 `chrome://extensions` **重新加载**；改 `manifest.json` 版本号便于确认。
- **后端地址配置**：`DEFAULT_API = 'http://ozon.qinxianty.com/api'`；`background.js` 有 `LEGACY_API_MAP` 把旧 `http://114.132.99.141[/api]` 静默升级为域名（自定义地址不动）。`manifest.json` 的 `host_permissions` 与 `content_scripts.matches` **必须同时包含所有要用的站点 origin**。
- 坑：`await` 不能写在 `Array.filter` 的非 async 回调里。
- **分发（2026-10-06）**：`bash scripts/pack-extension.sh` 打出 `frontend/public/plugin/ds-collector.zip` + `ds-collector-v<ver>.zip` + `plugin-info.json`；**`deploy.sh` 的 `[1.5/5]` 会自动调用**，插件改完只需跑 `deploy.sh`；**版本号只在 `manifest.json` 改一处**。前端入口 `components/PluginDownload.tsx` + `/guide` 卡片；新版本靠 localStorage `ds_plugin_downloaded_version` 亮红点。

## 沙箱构建/运行坑（每次都会遇到）
- 前台 Bash 里 `nohup ... &` 起的服务会在**该次工具调用结束时被杀** → 常驻服务必须 `Bash(run_in_background)` 跑 `bash scripts/start.sh --no-build --foreground`。
- **本地后端改完一定要重启进程**：只 `tsc` 出新 dist 而不重启 → 仍跑旧代码。
- 诊断本地服务用 `curl --noproxy '*'`（沙箱注入 HTTP_PROXY，走代理会 502）。
- **本地数据库直连**：`docker exec playlish-mysql mysql -uroot -proot123 -N -e "..." ds`；容器 `playlish-mysql`，库 `ds`，**表名 snake_case**。
- **本机拿 token 验证接口**：本地 `admin/admin123` 登录不通（密码不同）→ 读 `backend/.env` 的 `JWT_SECRET`，用 `backend/node_modules/jsonwebtoken` 现签 `{sub,username,role}` 的 token 调接口。
- `npm run build`（nest）会因清 dist 触发 safe-delete 拦截 → 用 `npx tsc -p tsconfig.build.json`。
- `next build` 前清 `.next` 会被拦 → `mv .next /tmp/ds-next-old-$(date +%s)`；构建用 `env -u NODE_OPTIONS npx next build`。
- npm registry 本机不通 → 装包用 `registry.npmmirror.com`；尽量零依赖实现。也导致 `agent-browser` 装不上。
- macOS 无 `setsid`。
- 校验前端页面别用 `curl 页面URL`（AppShell 是客户端组件，SSR 只输出「加载中…」）→ grep 构建产物 `.next/static/chunks/app/<route>/*.js`，或连 Chrome 9222 用 puppeteer 真机查 DOM。

## 浏览器 Agent（1688 图搜核价）— 只允许本机用
- 原理：后端子进程跑 `scripts/browser-agent/src/agent.mjs`，经 CDP 连 **127.0.0.1:9222** 驱动 Chrome。**只有后端与 Chrome 同机才可用**。
- **服务器（云）部署必然失败**：服务器的 127.0.0.1 是它自己，连不到用户本机 Chrome；且无头环境 1688 图搜一律返回空。2026-10-09 已用 `AGENT_ENABLED` 开关在服务器模式下线。
- `deploy.sh` 在服务器生成的 `backend/.env` 里写 **`AGENT_ENABLED=false`**（默认 true = 本机可用）。`GET /agent/doctor` 返回 `enabled`；`POST /agent/find` 关闭时返回明确 400（不再是「agent 异常退出 code 1」）。前端 `Workbench.tsx` 的卡片在 `enabled===false` 时 `display:none`。
- 另注：`scripts/browser-agent/node_modules` 不随 deploy 上传（tar exclude node_modules），服务器缺 puppeteer-core → 即使开关打开也会 exit 1。
- **新版 Chrome（154+）禁止在默认用户数据目录上开远程调试**（报 `DevTools remote debugging requires a non-default data directory`）→ 必须加非默认 `--user-data-dir`（显式指回默认路径也无效，Chrome 按路径判）。已把用户 profile 复制到 `~/chrome-debug-profile`（含 1688/ds 登录态、插件、ds_token；复制后删 SingletonLock/Cookie/Socket）。启动命令（**必须用户自己在 Terminal 跑**）：
  `open -a "Google Chrome" --args --user-data-dir="$HOME/chrome-debug-profile" --remote-debugging-port=9222`
- **WorkBuddy 的 shell 里 `open --args` 会吞参数**；二进制直启缺 GUI 权限会崩（加 `--no-sandbox` 能起但无显示器）。**无显示器/headless 的 Chrome，1688 图搜一律返回空**。
- **1688 图搜页流程（`air.1688.com/kapp/1688-search/pc-image-search`，2026-10-07 打通）**：
  ① 上传到唯一 file input `#img-search-upload`；② **上传后必须点「搜索图片」按钮**（class 是 hash，用可见文本定位）才真正发起图搜，否则永远 0 结果；③ 结果卡片 `[data-renderkey]`（如 `1_0_p4p_hyhxmj_44237855048`，offerId = 末段数字），标题 `[class*=titleText]`、价格 `[class*=priceItem]`、店铺 `[class*=shopName]`、图 `img`；卡片**没有** detail.1688.com 链接，URL 自建 `https://detail.1688.com/offer/{offerId}.html`；④ 候选图是 `cbu01.alicdn.com`，前端必须走 `proxyImageUrl`。
- 本机实测可用：连用户 GUI Chrome 图搜返回 60 个候选；`/agent/find` 同样返回 60。

## 1688 访问出口限制（2026-10-09 实测，重要硬约束）
- **1688 把云服务器机房 IP 段整体拉黑**（`code: ALI_RISK` / `riskKind: IP_BAN`，返回 `cloud_ip_bl`，连滑块都不给）。线上实测 `POST /api/pricing/sourcing/offer` 必失败。
- 推论：**服务器上任何访问 1688 的请求都不可用**——不只是图搜，连「手工贴 offer 链接抓价」在线上也是坏的；线上库 `pricing_settings.ali1688Cookie` 为空（`cookie-status` → `hasCookie:false`）。
- 换 IP / 换 UA / 换 cookie 均无效（段级封禁）。只有**本机出口（家庭宽带）**或**住宅代理**能访问 1688。
- 「算价（calc）+ 落库（createRecord）」是纯计算/DB，**本来就在服务器完成**；自动化只卡在「找货 + 抓价」这两步的数据获取。
- 已出方案文档 `docs/服务器模式1688找货核价-技术方案.md`：推荐 A（云控本机浏览器：本机 daemon 长轮询拉任务，驱动本机 Chrome 完成图搜+DOM 抓价，服务器只做编排/算价/落库），长期走 D（1688 官方开放 API，合规且不受 IP 封禁）。

## ⚠️ 币种口径：products.price 统一为卢布 ₽（2026-10-09 查实并已修）
- **现象**：定价记录页「跟卖价(₽)」列把商品的 `products.price` 直接当卢布用（`pricing.service.ts:560` `retailPrice = priceMap.get(sku)`，第 562 行再 `retailPriceCny = retailPrice × exchangeRate`）。
- **真相**：Ozon 页面有时把卡片价格渲染成 **¥**（人民币）而不是 ₽。插件 `collector-lib.js` 的选价逻辑（优先 class 含 `tsHeadline` 且含货币符号）就把 **¥ 数值**当 price 存了，只把符号丢进 `raw.priceSymbol`。
- **决定性统计**（线上库 1011 条）：`raw.priceSymbol='¥'` **608 条**（price 均值 52.6）｜`'₽'` 132 条（均值 602）｜无符号 271 条（均值 1822）。**不是历史遗留**：10-06 采 244 条、10-07 采 171 条几乎全是 ¥。
- **逐条验证**（库内值 ÷ 0.0788 ≈ 页面卢布价，4/4 命中）：2133960348 存 61.88 ↔ 页面 789 ₽；1968422017 存 20.32 ↔ 262 ₽；3016657131 存 15.63 ↔ 199 ₽；4892112468 存 35.86 ↔ 464 ₽。⇒ **库里的数是人民币**。
- **被推翻的旧假设**：插件注释与 `sourcing.service.ts:1818` 都写「货币符号被本地化成 ¥，**数值仍是卢布量级**」——对 608 条不成立。`products.currency` 列恒为 `RUB`（默认值，从不更新），**不可作依据**。
- **影响面（都是静默错）**：①「跟卖价(₽)」列（显示 ¥ 值却标 ₽，并再乘汇率出假人民币值）；②「定价是否高于跟卖价」标红/筛选（比较基准错，近似恒为红）；③商品库「价格(¥)」列（对这批商品 61.88 会显示 ¥4.88）；④ Excel 导出「跟卖价格(₽)」列。
- **注意**：2026-10-09 把汇率 0.0862→0.0788 是另一个真问题（汇率过时），**并不能修好本 bug**。
- 判别真伪的唯一可靠依据 = `raw.priceSymbol`（`¥` ⇒ 存的是人民币，需 ÷ 汇率换回 ₽）。
- **✅ 修复（写时归一 + 历史迁移，用户选定）**：
  1. 插件 `collector-lib.js` 的 `collectList` 选价改为 `pickPriceText(true) || pickPriceText(false)`——**优先取含 ₽ 的候选**，整张卡片一个 ₽ 都没有才退回 ¥；`manifest.json` → **1.7.2**。`rules.html` 的「价格单位」错误说明已改正。
  2. 后端 `sourcing.service.ts` 的 `ingestProductList`：新增 `getRubPerCny()`（读 `pricing_settings.rubPerCny`，退 `1/exchangeRate`，兜底 `1/0.0788`）；**若上报 `priceSymbol === '¥'` 则 `price = round(price × rubPerCny, 2)`**，原始人民币值存 `raw.priceCny`。`pricing.service.ts` 的跟卖价逻辑**不用改**（库里已是 ₽）。
  3. 历史迁移：线上 608 条 `raw.priceSymbol='¥'` 已 ×12.69 换算为 ₽，原值存 `raw.priceCny`、加 `raw.priceFrom='¥'`、`raw.priceSymbol` 归一为 `'₽'`。备份表 `ds.products_price_migrate_bak_20261009`（608 行）。
  4. `schema.prisma` 的 `PricingSetting` 默认值同步修正（exchangeRate 0.0862→0.0788、rubPerCny 11.6→12.69）。
- **验证**：库内 `¥` 组清零（现 ₽ 740 / 无符号 271）；2133960348 跟卖价 = **785.26₽**（页面 789₽）、商品库¥列 = **¥61.88**、`高于跟卖价` 由恒真变为 false（正确）；模拟上报 `{price:61.88, priceSymbol:'¥'}` → 入库 785.26₽ + `raw.priceCny=61.88`，`{price:789, priceSymbol:'₽'}` → 原样 789₽。
- **遗留小项**：① 跟卖价单元格渲染顺序仍是「¥值 / ₽值」（列头写 ₽）——用户此前提过想调成 ₽ 在前，未改；② `retailPriceCny` 用的是**该记录自己的汇率快照**（老记录 0.0862），故 785.26₽ 显示成 ¥67.69 而非按现汇的 ¥61.88（行内自洽，仅信息性）；③ `raw.pluginCard` 里的 `historicalAvgPrice`/`offerMinPrice` 是中实跨境ERP给的 **¥ 口径**（如 60.77），若前端当 ₽ 展示也需留意。
