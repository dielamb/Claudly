---
name: gan
description: Show GAN loop status, or run subcommands (kill, result, rubric, log). Use when user types /gan, /gan kill, /gan result, /gan rubric, or /gan log.
allowed-tools:
  - Bash
  - Read
---

Show GAN loop status for the running or most recent loop.

$ARGUMENTS

---

# GAN Status Skill

Read `~/.claude/tools/gan-loop/.gan-loop-state.json` and the latest run directory, then display:

```
GAN Loop Status

Task:      <task slug>
Profile:   <profile> (threshold X, N iter)
Status:    <RUNNING|DONE> — iteration N/M
Phase:     <generate|evaluate|done>
Duration:  Xm Ys

Last score: X.X/10 (iteration N)

Options:
  /gan kill    — terminate loop, mark as abandoned
  /gan result  — show latest draft.md
  /gan rubric  — show rubric being used
  /gan log     — tail live log output
```

## Implementation

1. Read state file: `~/.claude/tools/gan-loop/.gan-loop-state.json`
2. Find latest run dir: `ls -t ~/.claude/tools/gan-loop/runs/ | head -1`
3. Compute duration from `startedAt` field
4. Read last score from `runs/*/feedback/` (latest `.md` file, `weighted_total` field)

## Subcommand routing (from $ARGUMENTS)

If $ARGUMENTS contains:

**`kill`**: Read `pid` from state JSON → `kill <pid>` → write `{"status":"killed"}` to state file

**`result`**: `cat` the latest `runs/*/draft.md` or `runs/*/output.md`

**`rubric`**: Find matching rubric in `~/.claude/tools/gan-loop/rubrics/` by task name from state, `cat` it

**`log`**: `tail -50` the latest log from `~/.claude/tools/gan-loop/.logs/`

If no argument or no active loop: show status summary with last completed run info.
