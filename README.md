# Claudly — Claude Code with a brain.

```bash
curl -fsSL https://raw.githubusercontent.com/dielamb/Claudly/main/install.sh | bash
```

macOS only (Apple Silicon or Intel). Requires Anthropic API key (~500 MB download).

---

## What you get

| Component | What it does |
|---|---|
| **Claude Code** | Anthropic's AI coding CLI — the foundation |
| **RTK** | 60–90% token savings on git, cargo, npm, jest, and more |
| **lean-ctx** | 46 MCP tools — 99% context reduction, cached file reads with 10 modes |
| **claude-flow + ruflo** | Multi-agent orchestration for complex tasks |
| **screen-vision MCP** | Desktop screenshot tools directly in Claude |
| **symdex MCP** | Code analysis and symbol indexing |
| **GAN Loop** | Quality gate: generator/evaluator loop that auto-improves outputs to a score threshold |
| **Obsidian vault** | Second brain at `~/Desktop/Labirynt/` — 8 pre-installed plugins |
| **76 skills** | 76 reusable task programs — GSD planning, research, review, automation — invoked via `/skill-name` |
| **9 cron jobs** | Weekly review, nightly maintenance, monthly consolidation, health reports |

---

## Claude remembers

Claudly adds a persistent memory layer so Claude retains context across sessions.

- **Session start** — recent context loads automatically from your Obsidian vault
- **Session end** — `/tldr` saves a summary to your daily note

```
/tldr
```

- **Problems solved** — auto-saved to `3 Atlas/Problems/` so the same mistake never repeats
- **Domain knowledge** — maintained in `3 Atlas/Domains/`, applied by default on future tasks
- **Knowledge graph** — `/graphify` builds a 461+ node graph from your entire vault

```
/graphify
```

- **Weekly/monthly consolidation** — cron jobs surface patterns and promote hypotheses to rules

---

## How it works

Claudly is a three-layer system:

```
┌─────────────────────────────────────────┐
│  Layer 3 — Quality Gate (GAN Loop)      │
│  Generator → Evaluator → iterate        │
│  until score threshold is met           │
├─────────────────────────────────────────┤
│  Layer 2 — Memory (Obsidian vault)      │
│  Problems / Domains / Calendar          │
│  loaded at session start, saved at end  │
├─────────────────────────────────────────┤
│  Layer 1 — Claude Code + Tools          │
│  RTK · lean-ctx · MCP servers           │
│  Skills · Cron jobs                     │
└─────────────────────────────────────────┘
```

**Layer 1** slashes token costs and connects Claude to your desktop, codebase, and external tools.

**Layer 2** makes Claude remember: every solved problem and every domain insight persists in Obsidian, loaded back automatically next session.

**Layer 3** guarantees quality: production-level outputs go through a GAN loop — a generator agent writes, an evaluator agent scores, and the loop iterates until the output clears a configurable threshold (8.0 – 9.0).

---

## GAN Loop

The quality gate runs automatically on production imperatives (write, build, create, generate).

**Manual run:**

```bash
cd ~/.claude/tools/gan-loop && ./run.sh briefs/task.md
```

**Profiles:**

| Profile | Threshold | Iterations | Time | Mode |
|---|---|---|---|---|
| `fast` | 8.0 | 2 | ~30 sec | sync |
| `default` | 8.5 | 3 | ~2–3 min | sync |
| `code` | 9.0 | 3 | async | background |

Set profile in your brief frontmatter:

```markdown
---
task: my-task
profile: default
---
```

---

## Post-install verification

```bash
# Claude Code
claude --version

# RTK token savings
rtk --version
rtk gain

# lean-ctx MCP
claude mcp list

# Obsidian vault
ls ~/Desktop/Labirynt/

# GAN Loop
ls ~/.claude/tools/gan-loop/briefs/
```

---

## Requirements

- macOS (Apple Silicon or Intel)
- Internet connection (~500 MB download)
- Anthropic API key (prompted during install)

---

## License

MIT
