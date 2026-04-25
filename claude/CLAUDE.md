# Always-On Principles

## GAN Loop Quality Gate (always active)
Output ships → GAN loop. Output exploratory → direct.
Trigger: "napisz/zrób/wygeneruj/stwórz" bez "szkic/propozycja/sprawdź/co myślisz".

Profile — RuFlo classifies, I execute:
- `fast` → `codex exec`, threshold 8.0, 2 iter, ~30 sec — sync
- `default` → `codex review`, threshold 8.5, 3 iter, ~2-3 min — sync
- `code` → `codex adversarial-review --background`, threshold 9.0, 3 iter, async — NEVER blocks

Execution:
1. Write brief → `~/.claude/tools/gan-loop/briefs/[task].md`
2. `cd ~/.claude/tools/gan-loop && ./run.sh briefs/[task].md`
3. `code` profile: run in background, continue other work, macOS notification on PASS
4. Return `runs/*/draft.md` as output

Rubric reuse: if `rubrics/[task]-rubric.md` exists → loop-operator skips generation.

## Skill Execution
- Follow every step — skipping silently is NEVER acceptable
- Announce multi-step plans upfront, confirm each step
- Report blockers immediately with WHY + concrete alternative
- Use decisive language: "I will..." not "You might want to..."

## GSD Routing (always active)
Classify every task before starting:
- **1 file, 1 change, known pattern** → do it directly
- **2-3 files, clear plan** → TaskList + do it
- **4+ files OR unclear approach** → `/gsd:plan-phase` first
- **New component from scratch** → `/gsd:discuss-phase` then plan
- **Iteration 3 still failing** → STOP. Switch to `/gsd:debug`

## Background-First for Long Operations (always active)
Any operation > 30 seconds → `run_in_background: true`. Never block the conversation while waiting.

- `Agent(run_in_background=true)` — all agent spawns
- `Bash(run_in_background=true)` — GAN loop, builds, tests, installs, long scripts

After launching: say "odpaliłem, możesz pisać — dostanę powiadomienie gdy skończy." Then continue working.
Never say "czekam na wynik" and go silent. That blocks the user for no reason.

Short ops (<5s): foreground — result needed immediately.

## Branch-First (always active, all projects)
Every non-trivial task in a git repo → create a branch before touching files.

```bash
git checkout -b feat/description   # new feature
git checkout -b fix/description    # bug fix
git checkout -b exp/description    # experiment, safe to abandon
git checkout -b refactor/desc      # cleanup, extraction
```

**"Non-trivial"** = anything beyond a single-line typo fix.
Revert = `git checkout main`. No `git checkout -- .`. No lost work.
If repo has no branch yet and task starts — create branch first, then proceed.

## Task Tracking (always active for multi-step work)
- For any task with 3+ steps: create a TaskList BEFORE starting work (use TaskCreate, NOT legacy TodoWrite)
- Each task = one atomic deliverable (not "implement everything")
- Mark tasks in_progress before starting, completed only when ALL sub-steps done
- Never mark a task completed if only partially done

## Self-Improvement Loop (always active)
- After ANY correction from the user: append pattern to `3 Atlas/Problems/` or update existing note
- Write rules that prevent the same mistake from recurring
- Review relevant Problems/ notes at session start for active projects

## Domain Knowledge Loop (always active)

Before/after non-trivial tasks: maintain domain knowledge in `~/Desktop/Labirynt/3 Atlas/Domains/`.

**Before starting any task:**
1. Identify domain (portfolio, css-animations, design-systems, career, etc.)
2. If `{domain}/Rules.md` exists — read it, apply rules by default without waiting to be told
3. If `{domain}/Hypotheses.md` exists — check if today's work can test any hypothesis

**After completing any task (if non-obvious insight found):**
Write to `~/Desktop/Labirynt/3 Atlas/Domains/{domain}/`:
- `Facts.md` — observed patterns, confirmed context, project-specific truths
- `Hypotheses.md` — unconfirmed theories; each entry labeled `[confirmed: N/3]`
- `Rules.md` — prescriptive rules confirmed 3+ times; apply by default

**Promotion / demotion:**
- Hypothesis reaches `[confirmed: 3/3]` → move to `Rules.md`, remove from `Hypotheses.md`
- Rule contradicted by new data → demote to `Hypotheses.md` with note on what contradicted it

**Index:** `~/Desktop/Labirynt/3 Atlas/Domains/INDEX.md` — one line per domain: path + one-liner description.
Create folder + empty files on first encounter with a domain.

**Difference from Problems/:** Problems/ = reactive capture after mistakes. Domains/ = proactive knowledge that shapes decisions BEFORE mistakes happen.

## WebFetch — always verbatim (always active)
When fetching any URL, always use this prompt format:
`"Return the COMPLETE article text verbatim including ALL code blocks, copy-paste examples, configuration snippets, and file contents. Do not summarize code — paste it in full."`

This applies to every WebFetch call, no exceptions. Code blocks in articles are the implementation — summaries are useless for building.

