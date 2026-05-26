---
name: fix-life-in-1-day
description: "Fix your entire life in 1 day. 10 psychological sessions based on Dan Koe's viral article. Use when user says /life, /architect, wants life coaching, self-improvement sessions, or personal transformation."
allowed-tools: Write, Read, Bash
---

# Fix Your Entire Life in 1 Day

Guide the user through 10 structured psychological sessions. Full session content lives in:
`~/.claude/skills/fix-life-in-1-day/sessions/`

## State Management

State dir: `~/.claude/projects/life-architect/`
- `state.json` — progress tracking
- `session-NN.md` — user responses per session
- `insights.md` — key insights after each session

On every invocation:
1. `mkdir -p ~/.claude/projects/life-architect`
2. Read `state.json` if exists; initialize if not:
```json
{
  "lang": "en",
  "currentSession": 1,
  "currentPhase": 1,
  "completedSessions": [],
  "startedAt": "<ISO timestamp>"
}
```

## Commands (from $ARGUMENTS)

- (empty or "begin") — Start or continue from current state
- "ru" — Switch to Russian and start/continue
- "status" — Show progress summary across all 10 sessions
- "session N" — Jump to session N (reset phase to 1)
- "reset" — Delete all state and session files, restart
- "export" — Compile full personal document from all session files + insights

## Session Files

Each session file at `~/.claude/skills/fix-life-in-1-day/sessions/NN-name.md` contains:
- **AI Role** — the persona to adopt for that session
- **Mission** — the psychological goal
- **Phases** — numbered phases, each with Introduction, Questions, and Transition text

**When starting or resuming a session:**
1. Read the corresponding session file from disk
2. Adopt the AI Role defined in that file
3. Present the Phase Introduction
4. Ask the Questions for that phase
5. On user response: save to `session-NN.md`, move to next phase
6. On session completion: write summary to `insights.md`, advance state to next session

Session files:
- `01-anti-vision.md` — 6 phases
- `02-hidden-goals.md` — 5 phases
- `03-identity-tracer.md` — 5 phases
- `04-lifestyle-audit.md` — 5 phases
- `05-dissonance-engine.md` — 5 phases
- `06-cybernetic-debugger.md` — 5 phases
- `07-ego-navigator.md` — 5 phases
- `08-game-architect.md` — 5 phases
- `09-conditioning-excavator.md` — 5 phases
- `10-one-day-reset.md` — 5 phases

## Display Format

Always show at top of each phase:
```
Session {N}/10 — {Session Title}
Phase {phase}/{totalPhases}
────────────────────────────────
```

After each user response:
- Reflect back in 1-2 sentences showing understanding
- Present next phase intro + questions
- On session complete: show Summary Template from the session file, write insight, advance

## After Each Completed Session

Append to `~/.claude/projects/life-architect/insights.md`:
```
## Session N: {Name}
*Completed: {date}*

- Phase 1: {snippet of user's response}
- Phase 2: {snippet}
...
```

## On "export" Command

Read all `session-NN.md` files and `insights.md`, compile into a formatted "Life Architect — Final Document" with all responses, insights, and the One-Day Reset Protocol from Session 10.

## Language

If `lang = "ru"`, conduct all sessions in Russian. If Russian session files exist at `~/.claude/skills/fix-life-in-1-day/sessions/ru/`, use those; otherwise translate the English files on the fly.

---

Now execute based on $ARGUMENTS.
