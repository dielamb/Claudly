# Labirynt — Second Brain AI Router

This vault is your second brain. It contains private and professional knowledge.
As an AI agent, follow these rules when reading and writing.

## Structure

| Folder | Contents | When to use |
|--------|-----------|-------------|
| `0 Inbox/` | **Low-confidence buffer** — notes where AI is uncertain about folder (<70%) | For ambiguous content, review in weekly |
| `1 Calendar/` | Daily notes (YYYY-MM-DD.md) | Journals, sessions, /tldr |
| `2 Efforts/` | Active projects and efforts | Projects with a clear goal |
| `3 Atlas/` | Knowledge base — atomic notes | Facts, patterns, solutions |
| `4 People/` | People + interaction history | 2+ mentions = create a note |
| `5 Sources/` | Books, articles, courses, videos | External knowledge sources |
| `6 Maps/` | MOC (Map of Content) | When 5+ notes on a topic |
| `Archive/` | Abandoned efforts, old notes | Never delete — move here |
| `Templates/` | Note templates | Use when creating new notes |

### Atlas — subfolders

| Subfolder | Examples |
|-----------|-----------|
| `Design/` | UI patterns, typography principles, token architecture |
| `Code/` | CSS tricks, JS patterns, snippets |
| `Tools/` | MCPs, plugins, tools, configurations |
| `Health/` | Weight, training, health, supplements |
| `Finance/` | Rates, expenses, investments, taxes |
| `Career/` | CV, career decisions, writing preferences |
| `Problems/` | Problem-solution notes (solved problems) |
| `Synthesis/` | **Synthesis from conversations** — compounding answers to non-trivial questions |
| `Reasoning/` | **Decision rationale** — why X was chosen over Y (trade-offs, architecture) |
| `Ideas/` | Ideas for projects, products, experiments |
| `Relationships/` | Notes on relationships, dating, acquaintances |

## Writing rules (for AI agent)

### Knowledge routing — which folder in 3 Atlas/?

Not every piece of knowledge is a "problem-solution". One session can generate 3+ notes in different folders.

| Folder | When... | Frontmatter `type:` | Example |
|---|---|---|---|
| `Problems/` | Specific bug/issue **+ context of how it arose** | `problem-solution` | "Safari flexbox wrap bug — min-width:0 after 2h debugging" |
| `Code/` | **Reusable snippet/pattern** without a specific bug context | `pattern` | "CSS clamp() pattern for fluid typography" |
| `Design/` | **Visual principle / token / guideline** | `design-principle` | "8px grid + 1.333 modular scale" |
| `Tools/` | **Tool/MCP/plugin** — what, setup, use case | `tool-note` | "Chrome DevTools MCP — remote debug setup" |
| `Ideas/` | **Future idea**, not done yet | `idea` | "Skill generator from GitHub repos" |
| `Synthesis/` | **Synthesis of 3+ notes** in response to a non-trivial question | `synthesis` | "Comparison: graphify vs intelligence vs RuFlo" |
| `Reasoning/` | **Why X instead of Y** — trade-offs, architecture, design rationale | `reasoning` | "Why shadow layer over patches for RuFlo extensions" |
| `Career/` | Career decisions, CV, rationale | `decision` / `rationale` | (goes to Decisions.md) |
| `Health/` `Finance/` `Relationships/` | Personal facts | `fact` | Weight, rate, note about a person |
| `0 Inbox/` | **Confidence < 70%** — unsure where it belongs | `unsorted` | When a note fits multiple folders ambiguously |

### Splitting rule — one session → multiple folders

Solving one problem often produces knowledge across several folders. **Don't pack everything into a single file in Problems/**.

**Example 1:** "CSS clamp() breaks on ultrawide, fixed by capping at max-width"
- `Problems/CSS clamp ultrawide bug.md` — full bug context and how you found it
- `Code/CSS clamp fluid typography pattern.md` — clean reusable snippet (no bug, just "how to use")
- Both cross-link via [[wikilinks]]

