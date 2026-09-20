#!/bin/bash
# 命令行入口：./start.sh  或  bash start.sh
# 实际逻辑在 scripts/start.sh
cd "$(dirname "$0")" || exit 1
exec bash scripts/start.sh "$@"
