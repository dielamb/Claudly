#!/bin/bash
# Auto-TLDR: knowledge extractor for session-end hook
# Reads FULL transcript, extracts granular learnings → Obsidian

export PATH="__HOME__/.nvm/versions/node/v24.15.0/bin:$PATH"

# User shim — redirects to size-safe wrapper (auto-reapplied by verify-integrity.sh)
[ -x "$HOME/.claude/helpers-user/auto-tldr-safe.sh" ] && exec "$HOME/.claude/helpers-user/auto-tldr-safe.sh" "$@"

DATE=$(date +%Y-%m-%d)
VAULT="$HOME/Desktop/Labirynt"
DAILY_NOTE="$VAULT/1 Calendar/$DATE.md"
LOG="$HOME/logs/auto-tldr.log"

mkdir -p "$HOME/logs"

TRANSCRIPT=$(ls -t "$HOME/.claude/projects/"*/*.jsonl "$HOME/.claude/projects/"*"/sessions/"*.jsonl 2>/dev/null | head -1)

if [ -z "$TRANSCRIPT" ]; then
  echo "[$DATE] No transcript found, skipping auto-tldr" >> "$LOG"
  exit 0
fi

echo "[$DATE] Running auto-tldr knowledge extraction from $TRANSCRIPT" >> "$LOG"

claude --dangerously-skip-permissions -p "
You are running an automated session knowledge extraction. Read the FULL session transcript at $TRANSCRIPT — not just last N lines, the whole file.

## Step 1: Identify topics and signals

For each distinct topic/problem worked on, identify:
- Frustration signals: repeated attempts on same thing, rollbacks, negative language, same file edited 3+ times
- Breakthrough signals: approval language, forward movement after struggle, commit after loop
- Map to quality: 'high' (struggled then solved, non-obvious), 'normal' (straightforward), 'low' (trivial)

## Step 2: Get git commits

Run: git log --oneline --since='12 hours ago' --all 2>/dev/null
Match commits to topics. Commit AFTER a frustration loop = breakthrough_commit.

## Step 3: Save each topic to Obsidian

For each problem/learning identified:
- Check ~/Desktop/Labirynt/3 Atlas/Problems/ for existing note on this topic
- If exists: update quality: and breakthrough_commit: in frontmatter (Edit tool, frontmatter only)
- If not exists: create new file from template structure:
  ---
  type: problem-solution
  created: $DATE
  tags: []
  domain:
  status: solved
  quality: [high/normal/low]
  breakthrough_commit: \"[hash or empty]\"
  ---
  [fill sections: Problem, Kontekst, Rozwiązanie, Dlaczego zadziałało]

For decisions (signals: 'zostaje', 'idziemy z', 'usuwamy', 'zdecydowałem'):
- Append to ~/Desktop/Labirynt/3 Atlas/Career/Decisions.md

## Step 4: Write daily note

Append to $DAILY_NOTE under '## Sesje z Claude':
### Session auto ($DATE)
**Projekt:** [main project]
**Zrobiono:** [2-4 bullets]
**Zapisano:** [filenames only, comma separated]

Max 80 words. Details live in the individual notes.
" --allowedTools "Read,Write,Edit,Glob,Bash" >> "$LOG" 2>&1 &

# Run in background, don't block session exit
