# Trace-to-Skill

Generate evidence-based skill rules from real Claude Code executions.

## Purpose

Skill files in `~/.claude/skills/` are currently hand-written: the rules were
guessed, not derived from actual runs. Trace-to-Skill closes that gap by:

1. Running a skill task N times with automatic variation (easy/normal/hard/adversarial)
2. Collecting binary feedback (good/bad) per run
3. Feeding traces to 4 parallel analyst agents (error, success, structure, edge)
4. Consolidating extracted rules by evidence frequency into a ranked rule set

Rules that survive 8+ evidence mentions become **Core Rules**. Rules with 4-7
become **Guidance**. Rules with 2-3 become **Edge Cases**. Anything below the
threshold is discarded.

## Requirements

- Node.js (no npm packages — stdlib only)
- `claude` CLI in PATH

## Usage

### Step 1 — Collect traces

```bash
node ~/.claude/helpers/trace-to-skill/runner.js \
  --skill impeccable \
  --task "redesign CS01 section" \
  --n 10 \
  --output ./traces/impeccable
```

- Generates 10 task variations (easy/normal/hard/adversarial, cycling)
- Runs each via `claude -p "/skill:impeccable <task>" --output-format stream-json`
- Prompts: `Was this output good? (y/n):`
- Saves each run to `./traces/impeccable/001.jsonl` ... `010.jsonl`

### Step 2 — Analyze traces

```bash
node ~/.claude/helpers/trace-to-skill/analyzer.js \
  --traces ./traces/impeccable \
  --output ./traces/impeccable/analysis \
  --skill impeccable
```

- Reads all `.jsonl` files and classifies by feedback
- Spawns 4 analyst agents in parallel using `claude --model claude-haiku-4-5-20251001`
- Saves: `analysis/analyst-error.txt`, `analyst-success.txt`, `analyst-structure.txt`, `analyst-edge.txt`
- Automatically calls consolidator

### Step 3 — Consolidate rules

```bash
node ~/.claude/helpers/trace-to-skill/consolidator.js \
  --analysts ./traces/impeccable/analysis \
  --skill impeccable \
  --threshold 2
```

Add `--update` to write rules back into `~/.claude/skills/impeccable/skill.md`:

```bash
node ~/.claude/helpers/trace-to-skill/consolidator.js \
  --analysts ./traces/impeccable/analysis \
  --skill impeccable \
  --threshold 2 \
  --update
```

### Full pipeline (one command after runner finishes)

```bash
node ~/.claude/helpers/trace-to-skill/analyzer.js \
  --traces ./traces/impeccable \
  --output ./traces/impeccable/analysis \
  --skill impeccable \
  --update
```

The analyzer automatically calls consolidator with the same flags passed through.

## Output format

```markdown
## Core Rules (apply always)
1. Always read existing CSS before writing new rules [evidence: 12 runs]

## Guidance (apply in most cases)
- Verify cross-viewport consistency before completing [evidence: 6]

## Edge Cases (apply when relevant)
- When layout is pre-broken, document state before touching it [evidence: 2]
```

## When to use

- After noticing a skill fails repeatedly on a certain type of task
- When onboarding a new skill and you want evidence-based rules from day one
- After a major codebase change that might invalidate existing skill assumptions
- Periodically (monthly) to catch rule drift

## Variation types

| Type | Modifier added to base task |
|---|---|
| easy | Single file, minimal scope |
| normal | Standard complexity |
| hard | Multi-file, complex constraints |
| adversarial | Edge case, broken state, conflicting requirements |

Variations cycle through types automatically: run 1=easy, 2=normal, 3=hard, 4=adversarial, 5=easy, ...

## File structure

```
~/.claude/helpers/trace-to-skill/
  runner.js           collect traces + feedback
  analyzer.js         orchestrate 4 parallel analysts
  consolidator.js     merge + rank rules by frequency
  prompts/
    error-analyst.md
    success-analyst.md
    structure-analyst.md
    edge-analyst.md
  README.md
```
