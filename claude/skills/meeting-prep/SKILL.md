---
name: meeting-prep
description: Prepare a briefing for an upcoming meeting — attendees, context, talking points, open items. Activates when asked to prep for a meeting, "what's my next meeting", or needing context before a call.
allowed-tools:
  - Bash
  - WebSearch
  - WebFetch
  - Read
  - Write
---

Prepare a meeting briefing.

$ARGUMENTS

---

# Meeting Prep

YOU MUST fetch real calendar data first. Preparing for a meeting without knowing what the meeting is = wasted effort.

## Step 1 — Find the Meeting (MANDATORY)

If no specific meeting named, fetch the next upcoming event:

```bash
osascript << 'EOF'
tell application "Calendar"
  set now to current date
  set lookAhead to now + (2 * days)
  set relevantCals to {"Prywatny", "__USER_EMAIL__", "Uber", "__USER_EMAIL_2__", "__USER_EMAIL_3__"}
  set earliest to missing value
  set earliestDate to lookAhead

  repeat with calName in relevantCals
    try
      set cal to calendar calName
      set upcoming to (events of cal whose start date >= now and start date <= lookAhead)
      repeat with e in upcoming
        if start date of e < earliestDate then
          set earliestDate to start date of e
          set earliest to {ev:e, calName:calName}
        end if
      end repeat
    end try
  end repeat

  if earliest is missing value then return "Brak nadchodzących spotkań w ciągu 48h"

  set e to ev of earliest
  set output to "Tytuł: " & summary of e & return
  set output to output & "Kiedy: " & start date of e & return
  set output to output & "Koniec: " & end date of e & return
  try
    set output to output & "Lokalizacja: " & location of e & return
  end try
  try
    set output to output & "Opis: " & description of e & return
  end try
  set output to output & "Kalendarz: " & calName of earliest
  return output
end tell
EOF
```

If no meeting found → say so clearly. Do not invent a meeting.

## Step 2 — Research Attendees (MANDATORY if names found in description)

For each named attendee YOU MUST:
- Search for their current role and company
- Note any relevant recent news or context
- Flag if they are unknown — do not speculate

## Step 3 — Compile Briefing (MANDATORY structure)

```
## Briefing: [Meeting title]
[Date | Start time → End time | Location/Link]

### Uczestnicy
[Name — Role/Company — one line context]
[Unknown if not found — say so]

### Cel spotkania
[What needs to be decided, discussed, or delivered]
[If unclear from calendar data — flag it]

### Kontekst
[Relevant background]
[Prior interactions if known]
[Open commitments from last interaction]

### Punkty do omówienia
1. [Most important — lead with this]
2.
3. [Maximum 5 — prioritize ruthlessly]

### Otwarte kwestie
[Any unresolved items or questions to address]
```

## Non-negotiable rules

- Actionable context ONLY — no trivia
- Commitments and open items come first
- Unknown attendees MUST be flagged explicitly — NEVER guess their role
- If meeting description is empty → note it, ask user to provide context
