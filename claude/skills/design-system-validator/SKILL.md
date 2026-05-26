---
name: design-system-validator
description: Validate code compliance with design system specifications — check token usage, hard-coded values, naming conventions, component props. Use when auditing codebase for design system adherence, finding violations, or generating compliance reports.
allowed-tools:
  - Task
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---

Validate design system compliance for:

$ARGUMENTS

---

# Design System Validator

YOU MUST scan thoroughly and report every violation. Partial audits create false confidence — worse than no audit.

## Step 1 — Establish Scan Scope (MANDATORY)

Before scanning, YOU MUST confirm:
- [ ] File paths to scan
- [ ] Token definitions location (or ask user to provide)
- [ ] File types: CSS, SCSS, TSX, JSX (default all four)
- [ ] Severity config: which violations are errors vs warnings

If token definitions are unavailable → STOP and ask. Do not guess what the tokens are.

## Step 2 — Scan for Hard-Coded Values (MANDATORY)

YOU MUST search for ALL of these — no exceptions:

**Colors:**
```bash
grep -rn "#[0-9a-fA-F]\{3,6\}" --include="*.{css,scss,tsx,jsx}"
grep -rn "rgb(" --include="*.{css,scss,tsx,jsx}"
grep -rn "rgba(" --include="*.{css,scss,tsx,jsx}"
```

**Spacing (hard-coded px):**
```bash
grep -rn "margin:\s*[0-9]" --include="*.{css,scss}"
grep -rn "padding:\s*[0-9]" --include="*.{css,scss}"
grep -rn "gap:\s*[0-9]" --include="*.{css,scss}"
```

**Typography:**
```bash
grep -rn "font-size:\s*[0-9]" --include="*.{css,scss}"
grep -rn "font-family:\s*['\"]" --include="*.{css,scss,tsx,jsx}"
```

## Step 3 — Check Naming Conventions (MANDATORY)

Every token reference MUST follow the project convention. Flag:
- Tokens that don't match naming pattern
- Deprecated token names still in use
- Missing semantic layer (using primitive tokens where semantic tokens should be used)

## Step 4 — Calculate Compliance Score

```
complianceScore = (passing checks / total checks) × 100
```

YOU MUST report:
- Overall score
- Score per category (colors, spacing, typography)
- Count: critical errors / warnings / passing

## Step 5 — Generate Actionable Report

For every violation:
```
FILE: src/components/Button.tsx:42
VIOLATION: Hard-coded color #3B82F6
RULE: Use design token instead
FIX: Replace with var(--color-action-primary)
SEVERITY: ERROR
```

NEVER report violations without specific fix instructions.

## Step 6 — ESLint/Stylelint Config (if requested)

Generate ready-to-use rules for CI integration. Do not describe them — write the actual config.
