#!/bin/bash
# RuFlo Monthly Consolidation
# Run 1st of every month at 20:00: 0 20 1 * * ~/scripts/ruflo-monthly-consolidate.sh

export PATH="__HOME__/.nvm/versions/node/v24.15.0/bin:$PATH"

DATE=$(date +%Y-%m-%d)
LOG_DIR="$HOME/logs"

mkdir -p "$LOG_DIR"

echo "[$DATE] Monthly consolidation started" >> "$LOG_DIR/ruflo-monthly.log"

claude --dangerously-skip-permissions -p "
Run /consolidate skill. Read weekly reviews from last 4 weeks in ~/Desktop/Labirynt/1 Calendar/ (files matching YYYY-Www.md). Read all ~/Desktop/Labirynt/3 Atlas/Problems/. Find duplicates to merge, recurring patterns to synthesize into MOC in ~/Desktop/Labirynt/6 Maps/. Follow the consolidate skill instructions exactly.
" --allowedTools "Read,Write,Glob,Grep" >> "$LOG_DIR/ruflo-monthly.log" 2>&1

echo "[$DATE] Monthly consolidation completed" >> "$LOG_DIR/ruflo-monthly.log"

# Rotate vault-log.md (P2b — prevent unbounded growth)
if [ -x "$HOME/.claude/helpers-user/vault-log-rotate.sh" ]; then
  echo "[$DATE] Rotating vault-log.md" >> "$LOG_DIR/ruflo-monthly.log"
  bash "$HOME/.claude/helpers-user/vault-log-rotate.sh" >> "$LOG_DIR/ruflo-monthly.log" 2>&1
fi
