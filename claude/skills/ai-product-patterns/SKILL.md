---
name: ai-product-patterns
description: Build AI-native products using OpenAI's philosophy — evals as specs, hybrid AI/code approaches, future-model design. Activates when designing AI features, writing evals, choosing between AI vs deterministic code, building AI UX patterns, or planning AI product architecture.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---

Apply AI product patterns to the following:

$ARGUMENTS

---

# AI Product Patterns

> "The AI model you're using today is the worst AI model you will ever use for the rest of your life." — Kevin Weil, OpenAI CPO

## Principle 1: Design for Future Models

Build interfaces that SCALE with capability improvements — don't limit features to current model constraints.

```
DON'T: "The AI can't do X, so we won't offer X"
DO:    "The AI can't do X YET — design the UX for when it can"
```

Questions to ask:
- If the model were 10x better, would this UX still make sense?
- Are we constraining the product to today's limitations?
- What becomes possible in 6 months that we should design for now?

## Principle 2: Evals as Product Specs

> "At OpenAI, we write evals as product specs. If you can define good output in test cases, you've defined the product."

**Before writing code, write evals:**
```
Input: [user request]
Expected output: [what good looks like]
Failure modes: [what bad looks like]
Edge cases: [unusual but valid inputs]
```

Eval types:
- **Exact match** — factual, deterministic outputs
- **Human preference** — A/B comparison, thumbs up/down
- **LLM-as-judge** — use a model to grade outputs
- **Regression** — ensure new model doesn't break old cases

## Principle 3: Hybrid Approaches

| Use AI for | Use traditional code for |
|------------|--------------------------|
| Pattern matching | Deterministic logic |
| Natural language understanding | Validation & constraints |
| Content generation | Critical paths |
| Summarization | Authentication |
| Classification | Payments & billing |

**Rule:** If wrong answer = serious harm → traditional code or human-in-loop.

## Principle 4: AI UX Patterns

**Streaming responses** — show output as it generates, don't wait
**Confidence indicators** — surface uncertainty, don't fake confidence
**Progressive disclosure** — simple first, detail on demand
**Graceful fallbacks** — when AI fails, degrade gracefully (don't crash)
**Human-in-loop** — for high-stakes decisions, add human review step
**Undo/correct** — let users fix AI mistakes easily

## Decision Tree: AI vs Code vs Hybrid

```
Is output deterministic?
  YES → Traditional code

Is wrong output harmful/irreversible?
  YES → Human-in-loop or traditional code

Is natural language understanding needed?
  YES → AI component

Is pattern matching or classification needed?
  YES → AI component

Otherwise → Hybrid (AI for understanding, code for execution)
```

## Pre-Launch AI Checklist

- [ ] Evals written and passing
- [ ] Hybrid approach defined (what's AI, what's code)
- [ ] Cost per call estimated (× projected volume)
- [ ] Latency measured and acceptable
- [ ] Monitoring in place (errors, latency, quality degradation)
- [ ] Fallback behavior defined
- [ ] Rate limiting implemented
- [ ] PII handling reviewed
