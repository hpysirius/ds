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

# 确认端口真的释放了再启动；否则新进程会因端口被占而静默起不来
for port in 3100 3101; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    holder="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ')"
    echo "✘ 端口 $port 仍被占用 (PID ${holder})，无法安全启动。"
    echo "  请先执行： bash stop.sh   然后重试。"
    exit 1
  fi
done

# ---------- ③ 依赖与构建产物 ----------
if [ "$BUILD" = "1" ]; then
  if [ ! -d "$ROOT/backend/node_modules" ]; then
    echo "首次运行：安装后端依赖…"
    ( cd "$ROOT/backend" && npm install ) || exit 1
  fi
  if [ ! -d "$ROOT/frontend/node_modules" ]; then
    echo "首次运行：安装前端依赖…"
    ( cd "$ROOT/frontend" && npm install ) || exit 1
  fi

  # 后端：产物缺失，或源码比产物新 → 重新编译
  # （只判断「产物是否存在」是不够的：改了源码但产物还在，重启就会一直跑旧代码）
  need_be=0
  [ ! -f "$ROOT/backend/dist/main.js" ] && need_be=1
  if [ -f "$ROOT/backend/dist/main.js" ] && \
     [ -n "$(find "$ROOT/backend/src" -type f -newer "$ROOT/backend/dist/main.js" 2>/dev/null | head -1)" ]; then
    need_be=1
  fi
  if [ "$need_be" = "1" ]; then
    echo "后端源码有更新（或缺构建产物），重新编译…"
    ( cd "$ROOT/backend" && npm run build ) || exit 1
  else
    echo "  后端构建产物已是最新，跳过编译"
  fi

  # 前端：同理。注意「跑过 npm run dev」会让 .next 变成开发态，必须重新 build
  need_fe=0
  [ ! -f "$ROOT/frontend/.next/BUILD_ID" ] && need_fe=1
  if [ -f "$ROOT/frontend/.next/BUILD_ID" ] && \
     [ -n "$(find "$ROOT/frontend/src" -type f -newer "$ROOT/frontend/.next/BUILD_ID" 2>/dev/null | head -1)" ]; then
    need_fe=1
  fi
  if [ "$need_fe" = "1" ]; then
    echo "前端源码有更新（或缺生产构建产物），重新编译…（Next.js 生产构建，约 1-3 分钟）"
    ( cd "$ROOT/frontend" && npm run build ) || exit 1
  else
    echo "  前端构建产物已是最新，跳过编译"
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
be_pid="$(cat "$ROOT/run/backend.pid" 2>/dev/null)"
fe_pid="$(cat "$ROOT/run/frontend.pid" 2>/dev/null)"

if wait_port 3101 30; then
  # 端口起来了，但必须确认「本项目刚启动的进程」还活着，
  # 否则可能只是旧进程在顶着端口（曾经的重启假成功就源于此）
  if [ -n "$be_pid" ] && kill -0 "$be_pid" 2>/dev/null; then
    echo "✔ 后端已启动 (PID $be_pid)"
  else
    echo "✘ 后端端口被占用但本项目进程未存活（很可能是旧进程顶着端口或启动即崩），看 $BACKEND_LOG"
    tail -n 20 "$BACKEND_LOG" 2>/dev/null
    ok=0
  fi
else
  echo "✘ 后端 30 秒内没起来，看 $BACKEND_LOG"
  ok=0
fi

if wait_port 3100 60; then
  if [ -n "$fe_pid" ] && kill -0 "$fe_pid" 2>/dev/null; then
    echo "✔ 前端已启动 (PID $fe_pid)"
  else
    echo "✘ 前端端口被占用但本项目进程未存活，看 $FRONTEND_LOG"
    tail -n 20 "$FRONTEND_LOG" 2>/dev/null
    ok=0
  fi
else
  echo "✘ 前端 60 秒内没起来，看 $FRONTEND_LOG"
  ok=0
fi

[ "$OPEN" = "1" ] && open "http://localhost:3100"

echo ""
echo "前端：http://localhost:3100"
echo "后端：http://localhost:3101   （API 文档 /api）"
echo "默认账号：admin / admin123"
echo "日志：${BACKEND_LOG}  ${FRONTEND_LOG}"
echo "停止：bash stop.sh    （连调试 Chrome 一起停：bash stop.sh --chrome）"
[ "$ok" = "1" ] || exit 1
