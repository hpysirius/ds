#!/bin/bash
# 双击版入口（macOS）：逻辑统一在 scripts/start.sh，命令行也能直接跑
#   bash start.sh --foreground --open
cd "$(dirname "$0")" || exit 1
exec bash scripts/start.sh --foreground --open "$@"
