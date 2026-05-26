#!/bin/bash
# RuFlo Bi-Weekly Hygiene
# Run every 2 weeks via cron: 30 20 */14 * * ~/scripts/ruflo-hygiene.sh
#
# Operates directly on Obsidian vault — NOT on volatile RuFlo cache.
# 1. Finds duplicate Problem files (similar titles/tags)
# 2. Flags Problem files missing quality field (pre-template files)
# 3. Lists auto-generated junk files (frequently-edited-unknown)
# 4. Lists Efforts not modified in 30+ days (archive candidates)
# 5. Appends report to today's daily note

export PATH="__HOME__/.nvm/versions/node/v24.15.0/bin:$PATH"

DATE=$(date +%Y-%m-%d)
LOG_DIR="$HOME/logs"
VAULT="$HOME/Desktop/Labirynt"
DAILY_NOTE="$VAULT/1 Calendar/$DATE.md"
PROBLEMS="$VAULT/3 Atlas/Problems"
EFFORTS="$VAULT/2 Efforts"

mkdir -p "$LOG_DIR"

echo "[$DATE] RuFlo hygiene started" >> "$LOG_DIR/ruflo-hygiene.log"

# Find auto-generated junk
JUNK_FILES=$(find "$PROBLEMS" -name "*frequently-edited-unknown*" 2>/dev/null | wc -l | tr -d ' ')

# Find Problem files missing quality field
MISSING_QUALITY=$(grep -rL "^quality:" "$PROBLEMS"/*.md 2>/dev/null | wc -l | tr -d ' ')

# Find stale Efforts (not modified in 30+ days)
STALE_EFFORTS=$(find "$EFFORTS" -name "*.md" -not -newer "$(date -v-30d +%Y-%m-%d)" 2>/dev/null | xargs -I{} basename {} .md 2>/dev/null)

echo "[$DATE] Vault scan done — junk=$JUNK_FILES missing_quality=$MISSING_QUALITY" >> "$LOG_DIR/ruflo-hygiene.log"

env -u ANTHROPIC_API_KEY claude --dangerously-skip-permissions -p "
You are running a bi-weekly Obsidian vault hygiene check. Operate ONLY on files, not on RuFlo.

## Step 1: Find duplicate Problem files
Read all files in ~/Desktop/Labirynt/3 Atlas/Problems/
Group files with very similar titles or identical tags combinations. List pairs that look like duplicates.
Do NOT merge or delete — only list them.

## Step 2: Flag missing quality fields
Files missing 'quality' frontmatter field: $MISSING_QUALITY files found by shell scan.
List up to 10 of them by reading the directory.

## Step 3: Flag junk auto-generated files
Auto-generated junk files in Problems/: $JUNK_FILES files named 'frequently-edited-unknown'.
List them. These are candidates for deletion.

## Step 4: Stale Efforts
Efforts not modified in 30+ days (archive candidates):
$STALE_EFFORTS

## Step 5: Write report
Append this section to ~/Desktop/Labirynt/1 Calendar/$DATE.md (create file if it doesn't exist):

## Hygiene Report $(date +%Y-%m-%d)
- Problem files total: [count]
- Duplicate candidates: [list or 'none']
- Missing quality field: $MISSING_QUALITY files — [list up to 5 filenames]
- Junk files to delete: $JUNK_FILES — [list names]
- Stale efforts (archive?): [list or 'none']

Action needed: [yes/no — if yes, what specifically]

Do NOT delete, move, or modify any files. Only report.
" --allowedTools "Read,Write,Glob,Bash" >> "$LOG_DIR/ruflo-hygiene.log" 2>&1

echo "[$DATE] RuFlo hygiene completed" >> "$LOG_DIR/ruflo-hygiene.log"
