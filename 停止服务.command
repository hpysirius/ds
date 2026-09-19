#!/bin/bash
cd "$(dirname "$0")" || exit 1
echo "停止本项目的服务…"
bash scripts/free-ports.sh
sleep 1
for pid in $(pgrep -f "ds/frontend.*next|ds/backend.*nest|ds/backend/dist/main" 2>/dev/null); do
  echo "  清理残留进程 PID $pid"
  kill -9 "$pid" 2>/dev/null
done
echo "完成。"
