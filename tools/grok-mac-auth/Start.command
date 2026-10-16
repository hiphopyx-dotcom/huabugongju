#!/bin/bash
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd -- "$(dirname -- "$0")"
if [ "$(uname -s)" != "Darwin" ]; then
  echo '请在 Mac mini 上双击运行。'
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo '需要先安装 Node.js 22 或更新版：https://nodejs.org/'
  read -r -p '按回车退出…' unused
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)'; then
  echo 'Node.js 版本过低，需要22或更新版。'
  read -r -p '按回车退出…' unused
  exit 1
fi
node start.mjs
read -r -p '按回车关闭…' unused
