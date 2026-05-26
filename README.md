# Claudly — Claude Code with a brain.

### macOS / Linux
```bash
git clone https://github.com/dielamb/Claudly.git && cd Claudly && bash install.sh
```

### Windows (PowerShell)
```powershell
git clone https://github.com/dielamb/Claudly.git; cd Claudly; powershell -ExecutionPolicy Bypass -File install.ps1
```

Requires Anthropic API key (~500 MB download).

---

## What you get

| Component | What it does |
|---|---|
| **Claude Code** | Anthropic's AI coding CLI |
| **RTK** | 60-90% token savings on git, cargo, npm |
| **lean-ctx** | 46 MCP tools — context reduction, cached file reads |
| **claude-flow + ruflo** | Multi-agent orchestration |
| **screen-vision MCP** | Desktop screenshot tools |
| **symdex MCP** | Code analysis and symbol indexing |
| **Obsidian vault** | Second brain at `~/Desktop/Labirynt/` — 8 plugins |
| **147 skills** | GSD planning, research, review — invoked via `/skill-name` |
| **50+ hooks** | Pre/post tool use, session lifecycle, prompt routing |
| **6 plugins** | caveman, codex, impeccable, karpathy-skills, stripe, vercel |
| **graphify** | Knowledge graph builder — `/graphify` |
| **GSD framework** | Get Shit Done — plan, discuss, execute, review, audit |

---

## Claude remembers

- **Session start** — loads context automatically from Obsidian vault
- **Session end** — `/tldr` saves summary to daily note
- **Problems** — auto-saved to `3 Atlas/Problems/`
- **Domain knowledge** — `3 Atlas/Domains/` with Facts/Hypotheses/Rules
- **Knowledge graph** — `/graphify` builds connections from vault

---

## Platform support

| Feature | macOS | Windows | Linux |
|---------|-------|---------|-------|
| Claude Code | npm | npm | npm |
| RTK | brew / curl | winget / scoop | curl |
| lean-ctx | brew | winget / scoop | curl |
| Obsidian | brew cask | winget | manual |
| Cron/scheduled tasks | crontab + launchd | Task Scheduler | crontab |
| Shell hooks | zsh | PowerShell | bash/zsh |

---

## Post-install verification

```bash
claude --version
rtk --version && rtk gain
lean-ctx --version
claude mcp list
```

---

## Requirements

- macOS, Windows 10+, or Linux
- Node.js 18+
- Git
- Anthropic API key

---

## License

MIT
