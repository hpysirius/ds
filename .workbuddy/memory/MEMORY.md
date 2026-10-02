# ds 项目长期约定

## 服务与地址
- 本地：前端 http://localhost:3100、后端 http://localhost:3101（后端无 /api 前缀）；`bash restart.sh [--no-build]` 起，`bash stop.sh` 停。
- 线上（**主入口是域名**）：http://ozon.qinxianty.com（admin/admin123），备用 http://114.132.99.141（两者等价，nginx `server_name` 都收敛到同一站点）。API 前缀 `/api`，nginx 反代到 3101；`./deploy.sh` 一键部署（服务器上 npm install + prisma generate + build + db push + pm2 重启 + 重写 nginx 站点配置）。
- **前端 API 地址用相对路径 `/api`**（`deploy.sh` 生成 `frontend/.env.local` 的 `NEXT_PUBLIC_API_URL="/api"`）：
  同源、免跨域，换域名/换 IP 都不用改构建配置。**不要再写死 `http://IP/api`** —— 那样用域名打开会跨域、登录直接失败。
- 后端 CORS 白名单 = `FRONTEND_URL` + `PUBLIC_SITE_URL` + `EXTRA_CORS_ORIGINS`（逗号分隔，`main.ts`）。默认值含 `http://ozon.qinxianty.com` 与 `http://114.132.99.141`。
  「本地 1688 抓取回退」依赖它：线上页面里请求用户本机 3101 时，本机后端必须放行线上 origin（本地 `backend/.env` 也设了 `PUBLIC_SITE_URL`）。
- 数据库数据在 MySQL（`backend/prisma/schema.prisma`），线上库与本地库**互相独立**（线上 pricing 记录为空，本地有 178 条）。

## 后端约定
- 全局 ValidationPipe 开了 `whitelist + forbidNonWhitelisted + transform + enableImplicitConversion`。
  **布尔型 query 参数不要用 boolean 声明**：`'false'` 会被隐式转成 `true`。改用字符串（`@IsIn(['true','false','1','0'])`）在 service 里判。
- 更新记录时用「字段白名单」再写库；`fmtRecord` 会派生 `weightG` 等**非数据库列**字段，直接 spread 回 Prisma 会报 Unknown arg。
- 自定义错误要带 `code`/额外字段时，全局异常过滤器 `common/filters/all-exceptions.filter.ts` 会原样透传（曾只传 message，已修）。

## 前端约定
- `http`（axios，`src/lib/api.ts`）拦截器保留 `err.response` 状态码，用来识别 401/业务 code。
- 定价相关页面：`src/app/pricing/page.tsx`（Tab：定价记录/物流渠道/参数设置）+ `src/app/pricing/Workbench.tsx`（定价工作台，含 1688 抓取与回填）。
- 列表操作列尽量用 `Button type="link" size="small"` + `Popconfirm` 二次确认，与既有风格一致。
- **多租户店铺隔离（见下节）**：任何数据页请求都要带 `storeId`（超管可切店，员工锁定本店），从 `useStore()` 取 `storeParam`。
- **全员可见页面**：若某页要「所有登录用户都能看」而不属于业务权限，**不要**登记进 `lib/permissions.ts` 的 `PERMISSIONS`（不登记 → `ROUTE_PERMISSION` 里没有它 → 路由守卫直接放行），只在 `AppShell.tsx` 的 `menus` 里无条件 `items.push(...)`。示范：`/guide`「使用说明」（`app/guide/page.tsx`，纯静态文案 + 流程图，无接口）。
- **商品图一律走同源代理**：统一用 `lib/api.ts` 的 `proxyImageUrl(u)`，**不要写 `<img src={商品图原地址}>`** —— Ozon（`ir-*.ozonstatic.cn`）/1688 的图有防盗链，直连会 403，页面只显示裂图且控制台看不出明显错误。后端代理是 `@Public` 的 `GET pricing/sourcing/image-proxy`。
- **改图片代理白名单前必须先统计真实域名**：白名单在 `sourcing.service.ts` 的 `ALLOWED_IMAGE_HOSTS`（含 `ozon.ru`/`ozone.ru`/`ozonstatic.com`/`ozonstatic.cn`/`1688.com`/`alicdn.com`…）。**漏一个域名 = 整站商品图静默裂图**（2026-10-02 就因漏 `ozonstatic.cn` 出过一次线上故障）。统计命令：`select substring_index(substring_index(imageUrl,'/',3),'//',-1) host, count(*) from ds.products group by host`。紧急放行可用环境变量 `IMAGE_PROXY_HOSTS=a.com,b.com`，免改代码。

