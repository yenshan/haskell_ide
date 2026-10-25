#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.jsとnpmが必要です。インストールしてから再実行してください。" >&2
  exit 1
fi

if [[ ! -x node_modules/.bin/electron || ! -x node_modules/.bin/vite || ! -x node_modules/.bin/tsc ]]; then
  echo "起動に必要な依存パッケージをインストールしています…"
  npm ci --include=dev
fi

exec npm start
