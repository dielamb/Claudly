#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Claudly — Claude Code Intelligence Stack Installer
# One command: Claude Code + RTK + lean-ctx + claude-flow
# + Obsidian vault + graphify + all hooks/agents/skills
# ============================================================

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USERNAME=$(whoami)
HOME_DIR="$HOME"

echo "================================================"
echo " Claudly — Claude Code Setup Installer"
echo " User: $USERNAME | Home: $HOME_DIR"
echo "================================================"
echo ""

# ── User email (for calendar/meeting skills) ─────────────────
if [ -z "${USER_EMAIL:-}" ]; then
  printf "  Primary email (for calendar/meeting skills, or Enter to skip): "
  read -r USER_EMAIL
fi
USER_EMAIL="${USER_EMAIL:-user@example.com}"

# ── API Key ──────────────────────────────────────────────────
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ANTHROPIC_API_KEY not set."
  echo "Get yours at: https://console.anthropic.com/keys"
  printf "  Paste API key (or Enter to skip and set later): "
  read -r _api_key
  if [ -n "$_api_key" ]; then
    export ANTHROPIC_API_KEY="$_api_key"
    grep -q 'ANTHROPIC_API_KEY' "$HOME/.zshrc" 2>/dev/null \
      || echo "export ANTHROPIC_API_KEY='$_api_key'" >> "$HOME/.zshrc"
    ok "API key saved to ~/.zshrc"
  else
    info "Skipped. Set ANTHROPIC_API_KEY in ~/.zshrc before running claude."
  fi
fi
echo ""

has() { command -v "$1" &>/dev/null; }
info() { echo "  → $1"; }
ok()   { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }

# Substitute __HOME__, __USERNAME__, __AGENTCRAFT__ placeholders in a directory
apply_placeholders() {
  local dir="$1"
  # Resolve agentcraft plugin path (npx cache hash is machine-specific)
  local agentcraft_path=""
  agentcraft_path=$(find "$HOME/.npm/_npx" -path "*/agentcraft/plugin/hooks" -type d 2>/dev/null | head -1 | sed 's|/plugin/hooks||')
  if [ -z "$agentcraft_path" ]; then
    # Pre-cache agentcraft so the path exists
    npx -y @idosal/agentcraft --version >/dev/null 2>&1 || true
    agentcraft_path=$(find "$HOME/.npm/_npx" -path "*/agentcraft/plugin/hooks" -type d 2>/dev/null | head -1 | sed 's|/plugin/hooks||')
  fi
  agentcraft_path="${agentcraft_path:-__AGENTCRAFT__}"

  find "$dir" -type f \( \
    -name "*.json" -o -name "*.sh" -o -name "*.cjs" \
    -o -name "*.js" -o -name "*.mjs" -o -name "*.ts" \
    -o -name "*.md" -o -name "*.yaml" -o -name "*.yml" \
  \) | while read -r f; do
    sed -i '' "s|__HOME__|$HOME_DIR|g; s|__USERNAME__|$USERNAME|g; s|__AGENTCRAFT__|$agentcraft_path|g; s|__USER_EMAIL__|$USER_EMAIL|g" "$f" 2>/dev/null \
      || sed -i "s|__HOME__|$HOME_DIR|g; s|__USERNAME__|$USERNAME|g; s|__AGENTCRAFT__|$agentcraft_path|g; s|__USER_EMAIL__|$USER_EMAIL|g" "$f" 2>/dev/null \
      || true
  done
}

# ── 1. Prerequisites ─────────────────────────────────────────
echo "[1/8] Checking prerequisites..."
if ! has brew; then
  info "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || true)"
fi
if ! has node; then
  info "Installing Node.js..."
  brew install node
fi
ok "Prerequisites ready"

# ── 2. Claude Code ───────────────────────────────────────────
echo "[2/8] Installing Claude Code..."
if ! has claude; then
  npm install -g @anthropic-ai/claude-code
  ok "Claude Code installed"
else
  ok "Claude Code already installed"
fi

# ── 3. RTK ──────────────────────────────────────────────────
echo "[3/8] Installing RTK (token optimizer)..."
if ! has rtk; then
  if has brew; then
    brew install rtk 2>/dev/null \
      || curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
  else
    curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
  fi
  export PATH="$HOME/.local/bin:$PATH"
  grep -q '.local/bin' "$HOME/.zshrc" 2>/dev/null \
    || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
  ok "RTK installed"
