#!/bin/bash
# 双击版入口（macOS）：逻辑统一在 scripts/stop.sh，命令行也能直接跑
#   bash scripts/stop.sh [--chrome]
cd "$(dirname "$0")" || exit 1
exec bash scripts/stop.sh "$@"
