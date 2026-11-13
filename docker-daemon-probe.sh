#!/bin/sh
# =============================================================================
# CARE ERP — read-only Docker daemon probe (Synology)
# Dr. Abinash Kumar, Care Diagnostics, Deoghar
# =============================================================================
# WHAT THIS IS
#   One sample of the Docker daemon's health, taken every few minutes, written to
#   a small file the ERP reads. The "Docker Daemon" light on My Daily Summary is
#   the standing answer to a question that so far could only be asked by hand,
#   after the damage: *did the daemon do something bad overnight?*  It can be read
#   at 08:30, because the probe already wrote down when dockerd last started, how
#   long it refused to answer, whether live-restore was on, and what that cost.
#
# WHY IT IS A SEPARATE SCRIPT FROM recover-guard.sh
#   The guard mutates (it restarts containers); this script only reads. Keeping
#   them apart is not tidiness, it is the light's reliability: the guard EXITS
#   BEFORE RUNNING ITS CHILD whenever the last recovery failed (rc 5-8 with no
#   $ACK file — recover-guard.sh:113-121). Piggybacking the daemon sample on that
#   tick would make the daemon light go stale at exactly the moment a recovery has
#   gone wrong, which is a blind spot designed into the one situation that needs
#   eyes. It would also tie a read-only observation to a lock that a deploy holds
#   for 20+ minutes.
#
# WHY THE API READS A FILE INSTEAD OF ASKING THE DAEMON ITSELF
#   The same reason ops.recovery_guard does: the file is written by the host even
#   when care-api is the broken thing, so an outage cannot silence the light that
#   reports it. It also means the ERP never needs /var/run/docker.sock, which is
#   root over the whole box. care-api reaches the file through the read-only bind
#   mount docker-compose.yml already has for the guard (DEPLOY_LOGS_HOST_DIR), so
#   this ships with no compose change and no new secret.
#
# WHAT IT USES, MEASURED ON THE CLINIC'S BOX 2026-11-13 AS abinash (NO ROOT):
#   curl --unix-socket /var/run/docker.sock http://localhost/_ping   → 200 "OK"
#   curl ... http://localhost/info        → "LiveRestoreEnabled":true, "ServerVersion":"24.0.2"
#   curl ... http://localhost/containers/<name>/json → "Status":"running", StartedAt
#   stat -c %Y /var/run/docker.pid → 1794499019 = 2026-11-12T15:56:59Z = 21:26:59 IST,
#     which is the approved live-restore rehearsal restart. The pid file's mtime
#     dates a daemon start to the second WITHOUT needing the daemon or systemd,
#     which matters because DSM's systemctl has no --value and a wedged client is
#     not a dead daemon.
#   /proc/uptime, date -u -d @<epoch>, GNU curl 7.86 with --unix-socket, awk, stat.
#   `docker` is NOT on this account's PATH (it lives in /usr/local/bin, which a
#   non-login cron PATH does not carry), so this script never calls it.
#   /var/packages/ContainerManager/etc/dockerd.json is root 0600, so live-restore
#   comes from the daemon's own /info instead of that file: it reports what is
#   ACTUALLY running, and it needs no root. Its one limit is worth saying — a
#   Container Manager package upgrade that rewrites dockerd.json only shows up
#   here once the daemon has restarted with the new file, and this script
#   detects that restart as its own event.
#
# WHAT IT DOES NOT DO
#   Nothing. No restart, no write outside $GUARD_DIR, no lock, no database, no
#   credentials. Safe as often as you like, and safe to leave running through a
#   deploy.
#
# THE STATE IT KEEPS (why each field exists)
#   ping            ok | down | unknown. "down" is only ever a PROVED refusal to
#                   answer: curl could not connect, or timed out. Everything that
#                   merely stops this script from knowing — no curl, an option it
#                   does not support, an unreadable pid file — is "unknown", which
#                   the light reports as amber "cannot tell", never as an outage
#                   and never as health.
#   daemon_start    the current daemon's start instant, from the pid file. A
#                   CHANGE between two ticks is a dockerd restart, including one
#                   that happened while nobody was watching.
#   host_boot       kernel boot instant (now minus /proc/uptime), which separates
#                   a NAS reboot from a daemon-only restart. The 2026-11-10
#                   incident was a machine boot and behaved very differently from
#                   the 2026-11-12 daemon restart.
#   down_since      start of the window during which the daemon has not answered;
#                   0 when it does. Turns an outage into a measured duration.
#   ev_*            the newest incident, CARRIED FORWARD on every later tick, so a
#                   restart at 01:42 is still on the daily page at 08:30. Without
#                   carry-forward the light would forget an event five minutes
#                   after it happened, which is the one thing this page must not
#                   do. $EVENTS records the transitions for a human; the open
#                   state of a running window is $STATE, which is what the light
#                   reads.
#   stamps          per-container StartedAt fingerprints, kept from the last tick
#                   that could read them (carried through dark ticks, so the
#                   comparison after a restart has something to compare to).
#                   ev_stamps counts how many changed across an incident, which
#                   means an ERP container restarted during it — and this probe
#                   CANNOT tell a daemon kill from the recovery script's own
#                   restart or a deploy's recreate, so the light reports that the
#                   stamps changed and never names a cause it did not witness.
#
#   Honest limit: a daemon stall that begins and ends inside one 5-minute tick is
#   not observable by a 5-minute poll. Nothing here pretends to catch that.
#
# USAGE (DSM Task Scheduler, or /etc/crontab — every 5 minutes, as abinash)
#   */5 * * * * abinash /volume1/docker/care-erp-github/docker-daemon-probe.sh >> /volume1/docker/care-deploy-logs/docker-daemon-probe.log 2>&1
#
#   That path is a SYMLINK into the checkout, not a copy — the rule deploy.sh and
#   recover-guard.sh follow, so a change on main cannot silently fail to reach
#   the box:
#     cd /volume1/docker/care-erp-github
#     ln -sfn care-on-synology1/docker-daemon-probe.sh docker-daemon-probe.sh
#     sh docker-daemon-probe.sh && cat /volume1/docker/care-deploy-logs/docker-daemon-state
#     tail -3 /volume1/docker/care-deploy-logs/docker-daemon-events
#
#   For a developer box: GUARD_DIR=/tmp/care-probe sh docker-daemon-probe.sh
# =============================================================================

