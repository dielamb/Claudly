#!/usr/bin/env bash
# Nightly portfolio maintenance: drift check + slop check + macOS notification
# Usage: nightly-maintenance.sh [/path/to/www_v2]
set -euo pipefail

# ── Paths ────────────────────────────────────────────────────────────────────
PROJECT_PATH="${1:-__HOME__/Desktop/Portfolio/www_v2}"
REPORT_DATE=$(date +%Y-%m-%d)
REPORT_TIME=$(date +%H:%M)
REPORT_DIR="__HOME__/Desktop/Labirynt/3 Atlas/Domains/portfolio/drift-reports"
LOG_FILE="__HOME__/.claude/learning/maintenance.log"

# ── Setup ────────────────────────────────────────────────────────────────────
mkdir -p "$REPORT_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

# ── Run checks ───────────────────────────────────────────────────────────────
node "__HOME__/.claude/helpers/portfolio-drift-check.js" "$PROJECT_PATH" > /tmp/drift-out.txt 2>&1 || true
node "__HOME__/.claude/helpers/portfolio-slop-check.js" "$PROJECT_PATH"  > /tmp/slop-out.txt  2>&1 || true

# ── Combine report ───────────────────────────────────────────────────────────
{
  printf "# Portfolio Maintenance — %s\n\n" "$REPORT_DATE"
  printf "## Drift Check\n\n"
  cat /tmp/drift-out.txt
  printf "\n\n## Slop Check\n\n"
  cat /tmp/slop-out.txt
} > "$REPORT_DIR/$REPORT_DATE.md"

# ── Count results ────────────────────────────────────────────────────────────
FAIL_COUNT=$(grep -c "^CHECK-.* FAIL" /tmp/drift-out.txt || true)
WARN_COUNT=$(grep -c "^CHECK-.* WARN" /tmp/drift-out.txt || true)

# ── macOS notification ───────────────────────────────────────────────────────
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  osascript -e "display notification \"FAIL: ${FAIL_COUNT} issue(s) found\" with title \"Portfolio Drift Check\" sound name \"Basso\""
elif [[ "$WARN_COUNT" -gt 0 ]]; then
  osascript -e "display notification \"WARN: ${WARN_COUNT} warning(s)\" with title \"Portfolio Drift Check\" sound name \"Ping\""
else
  osascript -e "display notification \"All checks passed\" with title \"Portfolio Drift Check\" sound name \"Glass\""
fi

# ── Append to log ────────────────────────────────────────────────────────────
printf "[%s %s] FAIL=%s WARN=%s report=%s/%s.md\n" \
  "$REPORT_DATE" "$REPORT_TIME" "$FAIL_COUNT" "$WARN_COUNT" \
  "$REPORT_DIR" "$REPORT_DATE" >> "$LOG_FILE"

# ── Exit code = number of failures (0 = clean) ───────────────────────────────
exit "$FAIL_COUNT"
