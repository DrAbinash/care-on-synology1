#!/bin/bash
# =============================================================================
# CARE ERP — recover the clinic after a Docker daemon restart (Synology)
# Dr. Abinash Kumar, Care Diagnostics, Deoghar
# =============================================================================
# WHAT THIS IS
#   dockerd on this box dies on its own. Measured in /var/log/systemd.log:
#
#     2026-11-12T01:42:34+05:30  main process exited, code=exited, status=2
#     2026-11-12T01:42:53+05:30  main process exited, code=exited, status=1
#     2026-11-12T01:42:55+05:30  holdoff time over, scheduling restart
#
#   with the same shape on Nov 7 (01:48) and Nov 11 (00:04), and nobody was
#   logged in, nothing was patched and no deploy was running. systemd revives the
#   daemon in about 20 s; the clinic then finds the ERP broken in one of two ways,
#   and this script tells them apart before it touches anything.
#
#   1. WITHOUT live-restore the daemon's death stopped every container. The ERP
#      was dark until someone ran `compose up -d` — 01:42 to 08:33 on 2026-11-12.
#   2. WITH live-restore (installed 2026-11-12 09:24 IST) the containers keep
#      running, and the ERP is *still* broken: the daemon re-adopts each container
#      but drops its embedded-DNS service record. Measured 13:33 IST the same day,
#      from inside care-web, after a deliberate `systemctl restart`:
#
#        nslookup api   -> ** server can't find api: NXDOMAIN
#        nslookup db    -> ** server can't find db: NXDOMAIN
#        nslookup redis -> ** server can't find redis: NXDOMAIN
#        nslookup web   -> 192.168.144.3     (the one container that had restarted)
#
#      care-web's nginx does live lookups, so it fails with
#      "api could not be resolved (3: Host not found)" and answers 502 on /api/*
#      while /erp/ still serves 200 from disk. The desk sees the ERP open and then
#      refuse to work, and `docker ps` says everything is Up and healthy. That is
#      harder to diagnose than case 1, and it cost roughly 1.5 h because nobody had
#      a runbook: the only fix is to restart the containers so they re-register.
#
#   Orthanc is NOT in this blast radius: pacs_settings reaches it by IP
#   (172.16.1.139:8042), not by service name, so the PACS leg keeps working.
#
# WHY THE ORDER IS db, redis, api, web — AND WHY IT IS ONE AT A TIME
#   Running `compose restart db redis api` in one command brought care-api up at
#   07:50:58Z and care-db at 07:51:04Z: compose does not honour the argument
#   order. The API then ran its whole boot sequence against a Postgres that was
#   still starting, and every startup step logged `57P03 the database system is
#   starting up` — startup migrations, the PACS settings seed, the system
#   presentation templates ("signing will be refused until a presentation is
#   published"), the Hope bootstrap. None of it damaged the clinic in the end
#   (verified: care-classic is published, ledgers.is_walk_in exists) because those
#   writes are idempotent and the rows were already there. But that was luck, not
#   design. So this script restarts one service, waits until it is USEFUL, and
#   only then moves to the next.
#
# HOW IT PROTECTS THE CLINIC
#   * Read-only unless you say otherwise. The DEFAULT is --check: it probes and
#     reports and stops containers nothing else can reach. --fix is what acts.
#     That inverts deploy.sh's convention on purpose — on 2026-11-12 a live
#     `systemctl restart` was pasted by mistake into a terminal and took the ERP
#     down mid-day. A script that can restart production does not start by
#     assuming the operator meant it.
#   * It never restarts anything unless it has PROVED the failure is this one:
#     /api/healthz not OK, and a service name that does not resolve from inside
#     care-web. Unrelated outages (a crashed container, a dead database) get a
#     diagnosis and a pointer, not a blind restart.
#   * No `down`, no `-v`, no `rm`, no `--build`, no `up`. `restart` stops and
#     starts the SAME containers with the SAME images on the SAME volumes. Before
#     and after, care-db's container id and volume are compared and a mismatch
#     stops the script.
#   * It refuses to run beside a deploy (/tmp/care-deploy.lock) and beside itself
#     (/tmp/care-recover.lock), and it never prints .env.
#
# USAGE
#   /volume1/docker/care-erp-github/recover-after-daemon-restart.sh            # diagnose
#   /volume1/docker/care-erp-github/recover-after-daemon-restart.sh --fix      # act
#
#   The rehearsal it is meant for, after clinic close:
#     docker ps --format '{{.Names}} {{.Status}}' | grep -E 'care-(api|db|web)' > /tmp/lr-before.txt
#     systemctl restart pkg-ContainerManager-dockerd.service   # 18-48 min; do not Ctrl-C, do not panic
#     <this script>                                            # should now REPORT the DNS loss
#     <this script> --fix                                      # should repair it
#     cat /tmp/lr-before.txt ; docker ps --format '{{.Names}} {{.Status}}' | grep -E 'care-(api|db|web)'
#   Containers surviving with their ORIGINAL StartedAt proves live-restore; the
#   script going from "aliases missing" to "all endpoints 200" proves the recovery.
#
# EXIT CODES — these are an interface, because an unattended variant would read
#   them:  0 healthy or recovered · 2 unknown argument · 3 refused, a deploy holds
#   the lock · 4 this is NOT the DNS defect (so nothing was restarted) · 5 a service
#   did not restart · 6 it restarted but never became useful · 7 care-db changed
#   identity or volume · 8 the ERP never answered within the bound · 9 the DNS probe
#   itself could not run, so this script refuses to guess · 10 the defect IS present
#   and --check withheld the fix (run with --fix, or let the operator decide).
#
#   Note the daemon's own readiness: /var/log/packages/ContainerManager.log
#   documents a known-good start going "start daemon.." 01:25:28 -> "daemon is
#   ready" 01:43:44, which is 17 m 54 s. A `systemctl restart` on
#   pkg-ContainerManager-dockerd.service sits silent for that long and leaves the
#   unit in `activating (start)`; that is the daemon loading 36 containers, not a
#   hang, and MainPID plus HTTP probes are what answer whether it is healthy.
# =============================================================================

