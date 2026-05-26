---
name: research
description: Conduct thorough web research by searching, fetching, and cross-referencing multiple sources. Activates when asked to research a topic, find current information, verify facts, or investigate something that requires up-to-date web sources.
allowed-tools:
  - WebSearch
  - WebFetch
  - Write
  - Read
---

Research the following topic thoroughly:

$ARGUMENTS

---

# Research Skill

YOU MUST follow this process in order. Skipping steps is not acceptable.

## Step 1 — Search (MANDATORY: minimum 2 queries)

Run at least 2 distinct search queries with different angles:
- Query 1: direct search
- Query 2: alternative framing or source-specific (e.g., `site:docs.anthropic.com`)
- Query 3 (if conflicting results): tiebreaker or recency-focused

NEVER rely on a single search query. Results vary — multiple angles are required.

## Step 2 — Fetch Full Content (MANDATORY for key claims)

For every important claim from search results, YOU MUST use WebFetch to read the actual source. Search snippets are NOT sufficient for facts you will assert as true.

Fetch at minimum the top 2 most relevant results.

## Step 3 — Cross-Reference (MANDATORY)

YOU MUST verify key claims across at least 2 independent sources.

If sources conflict:
- Present BOTH views explicitly — NEVER silently pick one
- Note which source is more authoritative and why

## Step 4 — Synthesize

Structure output as:
- Lead with the most useful finding
- Cite sources inline with URLs
- Flag uncertainty explicitly: "According to X..." vs stating as fact
- Note if information may be outdated

## Source Hierarchy — apply this ranking

1. Official documentation / primary sources → highest trust
2. Peer-reviewed / established publications
3. Reputable news outlets
4. Technical blogs from known experts
5. Forums / community answers → ALWAYS verify independently

## NEVER
- Fabricate sources or URLs
- Present a single-source claim as confirmed fact
- Skip fetching when the topic is important