else
  ok "RTK already installed"
fi

# ── 4. lean-ctx ─────────────────────────────────────────────
echo "[4/8] Installing lean-ctx..."
if ! has lean-ctx; then
  if has brew; then
    brew tap yvgude/lean-ctx 2>/dev/null && brew install lean-ctx
  else
    curl -fsSL https://leanctx.com/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
  fi
  ok "lean-ctx installed"
else
  ok "lean-ctx already installed"
fi

# Register lean-ctx MCP with Claude Code (before settings.json is overwritten)
lean-ctx init --agent claude 2>/dev/null && ok "lean-ctx MCP registered" \
  || info "lean-ctx MCP: run 'lean-ctx init --agent claude' manually if ctx_read tools missing"

# ── 5. claude-flow + ruflo + MCPs ────────────────────────────
echo "[5/8] Installing claude-flow, ruflo, MCPs..."

npm install -g @claude-flow/cli 2>/dev/null && ok "claude-flow installed" \
  || info "claude-flow: run 'npm i -g @claude-flow/cli' manually"
npm install -g ruflo 2>/dev/null && ok "ruflo installed" || true

claude mcp add claude-flow "npx -y @claude-flow/cli@latest mcp start" 2>/dev/null \
  && ok "claude-flow MCP registered" || true
claude mcp add ruflo "npx -y ruflo@latest mcp start" 2>/dev/null \
  && ok "ruflo MCP registered" || true

# screen-vision MCP
SCREEN_VISION_DIR="$HOME/.claude/mcp-servers/screen-vision-mcp"
if [ ! -d "$SCREEN_VISION_DIR" ]; then
  info "Installing screen-vision MCP..."
  mkdir -p "$HOME/.claude/mcp-servers"
  git clone https://github.com/TIMBOTGPT/screen-vision-mcp.git "$SCREEN_VISION_DIR" 2>/dev/null \
    && cd "$SCREEN_VISION_DIR" && npm install --silent 2>/dev/null \
    && claude mcp add screen-vision "node $SCREEN_VISION_DIR/index.js" 2>/dev/null \
    && ok "screen-vision MCP installed" \
    || info "screen-vision: install manually from github.com/TIMBOTGPT/screen-vision-mcp"
  cd "$REPO_DIR"
else
  ok "screen-vision already installed"
fi

# symdex MCP (code analysis — requires uv/Python)
if has uv || has uvx; then
  claude mcp add symdex "uvx symdex serve" 2>/dev/null \
    && ok "symdex MCP registered" || true
elif has brew; then
  info "Installing uv for symdex..."
  brew install uv 2>/dev/null \
    && claude mcp add symdex "uvx symdex serve" 2>/dev/null \
    && ok "symdex + uv installed" || true
fi

# ── 6. ~/.claude config ──────────────────────────────────────
echo "[6/8] Setting up Claude Code config..."

if [ -d "$HOME/.claude" ]; then
  BACKUP="$HOME/.claude.backup.$(date +%Y%m%d_%H%M%S)"
  info "Backing up existing ~/.claude → $BACKUP"
  cp -r "$HOME/.claude" "$BACKUP"
fi

rsync -a --delete \
  --exclude='projects/' \
  --exclude='.claude-flow/sessions/' \
  --exclude='.claude-flow/data/' \
  --exclude='logs/' \
  --exclude='telemetry/' \
  --exclude='paste-cache/' \
  --exclude='file-history/' \
  --exclude='mcp-servers/' \
  --exclude='plugins/' \
  --exclude='settings.local.json' \
  --exclude='history.jsonl' \
  --exclude='learning/' \
  --exclude='patches/' \
  --exclude='sessions/' \
  --exclude='cache/' \
  --exclude='shell-snapshots/' \
  --exclude='backups/' \
  "$REPO_DIR/claude/" "$HOME/.claude/"

apply_placeholders "$HOME/.claude"

