#!/bin/bash
# prompt-enrichment.sh — UserPromptSubmit hook
# Injects context from Obsidian (Efforts, People, Domains) + RuFlo intelligence.
# All sources dynamic — no hardcoded keywords.
#
# Priority: Domains/Rules.md > Efforts > People > RuFlo only
# GlobalRules injected only when domain or RuFlo matched.
#
# Latency: ~1-2s per prompt

set -uo pipefail

LOG="$HOME/.claude/logs/prompt-enrichment.log"
LAB="$HOME/Desktop/Labirynt"
GLOBAL_RULES="$HOME/.claude/learning/global.md"

mkdir -p "$(dirname "$LOG")"
log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*" >> "$LOG"; }

INPUT=$(cat 2>/dev/null || echo '{}')

if command -v jq &>/dev/null; then
  PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // ""')
  CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""')
else
  PROMPT=$(printf '%s' "$INPUT" | awk -F'"' '/"prompt"/{print $4; exit}')
  CWD=$(printf '%s' "$INPUT" | awk -F'"' '/"cwd"/{print $4; exit}')
fi

WC=$(printf '%s' "$PROMPT" | wc -w | tr -d ' ')
if [[ -z "$PROMPT" || "$WC" -lt 4 ]]; then
  log "SKIP: too short ($WC words)"
  exit 0
fi

