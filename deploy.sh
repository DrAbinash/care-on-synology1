#!/bin/bash
# =============================================================================
# CARE ERP — production deployment (Synology)
# Dr. Abinash Kumar, Care Diagnostics, Deoghar
# =============================================================================
# WHAT THIS IS
#   The version-controlled source of the script the NAS runs. This file lives in
#   the repository; the command the operator types is a symlink to it:
#
#     /volume1/docker/care-erp-github/deploy.sh -> care-on-synology1/deploy.sh
#
#   So one command deploys the clinic:
#
#     /volume1/docker/care-erp-github/deploy.sh              # deploy origin/main
#     /volume1/docker/care-erp-github/deploy.sh --check      # rehearse, deploy nothing
#
# HOW IT PROTECTS THE CLINIC
#   1. Everything that can fail is decided BEFORE the containers are recreated,
#      because the recreate is the only downtime. The build comes first: a broken
#      vite build then costs a failed deploy, not a dead ERP.
#   2. Nothing is "rolled back" by moving Git. The previous version of this script
#      answered a failed migration with `git reset --hard HEAD~1`, which rewrote
#      the checkout while the containers were still running the images before it,
#      and threw away the commit being deployed (and HEAD~1 is not necessarily
#      that commit — squash merges make the count a lie). Here the checkout stays
#      where it is, the running images are pinned by tag BEFORE anything is
#      built, and every failure prints the exact commands to go back.
#   3. The database is never part of a deploy. This script never names the `db`
#      service, never passes `-v` or `down`, and proves afterwards that care-db is
#      the same container on the same volume it started with.
#   4. Whether migrations are pending is answered by the migration script itself
#      (`care-db-patch-v2 --check`), not by a second guess in bash: same journal,
#      same directory, same two ledgers, same verdict. When nothing is pending the
#      migration container is not run; the checks are not.
#
# BACKUP POLICY (why there is no pg_dump in here)
#   CARE runs on a persistent PostgreSQL volume and takes its own encrypted
#   nightly database backups, each one decrypt-verified and recorded in
#   backup_job_logs with a `backupProof=v1 … outcome=verified` marker. Re-dumping
#   ~600 MB before every routine code deploy would add minutes of I/O to a NAS
#   that also serves PACS, and would not make a code deploy any safer. So:
#     * code-only deploy              → no backup asked for
#     * pending migration changes the
#       schema                        → a VERIFIED backup within BACKUP_MAX_AGE_HOURS
#                                        (default 26) or the deploy stops
#     * pending migration DESTROYS
#       data (DROP/TRUNCATE/DELETE…)  → a VERIFIED backup within
#                                        FRESH_BACKUP_MAX_AGE_MINUTES (default 60)
#                                        AND an explicit --approve-destructive
#   scripts/ops-preflight.mjs is the fuller read-only gate (identity, restore
#   evidence, credentials, disk) when an operator wants more than these.
#
# WHAT --CHECK CHANGES, AND WHY THAT IS THE HONEST ANSWER
#   It fast-forwards the checkout, because the migration files a deploy would
#   apply are bind-mounted from that checkout — there is no other way to read
#   them. It builds nothing, runs no migration, stops nothing and recreates
#   nothing. The running clinic is untouched; Git moves.
#
# RELATED: deploy-synology.sh (also in this repository) is the Container-Manager
#   era script: `git reset --hard` + `docker compose down` + `up -d --build` for
#   every service, which restarts Postgres too and costs the clinic more downtime
#   than a routine deploy needs. Use this one for routine deployments.
# =============================================================================

set -euo pipefail

# ssh on Synology starts a non-login shell whose PATH has no /usr/local/bin, so
# `docker` is simply absent and a probe would conclude the containers do not
# exist. Add the usual places — AFTER the inherited PATH, not before it: a
# binary the operator already resolves keeps winning. Measured on the clinic box
# 2026-11-11 (read-only): the inherited PATH is /usr/bin:/bin:/usr/sbin:/sbin,
# /usr/local/bin is the only new entry, and docker, git, curl, awk, date, sed,
# grep, tar, python3, node and psql each resolve to the same file either way.
# The ordering also matters here: the isolated tests (scripts/deployScript.test.mjs)
# put stubs for git, docker and curl first on PATH, and putting the real system
# directories ahead of them would make those tests drive the real binaries.
if [ -n "${PATH:-}" ]; then
  PATH="$PATH:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
else
  PATH="/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
