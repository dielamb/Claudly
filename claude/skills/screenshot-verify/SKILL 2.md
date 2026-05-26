---
name: screenshot-verify
description: chrome-devtools screenshot → check across 3 breakpoints (390 / 1440 / 2560). Pre-commit gate that confirms visual work is complete across all required viewports before marking any task done.
trigger: /screenshot-verify
---

# /screenshot-verify

Take chrome-devtools screenshots at the three required breakpoints and review each one for regressions. This is the pre-commit visual gate: it must pass before marking any visual task complete, before committing CSS or HTML, and before any checkpoint report.

## Usage

```
/screenshot-verify                         # all 3 breakpoints (default)
/screenshot-verify 390 1440               # specific viewports only
/screenshot-verify --reference <url>      # compare against a reference URL
```

## What You Must Do When Invoked

Run all three viewport checks. At minimum: 390, 1440, 2560. Each viewport is a full `/visual-qa` sequence — do not abbreviate.

### Step 1 — Mobile (390px)

Run the complete sequence for the mobile breakpoint:

1. `mcp__chrome-devtools__resize_page` → `width: 390, height: 900`
2. Reload page, wait for network idle
3. Wait 5000 ms
4. `mcp__chrome-devtools__take_screenshot`

Review: no overflow, no clipped content, touch targets not obscured.

### Step 2 — Laptop (1440px)

Repeat the sequence for the laptop breakpoint:

1. `mcp__chrome-devtools__resize_page` → `width: 1440, height: 900`
2. Reload page, wait for network idle
3. Wait 5000 ms
4. `mcp__chrome-devtools__take_screenshot`

Review: layout matches design intent, no excessive whitespace, typography readable.

### Step 3 — External Display (2560px)

Repeat the sequence for the large display breakpoint:

1. `mcp__chrome-devtools__resize_page` → `width: 2560, height: 1440`
2. Reload page, wait for network idle
3. Wait 5000 ms
4. `mcp__chrome-devtools__take_screenshot`

Review: max-width containers centered, no ultra-wide layout breakage, no unconstrained text lines.

### Step 4 — Reference Comparison (if `--reference <url>` provided)

Navigate to the reference URL. Take a screenshot at each viewport using the same sequence. Place reference and current screenshots side by side for comparison.

Document any intentional differences explicitly:

```
Intentional delta: hero padding 24px (current) vs. 16px (v1) — confirmed modernization
```

Unintentional deltas must be fixed before the gate passes.

### Step 5 — Issue Review

After all screenshots: check `mcp__chrome-devtools__list_console_messages` for errors.

Build the issue list:

| Viewport | Issue | Severity | Action |
|----------|-------|----------|--------|
| 390 | nav overflow | high | fix before passing |
| 1440 | ok | — | — |

### Step 6 — Pass or Fail

If no issues: output exactly:

```
Visual gate passed: 390 / 1440 / 2560 — no regressions.
```

If issues exist: output a table of issues and do NOT mark the task complete. Apply HR12: fix one property at a time, re-run `/screenshot-verify` after each fix.

## Failure Handling

- First failure: fix the specific property, re-run `/screenshot-verify`
- Second failure at the same viewport: invoke HR3 — revert to last clean commit, re-read the reference
- Never mark a task complete while `/screenshot-verify` is failing

## Rules

- This skill counts as one screenshot event even though it takes 3 screenshots (HR screenshot budget: max 3 per session).
- Reload is mandatory between resize and screenshot — never skip it.
- Always screenshot before reporting visual work complete. Not after.
- Pairs with `/visual-qa` (single viewport) and `/css-debug` (targeted property inspection).
