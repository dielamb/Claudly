#!/usr/bin/env bash
# Adds nightly-maintenance.sh to crontab at 02:00 daily
# Safe to run multiple times (idempotent — checks if already scheduled)
set -euo pipefail

CRON_JOB="0 2 * * * __HOME__/.claude/helpers/nightly-maintenance.sh >> __HOME__/.claude/learning/maintenance.log 2>&1"

# ── Idempotency check ────────────────────────────────────────────────────────
if crontab -l 2>/dev/null | grep -q "nightly-maintenance"; then
  echo "Already scheduled — no changes made."
  crontab -l | grep "nightly-maintenance"
  exit 0
fi

# ── Install ──────────────────────────────────────────────────────────────────
(crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -

# ── Verify ───────────────────────────────────────────────────────────────────
echo "Verifying crontab entry:"
crontab -l | grep "nightly-maintenance"
echo "Scheduled: runs daily at 02:00"
