---
name: visual-qa
description: resize → reload → wait 5s → screenshot → review for issues. One invocation replaces four manual tool calls and eliminates the failure mode of skipping reload between resize and screenshot.
trigger: /visual-qa
---

# /visual-qa

Run the full visual QA sequence for a given viewport in one atomic operation. Eliminates the failure mode of skipping reload after resize, which leaves JS state stale and makes screenshots unreliable.

## Usage

```
/visual-qa               # default viewport: 1440
/visual-qa 390           # mobile
/visual-qa 1280          # MacBook 14"
/visual-qa 1440          # laptop (default)
/visual-qa 2560          # external display
```

## What You Must Do When Invoked

Execute these four steps in order. Do not skip any step. Do not reorder them.

### Step 1 — Resize

Call `mcp__chrome-devtools__resize_page` with the target viewport.

- Default: `width: 1440, height: 900`
- If user passed a viewport argument, use that width.
- Accepted values: `390`, `1280`, `1440`, `2560`

### Step 2 — Reload

Call `mcp__chrome-devtools__navigate_page` with the current URL (or `mcp__chrome-devtools__reload` if available).

Wait for the page to reach network idle before proceeding. This step is mandatory — resize alone does not re-run layout-dependent JS.

### Step 3 — Wait

Wait exactly **5000 ms** after reload completes. This allows CSS transitions, lazy-loaded images, and font rendering to settle.

### Step 4 — Screenshot

Call `mcp__chrome-devtools__take_screenshot`. Capture full page.

## Review Checklist

After screenshot, check all of the following before reporting results:

- No horizontal overflow (no horizontal scrollbar visible)
- No console errors in screenshot (check via `mcp__chrome-devtools__list_console_messages`)
- No broken layouts (elements clipped, overlapping, or out of viewport)
- No unstyled content flash visible

If any check fails: report the specific failure. Do NOT mark the visual task complete.

## Example

```
/visual-qa 390
→ resize_page(width=390, height=900)
→ reload page, wait for network idle
→ wait 5000ms
→ take_screenshot()
→ review: no overflow at 390px, no console errors
```

## Rules

- Run at minimum three viewports before closing any visual ticket: `390`, `1440`, `2560`.
- Never chain CSS edits between steps — each file change requires a fresh `/visual-qa` run.
- This skill counts as one screenshot event for session budget tracking (HR screenshot policy: max 3 per session).
- Pairs with `/css-debug` for the full inspect → fix → verify cycle.
- Pairs with `/screenshot-verify` for pre-commit multi-viewport confirmation.
