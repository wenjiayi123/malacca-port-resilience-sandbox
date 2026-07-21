#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
GODOT_PROJECT="${GODOT_PROJECT:-}"
GODOT_BIN="${GODOT_BIN:-$(command -v godot4 || command -v godot || true)}"
EXPORT_PRESET="${GODOT_EXPORT_PRESET:-Malacca Web Simulator}"
WEB_EXPORT_DIR="${PROJECT_ROOT}/public/godot-simulator"
WEB_EXPORT_INDEX="${WEB_EXPORT_DIR}/index.html"

if [[ -z "${GODOT_PROJECT}" || ! -d "${GODOT_PROJECT}" || ! -f "${GODOT_PROJECT}/project.godot" ]]; then
  echo "[ERROR] Godot project was not found at ${GODOT_PROJECT}"
  exit 1
fi

if [[ -z "${GODOT_BIN}" || ! -x "${GODOT_BIN}" ]]; then
  echo "[ERROR] Godot executable was not found at ${GODOT_BIN}"
  exit 1
fi

if [[ ! -f "${GODOT_PROJECT}/export_presets.cfg" ]]; then
  echo "[ERROR] Missing Godot export preset file: ${GODOT_PROJECT}/export_presets.cfg"
  exit 1
fi

mkdir -p "${WEB_EXPORT_DIR}"
find "${WEB_EXPORT_DIR}" -maxdepth 1 -type f -name 'index*' -delete

echo "== Export Godot Web simulator =="
echo "Godot project: ${GODOT_PROJECT}"
echo "Export preset: ${EXPORT_PRESET}"
echo "Output: ${WEB_EXPORT_INDEX}"

"${GODOT_BIN}" --headless --path "${GODOT_PROJECT}" --export-release "${EXPORT_PRESET}" "${WEB_EXPORT_INDEX}"

if [[ -f "${WEB_EXPORT_INDEX}" ]]; then
  echo
  echo "[DONE] Godot Web simulator exported:"
  find "${WEB_EXPORT_DIR}" -maxdepth 1 -type f -print | sort
else
  echo "[ERROR] Godot export finished without writing ${WEB_EXPORT_INDEX}"
  exit 1
fi
