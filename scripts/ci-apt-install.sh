#!/usr/bin/env bash
# Install apt packages on GitHub-hosted runners without hanging for hours.
#
# Two distinct runner pathologies are bounded here:
#
# 1. Lock starvation. Fresh ubuntu-latest VMs often hold /var/lib/dpkg/
#    lock-frontend via unattended-upgrades, so a bare `apt-get install` sits
#    until the 6-hour job timeout (PR #548, and `playwright install --with-deps`).
#    `wait_for_apt_lock` handles that.
# 2. Mirror throughput. `apt-get update` pulls its 12.6 MB of index at ~8 MB/s,
#    but the 33.4 MB of packages can arrive at ~130 kB/s from the same Azure
#    mirror. A 240 s install cap therefore killed the step mid-download at
#    `mesa-libgallium` on three separate PRs on 2026-10-01 (exit 124, ~286 s
#    into the job, before any test ran) while a fourth retry passed in ~417 s.
#    The install budget is sized for the slow case; a stalled socket gives up
#    per-connection and retries instead of eating the whole cap.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

APT_UPDATE_TIMEOUT_SECONDS="${CI_APT_UPDATE_TIMEOUT_SECONDS:-120}"
APT_INSTALL_TIMEOUT_SECONDS="${CI_APT_INSTALL_TIMEOUT_SECONDS:-480}"
APT_RESILIENCE=(-o Acquire::Retries=5 -o Acquire::http::Timeout=30)

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
timeout "$APT_UPDATE_TIMEOUT_SECONDS" apt-get update "${APT_RESILIENCE[@]}"
timeout "$APT_INSTALL_TIMEOUT_SECONDS" apt-get install -y --no-install-recommends "${APT_RESILIENCE[@]}" "$@"
