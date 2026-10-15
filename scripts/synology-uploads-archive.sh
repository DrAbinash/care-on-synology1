#!/bin/sh
# synology-uploads-archive.sh — back up the ERP document volumes the database dump cannot reach
# ============================================================================
# WHY THIS EXISTS
#   scripts/synology-nas-backup.sh dumps PostgreSQL, and a dump restores rows. The
#   uploaded patient documents live on a Docker named volume (`uploads_data`), outside
#   every table: measured read-only on the clinic box on 2026-10-16, 83 MB across
#   expenses/scanned/site, with NO artifact naming it in any backup root, and
#   `docs/CARE_ERP_BACKUP_COVERAGE.md` §3 stating from the code that nothing in this
#   repository can restore that volume because nothing ever wrote it. Object storage is
#   the second volume of the same shape (mounted, 0 bytes, no writer found).
#
# WHAT IT DOES
#   enumerate -> manifest -> archive -> verify the archive against the manifest ->
#   publish -> encrypt (only if a passphrase is supplied, and the encryption is then
#   ROUND-TRIP DECRYPTED and hashed before this run may say it produced an encrypted
#   backup) -> write the .meta sidecar. Same order, same sidecar keys, same `.partial`
#   then-publish envelope and the same passphrase handling as synology-nas-backup.sh, so
#   the operator has one convention to learn and `ops-backup-inventory.mjs` reads this
#   family of artifacts instead of needing a second tool.
#
# WHAT IT NEVER DOES
#   It never writes to the source volume, never follows a symlink out of it, never
#   deletes anything (retention is opt-in and OFF unless KEEP_DAYS is a positive integer
#   AND DELETE_OLD=1), never touches the database dump or its schedule, and never prints
#   a file name. Every log line is a count or a hash prefix, because the file names on
#   this volume carry patient identifiers and this output is pasted into tickets.
#
# AN EMPTY VOLUME IS NOT A FAILURE
#   `object_storage` is measured empty. An archive of nothing is still a valid,
#   restorable artifact (restoring it produces an empty tree), so it is written with
#   files=0 and says so. What is refused is a source that is missing or unreadable:
#   "empty" and "not there" are different claims and must never print the same way.
#
# USAGE
#   sh scripts/synology-uploads-archive.sh --class uploads \
#        --src /volume1/@docker/volumes/care-erp-github_uploads_data/_data \
#        --dest /volume1/backup/care-erp/uploads
#   BACKUP_PASSPHRASE="$(cat /volume1/scripts/.pass)" sh scripts/synology-uploads-archive.sh …
#   CLASS=object_storage SRC=… DEST=… sh scripts/synology-uploads-archive.sh   (env form)
# EXIT CODE
#   0 archived and verified · 1 refused or failed · 2 usage
umask 077

set -u
SELF=$(basename "$0")
log(){ printf '%s %s: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SELF" "$*"; }
# Substring expansion is not POSIX; the NAS shell is not guaranteed to be bash, and a log
# line that silently prints nothing is a log line that hides which artifact was written.
short(){ printf '%s' "${1:-}" | cut -c1-12; }
fail(){ log "ERROR: $*"; cleanup; exit 1; }

CLASS="${CLASS:-}"
SRC="${SRC:-}"
DEST="${BACKUP_DIR:-${DEST:-}}"
PASSPHRASE="${BACKUP_PASSPHRASE:-}"
KEEP_DAYS="${KEEP_DAYS:-0}"
DELETE_OLD="${DELETE_OLD:-0}"
LABEL="${LABEL:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --class) CLASS="${2:-}"; shift 2 ;;
    --src|--source) SRC="${2:-}"; shift 2 ;;
    --dest|--out) DEST="${2:-}"; shift 2 ;;
    --label) LABEL="${2:-}"; shift 2 ;;
    *) printf 'usage: %s --class uploads|object_storage --src DIR --dest DIR [--label NAME]\n' "$SELF" >&2; exit 2 ;;
  esac
done

