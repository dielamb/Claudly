#!/usr/bin/env bash
# Usage: worktree-create.sh <project-path> <branch-name> [base-branch]
# Example: worktree-create.sh /Users/me/Desktop/Portfolio/www_v2 feat/cs01-bolder main
# Creates worktree at <project-path>/../.worktrees/<branch-name>
# Returns the worktree path on success

set -euo pipefail

# --- Validate args ---
if [[ $# -lt 2 ]]; then
  echo "Usage: worktree-create.sh <project-path> <branch-name> [base-branch]" >&2
  exit 1
fi

project_path="$1"
branch_name="$2"
base_branch="${3:-}"

if [[ ! -d "$project_path" ]]; then
  echo "Error: project-path does not exist: $project_path" >&2
  exit 1
fi

# --- Resolve absolute path ---
project_path="$(cd "$project_path" && pwd)"

# --- Determine worktree dir ---
worktree_dir="$(dirname "$project_path")/.worktrees/$branch_name"

# --- Idempotency: already exists ---
if git -C "$project_path" worktree list --porcelain | grep -q "worktree $worktree_dir$"; then
  echo "$worktree_dir"
  exit 0
fi

if [[ -d "$worktree_dir" ]]; then
  echo "$worktree_dir"
  exit 0
fi

# --- Resolve base branch ---
if [[ -z "$base_branch" ]]; then
  if git -C "$project_path" rev-parse --verify main >/dev/null 2>&1; then
    base_branch="main"
  elif git -C "$project_path" rev-parse --verify master >/dev/null 2>&1; then
    base_branch="master"
  else
    base_branch="$(git -C "$project_path" rev-parse --abbrev-ref HEAD)"
  fi
fi

# --- Create parent dir if needed ---
mkdir -p "$(dirname "$worktree_dir")"

# --- Create worktree ---
if ! git -C "$project_path" worktree add "$worktree_dir" -b "$branch_name" "$base_branch"; then
  echo "Error: failed to create worktree at $worktree_dir" >&2
  exit 1
fi

echo "$worktree_dir"
