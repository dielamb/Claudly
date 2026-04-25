#!/usr/bin/env bash
# gan-classifier.sh — UserPromptSubmit hook: intent classification (bash-only, <50ms)
# Replaces LLM subprocess with pure regex/awk signal matching.
# Classification: AMBIGUOUS | SUFFICIENT:PRODUCTION | SUFFICIENT:EXPLORATORY

# --- deps check ---
if ! command -v jq &>/dev/null; then
  printf '[gan-classifier] WARN: jq not found — using pure-bash JSON fallback (install via: brew install jq)\n' >&2
fi

LOG=/tmp/gan-classifier.log
log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*" >> "$LOG"; }

classify() {
  local raw="$1"
  local p
  p=$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')
  p="${p#"${p%%[![:space:]]*}"}"; p="${p%"${p##*[![:space:]]}"}"

  # 2a. Too short
  local wc
  wc=$(printf '%s' "$p" | wc -w | tr -d ' ')
  if [[ "$wc" -lt 4 ]]; then printf 'AMBIGUOUS'; return; fi

  # 2b. Production verb + bare pronoun
  if printf '%s' "$p" | grep -qE \
    '^(fix|do|make|build|implement|create|write|update|add|change|run|check|handle|resolve|get|use|put|set|send|move|delete|remove|apply|push|deploy|start|stop|refactor|rewrite|test|debug|clean|review|finish|complete|execute|try|grab|pull|load|open|close|save|edit|modify|show|display|render|generate|produce|take|give|find|fetch|call)[[:space:]]+(it|this|that|them|these|those)([[:space:]]+[a-z]+)?$'; then
    printf 'AMBIGUOUS'; return
  fi

  # 2c. Fix the bug/error/thing (no qualifying detail)
  if printf '%s' "$p" | grep -qE \
    '^(fix|resolve|handle|address|debug)[[:space:]]+(the[[:space:]])?(bug|error|issue|problem|thing|stuff|crash|failure|exception)[[:space:]]*$'; then
    printf 'AMBIGUOUS'; return
  fi

  # 2d. Bare continuation markers
  if printf '%s' "$p" | grep -qE \
    '^(also|and[[:space:]]+then|ok[[:space:]]+now|now[[:space:]]+do|next|then|continue|proceed|go[[:space:]]+on|go[[:space:]]+ahead)[[:space:]]'; then
    printf 'AMBIGUOUS'; return
  fi

  # 2e. Vague "what do you think about" reference
  if printf '%s' "$p" | grep -qE \
    "what[[:space:]]+do[[:space:]]+you[[:space:]]+think[[:space:]]+about[[:space:]]+(yesterday|it[[:space:]]|this[[:space:]]|that[[:space:]]|them[[:space:]]|it$|this$|that$|them$|our[[:space:]]+last|the[[:space:]]+last|last[[:space:]]+(session|meeting|call|talk|discussion|conversation)|[a-z]+'s[[:space:]]+(session|meeting|call|talk|discussion|conversation))"; then
    printf 'AMBIGUOUS'; return
  fi

  # 3a. Draft/iteration qualifiers (even with production verb)
  if printf '%s' "$p" | grep -qE \
    '(^|[[:space:]])(draft|szkic|propozycja|preview|mockup|quick[[:space:]]+version|rough[[:space:]]|outline|sketch|suggestion|proposal)([[:space:]]|$)'; then
    printf 'SUFFICIENT:EXPLORATORY'; return
  fi

  # 3b. Question words at start (EN + PL: jak=how, co=what, dlaczego=why, kiedy=when, gdzie=where, który=which, czy=whether, kto=who, ile=how many)
  if printf '%s' "$p" | grep -qE \
    '^(how|what|why|when|where|which|who|whose|whom|can|could|should|would|is|are|do|does|did|will|has|have|jak|co|dlaczego|kiedy|gdzie|ktory|który|czy|kto|ile)[[:space:]]'; then
    printf 'SUFFICIENT:EXPLORATORY'; return
  fi

  # 3c. Analytical verbs (EN + PL: podsumuj=summarize, wytlumacz=explain, sprawdz=check, przeanalizuj=analyze, opisz=describe, powiedz=tell, porownaj=compare, ocen/oceń=evaluate)
  if printf '%s' "$p" | grep -qE \
    '^(explain|describe|analyze|analyse|review|check|verify|compare|summarize|summarise|list|show|tell|discuss|consider|evaluate|assess|critique|suggest|recommend|think|guess|estimate|predict|podsumuj|wytlumacz|sprawdz|przeanalizuj|opisz|powiedz|porownaj|ocen|oceń)[[:space:]]'; then
    printf 'SUFFICIENT:EXPLORATORY'; return
  fi

  # 4a. English production imperatives
  if printf '%s' "$p" | grep -qE \
    '^(write|create|implement|build|generate|make|produce|design|add|fix|update|deploy|refactor|migrate|setup|set[[:space:]]+up|configure|install|scaffold|initialize|connect|integrate|extract|convert|replace|rename|move|delete|remove|export|import|publish|commit|push|release|ship|launch|finish|complete|rewrite)[[:space:]]'; then
    if ! printf '%s' "$p" | grep -qE \
      '^[a-z]+[[:space:]]+(it|this|that|them|these|those)[[:space:]]*$'; then
      printf 'SUFFICIENT:PRODUCTION'; return
    fi
  fi

  # 4b. Polish production imperatives (napisz=write, zrób=do, zbuduj=build, stwórz=create, wygeneruj=generate, zaimplementuj=implement, dodaj=add, napraw=fix, zaktualizuj=update, wdróż=deploy, skonfiguruj=configure, ustaw=set, uruchom=run, przygotuj=prepare, wykonaj=execute, opublikuj=publish, wypuść=release, wyślij=send, usuń=delete, przenieś=move)
  if printf '%s' "$p" | grep -qE \
    '^(napisz|zrob|zrób|zbuduj|stworz|stwórz|wygeneruj|zaimplementuj|dodaj|napraw|zaktualizuj|wdroz|wdróż|skonfiguruj|ustaw|uruchom|przygotuj|wykonaj|opublikuj|wypusc|wypuść|wyslij|wyślij|usun|usuń|przenies|przenieś)[[:space:]]'; then
    printf 'SUFFICIENT:PRODUCTION'; return
  fi

  # 5. Default: SUFFICIENT:EXPLORATORY
  printf 'SUFFICIENT:EXPLORATORY'
}

detect_profile() {
  local p
  p=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  if printf '%s' "$p" | grep -qE \
    '\.(js|ts|py|css|sh|html|json|go|rs|rb|java|md)([^a-z]|$)|function |class |api |component|endpoint|script|skrypt|hook|module|service|interface|import |export |const |let |var |def |async |await '; then
    printf 'code'
  else
    printf 'default'
  fi
}

derive_slug() {
  local stopwords="a an the it is for to of in on at and or how what with per do does did be was were are will would could should may might must shall go ok now also next"
  local w sw skip count=0 result="" cleaned
  cleaned=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' ' ')
  for w in $cleaned; do
    skip=0
    for sw in $stopwords; do [ "$w" = "$sw" ] && skip=1 && break; done
    if [ "$skip" -eq 0 ] && [ -n "$w" ]; then
      [ -n "$result" ] && result="${result}-${w}" || result="$w"
      count=$((count + 1))
      [ "$count" -ge 6 ] && break
    fi
  done
  printf '%s' "$result"
}

emit() {
  local mode="$1" action="${2:-}" profile="${3:-}" brief_path="${4:-}"
  if [[ "$mode" == "production" ]]; then
    if command -v jq &>/dev/null; then
      jq -n --arg action "$action" --arg profile "$profile" --arg briefPath "$brief_path" \
        '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:("GAN_LOOP_REQUIRED profile=\($profile) brief=\($briefPath)")}}'
    else
      local ep eb
      ep=$(printf '%s' "$profile"    | sed 's/\\/\\\\/g; s/"/\\"/g')
      eb=$(printf '%s' "$brief_path" | sed 's/\\/\\\\/g; s/"/\\"/g')
      printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"GAN_LOOP_REQUIRED profile=%s brief=%s"}}\n' "$ep" "$eb"
    fi
  else
    local ctx="$action"
    if command -v jq &>/dev/null; then
      jq -n --arg ctx "$ctx" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$ctx}}'
    else
      local escaped
      escaped=$(printf '%s' "$ctx" | sed 's/\\/\\\\/g; s/"/\\"/g')
      printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$escaped"
    fi
  fi
}

