#!/usr/bin/env node
'use strict';
/**
 * Rule Deduplicator — monthly maintenance script.
 *
 * Reads learned behavioral rules from:
 *   ~/.claude/learning/global.md
 *   ~/.claude/learning/agents/*.md
 *
 * Sends them in batches of ≤20 to claude-sonnet-4-6 which finds:
 *   - Exact duplicates
 *   - Near-duplicates (same behavior, different wording)
 *   - Contradictions
 *
 * Writes a human-readable proposal to:
 *   ~/.claude/learning/dedup-proposals.md
 *
 * Does NOT modify source files unless --apply flag is passed.
 * --apply reads the approved proposals and applies them.
 * --dry-run prints what would change without writing.
 *
 * Usage:
 *   node rule-deduplicator.js           # analyze → write proposals
 *   node rule-deduplicator.js --apply   # apply approved proposals
 *   node rule-deduplicator.js --dry-run # print what would change
 */

const fs          = require('fs');
const path        = require('path');
const { spawnSync } = require('child_process');

// ─── Config ──────────────────────────────────────────────────────────────────

const HOME          = process.env.HOME || '__HOME__';
const LEARNING_DIR  = path.join(HOME, '.claude', 'learning');
const AGENTS_DIR    = path.join(LEARNING_DIR, 'agents');
const GLOBAL_MD     = path.join(LEARNING_DIR, 'global.md');
const PROPOSALS_MD  = path.join(LEARNING_DIR, 'dedup-proposals.md');
const CLAUDE_BIN    = path.join(HOME, '.nvm', 'versions', 'node', 'v24.15.0', 'bin', 'claude');
const MODEL         = 'claude-sonnet-4-6';
const BATCH_SIZE    = 20;

const LOG  = (...a) => console.error('[rule-deduplicator]', ...a);
const INFO = (...a) => console.log(...a);

// ─── CLI flags ────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const APPLY   = args.includes('--apply');
const DRY_RUN = args.includes('--dry-run');

// ─── Rule parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a markdown file and extract individual rule strings.
 * Rules are any non-blank, non-header, non-comment line (<!-- ... -->).
 * Returns array of { text: string, file: string, source: string }.
 */
function parseRules(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return [];
  }

  const sourceLabel = filePath.replace(HOME, '~');
  const rules = [];

  // Split into blocks separated by <!-- dream ... --> comments.
  // Each rule block is the text immediately before a comment tag.
  // We also handle files with no comment tags (just plain lines).
  const lines = content.split('\n');
  let currentLines = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip blank lines and headers
    if (!trimmed || trimmed.startsWith('#')) {
      // Flush current accumulation if we hit a blank line after content
      if (currentLines.length > 0 && !trimmed) {
        const ruleText = currentLines.join(' ').trim();
        if (ruleText) {
          rules.push({ text: ruleText, file: filePath, source: sourceLabel });
        }
        currentLines = [];
      }
      continue;
    }

    // Comment tags mark rule boundaries — flush before them
    if (trimmed.startsWith('<!--')) {
      if (currentLines.length > 0) {
        const ruleText = currentLines.join(' ').trim();
        if (ruleText) {
          rules.push({ text: ruleText, file: filePath, source: sourceLabel });
        }
        currentLines = [];
      }
      continue;
    }

    currentLines.push(trimmed);
  }

  // Flush any trailing content
  if (currentLines.length > 0) {
    const ruleText = currentLines.join(' ').trim();
    if (ruleText) {
      rules.push({ text: ruleText, file: filePath, source: sourceLabel });
    }
  }

  return rules;
}

/**
 * Collect all rules from global.md and agents/*.md.
 * Returns array of rule objects with file provenance.
 */
function collectAllRules() {
  const rules = [];

  // Global rules
  if (fs.existsSync(GLOBAL_MD)) {
    rules.push(...parseRules(GLOBAL_MD));
  } else {
    LOG(`global.md not found at ${GLOBAL_MD}`);
  }

  // Agent-specific rules
  if (fs.existsSync(AGENTS_DIR)) {
    const agentFiles = fs.readdirSync(AGENTS_DIR)
      .filter(f => f.endsWith('.md'))
      .sort()
      .map(f => path.join(AGENTS_DIR, f));

    for (const agentFile of agentFiles) {
      rules.push(...parseRules(agentFile));
    }
  }

  return rules;
}

