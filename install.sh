#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/w243420707/hostpanel-single-host.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
WORKDIR="${WORKDIR:-/tmp/hostpanel-single-host}"

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "[ERROR] Please run this installer as root." >&2
    exit 1
  fi
}

install_git_if_missing() {
  if command -v git >/dev/null 2>&1; then
    return 0
  fi

  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y git
    return 0
  fi

  if command -v dnf >/dev/null 2>&1; then
    dnf install -y git
    return 0
  fi

  if command -v yum >/dev/null 2>&1; then
    yum install -y git
    return 0
  fi

  echo "[ERROR] Cannot install git automatically on this OS. Please install git first." >&2
  exit 1
}

main() {
  require_root
  install_git_if_missing

  rm -rf "${WORKDIR}"
  git clone --depth 1 --branch "${REPO_BRANCH}" "${REPO_URL}" "${WORKDIR}"

  cd "${WORKDIR}"
  chmod +x ./install-hostpanel.sh ./preload-default-images.sh
  ./install-hostpanel.sh
}

main "$@"
