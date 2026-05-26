## Purpose

Tests the prompt-enrichment.sh memory retrieval pipeline against 20 curated prompts and feeds pass/fail logs to 4 analyst agents to produce improvement rules.

## Prerequisites

- jq (brew install jq)
- node >=18
- claude CLI in PATH (claude --version to verify)
- prompt-enrichment.sh at __HOME__/.claude/hooks/prompt-enrichment.sh
- Obsidian vault at ~/Desktop/Labirynt/ (for domain rules injection)

## Quick start

Four steps — the feedback step is interactive:
```bash
# Step 1: run 20 test cases
bash runner.sh

# Step 2: review results + add your feedback (interactive)
node feedback.js --logs results/latest

# Step 3: 4 analysts read everything (runs + your feedback) in parallel
node analyzer.js --logs results/latest --output results/latest/analysis

# Step 4: merge into consolidated-rules.md
node __HOME__/.claude/helpers/trace-to-skill/consolidator.js \
  --analysts results/latest/analysis --skill knowledge-checker --threshold 1
```

## Feedback session (step 2)

```
=== Knowledge-Checker Feedback Session ===
Logs: results/latest | Runs: 20 | y=correct  n=wrong  s=skip  q=quit

──────────────────────────────────────
[1/20] PASS  (expected PASS)
  Prompt: portfolio hero section redesign
  Keywords matched: portfolio
  Context (1842 chars): ## Domain Rules (portfolio)...
  Was retrieval correct? (y/n/s/q): y
  ✓ saved

[2/20] FAIL  (expected PASS)
  Prompt: Avocado projekt aktualny status
  Context (0 chars): (empty — no context injected)
  Was retrieval correct? (y/n/s/q): n
  What went wrong? Jaccard too strict for Polish project names
  ✗ saved
```

Feedback is written back into each `run-N.json` as `feedback.correct` + `feedback.note`. Analysts use this signal alongside automatic pass/fail.

## Pipeline diagram

```
test-prompts.json
    |
    v
runner.sh ──────────────────────> results/run-YYYYMMDD/run-N.json (×20)
                                            |
                                            v
                                     feedback.js  ← you review + annotate here
                                            |
                                            v
                                       analyzer.js
                                            |
              ┌─────────────────────────────┤
              v                             v
    error-analyst.md          success-analyst.md
    structure-analyst.md      edge-analyst.md
              |                             |
              └─────── claude haiku (×4) ───┘
                              |
                              v
                     analyst-*.txt (×4)
                              |
                              v
                     consolidator.js
                              |
                              v
                     consolidated-rules.md
```

## Test case categories

| Category | Count | Example prompts | Expected result |
|---|---|---|---|
| Domain keyword hits | 7 | portfolio hero section redesign, gan-loop rubric file missing | PASS (context injected) |
| RuFlo/Obsidian hits | 5 | Avocado projekt aktualny status, ruflo session loader nie dziala | PASS |
| Skip edge cases | 4 | hej, ok, tak nie, sprawdz to | SKIP (<4 words) |
| No-match prompts | 4 | przepis na zupe pomidorowa, pogoda jutro w Warszawie | FAIL (no context) |

## Classification rules

- **PASS** - prompt >=4 words AND prompt-enrichment.sh returns non-empty additionalContext AND at least one expected_keyword found in additionalContext
- **FAIL** - prompt >=4 words AND (hook exits non-zero OR empty context OR no keyword match)
- **SKIP** - prompt <4 words by wc -w count. Expected behavior, not a bug.

## Expected terminal output (sample)

```
[PASS] portfolio hero section redesign
[PASS] gan-loop rubric file missing
[FAIL] Avocado projekt aktualny status
[SKIP] hej
[SKIP] ok
...
14 passed, 2 failed, 4 skipped of 20
```