set -euo pipefail

# ssh on Synology starts a non-login shell whose PATH has no /usr/local/bin, so
# `docker` is simply absent and a probe would conclude the containers do not
# exist. Append, never prepend: see production-script-path-prepend-silently-
# defeats-stub-harness — a PATH that puts system dirs first silently disables any
# harness that stubs docker on PATH.
PATH="${PATH:-}:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH

# ── Configuration ────────────────────────────────────────────────────────────
DEPLOY_DIR="${DEPLOY_DIR:-/volume1/docker/care-erp-github/care-on-synology1}"
PROJECT_NAME="${PROJECT_NAME:-care-erp-github}"
LOG_DIR="${LOG_DIR:-/volume1/docker/care-deploy-logs}"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"

DB_SERVICE="db";      DB_CONTAINER="care-db"
REDIS_SERVICE="redis"; REDIS_CONTAINER="care-redis"
API_SERVICE="api";     API_CONTAINER="care-api"
WEB_SERVICE="web";     WEB_CONTAINER="care-web"

# How long each wait may take. Postgres recovery is seconds; the API needs the
# startup-migration window, measured at 176 s on 2026-11-12 — which is why the
# endpoint probes below LOOP instead of sampling once.
DB_READY_TIMEOUT="${DB_READY_TIMEOUT:-120}"
REDIS_READY_TIMEOUT="${REDIS_READY_TIMEOUT:-60}"
API_READY_TIMEOUT="${API_READY_TIMEOUT:-300}"
ENDPOINT_TIMEOUT="${ENDPOINT_TIMEOUT:-300}"

BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; NC=$'\033[0m'
info() { printf '%s▶%s %s\n' "$BOLD" "$NC" "$*"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$NC" "$*"; }

# ── Arguments ────────────────────────────────────────────────────────────────
MODE="check"
while [ $# -gt 0 ]; do
  case "$1" in
    --fix|--recover) MODE="fix" ;;
    --check|--dry-run) MODE="check" ;;
    -h|--help) sed -n '2,60p' "$0"; exit 0 ;;
    *) printf '%sUnknown argument %s%s (this script takes --check or --fix).\n' "$RED" "$1" "$NC" >&2; exit 2 ;;
  esac
  shift
done

