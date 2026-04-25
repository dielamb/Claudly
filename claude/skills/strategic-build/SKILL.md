---
name: strategic-build
description: Distinguish high-impact work from busy-work using LNO framework and Shreyas Doshi's three levels. Activates when evaluating whether to build something, making architectural decisions, preventing premature optimization, or avoiding feature factory thinking.
allowed-tools:
  - Read
  - Write
  - Edit
---

Apply strategic-build frameworks to the following:

$ARGUMENTS

---

# Strategic Build

> "If you're just delivering output, you're a project manager. Product managers deliver outcomes." — Marty Cagan

## Framework 1: LNO Classification (Shreyas Doshi)

Classify every piece of work before starting:

| Type | Definition | Target |
|------|-----------|--------|
| **L — Leverage** | Compounds over time, enables future work | 70% of time |
| **N — Neutral** | Maintains current state, necessary but doesn't scale | 20% of time |
| **O — Overhead** | Busy-work, no meaningful return | Max 10% |

**Ask before any task:**
- Does this compound? → Leverage
- Does this maintain? → Neutral
- Does this just look busy? → Overhead — minimize or eliminate

## Framework 2: Three Levels of Product Work

Most teams skip Level 1 and go straight to Level 2 — this is how you build fast toward the wrong goal.

```
Level 1 — IMPACT (Why):
  What outcome are we driving?
  How will we measure success?
  Is this the highest-leverage use of our time?

Level 2 — EXECUTION (How):
  Technical approach
  Quality standards
  Dependencies and risks

Level 3 — OPTICS (Perception):
  Who needs to know?
  How do we communicate progress?
  What does success look like to stakeholders?
```

**Rule:** Never start Level 2 without clarity on Level 1.

## Framework 3: Pre-Mortem

Before committing to build, imagine it's 6 months later and the project failed.

```
1. What went wrong? (list top 3 failure modes)
2. Which failure was most likely?
3. What would have prevented it?
4. Do those prevention steps change our plan?
```

## Framework 4: Empowered vs Feature Team

**Empowered team:** Gets a problem to solve, owns the outcome.
**Feature team:** Gets a feature to build, ships it, moves on.

Ask: "Are we solving a problem or executing a feature list?"
- If feature list → push back, reframe as problem
- If problem → define success metric before building

## Decision Tree: Should We Build This?

```
What outcome does this drive?
  Unclear → stop, define it first

Is this Leverage, Neutral, or Overhead?
  Overhead → eliminate or delegate
  Neutral → do it efficiently, don't over-invest
  Leverage → invest fully

Pre-mortem: what's the top failure mode?
  Mitigable → build with safeguard
  Not mitigable → reconsider scope

Are we solving a problem or shipping a feature?
  Feature → reframe as problem first
  Problem → define success metric, then build
```

## Quick Assessment

```
Initiative: [name]
Outcome: [what changes for users/business?]
Metric: [how we'll measure success]
LNO type: [ ] Leverage  [ ] Neutral  [ ] Overhead
Top failure mode: [one sentence]
Mitigation: [one sentence]
Decision: [BUILD / DEFER / KILL]
```
