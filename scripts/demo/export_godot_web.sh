#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
GODOT_PROJECT="${GODOT_PROJECT:-}"
GODOT_BIN="${GODOT_BIN:-$(command -v godot4 || command -v godot || true)}"
EXPORT_PRESET="${GODOT_EXPORT_PRESET:-Malacca Web Simulator}"
WEB_EXPORT_DIR="${PROJECT_ROOT}/public/godot-simulator"
RUNTIME_ROOT="${PROJECT_ROOT}/.runtime/godot-exports"

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

mkdir -p "${RUNTIME_ROOT}"
EXPORT_STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
STAGING_DIR="$(mktemp -d "${RUNTIME_ROOT}/staging-${EXPORT_STAMP}.XXXXXX")"
BACKUP_DIR="${RUNTIME_ROOT}/backup-${EXPORT_STAMP}"
SOURCE_COPY="${RUNTIME_ROOT}/source-${EXPORT_STAMP}"
SOURCE_PROVENANCE="${RUNTIME_ROOT}/source-${EXPORT_STAMP}.json"
WEB_VARIANT="${RUNTIME_ROOT}/web-variant-${EXPORT_STAMP}.json"
python3 "${SCRIPT_DIR}/validate_godot_export.py" --source "${GODOT_PROJECT}" "${SOURCE_PROVENANCE}"
if [[ "$(uname -s)" == "Darwin" ]]; then
  cp -cR "${GODOT_PROJECT}" "${SOURCE_COPY}"
else
  cp -a --reflink=auto "${GODOT_PROJECT}" "${SOURCE_COPY}"
fi
python3 "${SCRIPT_DIR}/validate_godot_export.py" --prepare-web "${SOURCE_COPY}" "${WEB_VARIANT}"
restore_previous_export() {
  if [[ ! -e "${WEB_EXPORT_DIR}" && -d "${BACKUP_DIR}" ]]; then
    mv "${BACKUP_DIR}" "${WEB_EXPORT_DIR}"
  fi
}
trap restore_previous_export EXIT
if [[ -f "${WEB_EXPORT_DIR}/README.md" ]]; then
  cp "${WEB_EXPORT_DIR}/README.md" "${STAGING_DIR}/README.md"
fi

echo "== Export Godot Web simulator =="
echo "Godot project: ${GODOT_PROJECT}"
echo "Export preset: ${EXPORT_PRESET}"
echo "Staging output: ${STAGING_DIR}/index.html"

"${GODOT_BIN}" --headless --path "${SOURCE_COPY}" --export-release "${EXPORT_PRESET}" "${STAGING_DIR}/index.html" 2>&1 | tee "${RUNTIME_ROOT}/export-${EXPORT_STAMP}.log"
# Run the genuine exported bridge before installing an export that uses the
# terrain adapter. The native engine loads the exported PCK with immediate
# headless finalization explicitly disabled, so both outcomes run physics.
if python3 "${SCRIPT_DIR}/validate_godot_export.py" --has-coordinate-patch "${WEB_VARIANT}"; then
  "${GODOT_BIN}" --headless --main-pack "${STAGING_DIR}/index.pck" --script "${SCRIPT_DIR}/verify_godot_web_coordinates.gd" -- \
    --request="${SCRIPT_DIR}/godot_web_coordinate_request.json" --output="${STAGING_DIR}/coordinate-validation.json" 2>&1 | tee "${RUNTIME_ROOT}/coordinates-${EXPORT_STAMP}.log"
fi
python3 "${SCRIPT_DIR}/validate_godot_export.py" "${STAGING_DIR}" "${SOURCE_PROVENANCE}" "$("${GODOT_BIN}" --version)" "${EXPORT_PRESET}" "${WEB_VARIANT}"

if [[ -d "${WEB_EXPORT_DIR}" ]]; then
  mv "${WEB_EXPORT_DIR}" "${BACKUP_DIR}"
fi
mv "${STAGING_DIR}" "${WEB_EXPORT_DIR}"
echo "[DONE] Complete Godot Web export installed: ${WEB_EXPORT_DIR}/index.html"
echo "[BACKUP] Previous export preserved: ${BACKUP_DIR}"
echo "[MANIFEST] ${WEB_EXPORT_DIR}/export-manifest.json"
