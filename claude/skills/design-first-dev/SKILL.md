---
name: design-first-dev
description: Apply design-first development philosophy when building user-facing features or UI. Automatically activates when building interfaces, making UI/UX decisions, choosing between quick prototype vs polished experience, creating onboarding or core flows, or deciding if craft quality matters for a feature.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---

Apply the design-first development philosophy to the following task:

$ARGUMENTS

---

# Design-First Development — Craft Quality Standards

## When This Skill Activates

- Building user-facing features or interfaces
- Making UI/UX decisions
- Deciding between quick prototype vs polished experience
- Creating onboarding, core flows, or key moments
- Determining if "details matter" for this feature

---

## Framework 1: Design-Led Process (Airbnb / Brian Chesky)

> "There's a difference between micromanagement and being in the details. If you don't know the details, how do you know people are doing a good job?"

**Prototype full experience BEFORE writing code.**

**All States Must Be Designed:**
- Loading states (what user sees while waiting)
- Error states (graceful failures)
- Empty states (first-time user experience)
- Success states (celebrations, confirmations)

```
DON'T:
- Write code first, design later
- "We'll polish it after we ship"
- Design only happy path

DO:
- Design complete experience (all states)
- Prototype before building
- Craft the details that users notice
```

---

## Framework 2: Craft Quality Philosophy (Figma / Dylan Field)

> "AI makes design, craft, and quality the new moat for startups. The bar for quality is going way up."

**HIGH CRAFT — polish details:**
- User-facing core flows
- Onboarding experiences
- Key conversion moments
- Brand touchpoints
- Competitive differentiators

**LOW CRAFT — move fast:**
- Internal dashboards / admin panels
- Quick experiments / hypothesis testing
- Support tooling
- Behind-the-scenes (logging, monitoring)

**Craft Quality Checklist:**
- [ ] Consistent spacing (8px grid)
- [ ] Proper hierarchy (typography scale)
- [ ] Smooth interactions (animations, transitions)
- [ ] Responsive (all screen sizes)
- [ ] Accessible (keyboard nav, screen readers)
- [ ] Loading states (skeleton screens, spinners)
- [ ] Error handling (helpful messages)
- [ ] Empty states (guide to first value)

---

## Framework 3: The One Roadmap / Story Test (Brian Chesky)

> "We shifted to one company roadmap. This meant we could have a coherent story."

Before building any feature ask:
1. How does this fit the product story?
2. Does this reinforce the core value prop?
3. Will users understand why this exists?

---

## Framework 4: Design System Thinking

**FOUNDATIONS:**
- Colors (primary, secondary, grays, feedback states)
- Typography (scale, weights, line heights)
- Spacing (8px grid: 4, 8, 16, 24, 32, 48, 64)
- Radius (4, 8, 16px)
- Shadows (elevation levels)

**COMPONENTS:** Buttons, Inputs, Cards, Modals, Navigation, Feedback (alerts, toasts, loading)

**PATTERNS:** Forms, Tables, Empty states, Error states, Loading states

---

## Decision Tree: Polish vs Ship

```
Is this user-facing?
  NO  → MOVE FAST
  YES ↓

Is this core product experience?
  YES → HIGH CRAFT
  NO  ↓

Is this first impression (onboarding/signup)?
  YES → HIGH CRAFT
  NO  ↓

Used frequently (daily/weekly)?
  YES → HIGH CRAFT
  NO  ↓

Competitive differentiator?
  YES → HIGH CRAFT
  NO  → GOOD ENOUGH
```

---

## State Design Checklist

For every user-facing feature:

| State | Question |
|-------|----------|
| **Loading** | What does user see while fetching data? |
| **Error** | What if API fails? Network error? |
| **Empty** | What if user has no data yet? |
| **Success** | How do we confirm action completed? |
| **First Use** | What does new user see? |
| **Partial** | What if data is incomplete? |

---

## Before You Code Checklist

- [ ] Prototype complete experience (not just happy path)
- [ ] All states designed (loading, error, empty, success)
- [ ] Craft level determined (high/medium/low)
- [ ] Fits product narrative (story test passed)

## Before Ship Checklist

- [ ] All states implemented
- [ ] Craft quality matches requirements
- [ ] Responsive on all devices
- [ ] Accessible
- [ ] Story ready (how to talk about it)

---

## Common Pitfalls

- **Polish everything** — reserve high craft for features where quality = moat
- **Ship happy path only** — always design all states before building
- **Design after building** — "polish later" never happens; prototype first
- **Feature salad** — add features that don't fit the narrative

---

## Key Quotes

> "Leaders are in the details. The question isn't whether to be in the details, but which details matter." — Brian Chesky

> "With AI, everyone can build. The differentiator is craft. Quality is the new moat." — Dylan Field
