---
name: ship-decisions
description: Decide whether to ship now or iterate further using Bezos reversible/irreversible framework, Shreyas Doshi's scorecard, and gradual rollout strategy. Activates when evaluating launch readiness, making ship-or-hold decisions, or managing technical debt vs velocity tradeoffs.
allowed-tools:
  - Read
  - Write
  - Edit
---

Evaluate this ship decision:

$ARGUMENTS

---

# Ship Decisions

YOU MUST run through all three frameworks before making a recommendation. A gut-feel ship decision is not a ship decision.

## Step 1 — Door Classification (MANDATORY, do this first)

**This determines everything else.**

**Two-way door (reversible):**
- Can undo within hours/days
- Limited blast radius if wrong
- Examples: UI changes, copy, non-critical features, pricing experiments
→ Default: SHIP FAST, learn, iterate

**One-way door (irreversible):**
- Hard or impossible to undo
- Large blast radius: data loss, broken trust, public contracts, security
- Examples: data schema changes, public APIs, pricing model shifts, security architecture
→ Default: SLOW DOWN, add safeguards, get more eyes on it

If it's a one-way door, YOU MUST flag this explicitly before continuing.

## Step 2 — Shipping Scorecard (MANDATORY: all 5 must be YES to ship)

Score honestly. Do not rationalize a YES for something that is NO.

- [ ] Core functionality works (happy path is solid)
- [ ] Edge cases are acceptable (not perfect — but not breaking)
- [ ] Decision is reversible (or blast radius is acceptable)
- [ ] Learning value exceeds polish value (shipping teaches more than more polish would)
- [ ] Known risks are mitigated (fallbacks exist for identified failure modes)

**If any box is NO → do not ship. Identify what needs to change.**

## Step 3 — Technical Debt Assessment (MANDATORY)

```
Ship when:   User value delivered > technical debt cost
Refactor when: Debt compounds OR blocks future work OR is a security risk

Is the debt isolated?    YES → ship, log it, schedule fix
Is the debt compounding? YES → refactor before shipping
Is the debt a security risk? YES → NEVER ship. Fix first.
```

## Step 4 — Rollout Plan (MANDATORY for anything non-trivial)

YOU MUST define the rollout before shipping:

```
Stage 1: Internal (team/dogfood)
Stage 2: X% of users → [who? how long? what metrics?]
Stage 3: Y% → [criteria to proceed]
Stage 4: 100%

Kill switch: [YES / NO — if NO, explain why acceptable]
Rollback time: [how long to fully revert if needed?]
```

## Deliver: Ship Decision

```
SHIP DECISION REPORT
====================
Feature: [name]
Door type: TWO-WAY / ONE-WAY

Scorecard: [X/5 YES]
Failing criteria: [list any NO answers]

Tech debt: [isolated / compounding / security risk]

Rollout plan: [stages]
Kill switch: [yes/no]

DECISION: SHIP / ITERATE / HOLD
Reason: [one specific sentence]
Next action: [concrete next step]
```

NEVER deliver a HOLD recommendation without a specific next action.