# 1. RuFlo intelligence (PageRank-ranked from auto-memory-store)
RUFLO_CTX=$(node -e "
try {
  const intel = require('$HOME/.claude/helpers/intelligence.cjs');
  intel.init();
  const ctx = intel.getContext(process.argv[1]);
  if (ctx) console.log(ctx);
} catch (e) {}
" "$PROMPT" 2>/dev/null)

CLEAN_PROMPT="$(printf '%s' "$PROMPT" | sed 's|file://[^ ]*||g; s|https\?://[^ ]*||g; s|/[A-Za-z0-9_./-]*\.[a-z]\{2,4\}||g')"
LOWER_INPUT="$(printf '%s %s' "${CLEAN_PROMPT:-$PROMPT}" "$CWD" | tr '[:upper:]' '[:lower:]')"
DOMAIN=""
DOMAIN_SOURCE=""
DOMAIN_TYPE=""

# 2a. Dynamic Domains scan (3 Atlas/Domains/*/Rules.md)
DOMAINS_DIR="$LAB/3 Atlas/Domains"
if [[ -d "$DOMAINS_DIR" ]]; then
  for domain_dir in "$DOMAINS_DIR"/*/; do
    [[ -d "$domain_dir" ]] || continue
    dname="$(basename "$domain_dir")"
    rules_file="$domain_dir/Rules.md"
    [[ -f "$rules_file" ]] || continue
    # Match on each word of domain name (split on - and space)
    matched=0
    for keyword in $(printf '%s' "$dname" | tr '-' ' '); do
      [[ ${#keyword} -lt 3 ]] && continue
      printf '%s' "$LOWER_INPUT" | grep -qiF "$keyword" && matched=1 && break
    done
    if [[ $matched -eq 1 ]]; then
      DOMAIN="$dname"
      DOMAIN_SOURCE="$rules_file"
      DOMAIN_TYPE="domain"
      break
    fi
  done
fi

# 2b. Dynamic Efforts (2 Efforts/) — all words of filename as keywords
EFFORTS_DIR="$LAB/2 Efforts"
if [[ -z "$DOMAIN" && -d "$EFFORTS_DIR" ]]; then
  while IFS= read -r fname; do
    effort_lower="$(printf '%s' "$fname" | tr '[:upper:]' '[:lower:]' | sed 's/\.md$//')"
    matched=0
    for word in $effort_lower; do
      [[ ${#word} -lt 4 ]] && continue
      printf '%s' "$LOWER_INPUT" | grep -qiF "$word" && matched=1 && break
    done
    if [[ $matched -eq 1 ]]; then
      DOMAIN="effort"
      DOMAIN_SOURCE="$EFFORTS_DIR/$fname"
      DOMAIN_TYPE="effort"
      break
    fi
  done < <(ls "$EFFORTS_DIR" 2>/dev/null)
fi

# 2c. Dynamic People (4 People/) — first name match (word boundary)
PEOPLE_DIR="$LAB/4 People"
if [[ -z "$DOMAIN" && -d "$PEOPLE_DIR" ]]; then
  while IFS= read -r fname; do
    person_lower="$(printf '%s' "$fname" | tr '[:upper:]' '[:lower:]' | sed 's/\.md$//')"
    first_name="$(printf '%s' "$person_lower" | awk '{print $1}')"
    last_name="$(printf '%s' "$person_lower" | awk '{print $NF}')"
    [[ ${#first_name} -lt 3 && ${#last_name} -lt 4 ]] && continue
    if printf '%s' "$LOWER_INPUT" | grep -qwiF "$first_name" || \
       { [[ ${#last_name} -ge 4 ]] && printf '%s' "$LOWER_INPUT" | grep -qwiF "$last_name"; }; then
      DOMAIN="person"
      DOMAIN_SOURCE="$PEOPLE_DIR/$fname"
      DOMAIN_TYPE="person"
      break
    fi
  done < <(ls "$PEOPLE_DIR" 2>/dev/null)
fi

# 3. Build domain block
DOMAIN_BLOCK=""
if [[ -n "$DOMAIN" ]]; then
  if [[ "$DOMAIN_TYPE" == "domain" && -f "$DOMAIN_SOURCE" ]]; then
    HYP_FILE="$(dirname "$DOMAIN_SOURCE")/Hypotheses.md"
    DOMAIN_BLOCK="## Domain Rules ($DOMAIN)
$(cat "$DOMAIN_SOURCE")"
    if [[ -f "$HYP_FILE" ]]; then
      DOMAIN_BLOCK="$DOMAIN_BLOCK

## Domain Hypotheses ($DOMAIN)
$(cat "$HYP_FILE")"
    fi
  elif [[ "$DOMAIN_TYPE" == "effort" && -f "$DOMAIN_SOURCE" ]]; then
    EFFORT_NAME="$(basename "$DOMAIN_SOURCE" .md)"
    DOMAIN_BLOCK="## Active project: $EFFORT_NAME
$(head -40 "$DOMAIN_SOURCE")"
  elif [[ "$DOMAIN_TYPE" == "person" && -f "$DOMAIN_SOURCE" ]]; then
    PERSON_NAME="$(basename "$DOMAIN_SOURCE" .md)"
    DOMAIN_BLOCK="## Person context: $PERSON_NAME
$(head -30 "$DOMAIN_SOURCE")"
  fi
fi

# 4. Global dreamer rules — only when something matched
GLOBAL_BLOCK=""
if [[ ( -n "$DOMAIN_BLOCK" || -n "$RUFLO_CTX" ) && -f "$GLOBAL_RULES" ]]; then
  GLOBAL_BLOCK="## Active dreamer rules (global)
$(head -60 "$GLOBAL_RULES")"
fi

# Skip if nothing to inject
if [[ -z "$DOMAIN_BLOCK" && -z "$RUFLO_CTX" ]]; then
  log "SKIP: no match (prompt: $(printf '%s' "$PROMPT" | cut -c1-60))"
  exit 0
fi

COMBINED="<prior-knowledge>
$RUFLO_CTX

$DOMAIN_BLOCK

$GLOBAL_BLOCK
</prior-knowledge>"

log "INJECT: type=$DOMAIN_TYPE domain=$DOMAIN | ruflo=$(printf '%s' "$RUFLO_CTX" | wc -l | tr -d ' ')L | prompt: $(printf '%s' "$PROMPT" | cut -c1-60)"

if command -v jq &>/dev/null; then
  printf '%s' "$COMBINED" | jq -Rs '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:.}}'
else
  ESCAPED=$(printf '%s' "$COMBINED" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' '\\' | sed 's/\\/\\n/g')
  printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$ESCAPED"
fi

exit 0
