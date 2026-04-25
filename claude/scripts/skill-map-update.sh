#!/bin/bash
# Skill Map Auto-Update
# Reads ~/.claude/skills/*/SKILL.md → updates Obsidian routing table
# Cron: 0 21 * * 0 (Sunday 21:00, after ruflo-weekly-review)

export PATH="__HOME__/.nvm/versions/node/v24.15.0/bin:$PATH"

SKILLS_DIR="$HOME/.claude/skills"
VAULT="$HOME/Desktop/Labirynt"
TARGET="$VAULT/3 Atlas/Tools/Skill Map - Co Kiedy.md"
LOG="$HOME/logs/skill-map-update.log"
DATE=$(date +%Y-%m-%d)

mkdir -p "$HOME/logs"
echo "[$DATE] skill-map-update started" >> "$LOG"

# Build skill inventory from SKILL.md files
SKILL_TABLE=""
IMPECCABLE_SKILLS=("delight" "bolder" "impeccable" "layout" "typeset" "animate" "colorize" "brand" "polish" "critique" "shape")
OTHER_SKILLS=("design-first-dev" "frontend-design" "ui-audit" "ui-ux-pro-max" "design-system")

build_row() {
  local skill="$1"
  local skill_file="$SKILLS_DIR/$skill/SKILL.md"
  if [ ! -f "$skill_file" ]; then
    echo "[$DATE] MISSING: $skill" >> "$LOG"
    return
  fi
  local desc
  desc=$(grep -m1 "^description:" "$skill_file" | sed 's/description: *//' | sed 's/^"//' | sed 's/"$//' | cut -c1-90)
  local version
  version=$(grep -m1 "^version:" "$skill_file" | sed 's/version: *//' | tr -d '[:space:]')
  echo "| \`$skill\` | $desc | $version |"
}

# Collect all installed skills dynamically (catch new ones not in hardcoded lists)
ALL_INSTALLED=$(ls "$SKILLS_DIR" 2>/dev/null | sort)

IMPECCABLE_TABLE="| Skill | Description | Version |\n|-------|-------------|--------|\n"
OTHER_TABLE="| Skill | Description | Version |\n|-------|-------------|--------|\n"
NEW_TABLE="| Skill | Description | Version |\n|-------|-------------|--------|\n"
NEW_COUNT=0

KNOWN_SKILLS=("${IMPECCABLE_SKILLS[@]}" "${OTHER_SKILLS[@]}")

for skill in $ALL_INSTALLED; do
  row=$(build_row "$skill")
  [ -z "$row" ] && continue

  # Check if impeccable pack
  if printf '%s\n' "${IMPECCABLE_SKILLS[@]}" | grep -qx "$skill"; then
    IMPECCABLE_TABLE+="$row\n"
  # Check if known other
  elif printf '%s\n' "${OTHER_SKILLS[@]}" | grep -qx "$skill"; then
    OTHER_TABLE+="$row\n"
  else
    # New skill not in map yet
    NEW_TABLE+="$row\n"
    NEW_COUNT=$((NEW_COUNT + 1))
    echo "[$DATE] NEW SKILL DETECTED: $skill" >> "$LOG"
  fi
done

# Write updated inventory section to temp file
TEMP=$(mktemp)
cat "$TARGET" > "$TEMP"

# Replace the auto-generated section (between markers)
START_MARKER="<!-- SKILL-INVENTORY-START -->"
END_MARKER="<!-- SKILL-INVENTORY-END -->"

NEW_SECTION="$START_MARKER
> Auto-generated: $DATE. Edit routing logic above manually, not here.

### Impeccable Pack — installed

$(printf "$IMPECCABLE_TABLE")

### Other Design Skills — installed

$(printf "$OTHER_TABLE")"

if [ "$NEW_COUNT" -gt 0 ]; then
  NEW_SECTION+="

### New skills (detected, no routing) — require manual addition to the table above

$(printf "$NEW_TABLE")"
fi

NEW_SECTION+="
$END_MARKER"

# Replace section in file using Python (handles multiline cleanly)
python3 - "$TEMP" "$TARGET" "$START_MARKER" "$END_MARKER" "$NEW_SECTION" << 'PYEOF'
import sys

temp_path = sys.argv[1]
target_path = sys.argv[2]
start = sys.argv[3]
end = sys.argv[4]
new_section = sys.argv[5]

with open(temp_path, 'r') as f:
    content = f.read()

if start in content and end in content:
    before = content[:content.index(start)]
    after = content[content.index(end) + len(end):]
    updated = before + new_section + after
else:
    # Markers not found — append section at end
    updated = content.rstrip() + "\n\n---\n\n## Inventory (auto-generated)\n\n" + new_section + "\n"

with open(target_path, 'w') as f:
    f.write(updated)

print("OK")
PYEOF

if [ $? -eq 0 ]; then
  echo "[$DATE] Skill map updated. New skills detected: $NEW_COUNT" >> "$LOG"
  if [ "$NEW_COUNT" -gt 0 ]; then
    osascript -e "display notification \"$NEW_COUNT new skills require routing in Skill Map\" with title \"Skill Map Update\" sound name \"Funk\"" 2>/dev/null || true
  fi
else
  echo "[$DATE] ERROR: Python replace failed" >> "$LOG"
  rm -f "$TEMP"
  exit 1
fi

rm -f "$TEMP"
echo "[$DATE] skill-map-update done" >> "$LOG"
