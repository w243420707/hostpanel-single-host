#!/usr/bin/env bash
set -euo pipefail

# Preload default images during installation so first-time instance creation is immediate.
PANEL_PROJECT="${PANEL_PROJECT:-HostPanel}"

ensure_incus_ready() {
  if ! command -v incus >/dev/null 2>&1; then
    echo "[ERROR] incus command not found. Install Incus first." >&2
    exit 1
  fi

  # Wait briefly for incusd to become ready on fresh installs.
  local retries=20
  while (( retries > 0 )); do
    if incus info >/dev/null 2>&1; then
      return 0
    fi
    retries=$((retries - 1))
    sleep 1
  done

  echo "[ERROR] incusd is not ready." >&2
  exit 1
}

ensure_project() {
  if ! incus project show "$PANEL_PROJECT" >/dev/null 2>&1; then
    echo "[INFO] Creating Incus project: $PANEL_PROJECT"
    incus project create "$PANEL_PROJECT"
  fi
}

image_exists() {
  local alias="$1"
  incus --project "$PANEL_PROJECT" image show "$alias" >/dev/null 2>&1
}

pull_image_if_missing() {
  local remote_image="$1"
  local local_alias="$2"

  if image_exists "$local_alias"; then
    echo "[INFO] Image already present: $local_alias"
    return 0
  fi

  echo "[INFO] Pulling image $remote_image as alias $local_alias"
  incus --project "$PANEL_PROJECT" image copy "images:${remote_image}" local: --alias "$local_alias"
}

main() {
  echo "[INFO] Preloading default images for project $PANEL_PROJECT"
  ensure_incus_ready
  ensure_project

  pull_image_if_missing "alpine/3.20" "alpine/3.20"
  pull_image_if_missing "debian/12" "debian12"

  echo "[INFO] Default images are ready: alpine/3.20, debian12"
}

main "$@"
