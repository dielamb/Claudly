#!/usr/bin/env bash
set -euo pipefail
WORKTREE="${1:?}"
if [ -f "$WORKTREE/package.json" ]; then
  TEST_SCRIPT=$(node -p "require('$WORKTREE/package.json').scripts?.test || ''" 2>/dev/null || echo "")
  if [ -n "$TEST_SCRIPT" ] && [ "$TEST_SCRIPT" != "echo \"Error: no test specified\" && exit 1" ]; then
    cd "$WORKTREE" && npm test --silent 2>&1 && echo "gate-tests: PASS" && exit 0
    echo "gate-tests: FAIL" >&2; exit 1
  fi
fi
echo "gate-tests: PASS (no test suite)"; exit 0
