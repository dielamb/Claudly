---
type: home
tags:
  - home
---

# Labirynt

## Szybki dostęp
- [[MOC - Problem Solutions|Rozwiązane problemy]]
- [[MOC - Tools & MCPs|Narzędzia i MCPy]]
- [[MOC - People|Ludzie]]
- [[MOC - Design Systems|Design Systems]]
- [[Decisions|Decyzje]]
- [[Your Name - Profil|Ja]]

## Aktywne Efforts

```dataview
TABLE status as "Status", tags as "Tagi"
FROM "2 Efforts"
WHERE status = "active" OR !status
SORT file.mtime DESC
```

## Ostatnio zmieniane

```dataview
TABLE file.mtime as "Kiedy"
FROM "" AND -"Templates" AND -"Archive"
SORT file.mtime DESC
LIMIT 10
```
