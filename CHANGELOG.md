# Changelog

All notable changes to this project will be documented in this file.
Format: [Semantic Versioning](https://semver.org/)

---

## [1.0.0] — 2026-04-25

### Added
- `install.sh` — one-command installer for the full Claude Code intelligence stack
- `claude/` — global Claude Code config (hooks, agents, skills, GSD framework)
  - Memory layer: graphify, tldr, weekly-review, consolidate, hooks-automation
  - GSD framework: 60+ skills for task routing and execution
  - Core agents: coder, planner, researcher, reviewer, tester
  - helpers-user: obsidian loaders, quality rescorer, synthesis injector
  - hooks: GSD guards, intelligence wiring, caveman mode
- `gan-loop/` — GAN quality gate (generator/evaluator loop)
  - run.sh, gan-classifier.sh, gan.json
  - 4 agents: gan-generator, gan-evaluator, loop-operator, rubric-generator
- `obsidian/` — Obsidian vault template
  - Folder structure: Inbox/Calendar/Efforts/Atlas/People/Sources/Maps/Archive
  - Pre-configured .obsidian: graph, hotkeys, daily-notes, appearance
  - 8 community plugins pre-installed: Templater, Dataview, Calendar,
    Omnisearch, QuickAdd, Tag Wrangler, Homepage
  - Excalidraw downloaded at install time (8MB, not tracked in git)
- `GETTING_STARTED.md` — onboarding guide with skill reference and troubleshooting
- `AGENTS.md` — cross-agent compatibility (Codex CLI, OpenCode)
- `.gitignore` — Obsidian artifacts, secrets, runtime state

### Tools installed
- Claude Code (`@anthropic-ai/claude-code`)
- RTK v0.37+ (`brew install rtk`)
- lean-ctx (`brew install lean-ctx`)
- claude-flow / RuFlo (`@claude-flow/cli`)
- Obsidian (`brew install --cask obsidian`)
