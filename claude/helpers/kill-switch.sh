#!/bin/bash
# Global kill switch for Claude Code
# Blocks ALL tool calls when ~/.claude/KILL_SWITCH file exists
# Hook type: PreToolUse (matcher: "*" - applies to every tool)
#
# Exit codes:
#   0 = allow (no kill switch active)
#   2 = block with reason (stops the tool call)

KILL_FILE="$HOME/.claude/KILL_SWITCH"

if [ -f "$KILL_FILE" ]; then
    # Read reason from file if non-empty, otherwise generic message
    REASON=$(cat "$KILL_FILE" 2>/dev/null | head -1)
    if [ -z "$REASON" ]; then
        REASON="Kill switch active. Remove ~/.claude/KILL_SWITCH to resume."
    fi

    # Log activation to a file so we know what was blocked
    LOG_FILE="$HOME/.claude/kill-switch.log"
    echo "[$(date -Iseconds)] BLOCKED tool call | reason: $REASON" >> "$LOG_FILE"

    # Exit code 2 + stderr message = Claude Code blocks the tool call
    echo "BLOCKED BY KILL SWITCH: $REASON" >&2
    exit 2
fi

# No kill switch file = allow
exit 0
