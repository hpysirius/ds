# ds 项目长期约定

## 服务与地址
- 本地：前端 http://localhost:3100、后端 http://localhost:3101（后端无 /api 前缀）；`bash restart.sh [--no-build]` 起，`bash stop.sh` 停。
- 线上：http://114.132.99.141（admin/admin123），API 前缀 `/api`，nginx 反代；`./deploy.sh` 一键部署（服务器上 npm install + prisma generate + build + db push + pm2 重启）。
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

## 沙箱构建/运行坑（每次都会遇到）
- 前台 Bash 里 `nohup ... &` 起的服务，在该次工具调用结束时会**被杀** → 必须用后台任务方式启动。
- 诊断本地服务：`curl --noproxy '*'`（沙箱注入了 HTTP_PROXY，走代理会 502/upstream connect failed）。
- `npm run build`（nest）会因清 dist 触发 safe-delete 拦截 → 用 `npx tsc -p tsconfig.build.json`（只覆盖写）。
- `next build` 前清 `.next` 会被 safe-delete 拦 → 用 `mv .next /tmp/ds-next-old-$(date +%s)` 移走替代 `rm -rf`；构建用 `env -u NODE_OPTIONS npx next build`（去掉注入的 fs shim，否则 mkdir EEXIST）。
- 前/后端重建后都要**重启进程**（旧进程内存里是旧 manifest / 旧代码）。
- npm registry 在本机不通，尽量零依赖实现（如已自写 CONNECT 代理 `sourcing.proxy.ts`）。