mkdir -p "$LOG_DIR" 2>/dev/null || { LOG_DIR="${TMPDIR:-/tmp}/care-recover-logs"; mkdir -p "$LOG_DIR"; }
LOG="${LOG_DIR}/recover-${RUN_ID}.log"

dc() { (cd "$DEPLOY_DIR" && docker compose -p "$PROJECT_NAME" "$@"); }

# Read exactly one key out of .env; never print the file, which holds secrets.
host_port() {
  local p=""
  [ -f "$DEPLOY_DIR/.env" ] && p="$(sed -n 's/^HOST_PORT=//p' "$DEPLOY_DIR/.env" | tail -1 | tr -d '[:space:]')"
  printf '%s' "${p:-8888}"
}

code() { curl -s -o /dev/null -w '%{http_code}' --max-time "${3:-10}" "$1$2" || true; }

# The daemon's re-adoption is only observable through the names the app dials.
# Three answers, not two: a probe that could not run must never be read as
# "resolves", because "nothing is missing" is what unlocks the restart path.
alias_state() {
  local out rc=0
  out="$(timeout 12 docker exec "$WEB_CONTAINER" nslookup "$1" 2>&1)" || rc=$?
  PROBE_RAW="$out"
  case "$out" in
    *NXDOMAIN*|*"can't find"*|*SERVFAIL*) echo missing; return 0 ;;
  esac
  if [ "$rc" = 0 ]; then echo ok; else echo dead; fi
}

pg_ready() {
  timeout 12 docker exec "$DB_CONTAINER" pg_isready -U erp -d diagnostic_erp -q >/dev/null 2>&1
}

redis_ready() {
  [ "$(timeout 12 docker exec "$REDIS_CONTAINER" redis-cli ping 2>/dev/null | tr -d '\r' || true)" = "PONG" ]
}

wait_for() {
  local what="$1" limit="$2" fn="$3" waited=0
  until "$fn"; do
    if [ "$waited" -ge "$limit" ]; then return 1; fi
    sleep 3; waited=$((waited + 3)); printf '  … %ss waiting for %s\n' "$waited" "$what"
  done
  return 0
}

# ── Refuse to collide with a running deploy ──────────────────────────────────
if [ -d /tmp/care-deploy.lock ]; then
  printf '%s✗ REFUSED%s — a deploy holds /tmp/care-deploy.lock (its pid: %s).\n' \
    "$BOLD" "$RED" "$(cat /tmp/care-deploy.lock/pid 2>/dev/null || echo unknown)"
  printf '  Wait for it, or if it is stale: rm -f /tmp/care-deploy.lock/pid && rmdir /tmp/care-deploy.lock\n\n'
  exit 3
fi
# The holder writes its pid INSIDE the directory, so `rmdir` alone can never work.
if ! mkdir /tmp/care-recover.lock 2>/dev/null; then
  printf '%s✗ REFUSED%s — another recovery holds /tmp/care-recover.lock (its pid: %s).\n' \
    "$BOLD" "$RED" "$(cat /tmp/care-recover.lock/pid 2>/dev/null || echo unknown)"
  printf '  If it is stale: rm -f /tmp/care-recover.lock/pid && rmdir /tmp/care-recover.lock\n\n'
  exit 3
fi
echo "$$" > /tmp/care-recover.lock/pid
trap 'rm -f /tmp/care-recover.lock/pid; rmdir /tmp/care-recover.lock 2>/dev/null' EXIT

{
echo "==========================================================================="
echo " recover-after-daemon-restart  run=$RUN_ID  mode=$MODE"
echo " daemon: MainPID=$(systemctl show pkg-ContainerManager-dockerd.service -p MainPID --value 2>/dev/null || echo '?') state=$(systemctl is-active pkg-ContainerManager-dockerd.service 2>/dev/null || echo '?')"
echo "==========================================================================="
} | tee "$LOG"

HOST_PORT_NO="$(host_port)"
BASE="http://127.0.0.1:${HOST_PORT_NO}"

