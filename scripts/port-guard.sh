#!/bin/bash
# 端口守卫：判断端口是否被「本项目」的进程占用，是则清理，否则提示
# 用法: bash scripts/port-guard.sh <端口> <项目根目录>
PORT="$1"
ROOT="$2"
[ -z "$ROOT" ] && ROOT="$(cd "$(dirname "$0")/.." && pwd)"

pids=$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ')
[ -z "$pids" ] && exit 0

for pid in $pids; do
  cmd=$(ps -p "$pid" -o command= 2>/dev/null | tr -d '\n')
  # ps 不可用时，用 lsof 判断该进程是否属于本项目（cwd 通常会命中项目路径）
  if [ -z "$cmd" ] && lsof -p "$pid" 2>/dev/null | grep -q "$ROOT"; then
    cmd="$ROOT (fallback-by-lsof)"
  fi

  case "$cmd" in
    *"$ROOT"*)
      echo "  - 端口 $PORT 被本项目残留进程占用 (PID $pid), 正在清理"
      kill "$pid" 2>/dev/null
      sleep 1
      lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && kill -9 "$pid" 2>/dev/null
      ;;
    "")
      echo "  ! 端口 $PORT 被 PID $pid 占用, 但无法确认归属, 请手动处理"
      exit 1
      ;;
    *)
      echo "  ! 端口 $PORT 被非本项目进程占用 (PID $pid)"
      echo "    $cmd"
      exit 1
      ;;
  esac
done
