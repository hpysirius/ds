#!/bin/bash
# 生产模式启动后端（自动补齐构建产物、自动清理本项目残留进程）
cd "$(dirname "$0")/backend" || exit 1

if [ ! -d node_modules ]; then
  echo "首次运行：安装后端依赖…"
  npm install || exit 1
fi

if [ ! -f dist/main.js ]; then
  echo "未检测到构建产物，先编译（nest build）…"
  npm run build || exit 1
fi

bash "$(dirname "$0")/scripts/port-guard.sh" 3101 "$(cd "$(dirname "$0")" && pwd)" || exit 1

echo "后端启动中 → http://localhost:3101  (Swagger: /api)"
node dist/main
