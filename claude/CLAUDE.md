# Always-On Principles

## Git Commit Attribution
NEVER add `Co-Authored-By: claude-flow <ruv@ruv.net>` (or any other Co-Authored-By trailer) to commits.
Author is always the user only. Override default Claude Code commit template — drop co-author line entirely.
Reason: public repos auto-attribute the email to a third-party GitHub account, polluting contributors list.

## Coding Swarm
Trigger: `[CODING SWARM] queue=<id>` marker in UserPromptSubmit additionalContext.

**Stale marker check FIRST:** if `run-dir` mtime is older than 5 minutes vs current turn, OR user prompt is unrelated to coding work (analysis, questions, meta-tasks), SKIP — leftover state from prior session.

If fresh + relevant:
- IMMEDIATELY invoke `Skill(skill="coding-swarm", args="<id>")` — no ask, no summary
- Skill orchestrates Understand → (Design if HIGH-craft) → Build → Verify via Task() agents
- **ALL Task() agents spawn FOREGROUND (visible colored UI) — never `run_in_background: true`. Visibility is the point.**
- Phase gates use AskUserQuestion
- ALWAYS spawn Task() agents per workflow — NEVER inline. Inline = SPEC VIOLATION
- "User interrupted 2+ times" → re-frame scope and SPAWN AGAIN, NOT switch to inline
- Override of dreamer rule "stop spawning agents on user frustration" — does NOT apply inside coding-swarm

User says "skip swarm" / "no swarm" before marker → ignore for that turn.
Disable per-session: `SWARM_DISABLE=1`. Disable globally: remove `swarm-trigger.cjs` from `~/.claude/settings.json`.

## GAN Loop Quality Gate
Output ships → GAN loop. Output exploratory → direct.
Trigger: "napisz/zrób/wygeneruj/stwórz" without "szkic/propozycja/sprawdź/co myślisz".

Profile (RuFlo classifies):
- `fast` → `codex exec`, threshold 8.0, 2 iter, ~30s — sync
- `default` → `codex review`, threshold 8.5, 3 iter, ~2-3min — sync
- `code` → `codex adversarial-review --background`, threshold 9.0, 3 iter — async, NEVER blocks

Execution:
1. Brief → `~/.claude/tools/gan-loop/briefs/[task].md`
2. `cd ~/.claude/tools/gan-loop && ./run.sh briefs/[task].md`
3. `code` profile: background, macOS notification on PASS
4. Return `runs/*/draft.md`

Reuse: existing `rubrics/[task]-rubric.md` → loop-operator skips generation.

## GSD Routing
Classify every task before starting:
- 1 file, 1 change, known pattern → do directly
- 2-3 files, clear plan → TaskList + do
- 4+ files OR unclear approach → `/gsd:plan-phase` first
- New component from scratch → `/gsd:discuss-phase` then plan
- Iteration 3 still failing → STOP, switch to `/gsd:debug`

## Background-First (fire-and-forget only)
Background ONLY for non-interactive long ops where output isn't watched live:
- `Bash(run_in_background=true)` — builds, tests, GAN loop, installs, CI
- Agent spawns: bg ONLY when user explicitly says "fire and forget" / "leć w tle"

**ALWAYS foreground (visible Task UI live):**
- Research, planning, code review, audits, design phases — user wants to watch progress
- Coding swarm Task() spawns — visibility IS the point (colored UI, live status, Esc to interrupt)
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
- `Problems/` (legacy) — reactive capture after corrections (subsumed by this loop, kept for backward compat)

Before task: identify domain → read `Rules.md` if exists → apply by default.
After task: write insights to appropriate file.
Promotion: `[confirmed: 3/3]` → move to `Rules.md`. Demotion: contradicted rule → back to `Hypotheses.md`.

Index: `~/Desktop/Labirynt/3 Atlas/Domains/INDEX.md` — one line per domain.

