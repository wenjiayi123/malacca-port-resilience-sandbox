#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5174}"
URL="http://${HOST}:${PORT}/"
HEALTH_URL="${URL%/}/api/rl/health"

cd "${PROJECT_ROOT}"

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  if curl -fsS --max-time 2 "${HEALTH_URL}" | grep -q '"service":"malacca-reference-rl"'; then
    echo "[OK] Malacca system is already running: ${URL}"
    if [[ "${OPEN_BROWSER:-1}" == "1" ]] && command -v open >/dev/null 2>&1; then
      open "${URL}" >/dev/null 2>&1 || true
    fi
    exit 0
  fi
  echo "[ERROR] Port contract conflict: ${PORT} is occupied by another service." >&2
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >&2 || true
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js 24+ was not found."
  exit 1
fi

if command -v pnpm >/dev/null 2>&1; then
  PNPM_CMD=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  PNPM_CMD=(corepack pnpm)
elif command -v npx >/dev/null 2>&1; then
  PNPM_CMD=(npx --yes pnpm@11.9.0)
else
  echo "[ERROR] pnpm, Corepack and npx are unavailable."
  exit 1
fi

if [[ ! -d "node_modules" ]]; then
  echo "[SETUP] Installing locked Web dependencies"
  "${PNPM_CMD[@]}" install --frozen-lockfile
fi

echo "[START] Web main system"
echo "[URL] ${URL}"

if [[ "${OPEN_BROWSER:-1}" == "1" ]] && command -v open >/dev/null 2>&1; then
  (sleep 2 && open "${URL}" >/dev/null 2>&1 || true) &
fi

exec "${PNPM_CMD[@]}" exec vite --host "${HOST}" --port "${PORT}"
