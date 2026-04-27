#!/bin/bash
# prompt-enrichment.sh — UserPromptSubmit hook
# Injects context from 3 sources into Claude session per prompt:
#   1. RuFlo intelligence (PageRank-ranked relevant patterns from auto-memory-store)
#   2. Domain Rules.md (deterministic — keyword match on prompt + cwd)
#   3. Global dreamer rules (top entries from ~/.claude/learning/global.md)
#
# Latency: ~1-2s per prompt
# Skips: empty prompts, prompts < 4 words

set -uo pipefail

LOG=/Users/michalmaciejewski/.claude/logs/prompt-enrichment.log
LAB="$HOME/Desktop/Labirynt"
GLOBAL_RULES="$HOME/.claude/learning/global.md"

mkdir -p "$(dirname "$LOG")"

log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*" >> "$LOG"; }

# Read stdin (Claude Code sends hook payload as JSON)
INPUT=$(cat 2>/dev/null || echo '{}')

# Extract prompt + cwd
if command -v jq &>/dev/null; then
  PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // ""')
  CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""')
else
  PROMPT=$(printf '%s' "$INPUT" | awk -F'"' '/"prompt"/{print $4; exit}')
  CWD=$(printf '%s' "$INPUT" | awk -F'"' '/"cwd"/{print $4; exit}')
fi

# Skip if prompt empty or too short
WC=$(printf '%s' "$PROMPT" | wc -w | tr -d ' ')
if [[ -z "$PROMPT" || "$WC" -lt 4 ]]; then
  log "SKIP: empty or too short ($WC words)"
  exit 0
fi

# 1. RuFlo intelligence retrieval (uses pageRank + content match from ranked-context.json)
RUFLO_CTX=$(node -e "
try {
  const intel = require('$HOME/.claude/helpers/intelligence.cjs');
  intel.init();
  const ctx = intel.getContext(process.argv[1]);
  if (ctx) console.log(ctx);
} catch (e) { /* silent */ }
" "$PROMPT" 2>/dev/null)

# 2. Domain detection (deterministic keyword match on prompt + cwd)
LOWER_INPUT="$(printf '%s %s' "$PROMPT" "$CWD" | tr '[:upper:]' '[:lower:]')"
DOMAIN=""
case "$LOWER_INPUT" in
  *portfolio*|*www_v2*|*www-v2*|*scroll-pin*|*hero*) DOMAIN="portfolio" ;;
  *gan*loop*|*gan-loop*|*evaluator*|*generator*|*rubric*) DOMAIN="gan-loop" ;;
  *career-ops*|*recruit*|*job*search*|*career*) DOMAIN="career-ops" ;;
  *startup*valid*|*pmf*|*founder*market*) DOMAIN="startup-validation" ;;
  *css*animation*|*scroll*animation*|*svg*animation*) DOMAIN="css-animations" ;;
  *design*system*|*tokens*|*design-system*) DOMAIN="design-systems" ;;
  *wspolnota*|*mieszkaniow*) DOMAIN="wspolnota-mieszkaniowa" ;;
esac

DOMAIN_BLOCK=""
if [[ -n "$DOMAIN" ]]; then
  RULES_FILE="$LAB/3 Atlas/Domains/$DOMAIN/Rules.md"
  HYP_FILE="$LAB/3 Atlas/Domains/$DOMAIN/Hypotheses.md"
  if [[ -f "$RULES_FILE" ]]; then
    DOMAIN_BLOCK="## Domain Rules ($DOMAIN)
$(cat "$RULES_FILE")"
  fi
  if [[ -f "$HYP_FILE" ]]; then
    DOMAIN_BLOCK="$DOMAIN_BLOCK

## Domain Hypotheses ($DOMAIN) — current confirmation counts
$(cat "$HYP_FILE")"
  fi
fi

# 3. Global dreamer rules (top entries)
GLOBAL_BLOCK=""
if [[ -f "$GLOBAL_RULES" ]]; then
  GLOBAL_BLOCK="## Active dreamer rules (global)
$(head -60 "$GLOBAL_RULES")"
fi

# 4. Build combined context
COMBINED="<prior-knowledge>
$RUFLO_CTX

$DOMAIN_BLOCK

$GLOBAL_BLOCK
</prior-knowledge>"

# Skip if combined empty (nothing to inject)
TRIMMED=$(printf '%s' "$COMBINED" | grep -v "^$" | head -5)
if [[ -z "$TRIMMED" || "$TRIMMED" == *"<prior-knowledge>"* && -z "$RUFLO_CTX$DOMAIN_BLOCK$GLOBAL_BLOCK" ]]; then
  log "SKIP: no context to inject (prompt: $(printf '%s' "$PROMPT" | head -c 60))"
  exit 0
fi

log "INJECT: domain=$DOMAIN | ruflo_lines=$(printf '%s' "$RUFLO_CTX" | wc -l | tr -d ' ') | prompt: $(printf '%s' "$PROMPT" | head -c 60)"

# 5. Emit additionalContext as JSON
if command -v jq &>/dev/null; then
  printf '%s' "$COMBINED" | jq -Rs '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:.}}'
else
  ESCAPED=$(printf '%s' "$COMBINED" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' '\\' | sed 's/\\/\\n/g')
  printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$ESCAPED"
fi

exit 0
