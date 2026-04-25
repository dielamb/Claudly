#!/usr/bin/env bash
# Usage: worktree-agent.sh <project-path> <branch-name> <task-description>
# Creates worktree, echoes instructions for spawning agent in it
# Agents should cd to worktree path and work there

set -euo pipefail

HELPERS_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Validate args ---
if [[ $# -lt 3 ]]; then
  echo "Usage: worktree-agent.sh <project-path> <branch-name> <task-description>" >&2
  exit 1
fi

project_path="$1"
branch_name="$2"
task_description="$3"

if [[ ! -d "$project_path" ]]; then
  echo "Error: project-path does not exist: $project_path" >&2
  exit 1
fi

# --- Create worktree via helper ---
worktree_dir="$("$HELPERS_DIR/worktree-create.sh" "$project_path" "$branch_name")"

if [[ -z "$worktree_dir" ]]; then
  echo "Error: worktree-create.sh returned empty path" >&2
  exit 1
fi

# --- Output agent instructions ---
cat <<AGENT_INSTRUCTIONS

Worktree ready: $worktree_dir
Branch: $branch_name
Task: $task_description

To use in agent prompt:
  Working directory: $worktree_dir
  All edits go here — do NOT edit files in the main repo
  When done: commit all changes in this worktree

Claude Code agent spawn example:
  claude --cwd "$worktree_dir" \\
    "Branch: $branch_name | Task: $task_description. Work only inside this directory."

Cleanup when done:
  $HELPERS_DIR/worktree-cleanup.sh "$project_path" "$branch_name"
AGENT_INSTRUCTIONS
