#!/usr/bin/env bash
# inbox-nudge.sh — daily notification until Inbox is cleared
# Cron: 0 9 * * * bash ~/.claude/helpers/inbox-nudge.sh

INBOX="$HOME/Desktop/Labirynt/0 Inbox"

# Count only files requiring explicit action (approve or promote — not read-only reports)
COUNT=$(grep -rl "approve-needed\|promote-needed" "$INBOX" 2>/dev/null | wc -l | tr -d ' ')

[[ "$COUNT" -eq 0 ]] && exit 0

# Build summary list (first 3 filenames)
FILES=$(ls -t "$INBOX"/*.md 2>/dev/null | head -3 | xargs -I{} basename {} .md | tr '\n' ', ' | sed 's/, $//')

osascript -e "display notification \"$COUNT unprocessed: $FILES\" with title \"📥 Inbox wymaga uwagi\" sound name \"Ping\"" 2>/dev/null
