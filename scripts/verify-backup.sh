#!/usr/bin/env bash
#
# Basecamp backup verification / restore drill.
#
# A backup you have never restored is a hypothesis, not a backup. This pulls the
# most recent snapshot BACK DOWN FROM THE STORAGE BOX -- not the local copy --
# and proves it can actually be restored, because the off-site copy is the one
# that matters on the day the VPS is gone.
#
# Checks, in order:
#   1. the storage box is reachable and has backups
#   2. the newest remote archive downloads and decompresses
#   3. the restored database passes integrity_check
#   4. every expected table is present
#   5. row counts are sane compared to the live database
#
# Usage:  sudo ./scripts/verify-backup.sh
# Exit:   0 = the off-site backup is restorable; non-zero = it is not.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname -- "$SCRIPT_DIR")"

DB_PATH="${DB_PATH:-$APP_DIR/data/basecamp.db}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/basecamp}"

BOX_USER="${BOX_USER:-u613904-sub3}"
BOX_HOST="${BOX_HOST:-u613904.your-storagebox.de}"
BOX_PORT="${BOX_PORT:-23}"
BOX_KEY="${BOX_KEY:-/root/.ssh/box_basecamp}"

# How stale may the newest off-site backup be before we call it a failure?
MAX_AGE_HOURS="${MAX_AGE_HOURS:-48}"

EXPECTED_TABLES=(
  habits habit_logs body_metrics craving_events settings
  workout_templates template_exercises workout_schedule workout_sessions session_sets
  foods meal_entries
)

log()  { printf '%s  %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"; }
warn() { printf '%s  WARN: %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { printf '%s  ERROR: %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*" >&2; exit 1; }

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

log "restore drill starting (source: storage box, not local)"

[[ -f "$BOX_KEY" ]] || fail "off-site key missing at $BOX_KEY"
SSH_CMD="ssh -p $BOX_PORT -i $BOX_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20"

# --- 1. find the newest remote backup -------------------------------------
# Filenames are basecamp-YYYY-MM-DD_HHMMSS.db.gz, so a lexical sort is a
# chronological sort.
REMOTE_LIST="$($SSH_CMD "$BOX_USER@$BOX_HOST" ls daily 2>/dev/null || true)"
[[ -n "$REMOTE_LIST" ]] || fail "storage box unreachable, or daily/ is empty"

NEWEST="$(printf '%s\n' "$REMOTE_LIST" | grep -E '^basecamp-.*\.db\.gz$' | sort | tail -1 || true)"
[[ -n "$NEWEST" ]] || fail "no backup archives found in daily/ on the storage box"
log "newest off-site backup: $NEWEST"

# --- 2. is it recent enough? ----------------------------------------------
# Parse the timestamp out of the filename: basecamp-2026-09-26_033000.db.gz
FILE_DATE="$(sed -E 's/^basecamp-([0-9]{4}-[0-9]{2}-[0-9]{2})_([0-9]{2})([0-9]{2})([0-9]{2})\.db\.gz$/\1 \2:\3:\4/' <<<"$NEWEST")"
if BACKUP_EPOCH="$(date -d "$FILE_DATE" +%s 2>/dev/null)"; then
  AGE_HOURS=$(( ($(date +%s) - BACKUP_EPOCH) / 3600 ))
  if (( AGE_HOURS > MAX_AGE_HOURS )); then
    fail "newest off-site backup is ${AGE_HOURS}h old (max ${MAX_AGE_HOURS}h) -- backups are not running"
  fi
  log "age ${AGE_HOURS}h (within ${MAX_AGE_HOURS}h)"
else
  warn "could not parse a date from '$NEWEST' -- skipping the staleness check"
fi

# --- 3. download and decompress -------------------------------------------
if ! rsync -a -e "$SSH_CMD" "$BOX_USER@$BOX_HOST:daily/$NEWEST" "$TMP_DIR/"; then
  fail "failed to download $NEWEST from the storage box"
fi
gzip -t "$TMP_DIR/$NEWEST" || fail "downloaded archive is corrupt"
gunzip -c "$TMP_DIR/$NEWEST" > "$TMP_DIR/restored.db"
log "downloaded and decompressed ($(stat -c%s "$TMP_DIR/restored.db") bytes)"

# --- 4. does it restore? --------------------------------------------------
INTEGRITY="$(sqlite3 "$TMP_DIR/restored.db" 'PRAGMA integrity_check;' 2>&1 || true)"
[[ "$INTEGRITY" == "ok" ]] || fail "restored database failed integrity_check: $INTEGRITY"
log "integrity_check ok"

# --- 5. is the data actually there? ---------------------------------------
# Compared against the live database. Small drift is expected (the backup is a
# point in time and you have logged since). A restored copy holding dramatically
# less than live means something truncated it.
DRIFT=0
SUMMARY=""
for t in "${EXPECTED_TABLES[@]}"; do
  if ! restored_n="$(sqlite3 "$TMP_DIR/restored.db" "SELECT COUNT(*) FROM $t;" 2>/dev/null)"; then
    fail "table '$t' missing from the restored database"
  fi
  live_n="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM $t;" 2>/dev/null || echo 0)"
  SUMMARY="$SUMMARY $t=$restored_n/$live_n"
  if (( live_n > 10 && restored_n * 2 < live_n )); then
    warn "$t holds $restored_n rows but live has $live_n -- possible truncation"
    DRIFT=1
  fi
done
log "table counts (restored/live):$SUMMARY"

cat > "$BACKUP_ROOT/last-verify.json" <<JSON
{
  "timestamp": "$(date -Is)",
  "verified_file": "$NEWEST",
  "source": "storage-box",
  "drift_warning": $DRIFT
}
JSON

if (( DRIFT )); then
  fail "restore drill completed with truncation warnings -- investigate above"
fi

log "restore drill passed: the off-site backup is restorable"
