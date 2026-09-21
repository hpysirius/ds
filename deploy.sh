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
#   - 前端 NEXT_PUBLIC_API_URL 必须在构建期确定，已写死为 http://114.132.99.141/api（走 80 端口 nginx 反代）。
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
  --exclude=node_modules --exclude=.git --exclude=.next --exclude=dist
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
FRONTEND_URL="http://114.132.99.141"
CHROME_DEBUG_PORT=9222
CHROME_DEBUG_PROFILE="/tmp/chrome_debug_profile"
CHROME_APP_PATH="/tmp/ChromeDebug.app"
UPLOAD_DIR="./uploads"
MAX_FILE_SIZE=10485760
ENV

cat > frontend/.env.local <<ENV
NEXT_PUBLIC_API_URL="http://114.132.99.141/api"
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
systemctl enable --now nginx >/dev/null 2>&1 || true
sleep 4
pm2 status 2>&1 | tail -8
EOF

echo "==> 健康检查"
sleep 3
ssh -o BatchMode=yes -o ConnectTimeout=8 "$SERVER" \
  "curl -s -o /dev/null -w 'frontend /            -> %{http_code}\n' http://localhost:80/ ; \
   curl -s -o /dev/null -w 'api /api/auth/profile -> %{http_code}\n' http://localhost:80/api/auth/profile"

echo "==> 完成 ✅"
echo "访问地址： http://114.132.99.141/      (账号 admin / admin123)"
echo "后端 API： http://114.132.99.141/api"
