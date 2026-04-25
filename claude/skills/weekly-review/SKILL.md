---
name: weekly-review
description: Weekly knowledge review - reads daily notes, finds patterns across sessions, writes weekly summary to Obsidian vault. Run manually or via cron every Sunday.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
---

# Weekly Review

Analyze this week's daily notes and session activity to find patterns and generate a weekly summary.

## Steps

1. **Collect** - Read all daily notes from ~/Desktop/Labirynt/1 Calendar/ for the last 7 days
2. **Scan new Atlas notes** - Read files in ~/Desktop/Labirynt/3 Atlas/ (all subfolders: Problems/, Code/, Design/, Tools/, Ideas/, Synthesis/) from last 7 days
3. **Read vault-log.md** - Check ~/Desktop/Labirynt/vault-log.md for AI operations this week (auto-tldr entries, inbox-review, ingest-source)
4. **Analyze** - Find recurring themes, repeated issues, workflow patterns
5. **Contradiction lint** - Look for notes with same topic/tag that make opposing claims. For each found:
   - Add `⚠️ See [[Other Note]] — says X, this says Y` to both notes
   - Do NOT auto-resolve — contradictions are information
6. **Check graphify staleness** - If mtime of ~/Desktop/Labirynt/graphify-out/graph.json >7 days, suggest user runs /graphify
7. **Check Inbox count** - If 0 Inbox/ has >5 files, suggest /inbox-review
8. **Summarize** - Write weekly summary to ~/Desktop/Labirynt/1 Calendar/YYYY-Www.md

## Output format

```markdown
---
type: weekly-review
week: YYYY-Www
---

# Weekly Review YYYY-Www

## What happened
- [main activities from daily notes]

## Patterns noticed
- [recurring themes, repeated problems]

## Lessons learned
- [new knowledge captured this week]

## Focus for next week
- [based on patterns, what to change]
```

Keep under 300 words. Specific, not generic.