chmod +x "$HOME/.claude/helpers/"*.sh   2>/dev/null || true
chmod +x "$HOME/.claude/helpers/"*.cjs  2>/dev/null || true
chmod +x "$HOME/.claude/helpers/"*.mjs  2>/dev/null || true
chmod +x "$HOME/.claude/hooks/"*.sh     2>/dev/null || true
chmod +x "$HOME/.claude/hooks/"*.js     2>/dev/null || true
chmod +x "$HOME/.claude/hooks/"*.cjs    2>/dev/null || true
chmod +x "$HOME/.claude/scripts/"*.sh   2>/dev/null || true
chmod +x "$HOME/.claude/get-shit-done/bin/"*.cjs 2>/dev/null || true

# Create runtime directories
mkdir -p "$HOME/.claude/logs"
mkdir -p "$HOME/.claude/helpers/janitor/logs"

ok "Claude Code config installed"

# ── 7. Plugins ──────────────────────────────────────────────
echo "[7/8] Installing Claude Code plugins..."

# Plugins auto-install on first Claude session when defined in settings.json
# Force immediate install for key plugins
info "Plugins will auto-install on first 'claude' run (caveman, codex, impeccable, karpathy-skills, stripe, vercel)"
ok "Plugin config ready"

# ── 8. Obsidian ──────────────────────────────────────────────
echo "[8/8] Setting up Obsidian..."
VAULT_DIR="$HOME/Desktop/Labirynt"

if [ -d "$VAULT_DIR" ]; then
  info "Vault already exists at $VAULT_DIR — skipping copy"
  # Still update CLAUDE.md governance file if vault exists
  cp "$REPO_DIR/obsidian/CLAUDE.md" "$VAULT_DIR/CLAUDE.md" 2>/dev/null || true
else
  cp -r "$REPO_DIR/obsidian/vault/" "$VAULT_DIR/"
  cp "$REPO_DIR/obsidian/CLAUDE.md" "$VAULT_DIR/CLAUDE.md" 2>/dev/null || true

  # Create Domain Knowledge structure
  for domain_dir in "$VAULT_DIR/3 Atlas/Domains"; do
    mkdir -p "$domain_dir"
    [ -f "$domain_dir/INDEX.md" ] || echo "# Domain Index" > "$domain_dir/INDEX.md"
  done

  # Create vault-log.md for AI operations audit trail
  [ -f "$VAULT_DIR/vault-log.md" ] || echo "# Vault Operations Log" > "$VAULT_DIR/vault-log.md"

  # Download Excalidraw plugin binary (8MB, not tracked in git)
  EXCALIDRAW_DIR="$VAULT_DIR/.obsidian/plugins/obsidian-excalidraw-plugin"
  EXCALIDRAW_VER="2.22.0"
  if [ -d "$EXCALIDRAW_DIR" ] && [ ! -f "$EXCALIDRAW_DIR/main.js" ]; then
    info "Downloading Excalidraw plugin ($EXCALIDRAW_VER)..."
    curl -fsSL \
      "https://github.com/zsviczian/obsidian-excalidraw-plugin/releases/download/$EXCALIDRAW_VER/main.js" \
      -o "$EXCALIDRAW_DIR/main.js" \
      && ok "Excalidraw downloaded" \
      || info "Excalidraw download failed — enable manually in Obsidian"
  fi

  ok "Obsidian vault + plugins created at $VAULT_DIR"
fi

if ! [ -d "/Applications/Obsidian.app" ]; then
  info "Installing Obsidian app..."
  brew install --cask obsidian && ok "Obsidian installed"
else
  ok "Obsidian already installed"
fi

# ── lean-ctx shell hook ──────────────────────────────────────
lean-ctx init 2>/dev/null \
  && ok "lean-ctx shell aliases installed" \
  || info "lean-ctx shell hook: run 'lean-ctx init' manually"

# ── Graphify weekly cron (launchd) ───────────────────────────
echo ""
echo "[post-install] Setting up graphify weekly cron..."
PLIST_SRC="$REPO_DIR/launch-agents/net.graphify.labirynt.plist"
PLIST_DST="$HOME/Library/LaunchAgents/net.graphify.labirynt.plist"
if [ -f "$PLIST_SRC" ]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  # Apply placeholders to plist
  sed "s|__HOME__|$HOME_DIR|g; s|__USERNAME__|$USERNAME|g" "$PLIST_SRC" > "$PLIST_DST"
  launchctl unload "$PLIST_DST" 2>/dev/null || true
  launchctl load "$PLIST_DST" 2>/dev/null \
    && ok "Graphify weekly launchd agent installed" \
    || info "launchd load failed — graphify will still work via /graphify skill"
