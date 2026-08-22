#!/usr/bin/env bash
# Install apt packages on GitHub-hosted runners without hanging for hours.
#
# Fresh ubuntu-latest VMs often hold /var/lib/dpkg/lock-frontend via
# unattended-upgrades. A bare `apt-get update && apt-get install` then sits
# until the 6-hour job timeout (seen on PR #548 poppler-utils and on
# playwright install --with-deps). This script waits briefly for the lock,
# then hard-caps each apt invocation with `timeout`.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <apt-package>..." >&2
  exit 2
fi

wait_for_apt_lock() {
  local i
  for i in $(seq 1 20); do
    if ! fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 \
      && ! fuser /var/lib/apt/lists/lock >/dev/null 2>&1; then
      return 0
    fi
    echo "apt lock held; waiting ${i}/20"
    sleep 3
  done
  echo "apt lock still held after 60s; attempting apt-get anyway" >&2
}

wait_for_apt_lock
timeout 240 apt-get update -o Acquire::Retries=3
timeout 240 apt-get install -y --no-install-recommends "$@"