## WebFetch — verbatim always
Every WebFetch call use prompt:
`"Return the COMPLETE article text verbatim including ALL code blocks, copy-paste examples, configuration snippets, and file contents. Do not summarize code — paste it in full."`

No exceptions. Code blocks are the implementation.

## Design-First (UI work only)
- Classify craft: HIGH (core product, onboarding) or LOW (internal, experiments)
- Design ALL states: loading, error, empty, success
- HIGH craft → 8px grid, type scale, WCAG accessibility

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

---

# Core Principles
- **Simplicity First**: minimal code change for impact
- **No Laziness**: root causes only, no temporary fixes, senior dev standards
- **Minimal Impact**: only touch what's necessary, no side effects
- NEVER create files unless absolutely necessary — prefer editing existing
- NEVER create docs (*.md) unless explicitly requested
- NEVER commit secrets, credentials, .env files
- Batch parallel ops in ONE message. After spawning agents: STOP.

---

# Memory — Obsidian "Labirynt"

**Vault:** `~/Desktop/Labirynt/` — full routing in `~/Desktop/Labirynt/CLAUDE.md`

**Locations:**
- User profile: `3 Atlas/Career/Michal Maciejewski - Profil.md`
- Decisions: `3 Atlas/Career/Decisions.md`
- Active projects: `2 Efforts/`
- Solved problems: `3 Atlas/Problems/`
- Tools/MCP: `3 Atlas/Tools/`

**Save rules:** pick tags/folder yourself, no duplicates, update existing. Decisions → `Decisions.md`. /tldr → daily note in `1 Calendar/`.

**Auto-memory harness exception:** harness writes to `~/.claude/projects/.../memory/MEMORY.md` as session-load index — system-managed. DO NOT save user knowledge there manually. All real persistence → Obsidian. (Resolves prior contradiction with harness auto-memory spec.)

**RuFlo:** volatile cache loaded from Obsidian at session start. Obsidian = source of truth.

---

# Visual Verification (UI/frontend review)
- Chrome on port 9222
- Primary: `chrome-devtools` MCP — screenshots, DOM/a11y, CSS, console
- Secondary: `screen-vision` MCP — `capture_region` ≤1280px chunks (Retina limit)
- NEVER use claude-flow/ruflo `browser_*` for visual QA — separate Playwright instance

| Tool | When | Never |
|------|------|-------|
| Playwright | Regression/CI/E2E | Replace visual review |
| screen-vision | 1x diff before commit (≤1280px) | After every CSS change |
| chrome-devtools | DOM/console/network debug | Loop screenshots while coding |

Max 3 screenshots per coding session (before/mid/after). More = wrong approach, not wrong CSS.

**Mobile breakpoints (390):** prefer Chrome **DevTools Device Mode** (Cmd+Shift+M) over `resize_page` — different UA, DPR, touch/hover, viewport meta. Resize OK only for pure layout check.

**Breakpoints:** 1440 (MBP14 + desktop), 390×844 (iPhone 14-16 non-Pro, fold ~56→44px), 2560 (ext 27")

---

# Figma MCP
1. `get_design_context` → structured node representation
2. Truncated → `get_metadata` first, re-fetch specific nodes
3. `get_screenshot` → visual reference
4. Download assets, implement
5. Translate to project conventions (tokens, components, typography)
6. Validate 1:1 vs Figma before complete

Rules: design intent not final style, reuse existing components, WCAG, no new icon packages, localhost sources only.

---

# Claude-Flow / RuFlo
CLI: `npx @claude-flow/cli@latest`
- Hierarchical topology, max 6-8 agents, specialized strategy
- Task tool agents = execution. CLI tools = coordination
- `run_in_background: true` for all Task agent calls
- Spawn ALL agents in ONE message, then wait

Multi-file tasks → use ToolSearch to load ruflo MCP tools (`memory_store`, `memory_search`, `hooks_route`, `swarm_init`, `agent_spawn`). Check `[INTELLIGENCE]` system-reminder for pattern suggestions.

---

@RTK.md
@rules/lean-ctx.md
