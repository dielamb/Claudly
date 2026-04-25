#!/usr/bin/env bash
set -euo pipefail
WORKTREE="${1:?Usage: gate-build.sh <worktree-path>}"
if [ -f "$WORKTREE/package.json" ]; then
  BUILD_SCRIPT=$(node -p "require('$WORKTREE/package.json').scripts?.build || ''" 2>/dev/null || echo "")
  if [ -n "$BUILD_SCRIPT" ]; then
    cd "$WORKTREE" && npm run build --silent && echo "gate-build: PASS" && exit 0
    echo "gate-build: FAIL — build error" >&2; exit 1
  fi
fi
echo "gate-build: PASS (no build step)"; exit 0
