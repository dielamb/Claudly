#!/bin/bash
# RuFlo Weekly Review
# Run every Sunday at 20:00: 0 20 * * 0 ~/scripts/ruflo-weekly-review.sh
#
# 1. Reads daily notes from current week
# 2. Analyzes git commits in active projects → identifies breakthroughs
# 3. Updates quality + breakthrough_commit in Problem files
# 4. Writes weekly summary

export PATH="__HOME__/.nvm/versions/node/v24.15.0/bin:$PATH"

DATE=$(date +%Y-%m-%d)
WEEK=$(date +%Y-W%V)
LOG_DIR="$HOME/logs"
VAULT="$HOME/Desktop/Labirynt"
EFFORTS="$VAULT/2 Efforts"
PROBLEMS="$VAULT/3 Atlas/Problems"

mkdir -p "$LOG_DIR"

echo "[$DATE] Weekly review started" >> "$LOG_DIR/ruflo-weekly.log"

# Step 0: Update graphify graph before review
echo "[$DATE] Running graphify --update" >> "$LOG_DIR/ruflo-weekly.log"
cd "$VAULT" && npx @anthropic-ai/claude-code \
  -p "Run /graphify . --update. This is automated, no questions. If no baseline exists, run full rebuild." \
  --dangerously-skip-permissions \
  >> "$LOG_DIR/ruflo-weekly.log" 2>&1
echo "[$DATE] Graphify update done" >> "$LOG_DIR/ruflo-weekly.log"
cd "$HOME"

# Find active git repos from Efforts
REPOS=""
for f in "$EFFORTS"/*.md; do
  [ -f "$f" ] || continue
  repo=$(grep -m1 'repo:' "$f" 2>/dev/null | sed 's/repo: *//' | tr -d ' "')
  if [ -n "$repo" ] && [ -d "$repo/.git" ]; then
    REPOS="$REPOS $repo"
  fi
done

# Also check common project locations
for dir in "$HOME/Sites" "$HOME/Projects" "$HOME/dev"; do
  [ -d "$dir" ] || continue
  for repo in "$dir"/*/; do
    [ -d "$repo/.git" ] && REPOS="$REPOS $repo"
  done
done

# Build git summary for last 7 days
GIT_SUMMARY=""
for repo in $REPOS; do
  [ -d "$repo/.git" ] || continue
  log=$(git -C "$repo" log --oneline --since="7 days ago" 2>/dev/null)
  [ -n "$log" ] && GIT_SUMMARY="$GIT_SUMMARY\nRepo: $repo\n$log\n"
done

echo "[$DATE] Git summary collected" >> "$LOG_DIR/ruflo-weekly.log"

claude --dangerously-skip-permissions -p "
You are running a weekly knowledge review. Do these steps IN ORDER:

## Step 0: Read knowledge graph
- Read ~/Desktop/Labirynt/graphify-out/GRAPH_REPORT.md
- Note the "Knowledge Gaps" section — isolated nodes with ≤1 connection
- Note any new God Nodes or community changes vs last week (if weekly note from last week exists)

## Step 1: Read context
- Read daily notes from last 7 days in ~/Desktop/Labirynt/1 Calendar/ (files named YYYY-MM-DD.md from $(date -v-7d +%Y-%m-%d) to $DATE)
- Read Problem files modified in last 7 days in ~/Desktop/Labirynt/3 Atlas/Problems/

## Step 2: Analyze git commits
Git activity from last 7 days:
$GIT_SUMMARY

For each Problem file from last 7 days:
- Read the file
- Look at git commits that touch files mentioned in the Problem note
- Identify the breakthrough commit: the one that SOLVED the problem (usually after multiple failed attempts on same files)
- Determine quality:
  - 'high' = clear breakthrough, novel solution, non-obvious pattern worth remembering
  - 'normal' = standard fix, straightforward solution
  - 'low' = trivial fix, typo, config change

## Step 3: Update Problem files
For each Problem file analyzed, if it has frontmatter fields 'quality' and 'breakthrough_commit':
- Update quality field based on your analysis
- Update breakthrough_commit with the git hash of the breakthrough commit (or leave empty if unclear)
- Use Edit tool to update ONLY the frontmatter lines, nothing else

## Step 4: Write weekly summary
Write to ~/Desktop/Labirynt/1 Calendar/$WEEK.md:

---
type: weekly-review
week: $WEEK
---

# Weekly Review $WEEK

## Co sie dzialo
- [main activities]

## Wzorce
- [recurring themes or problems]

## Learned this week
- [Problem files created/updated, what was high-quality]

## Graf tygodnia
- Isolated nodes (brakujące wikilinki): [top 3-5 z Knowledge Gaps]
- Sugerowane połączenia: [1-2 konkretne linki do dodania w Obsidian]

## Na nastepny tydzien
- [what to focus on based on patterns]

Keep under 350 words. Be specific.
" --allowedTools "Read,Write,Edit,Glob,Bash" >> "$LOG_DIR/ruflo-weekly.log" 2>&1

echo "[$DATE] Weekly review completed" >> "$LOG_DIR/ruflo-weekly.log"
