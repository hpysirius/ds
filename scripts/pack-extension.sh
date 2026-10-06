#!/usr/bin/env bash
#
# pack-extension.sh — 把浏览器插件 extension/ds-collector 打成可下载的 zip
#
# 产物（都放在 frontend/public/plugin/ 下，随前端静态资源一起发布）：
#   ds-collector.zip             固定文件名，前端下载入口永远指向它（换版本不用改代码）
#   ds-collector-v<version>.zip  带版本号的副本，便于留存/回滚
#   plugin-info.json             版本号 / 名称 / 体积 / 打包时间 / 文件数，前端读它显示"当前版本"
#
# zip 内部结构：顶层目录 ds-collector/（含 manifest.json + INSTALL.txt 中文安装说明），
# 用户解压后得到 ds-collector 文件夹，直接在 chrome://extensions 里"加载已解压的扩展程序"选中它。
#
# 用法：
#   bash scripts/pack-extension.sh          # 手动打包
#   （deploy.sh 会在部署前自动调用一次，所以插件改完直接跑 deploy.sh 即可）
#
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$ROOT/extension/ds-collector"
OUT_DIR="$ROOT/frontend/public/plugin"

command -v zip >/dev/null 2>&1 || { echo "ERROR: 找不到 zip 命令，无法打包插件"; exit 1; }
[ -f "$SRC/manifest.json" ] || { echo "ERROR: 找不到 $SRC/manifest.json"; exit 1; }

mkdir -p "$OUT_DIR"

# ---- 用临时目录组装：避免把 INSTALL.txt 之类生成物写进源码目录 ----
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -R "$SRC" "$TMP/ds-collector"
# 清掉 macOS / 编辑器产生的垃圾，避免打进包里
find "$TMP/ds-collector" -name '.DS_Store' -delete 2>/dev/null || true
find "$TMP/ds-collector" -name '*.bak' -delete 2>/dev/null || true
find "$TMP/ds-collector" -name '*.zip' -delete 2>/dev/null || true

cat > "$TMP/ds-collector/INSTALL.txt" <<'INSTALL'
DS Ozon 采集助手 — 安装说明
================================

一、安装
  1. 解压本压缩包，得到一个 ds-collector 文件夹（记住它的位置，装好后不要删）。
  2. 打开 Chrome，地址栏输入：chrome://extensions
  3. 打开右上角的「开发者模式」开关。
  4. 点左上角「加载已解压的扩展程序」，选中刚解压出来的 ds-collector 文件夹。
  5. 安装完成，浏览器工具栏出现插件图标（若没显示，点拼图图标把它固定出来）。

二、首次配置
  1. 先在浏览器里登录本系统（http://ozon.qinxianty.com），登录态会被插件读取，
     用来把采集到的数据归到你所在的店铺。
  2. 点插件图标打开面板，把「服务器地址」填成：http://ozon.qinxianty.com/api
     （本地调试才填 http://localhost:3101）
  3. 到「采集规则」里按需配置筛选条件。

三、更新
  重新下载最新压缩包，解压覆盖原来的 ds-collector 文件夹（或解压到新目录），
  回到 chrome://extensions 点插件卡片上的「重新加载」按钮即可。
  插件版本号显示在插件面板底部，也可在 chrome://extensions 的插件卡片上看到。

四、常见问题
  · 采集到 0 条：确认当前页是 Ozon 商品列表页，且已登录本系统。
  · 数据没进系统：检查插件「服务器地址」是否与当前登录的系统地址一致。
  · 商品图片不显示：图片走系统代理，属于正常现象，刷新页面即可。
INSTALL

# ---- 打包 ----
VERSION="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).version)" "$SRC/manifest.json")"
[ -n "$VERSION" ] || { echo "ERROR: 读不到插件版本号"; exit 1; }

rm -f "$OUT_DIR"/ds-collector.zip "$OUT_DIR"/ds-collector-v*.zip
( cd "$TMP" && zip -rq -X "$OUT_DIR/ds-collector.zip" ds-collector -x '*.DS_Store' -x '*/__MACOSX/*' )

# 校验：包内 manifest 的版本必须与源码一致
INNER_VERSION="$(unzip -p "$OUT_DIR/ds-collector.zip" ds-collector/manifest.json \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).version||'')}catch(e){process.stdout.write('')}})")"
if [ "$INNER_VERSION" != "$VERSION" ]; then
  echo "ERROR: 打包校验失败（源码 v$VERSION ≠ 包内 v${INNER_VERSION:-空}）"
  exit 1
fi

cp "$OUT_DIR/ds-collector.zip" "$OUT_DIR/ds-collector-v$VERSION.zip"

# ---- 生成前端读取的元信息 ----
node -e '
const fs = require("fs"), path = require("path");
const [, src, outDir] = process.argv;
const m = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
const zipPath = path.join(outDir, "ds-collector.zip");
const st = fs.statSync(zipPath);
const info = {
  name: m.name || "DS Ozon 采集助手",
  version: m.version || "",
  description: m.description || "",
  file: "/plugin/ds-collector.zip",
  versionedFile: `/plugin/ds-collector-v${m.version || ""}.zip`,
  size: st.size,
  fileCount: (() => {
    try {
      return require("child_process").execSync(`unzip -Z1 "${zipPath}"`).toString().trim().split("\n").filter(Boolean).length;
    } catch (e) {
      return null;
    }
  })(),
  builtAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(outDir, "plugin-info.json"), JSON.stringify(info, null, 2) + "\n");
console.log(`plugin-info: ${info.name} v${info.version}  ${(info.size / 1024).toFixed(1)} KB  ${info.fileCount} 个文件`);
' "$SRC" "$OUT_DIR"

echo "✅ 插件已打包：frontend/public/plugin/ds-collector.zip （v$VERSION）"