# ── Step 1: is the clinic broken at all? ─────────────────────────────────────
echo "" | tee -a "$LOG"
info "Probing the ERP through the port the desk uses ($BASE)"
hz="$(code "$BASE" /api/healthz 15)"
printf '  /api/healthz  → %s\n' "${hz:-no answer}" | tee -a "$LOG"
if [ "$hz" = "200" ]; then
  body="$(curl -s --max-time 12 "$BASE/api/health" || true)"
  ok "The ERP is answering. Nothing for this script to do."
  printf '  commit=%s  artifactSha256=%s\n' \
    "$(printf '%s' "$body" | sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p' | head -c 12)" \
    "$(printf '%s' "$body" | sed -n 's/.*"artifactSha256":"\([0-9a-f]*\)".*/\1/p' | head -c 16)" | tee -a "$LOG"
  exit 0
fi

# ── Step 2: prove WHY before restarting anything ─────────────────────────────
echo "" | tee -a "$LOG"
info "Diagnosing — containers first, then the service names the app dials"
for c in "$WEB_CONTAINER" "$API_CONTAINER" "$DB_CONTAINER" "$REDIS_CONTAINER"; do
  printf '  %-12s %s\n' "$c" "$(docker inspect --format '{{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} started={{.State.StartedAt}} restarts={{.RestartCount}}' "$c" 2>&1)" | tee -a "$LOG"
done

MISSING=""
UNKNOWN=""
PROBE_RAW=""
for n in api db redis web; do
  case "$(alias_state "$n")" in
    missing)
      MISSING="$MISSING $n"
      printf '  %-6s → NXDOMAIN (endpoint not registered)\n' "$n" | tee -a "$LOG" ;;
    ok)
      printf '  %-6s → resolves\n' "$n" | tee -a "$LOG" ;;
    *)
      UNKNOWN="$UNKNOWN $n"
      printf '  %-6s → PROBE DID NOT RUN: %s\n' "$n" "$(printf '%s' "$PROBE_RAW" | head -1)" | tee -a "$LOG" ;;
  esac
done
nginx_reason="$(timeout 15 docker logs --since 15m "$WEB_CONTAINER" 2>&1 | grep -c 'could not be resolved' || true)"
printf '  nginx "could not be resolved" lines in the last 15 min: %s\n' "$nginx_reason" | tee -a "$LOG"

if [ -n "${UNKNOWN// /}" ]; then
  warn "Could not read the DNS state for:$UNKNOWN — nslookup did not answer from inside $WEB_CONTAINER."
  printf '  This script will not restart the clinic on a guess. Read the raw output above;\n' | tee -a "$LOG"
  printf '  if %s itself is down, that is a different outage:  docker logs --tail 60 %s\n' "$WEB_CONTAINER" "$WEB_CONTAINER" | tee -a "$LOG"
  exit 9
fi

if [ -z "${MISSING// /}" ]; then
  warn "No service name is missing, so this is NOT the live-restore DNS defect."
  printf '  Do not let this script restart services blind. Read:\n' | tee -a "$LOG"
  printf '    docker logs --tail 80 %s\n    docker logs --tail 40 %s\n' "$API_CONTAINER" "$DB_CONTAINER" | tee -a "$LOG"
  printf '  and if the database is the fault, stop and call the owner.\n' | tee -a "$LOG"
  exit 4
fi

if [ "$MODE" = "check" ]; then
  echo "" | tee -a "$LOG"
  info "This is --check, so nothing was restarted. The fix, in the order that works:"
  printf '    %s --fix\n' "$0" | tee -a "$LOG"
  printf '  or by hand, ONE AT A TIME, waiting between each: docker compose -p %s restart db\n' "$PROJECT_NAME" | tee -a "$LOG"
  printf '  (a single \`restart db redis api\` starts the api before Postgres accepts connections)\n' | tee -a "$LOG"
  exit 10
fi

# ── Step 3: recover, one service at a time, gated on usefulness ──────────────
DB_ID_BEFORE="$(docker inspect --format '{{.Id}}' "$DB_CONTAINER" 2>/dev/null || true)"
DB_VOL_BEFORE="$(docker inspect --format '{{range .Mounts}}{{.Name}} {{end}}' "$DB_CONTAINER" 2>/dev/null || true)"

