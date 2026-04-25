# Labirynt — Second Brain AI Router

Ten vault to twój drugi mózg. Zawiera wiedzę prywatną i zawodową.
Jako AI agent, przestrzegaj tych zasad przy czytaniu i zapisywaniu.

## Struktura

| Folder | Co zawiera | Kiedy używać |
|--------|-----------|-------------|
| `0 Inbox/` | **Low-confidence buffer** — notatki gdzie AI nie jest pewny folderu (<70%) | Przy ambiguous content, review w weekly |
| `1 Calendar/` | Daily notes (YYYY-MM-DD.md) | Dzienniki, sesje, /tldr |
| `2 Efforts/` | Aktywne projekty i wysiłki | Projekty z jasnym celem |
| `3 Atlas/` | Baza wiedzy — atomowe notatki | Fakty, wzorce, rozwiązania |
| `4 People/` | Osoby + historia interakcji | 2+ wzmianki = twórz notatkę |
| `5 Sources/` | Książki, artykuły, kursy, filmy | Zewnętrzne źródła wiedzy |
| `6 Maps/` | MOC (Map of Content) | Gdy 5+ notatek o temacie |
| `Archive/` | Porzucone efforts, stare notatki | Nigdy nie kasuj — przenoś tu |
| `Templates/` | Szablony notatek | Używaj przy tworzeniu nowych notatek |

### Atlas — podfoldery

| Podfolder | Przykłady |
|-----------|-----------|
| `Design/` | Wzorce UI, zasady typografii, token architecture |
| `Code/` | CSS tricki, JS patterns, snippety |
| `Tools/` | MCPy, pluginy, narzędzia, konfiguracje |
| `Health/` | Waga, trening, zdrowie, suplementy |
| `Finance/` | Stawki, wydatki, inwestycje, podatki |
| `Career/` | CV, decyzje zawodowe, preferencje pisania |
| `Problems/` | Problem-solution notes (rozwiązane problemy) |
| `Synthesis/` | **Syntezy z rozmów** — compounding answers na nietrywialne pytania |
| `Reasoning/` | **Decision rationale** — dlaczego wybrano X zamiast Y (trade-offs, architektura) |
| `Ideas/` | Pomysły na projekty, produkty, eksperymenty |
| `Relationships/` | Notatki o relacjach, randkach, znajomościach |

## Zasady zapisu (dla AI agenta)

### Routing wiedzy — który folder 3 Atlas/?

Nie każda wiedza to "problem-solution". Jedna sesja może wygenerować 3+ notatki w różnych folderach.

| Folder | Gdy... | Frontmatter `type:` | Przykład |
|---|---|---|---|
| `Problems/` | Konkretny bug/issue **+ kontekst jak powstał** | `problem-solution` | "Safari flexbox wrap bug — min-width:0 po 2h debugowania" |
| `Code/` | **Reusable snippet/pattern** bez specyficznego buga | `pattern` | "CSS clamp() pattern for fluid typography" |
| `Design/` | **Zasada wizualna / token / guideline** | `design-principle` | "8px grid + 1.333 modular scale" |
| `Tools/` | **Narzędzie/MCP/plugin** — co, setup, use case | `tool-note` | "Chrome DevTools MCP — remote debug setup" |
| `Ideas/` | **Pomysł na przyszłość**, niezrobione | `idea` | "Skill generator z GitHub repos" |
| `Synthesis/` | **Synteza 3+ notatek** w odpowiedzi na nietrywialne pytanie | `synthesis` | "Comparison: graphify vs intelligence vs RuFlo" |
| `Reasoning/` | **Dlaczego X zamiast Y** — trade-offs, architektura, design rationale | `reasoning` | "Why shadow layer over patches for RuFlo extensions" |
| `Career/` | Decyzje zawodowe, CV, rationale | `decision` / `rationale` | (do Decisions.md) |
| `Health/` `Finance/` `Relationships/` | Fakty osobiste | `fact` | Waga, stawka, nota o osobie |
| `0 Inbox/` | **Confidence < 70%** — nie wiem gdzie | `unsorted` | Gdy notatka pasuje do kilku folderów niejednoznacznie |

### Zasada splittingu — jedna sesja → wiele folderów

