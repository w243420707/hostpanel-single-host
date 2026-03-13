#!/usr/bin/env bash
set -euo pipefail

PANEL_PROJECT="${PANEL_PROJECT:-HostPanel}"
INSTALL_DIR="/opt/hostpanel"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_OS_ID=""
HOST_OS_VERSION=""
HOST_OS_FAMILY=""
HOST_ARCH=""
WEB_PORT="${WEB_PORT:-2026}"

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "[ERROR] Please run installer as root." >&2
    exit 1
  fi
}

detect_host_platform() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "[ERROR] Only Linux hosts are supported." >&2
    exit 1
  fi

  if [[ ! -f /etc/os-release ]]; then
    echo "[ERROR] Cannot detect OS: /etc/os-release is missing." >&2
    exit 1
  fi

  # shellcheck disable=SC1091
  source /etc/os-release
  HOST_OS_ID="${ID:-unknown}"
  HOST_OS_VERSION="${VERSION_ID:-unknown}"

  case "${HOST_OS_ID}" in
    debian|ubuntu)
      HOST_OS_FAMILY="debian"
      ;;
    rhel|centos|rocky|almalinux|fedora)
      HOST_OS_FAMILY="rhel"
      ;;
    *)
      HOST_OS_FAMILY="unknown"
      ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64)
      HOST_ARCH="amd64"
      ;;
    aarch64|arm64)
      HOST_ARCH="arm64"
      ;;
    *)
      HOST_ARCH="unsupported"
      ;;
  esac

  if [[ "${HOST_ARCH}" == "unsupported" ]]; then
    echo "[ERROR] Unsupported CPU architecture: $(uname -m). Only amd64/arm64 are supported." >&2
    exit 1
  fi

  echo "[INFO] Detected host OS: ${HOST_OS_ID} ${HOST_OS_VERSION} (${HOST_OS_FAMILY}), arch: ${HOST_ARCH}"
}

setup_incus_repo_debian() {
  local codename="${VERSION_CODENAME:-}"

  if [[ -z "${codename}" && -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
    codename="${VERSION_CODENAME:-}"
  fi

  if [[ -z "${codename}" ]]; then
    echo "[ERROR] Cannot detect distro codename for Incus repository setup." >&2
    exit 1
  fi

  echo "[INFO] Configuring Incus repository for ${codename}"
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://pkgs.zabbly.com/key.asc -o /etc/apt/keyrings/zabbly-incus.asc

  cat >/etc/apt/sources.list.d/zabbly-incus-stable.sources <<EOF
Enabled: yes
Types: deb
URIs: https://pkgs.zabbly.com/incus/stable
Suites: ${codename}
Components: main
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/zabbly-incus.asc
EOF
}

install_incus_if_missing() {
  if command -v incus >/dev/null 2>&1; then
    echo "[INFO] Incus already installed"
    return 0
  fi

  echo "[INFO] Installing Incus"
  case "${HOST_OS_FAMILY}" in
    debian)
      apt-get update
      setup_incus_repo_debian
      apt-get update
      apt-get install -y incus
      ;;
    rhel)
      echo "[ERROR] RHEL-like host detected. Auto-install is not wired yet; please install Incus manually, then rerun this script." >&2
      exit 1
      ;;
    *)
      echo "[ERROR] Unsupported Linux distribution: ${HOST_OS_ID}." >&2
      exit 1
      ;;
  esac
}

install_base_deps() {
  case "${HOST_OS_FAMILY}" in
    debian)
      apt-get update
      apt-get install -y curl ca-certificates rsync
      ;;
    rhel)
      dnf install -y curl ca-certificates rsync
      ;;
    *)
      echo "[ERROR] Unsupported Linux distribution: ${HOST_OS_ID}." >&2
      exit 1
      ;;
  esac
}

install_node_if_missing() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    echo "[INFO] Node.js already installed"
    return 0
  fi

  echo "[INFO] Installing Node.js 20"
  case "${HOST_OS_FAMILY}" in
    debian)
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y nodejs
      ;;
    rhel)
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
      dnf install -y nodejs
      ;;
  esac
}

prompt_web_port() {
  local input=""

  if [[ -t 0 ]]; then
    read -r -p "[INPUT] Web port (default: 2026): " input
  fi

  if [[ -n "${input}" ]]; then
    WEB_PORT="${input}"
  fi

  if ! [[ "${WEB_PORT}" =~ ^[0-9]+$ ]]; then
    echo "[ERROR] Web port must be a number." >&2
    exit 1
  fi

  if (( WEB_PORT < 1 || WEB_PORT > 65535 )); then
    echo "[ERROR] Web port must be between 1 and 65535." >&2
    exit 1
  fi

  echo "[INFO] Using web port: ${WEB_PORT}"
}

copy_project() {
  echo "[INFO] Syncing project into ${INSTALL_DIR}"
  mkdir -p "${INSTALL_DIR}"
  rsync -a --delete "${SCRIPT_DIR}/" "${INSTALL_DIR}/"
}

prepare_env() {
  if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
    cp "${INSTALL_DIR}/.env.example" "${INSTALL_DIR}/.env"
  fi
  sed -i "s#^PANEL_PROJECT=.*#PANEL_PROJECT=${PANEL_PROJECT}#" "${INSTALL_DIR}/.env"
  sed -i "s#^WEB_PORT=.*#WEB_PORT=${WEB_PORT}#" "${INSTALL_DIR}/.env"
  mkdir -p "${INSTALL_DIR}/data"
}

install_node_modules() {
  echo "[INFO] Installing npm dependencies"
  cd "${INSTALL_DIR}/api"
  npm install --omit=dev
  cd "${INSTALL_DIR}/worker"
  npm install --omit=dev
  cd "${INSTALL_DIR}/web"
  npm install --omit=dev
}

install_systemd_units() {
  echo "[INFO] Installing systemd units"
  cp "${INSTALL_DIR}/deploy/systemd/hostpanel-api.service" /etc/systemd/system/
  cp "${INSTALL_DIR}/deploy/systemd/hostpanel-worker.service" /etc/systemd/system/
  cp "${INSTALL_DIR}/deploy/systemd/hostpanel-web.service" /etc/systemd/system/

  systemctl daemon-reload
  systemctl enable hostpanel-api hostpanel-worker hostpanel-web
}

start_services() {
  systemctl restart hostpanel-api
  systemctl restart hostpanel-worker
  systemctl restart hostpanel-web
}

main() {
  require_root
  detect_host_platform
  install_base_deps
  install_node_if_missing
  install_incus_if_missing
  prompt_web_port
  copy_project
  prepare_env

  # Ensure default images are pulled during installation.
  PANEL_PROJECT="$PANEL_PROJECT" "${INSTALL_DIR}/preload-default-images.sh"

  install_node_modules
  install_systemd_units
  start_services

  echo "[INFO] Installation complete"
  echo "[INFO] Web: http://<host-ip>:${WEB_PORT}"
  echo "[INFO] API: http://<host-ip>:9000/health"
}

main "$@"
