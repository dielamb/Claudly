#!/bin/bash
set -uo pipefail

command -v jq >/dev/null 2>&1 || { echo 'Error: jq not found. brew install jq'; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROMPTS_FILE="$SCRIPT_DIR/test-prompts.json"
HOOK="$HOME/.claude/hooks/prompt-enrichment.sh"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="$SCRIPT_DIR/results/run-$TIMESTAMP"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Create results dir
mkdir -p "$RESULTS_DIR"

# Counters
PASS=0
FAIL=0
SKIP=0
TOTAL=0

# Iterate test cases
while IFS= read -r entry; do
  TOTAL=$((TOTAL + 1))
  PROMPT=$(echo "$entry" | jq -r '.prompt')
  CWD=$(echo "$entry" | jq -r '.cwd')
  EXPECTED_PASS=$(echo "$entry" | jq -r '.expected_pass')
  EXPECTED_KEYWORDS=$(echo "$entry" | jq -r '.expected_keywords[]' 2>/dev/null || true)

  # Initialize per-iteration variables
  KEYWORDS_MATCHED="[]"
  CONTEXT=""
  RAW=""

  # Word count check (SKIP if < 4 words)
  WORD_COUNT=$(echo "$PROMPT" | wc -w | tr -d ' ')

  if [ "$WORD_COUNT" -lt 4 ]; then
    RESULT="SKIP"
  else
    # Build payload and run hook
    PAYLOAD=$(jq -cn --arg p "$PROMPT" --arg c "$CWD" '{prompt:$p,cwd:$c}')
    RAW=$(echo "$PAYLOAD" | bash "$HOOK" 2>/dev/null || true)

    if [ -z "$RAW" ]; then
      CONTEXT=""
    else
      CONTEXT=$(echo "$RAW" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null || true)
    fi

    # Simplified decision logic
    if [ -z "$CONTEXT" ]; then
      # No context returned
      if [ "$EXPECTED_PASS" = "false" ]; then
        RESULT="PASS"  # Expected no match, got no context
      else
        RESULT="FAIL"  # Expected a hit, got nothing
      fi
    else
      # Context returned
      if [ -n "$EXPECTED_KEYWORDS" ]; then
        # Check keywords
        MATCHED=()
        while IFS= read -r KW; do
          [ -z "$KW" ] && continue
          if echo "$CONTEXT" | grep -qi "$KW"; then
            MATCHED+=("$KW")
          fi
        done <<< "$EXPECTED_KEYWORDS"

        if [ ${#MATCHED[@]} -gt 0 ]; then
          RESULT="PASS"
          KEYWORDS_MATCHED=$(printf '%s\n' "${MATCHED[@]}" | jq -R . | jq -s .)
        else
          RESULT="FAIL"
          KEYWORDS_MATCHED="[]"
        fi
      elif [ "$EXPECTED_PASS" = "false" ]; then
        # Got context when expected none
        RESULT="FAIL"
        KEYWORDS_MATCHED="[]"
      else
        # expected_pass=true, no keywords specified, context returned
        RESULT="PASS"
        KEYWORDS_MATCHED="[]"
      fi
    fi

  fi

  # Update counters
  case "$RESULT" in
    PASS) PASS=$((PASS + 1)) ;;
    FAIL) FAIL=$((FAIL + 1)) ;;
    SKIP) SKIP=$((SKIP + 1)) ;;
  esac

  # Print colored line
  case "$RESULT" in
    PASS) printf "${GREEN}[PASS]${NC} %s\n" "$PROMPT" ;;
    FAIL) printf "${RED}[FAIL]${NC} %s\n" "$PROMPT" ;;
    SKIP) printf "${YELLOW}[SKIP]${NC} %s\n" "$PROMPT" ;;
  esac

  # Write run-N.json — full context saved (no truncation)
  CONTEXT_EXCERPT="${CONTEXT:0:800}"
  OUTPUT_LENGTH=${#CONTEXT}
  jq -n \
    --argjson idx "$TOTAL" \
    --arg prompt "$PROMPT" \
    --arg cwd "$CWD" \
    --arg expected_pass "$EXPECTED_PASS" \
    --arg actual_result "$RESULT" \
    --argjson keywords_matched "${KEYWORDS_MATCHED:-[]}" \
    --argjson output_length "$OUTPUT_LENGTH" \
    --arg context_excerpt "$CONTEXT_EXCERPT" \
    --arg context_full "$CONTEXT" \
    '{runIndex:$idx,prompt:$prompt,cwd:$cwd,expected_pass:$expected_pass,actual_result:$actual_result,keywords_matched:$keywords_matched,output_length:$output_length,context_excerpt:$context_excerpt,context_full:$context_full}' \
    > "$RESULTS_DIR/run-$TOTAL.json"

done < <(jq -c '.[]' "$PROMPTS_FILE")

# Symlink to latest
ln -sfn "run-$TIMESTAMP" "$SCRIPT_DIR/results/latest"

# Tally
echo ""
echo "$PASS passed, $FAIL failed, $SKIP skipped of $TOTAL"
