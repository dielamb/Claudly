#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Claude Code Setup Installer
# One command: Claude Code + RTK + lean-ctx + claude-flow
# + GAN loop + Obsidian vault + all hooks/agents/skills
# ============================================================

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USERNAME=$(whoami)
HOME_DIR="$HOME"

echo "================================================"
echo " Claude Code Setup Installer"
echo " User: $USERNAME | Home: $HOME_DIR"
echo "================================================"
echo ""

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

# Substitute __HOME__ and __USERNAME__ placeholders in a directory
apply_placeholders() {
  local dir="$1"
  find "$dir" -type f \( \
    -name "*.json" -o -name "*.sh" -o -name "*.cjs" \
    -o -name "*.js" -o -name "*.mjs" -o -name "*.ts" \
    -o -name "*.md" -o -name "*.yaml" -o -name "*.yml" \
  \) | while read -r f; do
    # macOS sed needs '' after -i; Linux sed doesn't accept it
    sed -i '' "s|__HOME__|$HOME_DIR|g; s|__USERNAME__|$USERNAME|g" "$f" 2>/dev/null \
      || sed -i "s|__HOME__|$HOME_DIR|g; s|__USERNAME__|$USERNAME|g" "$f" 2>/dev/null \
      || true
  done
}

# ── 1. Prerequisites ─────────────────────────────────────────
echo "[1/7] Checking prerequisites..."
if ! has brew; then
  info "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon: add brew to PATH for this session
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || true)"
fi
if ! has node; then
  info "Installing Node.js..."
  brew install node
fi
ok "Prerequisites ready"

# ── 2. Claude Code ───────────────────────────────────────────
echo "[2/7] Installing Claude Code..."
if ! has claude; then
  npm install -g @anthropic-ai/claude-code
  ok "Claude Code installed"
else
  ok "Claude Code already installed"
fi

# ── 3. RTK ──────────────────────────────────────────────────
echo "[3/7] Installing RTK (token optimizer)..."
if ! has rtk; then
  if has brew; then
    brew install rtk 2>/dev/null \
      || curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
  else
    curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
  fi
  # curl install goes to ~/.local/bin — add to PATH
  export PATH="$HOME/.local/bin:$PATH"
  grep -q '.local/bin' "$HOME/.zshrc" 2>/dev/null \
    || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
  ok "RTK installed"
else
  ok "RTK already installed"
fi

# ── 4. lean-ctx ─────────────────────────────────────────────
# Must run BEFORE copying ~/.claude so it can register its MCP
# via `claude mcp` (lean-ctx uses claude mcp registry, not settings.json)
echo "[4/7] Installing lean-ctx..."
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

# Register lean-ctx MCP with Claude Code now (before our settings.json overwrites anything)
lean-ctx init --agent claude 2>/dev/null && ok "lean-ctx MCP registered" \
  || info "lean-ctx MCP: run 'lean-ctx init --agent claude' manually if ctx_read tools missing"

# ── 5. claude-flow + ruflo + MCPs ────────────────────────────
echo "[5/7] Installing claude-flow, ruflo, MCPs..."

# Binaries
npm install -g @claude-flow/cli 2>/dev/null && ok "claude-flow installed" \
  || info "claude-flow: run 'npm i -g @claude-flow/cli' manually"
npm install -g ruflo 2>/dev/null && ok "ruflo installed" \
  || true

# Register MCP servers (runs after claude-code is installed)
# claude-flow provides mcp__claude-flow__* tools
claude mcp add claude-flow "npx -y @claude-flow/cli@latest mcp start" 2>/dev/null \
  && ok "claude-flow MCP registered" || true
# ruflo provides mcp__ruflo__* tools
claude mcp add ruflo "npx -y ruflo@latest mcp start" 2>/dev/null \
  && ok "ruflo MCP registered" || true

# screen-vision MCP (desktop screenshot tools)
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
echo "[6/7] Setting up Claude Code config..."

# Backup existing config if present
if [ -d "$HOME/.claude" ]; then
  BACKUP="$HOME/.claude.backup.$(date +%Y%m%d_%H%M%S)"
  info "Backing up existing ~/.claude → $BACKUP"
  cp -r "$HOME/.claude" "$BACKUP"
fi

# Clean install: rsync --delete ensures no stale files from old config survive
# --exclude preserves runtime state that should not be overwritten
rsync -a --delete \
  --exclude='projects/' \
  --exclude='.claude-flow/sessions/' \
  --exclude='.claude-flow/data/' \
  --exclude='logs/' \
  --exclude='telemetry/' \
  --exclude='paste-cache/' \
  --exclude='file-history/' \
  "$REPO_DIR/claude/" "$HOME/.claude/"

apply_placeholders "$HOME/.claude"

chmod +x "$HOME/.claude/helpers/"*.sh   2>/dev/null || true
chmod +x "$HOME/.claude/hooks/"*.sh     2>/dev/null || true
chmod +x "$HOME/.claude/scripts/"*.sh   2>/dev/null || true
chmod +x "$HOME/.claude/get-shit-done/bin/"*.cjs 2>/dev/null || true

chmod +x "$HOME/.claude/tools/gan-loop/run.sh" 2>/dev/null || true
chmod +x "$HOME/.claude/tools/gan-loop/gan-classifier.sh" 2>/dev/null || true

ok "Claude Code config + GAN loop installed"

# ── 7. Obsidian ──────────────────────────────────────────────
echo "[7/7] Setting up Obsidian..."
VAULT_DIR="$HOME/Desktop/Labirynt"

if [ -d "$VAULT_DIR" ]; then
  info "Vault already exists at $VAULT_DIR — skipping"
else
  cp -r "$REPO_DIR/obsidian/vault/" "$VAULT_DIR/"
  cp "$REPO_DIR/obsidian/CLAUDE.md" "$VAULT_DIR/CLAUDE.md" 2>/dev/null || true

  # Download Excalidraw main.js (8MB binary not tracked in git)
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
# lean-ctx init (no flags) installs shell aliases only — does not touch settings.json
lean-ctx init 2>/dev/null \
  && ok "lean-ctx shell aliases installed" \
  || info "lean-ctx shell hook: run 'lean-ctx init' manually"

# ── Done ─────────────────────────────────────────────────────
echo ""
echo "================================================"
echo " Setup complete!"
echo ""
echo " Verify installation:"
echo "   claude --version"
echo "   rtk gain"
echo "   rtk --version"
echo "   lean-ctx --version"
echo ""
echo " First steps:"
echo "   1. Restart terminal  (shell hooks activate on new session)"
echo "   2. Open Obsidian → Open folder as vault → $VAULT_DIR"
echo "      Enable community plugins when prompted"
echo "   3. Run: claude"
echo "   4. Read: GETTING_STARTED.md in this repo"
echo "================================================"
