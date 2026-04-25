#!/usr/bin/env bash
set -euo pipefail
WORKTREE="${1:?}"
if [ -f "$WORKTREE/.eslintrc" ] || [ -f "$WORKTREE/.eslintrc.js" ] || [ -f "$WORKTREE/.eslintrc.json" ]; then
  cd "$WORKTREE" && npx eslint . --max-warnings=0 --quiet 2>&1 && echo "gate-lint: PASS" && exit 0
  echo "gate-lint: FAIL" >&2; exit 1
fi
echo "gate-lint: PASS (no eslint config)"; exit 0
