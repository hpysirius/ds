#!/bin/bash
# 启动本项目（生产模式）：后端 3101 + 前端 3100
# 命令行版，等价于「一键启动.command」
#
# 用法：
#   bash start.sh                 # 后台常驻启动，跑完就返回（推荐）
#   bash start.sh --foreground    # 前台启动，Ctrl-C 停止（等于双击 .command 的行为）
#   bash start.sh --open          # 启动后打开浏览器
#   bash start.sh --no-build      # 缺构建产物也不自动编译（只想快速起）
#   bash start.sh -h              # 帮助
#
# 日志：/tmp/ds-backend.log、/tmp/ds-frontend.log
# PID： run/backend.pid、run/frontend.pid

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_LOG=/tmp/ds-backend.log
FRONTEND_LOG=/tmp/ds-frontend.log
FOREGROUND=0
OPEN=0
BUILD=1

usage() {
  cat <<'USAGE'
启动本项目（生产模式：后端 3101 + 前端 3100）

用法：
  bash start.sh                 # 后台常驻启动，跑完就返回（推荐）
  bash start.sh --foreground    # 前台启动，Ctrl-C 停止
  bash start.sh --open          # 启动后打开浏览器
  bash start.sh --no-build      # 缺构建产物也不自动编译
  bash start.sh -h              # 看这份帮助
USAGE
}

for arg in "$@"; do
  case "$arg" in
    -f|--foreground) FOREGROUND=1 ;;
    -o|--open) OPEN=1 ;;
    --no-build) BUILD=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：${arg}（可用：--foreground / --open / --no-build / -h）" >&2; exit 2 ;;
  esac
done

wait_port() {
  port="$1"; timeout="$2"; i=0
  while [ "$i" -lt "$timeout" ]; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then return 0; fi
    sleep 1; i=$((i + 1))
  done
  return 1
}

echo "启动本项目…（${ROOT}）"

# ---------- ① 数据库提醒 ----------
if command -v docker >/dev/null 2>&1; then
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q mysql; then
    echo "⚠️  没有检测到运行中的 MySQL 容器（可先 docker compose up -d）"
  fi
fi

# ---------- ② 释放端口（只清理本项目残留） ----------
bash "$ROOT/scripts/free-ports.sh" || true

# ---------- ③ 依赖与构建产物 ----------
if [ "$BUILD" = "1" ]; then
  if [ ! -d "$ROOT/backend/node_modules" ]; then
    echo "首次运行：安装后端依赖…"
    ( cd "$ROOT/backend" && npm install ) || exit 1
  fi
  if [ ! -f "$ROOT/backend/dist/main.js" ]; then
    echo "后端缺构建产物，先编译…"
    ( cd "$ROOT/backend" && npm run build ) || exit 1
  fi
  if [ ! -d "$ROOT/frontend/node_modules" ]; then
    echo "首次运行：安装前端依赖…"
    ( cd "$ROOT/frontend" && npm install ) || exit 1
  fi
  if [ ! -f "$ROOT/frontend/.next/BUILD_ID" ]; then
    echo "前端缺生产构建产物（.next/BUILD_ID），先编译…"
    echo "提示：跑过 npm run dev 之后 .next 会变开发态，需要重新 build。"
    ( cd "$ROOT/frontend" && npm run build ) || exit 1
  fi
else
  if [ ! -f "$ROOT/backend/dist/main.js" ] || [ ! -f "$ROOT/frontend/.next/BUILD_ID" ]; then
    echo "⚠️  --no-build 但构建产物不全，可能起不来"
  fi
fi

# ---------- ④ 启动 ----------
mkdir -p "$ROOT/run"

if [ "$FOREGROUND" = "1" ]; then
  echo "前台启动（Ctrl-C 停止）…"
  ( cd "$ROOT/backend"  && exec node dist/main ) >"$BACKEND_LOG"  2>&1 &
  BE_PID=$!
  ( cd "$ROOT/frontend" && exec npm run start ) >"$FRONTEND_LOG" 2>&1 &
  FE_PID=$!

  cleanup() {
    echo ""
    echo "收到中断，停止服务…"
    kill "$BE_PID" "$FE_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$BE_PID" "$FE_PID" 2>/dev/null || true
    exit 0
  }
  trap cleanup INT TERM

  wait_port 3101 30 && echo "✔ 后端就绪 → http://localhost:3101"
  wait_port 3100 60 && echo "✔ 前端就绪 → http://localhost:3100"
  [ "$OPEN" = "1" ] && open "http://localhost:3100"
  echo ""
  echo "日志：${BACKEND_LOG}  ${FRONTEND_LOG}"
  echo "停止：Ctrl-C，或另开终端执行 bash stop.sh"
  wait
  exit 0
fi

# 后台常驻：nohup + 关掉 stdin + disown，确保脚本退出/关终端后服务继续跑
( cd "$ROOT/backend" && nohup node dist/main >"$BACKEND_LOG" 2>&1 </dev/null & echo $! >"$ROOT/run/backend.pid"; disown ) 2>/dev/null
( cd "$ROOT/frontend" && nohup npm run start >"$FRONTEND_LOG" 2>&1 </dev/null & echo $! >"$ROOT/run/frontend.pid"; disown ) 2>/dev/null

echo "等待服务就绪…"
ok=1
if wait_port 3101 30; then echo "✔ 后端已启动 (PID $(cat "$ROOT/run/backend.pid" 2>/dev/null))"; else echo "✘ 后端 30 秒内没起来，看 $BACKEND_LOG"; ok=0; fi
if wait_port 3100 60; then echo "✔ 前端已启动 (PID $(cat "$ROOT/run/frontend.pid" 2>/dev/null))"; else echo "✘ 前端 60 秒内没起来，看 $FRONTEND_LOG"; ok=0; fi

[ "$OPEN" = "1" ] && open "http://localhost:3100"

echo ""
echo "前端：http://localhost:3100"
echo "后端：http://localhost:3101   （API 文档 /api）"
echo "默认账号：admin / admin123"
echo "日志：${BACKEND_LOG}  ${FRONTEND_LOG}"
echo "停止：bash stop.sh    （连调试 Chrome 一起停：bash stop.sh --chrome）"
[ "$ok" = "1" ] || exit 1
