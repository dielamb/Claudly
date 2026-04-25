#!/usr/bin/env bash
# Monthly rule maintenance: verify → evolve → detect gaps
# Runs 1st of month at 09:00

set -uo pipefail
HOME_DIR="${HOME:-__HOME__}"
NODE_BIN="$HOME_DIR/.nvm/versions/node/v24.15.0/bin/node"
HELPERS="$HOME_DIR/.claude/helpers"
LOG="$HOME_DIR/.claude/learning/monthly-maintenance.log"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

echo "[$(ts)] === Monthly rule maintenance started ===" | tee -a "$LOG"

echo "[$(ts)] Step 1: rule-verifier" | tee -a "$LOG"
"$NODE_BIN" "$HELPERS/rule-verifier.js" 2>&1 | tee -a "$LOG"

echo "[$(ts)] Step 2: rule-evolver" | tee -a "$LOG"
"$NODE_BIN" "$HELPERS/rule-evolver.js" 2>&1 | tee -a "$LOG"

echo "[$(ts)] Step 3: gap-detector" | tee -a "$LOG"
"$NODE_BIN" "$HELPERS/gap-detector.js" 2>&1 | tee -a "$LOG"

echo "[$(ts)] Step 3.5: Checking idea triggers" | tee -a "$LOG"
# Check if oldest rule is >90 days → time for eval harness
OLDEST_RULE_DATE=$(node -e "
const r=JSON.parse(require('fs').readFileSync('$HOME/.claude/learning/rules.json','utf8'));
const dates=r.filter(x=>!x.disabled).map(x=>x.created).filter(Boolean).sort();
console.log(dates[0]||'');
" 2>/dev/null)
if [[ -n "$OLDEST_RULE_DATE" ]]; then
  DAYS_OLD=$(( ( $(date +%s) - $(date -j -f "%Y-%m-%d" "$OLDEST_RULE_DATE" +%s 2>/dev/null || date -d "$OLDEST_RULE_DATE" +%s 2>/dev/null || echo 0) ) / 86400 ))
  if [[ "$DAYS_OLD" -ge 90 ]]; then
    TRIGGER_FILE="$INBOX/trigger-eval-harness-$(date +%Y-%m).md"
    if [[ ! -f "$TRIGGER_FILE" ]]; then
      printf "---\ntype: inbox\ncreated: $(date +%Y-%m-%d)\ntags: [trigger, eval-harness]\n---\n\n# TRIGGER: Eval Harness\n\nRules are %d days old. Time to build an eval harness.\n\nSee: [[Eval Harness dla agentow Claude]]\n" "$DAYS_OLD" > "$TRIGGER_FILE"
      echo "[$(ts)] Trigger written: eval harness (${DAYS_OLD}d old rules)" | tee -a "$LOG"
    fi
  fi
fi

echo "[$(ts)] Step 4: Writing Obsidian Inbox" | tee -a "$LOG"

LEARNING="$HOME_DIR/.claude/learning"
INBOX="$HOME_DIR/Desktop/Labirynt/0 Inbox"
MONTH=$(date +%Y-%m)
TODAY=$(date +%Y-%m-%d)

mkdir -p "$INBOX"

# 4a. rule-maintenance summary (verify + skill-candidates + wikilink warnings)
MAINT_FILE="$INBOX/rule-maintenance-${MONTH}.md"
{
  echo "---"
  echo "type: inbox"
  echo "created: $TODAY"
  echo "tags: [rules, autoimprovement, review-needed]"
  echo "---"
  echo ""
  echo "# Rule Maintenance — $MONTH"
  echo ""
  echo "## Verification Report"
  echo ""
  cat "$LEARNING/verification-report-${TODAY}.md" 2>/dev/null || echo "*(no report today)*"
  echo ""
  echo "## Skill Candidates"
  echo ""
  cat "$LEARNING/skill-candidates.md" 2>/dev/null | head -40 || echo "*(none)*"
  echo ""
  echo "## Stale Wikilinks"
  echo ""
  cat "$HOME_DIR/.claude/helpers/wikilink-warnings.txt" 2>/dev/null || echo "*(none)*"
} > "$MAINT_FILE"
echo "[$(ts)] Wrote $MAINT_FILE" | tee -a "$LOG"

# 4b. draft-rules (from gap-detector) if exists and non-empty
DRAFT="$LEARNING/draft-rules.md"
if [[ -f "$DRAFT" ]] && [[ -s "$DRAFT" ]]; then
  cp "$DRAFT" "$INBOX/draft-rules-${MONTH}.md"
  sed -i '' "1s/^/---\ntype: inbox\ncreated: $TODAY\ntags: [rules, promote-needed]\n---\n\n/" "$INBOX/draft-rules-${MONTH}.md"
  echo "[$(ts)] Wrote $INBOX/draft-rules-${MONTH}.md" | tee -a "$LOG"
fi

# 4c. evolution-proposals if has unapproved entries
PROPOSALS="$LEARNING/evolution-proposals.md"
if [[ -f "$PROPOSALS" ]] && grep -q "Approved: no" "$PROPOSALS" 2>/dev/null; then
  cp "$PROPOSALS" "$INBOX/evolution-proposals-${MONTH}.md"
  sed -i '' "1s/^/---\ntype: inbox\ncreated: $TODAY\ntags: [rules, evolution, approve-needed]\n---\n\n/" "$INBOX/evolution-proposals-${MONTH}.md"
  echo "[$(ts)] Wrote $INBOX/evolution-proposals-${MONTH}.md" | tee -a "$LOG"
fi

echo "[$(ts)] === Monthly rule maintenance complete ===" | tee -a "$LOG"
