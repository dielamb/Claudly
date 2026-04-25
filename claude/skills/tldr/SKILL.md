---
name: tldr
description: Extract knowledge from current session — identify breakthroughs, frustrations, learnings — and save each as a separate note in Obsidian. Use when user says /tldr at end of conversation.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Bash
---

# /tldr — Session Knowledge Extractor

When the user invokes /tldr, do a FULL extraction. Not a summary — a knowledge harvest.

## Step 1: Analyze the session for signals

Read the FULL conversation. For each distinct topic/problem worked on, identify:

**Frustration signals:** repeated attempts, rollbacks, "nie tak", "kurwa", "cofamy", "znowu", negative language, same file edited 3+ times
**Breakthrough signals:** "tak", "działa", "właśnie o to chodzi", forward movement after struggle, commit after loop, user approval

Map each topic to one of:
- `quality: high` — struggled then solved, non-obvious solution, worth remembering
- `quality: normal` — straightforward, worked first/second try
- `quality: low` — trivial, config, typo

## Step 2: Extract git commits (if bash available)

```bash
git log --oneline --since="8 hours ago" 2>/dev/null
```

Match commits to topics. The commit AFTER a frustration loop = `breakthrough_commit`.

## Step 3: For each topic — save to Obsidian

**Problem solved (any quality):**
- Check if `~/Desktop/Labirynt/3 Atlas/Problems/` has an existing note for this topic
- If YES: update `quality:` and `breakthrough_commit:` in frontmatter only
- If NO: create new file using `tpl-problem-solution.md` template with filled `quality:` and `breakthrough_commit:`

**Decision made** (signals: "idziemy z X", "zdecydowałem", "zostaje", "usuwamy"):
- Append to `~/Desktop/Labirynt/3 Atlas/Career/Decisions.md`

**New tool/pattern discovered:**
- Create in `~/Desktop/Labirynt/3 Atlas/Tools/` or `3 Atlas/Code/`

**Person mentioned 2+ times:**
- Create/update in `~/Desktop/Labirynt/4 People/`

**Architecture/system insight** (how the system works, why something is built a certain way):
- Create in `~/Desktop/Labirynt/3 Atlas/Problems/` or `3 Atlas/Tools/`

## Step 4: Write daily note summary

Find or create `~/Desktop/Labirynt/1 Calendar/YYYY-MM-DD.md`.
Append under `## Sesje z Claude`:

```markdown
### Session [HH:MM]
**Projekt:** [main project]
**Zrobiono:** [2-4 bullet points max]
**Zapisano:** [list of files created/updated in vault — filenames only]
```

Keep under 100 words. The details are in the individual notes.

## Step 5: Report back

Tell the user:
- How many Problem notes created/updated
- Which got `quality: high`
- Where decisions were saved
- Any gaps (things that happened but couldn't be categorized)

Format responses in Polish. Follow vault CLAUDE.md rules for tags and wikilinks.

## Step 6: Trigger dream worker

After reporting back, run this Bash command silently in background — do not mention it to user unless it fails:

```bash
echo "" > ~/.claude/learning/last-dream.txt && node ~/.claude/helpers/dream-worker.js >> ~/.claude/learning/dream-worker.log 2>&1 &
```

This resets the 4h cooldown and runs the dreamer on fresh session data while signals are hot.
