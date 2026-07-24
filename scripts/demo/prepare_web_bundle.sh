#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_DIR="${PROJECT_ROOT}/exports/malacca-web-demo-${STAMP}"

cd "${PROJECT_ROOT}"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[ERROR] pnpm was not found. Cannot build Web bundle."
  exit 1
fi

pnpm build

mkdir -p "${OUTPUT_DIR}"
cp -R "${PROJECT_ROOT}/dist" "${OUTPUT_DIR}/web-dist"
cp "${PROJECT_ROOT}/README.md" "${OUTPUT_DIR}/README.md"
cp "${PROJECT_ROOT}/docs/DEMO_GUIDE.md" "${OUTPUT_DIR}/DEMO_GUIDE.md"

cat > "${OUTPUT_DIR}/DEMO_MANIFEST.txt" <<MANIFEST
Malacca Strait digital twin sandbox demo bundle
Created: ${STAMP}

Web static build:
  ${OUTPUT_DIR}/web-dist

Run locally from source:
  cd "${PROJECT_ROOT}"
  pnpm demo:web

Godot subsystem is optional and not bundled.
Set GODOT_PROJECT and GODOT_BIN before running the bridge commands.

Open Godot project edition:
  cd "${PROJECT_ROOT}"
  pnpm demo:godot

Future desktop package path:
  Wrap web-dist with a desktop shell, then connect to the retained Godot project or a later Godot export.
MANIFEST

echo "[DONE] Web demo bundle prepared:"
echo "${OUTPUT_DIR}"