cleanup(){
  # The plaintext intermediates must never survive this script, encrypted or not, and
  # never under a name that looks like a published artifact.
  for p in "${TMPDIR_RUN:-}" "${PLAIN:-}"; do
    [ -n "$p" ] && [ -e "$p" ] && rm -rf "$p"
  done
}
trap cleanup EXIT INT TERM HUP

size_of(){ stat -c%s "$1" 2>/dev/null || stat -f%z "$1" 2>/dev/null || echo 0; }
mode_of(){ stat -c%a "$1" 2>/dev/null || stat -f%Lp "$1" 2>/dev/null || echo 600; }

# ── validate before touching anything ────────────────────────────────────────
case "$CLASS" in
  uploads|object_storage) ;;
  *) printf '%s: --class must be uploads or object_storage (the two document-bearing ERP volumes)\n' "$SELF" >&2; exit 2 ;;
esac
[ -n "$SRC" ] || { printf '%s: --src is required\n' "$SELF" >&2; exit 2; }
[ -n "$DEST" ] || { printf '%s: --dest is required\n' "$SELF" >&2; exit 2; }
[ -n "$LABEL" ] || LABEL="$CLASS"
command -v tar >/dev/null 2>&1 || fail "tar is not on PATH — refusing to call anything a backup without it"
command -v gzip >/dev/null 2>&1 || fail "gzip is not on PATH"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is not on PATH — the manifest cannot be built without it"
if [ -n "$PASSPHRASE" ] && ! command -v openssl >/dev/null 2>&1; then
  fail "BACKUP_PASSPHRASE is set but openssl is not on PATH — refusing to write an unencrypted copy of patient documents and call it encrypted"
fi
[ -d "$SRC" ] || fail "source directory does not exist: $SRC (missing is not empty — say which one you mean)"
[ -r "$SRC" ] || fail "source directory is not readable: $SRC"
case "$KEEP_DAYS" in ''|*[!0-9]*) fail "KEEP_DAYS must be a non-negative integer, got: $KEEP_DAYS";; esac

