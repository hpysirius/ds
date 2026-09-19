#!/bin/bash
# 生产模式：同时拉起后端 + 前端，并打开页面
cd "$(dirname "$0")" || exit 1

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q mysql; then
  echo "⚠️  没有检测到运行中的 MySQL 容器，请先启动数据库（或 docker compose up -d）"
fi

echo "① 清理上次残留的进程…"
bash scripts/free-ports.sh

echo "② 准备后端…"
( cd backend
  [ -d node_modules ] || npm install
  [ -f dist/main.js ] || npm run build
) || exit 1

echo "③ 准备前端…"
( cd frontend
  [ -d node_modules ] || npm install
  [ -f .next/BUILD_ID ] || npm run build
) || exit 1

echo "④ 启动服务…"
( cd backend  && node dist/main > /tmp/ds-backend.log  2>&1 ) &
( cd frontend && npm run start  > /tmp/ds-frontend.log 2>&1 ) &

sleep 8
open "http://localhost:3100"
echo ""
echo "前端: http://localhost:3100"
echo "后端: http://localhost:3101  (API 文档 /api)"
echo "默认账号: admin / admin123"
echo "日志: /tmp/ds-backend.log  /tmp/ds-frontend.log"
echo ""
echo "关闭本窗口即停止服务；或双击「停止服务.command」"
wait