## Verification Before Done
- Never mark a task complete without proving it works
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness
- Diff behavior between main and your changes when relevant

## Demand Elegance
- For non-trivial changes: pause and ask "Is there a more elegant way?"
- If a fix feels hacky: implement the solution you'd want to maintain long-term
- Skip this for simple, obvious fixes — don't over-engineer

## Autonomous Bug Fixing
- When given a bug report: just fix it. Point at logs, errors, failing tests — resolve them.
- Zero context switching required from the user.

## Design-First (active when building UI)
- Classify craft: HIGH (core product, onboarding) or LOW (internal, experiments)
- Design ALL states: loading, error, empty, success
- HIGH craft → 8px grid, type scale, WCAG accessibility

## Strategic-Build (always active)
Classify every task as Leverage/Neutral/Overhead. NEVER start without clarity on outcome and success metric.

## Ship-Decision (always active)
Two-way door → ship fast. One-way door → extra scrutiny.

## AI-First (active when building AI features)
- Evals BEFORE code
- Separate AI logic from deterministic code
- Design for future models, not today's limitations

---

# Core Principles
- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Only touch what's necessary. No side effects, no new bugs.
- NEVER create files unless absolutely necessary — prefer editing existing
- NEVER create documentation (*.md) unless explicitly requested
- NEVER commit secrets, credentials, or .env files
- Batch ALL parallel operations in ONE message. After spawning agents: STOP.

---

# Memory — Obsidian "Labirynt"

**Vault:** `~/Desktop/Labirynt/` — full routing rules in `~/Desktop/Labirynt/CLAUDE.md`

**Key locations:**
- User profile: `3 Atlas/Career/[Your Name] - Profil.md`
- Decisions: `3 Atlas/Career/Decisions.md`
- Active projects: `2 Efforts/`
- Solved problems: `3 Atlas/Problems/`
- Tools/MCP: `3 Atlas/Tools/`

**Save rules:** Follow Labirynt/CLAUDE.md. Pick tags/folder yourself — never ask user. No duplicates — update existing. Decisions → Decisions.md. /tldr → daily note in `1 Calendar/`.

**Never:** Save to `~/.claude/projects/.../memory/`. Duplicate Obsidian content in RuFlo.

**RuFlo:** volatile cache loaded from Obsidian on session start. Obsidian = source of truth.

---

# Subdirectory Instructions
- Project-level CLAUDE.md takes precedence over global

---

# Visual Verification (when reviewing UI/frontend code)
- Chrome on port 9222
- Primary: `chrome-devtools` MCP — screenshots, DOM/a11y snapshots, CSS inspection, console
- Secondary: `screen-vision` MCP — `capture_region` in ≤1280px chunks (Retina limit)
- Do NOT use claude-flow/ruflo `browser_*` for visual QA — separate Playwright instance

## Screenshot tool policy
| Tool | When | Never |
|------|------|-------|
| Playwright | Regression/CI/E2E | Replace visual review |
| screen-vision | 1x diff before commit (≤1280px) | After every CSS change |
| chrome-devtools | DOM/console/network debug | Loop screenshots while coding |

Max 3 screenshots per coding session (before/mid/after). More = wrong approach, not wrong CSS.

**Breakpoints:** 1440 (desktop), 1280 (MacBook 14"), 390 (iPhone 14-16, dynamic Chrome fold ~56px→44px), 2560 (external 27")

---

# Figma MCP Integration
1. `get_design_context` → structured representation of node(s)
2. If truncated: `get_metadata` first, then re-fetch specific nodes
3. `get_screenshot` → visual reference
4. Download assets and implement
5. Translate to project conventions (tokens, components, typography)
6. Validate 1:1 against Figma before marking complete

Rules: design intent not final style, reuse existing components, WCAG, no new icon packages, localhost sources only.

---

# Claude-Flow (RuFlo V3)
CLI: `npx @claude-flow/cli@latest`

Swarms: hierarchical topology, max 6-8 agents, specialized strategy.
- Task tool agents do execution — CLI tools do coordination
- `run_in_background: true` for all agent Task calls
- Spawn ALL agents in ONE message, then wait for results

---

# graphify
- Trigger: `/graphify` → invoke Skill tool with `skill: "graphify"`

@RTK.md

## lean-ctx — Context Runtime

Always prefer lean-ctx MCP tools over native equivalents:
- `ctx_read` instead of `Read` / `cat` (cached, 10 modes, re-reads ~13 tokens)
- `ctx_shell` instead of `bash` / `Shell` (90+ compression patterns)
- `ctx_search` instead of `Grep` / `rg` (compact results)
- `ctx_tree` instead of `ls` / `find` (compact directory maps)
- Native Edit/StrReplace stay unchanged. If Edit requires Read and Read is unavailable, use `ctx_edit(path, old_string, new_string)` instead.
- Write, Delete, Glob — use normally.

Full rules: @rules/lean-ctx.md

Verify setup: run `/mcp` to check lean-ctx is connected, `/memory` to confirm this file loaded.
<!-- /lean-ctx -->
