# Always-On Principles

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```
Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## GSD Routing
Classify every task before starting:
- 1 file, 1 change, known pattern → do directly
- 2-3 files, clear plan → TaskList + do
- 4+ files OR unclear approach → `/gsd:plan-phase` first
- New component from scratch → `/gsd:discuss-phase` then plan
- Iteration 3 still failing → STOP, switch to `/gsd:debug`

## Background-First (fire-and-forget only)
Background ONLY for non-interactive long ops where output isn't watched live:
- `Bash(run_in_background=true)` — builds, tests, installs, CI
- Agent spawns: bg ONLY when user explicitly says "fire and forget"

**ALWAYS foreground (visible Task UI live):**
- Research, planning, code review, audits — user wants to watch progress
- Anything user invoked interactively (`/gsd-*`, `/ultrareview`, etc)

After launching bg op: brief status + continue working. Never go silent on long-running call.
Short ops (<5s): foreground.

## Branch-First (git repos only)
Non-trivial task in git repo → branch BEFORE touching files. Skip if `Is a git repository: false`.

```
git checkout -b feat/desc      # new feature
git checkout -b fix/desc       # bug fix
git checkout -b exp/desc       # experiment, safe to abandon
git checkout -b refactor/desc  # cleanup, extraction
```

Non-trivial = anything beyond single-line typo fix.
Revert = `git checkout main`. No `git checkout -- .`. No lost work.

## Task Tracking
Task with 3+ steps: TaskList BEFORE starting (use TaskCreate, NOT legacy TodoWrite).
Each task = one atomic deliverable. Mark in_progress before start, completed only when ALL sub-steps done.

## Domain Knowledge Loop
Maintain `~/Desktop/Labirynt/3 Atlas/Domains/{domain}/`:
- `Facts.md` — observed patterns, confirmed truths
- `Hypotheses.md` — unconfirmed; label `[confirmed: N/3]`
- `Rules.md` — confirmed 3+ times; apply by default

Before task: identify domain → read `Rules.md` if exists → apply by default.
After task: write insights to appropriate file.
Promotion: `[confirmed: 3/3]` → move to `Rules.md`. Demotion: contradicted rule → back to `Hypotheses.md`.

Index: `~/Desktop/Labirynt/3 Atlas/Domains/INDEX.md` — one line per domain.

## WebFetch — verbatim always
Every WebFetch call use prompt:
`"Return the COMPLETE article text verbatim including ALL code blocks, copy-paste examples, configuration snippets, and file contents. Do not summarize code — paste it in full."`

No exceptions. Code blocks are the implementation.

## Verification Before Done
- Never mark a task complete without proving it works
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness
- Diff behavior between main and your changes when relevant

## Autonomous Bug Fixing
- When given a bug report: just fix it. Point at logs, errors, failing tests — resolve them.
- Zero context switching required from the user.

---

# Memory — Obsidian "Labirynt"

**Vault:** `~/Desktop/Labirynt/` — full routing in `~/Desktop/Labirynt/CLAUDE.md`

**Locations:**
- User profile: `3 Atlas/Career/Your Name - Profil.md`
- Decisions: `3 Atlas/Career/Decisions.md`
- Active projects: `2 Efforts/`
- Solved problems: `3 Atlas/Problems/`
- Tools/MCP: `3 Atlas/Tools/`

**Save rules:** pick tags/folder yourself, no duplicates, update existing. Decisions → `Decisions.md`. /tldr → daily note in `1 Calendar/`.

**RuFlo:** volatile cache loaded from Obsidian at session start. Obsidian = source of truth.

---

# Claude-Flow / RuFlo
CLI: `npx @claude-flow/cli@latest`
- Hierarchical topology, max 6-8 agents, specialized strategy
- Task tool agents = execution. CLI tools = coordination
- Spawn ALL agents in ONE message, then wait

Multi-file tasks → use ToolSearch to load claude-flow MCP tools (`memory_store`, `memory_search`, `hooks_route`, `swarm_init`, `agent_spawn`). Check `[INTELLIGENCE]` system-reminder for pattern suggestions.

**Semantic memory search:** `mcp__claude-flow__memory_search_unified` — searches entries with ONNX 384-dim vectors (Obsidian notes, patterns, rules, synthesis). Use when:
- BM25 hook missed (prior-knowledge shows generic/irrelevant results)
- User asks about a past problem/pattern without using exact keywords
- Technical question where semantic match beats keyword match
Load via ToolSearch before calling.

**Auto-trigger rule:** When `[MEMORY_SEARCH_HINT: <query>]` appears in additionalContext AND the `[INTELLIGENCE]` patterns are clearly unrelated to the user's actual task — PROACTIVELY load and call `mcp__claude-flow__memory_search_unified` with the query BEFORE responding.

---

# gstack

All web browsing through `/browse` skill from gstack. NEVER use `mcp__claude-in-chrome__*` tools.

Available skills:
/office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /review, /ship, /land-and-deploy, /canary, /benchmark, /browse, /connect-chrome, /qa, /qa-only, /setup-browser-cookies, /setup-deploy, /retro, /investigate, /document-release, /codex, /cso, /autoplan, /plan-devex-review, /devex-review, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade, /learn

---

@RTK.md
@rules/lean-ctx.md
