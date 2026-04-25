# claude-setup — Agent Instructions

Cross-agent compatibility note: all skills follow the Agent Skills spec
(`name` + `description` frontmatter). Compatible with Claude Code, Codex CLI,
OpenCode, and similar tools.

## Skills discovery

Skills live in `claude/skills/<name>/`. Each skill has a `skill.md` entrypoint.

Symlink for other agents:
```bash
# Codex CLI
ln -s "$(pwd)/claude/skills" ~/.codex/skills/claude-setup

# OpenCode
ln -s "$(pwd)/claude/skills" ~/.opencode/skills/claude-setup
```

## Core skills (memory layer)

| Skill | Trigger |
|-------|---------|
| `/graphify` | Build knowledge graph from any input |
| `/tldr` | Save session summary → Obsidian `1 Calendar/` |
| `/weekly-review` | Consolidate week's notes into Atlas |
| `/consolidate` | Monthly knowledge synthesis |
| `/research` | Deep research with Obsidian memory |
| `/gsd` | Get Shit Done — task routing & execution |
| `/gsd-intel` | Query codebase intelligence |
| `/hooks-automation` | Hook wiring and automation |

## Memory architecture

```
Obsidian vault (~/Desktop/Labirynt/)
  ├── hot.md equivalent → 3 Atlas/Synthesis/  (session context)
  ├── knowledge base    → 3 Atlas/             (permanent storage)
  ├── daily notes       → 1 Calendar/          (/tldr saves here)
  └── active work       → 2 Efforts/

GAN Loop (~/tools/gan-loop/)
  └── quality gate — generator/evaluator loop on outputs
```

## Bootstrap (first session)

1. Read `~/.claude/CLAUDE.md` — all rules auto-loaded by Claude Code
2. Read `~/Desktop/Labirynt/CLAUDE.md` — vault routing rules
3. Run `/tldr` at session end to persist learnings

## GAN Loop

Triggered automatically on "napisz/zrób/stwórz/wygeneruj" verbs.
Manual: `cd ~/tools/gan-loop && ./run.sh briefs/task.md`
