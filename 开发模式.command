#!/bin/bash
# 开发模式：热更新，改代码即时生效（不要用 npm start）
cd "$(dirname "$0")" || exit 1

echo "清理上次残留的进程…"
bash scripts/free-ports.sh

( cd backend  && npm run start:dev > /tmp/ds-backend-dev.log  2>&1 ) &
( cd frontend && npm run dev        > /tmp/ds-frontend-dev.log 2>&1 ) &

sleep 12
open "http://localhost:3100"
echo "开发模式已启动（前端 3100 / 后端 3101，均带热更新）"
echo "注意：开发模式会占用 .next，之后想跑生产模式请先 npm run build"
wait
