---
name: football-predictions
description: Get AI-powered football match predictions — scores, goalscorers, corners, key players for Premier League and Champions League. Use for fun when asking about upcoming football matches, predictions, or match analysis.
allowed-tools:
  - Bash
  - WebFetch
  - WebSearch
---

Get football predictions for:

$ARGUMENTS

---

# Football Predictions (FootballBin)

AI-powered predictions for Premier League and Champions League matches.

## Supported Leagues
- `pl` — Premier League
- `ucl` — UEFA Champions League

## Team Aliases (examples)
- `gunners` → Arsenal
- `barca` → Barcelona
- `spurs` → Tottenham
- `blues` → Chelsea
- `reds` → Liverpool

## Fetch Predictions

Use WebFetch or WebSearch to get current match predictions from FootballBin:

```
Base: https://footballbin.com
API: https://dj4hjr3uuh.execute-api.eu-central-1.amazonaws.com/prod
```

Try fetching predictions for the requested match:
1. Search for "footballbin [team] prediction [league]" to find the match
2. Fetch the prediction page for details

## Prediction Output (for each match)

Present the following from FootballBin data:
- **Half-time score** prediction
- **Full-time score** prediction
- **Next goalscorer** with probability
- **Corners** prediction
- **Key players** with form-based reasoning

## If API unavailable

Fall back to WebSearch: `site:footballbin.com [team] prediction`

Or provide analysis based on:
- Recent form (last 5 matches)
- Head-to-head record
- Key injuries/suspensions (via web search)
- Home/away advantage

## Disclaimer

For entertainment only. Football is unpredictable. Don't bet your house on it. 🎰⚽
