#!/bin/bash
# 端口守卫：判断端口是否被「本项目」进程占用，是则清理，否则提示
# 用法: bash scripts/port-guard.sh <端口> <项目根目录>
PORT="$1"
ROOT="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
source "$(dirname "$0")/_ds_proc.sh"

pids=$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ')
[ -z "$pids" ] && exit 0

for pid in $pids; do
  if is_ds_proc "$pid"; then
    echo "  - 端口 $PORT 被本项目残留进程占用 (PID $pid), 正在清理"
    kill "$pid" 2>/dev/null
    sleep 1
    # 还活着就强杀（含其可能残留的子进程）
    if lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      kill -9 "$pid" 2>/dev/null
    fi
  else
    cmd="$(ps -p "$pid" -o command= 2>/dev/null | tr -d '\n')"
    echo "  ! 端口 $PORT 被非本项目进程占用 (PID $pid)"
    [ -n "$cmd" ] && echo "    $cmd"
    exit 1
  fi
done
