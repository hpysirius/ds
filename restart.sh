#!/bin/bash
# 命令行入口：./restart.sh  或  bash restart.sh
# 实际逻辑在 scripts/restart.sh
cd "$(dirname "$0")" || exit 1
exec bash scripts/restart.sh "$@"
