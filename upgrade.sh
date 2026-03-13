#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/hostpanel}"
TARGET_REF="${TARGET_REF:-main}"
AUTO_STASH="${AUTO_STASH:-1}"

STASH_NAME=""
STASHED="0"

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "[ERROR] Please run this script as root." >&2
    exit 1
  fi
}

ensure_install_dir() {
  if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
    echo "[ERROR] ${INSTALL_DIR} is not a git repository."
    echo "[INFO] If this host was not installed with this project, run install.sh first."
    exit 1
  fi
}

pull_latest() {
  cd "${INSTALL_DIR}"

  if [[ "${AUTO_STASH}" == "1" ]]; then
    if ! git diff --quiet || ! git diff --cached --quiet; then
      STASH_NAME="hostpanel-upgrade-$(date +%s)"
      echo "[INFO] Local changes detected. Stashing as ${STASH_NAME}"
      git stash push -u -m "${STASH_NAME}" >/dev/null
      STASHED="1"
    fi
  fi

  git fetch --all --prune
  git checkout "${TARGET_REF}"
  git pull --ff-only origin "${TARGET_REF}"
}

restore_stash_if_needed() {
  if [[ "${STASHED}" != "1" ]]; then
    return 0
  fi

  cd "${INSTALL_DIR}"
  if git stash list | grep -q "${STASH_NAME}"; then
    echo "[INFO] Restoring local changes from ${STASH_NAME}"
    if ! git stash pop >/dev/null; then
      echo "[WARN] Auto-restore produced conflicts. Resolve manually with:"
      echo "[WARN]   cd ${INSTALL_DIR} && git stash list && git stash show -p"
      exit 1
    fi
  fi
}

install_deps() {
  cd "${INSTALL_DIR}/api"
  npm install --omit=dev
  cd "${INSTALL_DIR}/worker"
  npm install --omit=dev
  cd "${INSTALL_DIR}/web"
  npm install --omit=dev
}

ensure_env_file() {
  if [[ -f "${INSTALL_DIR}/.env" ]]; then
    return 0
  fi

  if [[ -f "${INSTALL_DIR}/.env.example" ]]; then
    echo "[INFO] .env missing, creating from .env.example"
    cp "${INSTALL_DIR}/.env.example" "${INSTALL_DIR}/.env"
    return 0
  fi

  echo "[ERROR] Missing both ${INSTALL_DIR}/.env and ${INSTALL_DIR}/.env.example" >&2
  exit 1
}

reload_services() {
  systemctl daemon-reload
  systemctl restart hostpanel-api hostpanel-worker hostpanel-web
}

main() {
  require_root
  ensure_install_dir
  pull_latest
  install_deps
  ensure_env_file
  reload_services
  restore_stash_if_needed
  echo "[INFO] Upgrade completed successfully."
}

main "$@"