// ─── Sonnet call ──────────────────────────────────────────────────────────────

/**
 * Build the deduplication prompt for a batch of rules.
 */
function buildPrompt(rules) {
  const numbered = rules
    .map((r, i) => `${i + 1}. [${r.source}] ${r.text}`)
    .join('\n');

  return `You have ${rules.length} learned behavioral rules from an AI assistant system. Find duplicates and near-duplicates.

Rules:
${numbered}

For each cluster of similar rules:
- Keep the most specific, actionable one
- Propose merging if BOTH add unique information not present in the other
- Propose deleting pure duplicates or vaguer restatements
- Flag contradictions with reason

Only flag rules that are genuinely redundant. If in doubt, keep both.

Output ONLY valid JSON — no markdown fences, no explanation:
{
  "merge": [
    {
      "keep": "exact text of rule to keep (copy verbatim from input)",
      "remove": ["exact text of rule(s) to remove (copy verbatim from input)"],
      "merged": "optional: improved combined rule text if merging adds value, else omit",
      "reason": "one sentence explaining why"
    }
  ],
  "delete": [
    {
      "rule": "exact text of duplicate to delete (copy verbatim from input)",
      "duplicate_of": "exact text of the rule it duplicates (copy verbatim from input)",
      "reason": "one sentence explaining why"
    }
  ],
  "contradiction": [
    {
      "rule_a": "exact text",
      "rule_b": "exact text",
      "reason": "what they contradict"
    }
  ]
}
If no issues found, output: {"merge":[],"delete":[],"contradiction":[]}`;
}

/**
 * Call claude-sonnet-4-6 with the prompt, return parsed JSON result.
 */
function callSonnet(prompt) {
  LOG(`Calling ${MODEL}...`);
  const result = spawnSync(
    CLAUDE_BIN,
    ['-p', prompt, '--model', MODEL, '--output-format', 'text'],
    { encoding: 'utf8', timeout: 120000 }
  );

  if (result.status !== 0 || !result.stdout?.trim()) {
    LOG('Claude call failed:', result.stderr?.slice(0, 300));
    return null;
  }

  const raw = result.stdout.trim();

  // Extract JSON — handle both bare JSON and accidental markdown fences
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    LOG('No JSON found in response:', raw.slice(0, 200));
    return null;
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    LOG('JSON parse error:', e.message);
    LOG('Raw response:', raw.slice(0, 400));
    return null;
  }
}

// ─── Batch processing ─────────────────────────────────────────────────────────

/**
 * Split rules into batches of BATCH_SIZE and run Sonnet on each.
 * Merges results across batches.
 */
async function analyzeRules(rules) {
  const allMerge         = [];
  const allDelete        = [];
  const allContradiction = [];

  const batches = [];
  for (let i = 0; i < rules.length; i += BATCH_SIZE) {
    batches.push(rules.slice(i, i + BATCH_SIZE));
  }

  LOG(`${rules.length} rules across ${batches.length} batch(es)`);

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    INFO(`  Batch ${b + 1}/${batches.length}: ${batch.length} rules`);

    const prompt = buildPrompt(batch);
    const result = callSonnet(prompt);

    if (!result) {
      LOG(`Batch ${b + 1} failed — skipping`);
      continue;
    }

    allMerge.push(...(result.merge || []));
    allDelete.push(...(result.delete || []));
    allContradiction.push(...(result.contradiction || []));
  }

  return { merge: allMerge, delete: allDelete, contradiction: allContradiction };
}

// ─── Proposal writer ──────────────────────────────────────────────────────────

/**
 * Write a human-readable proposals file.
 */
