#!/bin/bash
# Verify Integrity: detects RuFlo updates and reapplies our auto-tldr shim.
#
# Problem: `npx @claude-flow/cli update` overwrites ~/.claude/helpers/auto-tldr.sh,
# wiping our shim that redirects to auto-tldr-safe.sh.
#
# Strategy: check if the shim line exists in auto-tldr.sh. If not, reinject it.
# This runs on SessionStart — detects update from previous session automatically.

set -e

HELPERS="$HOME/.claude/helpers"
HELPERS_USER="$HOME/.claude/helpers-user"
PATCHES="$HOME/.claude/patches"
LOG="$HOME/logs/verify-integrity.log"
mkdir -p "$(dirname "$LOG")"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1" >> "$LOG"
}

TLDR_FILE="$HELPERS/auto-tldr.sh"
TLDR_SAFE="$HELPERS_USER/auto-tldr-safe.sh"
SHIM_LINE='[ -x "$HOME/.claude/helpers-user/auto-tldr-safe.sh" ] && exec "$HOME/.claude/helpers-user/auto-tldr-safe.sh" "$@"'

# Nothing to do if our safe wrapper doesn't exist
if [ ! -x "$TLDR_SAFE" ]; then
  log "auto-tldr-safe.sh missing — nothing to protect"
  exit 0
fi

# Nothing to patch if RuFlo script doesn't exist
if [ ! -f "$TLDR_FILE" ]; then
  log "auto-tldr.sh missing — RuFlo not installed?"
  exit 0
fi

# Already shimmed?
if grep -qF 'helpers-user/auto-tldr-safe.sh' "$TLDR_FILE"; then
  # Good, nothing to do
  exit 0
fi

log "Shim missing from auto-tldr.sh — RuFlo likely updated. Reapplying."

# Inject shim after line 5 (PATH export). Use awk for portable in-place edit.
TMPFILE=$(mktemp)
awk -v shim="$SHIM_LINE" 'NR==5 {print; print ""; print "# User shim — redirects to size-safe wrapper (auto-reapplied by verify-integrity.sh)"; print shim; next} {print}' "$TLDR_FILE" > "$TMPFILE"

# Verify the edit didn't break anything obvious
if ! bash -n "$TMPFILE" 2>/dev/null; then
  log "Patched file has syntax error — aborting, leaving original intact"
  rm -f "$TMPFILE"
  exit 0
fi

# Atomic replace
chmod +x "$TMPFILE"
mv "$TMPFILE" "$TLDR_FILE"
log "Shim reapplied successfully to $TLDR_FILE"
echo "[INTEGRITY] auto-tldr shim reapplied after RuFlo update" >&2

exit 0
