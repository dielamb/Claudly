# Evidence-Based Rules: knowledge-checker
_Generated: 2026-05-19T11:03:05.529Z_

## Core Rules (apply always)
1. When KEYWORDS_MATCHED is empty and OUTPUT_LENGTH is 0, enrichment silently skips rather than logging a miss — absence of fallback retrieval path means any tokenization failure produces total context dropout with no diagnostic signal [evidence: 15 runs]
2. Polish natural-language prompts that name a project or tool via description rather than exact identifier produce 0-char retrieval — the lexicon contains no Polish-language entries and no stemming/transliteration bridge [evidence: 12 runs]
3. Keyword matching requires exact string match against a fixed tool-name lexicon — only literal tokens "portfolio", "gan-loop", "Labirynt", "trace-to-skill" trigger retrieval, no fuzzy or semantic matching [evidence: 10 runs]
4. Zero-char retrieval is the default failure mode (15 of 16 FAILs) — system has no fallback retrieval strategy; absence of exact lexicon hit produces silence rather than degraded-quality context [evidence: 16 runs]
5. Pass rate driven entirely by lexicon membership of prompt's dominant noun — PASS distributed non-consecutively (1, 4, 9, 18) with no clustering, gaps of 3, 4, and 8 fails between passes [evidence: 13 runs]
6. Successful context injections cluster in narrow size band (1650–2100 chars), suggesting single template-per-keyword retrieval model with no granularity [evidence: 9 runs]

## Guidance (apply in most cases)
- Pure coding-task prompts (authMiddleware, SQL, mobile responsiveness, useEffect, package.json) uniformly produce 0-char retrieval — no domain-to-keyword mapping exists for technology terms, no coverage for dominant class of developer queries [evidence: 6]
- Polish-language prompts with no English loanwords return empty context because keyword extractor tokenizes on ASCII-dominant vocabulary, missing inflected Polish verbs and nouns (e.g., "działa", "przechodzą", "responsywnosc") [evidence: 5]
- Technical task prompts that describe coding actions (write test, fix bug, update deps, add animation) are skipped as non-retrieval prompts — enrichment logic classifies imperative-mode prompts as "do not enrich" rather than using them to inject project context [evidence: 5]
- Inject domain Rules.md only when prompt contains an exact token matching a hardcoded case-pattern glob (e.g. *portfolio*, *gan*loop*); single-word bare mentions like "GAN" without "loop" bypass all domain detection [evidence: 4]
- Generic Polish coding verbs (napisz, zoptymalizuj, popraw, zaktualizuj, napraw, dodaj, usuń) paired with a technical noun are sufficient to inject coding-domain context even when no explicit domain keyword is present [evidence: 7]
- Context length predicts enrichment quality — domain Rules.md injection produces 1650–2100 chars (substantive); global-rules-only output is consistently 3584 bytes; output_length < 4000 with no domain match signals empty/irrelevant enrichment [evidence: 6]

## Edge Cases (apply when relevant)
- Prompt language detection is not triggering a Polish-aware stemmer or lemmatizer — Polish morphology changes word stems significantly ("commitowałem", "przechodzą", "zoptymalizuj") so root-form matching against stored English-keyed memory entries always scores zero [evidence: 3]
- Hyphenated tool names ("gan-loop", "trace-to-skill") succeed when written exactly, but the same tool referenced with spaces or partial tokens ("session loader", "prompt-enrichment") produces 0-char retrieval — tokenizer does not normalize hyphens to spaces [evidence: 3]
- False-positive injection occurs when a query contains a person's first name or conversational social signal — injector fires broader "people/social" context block (dreamer rules) regardless of task type, producing wrong context 3584 chars instead of 0 [evidence: 3]
- Jaccard similarity computed over raw Polish tokens must normalize diacritics and strip inflectional suffixes (e.g. "Avocado projektu" → "avocado projekt") before scoring, otherwise inflected project names score below threshold [evidence: 2]
- Keyword lists must index compound and hyphenated tool names as both the full form and each constituent token; match must require the compound or at least two co-occurring constituents, never a single sub-token alone [evidence: 2]
- Project names that exist only in Obsidian vault metadata and not in the static keyword list must be loaded into the matcher at hook startup from the vault index, otherwise any prompt containing that project name scores zero [evidence: 2]
- Jaccard similarity threshold too strict for Polish compound phrases and project names — single-word prompts like "Avocado" fail to match stored keys that contain full project context strings [evidence: 2]
- Person-name queries (first-name-only Polish names like "Inga") either return empty or trigger wrong domain context — enrichment has no person-entity extractor and falls back to unrelated high-salience stored context [evidence: 2]
- RuFlo intelligence retrieval fires on any prompt of 4+ words; succeeds when prompt content-matches high-PageRank nodes in ranked-context.json — domain block and RuFlo block are orthogonal, either alone can cause PASS [evidence: 2]
- Domain keyword patterns must include all surface-form variants of a concept (hyphenated, spaced, abbreviated) — pattern *gan*loop* requires both tokens; prompts using only acronym or expanded form miss entirely [evidence: 2]
- Infrastructure and operations prompts (AWS, deployment, backup, merge checks) produce no context injection — domain classifier lacks DevOps/cloud keyword vocabulary in Polish transliteration ("zaloguj się do AWS", "zrób backup") [evidence: 3]
- Calendar-intent signals in Polish (spotkanie, piątek, jutro, tydzień, termin, inwestorzy, deadline) must form their own intent class and route to calendar/people context rather than zero-context or generic domain match [evidence: 2]

---
_Discarded 7 rules with insufficient evidence (< threshold)._