# --- TEST MODE ---
if [[ "${1:-}" == "--test" ]]; then
  PASS=0; FAIL=0
  run_case() {
    local result
    result=$(classify "$1")
    if [[ "$result" == "$2" ]]; then
      printf 'PASS  [%-55s] -> %s\n' "$1" "$result"; PASS=$((PASS+1))
    else
      printf 'FAIL  [%-55s] expected=%s got=%s\n' "$1" "$2" "$result"; FAIL=$((FAIL+1))
    fi
  }
  run_case "Do it"                                                         "AMBIGUOUS"
  run_case "Fix the bug"                                                   "AMBIGUOUS"
  run_case "Make it better"                                                "AMBIGUOUS"
  run_case "What do you think about yesterday's session?"                  "AMBIGUOUS"
  run_case "implement the full payment flow component"                     "SUFFICIENT:PRODUCTION"
  run_case "Create the final pricing page copy"                            "SUFFICIENT:PRODUCTION"
  run_case "Fix the null pointer exception in auth.js line 47"             "SUFFICIENT:PRODUCTION"
  run_case "Write a draft of the pricing copy"                             "SUFFICIENT:EXPLORATORY"
  run_case "What do you think about using Redis for sessions?"             "SUFFICIENT:EXPLORATORY"
  run_case "Explain how pin-scroll.js handles sticky sections"             "SUFFICIENT:EXPLORATORY"
  run_case "napisz kompletny skrypt drift detector dla www_v2"             "SUFFICIENT:PRODUCTION"
  run_case "co myślisz o tym designie?"                                    "SUFFICIENT:EXPLORATORY"  # Polish: "what do you think about this design?"
  echo ""; echo "Results: ${PASS} passed, ${FAIL} failed"
  [[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
fi

# --- HOOK MODE ---
INPUT=$(cat)
if command -v jq &>/dev/null; then
  PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // ""' 2>/dev/null)
else
  PROMPT=$(printf '%s' "$INPUT" | awk -F'"' '/"prompt"/{print $4; exit}')
fi
[ -z "$PROMPT" ] && exit 0

RESULT=$(classify "$PROMPT")
log "$RESULT \"$(printf '%s' "$PROMPT" | head -c 60)\""

case "$RESULT" in
  AMBIGUOUS)
    emit "ambiguous" "CONTEXT_CHECK: Before responding, identify what is missing or ambiguous and ask the minimum necessary clarifying questions. Do not execute until you have >= 95% confidence you understand what is needed."
    ;;
  SUFFICIENT:PRODUCTION)
    PROFILE=$(detect_profile "$PROMPT")
    SLUG=$(derive_slug "$PROMPT")
    [ -z "$SLUG" ] && SLUG="task-$(date +%s)"
    BRIEF_PATH="$HOME/tools/gan-loop/briefs/${SLUG}.md"
    [ -f "$BRIEF_PATH" ] || printf -- '---\ntask: %s\nprofile: %s\n---\n' "$SLUG" "$PROFILE" > "$BRIEF_PATH"
    emit "production" "GAN_LOOP_REQUIRED" "$PROFILE" "$BRIEF_PATH"
    ;;
  SUFFICIENT:EXPLORATORY)
    exit 0
    ;;
esac
exit 0
