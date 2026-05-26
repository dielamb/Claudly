---
name: zero-to-launch
description: Go from idea to shippable prototype using OpenAI's AI-first thinking, Figma's simplicity forcing, and Airbnb's complete experience design. Activates when starting a new product/feature from scratch, scoping an MVP, planning what to build first, or moving from concept to prototype.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
---

Apply zero-to-launch framework to:

$ARGUMENTS

---

# Zero to Launch

YOU MUST complete every step before recommending what to build. Skipping discovery produces the wrong product efficiently.

## Step 1 — Define the Core Job (MANDATORY, do this first)

Complete this sentence before anything else:
**"[Target user] needs to [accomplish X] so that [outcome Y]."**

If you cannot complete this sentence specifically → stop and gather more information. Do not proceed with a vague job statement.

## Step 2 — Simplicity Forcing (MANDATORY)

Answer all four questions. No skipping.

1. What is the ONE thing this product does that nothing else does?
2. If you could ship only ONE feature, what would it be?
3. What would you cut if launch timeline was halved?
4. What are users doing manually today that this replaces?

The answer to Q1 is your core. Everything else is later.

## Step 3 — Map the Complete Experience (MANDATORY before any code)

YOU MUST map every state of the journey:
```
Entry point    → How does the user arrive?
First screen   → What do they see in 3 seconds?
Core action    → The main thing they do
Loading state  → What shows while waiting? (design it now)
Success state  → Confirmation? Celebration?
Error state    → What if it fails? (design it now)
Empty state    → First-time user with no data? (design it now)
Return visit   → How is it different from first visit?
```

NEVER begin building without all states designed. "We'll handle errors later" is how products fail.

## Step 4 — MVP Scope (MANDATORY: max 3 features)

```
Core job: [one sentence]
Target user: [specific, not "everyone"]

MVP features:
1. [MUST-HAVE — core job cannot be done without this]
2. [MUST-HAVE — product doesn't work without this]
3. [NICE-TO-HAVE — cut if time-constrained]

Explicitly NOT in MVP:
- [feature] — reason: [why later]
- [feature] — reason: [why later]

Success metric: [one measurable outcome]
Ship criteria: [core job works for target user]
```

## Step 5 — Pre-Code Checklist (ALL must be checked before writing code)

- [ ] Core job defined in ONE sentence
- [ ] Target user is specific (not "users" — who exactly?)
- [ ] All states mapped (loading, error, empty, success)
- [ ] MVP scoped to maximum 3 features
- [ ] Success metric defined
- [ ] AI vs traditional code decision made for each feature
- [ ] What's explicitly NOT in MVP documented

**If any box is unchecked → do not proceed to code. Fill it first.**

## Common Pitfalls — YOU MUST flag these if present

- Scope > 3 MVP features → push back, reprioritize
- No success metric → define one before continuing
- Happy path only → map all states now
- Building before designing → prototype first, always
