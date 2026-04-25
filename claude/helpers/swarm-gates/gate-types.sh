#!/usr/bin/env bash
set -euo pipefail
WORKTREE="${1:?}"
if [ -f "$WORKTREE/tsconfig.json" ]; then
  cd "$WORKTREE" && npx tsc --noEmit 2>&1 && echo "gate-types: PASS" && exit 0
  echo "gate-types: FAIL" >&2; exit 1
fi
echo "gate-types: PASS (no tsconfig)"; exit 0
