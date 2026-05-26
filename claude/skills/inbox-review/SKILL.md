---
name: inbox-review
description: Review low-confidence notes in ~/Desktop/Labirynt/0 Inbox/ and sort them into proper 3 Atlas/ subfolders. Use when notes pile up in Inbox (auto-classified as ambiguous by auto-tldr) or when user says "/inbox-review", "przejrzyj inbox", "posortuj inbox".
---

# Inbox Review — sortowanie low-confidence notatek

Notatki w `~/Desktop/Labirynt/0 Inbox/` to te, które auto-tldr nie potrafił jednoznacznie zaklasyfikować (confidence <70%). Ten skill przegląda je po kolei, proponuje folder docelowy i — po Twoim `OK` — przenosi.

## Kiedy używać

- Ręcznie po ciężkiej sesji gdy Inbox ma >3 pliki
- W ramach `/weekly-review` — part of Sunday cleanup
- Gdy ktoś wrzucił quick-capture note i ma siedzieć tam miesiącami

## Procedura

### Krok 1: Policz Inbox

```bash
ls -la ~/Desktop/Labirynt/0\ Inbox/ 2>/dev/null | grep -v "^d" | grep -v "^total" | grep -v "^\." | wc -l
```

Jeśli 0 plików — powiedz "Inbox pusty, nic do review" i zakończ.

### Krok 2: Dla każdego pliku

Dla każdego `.md` pliku w Inbox:

1. **Przeczytaj** content + frontmatter
2. **Sprawdź `proposed_folders:`** w frontmatter — to sugestie od auto-tldr
3. **Sklasyfikuj** według routing matrix z `~/Desktop/Labirynt/CLAUDE.md`:

   | Typ content | Target folder | type: |
   |---|---|---|
   | Reusable snippet/pattern | `3 Atlas/Code/` | `pattern` |
   | Design principle/token | `3 Atlas/Design/` | `design-principle` |
   | Bug + fix + kontekst | `3 Atlas/Problems/` | `problem-solution` |
   | Tool/MCP/plugin note | `3 Atlas/Tools/` | `tool-note` |
   | Future idea | `3 Atlas/Ideas/` | `idea` |
   | Person (2+ wzmianki) | `4 People/` | `person` |
   | Source material | `5 Sources/` | `source` |
   | Effort/project | `2 Efforts/` | `effort` |
   | Decision | append to `3 Atlas/Career/Decisions.md` | — |

4. **Zaproponuj użytkownikowi** (jednorazowo, w jednej wiadomości):

   ```
   ## Inbox review — N plików

   ### 1. [filename].md
   **Content summary:** [1 zdanie]
   **Proposed folder:** `3 Atlas/[X]/`
   **Nowy type:** [pattern/tool-note/etc]
   **Proposed title:** [Refactored title]

   ### 2. [next file]...
   ```

5. **Czekaj na `OK` lub modyfikacje** od usera.

### Krok 3: Po zatwierdzeniu — wykonaj migracje

Dla każdego zatwierdzonego pliku:

1. **Sprawdź czy target nie ma już takiego pliku** (dedup):
   ```bash
   ls ~/Desktop/Labirynt/[folder]/[new_name].md 2>/dev/null
   ```
   Jeśli istnieje: **NIE nadpisuj**. Zaproponuj append content do istniejącej notatki albo inny tytuł.

2. **Move + reformat:**
   - Przenieś plik do target folder
   - Zaktualizuj frontmatter (zmień `type: unsorted` na właściwy, usuń `proposed_folders`, `confidence`)
   - Jeśli content nie pasuje do template target folderu — przeformatuj sekcje

3. **Update wikilinks:**
   - Znajdź wszystkie pliki w vault które linkują do starej lokalizacji
   - Wikilink `[[Inbox filename]]` → `[[filename]]` (Obsidian resolves automatically po move)
   - Jeśli plik miał frontmatter `proposed_folders: [X, Y]` — dodaj do `## Powiązane` wikilink do alternatywnego folderu gdyby warto było zrobić split

### Krok 3.5: Append to vault-log.md

Po każdym batch migracji dodaj entry do `~/Desktop/Labirynt/vault-log.md`:

```markdown
### YYYY-MM-DD HH:MM inbox-review
[inbox-review] Sorted N files from 0 Inbox/
  - [old-name.md] → [new-folder]/[new-name.md]
  - [old-name.md] → [new-folder]/[new-name.md]
  - Skipped: [count] duplicates
```

### Krok 4: Podsumowanie

Na końcu:

```
## Inbox review complete

- Moved: N files
- Skipped (duplicates): M files
- Deleted (ephemeral): K files

New files:
- 3 Atlas/Code/X.md
- 3 Atlas/Tools/Y.md
...

Inbox: 0 files remaining (clean)
```

## Anti-patterns

- **NIE pytaj usera o każdy plik osobno** — jedna wiadomość z całym planem, user zatwierdza zbiorczo
- **NIE nadpisuj istniejących notatek** — zawsze check dedup
- **NIE zgaduj** jeśli plik jest ambiguous nawet po przeczytaniu — zostaw w Inbox z komentarzem "needs human review"
- **NIE usuwaj** plików z frontmatter `status: active` lub bez frontmatter — tylko ephemeral trash (`proposed_folders: []` + content <100 chars)

## Integracja z weekly-review

Ten skill może być wywołany automatycznie przez `/weekly-review` jeśli Inbox ma >5 plików. Dodaj do weekly-review SKILL.md krok: "Check Inbox count; if >5, invoke /inbox-review".

## Powiązane
- `~/Desktop/Labirynt/CLAUDE.md` — routing matrix (źródło prawdy)
- `~/.claude/helpers-user/auto-tldr-safe.sh` — producer of Inbox entries
- `~/.claude/skills/weekly-review/SKILL.md` — orchestrator integration
