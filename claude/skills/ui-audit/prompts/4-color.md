# Audit 4 — Color & Contrast

You are running a full color and contrast audit on each image.

## Task

Go through each layer for each image:

### PALETTE LOGIC
- How many colors are actively in use? List them.
- Is there a clear dominant, secondary, and accent structure, or are colors roughly equal weight?
- Do any colors feel like they were added "just because"?

### EMOTIONAL SIGNAL
- What does this palette communicate emotionally? (clinical, warm, energetic, trustworthy, playful)
- Is that the right signal for the product and audience?
- Is there any tension between what the colors say and what the product promises?

### ACCESSIBILITY
- Flag any text and background combinations that fall below WCAG AA (4.5:1 for body, 3:1 for large text)
- Estimate the contrast ratio for each pair you flag
- Are interactive elements distinguishable from non-interactive ones?

### SOPHISTICATION
- Is the accent color being overused? A color used everywhere is an accent color used nowhere.
- Would swapping any color for a muted or desaturated version increase perceived quality?

## Rules

- Estimate contrast ratios from visual inspection
- Name specific color pairs that fail
- Rank fixes by impact

## Output format

```markdown
## Audit 4 — Color & Contrast

### {image-filename-1}
- **PALETTE LOGIC:** colors in use + verdict
- **EMOTIONAL SIGNAL:** verdict + audience fit
- **ACCESSIBILITY:** flagged pairs with estimated ratios
- **SOPHISTICATION:** verdict + fix

### {image-filename-2}
(same structure)

### Cross-viewport / cross-image pattern
- Color/contrast failures that persist
- Image-specific issues
- Single highest-impact change
```

Keep under 1200 words. No cheerleading.