function writeProposals(analysis, rules) {
  const today = new Date().toISOString().split('T')[0];
  const lines = [];

  lines.push(`# Deduplication Proposals — ${today}`);
  lines.push('');
  lines.push(`Analyzed ${rules.length} rules from ${countSources(rules)} file(s).`);
  lines.push(`Found: ${analysis.merge.length} merge(s), ${analysis.delete.length} delete(s), ${analysis.contradiction.length} contradiction(s).`);
  lines.push('');
  lines.push('> Apply with: `node ~/.claude/helpers/rule-deduplicator.js --apply`');
  lines.push('> The --apply flag reads THIS file and makes changes. Edit proposals here before applying.');
  lines.push('');

  if (analysis.merge.length === 0 && analysis.delete.length === 0 && analysis.contradiction.length === 0) {
    lines.push('No duplicates or contradictions found. Rules look clean.');
    const content = lines.join('\n') + '\n';
    fs.writeFileSync(PROPOSALS_MD, content, 'utf8');
    INFO(`Written to ${PROPOSALS_MD}`);
    return;
  }

  // Merges
  if (analysis.merge.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`## Merge (${analysis.merge.length})`);
    lines.push('');
    for (const m of analysis.merge) {
      lines.push(`### Merge: keep one, remove redundant`);
      lines.push(`**Keep:** "${m.keep}"`);
      for (const r of (m.remove || [])) {
        lines.push(`**Remove:** "${r}"`);
      }
      if (m.merged) {
        lines.push(`**Merged text:** "${m.merged}"`);
      }
      lines.push(`**Reason:** ${m.reason}`);
      lines.push('');
    }
  }

  // Deletes
  if (analysis.delete.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`## Delete (${analysis.delete.length})`);
    lines.push('');
    for (const d of analysis.delete) {
      lines.push(`### Delete: exact duplicate`);
      lines.push(`**Rule:** "${d.rule}"`);
      lines.push(`**Duplicate of:** "${d.duplicate_of}"`);
      lines.push(`**Reason:** ${d.reason}`);
      lines.push('');
    }
  }

  // Contradictions
  if (analysis.contradiction.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`## Contradictions (${analysis.contradiction.length}) — manual resolution required`);
    lines.push('');
    for (const c of analysis.contradiction) {
      lines.push(`### Contradiction`);
      lines.push(`**Rule A:** "${c.rule_a}"`);
      lines.push(`**Rule B:** "${c.rule_b}"`);
      lines.push(`**Conflict:** ${c.reason}`);
      lines.push('');
    }
  }

  const content = lines.join('\n') + '\n';
  fs.writeFileSync(PROPOSALS_MD, content, 'utf8');
  INFO(`Proposals written to ${PROPOSALS_MD}`);
}

function countSources(rules) {
  return new Set(rules.map(r => r.file)).size;
}

// ─── Apply proposals ──────────────────────────────────────────────────────────

/**
 * Parse the proposals markdown file to extract what to keep, remove, etc.
 * Returns { toRemove: Set<string>, toReplace: Map<string, string> }
 * where toReplace maps old_text → new_merged_text.
 */
function parseProposals() {
  if (!fs.existsSync(PROPOSALS_MD)) {
    LOG('No proposals file found. Run without --apply first.');
    process.exit(1);
  }

  const content = fs.readFileSync(PROPOSALS_MD, 'utf8');
  const toRemove  = new Set();
  const toReplace = new Map(); // keep_text → merged_text (if merged text provided)

  const lines = content.split('\n');
  let mode = null;
  let currentKeep   = null;
  let currentRemove = [];
  let currentMerged = null;

  const extractQuoted = (line, prefix) => {
    const idx = line.indexOf(prefix);
    if (idx === -1) return null;
    const after = line.slice(idx + prefix.length).trim();
    // Strip leading/trailing quotes
    return after.replace(/^[""]/, '').replace(/[""]$/, '');
  };

  for (const line of lines) {
    if (line.startsWith('### Merge:')) {
      // Flush previous merge block
      flushMerge(currentKeep, currentRemove, currentMerged, toRemove, toReplace);
      currentKeep   = null;
      currentRemove = [];
      currentMerged = null;
      mode = 'merge';
      continue;
    }
    if (line.startsWith('### Delete:')) {
      flushMerge(currentKeep, currentRemove, currentMerged, toRemove, toReplace);
      currentKeep   = null;
      currentRemove = [];
      currentMerged = null;
      mode = 'delete';
      continue;
    }
    if (line.startsWith('### Contradiction')) {
      flushMerge(currentKeep, currentRemove, currentMerged, toRemove, toReplace);
      currentKeep   = null;
      currentRemove = [];
      currentMerged = null;
      mode = null; // contradictions need manual handling — skip
      continue;
    }
    if (line.startsWith('## ')) {
      mode = null;
      continue;
    }

    if (mode === 'merge') {
      if (line.startsWith('**Keep:**')) {
        currentKeep = extractQuoted(line, '**Keep:**');
      } else if (line.startsWith('**Remove:**')) {
        const r = extractQuoted(line, '**Remove:**');
        if (r) currentRemove.push(r);
      } else if (line.startsWith('**Merged text:**')) {
        currentMerged = extractQuoted(line, '**Merged text:**');
      }
    } else if (mode === 'delete') {
      if (line.startsWith('**Rule:**')) {
        const r = extractQuoted(line, '**Rule:**');
        if (r) toRemove.add(r);
      }
    }
  }

  // Flush last block
  flushMerge(currentKeep, currentRemove, currentMerged, toRemove, toReplace);

  return { toRemove, toReplace };
}

