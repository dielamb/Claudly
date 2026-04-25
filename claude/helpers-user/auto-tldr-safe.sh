#!/bin/bash
# Auto-TLDR Safe: size-capped knowledge extractor for session-end hook.
# Replaces RuFlo auto-tldr.sh which reads FULL transcript (risk: 46MB+ files blow context).
#
# Strategy:
#   - If transcript < 2MB: pass directly (same as RuFlo behavior)
#   - If transcript >= 2MB: pre-filter with jq (user messages + summaries + last 300 lines)
#   - Always: hard timeout 10 min to prevent runaway claude -p
#
# Called via shim in ~/.claude/helpers/auto-tldr.sh after RuFlo update
# (verify-integrity.sh reapplies shim).

export PATH="__HOME__/.nvm/versions/node/v24.15.0/bin:$PATH"

DATE=$(date +%Y-%m-%d)
VAULT="$HOME/Desktop/Labirynt"
DAILY_NOTE="$VAULT/1 Calendar/$DATE.md"
LOG="$HOME/logs/auto-tldr.log"
MAX_BYTES=2000000  # 2MB raw JSONL ~ 500K tokens max

mkdir -p "$HOME/logs"

TRANSCRIPT=$(ls -t "$HOME/.claude/projects/"*/*.jsonl 2>/dev/null | head -1)

if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  echo "[$DATE] No transcript found, skipping auto-tldr-safe" >> "$LOG"
  exit 0
fi

SIZE=$(stat -f%z "$TRANSCRIPT" 2>/dev/null || stat -c%s "$TRANSCRIPT" 2>/dev/null || echo 0)
echo "[$DATE] auto-tldr-safe: transcript=$TRANSCRIPT size=$SIZE bytes" >> "$LOG"

TMPFILE=$(mktemp -t auto-tldr-XXXXXX.jsonl)
trap "rm -f $TMPFILE" EXIT

if [ "$SIZE" -gt "$MAX_BYTES" ]; then
  # Large transcript: pre-filter
  if command -v jq >/dev/null 2>&1; then
    # jq path: user messages + summaries (no tool output bloat)
    jq -c 'select(.type == "user" or .type == "summary" or (.type == "assistant" and .role == "assistant"))' \
      "$TRANSCRIPT" 2>/dev/null > "$TMPFILE" || true

    # Append last 300 lines for recent context (tools + assistant outputs)
    tail -300 "$TRANSCRIPT" >> "$TMPFILE"
  else
    # Fallback without jq: grep for user/summary prefixes + tail
    grep -E '"type":"(user|summary)"' "$TRANSCRIPT" > "$TMPFILE" 2>/dev/null || true
    tail -300 "$TRANSCRIPT" >> "$TMPFILE"
  fi

  FILTERED_SIZE=$(stat -f%z "$TMPFILE" 2>/dev/null || stat -c%s "$TMPFILE" 2>/dev/null || echo 0)
  echo "[$DATE] Large transcript: filtered $SIZE -> $FILTERED_SIZE bytes" >> "$LOG"

  # Still too big? Hard cap: keep last MAX_BYTES
  if [ "$FILTERED_SIZE" -gt "$MAX_BYTES" ]; then
    tail -c "$MAX_BYTES" "$TMPFILE" > "${TMPFILE}.capped" && mv "${TMPFILE}.capped" "$TMPFILE"
    echo "[$DATE] Hard-capped filtered transcript to $MAX_BYTES bytes" >> "$LOG"
  fi
else
  # Small transcript: use as-is
  cp "$TRANSCRIPT" "$TMPFILE"
fi

# Hard timeout: kill auto-tldr after 10 min
(
  sleep 600
  pkill -f "auto-tldr-safe" 2>/dev/null
  pkill -f "claude.*$TMPFILE" 2>/dev/null
) &
TIMEOUT_PID=$!
trap "rm -f $TMPFILE; kill $TIMEOUT_PID 2>/dev/null" EXIT

claude --dangerously-skip-permissions -p "
You are running an automated session knowledge extraction. Read the session transcript at $TMPFILE (pre-filtered: user messages + summaries + recent tool output, NOT the full raw transcript).

Read ~/Desktop/Labirynt/CLAUDE.md first — it defines the routing matrix you MUST follow.

## Step 1: Identify topics and signals

For each distinct topic/problem worked on, identify:
- Frustration signals: repeated attempts on same thing, rollbacks, negative language, same file edited 3+ times
- Breakthrough signals: approval language, forward movement after struggle, commit after loop
- Map to quality: 'high' (struggled then solved, non-obvious), 'normal' (straightforward), 'low' (trivial)

## Step 2: Get git commits

Run: git log --oneline --since='12 hours ago' --all 2>/dev/null
Match commits to topics. Commit AFTER a frustration loop = breakthrough_commit.

## Step 3: CLASSIFY each learning into target folder(s)

For each topic, decide the type and destination folder. ONE learning may produce notes in MULTIPLE folders — do not collapse everything into Problems/.

Classification logic (follow in order):

1. **Is it a reusable code snippet/pattern** (usable without the original bug context)?
   → \`3 Atlas/Code/\` with type: pattern
   → Example: 'CSS clamp() pattern for fluid typography'

2. **Is it a design principle / visual rule / token / guideline**?
   → \`3 Atlas/Design/\` with type: design-principle
   → Example: '8px grid + 1.333 modular scale'

3. **Is it a specific bug + the fix IN ITS CONTEXT**?
   → \`3 Atlas/Problems/\` with type: problem-solution
   → Example: 'Safari flexbox wrap bug — min-width:0'

4. **Is it a tool/MCP/plugin note** (setup, use-case, config)?
   → \`3 Atlas/Tools/\` with type: tool-note

5. **Is it a future idea** (not done, aspirational)?
   → \`3 Atlas/Ideas/\` with type: idea

5b. **Is it a synthesis answer to a non-trivial question** (compounding knowledge)?
   → \`3 Atlas/Synthesis/\` with type: synthesis
   → Use when: user asked cross-cutting question (compare X vs Y, how does X relate to Y, summarize Z) and Claude's answer pulled from 3+ existing notes AND the answer is non-obvious (>200 words worth keeping)
   → Do NOT use for: trivial lookups, debug walkthroughs, single-source answers (those belong in original note)
   → Follow Karpathy LLM Wiki pattern: good answers become compounding synthesis pages

6. **Is it a decision** (user said: zdecydowałem/I decided, idziemy z/we're going with, zostaje/it stays)?
   → append to \`3 Atlas/Career/Decisions.md\`

7. **Is it a personal fact** (weight, rate, preference)?
   → appropriate \`Health/Finance/Career/Relationships/\` file

8. **AMBIGUOUS — fits 2+ folders and unclear which is primary** (confidence <70%)?
   → \`0 Inbox/\` with type: unsorted and proposed_folders: [X, Y]
   → Do NOT guess. Inbox is the honest answer.

### MULTI-FOLDER SPLIT rule

If one learning genuinely fits 2+ folders with HIGH confidence each (not ambiguous — both independently valuable):
- Create primary note in most-specific folder
- Create secondary note in other folder with different framing
- Cross-link via [[wikilinks]]

Example: user solves 'CSS clamp breaks on ultrawide, fixed by max-width cap':
- Problems/CSS clamp ultrawide bug.md — full debugging context, quality: high
- Code/CSS clamp responsive typography.md — clean reusable pattern
- Both link to each other

## Step 4: Save each classified learning

For each learning, use appropriate template:

**problem-solution (Problems/):**
\`\`\`
---
type: problem-solution
created: $DATE
tags: []
domain:
status: solved
quality: [high/normal/low]
breakthrough_commit: \"[hash or empty]\"
---
## Problem
## Context
## Solution
## Why it worked
\`\`\`

**pattern (Code/):**
\`\`\`
---
type: pattern
created: $DATE
tags: []
language: [css/js/ts/etc]
---
## Pattern
## Code
## When to use
## Related
[[wikilinks to related Problems/ or Design/]]
\`\`\`

**design-principle (Design/):**
\`\`\`
---
type: design-principle
created: $DATE
tags: []
scope: [typography/spacing/color/layout/motion]
---
## Principle
## Why
## Usage examples
## Related
[[wikilinks]]
\`\`\`

**tool-note (Tools/):**
\`\`\`
---
type: tool-note
created: $DATE
tags: []
---
## Tool
## Use case
## Setup
## Notes
\`\`\`

**idea (Ideas/):**
\`\`\`
---
type: idea
created: $DATE
tags: []
status: [draft/considering/rejected]
---
## Idea
## Why it makes sense
## Validation steps
\`\`\`

**synthesis (Synthesis/):**
\`\`\`
---
type: synthesis
created: $DATE
question: \"[actual question that was asked]\"
sources: [[Note A]], [[Note B]], [[Note C]]
tags: []
quality: [high/normal]
---
## Question
[Rephrased question]

## Synthesis
[3–6 paragraphs — distillation, NOT copy-paste from sources]

## Key insights
- [non-obvious takeaway]

## Sources
- [[Note A]] — [what was taken from it]
\`\`\`

**unsorted (0 Inbox/):**
\`\`\`
---
type: unsorted
created: $DATE
tags: []
proposed_folders: [list of candidates]
confidence: [0.0-0.7]
---
[content — will be reviewed in /inbox-review]
\`\`\`

For existing notes: Edit ONLY frontmatter (quality, breakthrough_commit) — do not rewrite content.

For decisions: append to Decisions.md.

## Step 4.5: Contradiction lint (lightweight)

Before committing each new problem-solution or pattern note:

1. Extract 1-3 key concepts from the note (e.g. 'CSS clamp', 'min-width flexbox')
2. Run: \`grep -r -l -i \"[concept]\" ~/Desktop/Labirynt/3\\ Atlas/Problems/\` — find related notes
3. For top 3 matches: quickly compare claims
   - Does your new note say X works, existing says X broken (or vice-versa)?
   - Are techniques opposing (use Y vs don't use Y)?
4. If contradiction detected:
   - Add \`## Contradicts [[Other Note]]\` section to new note explaining difference
   - Edit existing note: prepend \`⚠️ See [[New Note]] — [brief contradiction summary]\` under its H1
5. Do NOT auto-resolve — contradictions are information

Keep this lightweight — scan max 3 related notes, don't deep-dive.

## Step 5: Write daily note

Append to $DAILY_NOTE under '## Claude Sessions':
### Session auto ($DATE)
**Project:** [main project]
**Done:** [2-4 bullets]
**Saved:** [filenames grouped by folder, e.g. 'Problems/ X.md + Code/ Y.md']
**Inbox:** [count of unsorted, if any]

Max 100 words. Details live in individual notes.

## Step 6: Append to vault-log.md (transparency layer)

Append to ~/Desktop/Labirynt/vault-log.md:
\`\`\`
### $DATE HH:MM auto-tldr
[auto-tldr] [1-line session summary]
  - Created: [file1.md, file2.md, ...]
  - Updated: [file3.md frontmatter, ...]
  - Synthesis: [file.md if applicable]
  - Inbox: [count]
\`\`\`

This creates append-only record of every AI mutation to vault. User can grep vault-log.md to see what was changed when, without git blame.
" --allowedTools "Read,Write,Edit,Glob,Bash" >> "$LOG" 2>&1

TLDR_EXIT=$?
kill $TIMEOUT_PID 2>/dev/null
echo "[$DATE] auto-tldr-safe done, exit=$TLDR_EXIT" >> "$LOG"
exit 0
