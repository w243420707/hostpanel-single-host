#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/hostpanel}"
TARGET_REF="${TARGET_REF:-main}"

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
  git fetch --all --prune
  git checkout "${TARGET_REF}"
  git pull --ff-only origin "${TARGET_REF}"
}

install_deps() {
  cd "${INSTALL_DIR}/api"
  npm install --omit=dev
  cd "${INSTALL_DIR}/worker"
  npm install --omit=dev
  cd "${INSTALL_DIR}/web"
  npm install --omit=dev
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
  reload_services
  echo "[INFO] Upgrade completed successfully."
}

main "$@"
