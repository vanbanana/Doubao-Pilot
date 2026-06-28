#!/bin/sh
# 豆包 Pilot 本机助手 — macOS 双击安装入口。
# Finder 双击 .command 会在终端里运行；这里直接转交给 install.sh。
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/install.sh" "$@"
