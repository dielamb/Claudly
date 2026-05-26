---
name: visual-qa-scorer
description: Score UI implementations against design mocks across 6 quality dimensions. Use when validating pixel-perfect implementation, comparing design vs code, tracking implementation quality, or running visual QA checks.
allowed-tools:
  - Task
  - Read
  - Write
  - Edit
  - Bash
---

Score this UI implementation against the design:

$ARGUMENTS

---

# Visual QA Scorer

YOU MUST evaluate all 6 dimensions. Skipping any dimension produces an invalid score.

## Required Inputs — gather before scoring

YOU MUST have both before proceeding:
- [ ] Design reference (Figma URL, screenshot, or spec)
- [ ] Implementation reference (screenshot, live URL, or code)

If either is missing → ask for it. Do not score with one input.

## The 6 Dimensions (ALL mandatory)

### 1. Layout (25% weight)
- Grid alignment: elements snap to grid?
- Element positioning: matches design within tolerance (±4px)?
- Container sizing: matches spec?
- Overall structure: major layout differences?

**Scoring:** Start at 25. Deduct:
- -10 per critical difference (>10px or >10%)
- -5 per major difference (5–10px)
- -2 per minor difference (<5px)

### 2. Typography (20% weight)
- Font families correct?
- Font sizes within ±1px?
- Font weights match?
- Line heights correct?
- Letter spacing correct?

### 3. Color (20% weight)
- Background colors within ±5 delta-E?
- Text colors match?
- Gradients match direction and stops?
- Shadows match?

### 4. Spacing (20% weight)
- Margins match within ±4px?
- Padding match within ±4px?
- Gap between elements correct?

### 5. Component Fidelity (10% weight)
- Buttons styled correctly (all states)?
- Inputs styled correctly?
- Cards match spec?
- Interactive states present?

### 6. Decorative Elements (5% weight)
- Icons positioned correctly?
- Illustrations placed correctly?
- Visual effects (blur, shadow) match?

## Score Calculation

```
Score = 100 - total deductions across all dimensions
```

## Output Format (MANDATORY structure)

```
VISUAL QA REPORT
================
Overall Score: XX/100

Breakdown:
- Layout:     XX/25
- Typography: XX/20
- Color:      XX/20
- Spacing:    XX/20
- Components: XX/10
- Decorative: XX/5

Critical Issues (fix before ship):
1. [specific issue + location + fix]

Major Issues (fix in this iteration):
1. [specific issue + location + fix]

Minor Issues (track for polish):
1. [specific issue + location + fix]

Recommendation: [SHIP / ITERATE / REWORK]
```

YOU MUST include specific fixes for every critical and major issue. Vague feedback ("colors don't match") without a specific fix is not acceptable.
