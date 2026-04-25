---
name: inbox-review
description: Review low-confidence notes in ~/Desktop/Labirynt/0 Inbox/ and sort them into proper 3 Atlas/ subfolders. Use when notes pile up in Inbox (auto-classified as ambiguous by auto-tldr) or when user says "/inbox-review", "review inbox", "sort inbox".
---

# Inbox Review — sorting low-confidence notes

Notes in `~/Desktop/Labirynt/0 Inbox/` are those that auto-tldr could not unambiguously classify (confidence <70%). This skill reviews them one by one, proposes a target folder and — after your `OK` — moves them.

## When to use

- Manually after a heavy session when Inbox has >3 files
- As part of `/weekly-review` — part of Sunday cleanup
- When someone dropped a quick-capture note that would sit there for months

## Procedure

### Step 1: Count Inbox

```bash
ls -la ~/Desktop/Labirynt/0\ Inbox/ 2>/dev/null | grep -v "^d" | grep -v "^total" | grep -v "^\." | wc -l
```

If 0 files — say "Inbox empty, nothing to review" and exit.

### Step 2: For each file

For each `.md` file in Inbox:

1. **Read** content + frontmatter
2. **Check `proposed_folders:`** in frontmatter — these are suggestions from auto-tldr
3. **Classify** according to the routing matrix from `~/Desktop/Labirynt/CLAUDE.md`:

   | Content type | Target folder | type: |
   |---|---|---|
   | Reusable snippet/pattern | `3 Atlas/Code/` | `pattern` |
   | Design principle/token | `3 Atlas/Design/` | `design-principle` |
   | Bug + fix + context | `3 Atlas/Problems/` | `problem-solution` |
   | Tool/MCP/plugin note | `3 Atlas/Tools/` | `tool-note` |
   | Future idea | `3 Atlas/Ideas/` | `idea` |
   | Person (2+ mentions) | `4 People/` | `person` |
   | Source material | `5 Sources/` | `source` |
   | Effort/project | `2 Efforts/` | `effort` |
   | Decision | append to `3 Atlas/Career/Decisions.md` | — |

4. **Propose to the user** (once, in one message):

   ```
   ## Inbox review — N files

   ### 1. [filename].md
   **Content summary:** [1 sentence]
   **Proposed folder:** `3 Atlas/[X]/`
   **New type:** [pattern/tool-note/etc]
   **Proposed title:** [Refactored title]

   ### 2. [next file]...
   ```

5. **Wait for `OK` or modifications** from user.

### Step 3: After approval — execute migrations

For each approved file:

1. **Check target doesn't already have such a file** (dedup):
   ```bash
   ls ~/Desktop/Labirynt/[folder]/[new_name].md 2>/dev/null
   ```
   If it exists: **DON'T overwrite**. Propose appending content to the existing note or a different title.

2. **Move + reformat:**
   - Move file to target folder
   - Update frontmatter (change `type: unsorted` to appropriate type, remove `proposed_folders`, `confidence`)
   - If content doesn't match the target folder's template — reformat sections

3. **Update wikilinks:**
   - Find all files in vault that link to the old location
   - Wikilink `[[Inbox filename]]` → `[[filename]]` (Obsidian resolves automatically after move)
   - If file had frontmatter `proposed_folders: [X, Y]` — add to `## Related` a wikilink to the alternative folder in case a split would be worthwhile

### Step 3.5: Append to vault-log.md

After each batch migration add an entry to `~/Desktop/Labirynt/vault-log.md`:

```markdown
### YYYY-MM-DD HH:MM inbox-review
[inbox-review] Sorted N files from 0 Inbox/
  - [old-name.md] → [new-folder]/[new-name.md]
  - [old-name.md] → [new-folder]/[new-name.md]
  - Skipped: [count] duplicates
```

### Step 4: Summary

At the end:

```
## Inbox review complete

- Moved: N files
- Skipped (duplicates): M files
- Deleted (ephemeral): K files

New files:
- 3 Atlas/Code/X.md
- 3 Atlas/Tools/Y.md
...

Inbox: 0 files remaining (clean)
```

## Anti-patterns

- **DON'T ask the user about each file separately** — one message with the full plan, user approves in bulk
- **DON'T overwrite existing notes** — always check dedup
- **DON'T guess** if a file is ambiguous even after reading — leave in Inbox with comment "needs human review"
- **DON'T delete** files with frontmatter `status: active` or without frontmatter — only ephemeral trash (`proposed_folders: []` + content <100 chars)

## Integration with weekly-review

This skill can be invoked automatically by `/weekly-review` if Inbox has >5 files. Add to weekly-review SKILL.md step: "Check Inbox count; if >5, invoke /inbox-review".

## Related
- `~/Desktop/Labirynt/CLAUDE.md` — routing matrix (source of truth)
- `~/.claude/helpers-user/auto-tldr-safe.sh` — producer of Inbox entries
- `~/.claude/skills/weekly-review/SKILL.md` — orchestrator integration
