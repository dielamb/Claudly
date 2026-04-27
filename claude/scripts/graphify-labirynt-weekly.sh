#!/bin/bash
# Weekly graphify update for ~/Desktop/Labirynt
# Runs /graphify --update via headless Claude Code
# Scheduled via ~/Library/LaunchAgents/net.graphify.labirynt.plist (Mondays 10:17)

set -uo pipefail

VAULT="$HOME/Desktop/Labirynt"
LOG_DIR="$HOME/scripts/logs"
LOG_FILE="$LOG_DIR/graphify-labirynt-$(date +%Y-%m).log"

mkdir -p "$LOG_DIR"

# Hardcoded PATH so claude, node work under launchd (no shell rc files)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.npm-global/bin:$PATH"

# Autonomous prompt - tells Claude not to ask questions during unattended run
PROMPT='Run /graphify . --update on the current working directory (the Labirynt Obsidian vault). This is an automated weekly scheduled run with NO user present. Rules: (1) do not ask any clarifying questions — if the skill offers choices, pick the most conservative option and proceed; (2) exclude graphify-out/ from scanning (already in .graphifyignore); (3) if no baseline graph exists, do a full rebuild with --obsidian flag writing the vault to graphify-out/; (4) if update succeeds, report a one-line summary. Proceed immediately.'

{
  echo "=== graphify labirynt weekly run: $(date) ==="
  # Export learned rules to vault before graphify scans
  node "$HOME/.claude/helpers/export-rules-to-obsidian.js" || echo "[export-rules] skipped (non-fatal)"
  cd "$VAULT" || exit 1
  # Use installed claude CLI (NOT npx @anthropic-ai/claude-code which has postinstall issues)
  env -u ANTHROPIC_API_KEY claude \
    -p "$PROMPT" \
    --model sonnet \
    --dangerously-skip-permissions \
    2>&1
  echo "=== exit code: $? ==="
  echo
} >> "$LOG_FILE" 2>&1
