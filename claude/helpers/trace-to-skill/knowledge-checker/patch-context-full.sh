#!/bin/bash
# Patches existing run-N.json files with context_full by re-running prompt-enrichment.sh.
# Preserves all existing fields including feedback.
set -uo pipefail

HOOK="$HOME/.claude/hooks/prompt-enrichment.sh"
RESULTS_DIR="${1:-$(dirname "$0")/results/latest}"

if [ ! -d "$RESULTS_DIR" ]; then
  echo "Error: results dir not found: $RESULTS_DIR"
  exit 1
fi

echo "Patching run files in: $RESULTS_DIR"
PATCHED=0
SKIPPED=0

for RUN_FILE in "$RESULTS_DIR"/run-*.json; do
  [ -f "$RUN_FILE" ] || continue

  # Skip if already patched
  HAS_FULL=$(jq -r 'has("context_full")' "$RUN_FILE" 2>/dev/null)
  if [ "$HAS_FULL" = "true" ]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  PROMPT=$(jq -r '.prompt' "$RUN_FILE")
  CWD=$(jq -r '.cwd' "$RUN_FILE")
  WORD_COUNT=$(echo "$PROMPT" | wc -w | tr -d ' ')

  CONTEXT_FULL=""
  if [ "$WORD_COUNT" -ge 4 ]; then
    PAYLOAD=$(jq -cn --arg p "$PROMPT" --arg c "$CWD" '{prompt:$p,cwd:$c}')
    RAW=$(echo "$PAYLOAD" | bash "$HOOK" 2>/dev/null || true)
    if [ -n "$RAW" ]; then
      CONTEXT_FULL=$(echo "$RAW" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null || true)
    fi
  fi

  # Merge context_full into existing JSON (preserves all fields + feedback)
  UPDATED=$(jq --arg cf "$CONTEXT_FULL" '. + {context_full: $cf}' "$RUN_FILE")
  echo "$UPDATED" > "$RUN_FILE"
  PATCHED=$((PATCHED + 1))
  echo "  patched run-$(jq -r '.runIndex' "$RUN_FILE").json (${#CONTEXT_FULL} chars)"
done

echo ""
echo "Done: $PATCHED patched, $SKIPPED already had context_full"
