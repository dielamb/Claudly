# Launch Agents

macOS launchd agents installed to `~/Library/LaunchAgents/`.

## Install on new machine

\`\`\`bash
/bin/cp launch-agents/*.plist ~/Library/LaunchAgents/
/bin/launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/net.graphify.labirynt.plist
\`\`\`

## Verify

\`\`\`bash
/bin/launchctl list | grep graphify
\`\`\`

## Schedule

| Plist | When | What |
|-------|------|------|
| `net.graphify.labirynt.plist` | Monday 10:17 (weekly) | Labirynt vault graphify rebuild via headless claude |

## Notes

- `WorkingDirectory` set to vault location (\`~/Desktop/Labirynt\`)
- `EnvironmentVariables.PATH` includes homebrew so `claude`, `node` resolve
- Logs in `~/scripts/logs/graphify-labirynt-YYYY-MM.log`
- Script: `~/.claude/scripts/graphify-labirynt-weekly.sh`
- Uses installed `claude` CLI (NOT \`npx @anthropic-ai/claude-code\` which has postinstall issues)

## Troubleshooting

If `claude` returns "native binary not installed" error:

\`\`\`bash
node /Users/$(whoami)/.nvm/versions/node/*/lib/node_modules/@anthropic-ai/claude-code/install.cjs
\`\`\`
