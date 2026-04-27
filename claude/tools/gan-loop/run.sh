#!/bin/bash
# GAN Loop — entry point
# Usage: ./run.sh briefs/[task_name].md

set -e

BRIEF="${1}"

if [ -z "$BRIEF" ]; then
  echo "ERROR: No brief specified."
  echo "Usage: ./run.sh briefs/[task_name].md"
  exit 1
fi

if [ ! -f "$BRIEF" ]; then
  echo "ERROR: Brief not found: $BRIEF"
  exit 1
fi

LOOP_DIR="$(cd "$(dirname "$0")" && pwd)"
ABS_BRIEF="$LOOP_DIR/$BRIEF"

# Extract task_name from brief frontmatter
TASK_NAME=$(grep -m1 '^task:' "$BRIEF" | sed 's/task: *//' | tr -d '[:space:]')

if [ -z "$TASK_NAME" ]; then
  echo "ERROR: task field missing in brief frontmatter."
  exit 1
fi

# Validate task_name
if ! echo "$TASK_NAME" | grep -qE '^[A-Za-z0-9_-]+$'; then
  echo "ERROR: Invalid task_name '$TASK_NAME'. Use only letters, numbers, hyphens, underscores."
  exit 1
fi

# Timestamped run directory — each run fully isolated
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RUN_DIR="$LOOP_DIR/runs/${TIMESTAMP}-${TASK_NAME}"
mkdir -p "$LOOP_DIR/rubrics" "$RUN_DIR/feedback"

# Cleanup logs older than 7 days
find "$LOOP_DIR/.logs" -name "*.txt" -mtime +7 -delete 2>/dev/null || true
mkdir -p "$LOOP_DIR/.logs"
LOG_FILE="$LOOP_DIR/.logs/${TIMESTAMP}-${TASK_NAME}.txt"

echo "Starting GAN loop: $TASK_NAME ($TIMESTAMP)"
echo "Run dir: $RUN_DIR"

RYCHU="$HOME/RychuOS/rychu-msg.sh"
rychu() { bash "$RYCHU" "$1" "$2" "GAN Loop" 2>/dev/null || true; }

rychu "thinking" "GAN start: $TASK_NAME"

cd "$LOOP_DIR"
env -u ANTHROPIC_API_KEY claude -p --model sonnet --agent loop-operator \
  "Run GAN loop. Working directory: $LOOP_DIR. Brief: $ABS_BRIEF. Config: $LOOP_DIR/gan.json. Output directory: $RUN_DIR. All file paths use $RUN_DIR instead of output/." \
  2>&1 | tee "$LOG_FILE"

# Git commit if PASS
if grep -q "Verdict: PASS" "$RUN_DIR/run-summary.md" 2>/dev/null; then
  SCORE=$(grep -oP 'Final score:\s*\K[\d.]+' "$RUN_DIR/run-summary.md" 2>/dev/null || echo "?")
  ITERS=$(grep -oP 'Iterations:\s*\K[\d /]+' "$RUN_DIR/run-summary.md" 2>/dev/null | tr -d ' ' || echo "?")
  cd "$LOOP_DIR"
  git add "runs/${TIMESTAMP}-${TASK_NAME}/" "rubrics/" 2>/dev/null || true
  git commit -m "run: $TASK_NAME PASS ($TIMESTAMP)" 2>/dev/null || true
  echo "Committed to git."
  rychu "done" "GAN PASS: $TASK_NAME — $SCORE/10 in $ITERS iter"
  osascript -e "display notification \"PASS — $TASK_NAME ($SCORE/10)\" with title \"GAN Loop\" sound name \"Glass\"" 2>/dev/null || true
else
  VERDICT=$(grep -oP 'Verdict:\s*\K\w+' "$RUN_DIR/run-summary.md" 2>/dev/null || echo "REJECT")
  rychu "error" "GAN $VERDICT: $TASK_NAME"
fi

# Regenerate viewer-data.js so the HTML viewer reflects this run
if [ -x "$LOOP_DIR/viewer-build.sh" ]; then
  "$LOOP_DIR/viewer-build.sh" "$LOOP_DIR/runs" >/dev/null 2>&1 || true
elif [ -x "$HOME/Desktop/claude-setup/claude/tools/gan-loop/viewer-build.sh" ]; then
  "$HOME/Desktop/claude-setup/claude/tools/gan-loop/viewer-build.sh" "$LOOP_DIR/runs" >/dev/null 2>&1 || true
fi
