---
name: color-contrast-analyzer
description: Analyze and optimize color contrast ratios for WCAG accessibility compliance. Use when checking color accessibility, finding failing contrast pairs, simulating color blindness, or building accessible color systems.
allowed-tools:
  - Task
  - Read
  - Write
  - Edit
  - Bash
---

Analyze color contrast for:

$ARGUMENTS

---

# Color Contrast Analyzer

Accessibility is not optional. YOU MUST check every pair — partial analysis is not analysis.

## WCAG Requirements — memorize these, apply them every time

| Text type | AA minimum | AAA |
|-----------|-----------|-----|
| Normal text (< 18pt / < 14pt bold) | **4.5:1** | 7:1 |
| Large text (≥ 18pt / ≥ 14pt bold) | **3:1** | 4.5:1 |
| UI components & graphics | **3:1** | — |

## Step 1 — Collect All Color Pairs (MANDATORY)

YOU MUST identify EVERY foreground/background combination:
- Text on backgrounds (all variants)
- Interactive elements (buttons, links, inputs)
- UI components (borders, icons, focus rings)
- Both light AND dark mode if applicable

NEVER analyze a subset and call it done. Every pair must be checked.

## Step 2 — Calculate Contrast Ratios (MANDATORY for each pair)

Use relative luminance formula (WCAG 2.x):
1. Convert hex to linear RGB
2. Calculate relative luminance: L = 0.2126R + 0.7152G + 0.0722B
3. Contrast ratio = (L1 + 0.05) / (L2 + 0.05) where L1 > L2

Report exact ratio for every pair — not approximations.

## Step 3 — Flag Failures (MANDATORY)

For every failing pair YOU MUST:
- State the current ratio
- State the required ratio
- Provide at least one specific alternative color that passes
- Alternative MUST preserve the original hue — just adjust lightness/darkness

## Step 4 — Color Blindness Simulation (MANDATORY if full palette review)

Simulate for:
- **Protanopia** (no red cones — ~1% of males)
- **Deuteranopia** (no green cones — ~8% of males)
- **Tritanopia** (no blue cones — rare)

Flag any information conveyed by color alone → MUST have secondary indicator (shape, pattern, label).

## Step 5 — Deliver Report

```
CONTRAST REPORT
===============
Pair: [foreground] on [background]
Ratio: X.X:1
Required: X.X:1 (AA)
Status: PASS / FAIL
Fix: [specific alternative hex if failing]

Overall compliance: X/Y pairs passing (AA)
Critical failures: [list]
```

NEVER deliver a report without fixes for every failure.
