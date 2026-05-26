---
name: consolidate
description: Monthly knowledge consolidation - reads weekly summaries, builds/updates MOC in Obsidian 6 Maps/, merges similar Problems/ notes. Run manually or via cron monthly.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
---

# Knowledge Consolidation

Synthesize weekly reviews and scattered notes into frameworks and Maps of Content.

## Steps

1. **Collect** - Read all weekly reviews from ~/Desktop/Labirynt/1 Calendar/YYYY-Www.md for the last 4 weeks
2. **Scan problems** - Read all files in ~/Desktop/Labirynt/3 Atlas/Problems/ 
3. **Find duplicates** - Problems/ notes with overlapping content should be merged (keep the richer one, redirect the other)
4. **Build frameworks** - From recurring patterns in weekly reviews, create or update MOC in ~/Desktop/Labirynt/6 Maps/
5. **Update existing MOCs** - If a Map of Content already exists for a topic, append new insights rather than creating a new file

## Output

### For new MOC (~/Desktop/Labirynt/6 Maps/[Topic].md):
```markdown
---
type: moc
updated: YYYY-MM-DD
---

# [Topic] - Map of Content

## Core Principles
- [distilled from weekly patterns]

## Related Notes
- [[Problem A]]
- [[Problem B]]

## Open Questions
- [unresolved patterns from weeklies]
```

### For merged Problems/:
- Keep the richer note
- Add content from duplicate
- Delete the duplicate (it's in Obsidian, nothing is truly lost - git/backup)

## Rules
- Never create a MOC for fewer than 3 related notes
- Keep MOCs under 200 words - they're maps, not essays
- Use [[wikilinks]] to connect to source notes
