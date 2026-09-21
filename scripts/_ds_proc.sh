#!/bin/bash
# 共享：判断某个进程是否属于 ds 项目。
# 兼容项目被移动 / 改名 / 丢进 Trash 的情况（旧进程的 cwd 仍是旧路径）。
# 用法： source scripts/_ds_proc.sh  &&  is_ds_proc <pid>
# 依赖： $ROOT 应已设置（当前项目根目录）

is_ds_proc() {
  pid="$1"
  [ -z "$pid" ] && return 1

  # ① 工作目录命中（最稳）：任何以 ds/backend 或 ds/frontend 结尾的目录都算本项目
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 | sed 's/[[:space:]]*(deleted)$//')"
  case "$cwd" in
    */ds/backend|*/ds/backend/|*/ds/frontend|*/ds/frontend/) return 0 ;;
  esac

  # ② 当前项目根目录（未迁移时的精确匹配）
  [ -n "${ROOT:-}" ] && case "$cwd" in
    "$ROOT"*|*"$ROOT"*) return 0 ;;
  esac

  # ③ 命令行特征兜底
  cmd="$(ps -p "$pid" -o command= 2>/dev/null | tr -d '\n')"
  case "$cmd" in
    *"${ROOT:-__never__}"*|*dist/main*|*next-server*|*"npm run start"*) return 0 ;;
  esac

  return 1
}
