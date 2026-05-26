---
name: mtg
description: Search for Magic: The Gathering cards using Scryfall API. Use when looking up cards, finding card details, building EDH decks, or searching the MTG card database.
allowed-tools: Bash
---

Use Scryfall API (https://api.scryfall.com) with header `User-Agent: OpenClawMTGSkill/1.0` and `Accept: application/json`. Add 100ms delay between requests.

Execute the following MTG task:

$ARGUMENTS

Display results clearly in Polish: nazwa karty, koszt many, typ, tekst oracle, P/T (jeśli dotyczy), rzadkość, cena USD.

Search syntax examples:
- `e:ecl r:mythic` — mythic z Lorwyn Eclipsed
- `t:legend is:commander` — legendarni commanderzy
- `f:commander usd<5` — legalne w Commander poniżej $5
- `o:"draw a card" c:blue` — niebieskie karty dobierające
