#!/bin/bash
# 释放本项目占用的 3100 / 3101 端口
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "  检查端口占用..."
bash "$(dirname "$0")/port-guard.sh" 3100 "$ROOT" || true
bash "$(dirname "$0")/port-guard.sh" 3101 "$ROOT" || true
