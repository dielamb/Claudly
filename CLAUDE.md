# claude-setup

This repo is a Claude Code setup installer. It contains global config, hooks,
skills, agents, GAN loop, and Obsidian vault template.

## What this is

Run `install.sh` to get the full Claude Code intelligence stack on a new machine.
See `GETTING_STARTED.md` after install.

## Repo structure

```
claude/      → installs to ~/.claude/
gan-loop/    → installs to ~/tools/gan-loop/
obsidian/    → installs to ~/Desktop/Labirynt/
install.sh   → entry point
```

## Working on this repo

When modifying config files in `claude/`, note that paths use `__HOME__` and
`__USERNAME__` placeholders — `install.sh` replaces them at install time.

Do NOT commit:
- `claude/settings.local.json` (personal permissions)
- `claude/projects/` (session data)
- `obsidian/vault/.obsidian/plugins/obsidian-excalidraw-plugin/main.js` (8MB binary)
- Any `*.pem`, `*.key`, credentials files

See `.gitignore` for full exclusion list.
