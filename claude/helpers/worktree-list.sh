#!/usr/bin/env bash
# Usage: worktree-list.sh <project-path>
# Lists all active worktrees for the project

set -euo pipefail

# --- Validate args ---
if [[ $# -lt 1 ]]; then
  echo "Usage: worktree-list.sh <project-path>" >&2
  exit 1
fi

project_path="$1"

if [[ ! -d "$project_path" ]]; then
  echo "Error: project-path does not exist: $project_path" >&2
  exit 1
fi

# --- Resolve absolute path ---
project_path="$(cd "$project_path" && pwd)"
project_name="$(basename "$project_path")"
current_head="$(git -C "$project_path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "detached")"

echo "Active worktrees for $project_name:"

# Parse porcelain output: blocks separated by blank lines
# Each block: worktree <path> / HEAD <sha> / branch refs/heads/<name>  OR  detached
git -C "$project_path" worktree list --porcelain | awk -v main_path="$project_path" -v current_head="$current_head" '
BEGIN {
  wt_path = ""; wt_branch = ""; wt_head = ""
}

/^worktree / {
  wt_path = substr($0, 10)
}

/^HEAD / {
  wt_head = substr($0, 6, 7)
}

/^branch / {
  wt_branch = substr($0, 8)
  # Strip refs/heads/ prefix
  sub(/^refs\/heads\//, "", wt_branch)
}

/^detached$/ {
  wt_branch = "(detached)"
}

/^$/ {
  if (wt_path != "") {
    label = "[" wt_branch "]"
    suffix = ""
    if (wt_path == main_path) {
      suffix = "  (current)"
    }
    printf "  %-22s %s%s\n", label, wt_path, suffix
  }
  wt_path = ""; wt_branch = ""; wt_head = ""
}

END {
  # Handle last block (no trailing blank line)
  if (wt_path != "") {
    label = "[" wt_branch "]"
    suffix = ""
    if (wt_path == main_path) {
      suffix = "  (current)"
    }
    printf "  %-22s %s%s\n", label, wt_path, suffix
  }
}
'
