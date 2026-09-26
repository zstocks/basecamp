#!/usr/bin/env bash
#
# Basecamp database backup.
#
# Takes a consistent snapshot of the SQLite database, verifies it is actually
# readable and populated, keeps a local retention set, and pushes a copy to the
# Hetzner Storage Box.
#
# WHY sqlite3 .backup AND NOT cp:
#   The database runs in WAL mode. Copying basecamp.db on its own captures the
#   header and nothing else -- the rows live in basecamp.db-wal until a
#   checkpoint. That was verified: a naive copy restored to ZERO tables.
#   `.backup` uses SQLite's online backup API, which takes a proper read lock
#   and folds the WAL into a single consistent file. Safe on a live database.
#
# Every step checks its own result. A step that silently does nothing must not
# be mistaken for a step that succeeded -- that is the exact failure mode that
# produced empty backups in the first place.
#
# Usage:  sudo ./scripts/backup.sh [--skip-offsite] [--reason "text"]
# Exit:   0 = backup taken and verified (off-site included unless skipped)
#         non-zero = something failed; the journal entry says what.

set -Eeuo pipefail

# --- resolve paths from the script's own location (no hardcoded app dir) ---
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname -- "$SCRIPT_DIR")"

DB_PATH="${DB_PATH:-$APP_DIR/data/basecamp.db}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/basecamp}"

# --- off-site target (Hetzner Storage Box, sub-account sub3) ---
BOX_USER="${BOX_USER:-u613904-sub3}"
BOX_HOST="${BOX_HOST:-u613904.your-storagebox.de}"
BOX_PORT="${BOX_PORT:-23}"
BOX_KEY="${BOX_KEY:-/root/.ssh/box_basecamp}"

# --- retention (files are ~6 KB gzipped; this is a rounding error on disk) ---
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"

# Tables that must exist in a valid backup. If any is missing, the snapshot is
# broken and we refuse to keep it.
EXPECTED_TABLES=(
  habits habit_logs body_metrics craving_events settings
  workout_templates template_exercises workout_schedule workout_sessions session_sets
  foods meal_entries
)
MIN_ROWS="${MIN_ROWS:-1}"   # a backup with zero rows everywhere is a red flag

SKIP_OFFSITE=0
REASON="scheduled"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-offsite) SKIP_OFFSITE=1; shift ;;
    --reason)       REASON="${2:-scheduled}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