fi
export PATH

# ── Configuration ────────────────────────────────────────────────────────────
DEPLOY_DIR="${DEPLOY_DIR:-/volume1/docker/care-erp-github/care-on-synology1}"
PROJECT_NAME="${PROJECT_NAME:-care-erp-github}"
LOG_DIR="${LOG_DIR:-/volume1/docker/care-deploy-logs}"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"

API_CONTAINER="care-api"
WEB_CONTAINER="care-web"
DB_CONTAINER="care-db"
MIGRATE_CONTAINER="care-db-patch-v2"

# Time the ERP gets, after the containers are recreated, to answer for real.
HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT_SECONDS:-180}"
# Backup freshness the schema gates insist on (see BACKUP POLICY above).
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
FRESH_BACKUP_MAX_AGE_MINUTES="${FRESH_BACKUP_MAX_AGE_MINUTES:-60}"

BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; NC=$'\033[0m'
info() { printf '%s▶%s %s\n' "$BOLD" "$NC" "$*"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$NC" "$*"; }

# The one exit path for every stop. Nobody should have to read a stack trace to
# know what happened: say what stopped, and what to do next.
#
# Once the containers have been recreated, every stop also prints the way back.
# Before the cutover there is nothing to roll back — the clinic is still running
# the images it was, and saying so is more useful than offering a rollback.
AFTER_CUTOVER=0
ROLLBACK_TAG=""
rollback_hint() {
  [ -n "$ROLLBACK_TAG" ] || return 0
  printf '  To go back to the previous images:\n'
  printf '    docker tag %s-api:%s %s-api:latest\n' "$PROJECT_NAME" "$ROLLBACK_TAG" "$PROJECT_NAME"
  printf '    docker tag %s-web:%s %s-web:latest\n' "$PROJECT_NAME" "$ROLLBACK_TAG" "$PROJECT_NAME"
  printf '    docker compose -p %s up -d --no-deps api web\n' "$PROJECT_NAME"
}
die() {
  printf '\n%s%s✗ DEPLOYMENT STOPPED%s\n' "$BOLD" "$RED" "$NC"
  printf '  %s\n' "$1"
  shift
  for line in "$@"; do printf '     %s\n' "$line"; done
  if [ "$AFTER_CUTOVER" = 1 ]; then echo ""; rollback_hint; fi
  printf '\n  Full log: %s\n\n' "$LOG"
  exit 1
}

# ── Arguments ────────────────────────────────────────────────────────────────
REHEARSE=0
TARGET_REF="origin/main"
TARGET_GIVEN=0
APPROVE_DESTRUCTIVE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check|--dry-run|--rehearse) REHEARSE=1 ;;
    --approve-destructive) shift; APPROVE_DESTRUCTIVE="${1:-}" ;;
    # Accepted so the automation can pass it; it skips no gate, because every
    # gate here either passes or stops the deploy — none of them asks a question.
    --yes|-y) ;;
    -h|--help) sed -n '2,45p' "$0"; exit 0 ;;
    *)
      if [ "$TARGET_GIVEN" = 0 ]; then
        TARGET_REF="$1"; TARGET_GIVEN=1
      else
        die "Unknown argument '$1'." \
          "Usage: deploy.sh [--check] [commit-or-branch] | --approve-destructive \"reason\""
      fi
      ;;
  esac
  shift
done

# ── Log: every run leaves a file an operator can be asked for on the phone ───
mkdir -p "$LOG_DIR" 2>/dev/null || { LOG_DIR="${TMPDIR:-/tmp}/care-deploy-logs"; mkdir -p "$LOG_DIR"; }
LOG="${LOG_DIR}/deploy-${RUN_ID}.log"
CHECK_OUT="${LOG_DIR}/migrations-check-${RUN_ID}.txt"

# ── Helpers ──────────────────────────────────────────────────────────────────
dc() { docker compose -p "$PROJECT_NAME" "$@"; }

# The published ERP port lives in .env. Read that one line, never the file — and
# note this is why the probes below work: docker compose interpolates
# ${HOST_PORT} itself, the old script probed a hard-coded :8080 that care-api has
# not published for months, so its health check could only ever time out.
host_port() {
  local p=""
  if [ -f .env ]; then
    p="$(sed -n 's/^HOST_PORT=//p' .env | tail -1 | tr -d '[:space:]')"
  fi
  printf '%s' "${p:-8888}"
}

