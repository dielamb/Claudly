#!/usr/bin/env node
'use strict';
/**
 * backfill-wikilinks.js — one-time script to add wikilinks to rules.json entries.
 *
 * For each rule missing a `wikilinks` field:
 *   1. Loads vault note titles from ~/Desktop/Labirynt/3 Atlas/ (Problems/, Tools/, Synthesis/)
 *   2. Batches up to 8 rules per Haiku call to stay within rate limits
 *   3. Writes wikilinks field back to rules.json (atomic: temp file + rename)
 *
 * Usage:
 *   node ~/.claude/helpers/backfill-wikilinks.js           # add wikilinks to all rules missing them
 *   node ~/.claude/helpers/backfill-wikilinks.js --dry-run # preview without writing
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawnSync } = require('child_process');

const HOME       = process.env.HOME || os.homedir();
const RULES_PATH = path.join(HOME, '.claude', 'learning', 'rules.json');
const VAULT_ROOT = path.join(HOME, 'Desktop', 'Labirynt');
const CLAUDE_BIN = path.join(HOME, '.nvm', 'versions', 'node', 'v24.15.0', 'bin', 'claude');
const MODEL      = 'claude-haiku-4-5-20251001';
const BATCH_SIZE = 8;

const isDryRun = process.argv.includes('--dry-run');
const LOG = (...a) => console.log('[backfill-wikilinks]', ...a);

// ---------------------------------------------------------------------------
// Vault note title loader
// ---------------------------------------------------------------------------
function loadVaultNoteTitles() {
  const dirs = [
    '3 Atlas/Problems',
    '3 Atlas/Tools',
    '3 Atlas/Synthesis',
  ];
  const titles = [];
  for (const dir of dirs) {
    const dirPath = path.join(VAULT_ROOT, dir);
    if (!fs.existsSync(dirPath)) {
      LOG(`WARN: vault dir not found: ${dirPath}`);
      continue;
    }
    for (const file of fs.readdirSync(dirPath)) {
      if (!file.endsWith('.md')) continue;
      // Strip .md; preserve spaces and unicode; replace | (Obsidian alias separator)
      const title = file.replace(/\.md$/, '').replace(/\|/g, '-');
      titles.push(title);
    }
  }
  return titles;
}

// ---------------------------------------------------------------------------
// Haiku call — spawnSync, returns raw stdout string or null on failure
// ---------------------------------------------------------------------------
function callHaiku(prompt) {
  const result = spawnSync(
    CLAUDE_BIN,
    ['-p', prompt, '--model', MODEL, '--output-format', 'text'],
    { encoding: 'utf8', timeout: 60000 }
  );
  if (result.status !== 0 || !result.stdout?.trim()) {
    LOG('Haiku call failed:', (result.stderr || '').slice(0, 200));
    return null;
  }
  return result.stdout.trim();
}

// ---------------------------------------------------------------------------
// Parse Haiku JSON response for a batch
// Returns Map<index, string[]> where value is array of wikilink strings
// ---------------------------------------------------------------------------
function parseBatchResponse(raw, batch) {
  if (!raw) return new Map();
  // Extract the outermost JSON array from the response
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    LOG('WARN: could not find JSON array in Haiku response');
    return new Map();
  }
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    LOG('WARN: JSON parse failed:', e.message);
    return new Map();
  }
  const result = new Map();
  for (const item of parsed) {
    const idx = item.index;
    if (typeof idx !== 'number' || idx < 0 || idx >= batch.length) continue;
    const links = Array.isArray(item.wikilinks) ? item.wikilinks : [];
    // Validate each wikilink is a string and refers to a real title
    result.set(idx, links.filter(l => typeof l === 'string'));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Process a batch of rules — returns updated rules array with wikilinks set
// ---------------------------------------------------------------------------
function processBatch(batch, vaultNotes) {
  const noteList = vaultNotes.map(t => `- ${t}`).join('\n');
  const rulesBlock = batch
    .map((r, i) => `${i}. Rule: "${r.rule}"\n   Tags: ${JSON.stringify(r.tags || [])}`)
    .join('\n\n');

  const prompt = `For each rule below, return 1-3 wikilinks to the most semantically relevant notes from the provided list.

RULES:
${rulesBlock}

NOTES (exact titles — use verbatim, do not invent):
${noteList}

Return a JSON array with one entry per rule.
Format exactly:
[{"index": 0, "wikilinks": ["[[Title]]"]}, {"index": 1, "wikilinks": []}, ...]

Constraints:
- Use ONLY titles from the NOTES list above, verbatim
- Each title wrapped in [[ and ]] — e.g. [[GSD visual verification]]
- 0-3 wikilinks per rule ([] if nothing is truly relevant)
- Prefer specificity: "GAN Loop - Generator-Evaluator pipeline" over "GAN Loop - Rubric quality Hook Power standard" unless the rule is specifically about rubrics
- Return ONLY the JSON array, no other text`;

  LOG(`Calling Haiku for batch of ${batch.length} rules...`);
  const raw = callHaiku(prompt);
  const linkMap = parseBatchResponse(raw, batch);

  return batch.map((rule, i) => {
    const links = linkMap.has(i) ? linkMap.get(i) : [];
    return { ...rule, wikilinks: links };
  });
}

// ---------------------------------------------------------------------------
// Atomic write: write to temp file, then rename
// ---------------------------------------------------------------------------
function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  LOG(isDryRun ? 'DRY RUN — no changes will be written' : 'Running...');

  // Load rules
  let rules;
  try {
    rules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
  } catch (e) {
    LOG('FATAL: could not read rules.json:', e.message);
    process.exit(1);
  }

  // Find rules missing wikilinks
  const pending = rules
    .map((r, i) => ({ rule: r, originalIndex: i }))
    .filter(({ rule }) => rule.wikilinks === undefined);

  if (pending.length === 0) {
    LOG('All rules already have wikilinks. Nothing to do.');
    return;
  }

  LOG(`Found ${pending.length} rule(s) missing wikilinks out of ${rules.length} total.`);

  // Load vault note titles
  const vaultNotes = loadVaultNoteTitles();
  LOG(`Loaded ${vaultNotes.length} vault note titles.`);

  if (vaultNotes.length === 0) {
    LOG('FATAL: no vault notes found. Check vault path:', VAULT_ROOT);
    process.exit(1);
  }

  if (isDryRun) {
    LOG('--- DRY RUN PREVIEW ---');
    LOG(`Would process ${pending.length} rules in ${Math.ceil(pending.length / BATCH_SIZE)} batch(es) of up to ${BATCH_SIZE}.`);
    LOG('Rules to process:');
    pending.forEach(({ rule }, i) => {
      LOG(`  ${i + 1}. [${rule.id.slice(0, 8)}] "${rule.rule.slice(0, 80)}${rule.rule.length > 80 ? '...' : ''}"`);
    });
    LOG('--- END DRY RUN ---');
    return;
  }

  // Process in batches
  let totalUpdated = 0;
  const updatedRules = [...rules];

  for (let batchStart = 0; batchStart < pending.length; batchStart += BATCH_SIZE) {
    const batchItems = pending.slice(batchStart, batchStart + BATCH_SIZE);
    const batchRules = batchItems.map(({ rule }) => rule);

    LOG(`Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(pending.length / BATCH_SIZE)} (rules ${batchStart + 1}-${batchStart + batchRules.length})...`);

    const updated = processBatch(batchRules, vaultNotes);

    // Write back to the full rules array
    for (let j = 0; j < updated.length; j++) {
      const { originalIndex } = batchItems[j];
      updatedRules[originalIndex] = updated[j];
      const linkCount = updated[j].wikilinks.length;
      LOG(`  rule [${updated[j].id.slice(0, 8)}]: ${linkCount} link(s) ${linkCount > 0 ? updated[j].wikilinks.join(', ') : '(none)'}`);
      totalUpdated++;
    }

    // Atomic write after each batch — partial progress is preserved
    atomicWrite(RULES_PATH, JSON.stringify(updatedRules, null, 2));
    LOG(`  Saved progress (${totalUpdated}/${pending.length} processed).`);

    // Brief pause between batches to avoid rate limit bursts
    if (batchStart + BATCH_SIZE < pending.length) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
  }

  LOG(`Done. ${totalUpdated} rule(s) updated in ${RULES_PATH}`);
}

main().catch(e => {
  console.error('[backfill-wikilinks] Fatal:', e.message);
  process.exit(1);
});