set -u

GUARD_DIR="${GUARD_DIR:-/volume1/docker/care-deploy-logs}"
STATE="${STATE:-${GUARD_DIR}/docker-daemon-state}"
EVENTS="${EVENTS:-${GUARD_DIR}/docker-daemon-events}"
SOCK="${DOCKER_SOCK:-/var/run/docker.sock}"
PID_FILE="${DOCKER_PID_FILE:-/var/run/docker.pid}"
UPTIME_FILE="${UPTIME_FILE:-/proc/uptime}"
CONTAINERS="${PROBE_CONTAINERS:-care-db care-redis care-api care-web}"
CURL_TIMEOUT="${PROBE_CURL_TIMEOUT:-8}"
INFO_TIMEOUT="${PROBE_INFO_TIMEOUT:-15}"
EVENTS_KEEP="${EVENTS_KEEP:-200}"
# A daemon that started at, or just after, the kernel's own start is a reboot.
BOOT_WINDOW_S="${BOOT_WINDOW_S:-120}"
TMPD="${TMPDIR:-/tmp}"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# One key out of the previous sample; "" when absent or unreadable.
prev_val() {
  [ -f "$STATE" ] || return 0
  sed -n "s/^$1=//p" "$STATE" 2>/dev/null | head -1
}

is_int() {
  case "${1:-}" in
    '' | *[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

iso_of() {
  date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf 'unknown\n'
}

# GET on the daemon socket. Prints the body; $? is curl's own verdict, which is
# the part carrying the information.
api_get() {
  curl -s --max-time "$CURL_TIMEOUT" --unix-socket "$SOCK" "http://localhost$1" 2>/dev/null
}

mkdir -p "$GUARD_DIR" 2>/dev/null || {
  log "REFUSED — cannot create $GUARD_DIR"
  exit 1
}

NOW="$(date +%s)"
is_int "$NOW" || { log "REFUSED — 'date +%s' returned nothing usable on this host"; exit 1; }

# ── 1. does the daemon answer at all? ────────────────────────────────────────
PING_BODY="${TMPD}/care-daemon-probe-ping.$$"
rm -f "$PING_BODY" 2>/dev/null
METRICS="$(curl -s --max-time "$CURL_TIMEOUT" --unix-socket "$SOCK" \
  -o "$PING_BODY" -w '%{http_code} %{time_total}' http://localhost/_ping 2>/dev/null)"
PING_RC=$?
CODE="${METRICS%% *}"
TIME_TOTAL="${METRICS##* }"
PING_MS="$(printf '%s' "$TIME_TOTAL" | awk '{printf "%d", ($1 * 1000) + 0.5}' 2>/dev/null)"
is_int "$PING_MS" || PING_MS=unknown
BODY_OK=0
if [ -f "$PING_BODY" ] && grep -q 'OK' "$PING_BODY" 2>/dev/null; then BODY_OK=1; fi
rm -f "$PING_BODY" 2>/dev/null

# curl 7.86 on this box: 7 = nothing listening on that socket, 28 = the socket
# accepted and then said nothing before --max-time expired, which is what a
# mid-reload dockerd looks like.
if [ "$PING_RC" -eq 0 ] && [ "$CODE" = "200" ] && [ "$BODY_OK" -eq 1 ]; then
  PING=ok
elif [ "$PING_RC" -eq 7 ] || [ "$PING_RC" -eq 28 ]; then
  PING=down
else
  # rc 127 (no curl), rc 2 (unsupported option), a 200 without "OK", an empty
  # -w: all of these mean the probe could not tell, which is not an outage.
  PING=unknown
fi

# ── 2. which daemon is answering, and since when? ────────────────────────────
# Independent of the socket: the pid file's mtime outlives the daemon being down,
# which is exactly when the start instant is the most useful fact on the page.
DAEMON_START="$(stat -c %Y "$PID_FILE" 2>/dev/null | head -1)"
is_int "$DAEMON_START" || DAEMON_START=unknown

UPTIME_S="$(cut -d. -f1 "$UPTIME_FILE" 2>/dev/null | head -1)"
if is_int "$UPTIME_S"; then HOST_BOOT=$((NOW - UPTIME_S)); else HOST_BOOT=unknown; fi

# ── 3. live-restore and engine version, from the daemon's own mouth ──────────
LIVE_RESTORE=unknown
LIVE_RESTORE_SRC=none
SERVER_VERSION=unknown
RUNNING=unknown
SEEN=unknown
if [ "$PING" = ok ]; then
  INFO="$(curl -s --max-time "$INFO_TIMEOUT" --unix-socket "$SOCK" http://localhost/info 2>/dev/null)"
  INFO_RC=$?
  if [ "$INFO_RC" -eq 0 ] && [ -n "$INFO" ]; then
    case "$INFO" in
      *'"LiveRestoreEnabled":true'*) LIVE_RESTORE=on; LIVE_RESTORE_SRC=daemon ;;
      *'"LiveRestoreEnabled":false'*) LIVE_RESTORE=off; LIVE_RESTORE_SRC=daemon ;;
    esac
    SERVER_VERSION="$(printf '%s' "$INFO" | tr ',' '\n' \
      | sed -n 's/.*"ServerVersion":"\([^"]*\)".*/\1/p' | head -1)"
    [ -n "$SERVER_VERSION" ] || SERVER_VERSION=unknown
  fi

  # ── 4. the ERP's own containers, as the daemon sees them ────────────────────
  RUNC=0
  SEENC=0
  NOW_STAMPS=""
  for c in $CONTAINERS; do
    CBODY="$(api_get "/containers/$c/json")"
    if [ $? -ne 0 ] || [ -z "$CBODY" ]; then
      NOW_STAMPS="$NOW_STAMPS $c:err"
      continue
    fi
    CST="$(printf '%s' "$CBODY" | tr ',' '\n' \
      | sed -n 's/.*"Status":"\([a-z]*\)".*/\1/p' | head -1)"
    CSA="$(printf '%s' "$CBODY" | tr ',' '\n' \
      | sed -n 's/.*"StartedAt":"\([^"]*\)".*/\1/p' | head -1)"
    SEENC=$((SEENC + 1))
    [ "$CST" = "running" ] && RUNC=$((RUNC + 1))
    # Docker writes nanoseconds; a second-resolution stamp is what both the
    # comparison below and the trim need ("0001-01-01T00:00:00Z" included).
    NOW_STAMPS="$NOW_STAMPS $c:$(printf '%s' "$CSA" | cut -c1-19)Z"
  done
  RUNNING="$RUNC"
  SEEN="$SEENC"
fi

# ── 5. what the last sample said, and what changed since ─────────────────────
P_PING="$(prev_val ping)"
P_DS="$(prev_val daemon_start)"
P_DOWN="$(prev_val down_since)"
is_int "$P_DOWN" || P_DOWN=0
P_STAMPS="$(prev_val stamps)"
P_EV_AT="$(prev_val ev_at)"
is_int "$P_EV_AT" || P_EV_AT=0
P_EV_KIND="$(prev_val ev_kind)"
P_EV_DARK="$(prev_val ev_dark_s)"
P_EV_STAMPS="$(prev_val ev_stamps)"
P_EV_LR="$(prev_val ev_live_restore)"
P_EV_ENGINE="$(prev_val ev_server_version)"
P_EV_OPEN="$(prev_val ev_open)"
is_int "$P_EV_OPEN" || P_EV_OPEN=0

# An unreadable tick must not erase the fingerprints the next comparison needs,
# and must not pretend every container is down: carry the stamps, blank the
# counts, and let the light read "unknown" out of an unknown.
if [ "$PING" = ok ]; then
  STAMPS="$(printf '%s' "$NOW_STAMPS" | sed 's/^ //')"
  STAMPS_READ=1
else
  STAMPS="$P_STAMPS"
  STAMPS_READ=0
fi

DOWN_SINCE="$P_DOWN"
EV_AT="$P_EV_AT"
EV_KIND="$P_EV_KIND"
EV_DARK="$P_EV_DARK"
EV_STAMPS="$P_EV_STAMPS"
EV_LR="$P_EV_LR"
EV_ENGINE="$P_EV_ENGINE"
EV_OPEN="$P_EV_OPEN"
EVENT_NOTE="nothing to report"

# A daemon restart is a NEW pid-file mtime. Detectable whether or not the socket
# has come back, which is the difference between reporting a 35-minute outage at
# 08:30 and never reporting it at all.
DAEMON_MOVED=0
if [ -n "$P_DS" ] && [ "$P_DS" != "unknown" ] && [ "$DAEMON_START" != "unknown" ] \
   && [ "$DAEMON_START" != "$P_DS" ]; then
  DAEMON_MOVED=1
fi

stamp_changes() {
  # On a dark tick $STAMPS IS $P_STAMPS, carried forward so the NEXT readable
  # tick has something to compare against. Comparing those with each other would
  # print "0/4 changed" — a confident claim that no ERP container restarted,
  # made by a sample that could not look. Say unknown instead, which is what the
  # light already knows how to render honestly.
  if [ "$STAMPS_READ" -ne 1 ]; then printf 'unknown\n'; return; fi
  CHANGED_N=0
  COMPARED_N=0
  for n in $CONTAINERS; do
    before="$(printf '%s\n' "$P_STAMPS" | tr ' ' '\n' | sed -n "s|^$n:||p" | head -1)"
    after="$(printf '%s\n' "$STAMPS" | tr ' ' '\n' | sed -n "s|^$n:||p" | head -1)"
    [ -n "$before" ] || continue
    [ -n "$after" ] || continue
    [ "$after" = "err" ] && continue
    COMPARED_N=$((COMPARED_N + 1))
    [ "$before" != "$after" ] && CHANGED_N=$((CHANGED_N + 1))
  done
  if [ "$COMPARED_N" -eq 0 ]; then
    printf 'unknown\n'
  else
    printf '%s/%s\n' "$CHANGED_N" "$COMPARED_N"
  fi
}

if [ "$DAEMON_MOVED" -eq 1 ]; then
  # The daemon is a different process than the one the last tick saw.
  EV_AT="$DAEMON_START"
  if [ "$HOST_BOOT" != "unknown" ] && [ "$DAEMON_START" -ge "$HOST_BOOT" ] \
     && [ $((DAEMON_START - HOST_BOOT)) -le "$BOOT_WINDOW_S" ]; then
    EV_KIND=boot
  else
    EV_KIND=daemon
  fi
  if [ "$PING" = down ]; then
    # Caught mid-outage: the new daemon exists and already refuses to answer.
    EV_OPEN=1
    EV_DARK=unknown
    if [ "$P_DOWN" -gt 0 ] && [ "$NOW" -ge "$P_DOWN" ]; then
      DOWN_SINCE="$P_DOWN"
    else
      # Open the window at THIS tick, not at 0. A zero here would read as "no
      # window is open" on a sample whose own ping says down, and the page would
      # then report an outage with no outage clock — while the next tick, seeing
      # the same refusal, would date the window to five minutes later than it
      # began. $ev_at already carries the truer instant (the new daemon's start).
      DOWN_SINCE="$NOW"
    fi
    EVENT_NOTE="dockerd started $(iso_of "$DAEMON_START") and STILL does not answer"
  else
    EV_OPEN=0
    if [ "$P_DOWN" -gt 0 ] && [ "$NOW" -ge "$P_DOWN" ]; then
      EV_DARK=$((NOW - P_DOWN))
      DOWN_SINCE=0
    else
      # Nothing ever saw it refuse: it came back inside one tick, or the probe
      # was not running. Say unknown instead of inventing a duration of zero.
      EV_DARK=unknown
    fi
    EVENT_NOTE="dockerd restarted $(iso_of "$DAEMON_START")"
  fi
  EV_STAMPS="$(stamp_changes)"
  EV_LR="$LIVE_RESTORE"
  EV_ENGINE="$SERVER_VERSION"
elif [ "$PING" = down ]; then
  if [ "$DOWN_SINCE" -eq 0 ] || [ "$NOW" -lt "$DOWN_SINCE" ]; then DOWN_SINCE="$NOW"; fi
  EV_AT="$DOWN_SINCE"
  EV_OPEN=1
  EV_DARK=unknown
  if [ "$P_PING" = down ] && [ "$P_EV_OPEN" -eq 1 ]; then
    EVENT_NOTE="still not answering (open since $(iso_of "$DOWN_SINCE"))"
  else
    EV_KIND=stall
    EV_STAMPS="$(stamp_changes)"
    EV_LR="$LIVE_RESTORE"
    EV_ENGINE="$SERVER_VERSION"
    EVENT_NOTE="stopped answering $(iso_of "$DOWN_SINCE"), same daemon process so far"
  fi
elif [ "$PING" = ok ] && [ "$P_DOWN" -gt 0 ]; then
  # Answering again without the pid file moving: the daemon stalled and recovered
  # rather than restarting.
  EV_AT="$NOW"
  EV_KIND=stall
  EV_OPEN=0
  EV_DARK=$((NOW - P_DOWN))
  EV_STAMPS="$(stamp_changes)"
  EV_LR="$LIVE_RESTORE"
  EV_ENGINE="$SERVER_VERSION"
  DOWN_SINCE=0
  EVENT_NOTE="answering again after a window opened $(iso_of "$P_DOWN")"
elif [ "$PING" = unknown ]; then
  # Do not open or close an incident on a sample this host could not interpret.
  EVENT_NOTE="probe could not interpret the daemon (curl rc=$PING_RC); previous state kept"
else
  EVENT_NOTE="answering, no daemon change since the last tick"
fi

# ── 6. the incident ledger: one line per transition, capped, newest last ─────
NEW_EVENT=0
if [ "$DAEMON_MOVED" -eq 1 ]; then NEW_EVENT=1; fi
if [ "$PING" = down ] && [ "$P_PING" != "down" ]; then NEW_EVENT=1; fi
if [ "$PING" = ok ] && [ "$P_DOWN" -gt 0 ] && [ "$DAEMON_MOVED" -eq 0 ]; then NEW_EVENT=1; fi

if [ "$NEW_EVENT" -eq 1 ]; then
  printf '%s kind=%s open=%s dark_s=%s live_restore=%s engine=%s stamps=%s ping_rc=%s\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" "${EV_KIND:-none}" "$EV_OPEN" "${EV_DARK:-unknown}" \
    "${EV_LR:-unknown}" "${EV_ENGINE:-unknown}" "${EV_STAMPS:-unknown}" "$PING_RC" \
    >> "$EVENTS" 2>/dev/null || log "WARN — could not append to $EVENTS"
  tail -n "$EVENTS_KEEP" "$EVENTS" > "${EVENTS}.tmp.$$" 2>/dev/null \
    && mv -f "${EVENTS}.tmp.$$" "$EVENTS" 2>/dev/null \
    || rm -f "${EVENTS}.tmp.$$" 2>/dev/null
fi

# ── 7. write the sample, atomically ──────────────────────────────────────────
# care-api reads this while the ERP serves the clinic, so a reader must never see
# a half-written sample: build beside it, then rename over the top.
EV_AT_ISO=never
if [ "$EV_AT" -gt 0 ]; then EV_AT_ISO="$(iso_of "$EV_AT")"; fi

TMP_STATE="${STATE}.tmp.$$"
{
  printf 'at=%s\n' "$NOW"
  printf 'at_iso=%s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')"
  printf 'ping=%s\n' "$PING"
  printf 'ping_rc=%s\n' "$PING_RC"
  printf 'ping_http=%s\n' "${CODE:-unknown}"
  printf 'ping_ms=%s\n' "$PING_MS"
  printf 'daemon_start=%s\n' "$DAEMON_START"
  printf 'daemon_start_iso=%s\n' "$(iso_of "$DAEMON_START")"
  printf 'host_boot=%s\n' "$HOST_BOOT"
  printf 'down_since=%s\n' "$DOWN_SINCE"
  printf 'live_restore=%s\n' "$LIVE_RESTORE"
  printf 'live_restore_src=%s\n' "$LIVE_RESTORE_SRC"
  printf 'server_version=%s\n' "$SERVER_VERSION"
  printf 'containers_seen=%s\n' "$SEEN"
  printf 'containers_running=%s\n' "$RUNNING"
  printf 'stamps=%s\n' "$STAMPS"
  printf 'ev_at=%s\n' "$EV_AT"
  printf 'ev_at_iso=%s\n' "$EV_AT_ISO"
  printf 'ev_kind=%s\n' "${EV_KIND:-none}"
  printf 'ev_open=%s\n' "$EV_OPEN"
  printf 'ev_dark_s=%s\n' "${EV_DARK:-unknown}"
  printf 'ev_stamps=%s\n' "${EV_STAMPS:-unknown}"
  printf 'ev_live_restore=%s\n' "${EV_LR:-unknown}"
  printf 'ev_server_version=%s\n' "${EV_ENGINE:-unknown}"
} > "$TMP_STATE" 2>/dev/null

if [ -s "$TMP_STATE" ] && mv -f "$TMP_STATE" "$STATE" 2>/dev/null; then
  :
else
  rm -f "$TMP_STATE" 2>/dev/null
  log "REFUSED — cannot write $STATE"
  exit 1
fi

log "ping=$PING rc=$PING_RC ${PING_MS}ms daemon=$(iso_of "$DAEMON_START") live_restore=$LIVE_RESTORE down_since=$DOWN_SINCE ev=${EV_KIND:-none}/open=$EV_OPEN/dark=${EV_DARK:-unknown}/stamps=${EV_STAMPS:-unknown} containers=${RUNNING}/${SEEN} — $EVENT_NOTE"

# Zero on a healthy tick AND on a daemon outage: cron mails a non-zero exit, and
# a dead daemon is not this script's failure. Non-zero here means the probe
# itself could not run, which is the only thing cron should shout about.
exit 0