log()  { printf '%s  %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { printf '%s  ERROR: %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*" >&2; exit 1; }

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

STAMP="$(date +%Y-%m-%d_%H%M%S)"
TODAY="$(date +%F)"
RAW="$TMP_DIR/basecamp-$STAMP.db"
GZ_NAME="basecamp-$STAMP.db.gz"

log "basecamp backup starting (reason: $REASON)"

# --- 1. preflight ---------------------------------------------------------
command -v sqlite3 >/dev/null || fail "sqlite3 not installed"
[[ -f "$DB_PATH" ]]           || fail "database not found at $DB_PATH"
mkdir -p "$BACKUP_ROOT"/{daily,weekly,monthly}

# --- 2. snapshot ----------------------------------------------------------
# .backup, not cp. See the header comment.
if ! sqlite3 "$DB_PATH" ".backup '$RAW'"; then
  fail "sqlite3 .backup failed"
fi
[[ -s "$RAW" ]] || fail "snapshot is empty"
log "snapshot taken ($(stat -c%s "$RAW") bytes)"

# --- 3. verify the snapshot is structurally sound -------------------------
INTEGRITY="$(sqlite3 "$RAW" 'PRAGMA integrity_check;' 2>&1 || true)"
[[ "$INTEGRITY" == "ok" ]] || fail "integrity_check failed: $INTEGRITY"
log "integrity_check ok"

# --- 4. verify it actually contains the schema and data -------------------
# This is the check that would have caught the empty-backup bug: a 4 KB file
# passes integrity_check happily, because an empty database is a valid one.
TOTAL_ROWS=0
COUNTS=""
for t in "${EXPECTED_TABLES[@]}"; do
  if ! n="$(sqlite3 "$RAW" "SELECT COUNT(*) FROM $t;" 2>/dev/null)"; then
    fail "table '$t' missing from snapshot -- backup rejected"
  fi
  TOTAL_ROWS=$((TOTAL_ROWS + n))
  COUNTS="$COUNTS $t=$n"
done
(( TOTAL_ROWS >= MIN_ROWS )) || fail "snapshot has $TOTAL_ROWS rows across all tables (min $MIN_ROWS) -- backup rejected"
log "contents verified: $TOTAL_ROWS rows —$COUNTS"

# --- 5. compress and verify the archive -----------------------------------
gzip -9 "$RAW"
gzip -t "$RAW.gz" || fail "gzip archive failed its own integrity test"
mv "$RAW.gz" "$BACKUP_ROOT/daily/$GZ_NAME"
chmod 600 "$BACKUP_ROOT/daily/$GZ_NAME"
GZ_SIZE="$(stat -c%s "$BACKUP_ROOT/daily/$GZ_NAME")"
log "compressed and stored: daily/$GZ_NAME ($GZ_SIZE bytes)"

# --- 6. promote to weekly / monthly ---------------------------------------
if [[ "$(date +%u)" == "7" ]]; then
  cp -p "$BACKUP_ROOT/daily/$GZ_NAME" "$BACKUP_ROOT/weekly/$GZ_NAME"
  log "promoted to weekly"
fi
if [[ "$(date +%d)" == "01" ]]; then
  cp -p "$BACKUP_ROOT/daily/$GZ_NAME" "$BACKUP_ROOT/monthly/$GZ_NAME"
  log "promoted to monthly"
fi

# --- 7. prune local retention ---------------------------------------------
prune_dir() {
  local dir="$1" keep="$2" n
  n="$(find "$dir" -maxdepth 1 -type f -name '*.db.gz' | wc -l)"
  (( n > keep )) || return 0
  find "$dir" -maxdepth 1 -type f -name '*.db.gz' -printf '%T@ %p\n' \
    | sort -rn | tail -n +$((keep + 1)) | cut -d' ' -f2- \
    | while read -r f; do rm -f "$f"; log "pruned $(basename "$dir")/$(basename "$f")"; done
}
prune_dir "$BACKUP_ROOT/daily"   "$KEEP_DAILY"
prune_dir "$BACKUP_ROOT/weekly"  "$KEEP_WEEKLY"
prune_dir "$BACKUP_ROOT/monthly" "$KEEP_MONTHLY"

# --- 8. keep the WAL from growing without bound ---------------------------
# Cosmetic now that .backup is used, but it stops basecamp.db-wal drifting into
# megabytes while basecamp.db stays a 4 KB stub.
sqlite3 "$DB_PATH" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null 2>&1 \
  && log "WAL checkpointed" \
  || log "WARN: WAL checkpoint skipped (database busy) -- not fatal"

# --- 9. status file (local, and mirrored off-site) ------------------------
# Machine-readable so the app can surface "last backup age" later.
cat > "$BACKUP_ROOT/last-backup.json" <<JSON
{
  "timestamp": "$(date -Is)",
  "reason": "$REASON",
  "file": "$GZ_NAME",
  "bytes": $GZ_SIZE,
  "total_rows": $TOTAL_ROWS,
  "date": "$TODAY"
}
JSON

# --- 10. off-site push ----------------------------------------------------
# Deliberately NO --delete. The remote is append-only: if a bug or a bad actor
# empties the local backup directory, that destruction must not replicate to
# the only surviving copy. At ~6 KB/day this costs ~2 MB/year on a 5 TB box.
if (( SKIP_OFFSITE )); then
  log "off-site push skipped (--skip-offsite)"
else
  [[ -f "$BOX_KEY" ]] || fail "off-site key missing at $BOX_KEY"
  SSH_CMD="ssh -p $BOX_PORT -i $BOX_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20"

  if ! rsync -a -e "$SSH_CMD" "$BACKUP_ROOT"/ "$BOX_USER@$BOX_HOST":; then
    fail "rsync to storage box failed"
  fi

  # Trust nothing: confirm the file is actually listed on the far end.
  if ! $SSH_CMD "$BOX_USER@$BOX_HOST" ls daily 2>/dev/null | grep -qF "$GZ_NAME"; then
    fail "off-site copy not found on storage box after rsync"
  fi
  log "off-site verified: $BOX_USER@$BOX_HOST:daily/$GZ_NAME"
fi

log "basecamp backup complete"
