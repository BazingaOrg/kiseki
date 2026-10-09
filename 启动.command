#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "还没有 Node.js。请先安装 18 或更新版本：https://nodejs.org/"
  open "https://nodejs.org/"
  exit 1
fi

if [[ ! -d cli/node_modules || ! -d web/node_modules || ! -f web/dist/index.html ]]; then
  npm ci --prefix cli
  npm ci --prefix renderer
  npm ci --prefix web
  npm --prefix web run build
fi

if command -v uv >/dev/null 2>&1; then
  uv sync --project analyzer --group dev
fi

exec node cli/kiseki.mjs web