fi

# ── Cron jobs ────────────────────────────────────────────────
echo "[post-install] Setting up cron jobs..."
NODE_BIN="$(which node 2>/dev/null || echo node)"
CLAUDE="$HOME/.claude"

( crontab -l 2>/dev/null | grep -v "# Claudly\|ruflo-weekly\|ruflo-hygiene\|ruflo-monthly\|skill-map\|nightly-maintenance\|monthly-rule\|weekly-health\|inbox-nudge\|janitor/orchestrator" ) | crontab - 2>/dev/null || true

(
  crontab -l 2>/dev/null
  cat <<CRON
# Claudly — weekly review (Sunday 20:00)
0 20 * * 0 bash $CLAUDE/scripts/ruflo-weekly-review.sh >> $CLAUDE/logs/weekly-review.log 2>&1
# Claudly — bi-weekly hygiene (every other Sunday 20:30)
30 20 */14 * * bash $CLAUDE/scripts/ruflo-hygiene.sh >> $CLAUDE/logs/hygiene.log 2>&1
# Claudly — monthly consolidation (1st of month 20:00)
0 20 1 * * bash $CLAUDE/scripts/ruflo-monthly-consolidate.sh >> $CLAUDE/logs/monthly.log 2>&1
# Claudly — skill map update (Sunday 21:00)
0 21 * * 0 bash $CLAUDE/scripts/skill-map-update.sh >> $CLAUDE/logs/skill-map.log 2>&1
# Claudly — nightly maintenance (02:00 daily)
0 2 * * * bash $CLAUDE/helpers/nightly-maintenance.sh >> $CLAUDE/logs/maintenance.log 2>&1
# Claudly — janitor (02:00 daily)
0 2 * * * $NODE_BIN $CLAUDE/helpers/janitor/orchestrator.mjs >> $CLAUDE/helpers/janitor/logs/cron.log 2>&1
# Claudly — monthly rule maintenance (1st of month 09:00)
0 9 1 * * bash $CLAUDE/helpers/monthly-rule-maintenance.sh >> $CLAUDE/logs/monthly-rules.log 2>&1
# Claudly — weekly health report (Monday 08:00)
0 8 * * 1 $NODE_BIN $CLAUDE/helpers/weekly-health-report.js >> $CLAUDE/logs/weekly-health.log 2>&1
# Claudly — inbox nudge (09:00 daily)
0 9 * * * bash $CLAUDE/helpers/inbox-nudge.sh >> $CLAUDE/logs/inbox-nudge.log 2>&1
CRON
) | crontab - 2>/dev/null \
  && ok "9 cron jobs installed" \
  || info "Cron setup failed — run 'crontab -e' manually (see GETTING_STARTED.md)"

# ── Done ─────────────────────────────────────────────────────
echo ""
echo "================================================"
echo " Setup complete!"
echo ""
echo " Verify installation:"
echo "   claude --version"
echo "   rtk --version && rtk gain"
echo "   lean-ctx --version"
echo "   claude mcp list"
echo ""
echo " First steps:"
echo "   1. Restart terminal  (shell hooks activate on new session)"
echo "   2. Open Obsidian → Open folder as vault → $VAULT_DIR"
echo "      Enable community plugins when prompted"
echo "   3. Run: claude"
echo "   4. Type /graphify to build initial knowledge graph"
echo "   5. Read: GETTING_STARTED.md in this repo"
echo ""
echo " What's installed:"
echo "   - Claude Code CLI + 226 skills + 40 agents"
echo "   - RTK token optimizer (60-90% savings)"
echo "   - lean-ctx context engineering layer"
echo "   - claude-flow + ruflo + 4 MCP servers"
echo "   - Obsidian vault with 8 plugins + templates"
echo "   - 9 automated cron jobs"
echo "   - 50+ hooks (pre/post tool, session, routing)"
echo "   - GSD (Get Shit Done) framework"
echo "   - Domain knowledge loop + graphify"
echo "================================================"
