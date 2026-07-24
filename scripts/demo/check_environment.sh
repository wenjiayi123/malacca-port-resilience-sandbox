#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
GODOT_PROJECT="${GODOT_PROJECT:-}"
GODOT_BIN="${GODOT_BIN:-$(command -v godot4 || command -v godot || true)}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5180}"

cd "${PROJECT_ROOT}"

echo "== Malacca demo environment =="
echo "Web project: ${PROJECT_ROOT}"
echo "Godot project edition: ${GODOT_PROJECT}"
echo "Godot binary: ${GODOT_BIN}"
echo "Web URL: http://${HOST}:${PORT}/"
echo

if command -v node >/dev/null 2>&1; then
  echo "[OK] node $(node --version)"
else
  echo "[FAIL] node is not available"
  exit 1
fi

if command -v pnpm >/dev/null 2>&1; then
  echo "[OK] pnpm $(pnpm --version)"
else
  echo "[FAIL] pnpm is not available"
  exit 1
fi

if [[ -f "package.json" && -d "node_modules" ]]; then
  echo "[OK] Web dependencies are present"
else
  echo "[FAIL] Missing package.json or node_modules"
  exit 1
fi

if [[ -n "${GODOT_PROJECT}" && -d "${GODOT_PROJECT}" && -f "${GODOT_PROJECT}/project.godot" ]]; then
  echo "[OK] Godot subsystem is retained as project edition"
else
  echo "[INFO] Optional Godot project is not configured; set GODOT_PROJECT to enable bridge checks"
fi

if [[ -n "${GODOT_BIN}" && -x "${GODOT_BIN}" ]]; then
  echo "[OK] Godot executable is available"
else
  echo "[WARN] Godot executable was not found or is not executable"
fi

if [[ -n "${GODOT_PROJECT}" && -f "${GODOT_PROJECT}/export_presets.cfg" ]]; then
  echo "[OK] Godot Web export preset is present"
else
  echo "[INFO] Godot Web export preset is not present"
fi

if [[ -f "${PROJECT_ROOT}/public/godot-simulator/index.html" ]]; then
  echo "[OK] Embedded Godot Web simulator is available"
else
  echo "[INFO] Embedded Godot Web simulator is not exported yet. Run: pnpm demo:godot:web"
fi

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[OK] Web server is listening on ${HOST}:${PORT}"
else
  echo "[INFO] Web server is not running. Start it with: pnpm demo:web"
fi

if [[ "${RUN_BUILD:-1}" == "1" ]]; then
  echo
  echo "== Web build check =="
  pnpm build
fi

if [[ "${RUN_GODOT_CHECK:-0}" == "1" && -n "${GODOT_PROJECT}" && -n "${GODOT_BIN}" && -x "${GODOT_BIN}" ]]; then
  echo
  echo "== Godot project check =="
  "${GODOT_BIN}" --path "${GODOT_PROJECT}" --check-only --quit
fi

echo
echo "[DONE] Local demo environment check complete"
