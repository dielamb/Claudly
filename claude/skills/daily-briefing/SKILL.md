---
name: daily-briefing
description: Generate a morning briefing with today's calendar events, priorities, and suggested focus. Activates when asked for a daily briefing, morning summary, what's on today, or day overview.
allowed-tools:
  - Bash
  - Read
  - Write
---

Generate a daily briefing for today.

$ARGUMENTS

---

# Daily Briefing

YOU MUST fetch live calendar data before generating the briefing. A briefing without real data is useless.

## Step 1 — Fetch Today's Events (MANDATORY, do this first)

```bash
osascript << 'EOF'
tell application "Calendar"
  set today to current date
  set startOfDay to today
  set hours of startOfDay to 0
  set minutes of startOfDay to 0
  set seconds of startOfDay to 0
  set endOfDay to startOfDay + (23 * hours + 59 * minutes + 59)

  set output to ""
  set relevantCals to {"Prywatny", "__USER_EMAIL__", "Uber", "__USER_EMAIL_2__", "__USER_EMAIL_3__", "Przypomnienia zaplanowane", "Urodziny"}

  repeat with calName in relevantCals
    try
      set cal to calendar calName
      set dayEvents to (events of cal whose start date >= startOfDay and start date <= endOfDay)
      repeat with e in dayEvents
        set eventStart to start date of e
        set h to hours of eventStart
        set m to minutes of eventStart
        set output to output & calName & " | " & h & ":" & text -2 thru -1 of ("0" & m) & " | " & summary of e & return
      end repeat
    end try
  end repeat

  if output is "" then return "Brak wydarzeń na dziś"
  return output
end tell
EOF
```

If this fails → report the error explicitly. NEVER fabricate calendar data.

## Step 2 — Build the Briefing (MANDATORY format)

```
## Dzisiaj — [dzień tygodnia], [data]

### Kalendarz
[Events sorted earliest first]
[HH:MM — Nazwa wydarzenia (Kalendarz)]
[If none: "Wolny dzień — brak wydarzeń"]

### Top 3 priorytety
[Ask if not provided, or infer from calendar context]
1.
2.
3.

### Sugerowany focus
[Based on calendar load:
 - Heavy meeting day → protect 1 deep-work block
 - Light day → identify biggest leverage task
 - Back-to-back meetings → flag energy management]
```

## Output Rules — all mandatory

- ONE screenful maximum — cut ruthlessly
- Lead with the earliest time-sensitive event
- Plain operational language — no narrative, no warmth padding
- NEVER fabricate events — show only what calendar returns
- If a calendar is inaccessible → note which one and why
