#!/usr/bin/env bash
# Usage: worktree-cleanup.sh <project-path> <branch-name>
# Removes the worktree and optionally the branch
# Example: worktree-cleanup.sh /Users/me/Desktop/Portfolio/www_v2 feat/cs01-bolder

set -euo pipefail

# --- Validate args ---
if [[ $# -lt 2 ]]; then
  echo "Usage: worktree-cleanup.sh <project-path> <branch-name>" >&2
  exit 1
fi

project_path="$1"
branch_name="$2"

if [[ ! -d "$project_path" ]]; then
  echo "Error: project-path does not exist: $project_path" >&2
  exit 1
fi

# --- Resolve absolute path ---
project_path="$(cd "$project_path" && pwd)"

# --- Worktree dir ---
worktree_dir="$(dirname "$project_path")/.worktrees/$branch_name"

# --- Remove worktree ---
if git -C "$project_path" worktree list --porcelain | grep -q "worktree $worktree_dir$"; then
  echo "Removing worktree: $worktree_dir"
  git -C "$project_path" worktree remove "$worktree_dir" --force
  echo "Worktree removed."
elif [[ -d "$worktree_dir" ]]; then
  echo "Warning: directory exists but is not a registered worktree. Removing directory."
  rm -rf "$worktree_dir"
  echo "Directory removed."
else
  echo "Worktree not found at $worktree_dir — nothing to remove."
fi

# --- Optionally delete branch ---
printf "Delete branch %s too? (y/N): " "$branch_name"
read -r answer
if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
  if git -C "$project_path" rev-parse --verify "$branch_name" >/dev/null 2>&1; then
    git -C "$project_path" branch -D "$branch_name"
    echo "Branch $branch_name deleted."
  else
    echo "Branch $branch_name not found — skipping."
  fi
fi

# --- Clean up empty .worktrees dir ---
worktrees_root="$(dirname "$project_path")/.worktrees"
if [[ -d "$worktrees_root" ]]; then
  remaining=$(git -C "$project_path" worktree list --porcelain \
    | grep "^worktree " \
    | grep -c "$worktrees_root" || true)
  if [[ "$remaining" -eq 0 ]]; then
    # Double-check: no subdirectories remain
    if [[ -z "$(ls -A "$worktrees_root" 2>/dev/null)" ]]; then
      rmdir "$worktrees_root"
      echo ".worktrees/ directory removed (empty)."
    fi
  fi
fi