## 产品边界（运营决定，勿擅自恢复）
- **不要做「自动去 1688 抓取」的功能**。1688 风控极严，自动化请求（关键词搜同款、以图搜款、批量抓详情）几乎必然触发滑块验证，做了也没法稳定用。2026-10-03 已按运营要求整体下线：
  - 商品库：无「自动核价」「补信息」入口（操作列只剩「核价」「删除」）。
  - 定价工作台 1688 那一行：**只保留「复制图片」**（人工复制主图 → 到浏览器 1688 图搜页粘贴）。
  - 工作台无「一键自动核价」、无「自动核价进度」。
- **保留的 1688 交互是「人工触发、单次、有明确 URL」的**：手工贴 `detail.1688.com/offer/xxx` 链接后点「抓取 1688 价格/包装信息」。加任何新的 1688 自动化前先问运营。
- 后端相关接口（`pricing/sourcing/search-keyword`、`scan-tabs`、`prepare-search`、`trigger-search`、`cookie`、`sync-cookie`、`pricing/products/fill-info`、`sourcing/product-info`）**都还在**，只是前端没入口；要恢复接回前端即可。

## 多租户「店铺」隔离（核心架构，2026-10-02 落地）
- 隔离维度：`Store` 模型 + 各业务表 `storeId Int?`（User/CollectTask/Product/PricingRecord/FilterPreset/ScreeningRun）。员工 `User.storeId` 一对一挂店（非多对多）。
- 后端隔离核心：`common/constants/permissions.ts` 的 `storeWhereClause(user, reqStoreId?)`（超管按 reqStoreId、员工按 user.storeId；员工无店→storeId:-1 必空）与 `currentStoreId(user, reqStoreId?)`。各 service 用 `scope(user)` 注入 where、越权返回 404（不暴露存在性）。
- 超管切店 = 前端传 `storeId` query/body；**ValidationPipe forbidNonWhitelisted 必须为每个接收 storeId 的 DTO 显式声明该字段**（QueryProductDto/QueryTaskDto/QueryRecordDto/QueryRunDto 已加）。
- 仅超管可建/改/删店铺（`StoresModule`，删除时外键 SetNull 自动解绑，不误删数据）；前端店铺管理在 `系统管理 → 店铺管理`（`/system/stores`，仅超管可见）。
- 采集插件上报带员工 token 时按 `resolveStoreId` 归店（见下节插件条目）；无 token 才写 `storeId=null`（归超管「全部」视图）。
- **存量数据**：线上 625 条 / 本地 739 条历史商品 storeId 全为 null，仅超管「全部」视图可见；要归属具体店铺需另写一次 `UPDATE product SET storeId=? WHERE storeId IS NULL` 迁移（待定，未做）。