**Example 2:** "Built a design system with 8px grid"
- `Design/8px grid system.md` — principle: why 8px, when to apply
- `Problems/Grid inconsistency in Atlas DS.md` — specific challenges you overcame
- `Code/CSS spacing scale tokens.md` — token snippet

**Rule:** if one piece of knowledge fits multiple folders with confidence >70% each → do a split. Primary note in the most specific folder, secondary notes link back to it.

### Synthesis — close the knowledge loop (Karpathy LLM Wiki pattern)

Claude often answers questions by synthesizing knowledge from several notes. **These answers disappear in the terminal** — next time Claude will reconstruct them from scratch. That's waste.

**Rule: when the user asks a question that requires synthesizing 3+ notes** (comparison, analysis, "how does X relate to Y", "summarize Z") **and the answer is non-trivial** (>200 words, non-obvious insight) → **save it** to `3 Atlas/Synthesis/[topic].md`.

**Template:**
```markdown
---
type: synthesis
created: YYYY-MM-DD
question: "[actual question user asked]"
sources: [[Note A]], [[Note B]], [[Note C]]
tags: [domain tags]
quality: high/normal
---

## Question
[Rephrased question]

## Synthesis
[3–6 paragraphs — distillation, not copy-paste from sources]

## Key insights
- [non-obvious takeaway 1]
- [non-obvious takeaway 2]

## Sources
- [[Note A]] — [what was taken from it]
- [[Note B]] — [...]
```

**When NOT to save a synthesis:**
- Trivial lookup ("where is X file") — factual questions without synthesis
- Single-source answer — that belongs in the original note, not a new synthesis
- Ad-hoc diagnostics (debug, walkthrough)

**How to retrieve synthesis on the next question:**
When the user asks something similar → first `glob 3 Atlas/Synthesis/*.md` + match. If it exists → provide that synthesis + "we already have this in Synthesis/, let me check if it's still current". Update if sources have changed.

### When to save (triggers)

