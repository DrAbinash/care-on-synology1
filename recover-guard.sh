#!/bin/sh
# =============================================================================
# CARE ERP — unattended guard for the post-daemon-restart recovery (Synology)
# Dr. Abinash Kumar, Care Diagnostics, Deoghar
# =============================================================================
# WHAT THIS IS
#   recover-after-daemon-restart.sh repairs the ERP after dockerd restarts, but
#   someone has to run it. Measured 2026-11-12: the daemon took 34 m 49 s to come
#   back (21:26:59 -> 22:01:48) and the repair itself took 2 m 02 s (FIX_RC=0 at
#   22:03:50). Every one of the five incidents happened after clinic close —
#   21:03, 21:37, 02:21, 00:04, 01:42 — so a guard that fires every few minutes
#   finishes long before the first staff member arrives at 08:30, and the desk
#   never sees the outage at all.
#
#   This wrapper is deliberately NOT the recovery logic. That script is audited,
#   mutation-proven and merged (PR #1342); it already refuses to restart anything
#   unless it can PROVE the defect (ERP not answering AND a service name that does
#   not resolve), so calling it blindly every 5 minutes is a no-op on a healthy
#   clinic — it exits 0 after one curl to /api/healthz.
#
# WHY IT DISARMS ITSELF
#   The one thing an unattended mutator must not do is retry a failed mutation
#   forever. If the recovery runs and then fails — the restart itself fails (5),
#   a service never becomes useful (6), care-db changed identity or volume (7),
#   or the ERP never answers (8) — then the clinic has a problem that restarting
#   containers does not solve, quite possibly a damaged database. Retrying that
#   every 5 minutes would bounce the database all night. So codes 5-8 stop the
#   guard until a human acknowledges it.
#
#   Codes that do NOT disarm, because no mutation happened and none is due:
#     0 healthy (or recovered)      3 a deploy holds the lock
#     4 a different outage          9 the daemon is still loading / probe cannot run
#    10 only --check ever returns this
#
#   9 matters most: during the 35-minute reload the docker socket does not answer,
#   `docker exec` fails, the script reports UNKNOWN and exits 9 without touching
#   anything. That is the guard spending 35 minutes doing nothing on purpose, then
#   repairing the aliases on the first tick after the daemon wakes up.
#
# WHY A RECURRING rc=3 IS LOUD
#   rc=3 is correct behaviour — never fight a running deploy. But the lock lives in
#   /tmp and its holder can die (found live 2026-11-12 22:19: a session took the
#   lock at 22:18:55, its pid was gone a minute later, and the log stopped growing).
#   A stale lock would then block recovery forever in complete silence, which is
#   worse than no guard at all. So the guard counts consecutive rc=3 and, past two
#   ticks of that (30 min — longer than any real deploy's build+recreate), prints
#   the exact command to clear it. It never clears a lock it does not own, because
#   guessing wrong would let two mutators run at once.
#
# USAGE (as root, in DSM Task Scheduler — every 5 minutes)
#   /volume1/docker/care-erp-github/recover-guard.sh
#
#   That crontab path must be a SYMLINK into this checkout, not a copy of it, and
#   it has been on this box since 2026-11-13 00:13 IST. Same rule deploy.sh follows
#   (docs/CARE_ERP_DEPLOYMENT_RUNBOOK.md, "One-time conversion"), same reason: the
#   copy is a second, untracked copy of the recovery logic that nothing in a deploy
#   refreshes. Measured immediately before the conversion, the copy and this file
#   were byte-identical (md5 0b0f241cc53ed617955b21c2ce8a2b6f) — which is exactly
#   the state in which the next change to this script on main would silently never
#   reach cron, and the guard would go on reporting the exit codes of a version
#   nobody is reading. A symlink cannot drift.
#
#     cd /volume1/docker/care-erp-github
#     ln -sfn care-on-synology1/recover-guard.sh recover-guard.sh
#     ls -l recover-guard.sh                     # ends  -> care-on-synology1/recover-guard.sh
#     ls -l care-on-synology1/recover-guard.sh   # must be executable, or cron cannot run it
#
#   Keep the copy you replaced somewhere OUTSIDE the repository directory (the box
#   has it at /tmp/recover-guard.sh.copy-1345), so it cannot become a third script
#   or show up as a dirty checkout.
#
#   Re-arm after a disarmed failure, once you have looked:
#     touch /volume1/docker/care-deploy-logs/recover-guard-ack
#   Force one immediate attempt by hand (this is the same call the guard makes):
#     /volume1/docker/care-erp-github/recover-after-daemon-restart.sh --fix
#
#   SCRIPT below defaults to that sibling path, and it carries the same copy-vs-
#   checkout question — convert it the same way rather than hand-maintaining a
#   detached file:
#     ln -sfn care-on-synology1/recover-after-daemon-restart.sh recover-after-daemon-restart.sh
# =============================================================================