restart_one() {
  local svc="$1" container="$2" limit="$3" probe="$4"
  echo "" | tee -a "$LOG"
  info "Restarting $svc ($container) — it re-registers its DNS endpoint"
  if ! dc restart "$svc" 2>&1 | tee -a "$LOG"; then
    printf '%s✗ %s did not restart.%s Full log: %s\n' "$RED" "$svc" "$NC" "$LOG" | tee -a "$LOG"
    exit 5
  fi
  if [ -n "$probe" ] && ! wait_for "$container" "$limit" "$probe"; then
    printf '%s✗ %s restarted but %s never became useful within %ss.%s Stopping here — restarting more containers on a broken database only compounds it.\n' \
      "$RED" "$svc" "$container" "$limit" "$NC" | tee -a "$LOG"
    exit 6
  fi
  ok "$container is up and answering its own readiness probe"
}

# db first: every later service dials it.
restart_one "$DB_SERVICE" "$DB_CONTAINER" "$DB_READY_TIMEOUT" pg_ready
restart_one "$REDIS_SERVICE" "$REDIS_CONTAINER" "$REDIS_READY_TIMEOUT" redis_ready
restart_one "$API_SERVICE" "$API_CONTAINER" "$API_READY_TIMEOUT" ""
# web only if its own alias is gone; nginx already resolves what exists.
case " $MISSING " in
  *" $WEB_SERVICE "*) restart_one "$WEB_SERVICE" "$WEB_CONTAINER" 120 "" ;;
  *) echo "" | tee -a "$LOG"; info "Skipping $WEB_SERVICE — its endpoint already resolved, and restarting nginx would drop the desk's page for nothing" ;;
esac

# care-db must be the same container on the same volume: a `restart` never
# recreates, and if that proof fails something else has already gone wrong.
DB_ID_AFTER="$(docker inspect --format '{{.Id}}' "$DB_CONTAINER" 2>/dev/null || true)"
DB_VOL_AFTER="$(docker inspect --format '{{range .Mounts}}{{.Name}} {{end}}' "$DB_CONTAINER" 2>/dev/null || true)"
if [ "$DB_ID_BEFORE" != "$DB_ID_AFTER" ] || [ "$DB_VOL_BEFORE" != "$DB_VOL_AFTER" ]; then
  printf '\n%s✗ STOP%s — care-db changed identity or volume (%s/%s → %s/%s). This script never recreates the database; find out what did before the clinic writes another report.\n' \
    "$BOLD" "$RED" "$DB_ID_BEFORE" "$DB_VOL_BEFORE" "$DB_ID_AFTER" "$DB_VOL_AFTER" | tee -a "$LOG"
  exit 7
fi
ok "care-db is the same container on the same volume (id ${DB_ID_AFTER:0:12})"

# ── Step 4: prove the desk can work, by looping not sampling ─────────────────
echo "" | tee -a "$LOG"
info "Waiting for the ERP to answer for real (up to ${ENDPOINT_TIMEOUT}s — /api/healthz stays 503 through startup migrations)"
waited=0
while [ "$(code "$BASE" /api/healthz 15)" != "200" ]; do
  if [ "$waited" -ge "$ENDPOINT_TIMEOUT" ]; then
    printf '%s✗ %s/api/healthz never returned 200 within %ss.%s\n  Read: docker logs --tail 100 %s\n  Full log: %s\n' \
      "$RED" "$BASE" "$ENDPOINT_TIMEOUT" "$NC" "$API_CONTAINER" "$LOG" | tee -a "$LOG"
    exit 8
  fi
  sleep 5; waited=$((waited + 5)); printf '  … %ss  healthz=%s\n' "$waited" "$(code "$BASE" /api/healthz 15)" | tee -a "$LOG"
done
ok "/api/healthz 200 after ${waited}s — nginx reaches care-api and care-api reaches care-db"

for p in /nginx-health /erp/ /erp/radiology /api/health/schema /api/portal/settings; do
  printf '  %-22s → %s\n' "$p" "$(code "$BASE" "$p" 15)" | tee -a "$LOG"
done

echo "" | tee -a "$LOG"
info "Remaining checks this script cannot do for you"
printf '  PACS is reached by IP, so it is not affected — but confirm at a desk:\n' | tee -a "$LOG"
printf '    staff login, open one study in OHIF, sign one report (signing needs a published presentation)\n' | tee -a "$LOG"
printf '  Orthanc itself:  curl -s -o /dev/null -w "%%{http_code}\\n" http://127.0.0.1:8042/system\n' | tee -a "$LOG"

echo "" | tee -a "$LOG"
ok "Recovery complete. Full log: $LOG"
