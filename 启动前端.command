#!/bin/bash
# 生产模式启动前端（自动补齐构建产物、自动清理本项目残留进程）
cd "$(dirname "$0")/frontend" || exit 1

if [ ! -d node_modules ]; then
  echo "首次运行：安装前端依赖…"
  npm install || exit 1
fi

if [ ! -f .next/BUILD_ID ]; then
  echo "未检测到生产构建产物（.next/BUILD_ID），先执行 next build…"
  echo "提示：跑过 npm run dev 后 .next 会变成开发态，需要重新 build。"
  npm run build || exit 1
fi

# 端口占用处理
bash "$(dirname "$0")/scripts/port-guard.sh" 3100 "$(cd "$(dirname "$0")" && pwd)" || exit 1

echo "前端启动中 → http://localhost:3100"
npm run start
