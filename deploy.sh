#!/usr/bin/env bash
#
# deploy.sh — 本地一键把 ds 项目重新部署到腾讯云服务器（tar 直推方式）
#
# 机制：本地打包源码 → 通过 SSH 直接传到服务器 /root/ds（不依赖服务器到 GitHub 的网络）。
#       适合服务器访问 GitHub 不稳的情况。代码改动后，本地跑 ./deploy.sh 即可。
#
# 做了什么：
#   1. 检查 SSH 连接
#   2. 本地打包源码（排除 node_modules/.git/构建产物/本机 env）传到服务器
#   3. 在服务器重建 backend/.env、frontend/.env.local、ecosystem.config.js
#      （这几个文件不在仓库里，重部署必须重建；DB 密码读 /root/.ds_db_root.txt，JWT 持久化到 /root/.ds_jwt.txt）
#   4. npm install + prisma generate + build 后端/前端 + prisma db push（幂等，不重复 seed）+ pm2 重启
#   5. 健康检查并输出访问地址
#
# 注意事项：
#   - 数据库数据在服务器 MySQL 里（/root/ds 只是代码），删除 /root/ds 不会丢数据。
#   - 前端 NEXT_PUBLIC_API_URL 必须在构建期确定，这里固定为相对路径 "/api"（同源，走 80 端口 nginx 反代），
#     因此域名（http://ozon.qinxianty.com）和旧 IP（http://114.132.99.141）都能直接用，互不干扰。
#   - nginx 站点配置由本脚本生成（/etc/nginx/conf.d/ds.conf），server_name 同时含域名与 IP。
#   - 仅腾讯云安全组需放行 TCP 80；3100/3101 不必对外开。
#
# 用法：
#   ./deploy.sh
#
set -eo pipefail

SERVER="root@114.132.99.141"
REMOTE_DIR="/root/ds"

# 切到脚本所在目录（项目根）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> [1/5] 检查 SSH 连接"
ssh -o BatchMode=yes -o ConnectTimeout=8 "$SERVER" 'echo SSH_OK' \
  || { echo "ERROR: 无法 SSH 连接到 $SERVER，请确认 SSH key 已配置"; exit 1; }

echo "==> [2/5] 本地打包源码并直传到服务器（排除依赖/构建产物/本机 env）"
Excludes=(
  --exclude=node_modules --exclude=.git --exclude=dist
  # 注意：必须写成 '.next*' 而不是 '.next' —— 后者只匹配名字恰为 .next 的目录，
  # 匹配不到 .next-old-*（前端换构建产物时 mv 出来的旧目录，单个约 230MB，累积过 GB），
  # 会导致每次部署白白多传 1GB 并占满服务器磁盘
  --exclude='.next' --exclude='.next-*'
  --exclude=run --exclude='*.sql'
  --exclude='.env' --exclude='.env.local' --exclude='*/.env' --exclude='*/.env.local'
  --exclude='.workbuddy' --exclude='deploy.sh'
)
# 纯 tar 流 + ssh，二者不在同一条 heredoc 里，避免二进制流被当成脚本
tar -czf - "${Excludes[@]}" . 2>/dev/null \
  | ssh -o BatchMode=yes -o ConnectTimeout=10 "$SERVER" \
      "rm -rf $REMOTE_DIR && mkdir -p $REMOTE_DIR && tar -xzf - -C $REMOTE_DIR && echo TRANSFER_DONE && echo \"files: \$(find $REMOTE_DIR -type f | wc -l)\""

echo "==> [3/5] 在服务器生成 env / pm2 配置"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SERVER" "bash -s" <<'EOF'
set -e
cd /root/ds

if [ ! -f /root/.ds_db_root.txt ]; then
  echo "ERROR: 服务器缺少数据库 root 密码文件 /root/.ds_db_root.txt，请先手动写入（内容即 MySQL root 密码）"
  exit 1
fi
PW=$(cat /root/.ds_db_root.txt)

# JWT 持久化：首次生成后复用，避免重部署后用户登录态失效
if [ -f /root/.ds_jwt.txt ]; then
  JWT=$(cat /root/.ds_jwt.txt)
else
  JWT=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 48)
  echo "$JWT" > /root/.ds_jwt.txt
  chmod 600 /root/.ds_jwt.txt
fi

cat > backend/.env <<ENV
DATABASE_URL="mysql://root:${PW}@localhost:3306/ds"
JWT_SECRET="${JWT}"
JWT_EXPIRATION="7d"
PORT=3101
# 允许的前端来源（CORS 白名单，逗号分隔）：域名 + 旧 IP 都保留
FRONTEND_URL="http://ozon.qinxianty.com,http://114.132.99.141"
# 「本地抓取回退」用：线上页面（域名/IP）里操作核价时，浏览器会带上该 origin 请求用户本机后端，
# 本机后端必须放行这两个 origin，否则会被 CORS 拦掉
PUBLIC_SITE_URL="http://ozon.qinxianty.com,http://114.132.99.141"
CHROME_DEBUG_PORT=9222
CHROME_DEBUG_PROFILE="/tmp/chrome_debug_profile"
CHROME_APP_PATH="/tmp/ChromeDebug.app"
UPLOAD_DIR="./uploads"
MAX_FILE_SIZE=10485760
ENV