set -u

GUARD_DIR="${GUARD_DIR:-/volume1/docker/care-deploy-logs}"
SCRIPT="${SCRIPT:-/volume1/docker/care-erp-github/recover-after-daemon-restart.sh}"
STATE="${GUARD_DIR}/recover-guard-state"
ACK="${GUARD_DIR}/recover-guard-ack"
# 6 ticks at the 5-minute interval = 30 min, longer than any real deploy takes.
LOCK_STUCK_AFTER="${LOCK_STUCK_AFTER:-6}"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

mkdir -p "$GUARD_DIR" 2>/dev/null || {
  log "REFUSED — cannot create $GUARD_DIR"
  exit 1
}

if [ ! -x "$SCRIPT" ]; then
  log "ERROR — $SCRIPT is missing or not executable; nothing to guard. Re-arm the task only after it is installed."
  exit 1
fi

last_rc=""
last_streak=0
if [ -f "$STATE" ]; then
  set -- $(cut -d' ' -f1-3 "$STATE" 2>/dev/null)
  last_rc="${1:-}"
  case "${3:-}" in ''|*[!0-9]*) last_streak=0 ;; *) last_streak="$3" ;; esac
fi

# A previous recovery that ran and FAILED stays failed until someone says so.
case "$last_rc" in
  5|6|7|8)
    if [ ! -e "$ACK" ]; then
      log "DISARMED — the last --fix exited $last_rc, so restarting containers is not the answer here. Skipped. Inspect, then: touch $ACK"
      exit 0
    fi
    log "acknowledged ($ACK exists) — attempting recovery again"
    ;;
esac

log "running $SCRIPT --fix"
"$SCRIPT" --fix
rc=$?

# rc=3 mutates nothing, so it is safe to repeat — but repeating it forever is how a
# stale lock silently disables this guard. Count the consecutive ones.
streak=0
[ "$rc" = "3" ] && streak=$((last_streak + 1))
printf '%s %s %s\n' "$rc" "$(date +%s)" "$streak" > "$STATE"

case "$rc" in
  0) log "rc=0 — healthy, or recovered" ;;
  3)
    log "rc=3 — a deploy holds the lock; nothing done (consecutive blocked ticks: $streak)"
    if [ "$streak" -ge "$LOCK_STUCK_AFTER" ]; then
      log "LOCK-STUCK — $streak ticks in a row blocked, which is longer than any real deploy takes. Either a deploy is genuinely running or the lock is stale, and if it is stale this guard can no longer help the clinic. Its holder's pid is in /tmp/care-deploy.lock/pid; only if that pid is dead: rm -f /tmp/care-deploy.lock/pid && rmdir /tmp/care-deploy.lock"
    fi
    ;;
  4) log "rc=4 — the ERP is down for a DIFFERENT reason; this guard does not act on it" ;;
  9) log "rc=9 — daemon still loading or the probe could not run; no action taken" ;;
  10) log "rc=10 — unexpected in fix mode" ;;
  5|6|7|8) log "rc=$rc — recovery ran and FAILED. Guard is DISARMED until $ACK exists." ;;
  *) log "rc=$rc — see the recovery log in $GUARD_DIR" ;;
esac

exit 0