function flushMerge(keep, removeList, merged, toRemove, toReplace) {
  if (!keep && removeList.length === 0) return;
  for (const r of removeList) {
    toRemove.add(r);
  }
  // If a merged text is provided, the keep text should be replaced by merged text
  if (keep && merged && merged !== keep) {
    toReplace.set(keep, merged);
  }
}

/**
 * Rewrite a single rules file removing/replacing matched rules.
 * Backs up the file first.
 * Returns number of changes made.
 */
function applyToFile(filePath, toRemove, toReplace) {
  if (!fs.existsSync(filePath)) return 0;

  const original = fs.readFileSync(filePath, 'utf8');
  const lines    = original.split('\n');
  const outLines = [];
  let changes    = 0;

  // We process the file line by line, tracking multi-line rules.
  // A rule starts at a non-blank non-header non-comment line
  // and ends at the next <!-- comment --> tag or blank line.
  let ruleBuffer    = [];
  let commentBuffer = []; // the <!-- dream --> line that follows a rule

  const flushRule = () => {
    if (ruleBuffer.length === 0) return;
    const ruleText = ruleBuffer.join(' ').trim();

    if (toRemove.has(ruleText)) {
      // Drop this rule and its trailing comment
      changes++;
      ruleBuffer    = [];
      commentBuffer = [];
      return;
    }

    if (toReplace.has(ruleText)) {
      // Replace with merged text, keep comment tag
      outLines.push(toReplace.get(ruleText));
      outLines.push(...commentBuffer);
      changes++;
      ruleBuffer    = [];
      commentBuffer = [];
      return;
    }

    // Keep as-is
    outLines.push(...ruleBuffer);
    outLines.push(...commentBuffer);
    ruleBuffer    = [];
    commentBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line    = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      // Blank line — flush rule first
      flushRule();
      outLines.push(line);
      continue;
    }

    if (trimmed.startsWith('#')) {
      flushRule();
      outLines.push(line);
      continue;
    }

    if (trimmed.startsWith('<!--')) {
      // This is the comment tag that follows a rule
      commentBuffer.push(line);
      flushRule();
      continue;
    }

    // Regular content line — accumulate as rule text
    ruleBuffer.push(line);
  }

  // Final flush
  flushRule();

  if (changes === 0) return 0;

  // Backup original
  const today   = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const bakPath = `${filePath}.bak-${today}`;
  fs.copyFileSync(filePath, bakPath);
  LOG(`Backed up ${path.basename(filePath)} → ${path.basename(bakPath)}`);

  // Write rewritten content
  const newContent = outLines.join('\n');
  fs.writeFileSync(filePath, newContent, 'utf8');

  return changes;
}

/**
 * Apply all proposals to source files.
 */
