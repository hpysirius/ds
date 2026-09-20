#!/bin/bash
# 命令行入口：./stop.sh  或  bash stop.sh
# 实际逻辑在 scripts/stop.sh（先 cd 到项目根，脚本内部按根目录识别本项目进程）
cd "$(dirname "$0")" || exit 1
exec bash scripts/stop.sh "$@"
