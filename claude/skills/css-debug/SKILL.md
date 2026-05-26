---
name: css-debug
description: check computed styles → compare elements → calculate delta → edit. Prevents guessing at CSS overrides and the revert cycles that follow. One invocation replaces 3–4 manual inspect calls.
trigger: /css-debug
---

# /css-debug

Inspect computed CSS on a selector, compare against a target or reference element, calculate the exact property delta, then make one targeted edit. Prevents editing CSS without first knowing the computed state — the root cause of most multi-round fix cycles.

## Usage

```
/css-debug <selector>                      # inspect one element vs. design spec
/css-debug <selector-a> <selector-b>      # compare two elements
```

## What You Must Do When Invoked

Execute steps in order. After each edit: stop. Run `/visual-qa` to verify. Do not batch edits.

### Step 1 — Inspect Computed Styles

Call `mcp__chrome-devtools__take_snapshot` or `mcp__chrome-devtools__evaluate_script` to get computed styles for `<selector-a>`.

Capture at minimum these property groups:

| Group | Properties |
|-------|-----------|
| Box model | `width`, `height`, `padding`, `margin`, `border`, `box-sizing` |
| Typography | `font-size`, `font-family`, `font-weight`, `line-height`, `letter-spacing` |
| Color | `color`, `background-color`, `opacity` |
| Layout | `display`, `position`, `flex-*`, `grid-*`, `overflow` |

Use this script as a starting point:

```js
const el = document.querySelector('<selector>');
const s  = getComputedStyle(el);
['width','height','padding','margin','font-size','line-height','color',
 'background-color','display','position','overflow'].map(p => `${p}: ${s[p]}`).join('\n');
```

### Step 2 — Inspect Reference (if two selectors provided)

Repeat Step 1 for `<selector-b>`. This is the reference element you want `<selector-a>` to match, or a v1 element being ported.

### Step 3 — Calculate Delta

Produce a diff table:

```
| Property         | Current        | Target         | Action        |
|------------------|----------------|----------------|---------------|
| line-height      | 1.5            | 1.1            | change        |
| padding-top      | 24px           | 16px           | change        |
| font-size        | 18px           | 18px           | ok — no edit  |
```

If only one selector was provided, derive "Target" from the design spec or CLAUDE.md token values.

Only include properties that differ. Do not list matching properties as action items.

### Step 4 — Edit (one property at a time)

Pick the highest-impact differing property from the diff table. Make **one** targeted CSS edit.

Rules for the edit:
- Do not add `!important` — fix specificity instead.
- Do not modify parent elements to fix a child.
- Prefer the lowest-specificity selector that achieves the change.
- After the edit, run `/visual-qa` at the relevant viewport before making the next edit.

### Step 5 — Confirm Delta Collapsed

Re-run Step 1 on `<selector-a>`. Confirm the edited property now matches target. If it does not: diagnose (specificity conflict? wrong selector?) before retrying.

## Example

```
/css-debug .hero__title
→ getComputedStyle(".hero__title")
→ diff vs. design spec: line-height 1.5 → expected 1.1
→ edit: .hero__title { line-height: 1.1; }
→ /visual-qa 1440
→ re-inspect: line-height now 1.1 — delta collapsed
```

## Rules

- Never batch multiple property changes in one edit — isolate cause and effect.
- If a property does not change after edit: check cascade and specificity before giving up.
- HR12 applies: fix what broke, not the surroundings.
- Pairs with `/visual-qa` after every edit.