function applyProposals(dryRun) {
  INFO('Reading proposals from', PROPOSALS_MD);
  const { toRemove, toReplace } = parseProposals();

  INFO(`  Rules to remove:  ${toRemove.size}`);
  INFO(`  Rules to replace: ${toReplace.size}`);

  if (toRemove.size === 0 && toReplace.size === 0) {
    INFO('Nothing to apply.');
    return;
  }

  if (dryRun) {
    INFO('\n--- DRY RUN ---');
    INFO('Would remove:');
    for (const r of toRemove) INFO(`  - "${r.slice(0, 80)}..."`);
    INFO('Would replace:');
    for (const [old, next] of toReplace) {
      INFO(`  ~ "${old.slice(0, 60)}..." → "${next.slice(0, 60)}..."`);
    }
    return;
  }

  // Collect all rule files
  const files = [GLOBAL_MD];
  if (fs.existsSync(AGENTS_DIR)) {
    fs.readdirSync(AGENTS_DIR)
      .filter(f => f.endsWith('.md'))
      .forEach(f => files.push(path.join(AGENTS_DIR, f)));
  }

  let totalChanges = 0;
  for (const file of files) {
    const n = applyToFile(file, toRemove, toReplace);
    if (n > 0) {
      INFO(`  ${n} change(s) in ${file.replace(HOME, '~')}`);
      totalChanges += n;
    }
  }

  INFO(`\nApplied ${totalChanges} change(s) across ${files.length} file(s).`);
}

// ─── Dry-run analysis print ───────────────────────────────────────────────────

function printDryRun(analysis, rules) {
  const today = new Date().toISOString().split('T')[0];
  INFO(`\n=== Dry-run: Deduplication Analysis — ${today} ===`);
  INFO(`Analyzed ${rules.length} rules\n`);

  if (analysis.merge.length === 0 && analysis.delete.length === 0 && analysis.contradiction.length === 0) {
    INFO('No duplicates found.');
    return;
  }

  if (analysis.merge.length > 0) {
    INFO(`--- MERGE (${analysis.merge.length}) ---`);
    for (const m of analysis.merge) {
      INFO(`Keep:   "${m.keep}"`);
      for (const r of m.remove) INFO(`Remove: "${r}"`);
      if (m.merged) INFO(`→      "${m.merged}"`);
      INFO(`Why:    ${m.reason}\n`);
    }
  }

  if (analysis.delete.length > 0) {
    INFO(`--- DELETE (${analysis.delete.length}) ---`);
    for (const d of analysis.delete) {
      INFO(`Delete: "${d.rule}"`);
      INFO(`Dup of: "${d.duplicate_of}"`);
      INFO(`Why:    ${d.reason}\n`);
    }
  }

  if (analysis.contradiction.length > 0) {
    INFO(`--- CONTRADICTIONS (${analysis.contradiction.length}) — manual resolution needed ---`);
    for (const c of analysis.contradiction) {
      INFO(`A: "${c.rule_a}"`);
      INFO(`B: "${c.rule_b}"`);
      INFO(`Conflict: ${c.reason}\n`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (APPLY) {
    // --apply: read proposals file and patch source files
    applyProposals(false);
    return;
  }

  // Collect rules
  const rules = collectAllRules();
  if (rules.length === 0) {
    INFO('No rules found. Nothing to deduplicate.');
    return;
  }

  INFO(`Found ${rules.length} rules across ${countSources(rules)} file(s).`);

  if (DRY_RUN && rules.length === 0) {
    INFO('No rules to analyze.');
    return;
  }

  // Analyze with Sonnet
  const analysis = await analyzeRules(rules);

  if (DRY_RUN) {
    printDryRun(analysis, rules);
    return;
  }

  // Write proposals
  writeProposals(analysis, rules);

  const total = analysis.merge.length + analysis.delete.length + analysis.contradiction.length;
  if (total === 0) {
    INFO('Rules look clean — no proposals generated.');
  } else {
    INFO(`\nProposals ready. Review ${PROPOSALS_MD.replace(HOME, '~')}, then run:`);
    INFO('  node ~/.claude/helpers/rule-deduplicator.js --apply');
  }
}

main().catch(e => {
  LOG('Fatal:', e.message);
  process.exit(1);
});
