---
name: ux-researcher-designer
description: Conduct UX research and design — user personas, customer journey maps, usability testing frameworks, research synthesis. Activates when creating user personas, mapping customer journeys, planning usability tests, synthesizing research, or conducting user-centered design work.
allowed-tools:
  - Task
  - Read
  - Write
  - Edit
  - WebSearch
  - WebFetch
---

Conduct UX research or design for:

$ARGUMENTS

---

# UX Researcher & Designer

## Step 1 — Select Mode (required before proceeding)

- [ ] Persona generation
- [ ] Journey mapping
- [ ] Usability testing plan
- [ ] Heuristic evaluation
- [ ] Research synthesis

Mode unclear → ask. Do not assume.

---

## Persona Generation

Required inputs before starting:
- Raw interview data OR behavioral patterns
- Number of participants (minimum 3)

**Structure — all sections required:**
```
## [Name], [Age] — [Role/Context]

### Goals
Primary: [from data]
Secondary: [from data]

### Pain Points
1. [Pain] — observed in [n] participants
2. [Pain] — observed in [n] participants

### Behaviors (observed)
- [Pattern + source]

### Quote
"[Verbatim or composite from actual interviews]"

### Design Implications
- [Specific decision this drives]

### Confidence: [High/Medium/Low] — n=[number]
```

---

## Customer Journey Map

Cover all stages — incomplete journeys miss critical friction:

```
Stage:         Awareness → Consideration → Decision → Onboarding → Retention → Churn risk
Actions:       [What user does]
Thoughts:      [What they're thinking]
Emotions:      [😕🤔😊😤 — specific]
Touchpoints:   [Where they interact]
Pain Points:   [Specific friction]
Opportunities: [Specific design intervention]
```

---

## Usability Test Plan

Define all fields before testing begins:
```
Goal:    [The ONE question this test answers]
Method:  [Moderated/Unmoderated | Remote/In-person]
n:       [minimum 5 for qualitative patterns]
Tasks:   [scenario-based, never leading]
  1. "You want to export your report. Show me how."
  NOT: "Click the export button."
Metrics:
  - Task completion rate
  - Time on task
  - Error rate
  - SUS score (0–100)
```

---

## Heuristic Evaluation

Rate all 10 heuristics 0–4 (0=no issue, 4=catastrophe):
1. Visibility of system status
2. Match between system and real world
3. User control and freedom
4. Consistency and standards
5. Error prevention
6. Recognition over recall
7. Flexibility and efficiency
8. Aesthetic and minimalist design
9. Help users recognize/recover from errors
10. Help and documentation

Severity 3–4 → specific fix required, not just flagged.

---

## Research Synthesis

Rainbow spreadsheet: participants (rows) × themes (columns), color-coded positive/negative/neutral.

Convert pain points to HMW statements:
```
Pain:  "Users can't find export"
HMW:   "How might we make export always discoverable?"
```
