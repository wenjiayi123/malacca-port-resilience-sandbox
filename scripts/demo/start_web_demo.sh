#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5180}"
URL="http://${HOST}:${PORT}/"

cd "${PROJECT_ROOT}"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[ERROR] pnpm was not found. Install pnpm 11+ or enable Corepack."
  exit 1
fi

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[OK] Web main system is already running: ${URL}"
  if [[ "${OPEN_BROWSER:-1}" == "1" ]] && command -v open >/dev/null 2>&1; then
    open "${URL}" >/dev/null 2>&1 || true
  fi
  exit 0
fi

echo "[START] Web main system"
echo "[URL] ${URL}"

if [[ "${OPEN_BROWSER:-1}" == "1" ]] && command -v open >/dev/null 2>&1; then
  (sleep 2 && open "${URL}" >/dev/null 2>&1 || true) &
fi

exec pnpm exec vite --host "${HOST}" --port "${PORT}"
