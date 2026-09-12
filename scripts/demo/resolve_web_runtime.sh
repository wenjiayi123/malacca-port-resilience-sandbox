#!/usr/bin/env bash
# Shared by the desktop launcher and the environment check. Finder does not
# load interactive shell profiles, so discover an existing runtime explicitly.

resolve_web_runtime() {
  local candidate version
  local bundled_root="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies"
  local candidates=(
    "$(command -v node || true)"
    /opt/homebrew/bin/node
    /usr/local/bin/node
    /opt/homebrew/opt/node@24/bin/node
    /usr/local/opt/node@24/bin/node
    "${bundled_root}/node/bin/node"
  )
  if [[ -n "${MALACCA_NODE_BIN:-}" ]]; then
    candidates=("${MALACCA_NODE_BIN}")
  fi

  MALACCA_NODE_BIN=""
  for candidate in "${candidates[@]}"; do
    [[ -x "${candidate}" ]] || continue
    version="$("${candidate}" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null)" || continue
    if [[ "${version}" =~ ^[0-9]+$ ]] && (( version >= 24 )); then
      MALACCA_NODE_BIN="${candidate}"
      export PATH="$(dirname "${candidate}"):${PATH}"
      break
    fi
  done
  if [[ -z "${MALACCA_NODE_BIN}" ]]; then
    echo "[ERROR] Node.js 24+ was not found. Install it or set MALACCA_NODE_BIN to a compatible executable." >&2
    return 1
  fi

  if command -v pnpm >/dev/null 2>&1; then
    PNPM_CMD=(pnpm)
  elif [[ -x "${bundled_root}/bin/fallback/pnpm" ]]; then
    PNPM_CMD=("${bundled_root}/bin/fallback/pnpm")
  elif command -v corepack >/dev/null 2>&1; then
    PNPM_CMD=(corepack pnpm)
  elif command -v npx >/dev/null 2>&1; then
    PNPM_CMD=(npx --yes pnpm@11.9.0)
  else
    echo "[ERROR] pnpm, Corepack and npx are unavailable." >&2
    return 1
  fi
}
