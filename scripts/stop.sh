#!/bin/bash
# 停止本项目的服务（命令行版，等价于「停止服务.command」）
#
# 用法：
#   bash stop.sh             # 停前后端（3100 / 3101）
#   bash stop.sh --chrome    # 顺带关掉「浏览器接管」的调试 Chrome（9222）
#   bash stop.sh -h          # 看帮助
#
# 特点：只清理「属于本项目」的进程（按命令行 / 工作目录匹配项目根目录），
#       不会误杀其它项目的 node 进程。

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/_ds_proc.sh"
STOP_CHROME=0

usage() {
  cat <<'USAGE'
停止本项目的服务（命令行版，等价于「停止服务.command」）

用法：
  bash stop.sh             # 停前后端（3100 / 3101）
  bash stop.sh --chrome    # 顺带关掉「浏览器接管」的调试 Chrome（9222）
  bash stop.sh -h          # 看这份帮助

特点：只清理属于本项目的进程（命令行或工作目录命中项目根目录），
      不会误杀其它项目的 node 进程。
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --chrome) STOP_CHROME=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：${arg}（可用：--chrome / -h）" >&2; exit 2 ;;
  esac
done

echo "停止本项目的服务…（${ROOT}）"

# ---------- 工具函数：判断某个 PID 是否属于本项目（兼容迁移/Trash） ----------
is_project_proc() {
  is_ds_proc "$1"
}

# ---------- ① 释放端口（free-ports 内部已判断归属） ----------
if [ -f "$ROOT/scripts/free-ports.sh" ]; then
  bash "$ROOT/scripts/free-ports.sh" || true
fi

# ---------- ② 清理残留进程 ----------
candidates="$( { pgrep -f "next|nest|npm run start|node dist/main" 2>/dev/null || true; } | sort -u )"
killed=0
for pid in $candidates; do
  [ "$pid" = "$$" ] && continue
  if is_project_proc "$pid"; then
    echo "  清理残留进程 PID ${pid}"
    kill "$pid" 2>/dev/null || true
    killed=$((killed + 1))
  fi
done

# 给 1 秒优雅退出，还活着的强杀
if [ "$killed" -gt 0 ]; then
  sleep 1
  for pid in $candidates; do
    if kill -0 "$pid" 2>/dev/null && is_project_proc "$pid"; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
fi

# ---------- ③ 可选：关掉调试 Chrome（仅本项目用的那份配置） ----------
if [ "$STOP_CHROME" = "1" ]; then
  chrome_pids="$(pgrep -f "chrome_debug_profile" 2>/dev/null || true)"
  if [ -n "$chrome_pids" ]; then
    echo "  关闭调试 Chrome（chrome_debug_profile）"
    for pid in $chrome_pids; do kill "$pid" 2>/dev/null || true; done
    sleep 2
    for pid in $chrome_pids; do
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    done
  else
    echo "  调试 Chrome 未在运行"
  fi
fi

# ---------- 收尾：报告端口状态 ----------
sleep 1
busy=""
for port in 3100 3101; do
  pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' || true)"
  [ -n "$pids" ] && busy="${busy} 端口${port}(PID ${pids})"
done

if [ -n "$busy" ]; then
  echo "完成，但这些端口仍被占用：${busy}"
  echo "（可能是非本项目进程，未做处理）"
  exit 1
fi

echo "完成。前端 3100 / 后端 3101 都已停止。"