# NEXT_PUBLIC_API_URL 必须是「相对路径 /api」：
#   - 走同源（页面在哪个域名/端口，请求就打到哪），由 nginx 把 /api/ 反代到 3101；
#   - 这样无论用域名 http://ozon.qinxianty.com 还是旧 IP 访问都不会跨域，也不用再改构建配置。
#   （本地开发不读这个文件，走 lib/api.ts 里的默认值 http://localhost:3101）
cat > frontend/.env.local <<ENV
NEXT_PUBLIC_API_URL="/api"
BACKEND_URL="http://localhost:3101"
ENV

cat > ecosystem.config.js <<JS
module.exports = {
  apps: [
    {
      name: 'ds-backend',
      cwd: '/root/ds/backend',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '700M',
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'ds-frontend',
      cwd: '/root/ds/frontend',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3100',
      instances: 1,
      autorestart: true,
      max_memory_restart: '900M',
      env: { NODE_ENV: 'production', BACKEND_URL: 'http://localhost:3101' }
    }
  ]
};
JS

export NODE_OPTIONS=--max-old-space-size=1536
export PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
npm config set registry https://registry.npmmirror.com >/dev/null 2>&1
echo ENV_DONE
EOF

echo "==> [4/5] 构建后端"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SERVER" "bash -s" <<'EOF'
export PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
export NODE_OPTIONS=--max-old-space-size=1536
cd /root/ds/backend
echo "--- backend npm install ---"
npm install --no-audit --no-fund 2>&1 | tail -3
echo "--- prisma generate ---"
npx prisma generate 2>&1 | tail -3
echo "--- backend build ---"
npm run build 2>&1 | tail -5
ls -la dist/main.js
echo "--- db push (idempotent) ---"
npx prisma db push --skip-generate 2>&1 | tail -5
EOF

echo "==> [4/5] 构建前端"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SERVER" "bash -s" <<'EOF'
export NODE_OPTIONS=--max-old-space-size=1536
cd /root/ds/frontend
echo "--- frontend npm install ---"
npm install --no-audit --no-fund 2>&1 | tail -3
echo "--- frontend build ---"
npm run build 2>&1 | tail -6
ls -la .next/BUILD_ID
EOF

echo "==> [5/5] pm2 重启 + 确保 nginx"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SERVER" "bash -s" <<'EOF'
set -e
cd /root/ds
pm2 delete ds-backend ds-frontend 2>/dev/null || true
pm2 start ecosystem.config.js 2>&1 | tail -8
pm2 save 2>&1 | tail -2
pm2 startup >/dev/null 2>&1 || true

# ---- nginx 站点配置（幂等重建；server_name 同时覆盖域名与旧 IP）----
#     注意：这里的 $host / $remote_addr 等是 nginx 变量，需原样写入，故 heredoc 用 'NGINX' 不展开
cp -a /etc/nginx/conf.d/ds.conf /etc/nginx/conf.d/ds.conf.bak 2>/dev/null || true
cat > /etc/nginx/conf.d/ds.conf <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    # 主域名 + 旧 IP 都收敛到同一个站点（_ 兜底，防止其他域名/直连 IP 落到空站点）
    server_name ozon.qinxianty.com 114.132.99.141 _;

    client_max_body_size 50m;

    # backend API -> strip /api prefix when forwarding
    location /api/ {
        proxy_pass http://127.0.0.1:3101/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # backend static uploads
    location /uploads/ {
        proxy_pass http://127.0.0.1:3101;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # frontend web app
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

systemctl enable --now nginx >/dev/null 2>&1 || true
if nginx -t >/dev/null 2>&1; then
  systemctl reload nginx
  echo "nginx: 配置已更新并重载"
else
  echo "ERROR: nginx 配置校验失败，已回滚为备份配置"
  cp -a /etc/nginx/conf.d/ds.conf.bak /etc/nginx/conf.d/ds.conf 2>/dev/null || true
  systemctl reload nginx || true
  exit 1
fi

sleep 4
pm2 status 2>&1 | tail -8
EOF

echo "==> 健康检查"
sleep 3
ssh -o BatchMode=yes -o ConnectTimeout=8 "$SERVER" \
  "curl -s -o /dev/null -w 'frontend /            -> %{http_code}\n' http://localhost:80/ ; \
   curl -s -o /dev/null -w 'api /api/auth/profile -> %{http_code}\n' http://localhost:80/api/auth/profile ; \
   curl -s -o /dev/null -w 'domain  / (Host头)     -> %{http_code}\n' -H 'Host: ozon.qinxianty.com' http://localhost:80/ ; \
   curl -s -o /dev/null -w 'domain  /api/auth/profile -> %{http_code}\n' -H 'Host: ozon.qinxianty.com' http://localhost:80/api/auth/profile"

echo "==> 完成 ✅"
echo "访问地址： http://ozon.qinxianty.com/      (账号 admin / admin123)"
echo "备用地址： http://114.132.99.141/"
echo "后端 API： http://ozon.qinxianty.com/api"
echo "插件后端地址请填： http://ozon.qinxianty.com/api"
