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
| **Obsidian vault** | Second brain at `~/Desktop/Labirynt/` — 8 pre-installed plugins |
| **226 skills** | Reusable task programs — GSD planning, research, review, design, market analysis — invoked via `/skill-name` |
| **40 agents** | Specialized agents for code review, planning, security audits, design, and more |
| **6 plugins** | caveman, codex, impeccable, karpathy-skills, stripe, vercel |
| **50+ hooks** | Pre/post tool use, session lifecycle, prompt routing, quality gates |
| **9 cron jobs** | Weekly review, nightly maintenance, monthly consolidation, health reports |
| **graphify** | Knowledge graph builder — `/graphify` to visualize your vault connections |
| **GSD framework** | Get Shit Done — plan, discuss, execute, review, audit workflows |
| **Domain knowledge loop** | Auto-maintained `Facts → Hypotheses → Rules` per domain |

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
- **Knowledge graph** — `/graphify` builds a node graph from your entire vault

```
/graphify
```

- **Weekly/monthly consolidation** — cron jobs surface patterns and promote hypotheses to rules

---

## How it works

Claudly is a two-layer system:

```
┌─────────────────────────────────────────┐
│  Layer 2 — Memory (Obsidian vault)      │
│  Problems / Domains / Calendar          │
│  loaded at session start, saved at end  │
│  graphify knowledge graph + RuFlo       │
├─────────────────────────────────────────┤
│  Layer 1 — Claude Code + Tools          │
│  RTK · lean-ctx · MCP servers           │
│  226 Skills · 40 Agents · 50+ Hooks     │
│  GSD framework · Domain knowledge loop  │
└─────────────────────────────────────────┘
```

**Layer 1** slashes token costs and connects Claude to your desktop, codebase, and external tools. 226 skills automate common workflows. 50+ hooks handle prompt routing, quality gates, and session lifecycle.

**Layer 2** makes Claude remember: every solved problem and every domain insight persists in Obsidian, loaded back automatically next session. Graphify builds a knowledge graph. RuFlo ranks patterns by relevance.

---

## Post-install verification

```bash
# Claude Code
claude --version

# RTK token savings
rtk --version
rtk gain

# lean-ctx MCP
lean-ctx --version
claude mcp list

# Obsidian vault
ls ~/Desktop/Labirynt/

# Skills
claude  # then type: /help
```

---

## Requirements

- macOS (Apple Silicon or Intel)
- Internet connection (~500 MB download)
- Anthropic API key (prompted during install)

---

## License

MIT
