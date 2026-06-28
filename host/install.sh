#!/bin/sh
# 豆包 Pilot 本机助手 — 一键安装 (macOS / Linux)
# 直接双击 install.command（macOS）或在终端运行 ./install.sh 即可。
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

# 定位 node：优先 PATH，再找常见安装位置。
find_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  for c in \
    /usr/local/bin/node \
    /opt/homebrew/bin/node \
    /usr/bin/node \
    "$HOME/.nvm/versions/node"/*/bin/node \
    "$HOME/.volta/bin/node" \
    "$HOME/.fnm"/*/bin/node \
    "$HOME/n/bin/node"; do
    [ -x "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}

NODE="$(find_node || true)"
if [ -z "$NODE" ]; then
  echo "❌ 未找到 Node.js。请先安装 Node 18+：https://nodejs.org/zh-cn/download"
  echo "   安装完成后重新运行本脚本。"
  printf "按回车键退出…"; read _ 2>/dev/null || true
  exit 1
fi

echo "使用 Node: $NODE"
BROWSER="${1:-chrome}"
"$NODE" "$DIR/install.mjs" install --browser "$BROWSER"

# 双击运行时窗口不要立刻关闭。
printf "\n按回车键关闭此窗口…"; read _ 2>/dev/null || true
