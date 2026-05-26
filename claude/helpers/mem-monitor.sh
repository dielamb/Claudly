#!/bin/bash
# Persistent memory monitor — kills runaway node/claude processes before jetsam
# Logs to ~/.claude/logs/mem-monitor-live.log AND ~/logs/mem-monitor-live.log
# Managed by launchd: ~/Library/LaunchAgents/pl.maciejewski.mem-monitor.plist

LOGFILE="$HOME/.claude/logs/mem-monitor-live.log"
KILL_MB=4096  # 4 GB per proc — crash MCP cleanly rather than jetsam the whole system

log() {
    echo "[$(date '+%H:%M:%S')] $1" >> "$LOGFILE" 2>/dev/null
}

while true; do
    FREE_PAGES=$(vm_stat | awk '/Pages free/ {gsub(/\./,"",$3); print $3}')
    FREE_GB=$(echo "scale=1; $FREE_PAGES * 16384 / 1073741824" | bc 2>/dev/null || echo "?")

    # Count headless claudes (exclude main interactive session)
    HEADLESS_COUNT=$(ps aux | grep "claude.*-p \|claude.*dangerously" | grep -v grep | grep -v "^$(whoami).*claude --dangerously-skip-permissions$" | wc -l | tr -d ' ')

    ALL_RSS=$(ps aux | grep -E "node.*mcp|claude" | grep -v grep | awk '{sum+=$6} END {printf "%.0f", sum/1024}')
    CLAUDE_PIDS=$(ps aux | grep "claude.*dangerously\|claude.*-p" | grep -v grep | awk '{print $2}' | tr '\n' ',' | sed 's/,$//')

    # Kill node/claude processes with RSS > KILL_MB
    HEAVY=$(ps aux | grep -E "node|claude" | grep -v grep | awk -v limit=$KILL_MB '{
        rss_mb = $6 / 1024
        if (rss_mb > limit) print $2, int(rss_mb), $11, $12
    }')

    if [ -n "$HEAVY" ]; then
        log "KILL | Free=${FREE_GB}GB | heavy procs over ${KILL_MB}MB:"
        echo "$HEAVY" | while read pid rss_mb cmd arg; do
            log "  → KILL PID=$pid RSS=${rss_mb}MB ($cmd $arg)"
            kill -9 "$pid" 2>/dev/null
        done
    else
        log "OK | Free=${FREE_GB}GB | node+claude_total=${ALL_RSS}MB | headless_claudes=${HEADLESS_COUNT} | claude_pids=[$CLAUDE_PIDS]"
    fi

    # auto-memory-hook: should never exceed 3GB in normal operation
    ps aux | grep "auto-memory-hook" | grep -v grep | awk '$6 > 3145728 {print $2, int($6/1048576)}' | while read pid gb; do
        log "KILL auto-memory-hook PID=$pid RSS=${gb}GB (>3GB threshold)"
        kill -9 "$pid" 2>/dev/null
    done

    # Emergency: >3 headless claudes = likely recursion cascade
    if [ "$HEADLESS_COUNT" -gt 3 ]; then
        log "EMERGENCY: $HEADLESS_COUNT headless claudes → pkill cascade"
        pkill -9 -f "auto-memory-hook" 2>/dev/null
        pkill -9 -f "claude.*-p " 2>/dev/null
    fi

    # Emergency: free < 3GB = kill MCP servers + auto-memory
    FREE_NUMERIC=$(echo "$FREE_GB" | tr -d '.')
    if (( $(echo "$FREE_GB < 3.0" | bc -l 2>/dev/null || echo 0) )); then
        log "EMERGENCY: ${FREE_GB}GB free → killing MCP + auto-memory-hook"
        pkill -9 -f "auto-memory-hook" 2>/dev/null
        pkill -9 -f "playwright-mcp" 2>/dev/null
        pkill -9 -f "screen-vision-mcp" 2>/dev/null
        pkill -9 -f "@claude-flow/cli.*mcp" 2>/dev/null
        pkill -9 -f "@21st-dev/magic" 2>/dev/null
        pkill -9 -f "chrome-devtools-mcp" 2>/dev/null
    fi

    sleep 10
done