- User solved a problem → **consider split Problems/ + Code/** (not just Problems!)
- User mentions a new snippet/pattern without bug context → **Code/** (not Problems!)
- User establishes a visual principle → **Design/** (not Problems!)
- User mentions a tool/MCP/plugin → **Tools/**
- User mentions an idea "it would be cool if..." → **Ideas/**
- User mentions a person a 2nd time → **People/**
- User makes a decision ("I decided", "we're going with") → `Career/Decisions.md`
- User states a personal fact → appropriate category `Health/Finance/Career/`
- User says /tldr → append to daily note + per-topic notes in appropriate folders
- **Ambiguous (confidence <70%)** → `0 Inbox/` with frontmatter `type: unsorted` + `proposed_folders: [X, Y]`

### How to save
1. Always add 2-5 tags (you choose, not the user)
2. Link related notes via [[wikilinks]] — ALWAYS to the primary note if split
3. No duplicates — check if note already exists, if so → update it
4. Use templates from `Templates/`
5. Titles written as search queries: "Problem - Safari flexbox wrap" not "Bug"
6. Frontmatter: `type`, `created`, `tags` minimum. For Problems/ and rationale: + `quality`
7. If unsure about folder — **go to Inbox with proposed_folders**, don't guess

### How to search
- Question about a person → search in `4 People/`
- Question about a tool → search in `3 Atlas/Tools/`
- Question "did I ever solve...?" → search in `3 Atlas/Problems/`
- Question about a project → search in `2 Efforts/` and `Archive/`
- Question about a personal fact → search in `3 Atlas/Health/`, `Finance/`, `Career/`
- General question → search entire vault

### What NOT to do
- DON'T ask user about tags — choose them yourself
- DON'T ask user about folder — **but when confidence <70%, use `0 Inbox/` instead of guessing**
- DON'T pack all learnings into Problems/ — consider split Code/Design/Ideas
- DON'T create a note about a person on 1st mention — wait for 2nd
- DON'T save ephemeral things (temp debug, one-time questions)
- DON'T duplicate info that's in git history or in code
- DON'T create a single note when knowledge naturally splits across multiple folders

## Quality signals (frontmatter)

Every `problem-solution` and `rationale` MUST have `quality` in frontmatter. This is a key signal for the RuFlo intelligence layer — it decides whether a pattern will be retained long-term and how strongly it will be weighted in scoring.

### How to tag

- `quality: high` — **non-obvious solution after a struggle**. Survives the 30d cutoff, boost +0.25 in scoring, loaded on every session-start.
  - Signals: user was frustrated, 3+ attempts, rollback, "finally works", breakthrough commit after a loop.
  - Example: `Safari flexbox bug solved by min-width:0 after 2h debugging`.

- `quality: normal` — **straightforward, known solution**. Default. Visible for 30 days, standard scoring.
  - Signals: problem solved without struggle, known technique, "ok, works".

- `quality: low` — **trivia, edge case, low value**. **Excluded from loading** into intelligence layer.
  - Signals: one-time fix, will never recur, cosmetic.

### Rule
If the user overcame frustration → ALWAYS `quality: high`. Better false positive than losing a valuable pattern.

## Wikilinks (critical for graphify)

Graphify (`/graphify`) builds a knowledge graph from `[[wikilinks]]`. The more meaningful links, the better pattern matching in RuFlo. Current graph: 185 nodes, 238 edges.

### Linking rules

- Every note has **minimum 2 wikilinks** in body
- Problem → link to [[Tool]] / [[Technique]] that solves it, to [[Effort]] it arose within
- Decision → link to [[Rationale]] (if it exists) and [[Effort]] it concerns
- Effort → link to [[MOC]], [[People]] involved, [[Tools]] used
- Person → link to [[Organizations]], [[Efforts]], other related [[People]]
- Rationale → link to [[Decision]] and [[Effort]] it concerns

### Orphan notes
If a new note has nothing to link to → consider whether it's needed at all. Orphan = invisible in graphify = unavailable to intelligence layer.

## Graphify refresh

Knowledge graph (`graphify-out/graph.json`) must be up to date — used by RuFlo for ranking patterns in real time.

### When to refresh

- **After adding 5+ new notes** in `3 Atlas/` or `2 Efforts/`
- **Weekly** — as part of `/weekly-review`
- **After major vault refactors** (merging notes, moving between folders)
- **After bulk-adding [[wikilinks]]** to existing notes

### How
```
/graphify
```
Cost: ~$2-5 LLM per full refresh (100+ files). Incremental not currently supported — always full scan.

### Staleness check
Check mtime of `~/Desktop/Labirynt/graphify-out/graph.json`. If >7 days — refresh.

## RuFlo Integration

Vault is the permanent knowledge source, but the RuFlo cache (`~/.claude-flow/data/`) is the runtime index for the intelligence layer.

### Flow

1. **Session-start**: loader reads from vault:
   - `2 Efforts/` (active projects, 90d)
   - `3 Atlas/Problems/` (last 30d + all `quality: high`)
   - `3 Atlas/Code/` — reusable patterns (all, folder stays small)
   - `3 Atlas/Design/` — design principles (all)
   - `3 Atlas/Career/Decisions.md` (recent)
   - `graphify-out/graph.json` (~650 nodes, ~900 edges)
2. Intelligence builds `graph-state.json` from real graphify edges + local tag-based
3. PageRank + quality + type + recency → `ranked-context.json`
4. During work: each user prompt triggers lookup in ranked-context → top-5 relevant patterns go to LLM

### Implications for saving

- After solving a problem: SAVE to `3 Atlas/Problems/` with correct `quality:`, not just to daily note
- Without `quality:` frontmatter = pattern treated as `normal` (medium priority)
- Without wikilinks = invisible in graphify = lower chance of being loaded into intelligence

### Architecture
- **Obsidian** = permanent source of truth (PARA: never delete, archive in `Archive/`)
- **Graphify** = pre-computed knowledge graph (weekly refresh)
- **RuFlo cache** = volatile runtime index (rebuilt on every session-start)
- **Claude** = execution layer (receives top-K patterns per prompt)
