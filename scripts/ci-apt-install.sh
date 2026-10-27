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
#    Raising it to 480 s held for 26 days and then lost twice on the same day: run
#    40519420161 (PR #1203, 2026-10-27) died at 8m 5s of step time, and run
#    40504875958 did the same to the merge commit `243eca8` on `main` at 8m 16s — both
#    `Error: Process completed with exit code 124`, i.e. the 480 s install budget
#    burned out with not one test executed. A healthy run of this same step takes 12 s
#    (measured on main at ec7620c9, run 40524985497) — the packages are already in the
#    runner image, so nearly all of the 900 s budget is spent only on a degraded day,
#    which is why the extra room costs nothing on the normal path.
#    The budget therefore has to be sized for throughput, not for a hang, and the
#    workflow step cap has to outlive the sum of every budget in this file
#    (lock wait + update + install), or the step preempts the retry it exists for.
#    A stalled socket still gives up per-connection and retries (`Acquire::Retries`)
#    instead of eating the whole cap.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# Budget chain. `wait_for_apt_lock` consumes at most APT_LOCK_WAIT_SECONDS, so the
# worst case this script can take is APT_LOCK_WAIT_SECONDS + APT_UPDATE_TIMEOUT_SECONDS
# + APT_INSTALL_TIMEOUT_SECONDS = 60 + 120 + 900 = 1080s (18 min), which the apt step
# in .github/workflows/ci.yml caps at 20 min and the job at 60 min.
# scripts/ci-workflow-timeouts.test.mjs asserts that chain, because the three numbers
# live in two files and only the arithmetic keeps them honest.
APT_LOCK_WAIT_SECONDS="${CI_APT_LOCK_WAIT_SECONDS:-60}"
APT_UPDATE_TIMEOUT_SECONDS="${CI_APT_UPDATE_TIMEOUT_SECONDS:-120}"
APT_INSTALL_TIMEOUT_SECONDS="${CI_APT_INSTALL_TIMEOUT_SECONDS:-900}"
# Acquire::Languages=none drops the Translation-* index files. Run 40519420161's own
# log shows them fetched mid-incident (`noble-updates/main Translation-en [310 kB]`,
# `noble-updates/universe Translation-en [343 kB]`, …) on the slow path that this
# script is meant to survive; they are the one part of the index that CI output never
# reads, so paying for them buys nothing.
APT_RESILIENCE=(
  -o Acquire::Retries=5
  -o Acquire::http::Timeout=30
  -o Acquire::Languages=none
)

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <apt-package>..." >&2
  exit 2
fi

echo "ci-apt-install: budgets lock ${APT_LOCK_WAIT_SECONDS}s / update ${APT_UPDATE_TIMEOUT_SECONDS}s / install ${APT_INSTALL_TIMEOUT_SECONDS}s"

wait_for_apt_lock() {
  local waits
  waits="$(( APT_LOCK_WAIT_SECONDS / 3 ))"
  local i
  for i in $(seq 1 "$waits"); do
    if ! fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 \
      && ! fuser /var/lib/apt/lists/lock >/dev/null 2>&1; then
      return 0
    fi
    echo "apt lock held; waiting ${i}/${waits}"
    sleep 3
  done
  echo "apt lock still held after ${APT_LOCK_WAIT_SECONDS}s; attempting apt-get anyway" >&2
}

# `timeout` reports 124 (and 137 when it escalates to SIGKILL) when it fires. apt's own
# failure code is 100. Naming which clock ended the run is the whole diagnosis, so the
# message carries the elapsed budget and the env var that moves it, and re-exits with
# the code it found rather than flattening every failure to 1. Every apt-get in this
# file goes through it — the single choke point is what scripts/ci-workflow-timeouts.test.mjs
# asserts, so an apt-get cannot be added here unbounded.
run_bounded() {
  local label="$1" budget="$2"
  shift 2
  local rc=0
  timeout "$budget" "$@" || rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
      echo "ci-apt-install: '${label}' was killed after its full ${budget}s budget (exit $rc)." >&2
      echo "ci-apt-install: that is the slow-mirror guard firing, not a package error — no test ran." >&2
      echo "ci-apt-install: raise it with CI_APT_${label}_TIMEOUT_SECONDS, and keep the workflow apt step cap above lock+update+install (see .github/workflows/ci.yml + scripts/ci-workflow-timeouts.test.mjs)." >&2
    else
      echo "ci-apt-install: '${label}' failed with exit $rc (apt's own failure code, not a timeout)." >&2
    fi
    exit "$rc"
  fi
}

wait_for_apt_lock
run_bounded UPDATE "$APT_UPDATE_TIMEOUT_SECONDS" apt-get update "${APT_RESILIENCE[@]}"
run_bounded INSTALL "$APT_INSTALL_TIMEOUT_SECONDS" \
  apt-get install -y --no-install-recommends "${APT_RESILIENCE[@]}" "$@"
