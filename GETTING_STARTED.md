# Getting Started

## What you installed

| Tool | Purpose |
|------|---------|
| **Claude Code** | AI coding CLI |
| **RTK** | Token optimizer — 60-90% cheaper API calls |
| **lean-ctx** | Context optimizer — 46 MCP tools for file reading |
| **claude-flow** | Multi-agent orchestration (RuFlo) |
| **Obsidian vault** | Second brain — AI routes knowledge here automatically |

---

## Step 1 — Restart terminal

Shell hooks activate only in new sessions:
```bash
rtk --version
lean-ctx --version
claude --version
```

---

## Step 2 — Open Obsidian vault

1. Open Obsidian app
2. **Open folder as vault** → select `~/Desktop/Labirynt`
3. When prompted: **Enable community plugins**
4. Plugins active: Templater, Dataview, Calendar, Excalidraw, Omnisearch, QuickAdd, Tag Wrangler, Homepage

Vault structure:
```
0 Inbox/      — low-confidence notes
1 Calendar/   — daily notes, session summaries (/tldr)
2 Efforts/    — active projects
3 Atlas/      — knowledge base (Problems, Domains, Synthesis...)
4 People/     — person notes
5 Sources/    — books, articles, courses
6 Maps/       — MOC for 5+ related notes
Archive/      — never delete, move here instead
```

---

## Step 3 — Run Claude Code

```bash
claude
```

First session:
- Claude reads `~/.claude/CLAUDE.md` — all rules loaded
- Memory hooks fire on session start — loads context from Obsidian
- Type `/help` to see available skills

---

## Core skills

| Skill | When to use |
|-------|-------------|
| `/gsd-plan-phase` | Plan a multi-file task |
| `/gsd-execute-phase` | Execute planned phase |
| `/graphify` | Build knowledge graph from any input |
| `/tldr` | Save session summary to Obsidian |
| `/research` | Deep web research with memory |
| `/ship` | Merge, bump version, create PR |
| `/qa` | QA test site + auto-fix bugs |
| `/review` | Pre-landing PR review |

---

## RTK — token savings

Transparent — all commands auto-proxied via hooks:
```bash
git status          # → rtk git status (60% cheaper)
npm run build       # → rtk npm run build (87% cheaper)
rtk gain            # see total savings
```

---

## Memory system

Claude writes to Obsidian automatically:
1. Session start — loads recent context from `3 Atlas/`
2. Problems → `3 Atlas/Problems/`
3. Domain knowledge → `3 Atlas/Domains/{domain}/`
4. Session summary → `1 Calendar/YYYY-MM-DD.md` (via `/tldr`)

---

## Troubleshooting

**lean-ctx MCP tools missing:**
```bash
lean-ctx init --agent claude
```

**RTK not working:**
```bash
export PATH="$HOME/.local/bin:$PATH"
rtk trust
```

**API key missing:**
```bash
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.zshrc
source ~/.zshrc
```
