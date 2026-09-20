#!/bin/bash
# 重启本项目：先停（含可选关调试 Chrome），再起
#
# 用法：
#   bash restart.sh              # 停掉再后台启动
#   bash restart.sh --chrome     # 停的时候顺带关掉调试 Chrome（9222）
#   bash restart.sh --open       # 启动后打开浏览器
#   bash restart.sh -h           # 帮助
#
# 其余参数会透传给 scripts/start.sh

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STOP_ARGS=""
START_ARGS=""

usage() {
  cat <<'USAGE'
重启本项目（生产模式）

用法：
  bash restart.sh              # 停掉再后台启动
  bash restart.sh --chrome     # 停的时候顺带关掉调试 Chrome（9222）
  bash restart.sh --open       # 启动后打开浏览器
  bash restart.sh -h           # 看这份帮助

其余参数透传给 scripts/start.sh（--foreground / --no-build 等）。
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --chrome) STOP_ARGS="$STOP_ARGS --chrome" ;;
    -h|--help) usage; exit 0 ;;
    *) START_ARGS="$START_ARGS $arg" ;;
  esac
done

echo "① 停止…"
bash "$ROOT/scripts/stop.sh" $STOP_ARGS
sleep 1
echo ""
echo "② 启动…"
# shellcheck disable=SC2086
exec bash "$ROOT/scripts/start.sh" $START_ARGS