Rozwiązanie jednego problemu często produkuje wiedzę w kilku folderach. **Nie pakuj wszystkiego do jednego pliku w Problems/**.

**Przykład 1:** "CSS clamp() breaks on ultrawide, fixed by capping at max-width"
- `Problems/CSS clamp ultrawide bug.md` — pełen kontekst buga i jak go znalazłeś
- `Code/CSS clamp fluid typography pattern.md` — czysty reusable snippet (bez buga, tylko "jak używać")
- Oba linkują się [[wikilinkami]] w obie strony

**Przykład 2:** "Zbudowałem design system z 8px grid"
- `Design/8px grid system.md` — zasada: czemu 8px, kiedy stosować
- `Problems/Grid inconsistency in Atlas DS.md` — konkretne challenges które pokonałeś
- `Code/CSS spacing scale tokens.md` — snippet tokenów

**Reguła:** jeśli jedna wiedza pasuje do kilku folderów z confidence >70% każdy → zrób split. Primary note w najbardziej specyficznym folderze, secondary notes linkują do niej.

### Synthesis — zamknij pętlę wiedzy (Karpathy LLM Wiki pattern)

Claude często odpowiada na pytania syntezując wiedzę z kilku notatek. **Te odpowiedzi znikają w terminalu** — następnym razem Claude wymyśli je od zera. To marnotrawstwo.

**Reguła: gdy user pyta pytanie które wymaga syntezy 3+ notatek** (porównanie, analiza, "jak X ma się do Y", "podsumuj mi Z") **i odpowiedź jest nietrywialna** (>200 słów, non-obvious insight) → **zapisz ją** do `3 Atlas/Synthesis/[topic].md`.

**Template:**
```markdown
---
type: synthesis
created: YYYY-MM-DD
question: "[actual question user asked]"
sources: [[Note A]], [[Note B]], [[Note C]]
tags: [domain tags]
quality: high/normal
---

## Pytanie
[Rephrased question]

## Synteza
[3–6 akapitów — destylacja, nie copy-paste z sources]

## Kluczowe insighty
- [non-obvious takeaway 1]
- [non-obvious takeaway 2]

## Źródła
- [[Note A]] — [co stamtąd wzięto]
- [[Note B]] — [...]
```

**Kiedy NIE zapisywać synthesis:**
- Trivial lookup ("gdzie jest X file") — pytania factual bez syntezy
- Single-source answer — to belongs to original note, nie nowa synteza
- Ad-hoc diagnostyka (debug, walkthrough)

**Jak odzyskać synthesis przy następnym pytaniu:**
Gdy user pyta coś podobnego → najpierw `glob 3 Atlas/Synthesis/*.md` + match. Jeśli istnieje → daj tę synthesis + "już mamy to w Synthesis/, pozwól że sprawdzę czy dalej aktualne". Aktualizuj jeśli sources się zmieniły.

### Kiedy zapisywać (triggery)

- User rozwiązał problem → **rozważ split Problems/ + Code/** (nie tylko Problems!)
- User wspomina nowy snippet/pattern bez kontekstu buga → **Code/** (nie Problems!)
- User ustala zasadę wizualną → **Design/** (nie Problems!)
- User wspomina narzędzie/MCP/plugin → **Tools/**
- User wspomina pomysł "byłoby fajnie gdyby..." → **Ideas/**
- User wspomina osobę 2. raz → **People/**
- User podejmuje decyzję ("zdecydowałem", "idziemy z") → `Career/Decisions.md`
- User podaje fakt o sobie → odpowiednia kategoria `Health/Finance/Career/`
- User mówi /tldr → append do daily note + per-topic notes we właściwych folderach
- **Ambiguous (confidence <70%)** → `0 Inbox/` z frontmatter `type: unsorted` + `proposed_folders: [X, Y]`

### Jak zapisywać
1. Zawsze dodaj 2-5 tagów (Ty wybierasz, nie user)
2. Linkuj powiązane notatki [[wikilinkami]] — ZAWSZE do primary note jeśli split
3. Nie duplikuj — sprawdź czy notatka już istnieje, jeśli tak → aktualizuj
4. Używaj templates z `Templates/`
5. Tytuły piszesz jak search query: "Problem - Safari flexbox wrap" nie "Bug"
6. Frontmatter: `type`, `created`, `tags` minimum. Dla Problems/ i rationale: + `quality`
7. Jeśli niepewny folderu — **do Inbox z proposed_folders**, nie zgaduj

### Jak szukać
- Pytanie o osobę → szukaj w `4 People/`
- Pytanie o narzędzie → szukaj w `3 Atlas/Tools/`
- Pytanie "czy kiedyś rozwiązywałem...?" → szukaj w `3 Atlas/Problems/`
- Pytanie o projekt → szukaj w `2 Efforts/` i `Archive/`
- Pytanie o fakt osobisty → szukaj w `3 Atlas/Health/`, `Finance/`, `Career/`
- Pytanie ogólne → przeszukaj cały vault

### Czego NIE robić
- NIE pytaj usera o tagi — sam je dobieraj
- NIE pytaj usera o folder — **ale gdy confidence <70%, użyj `0 Inbox/` zamiast zgadywać**
- NIE pakuj wszystkich learningów do Problems/ — rozważ split Code/Design/Ideas
- NIE twórz notatki o osobie przy 1. wzmiance — czekaj na 2.
- NIE zapisuj rzeczy efemerycznych (temp debug, jednorazowe pytania)
- NIE duplikuj info które jest w git history lub w kodzie
- NIE twórz pojedynczej notatki gdy wiedza naturalnie rozdziela się na kilka folderów

## Quality signals (frontmatter)

Każdy `problem-solution` i `rationale` MUSI mieć `quality` w frontmatter. To jest kluczowy sygnał dla RuFlo intelligence layer — decyduje czy pattern zostanie zachowany długoterminowo i jak mocno będzie ważony w scoringu.

### Jak oznaczać

- `quality: high` — **non-obvious solution po walce**. Przetrwa 30d cutoff, boost +0.25 w scoringu, ładowany na każdym session-start.
  - Sygnały: user frustrował się, 3+ próby, rollback, "wreszcie działa", breakthrough commit po loopie.
  - Przykład: `Safari flexbox bug rozwiązany przez min-width:0 po 2h debugowania`.

- `quality: normal` — **straightforward, znane rozwiązanie**. Domyślnie. Widoczne przez 30 dni, standard scoring.
  - Sygnały: problem rozwiązany bez walki, znana technika, "ok, działa".

- `quality: low` — **trivia, edge case, mało wartościowe**. **Wykluczone z ładowania** do intelligence layer.
  - Sygnały: jednorazowy fix, nigdy nie powtórzy się, kosmetyka.

### Zasada
Jeśli user pokonał frustrację → ZAWSZE `quality: high`. Lepsza false positive niż stracić cenny pattern.

## Wikilinks (krytyczne dla graphify)

Graphify (`/graphify`) buduje graf wiedzy z `[[wikilinks]]`. Im więcej sensownych linków, tym lepszy pattern matching w RuFlo. Obecny graf: 185 nodów, 238 edges.

### Zasady linkowania

- Każda notatka ma **minimum 2 wikilinks** w body
- Problem → linkuj do [[Tool]] / [[Technique]] która rozwiązuje, do [[Effort]] w ramach którego powstał
- Decision → linkuj do [[Rationale]] (jeśli istnieje) i [[Effort]] którego dotyczy
- Effort → linkuj do [[MOC]], [[People]] zaangażowanych, [[Tools]] używanych
- Person → linkuj do [[Organizations]], [[Efforts]], innych [[People]] powiązanych
- Rationale → linkuj do [[Decision]] i [[Effort]] których dotyczy

### Orphan notes
Jeśli nowa notatka nie ma do czego linkować → zastanów się czy w ogóle potrzebna. Orphan = niewidoczny w graphify = niedostępny dla intelligence layer.

## Graphify refresh

Graf wiedzy (`graphify-out/graph.json`) musi być aktualny — używany przez RuFlo do rankowania patterns w czasie rzeczywistym.

### Kiedy odświeżać

- **Po dodaniu 5+ nowych notatek** w `3 Atlas/` lub `2 Efforts/`
- **Tygodniowo** — w ramach `/weekly-review`
- **Po dużych refactorach** vault (merge notatek, przenoszenie między folderami)
- **Po masowym dodaniu [[wikilinks]]** do istniejących notatek

### Jak
```
/graphify
```
Koszt: ~$2-5 LLM za full refresh (100+ files). Incremental nie jest obecnie wspierany — zawsze full scan.

### Staleness check
Sprawdź mtime `~/Desktop/Labirynt/graphify-out/graph.json`. Jeśli >7 dni — odśwież.

## RuFlo Integration

Vault jest źródłem permanentnej wiedzy, ale RuFlo cache (`~/.claude-flow/data/`) to runtime index dla intelligence layer.

### Flow

1. **Session-start**: loader czyta z vault:
   - `2 Efforts/` (active projects, 90d)
   - `3 Atlas/Problems/` (last 30d + wszystkie `quality: high`)
   - `3 Atlas/Code/` — reusable patterns (wszystkie, bo niewiele)
   - `3 Atlas/Design/` — design principles (wszystkie)
   - `3 Atlas/Career/Decisions.md` (recent)
   - `graphify-out/graph.json` (~650 nodów, ~900 edges)
2. Intelligence builduje `graph-state.json` z realnych edges graphify + lokalne tag-based
3. PageRank + quality + type + recency → `ranked-context.json`
4. Podczas pracy: każdy user prompt triggeruje lookup w ranked-context → top-5 relevant patterns idzie do LLM

### Implikacje dla zapisu

- Po rozwiązaniu problemu: ZAPISZ do `3 Atlas/Problems/` z poprawnym `quality:`, a nie tylko do daily note
- Bez `quality:` frontmatter = pattern traktowany jako `normal` (średni priorytet)
- Bez wikilinków = niewidoczny w graphify = mniejsza szansa że zostanie załadowany do intelligence

### Architektura
- **Obsidian** = permanent source of truth (PARA: nigdy nie usuwamy, archiwizujemy w `Archive/`)
- **Graphify** = pre-computed knowledge graph (tygodniowy refresh)
- **RuFlo cache** = volatile runtime index (przebudowywany na każdym session-start)
- **Claude** = execution layer (dostaje top-K patterns per prompt)
