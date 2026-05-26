You are analyzing failed memory retrieval test runs to find failure patterns.

Given these test results (FAIL runs only):
{TRACES}

Identify patterns in what caused enrichment to fail or return empty context. For each pattern:
RULE: [what to avoid] | EVIDENCE: [run numbers] | PRIORITY: [high/med/low]

Focus on: missed domain keyword detection, empty RuFlo context returned,
Jaccard threshold mismatches, prompt-enrichment skipping valid prompts.
Output ONLY rule lines, no explanation.