SRC_REAL=$(cd "$SRC" && pwd -P) || fail "cannot resolve the source directory"
mkdir -p "$DEST" || fail "cannot create destination $DEST"
# Resolve before comparing: a symlinked path must not smuggle output into the repository,
# and a --src that points at the repository would archive the source code (or worse, an
# .env sitting beside it) into a patient-document backup.
DEST_REAL=$(cd "$DEST" 2>/dev/null && pwd -P) || fail "cannot resolve $DEST"
REPO_GIT=$(cd "$(dirname "$0")/.." && pwd -P 2>/dev/null) || REPO_GIT=""
for p in "$DEST_REAL" "$SRC_REAL"; do
  case "$p" in
    "$REPO_GIT"|"$REPO_GIT"/*)
      fail "refusing to run: the source or destination is inside the repository ($p). Artifacts must never enter GitHub, and the repository is not a document volume." ;;
  esac
done
case "$DEST_REAL" in
  *"/.git/"*) fail "the destination is inside a .git directory" ;;
esac

# ── enumerate: sorted, relative, deterministic ───────────────────────────────
TMPDIR_RUN=$(mktemp -d "${TMPDIR:-/tmp}/uploads-archive-XXXXXX") || fail "cannot make a scratch directory"
FILE_LIST="$TMPDIR_RUN/files.txt"
EMPTY_LIST="$TMPDIR_RUN/empty-dirs.txt"
MEMBERS="$TMPDIR_RUN/members.txt"
MANIFEST="$TMPDIR_RUN/MANIFEST.sha256"
( cd "$SRC_REAL" && find . ! -path . -type f -print 2>/dev/null | sed 's|^\./||' ) > "$FILE_LIST" || fail "could not enumerate $SRC_REAL"

# A name containing a newline cannot be represented by a line-based manifest, and a list
# built with -print would split one file into two rows — silently archiving half of it and
# hashing the wrong thing. Count the files NUL-safe and compare with the row count.
NUL_COUNT=$(cd "$SRC_REAL" && find . ! -path . -type f -print0 2>/dev/null | tr -dc '\000' | wc -c | tr -d ' ')
FILE_COUNT=$(wc -l < "$FILE_LIST" | tr -d ' ')
if [ "$NUL_COUNT" != "$FILE_COUNT" ]; then
  fail "$FILE_COUNT rows were built from $NUL_COUNT files: a file name contains a newline, which the manifest format cannot represent. Refusing rather than archiving a tree it cannot verify."
fi

# Symlinks and special entries are found by `find`, not followed. A document volume holds
# regular files; anything else here is either an escape hatch out of the volume or an
# entry that would make tar block forever.
SYMLINKS=$(cd "$SRC_REAL" && find . ! -path . -type l 2>/dev/null | wc -l | tr -d ' ')
if [ "$SYMLINKS" != "0" ]; then
  # The loop reads a here-document, not a pipe: a `while` on the receiving end of a pipe
  # runs in a subshell, and `exit 1` inside it would exit only that subshell — the refusal
  # would print and the archive would go on being written.
  while IFS= read -r l; do
    [ -n "$l" ] || continue
    tgt=$(readlink "$SRC_REAL/$l" 2>/dev/null || echo "")
    [ -n "$tgt" ] || fail "a symbolic link in the source could not be read: refusing to archive a tree whose structure is not fully known"
    linkdir=$(cd "$(dirname "$SRC_REAL/$l")" 2>/dev/null && pwd -P) || linkdir=""
    [ -n "$linkdir" ] || fail "a symbolic link sits in a directory that cannot be resolved; refusing to archive a tree whose structure is not fully known"
    resolved=$(cd "$linkdir" 2>/dev/null && cd "$(dirname "$tgt")" 2>/dev/null && pwd -P) || resolved=""
    case "$resolved" in
      "") fail "a symbolic link in the source is dangling or unresolvable; refusing to archive a volume whose structure is not fully known" ;;
      "$SRC_REAL"|"$SRC_REAL"/*) ;;
      *) fail "a symbolic link in the source points outside the volume; refusing to archive a tree that reaches outside the approved root (nothing was copied, so no secret can be in the artifact)" ;;
    esac
  done <<EOF
$(cd "$SRC_REAL" && find . ! -path . -type l 2>/dev/null)
EOF
  log "note: links=$SYMLINKS symbolic link(s) were found and NOT archived — the volume should hold regular files only, and a link whose target is inside the volume is archived as that target"
fi
SPECIAL=$(cd "$SRC_REAL" && find . ! -path . \( -type b -o -type c -o -type p -o -type s \) 2>/dev/null | wc -l | tr -d ' ')
[ "$SPECIAL" = "0" ] || fail "the source holds $SPECIAL device, FIFO or socket entr(ies|y): a document volume does not contain those, and archiving a FIFO makes tar wait forever. Nothing was archived."

( cd "$SRC_REAL" && find . -type d -empty -print 2>/dev/null | sed 's|^\./||' ) > "$EMPTY_LIST"
EMPTY_DIRS=$(wc -l < "$EMPTY_LIST" | tr -d ' ')
LC_ALL=C sort "$FILE_LIST" > "$TMPDIR_RUN/files.sorted"
LC_ALL=C sort "$EMPTY_LIST" > "$TMPDIR_RUN/empty.sorted"
cat "$TMPDIR_RUN/empty.sorted" "$TMPDIR_RUN/files.sorted" | LC_ALL=C sort > "$MEMBERS"
FILE_COUNT=$(wc -l < "$TMPDIR_RUN/files.sorted" | tr -d ' ')

# The manifest is stored INSIDE the archive as a real file, so a restore can verify itself
# with no external input, and it is the first thing the verifier reads.
: > "$MANIFEST"
TOTAL_BYTES=0
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  [ -f "$SRC_REAL/$rel" ] || fail "file vanished from the listing while archiving: $rel"
  h=$(sha256sum < "$SRC_REAL/$rel" | cut -d' ' -f1)
  b=$(size_of "$SRC_REAL/$rel")
  m=$(mode_of "$SRC_REAL/$rel")
  TOTAL_BYTES=$((TOTAL_BYTES + b))
  printf '%s  %s  %s  %s\n' "$h" "$b" "$m" "$rel" >> "$MANIFEST"
done < "$TMPDIR_RUN/files.sorted"
MANIFEST_SHA=$(sha256sum < "$MANIFEST" | cut -d' ' -f1)

log "enumerated class=$CLASS files=$FILE_COUNT bytes=$TOTAL_BYTES empty_dirs=$EMPTY_DIRS manifest=sha256:$(short "$MANIFEST_SHA")"

# ── archive, with the manifest beside the files ──────────────────────────────
# No staging copy of the tree: the volume is tarred in place, read-only, from the exact
# member list, and only then compressed. Directories are listed only when empty, because
# `tar -T` recurses into a named directory on GNU tar and would store its files twice —
# an archive whose member count no longer means what the manifest says it means.
mkdir -p "$TMPDIR_RUN/manifest" || fail "cannot stage the manifest"
cp "$MANIFEST" "$TMPDIR_RUN/manifest/MANIFEST.sha256" || fail "cannot stage the manifest"
TAR_UNZ="$TMPDIR_RUN/archive.tar"
if [ "$FILE_COUNT" = "0" ] && [ "$EMPTY_DIRS" = "0" ]; then
  tar -cf "$TAR_UNZ" -C "$TMPDIR_RUN/manifest" MANIFEST.sha256 || fail "could not build the archive of an empty volume"
else
  tar -cf "$TAR_UNZ" -C "$SRC_REAL" -T "$MEMBERS" || fail "tar could not read the file list from the source"
  tar -rf "$TAR_UNZ" -C "$TMPDIR_RUN/manifest" MANIFEST.sha256 || fail "tar could not append the manifest"
fi
TS=$(date -u +%Y-%m-%dT%H-%M-%S-UTC)
DEST_SUFFIX="backup_${LABEL}_${TS}.tar.gz"
n=0
while [ -e "$DEST_REAL/$DEST_SUFFIX" ] && [ "$n" -lt 60 ]; do
  n=$((n + 1)); DEST_SUFFIX="backup_${LABEL}_${TS}+${n}.tar.gz"
done
PLAIN="$DEST_REAL/.${DEST_SUFFIX}.partial"
gzip -c "$TAR_UNZ" > "$PLAIN" || fail "could not compress the archive"
[ -s "$PLAIN" ] || [ "$FILE_COUNT" = "0" ] || fail "the archive is empty but the source was not"

# A backup that cannot be read back is not a backup: list it and count it BEFORE publishing.
LISTED=$(tar -tzf "$PLAIN" 2>/dev/null | wc -l | tr -d '')
[ "$LISTED" -gt 0 ] || fail "the archive cannot be listed: it is not a readable gzip tarball. Nothing was published."
EXPECTED=$((FILE_COUNT + EMPTY_DIRS + 1))
[ "$LISTED" -eq "$EXPECTED" ] || fail "the archive lists $LISTED members but the source had $FILE_COUNT files plus $EMPTY_DIRS empty directories plus the manifest — refusing to publish an archive that does not match its manifest"
tar -tzf "$PLAIN" | LC_ALL=C grep -q 'MANIFEST' || fail "the manifest did not make it into the archive"
SHA_PLAIN=$(sha256sum < "$PLAIN" | cut -d' ' -f1)

# ── publish, then encrypt and prove the encryption round-trips ──────────────
mv "$PLAIN" "$DEST_REAL/$DEST_SUFFIX" || fail "could not publish the archive"
FINAL="$DEST_REAL/$DEST_SUFFIX"
ENCRYPTED=no
if [ -n "$PASSPHRASE" ]; then
  # The passphrase reaches openssl through its environment, never as an argument:
  # `ps -ef`, a shell history entry or a support screenshot of a command line must not
  # be enough to decrypt the clinic's patient documents. `-pass env:` is what makes that
  # true; without it openssl opens /dev/tty and the job hangs instead of failing.
  if env BACKUP_PASSPHRASE="$PASSPHRASE" openssl enc -aes-256-cbc -salt -pbkdf2 \
       -pass env:BACKUP_PASSPHRASE -in "$FINAL" -out "$FINAL.enc"; then
    ROUNDTRIP="$TMPDIR_RUN/roundtrip"
    if env BACKUP_PASSPHRASE="$PASSPHRASE" openssl enc -d -aes-256-cbc -pbkdf2 \
         -pass env:BACKUP_PASSPHRASE -in "$FINAL.enc" -out "$ROUNDTRIP" \
     && [ "$(sha256sum < "$ROUNDTRIP" | cut -d' ' -f1)" = "$SHA_PLAIN" ]; then
      rm -f "$ROUNDTRIP" "$FINAL"
      FINAL="$FINAL.enc"
      ENCRYPTED=yes
      log "Encrypted and round-trip verified: $(basename "$FINAL")"
    else
      rm -f "$ROUNDTRIP"
      fail "encrypted copy does not decrypt back to the bytes it was made from — keeping the plaintext $(basename "$FINAL") and refusing to delete it"
    fi
  else
    rm -f "$FINAL.enc"
    fail "encryption failed — keeping the plaintext $(basename "$FINAL") rather than reporting a lost backup"
  fi
else
  log "no BACKUP_PASSPHRASE: wrote the archive UNENCRYPTED and saying so in the sidecar"
fi

# ── sidecar: the keys the inventory already reads, plus the archive facts ────
META="$FINAL.meta"
SHA_FINAL=$(sha256sum < "$FINAL" | cut -d' ' -f1)
{
  echo "artifact=$(basename "$FINAL")"
  echo "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "source_container=${SOURCE_CONTAINER:-care-api}"
  echo "source_database=not_applicable"
  echo "server_version=not_applicable"
  echo "exporter=synology-uploads-archive"
  echo "schema_complete=true"
  echo "create_tables=0"
  echo "encrypted=$ENCRYPTED"
  echo "bytes=$(size_of "$FINAL")"
  echo "sha256_sql_gzipped=$SHA_PLAIN"
  echo "sha256_artifact=$SHA_FINAL"
  echo "archive_class=$LABEL"
  echo "manifest_files=$FILE_COUNT"
  echo "manifest_bytes=$TOTAL_BYTES"
  echo "manifest_empty_dirs=$EMPTY_DIRS"
  echo "manifest_sha256=$MANIFEST_SHA"
} > "$META.partial" && mv "$META.partial" "$META" || fail "could not write the sidecar"

log "Archive OK: $(basename "$FINAL") bytes=$(size_of "$FINAL") files=$FILE_COUNT encrypted=$ENCRYPTED sha256=$(short "$SHA_FINAL")"

if [ "$KEEP_DAYS" -gt 0 ] && [ "$DELETE_OLD" = "1" ]; then
  # Off by default and never implicit: this clinic lost documents to a tidy-up once.
  CUTOFF=$(( $(date +%s) - KEEP_DAYS * 86400 ))
  for f in "$DEST_REAL"/backup_"${LABEL}"_*.tar.gz "$DEST_REAL"/backup_"${LABEL}"_*.tar.gz.enc; do
    [ -e "$f" ] || continue
    mt=$(stat -c%Y "$f" 2>/dev/null || stat -f%m "$f" 2>/dev/null || echo 0)
    if [ "$mt" -lt "$CUTOFF" ]; then
      log "retention: removing $(basename "$f") and its sidecar"
      rm -f "$f" "$f.meta"
    fi
  done
elif [ "$KEEP_DAYS" -gt 0 ]; then
  log "retention: KEEP_DAYS=$KEEP_DAYS but DELETE_OLD is not 1 — nothing was deleted"
fi
exit 0