# "commit":"abc123" out of a JSON body, without a JSON tool the NAS may not have.
# The key must follow `{` or `,`, so a value nested in `build:{…}` is found by
# name and a longer key that merely ENDS in the same word (there is
# `declaredGitCommit` alongside `commit` in this very payload) cannot match.
json_str()  { printf '%s' "$2" | sed -n "s/.*[,{][[:space:]]*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1; }
json_bool() { printf '%s' "$2" | sed -n "s/.*[,{][[:space:]]*\"$1\"[[:space:]]*:[[:space:]]*\(true\|false\).*/\1/p" | head -1; }

# One value out of the ERP database, through the container that already runs
# psql. SELECT only: a deploy script has no business writing to the clinic's
# data, and the database's own credentials stay inside its container.
db_val() {
  docker exec "$DB_CONTAINER" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$1"' _ "$1" \
    2>/dev/null | head -1
}

# The app's own backup ledger, read the same way the Backups page reads it.
VERIFIED_BACKUP_WHERE="
  WHERE j.backup_type IN ('FULL','DB') AND l.status = 'success'
    AND l.notes LIKE '%backupProof=v1%' AND l.notes LIKE '%outcome=verified%'"
backup_age_hours() {
  db_val "SELECT ROUND(EXTRACT(EPOCH FROM (now() - max(l.completed_at)))/3600, 2)::text
            FROM backup_job_logs l JOIN backup_jobs j ON j.id = l.job_id ${VERIFIED_BACKUP_WHERE};"
}
backup_when() {
  db_val "SELECT to_char(max(l.completed_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')
            FROM backup_job_logs l JOIN backup_jobs j ON j.id = l.job_id ${VERIFIED_BACKUP_WHERE};"
}

# awk, because shell arithmetic cannot divide and `bc` is not on the NAS.
older_than_hours()  { awk -v a="${1:-999999}" -v b="$2" 'BEGIN { exit !(a+0 > b+0) }'; }
older_than_minutes() { awk -v a="${1:-999999}" -v b="$2" 'BEGIN { exit !((a+0) * 60 > b+0) }'; }

main() {
  printf '%s═══════════════════════════════════════════════════════════%s\n' "$BOLD" "$NC"
  printf '  CARE ERP DEPLOYMENT%s\n' "$([ "$REHEARSE" = 1 ] && printf ' — %sREHEARSAL (no deploy)%s' "$YELLOW" "$NC")"
  printf '  Target : %s\n' "$TARGET_REF"
  printf '  Started: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf '%s═══════════════════════════════════════════════════════════%s\n\n' "$BOLD" "$NC"

  # ── 1/6 Environment ────────────────────────────────────────────────────────
  info "1/6  Environment"
  [ -d "$DEPLOY_DIR" ] || die "Checkout not found at $DEPLOY_DIR." \
    "This script is the NAS deploy path. If the checkout moved, set DEPLOY_DIR=/path/to/checkout."
  cd "$DEPLOY_DIR"
  command -v docker >/dev/null 2>&1 || die "docker is not on PATH even after this script adds /usr/local/bin." \
    "On Synology, Docker must be installed from Package Center (Container Manager) before a deploy can run."
  docker compose version >/dev/null 2>&1 || die "'docker compose' is not available."
  [ -f .env ] || die "No .env in $DEPLOY_DIR." \
    "Deploying without it would use the sample values in docker-compose.yml, which is worse than not deploying."

  # Two migrations at once is how a half-applied schema happens. The migration
  # container takes a database lock; this stops two operators on two terminals
  # from ever reaching it.
  if ! mkdir /tmp/care-deploy.lock 2>/dev/null; then
    die "Another deploy is already running." \
      "Its process id: $(cat /tmp/care-deploy.lock/pid 2>/dev/null || echo unknown)" \
      "If that deploy died mid-run and you have confirmed nothing is running:" \
      "  rmdir /tmp/care-deploy.lock"
  fi
  printf '%s' "$$" > /tmp/care-deploy.lock/pid
  trap 'rm -f /tmp/care-deploy.lock/pid; rmdir /tmp/care-deploy.lock 2>/dev/null || true' EXIT
  if [ -n "$(docker ps --filter "name=${MIGRATE_CONTAINER}" --filter status=running -q 2>/dev/null)" ]; then
    die "A migration container is running right now." \
      "Watch it finish rather than starting a second:  docker logs -f ${MIGRATE_CONTAINER}"
  fi
  ok "Environment ready (docker, compose, .env, no deploy in progress)"

  # ── 2/6 Record exactly what is deployed now ────────────────────────────────
  info "2/6  What is deployed now"
  PRE_SHA="$(git rev-parse HEAD)"
  ROLLBACK_TAG="rollback-${RUN_ID}"
  PRE_API_IMAGE="$(docker inspect --format '{{.Image}}' "$API_CONTAINER" 2>/dev/null || echo "-")"
  PRE_DB_STATE="$(docker inspect --format '{{.Id}} {{range .Mounts}}{{.Name}} {{end}}' "$DB_CONTAINER" 2>/dev/null || echo "-")"
  HOST_PORT_NO="$(host_port)"
  printf '     %-26s %s\n' "commit" "$PRE_SHA ($(git rev-parse --abbrev-ref HEAD))"
  printf '     %-26s %s\n' "care-api image" "${PRE_API_IMAGE:0:19}"
  printf '     %-26s %s\n' "care-db identity" "${PRE_DB_STATE:0:60}"
  printf '     %-26s %s\n' "ERP port" "$HOST_PORT_NO"

  # The tree must be clean or `merge --ff-only` lands in the middle of someone's
  # edit. One tracked file is exempt because this pipeline generates it:
  # care-schema-verify rewrites STARTUP_SCHEMA_VERIFICATION.md on every run, so a
  # deploy always leaves it dirty, and a gate that blocks on it would block on
  # itself. Anything else is a person's work and is never overwritten.
  local dirty
  dirty="$(git status --porcelain | grep -v '^ M STARTUP_SCHEMA_VERIFICATION\.md$' || true)"
  if [ -n "$dirty" ]; then
    printf '%s\n' "$dirty" | sed 's/^/     /'
    die "The checkout holds changes that are not this script's own output (listed above)." \
      "A deploy never overwrites hand work. Commit it, or move it aside, then run again." \
      "Do not reach for 'git clean -fd' or 'git reset --hard' to make the message go away."
  fi
  cp STARTUP_SCHEMA_VERIFICATION.md "${LOG_DIR}/schema-report-before-${RUN_ID}.md" 2>/dev/null || true
  ok "Working tree clean (the generated schema report is set aside in the log dir)"

  # ── 3/6 What would this deploy apply? ──────────────────────────────────────
  info "3/6  Code and migrations to apply"
  git fetch --quiet origin
  if ! git merge --ff-only "$TARGET_REF" >/dev/null; then
    die "Cannot fast-forward to $TARGET_REF." \
      "The checkout has diverged from it, or that ref does not exist. Nothing was built or restarted." \
      "Look with:  git -C $DEPLOY_DIR status ; git -C $DEPLOY_DIR log --oneline -5"
  fi
  POST_SHA="$(git rev-parse HEAD)"
  if [ "$POST_SHA" = "$PRE_SHA" ]; then
    ok "Already at $TARGET_REF ($(git rev-parse --short HEAD)) — no new code"
  else
    ok "$(git rev-parse --short "$PRE_SHA") → $(git rev-parse --short "$POST_SHA")  $(git log --format=%s -1)"
    printf '     %s commit(s), %s file(s) changed\n' \
      "$(git rev-list --count "$PRE_SHA".."$POST_SHA")" \
      "$(git diff --name-only "$PRE_SHA".."$POST_SHA" | wc -l | tr -d ' ')"
  fi

  # Ask the migration container. `--check` reports without acquiring the lock,
  # writing the ledger or executing a single statement, and it answers with the
  # same verdict the real run would reach.
  #
  # --no-deps matters here: compose would otherwise be free to start the `db`
  # service to satisfy `depends_on`. care-db is already running in this clinic,
  # and a code deploy must never be the thing that touches it. If it is NOT
  # running, the check simply cannot connect and stops the deploy below — which
  # is the right answer, not a surprise database start.
  local check_rc=0
  dc run --rm -T --no-deps db-patch-v2 --check >"$CHECK_OUT" 2>&1 || check_rc=$?
  if [ "$check_rc" -ne 0 ]; then
    sed -n '1,30p' "$CHECK_OUT" | sed 's/^/     /'
    case "$check_rc" in
      12) die "An applied migration file no longer matches what this database ran." \
              "The real run would stop on this too — it means the commit edits history, not that the deploy is broken." \
              "Revert the edit and deploy again. See docs/HOW_TO_ADD_DB_MIGRATIONS.md." ;;
      13) die "No migration files were found at all." \
              "That is a broken bind mount, not an empty deploy. Check ./lib/db/drizzle and ./migrations exist in $DEPLOY_DIR." ;;
      *)  die "The migration pre-flight could not complete (exit ${check_rc})." \
              "An unchecked database is never a green light, so nothing has been deployed." \
              "Read the output above; the usual cause is care-db not being healthy yet." ;;
    esac
  fi
  local verdict pending changed schema_changing destructive ledger fresh_install
  verdict="$(sed -n 's/^CHECK_VERDICT //p' "$CHECK_OUT" | head -1)"
  pending="$(printf '%s' "$verdict" | sed -n 's/.*pending=\([0-9][0-9]*\).*/\1/p')"
  changed="$(printf '%s' "$verdict" | sed -n 's/.*changed=\([0-9][0-9]*\).*/\1/p')"
  # 'pending=all' (no ledger yet) has no number, and no number means "run it".
  [ -n "$pending" ] || pending=1
  [ -n "$changed" ] || changed=0
  schema_changing="$(sed -n 's/^CHECK_SCHEMA_CHANGING //p' "$CHECK_OUT" | head -1)"
  destructive="$(sed -n 's/^CHECK_DESTRUCTIVE //p' "$CHECK_OUT" | head -1)"
  ledger="$(sed -n 's/^CHECK_LEDGER //p' "$CHECK_OUT" | head -1)"
  # Silence is not "up to date". Every gate below reads one of these four lines,
  # so a check that exits 0 without printing them would have the script decide a
  # production migration from nothing. The verdict lines are the contract between
  # this script and docker/db-patch-entrypoint.sh; if one is absent, stop.
  local missing=""
  [ -n "$verdict" ]         || missing="$missing CHECK_VERDICT"
  [ -n "$schema_changing" ] || missing="$missing CHECK_SCHEMA_CHANGING"
  [ -n "$destructive" ]     || missing="$missing CHECK_DESTRUCTIVE"
  [ -n "$ledger" ]          || missing="$missing CHECK_LEDGER"
  if [ -n "$missing" ]; then
    sed -n '1,20p' "$CHECK_OUT" | sed 's/^/     /'
    die "The migration check exited ${check_rc} but printed no verdict (missing:${missing})." \
      "Nothing has been deployed. This script and docker/db-patch-entrypoint.sh ship in the same commit — an output without those lines means the container ran a different entrypoint than the one in $DEPLOY_DIR/docker/."
  fi
  fresh_install=0
  if [ "$ledger" = "absent" ] || printf '%s' "$verdict" | grep -q 'pending=all'; then fresh_install=1; fi

  ok "Checked database $(sed -n 's/^CHECK_DATABASE //p' "$CHECK_OUT" | head -1) (identity: $(sed -n 's/^CHECK_IDENTITY //p' "$CHECK_OUT" | head -1))"
  printf '     %s\n' "${verdict:-no verdict line}"
  if [ "$pending" = "0" ]; then
    ok "Nothing pending — the migration container will not be run"
  else
    warn "${pending} migration(s) would be applied:"
    sed -n 's/^CHECK_PENDING /     /p' "$CHECK_OUT" | head -20
    [ "$changed" = "0" ] || warn "${changed} applied file(s) changed — the real run stops on those"
  fi

  # ── 4/6 Backup evidence, only when the schema is at stake ──────────────────
  info "4/6  Backup evidence"
  if [ "$pending" = "0" ]; then
    ok "No migration to apply, so no backup is required for this deploy"
  elif [ "$fresh_install" = "1" ]; then
    warn "This database has never been migrated by care-db-patch-v2 — treated as a fresh install, so there is nothing to back up first."
    warn "If that is wrong and this is a live database reached by another path, STOP now and check CHECK_IDENTITY in $CHECK_OUT."
  else
    local age when
    age="$(backup_age_hours || true)"
    when="$(backup_when || true)"
    if [ "$destructive" = "yes" ]; then
      # Data that a restore would not win back. This is the one case where the
      # nightly job is not enough: the backup must be taken for THIS deploy, and
      # a person must say so in words that end up in the log.
      printf '     newest verified database backup: %s\n' "${when:-none}"
      if [ "$REHEARSE" = 1 ]; then
        warn "Rehearsal: destructive migration detected — a real run would require a fresh verified backup and --approve-destructive."
      else
        if [ -z "$age" ] || older_than_minutes "$age" "$FRESH_BACKUP_MAX_AGE_MINUTES"; then
          die "A pending migration drops or rewrites data, and the newest VERIFIED backup is '${when:-none}' (limit: ${FRESH_BACKUP_MAX_AGE_MINUTES} minutes)." \
            "Take one now, in the ERP: Backups page → the DB job → Run now, and wait for it to report verified." \
            "Then run this command again. Nothing has been deployed."
        fi
        if [ -z "$APPROVE_DESTRUCTIVE" ]; then
          printf '\n     Lines in the pending migration that make it destructive:\n'
          sed -n 's/^CHECK_DESTRUCTIVE_EVIDENCE /       /p' "$CHECK_OUT" | head -25
          die "A destructive migration needs the operator's approval in words." \
            "Read the lines above, and if this is what the migration is meant to do:" \
            "  $0 --approve-destructive \"why this is safe\"" \
            "Nothing has been deployed. The backup gate passed (${when}, ${age}h old)."
        fi
        warn "DESTRUCTIVE MIGRATION APPROVED: $APPROVE_DESTRUCTIVE"
      fi
    elif [ "$schema_changing" = "yes" ]; then
      if [ -z "$age" ]; then
        die "This deploy changes the schema, but no VERIFIED database backup could be read from the ERP's own job log." \
          "Expected: the nightly encrypted backup, decrypt-verified and recorded in backup_job_logs." \
          "Take one from the Backups page (or wait for tonight's job) and run this again."
      fi
      printf '     newest verified database backup: %s (%sh old, limit %sh)\n' "$when" "$age" "$BACKUP_MAX_AGE_HOURS"
      if older_than_hours "$age" "$BACKUP_MAX_AGE_HOURS"; then
        die "The backup is older than ${BACKUP_MAX_AGE_HOURS}h, so it does not cover today's patients." \
          "Take a backup from the Backups page, wait for it to report verified, then run this again." \
          "The limit is yours to change if you have a different restore plan: BACKUP_MAX_AGE_HOURS=…"
      fi
      ok "Schema-changing deploy is covered by a verified backup"
    else
      ok "Pending migrations change no schema — no backup required"
    fi
  fi

  # ── 5/6 Rehearsal stops here ───────────────────────────────────────────────
  info "5/6  What a real run would do"
  local free_gb
  free_gb="$(df -Pm "$DEPLOY_DIR" | awk 'NR==2 { printf "%.1f", $4/1024 }' 2>/dev/null || echo "")"
  [ -n "$free_gb" ] && printf '     free space: %s GB\n' "$free_gb"
  printf '     build   : api, web, schema-verify\n'
  printf '     migrate : %s\n' "$([ "$pending" = 0 ] && echo 'skipped (nothing pending)' || echo "$pending file(s)")"
  printf '     verify  : schema-verify, always\n'
  printf '     restart : %s and %s only (--no-deps; never %s)\n' "$API_CONTAINER" "$WEB_CONTAINER" "$DB_CONTAINER"
  printf '     confirm : /api/health reports commit %s, plus %s/erp/\n' "${POST_SHA:0:12}" "http://127.0.0.1:${HOST_PORT_NO}"
  if [ "$REHEARSE" = 1 ]; then
    printf '\n%s═══════════════════════════════════════════════════════════%s\n' "$BOLD" "$NC"
    ok "REHEARSAL COMPLETE — nothing was built, migrated, restarted or stopped"
    printf '  The checkout moved %s → %s so the migration files could be read.\n' \
      "$(git rev-parse --short "$PRE_SHA")" "$(git rev-parse --short "$POST_SHA")"
    printf '  The clinic is still running the images from %s (that is what the containers hold, not Git).\n' "$(git rev-parse --short "$PRE_SHA")"
    printf '  To deploy for real:  %s\n\n' "$0"
    return 0
  fi

  # ── 6/6 Pin the rollback, then build ───────────────────────────────────────
  info "6/6  Pinning rollback tags"
  if [ "$PRE_API_IMAGE" != "-" ]; then
    docker tag "${PROJECT_NAME}-api:latest" "${PROJECT_NAME}-api:${ROLLBACK_TAG}" \
      || warn "Could not tag the current api image — rollback by tag will not be possible"
    docker tag "${PROJECT_NAME}-web:latest" "${PROJECT_NAME}-web:${ROLLBACK_TAG}" \
      || warn "Could not tag the current web image — rollback by tag will not be possible"
    ok "Rollback pinned: ${PROJECT_NAME}-{api,web}:${ROLLBACK_TAG}"
  else
    warn "No ${API_CONTAINER} is running: first deploy, so there is nothing to roll back to"
    ROLLBACK_TAG=""
  fi

  echo ""
  info "Building (2-5 minutes; the clinic keeps running on the current images)"
  # db-patch-v2 is not built: it is the plain postgres:16-alpine image with this
  # repository's migration files bind-mounted read-only, so the checkout move in
  # step 3 is what updates it.
  if ! dc build api web schema-verify; then
    die "The build failed, so NOTHING was deployed and the ERP was never restarted." \
      "The clinic is still serving $(printf '%.12s' "$PRE_SHA") — that is the container's image, not Git, so leave the checkout where it is." \
      "Fix the build and run this script again; it will pick up from the top."
  fi
  ok "Build complete"

  # ── Migrations ─────────────────────────────────────────────────────────────
  echo ""
  if [ "$pending" = "0" ]; then
    ok "Migrations skipped — the ledger already holds these exact checksums"
  else
    info "Applying ${pending} migration(s)…"
    if ! dc run --rm --no-deps db-patch-v2; then
      die "The migration failed. No container was restarted, so the clinic is still running $(printf '%.12s' "$PRE_SHA")." \
        "The checkout is at $(printf '%.12s' "$POST_SHA") and that is correct — Git is not what is serving the clinic, so leave it alone. Do NOT 'git reset --hard' to undo a migration: the database is not tracked by Git." \
        "Read the output above. care-db-patch-v2 stops BEFORE recording anything it could not apply, and it reverses a part-applied file on its own, so the database is left at a whole migration either way." \
        "The fix is forward: correct or replace the migration in a new commit and deploy again. Never reverse an applied migration by hand — docs/HOW_TO_ADD_DB_MIGRATIONS.md explains how."
    fi
    ok "Migrations applied"
  fi

  # ── Schema verification: read-only, and it runs on every deploy ────────────
  echo ""
  info "Verifying the live schema against every migration file (read-only)…"
  if ! dc run --rm --no-deps schema-verify; then
    die "Schema verification reported drift between the migration files and the live database." \
      "Nothing has been restarted yet, so the clinic is untouched." \
      "Read the detail in $DEPLOY_DIR/STARTUP_SCHEMA_VERIFICATION.md, then either fix the migration or, if this drift is known and reviewed, deploy with the verification gate addressed — never by editing the database by hand."
  fi
  ok "Schema verified"

  # ── Cutover: the only downtime ─────────────────────────────────────────────
  echo ""
  info "Restarting ${API_CONTAINER} and ${WEB_CONTAINER} — downtime starts now"
  T_CUTOVER=$(date +%s)
  # From here on the clinic is running whatever the last command installed, so
  # every failure has to come with the rollback commands in it.
  AFTER_CUTOVER=1
  # --no-deps is the whole point: recreating api and web must not cascade into
  # the database, the cache or the PACS stack.
  dc up -d --no-deps api web

  # ── Verify: both containers, then the endpoints the clinic actually opens ────
  echo ""
  info "Waiting for the ERP to answer (up to ${HEALTH_TIMEOUT}s)"
  state_line() {
    docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
      "$API_CONTAINER" "$WEB_CONTAINER" 2>/dev/null || true
  }
  healthy_count() { state_line | grep -c '^running \(healthy\|none\)$' || true; }
  last_state="$(state_line | tr '\n' ' ')"
  waited=0
  while [ "$(healthy_count)" -lt 2 ] && [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    sleep 5; waited=$((waited + 5))
    last_state="$(state_line | tr '\n' ' ')"
    printf '  … %ss  %s\n' "$waited" "$last_state"
  done
  if [ "$(healthy_count)" -lt 2 ]; then
    # Both containers must come up. A healthy api beside an nginx that never
    # started is a brown-out the clinic still experiences as "the ERP is down".
    die "${API_CONTAINER} and/or ${WEB_CONTAINER} did not become healthy within ${HEALTH_TIMEOUT}s (last: ${last_state:-unknown})." \
      "Logs:  docker logs --tail 60 $API_CONTAINER ;  docker logs --tail 60 $WEB_CONTAINER"
  fi
  ok "Containers healthy after ${waited}s"

  base="http://127.0.0.1:${HOST_PORT_NO}"
  if ! curl -fsS --max-time 10 -o /dev/null "${base}/nginx-health"; then
    die "${base}/nginx-health did not answer, so the web container is not serving the clinic."
  fi
  ok "web/nginx answers on port ${HOST_PORT_NO}"
  # /api/healthz is api + database: nginx reached care-api, and care-api reached
  # care-db. It answers 503 while the app is still starting, which is why the
  # loop above waited for the container health first.
  if ! curl -fsS --max-time 15 -o /dev/null "${base}/api/healthz"; then
    die "${base}/api/healthz is not OK — the API or its database is unhealthy even though the containers report healthy." \
      "docker logs --tail 80 $API_CONTAINER"
  fi
  ok "api + database healthy (/api/healthz)"

  body="$(curl -fsS --max-time 10 "${base}/api/health" || true)"
  commit="$(json_str commit "$body")"
  stale="$(json_bool staleStampDetected "$body")"
  if [ -z "$commit" ]; then
    die "/api/health did not report a commit, so the running version cannot be confirmed." \
      "Body: ${body:0:240}"
  fi
  info "Running commit reported by the API: ${commit}   (intended: ${POST_SHA:0:12})"
  case "${POST_SHA}" in
    "$commit"*) ok "Verified: the running code is the commit this script deployed" ;;
    *)
      die "The API reports ${commit} but this deploy intended ${POST_SHA:0:12}: the containers are not the images that were just built." \
        "Check:  docker inspect --format '{{.Config.Image}} {{.Image}}' $API_CONTAINER $WEB_CONTAINER" ;;
  esac
  if [ "$stale" = "true" ]; then
    # The image carries an identity it cannot prove came from this build context.
    # The commit matched above, so the code is right; say so, and do not hide it.
    warn "The API flagged its own build identity as stale (staleStampDetected=true)."
    warn "Investigate before the next deploy — docs/DEPLOYMENT.md explains how an image can outlive its stamp."
  fi

  # The SPA is what the radiologists open; a healthy API behind a broken /erp/ is
  # still an outage.
  if ! curl -fsS --max-time 10 -o /dev/null "${base}/erp/"; then
    die "${base}/erp/ did not answer although the API is healthy." \
      "docker logs --tail 60 $WEB_CONTAINER"
  fi
  ok "ERP UI served at ${base}/erp/"

  # The database must be the container it was, on the volume it was.
  db_now="$(docker inspect --format '{{.Id}} {{range .Mounts}}{{.Name}} {{end}}' "$DB_CONTAINER" 2>/dev/null || echo "-")"
  if [ "$db_now" != "$PRE_DB_STATE" ]; then
    warn "${DB_CONTAINER} is NOT the container this deploy started with:"
    printf '     before: %s\n     after : %s\n' "$PRE_DB_STATE" "$db_now"
    warn "This script never names the db service, so look for another actor (Container Manager, a DSM update, a reboot) — and confirm the data volume is the same one."
  else
    ok "${DB_CONTAINER} untouched — same container, same volume"
  fi
  printf '     restart counts (api web): %s\n' "$(docker inspect --format '{{.RestartCount}}' "$API_CONTAINER" "$WEB_CONTAINER" 2>/dev/null | tr '\n' ' ')"

  echo ""
  printf '%s═══════════════════════════════════════════════════════════%s\n' "$BOLD" "$NC"
  printf '%s  ✓ DEPLOYMENT COMPLETE%s\n' "$GREEN" "$NC"
  printf '  Commit     : %s  %s\n' "${POST_SHA:0:12}" "$(git log --format=%s -1)"
  printf '  Downtime   : %ss to healthy\n' "$(( $(date +%s) - T_CUTOVER ))"
  printf '  Migrations : %s\n' "$([ "$pending" = 0 ] && echo 'none pending' || echo "$pending applied")"
  printf '  Rollback   : %s\n' "${ROLLBACK_TAG:-(first deploy — nothing pinned)}"
  printf '  Log        : %s\n' "$LOG"
  printf '%s═══════════════════════════════════════════════════════════%s\n\n' "$BOLD" "$NC"
  rollback_hint
  printf '\nThe checkout now holds the deployed commit. Rolling the IMAGES back leaves\nGit ahead of what is running, which is deliberate: a forward fix is a new commit.\n\n'
}

main "$@" 2>&1 | tee "$LOG"
exit "${PIPESTATUS[0]}"
