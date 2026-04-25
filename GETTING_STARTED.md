# Getting Started

## What you installed

| Tool | Purpose |
|------|---------|
| **Claude Code** | AI coding CLI — main interface |
| **RTK** | Token optimizer — 60-90% cheaper API calls |
| **lean-ctx** | Context optimizer — 46 MCP tools for file reading |
| **claude-flow** | Multi-agent orchestration (RuFlo) |
| **GAN Loop** | Quality gate — auto-improves outputs via generator/evaluator loop |
| **Obsidian vault** | Second brain — AI routes knowledge here automatically |

---

## Step 1 — Restart terminal

Shell hooks activate only in new sessions:
```bash
# New terminal, then verify:
rtk --version
lean-ctx --version
claude --version
```

---

## Step 2 — Open Obsidian vault

1. Open Obsidian app
2. **Open folder as vault** → select `~/Desktop/Labirynt`
3. When prompted: **Enable community plugins** (required — pre-installed)
4. Plugins active: Templater, Dataview, Calendar, Excalidraw, Omnisearch, QuickAdd, Tag Wrangler, Homepage

Vault structure:
```
0 Inbox/      ← low-confidence notes, AI dumps here when unsure
1 Calendar/   ← daily notes, session summaries (/tldr saves here)
2 Efforts/    ← active projects
3 Atlas/      ← knowledge base (Problems, Domains, Synthesis, Reasoning...)
4 People/     ← person notes
5 Sources/    ← books, articles, courses
6 Maps/       ← MOC (map of content) for 5+ related notes
Archive/      ← never delete, move here instead
```

---

## Step 3 — Run Claude Code

```bash
claude
```

**First session:**
- Claude reads `~/.claude/CLAUDE.md` automatically — all rules loaded
- Memory hooks fire on session start → loads context from Obsidian
- Type `/help` to see available skills

---

## Core skills

| Skill | When to use |
|-------|-------------|
| `/gsd` | Any multi-step task — auto-routes to right GSD command |
| `/graphify` | Build knowledge graph from any input |
| `/tldr` | Save session summary to Obsidian (run at session end) |
| `/weekly-review` | Consolidate week's notes |
| `/research` | Deep web research with memory |
| `/caveman` | Ultra-compressed communication mode |

---

## GAN Loop — quality gate

Automatically improves outputs. Triggered when you use words like "napisz/zrób/stwórz/wygeneruj" (Polish: write/do/create/generate).

Manual use:
```bash
cd ~/.claude/tools/gan-loop

# Create a brief:
cat > briefs/my-task.md << 'EOF'
---
task: my-task
profile: default
---
Write a compelling product description for X.
EOF

# Run:
./run.sh briefs/my-task.md
```

Profiles: `fast` (~30s), `default` (~2-3min), `code` (async, background)

---

## RTK — token savings

RTK is transparent — all commands auto-proxied via hooks:
```bash
git status          # → rtk git status (60% cheaper)
npm run build       # → rtk npm run build (87% cheaper)
cargo test          # → rtk cargo test (90% cheaper)
rtk gain            # see total savings
```

---

## Memory system

Claude writes to Obsidian automatically. On every session:
1. Session start hook loads recent context from `3 Atlas/`
2. Problems → `3 Atlas/Problems/`
3. Domain knowledge → `3 Atlas/Domains/{domain}/`
4. Decisions → `3 Atlas/Career/Decisions.md`
5. Session summary → `1 Calendar/YYYY-MM-DD.md` (via `/tldr`)

Run `/tldr` at end of each session to preserve key learnings.

---

## Troubleshooting

**lean-ctx MCP tools missing** (`ctx_read` not available):
```bash
lean-ctx init --agent claude
```

**RTK not working:**
```bash
export PATH="$HOME/.local/bin:$PATH"
rtk trust   # if prompted about filters
```

**Hooks failing:**
```bash
claude mcp list        # check lean-ctx is registered
lean-ctx doctor        # lean-ctx self-diagnosis
```

**API key missing:**
```bash
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.zshrc
source ~/.zshrc
```
