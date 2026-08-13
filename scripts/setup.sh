#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node。kiseki 需要 Node.js 18+：https://nodejs.org/" >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "未找到 uv。请先安装：https://docs.astral.sh/uv/" >&2
  exit 1
fi

npm ci --prefix cli
npm ci --prefix renderer
npm ci --prefix web
uv sync --project analyzer --group dev
npm --prefix web run build

echo "安装完成。请运行: node cli/kiseki.mjs doctor"
