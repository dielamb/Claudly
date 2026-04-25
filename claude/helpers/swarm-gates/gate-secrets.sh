#!/usr/bin/env bash
set -euo pipefail
WORKTREE="${1:?Usage: gate-secrets.sh <worktree-path>}"
DIFF=$(git -C "$WORKTREE" diff HEAD --unified=0 2>/dev/null || git -C "$WORKTREE" show HEAD --unified=0 2>/dev/null || echo "")
if echo "$DIFF" | grep -qE "sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|BEGIN (RSA |EC )?PRIVATE KEY|password\s*[:=]\s*['\"][^'\"]{8,}"; then
  echo "SECRETS DETECTED in diff" >&2; exit 1
fi
echo "gate-secrets: PASS"; exit 0
