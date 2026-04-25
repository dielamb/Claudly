---
name: ingest-source
description: Ingest an external source (article URL, PDF, video, paper) into ~/Desktop/Labirynt/5 Sources/ as a summary note, then cross-link to relevant Atlas notes (entities, concepts, tools mentioned). Karpathy LLM Wiki pattern — each source touches 5-15 wiki pages. Use when user says "/ingest", "save this source", "add this article to vault", "read and save".
---

# Ingest Source — external content → vault

Each external source (article, paper, video, talk) should enter the vault through this workflow. Raw content lives in `5 Sources/`, concepts extracted link into `3 Atlas/` where they belong.

Karpathy LLM Wiki pattern: *"When you add a new document source to the LLM, the LLM reads, understands, and integrates that source into the knowledge base, updating all relevant existing pages, noting contradictions, creating new concept pages."*

## When to activate

User says one of:
- `/ingest <url>`
- `/ingest-source <url>`
- "save this article" + link
- "read this and add to vault"
- "make a note from this in Sources"

## Input formats

1. **URL** (article, arXiv, YouTube, Twitter) — use WebFetch
2. **Local PDF path** — use Read (PDF supported) with page range if large
3. **Direct text paste** — user pastes content

## Procedure

### Step 1 — Fetch content

Based on input:
- URL → WebFetch with prompt "Extract main content, author, date published, key claims"
- YouTube → WebFetch to transcript service, or note "needs transcription — provide .txt or rerun"
- PDF → Read with pages parameter
- Text paste → use as-is

If fetch fails — tell the user specifically what didn't work. Don't try to guess.

### Step 2 — Extract metadata

From the fetched content extract:
- **Title** (original article/paper title)
- **Author(s)** (if available)
- **Published date** (YYYY-MM-DD)
- **Source type**: article / paper / video-talk / tweet / book-chapter / blog-post
- **URL** (canonical)
- **Main claim** (1 sentence — what the author is arguing)

### Step 3 — Check for duplicates

```bash
ls ~/Desktop/Labirynt/5\ Sources/ | grep -i "[key-terms-from-title]"
```

If a similar title exists — tell the user: "There's already [[existing source]]. Update or new note?"

### Step 4 — Write source summary

To `~/Desktop/Labirynt/5 Sources/[sanitized-title].md`:

```markdown
---
type: source
source_type: [article|paper|video|tweet|blog]
created: YYYY-MM-DD
published: YYYY-MM-DD
author: [Name]
url: [canonical URL]
tags: [domain tags]
quality: [high|normal|low]  # high = seminal work / non-obvious; normal = solid but known; low = skip if not valuable
---

## Main claim
[1-2 sentences — what the author is arguing]

## Key points
- [bullet 1]
- [bullet 2]
- [bullet 3-5 max]

## Non-obvious insights
[What surprised you / went against conventional wisdom]

## Applicable to
- [[Effort A]] — how this source applies
- [[Concept B]] — how this shapes understanding

## Related sources
- [[Other Source]] — [agreement/disagreement/extension]

## Full notes
[Optional: longer notes, quotes, timestamps for video]
```

Max 300 words in summary portion. Full notes optional. Quality field **is required** — follows same convention as Problems/.

### Step 5 — Cross-reference to Atlas

For each concept, entity, tool, person mentioned in the source:

1. **Check if Atlas note exists** for that concept:
   ```bash
   ls ~/Desktop/Labirynt/3\ Atlas/**/*.md | grep -i "[concept-name]"
   ls ~/Desktop/Labirynt/4\ People/*.md | grep -i "[person-name]"
   ```

2. **If exists**: append reference to the source in the Atlas note's "## Sources" section:
   ```markdown
   ## Sources
   - [[[Source Title]]] — "specific claim from this source"
   ```

3. **If doesn't exist AND concept is non-trivial**: create new Atlas note with framing appropriate to folder:
   - New tool/library mentioned → `3 Atlas/Tools/[tool].md`
   - New concept/principle → `3 Atlas/Design/` or `3 Atlas/Code/` based on domain
   - New person → `4 People/[person].md` (only if mentioned in 2+ contexts — follow router rule)

   **Don't create notes for every noun** — only things the user will likely want to reference again.

### Step 6 — Check for contradictions

If source contradicts an existing Atlas note:
- Add a "## Contradicts" section to the source: `[[Existing Atlas Note]] — my note says X, this source says Y`
- Add note in existing Atlas: `⚠️ Contradicted by [[Source]] — [explanation]`
- Do NOT auto-resolve. Contradictions are information, not bugs.

### Step 7 — Daily note log

Append to today's daily note under `## Sources added`:
```markdown
## Sources added
- [[Source Title]] — [1-line summary] → touched [[Note A]], [[Note B]]
```

### Step 7.5 — Append to vault-log.md

Append to `~/Desktop/Labirynt/vault-log.md`:
```markdown
### YYYY-MM-DD HH:MM ingest-source
[ingest-source] [[Source Title]] from [URL/path]
  - Created: 5 Sources/[file].md
  - Updated: [Atlas Note 1], [Atlas Note 2]
  - Created (new concepts): [New Note 1]
  - Contradictions: [count or "none"]
```

### Step 8 — Report back

Tell the user:
```
Ingested: [[Source Title]] → 5 Sources/
Linked to: 
  - [[Atlas Note 1]] (updated)
  - [[Atlas Note 2]] (updated)
  - [[New Concept]] (created)
Found contradictions: [none | list]
Total wiki touches: N pages
```

If touched <3 pages — mention that the source is isolated (possibly too niche or vault lacks the conceptual infrastructure).

## Anti-patterns

- **DON'T** create a note for every noun in the source — selectively, relevance-first
- **DON'T** copy-paste full text — vault storage is not an archive, it's a semantic index
- **DON'T** ignore contradictions — flagging is a fundamental feature, not a problem
- **DON'T** sort into Inbox — sources are categorized (always 5 Sources/), no confidence threshold
- **DON'T** ingest without a quality signal — `quality: low` sources should be skipped entirely (user gets a "not worth saving" response)

## Integration with weekly-review

Weekly-review can add a step: scan `5 Sources/` with mtime this week, suggest merge/delete for duplicate sources.

## Related
- `~/Desktop/Labirynt/CLAUDE.md` — routing rules (primary reference)
- `~/Desktop/Labirynt/3 Atlas/Synthesis/` — where complex answers comparing multiple sources live
- [Karpathy LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — pattern origin
