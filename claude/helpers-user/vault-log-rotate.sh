#!/bin/bash
# Vault Log Rotation
# Trims ~/Desktop/Labirynt/vault-log.md to keep only last N entries (default 500).
# Older entries archived to vault-log.archive.md.
# Run from monthly-consolidate cron (1st of month) — already wired.

set -e

VAULT_LOG="$HOME/Desktop/Labirynt/vault-log.md"
ARCHIVE_LOG="$HOME/Desktop/Labirynt/vault-log.archive.md"
MAX_ENTRIES="${VAULT_LOG_MAX_ENTRIES:-500}"
LOG="$HOME/logs/vault-log-rotate.log"

mkdir -p "$(dirname "$LOG")"

if [ ! -f "$VAULT_LOG" ]; then
  echo "[$(date -Iseconds)] vault-log.md missing — skip" >> "$LOG"
  exit 0
fi

# Count entries (H3 headers that start with "###")
TOTAL=$(grep -c "^### " "$VAULT_LOG" || echo 0)
echo "[$(date -Iseconds)] vault-log has $TOTAL entries" >> "$LOG"

if [ "$TOTAL" -le "$MAX_ENTRIES" ]; then
  echo "[$(date -Iseconds)] Under threshold, no rotation needed" >> "$LOG"
  exit 0
fi

# Find the line of the Nth-from-last "### " header (entries to keep)
KEEP_FROM_ENTRY=$((TOTAL - MAX_ENTRIES + 1))
KEEP_FROM_LINE=$(grep -n "^### " "$VAULT_LOG" | sed -n "${KEEP_FROM_ENTRY}p" | cut -d: -f1)

if [ -z "$KEEP_FROM_LINE" ]; then
  echo "[$(date -Iseconds)] Could not find cutoff line, aborting" >> "$LOG"
  exit 1
fi

# Split: header + old entries → archive; header + recent entries → new vault-log
HEADER=$(head -n 10 "$VAULT_LOG")  # preserve H1 + intro
HEADER_LINES=$(awk '/^## [0-9]/ {print NR-1; exit}' "$VAULT_LOG")
if [ -z "$HEADER_LINES" ]; then HEADER_LINES=10; fi

# Archive old entries (lines HEADER_LINES+1 through KEEP_FROM_LINE-1)
OLD_END=$((KEEP_FROM_LINE - 1))
if [ "$OLD_END" -gt "$HEADER_LINES" ]; then
  {
    echo ""
    echo "## Archived $(date +%Y-%m-%d) (rotation: kept last $MAX_ENTRIES entries)"
    echo ""
    sed -n "$((HEADER_LINES + 1)),${OLD_END}p" "$VAULT_LOG"
  } >> "$ARCHIVE_LOG"
fi

# Rewrite vault-log with header + recent entries
TMPFILE=$(mktemp)
{
  head -n "$HEADER_LINES" "$VAULT_LOG"
  echo ""
  echo "## $(date +%Y-%m-%d) (after rotation — older entries in vault-log.archive.md)"
  echo ""
  tail -n "+${KEEP_FROM_LINE}" "$VAULT_LOG"
} > "$TMPFILE"

mv "$TMPFILE" "$VAULT_LOG"

NEW_TOTAL=$(grep -c "^### " "$VAULT_LOG" || echo 0)
echo "[$(date -Iseconds)] Rotated: $TOTAL → $NEW_TOTAL entries. Archive: $ARCHIVE_LOG" >> "$LOG"
echo "[vault-log-rotate] $TOTAL → $NEW_TOTAL entries (archived to $ARCHIVE_LOG)"
