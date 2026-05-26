---
name: humanizer
description: Detect and remove AI-generated writing patterns to make text sound natural and human-authored. Activates when asked to humanize text, make writing sound less robotic, remove AI tells, or improve natural voice.
allowed-tools:
  - Read
  - Write
  - Edit
---

Humanize the following text:

$ARGUMENTS

---

# Humanizer

YOU MUST transform the text to sound like a real human wrote it. Preserve all facts and meaning — change voice and style completely.

## Step 1 — Scan for AI Patterns (MANDATORY)

YOU MUST identify and eliminate EVERY instance of:

**Hedging openers — DELETE immediately, no exceptions:**
- "It's important to note that..." → cut the opener, keep the fact
- "It's worth mentioning..." → same
- "Certainly!" / "Absolutely!" / "Of course!" → delete entirely
- "In today's fast-paced world..." → delete entirely

**Formulaic structure — BREAK IT:**
- Three-part lists for everything → vary the structure
- "Firstly... Secondly... Thirdly... In conclusion..." → rewrite entirely
- Exhaustive enumeration → prioritize, cut the rest

**Intensifier inflation — REMOVE:**
- "very," "extremely," "incredibly," "significantly" → delete or replace with specifics
- "comprehensive," "robust," "seamlessly," "leverage" → plain English

**Meta-commentary — CUT:**
- "This is a complex topic..." → just address the topic
- "There are many aspects to consider..." → consider them, don't announce it
- "In summary, as we've seen..." → cut the summary opener

## Step 2 — Apply Human Voice (MANDATORY for every paragraph)

YOU MUST apply ALL of these:

1. **Vary sentence length dramatically** — short sentences after long ones. Uniform rhythm = AI tell. No exceptions.
2. **Use contractions** — "it's," "don't," "you'll" wherever natural
3. **Allow imperfect constructions** — fragments work. Starting with "And" or "But" is fine.
4. **Cut ruthlessly** — if a sentence adds nothing, DELETE it. Not shorten. Delete.
5. **Specific over generic** — "cut time from 10 min to 90 sec" beats "significantly reduced time"
6. **Start with the point** — no preamble, no throat-clearing

## Step 3 — Read-Aloud Test (MANDATORY)

Read the rewritten text as if speaking. If any sentence sounds like a robot → rewrite it. Do not skip this check.

## NEVER change
- Factual accuracy
- Core meaning and argument
- Technical terms that must stay precise
- Appropriate register (legal ≠ Slack)

## Deliver
The rewritten text only. No commentary about what you changed unless asked.
