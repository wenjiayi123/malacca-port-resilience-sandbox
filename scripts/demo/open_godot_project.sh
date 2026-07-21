#!/usr/bin/env bash
set -euo pipefail

GODOT_PROJECT="${GODOT_PROJECT:-}"
GODOT_BIN="${GODOT_BIN:-$(command -v godot4 || command -v godot || true)}"

if [[ -z "${GODOT_PROJECT}" ]]; then
  echo "[ERROR] Set GODOT_PROJECT to a compatible Godot project directory"
  exit 1
fi

if [[ ! -d "${GODOT_PROJECT}" || ! -f "${GODOT_PROJECT}/project.godot" ]]; then
  echo "[ERROR] Godot project was not found at ${GODOT_PROJECT}"
  exit 1
fi

if [[ -z "${GODOT_BIN}" || ! -x "${GODOT_BIN}" ]]; then
  echo "[ERROR] Godot executable was not found at ${GODOT_BIN}"
  exit 1
fi

echo "[OPEN] Godot project edition: ${GODOT_PROJECT}"
exec "${GODOT_BIN}" --editor --path "${GODOT_PROJECT}"
