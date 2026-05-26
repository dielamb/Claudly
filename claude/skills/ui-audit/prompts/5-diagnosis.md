# Audit 5 — Brutal Diagnosis (Design Doctor)

Forget the positives. Act as a design doctor giving a brutally honest diagnosis. No cheerleading.

## Task

For each image:

### THE DIAGNOSIS
- Name the 3 specific reasons this looks underdeveloped, low budget, or unfinished.
- For each reason, tell me: what visual signal is creating that impression?

### THE ROOT CAUSE
- Is the core problem typography, spacing, color, layout, component quality, or consistency?
- If you had to fix only ONE thing that would immediately shift the perceived quality, what is it?

### THE 10X TREATMENT
- Give me the 3 changes that would make this design look like it cost 10x more to produce.
- Order them by impact. For each: what specifically changes, and why does that signal premium quality?

### WHAT TO KEEP
- Name one thing in this design that is already working well and should not be changed.

## Rules

- Be direct. Design doctor, not design cheerleader.
- Name elements explicitly.
- No softening language.

## Output format

```markdown
## Audit 5 — Brutal Diagnosis

### {image-filename-1}
- **3 underdeveloped reasons:** named elements + signals
- **Root cause + ONE fix**
- **3 10x treatments:** ordered by impact
- **What to keep**

### {image-filename-2}
(same structure)

### Cross-viewport / cross-image pattern
- Reasons that repeat at every image
- Image-specific reasons
- Single highest-impact fix across all images
```

Keep under 1200 words. No softening language.