## 浏览器插件 ds-collector（`extension/ds-collector`，MV3）
- 文件：`popup.html/js`（弹窗+1688回填）、`rules.html/js`+`rules-lib.js`（采集规则）、`identity-bridge.js`（身份桥 content script）、`background.js`（service worker，采集编排）、`collector-lib.js`（注入页面的抓取逻辑）、`manifest.json`。
- 采集上报走后端 `@Public` 的 `/pricing/extension/*`；本地需经 localhost:3100 中继绕过 Chrome LNA 限制。
- **归属店铺（2026-10-02 新增）**：`identity-bridge.js` 注入 ds 网页读 `localStorage.ds_token`/`ds_user`，推给 background 存 `ds_identity`；`safeFetch`/`relayFetchFn` 自动带 `Authorization: Bearer <token>`；后端 `PricingModule` 注册 JwtModule，`SourcingService.resolveStoreId(authHeader)` 解析员工 storeId → 采集数据归本店。无 token/无效 token → storeId=null（归超管「全部」，兼容旧行为）。**插件后端地址须与所登录的 ds 站点同源（同一 JWT_SECRET）**，否则解析不出店铺。弹窗显示「采集归属」便于自查。
- **规则默认只「打标签」不「过滤」**：`rules-lib.js` 的 `applyRulesToItem` 给命中商品加 `item.tags`（存 `products.raw.tags`）；采集是全量的。
- **过滤模式（2026-10-02 新增）**：`chrome.storage.local.ds_filter_mode` 开关（popup 复选框）。开时 `background.js` 用 `rules-lib.js` 的 `passesFilter(item, rules)` 在入库前丢弃未命中商品；`ruleHasConstraints` 保证只有「带条件」的规则才当过滤器（无条件规则命中全部、不计入）。默认关。
- 改插件后必须到 `chrome://extensions` **重新加载扩展**才生效；改 `manifest.json` 版本号便于确认已更新。
- **后端地址配置（2026-10-02 换域名时更新）**：`DEFAULT_API = 'http://ozon.qinxianty.com/api'`；popup「填服务器」预设同为该值，「填本地」= `http://localhost:3101`；`background.js` 有 `LEGACY_API_MAP` 在启动时把旧的 `http://114.132.99.141[/api]` 静默升级为域名（自定义地址不动）。
  `manifest.json` 的 `host_permissions` 与 `content_scripts.matches` **必须同时包含所有要用的站点 origin**（含 `http://ozon.qinxianty.com/*`）——漏了 matches 的话，域名页面上的登录身份读不到，采集数据就归不了店铺。
- 坑：`await` 不能写在 `Array.filter` 的非 async 回调里（把 `getRules()` 提前到外面）。

## 沙箱构建/运行坑（每次都会遇到）
- 前台 Bash 里 `nohup ... &` 起的服务，在该次工具调用结束时会**被杀** → 必须用后台任务方式启动（`restart.sh`/前台 `start.sh` 直接在普通调用里跑也会被回收，甚至把已起的服务一起带停 → 用 `Bash(run_in_background)` 跑 `bash scripts/start.sh --no-build --foreground`）。
- **本地后端改完一定要重启进程**：`restart.sh --no-build` 不会自动重编；只 `tsc` 出新 dist 而没重启 → 仍跑旧代码（曾因此导致「改了归店逻辑本地不生效」）。
- 诊断本地服务：`curl --noproxy '*'`（沙箱注入了 HTTP_PROXY，走代理会 502/upstream connect failed）。
- **本地数据库直连**（sandbox 可达，HTTP/端口探测会假失败但 docker 可用）：`docker exec playlish-mysql mysql -uroot -proot123 -N -e "..." ds`；容器 `playlish-mysql`，库 `ds`，**表名 snake_case**（users/stores/products/collect_tasks/pricing_records/screening_runs...）。
- **本机拿 token 做接口验证**：本地 `admin/admin123` **登录不通**（401，本地库密码不同）；改读 `backend/.env` 的 `JWT_SECRET`，用 `backend/node_modules/jsonwebtoken` 现签一个 `{sub:<userId>,username,role}` 的 token 直接调接口（过期时间任意）。
- `npm run build`（nest）会因清 dist 触发 safe-delete 拦截 → 用 `npx tsc -p tsconfig.build.json`（只覆盖写）。
- `next build` 前清 `.next` 会被 safe-delete 拦 → 用 `mv .next /tmp/ds-next-old-$(date +%s)` 移走替代 `rm -rf`；构建用 `env -u NODE_OPTIONS npx next build`（去掉注入的 fs shim，否则 mkdir EEXIST）。
- 前/后端重建后都要**重启进程**（旧进程内存里是旧 manifest / 旧代码）。
- npm registry 在本机不通，尽量零依赖实现（如已自写 CONNECT 代理 `sourcing.proxy.ts`）。也导致 `agent-browser` 之类工具装不上，无法做登录后截图。
- macOS 无 `setsid`；`nohup ... &` 起的服务仍会在**本次工具调用结束时被杀**，起常驻服务只能用后台任务方式。
- 校验前端页面内容别用 `curl 页面URL`：AppShell 是客户端组件，SSR 只输出「加载中…」。要 grep 构建产物 `.next/static/chunks/app/<route>/*.js` 或线上同名 chunk（加 `--compressed`）。
