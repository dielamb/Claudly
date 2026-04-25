#!/usr/bin/env node
'use strict';

/**
 * migrate-rules.js — Converts flat .md rule files to rules.json with trigger conditions.
 *
 * Reads all rules from:
 *   ~/.claude/learning/global.md
 *   ~/.claude/learning/agents/*.md
 *
 * Generates trigger conditions via Haiku (batch of 6), then writes:
 *   ~/.claude/learning/rules.json  (atomic: temp → rename)
 *
 * Also backs up originals as .md.bak-YYYYMMDD.
 *
 * Usage:
 *   node ~/.claude/helpers/migrate-rules.js           # migrate
 *   node ~/.claude/helpers/migrate-rules.js --dry-run # preview without writing
 */

const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const crypto   = require('crypto');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HOME         = process.env.HOME || os.homedir();
const LEARNING_DIR = path.join(HOME, '.claude', 'learning');
const AGENTS_DIR   = path.join(LEARNING_DIR, 'agents');
const GLOBAL_MD    = path.join(LEARNING_DIR, 'global.md');
const RULES_JSON   = path.join(LEARNING_DIR, 'rules.json');

const CLAUDE_BIN   = path.join(HOME, '.nvm', 'versions', 'node', 'v24.15.0', 'bin', 'claude');
const HAIKU_MODEL  = 'claude-haiku-4-5-20251001';
const BATCH_SIZE   = 6;
const DRY_RUN      = process.argv.includes('--dry-run');
const TODAY        = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

const LOG  = (...a) => console.error('[migrate-rules]', ...a);
const INFO = (...a) => console.log('[migrate-rules]', ...a);

// ---------------------------------------------------------------------------
// Tag extraction — no LLM
// ---------------------------------------------------------------------------

const TAG_PATTERNS = {
  ui:      /screenshot|viewport|resize|css|html|visual|chrome/i,
  git:     /commit|branch|push|merge|rebase|git/i,
  test:    /test|spec|jest|vitest|playwright/i,
  gsd:     /gsd|plan|phase|execute/i,
  session: /session|startup|load|context/i,
  skill:   /skill|invoke|invoc/i,
  prompt:  /prompt|truncat|template/i,
  agent:   /agent|spawn|parallel|swarm/i,
  obsidian:/obsidian|labirynt|vault|note/i,
  figma:   /figma|design|token|component/i,
};

function extractTags(ruleText) {
  return Object.entries(TAG_PATTERNS)
    .filter(([, re]) => re.test(ruleText))
    .map(([tag]) => tag);
}

// ---------------------------------------------------------------------------
// Parse .md rule files
// ---------------------------------------------------------------------------

/**
 * Parse a single .md rule file.
 * Returns array of { rule, origin, created, agentType }.
 *
 * Format expected:
 *   Rule text here
 *   <!-- origin YYYY-MM-DD -->
 *
 * Lines starting with # or blank are skipped (except they can follow a rule
 * as its origin comment).
 */
function parseMdFile(filePath, agentType) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    LOG(`Cannot read ${filePath}: ${e.message}`);
    return [];
  }

  const lines  = content.split('\n');
  const rules  = [];
  let pending  = null; // { rule, agentType }

  for (const raw of lines) {
    const line = raw.trim();

    // Blank line or heading — flush any pending rule without metadata
    if (!line || line.startsWith('#')) {
      if (pending && !pending.flushed) {
        rules.push({ rule: pending.rule, origin: 'manual', created: TODAY, agentType });
        pending = null;
      }
      continue;
    }

    // Metadata comment: <!-- origin YYYY-MM-DD -->
    if (line.startsWith('<!--')) {
      const match = line.match(/<!--\s*([\w-]+)\s+(\d{4}-\d{2}-\d{2})\s*-->/);
      if (match && pending) {
        const [, origin, created] = match;
        rules.push({ rule: pending.rule, origin, created, agentType });
        pending = null;
        continue;
      }
      // Unrecognised comment — skip
      continue;
    }

    // If there's a pending rule that hasn't been associated with metadata yet,
    // flush it before starting a new one (shouldn't normally happen, but guards
    // against files with two consecutive rule lines).
    if (pending) {
      rules.push({ rule: pending.rule, origin: 'manual', created: TODAY, agentType });
    }

    pending = { rule: line };
  }

  // Flush trailing rule
  if (pending) {
    rules.push({ rule: pending.rule, origin: 'manual', created: TODAY, agentType });
  }

  return rules;
}

/**
 * Collect all raw rules from global.md + agents/*.md.
 * Returns { rawRules, sources } where sources is a map file→content for backup.
 */
function collectRules() {
  const rawRules = [];
  const sources  = {}; // filePath → raw content (for backup)

  // global.md
  if (fs.existsSync(GLOBAL_MD)) {
    rawRules.push(...parseMdFile(GLOBAL_MD, null));
    sources[GLOBAL_MD] = fs.readFileSync(GLOBAL_MD, 'utf8');
  } else {
    LOG(`global.md not found: ${GLOBAL_MD}`);
  }

  // agents/*.md
  if (fs.existsSync(AGENTS_DIR)) {
    const agentFiles = fs.readdirSync(AGENTS_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(AGENTS_DIR, f));

    for (const agentFile of agentFiles) {
      const agentType = path.basename(agentFile, '.md');
      rawRules.push(...parseMdFile(agentFile, agentType));
      sources[agentFile] = fs.readFileSync(agentFile, 'utf8');
    }
  } else {
    LOG(`Agents dir not found: ${AGENTS_DIR}`);
  }

  return { rawRules, sources };
}

// ---------------------------------------------------------------------------
// Haiku trigger generation
// ---------------------------------------------------------------------------

/**
 * Build the prompt for a batch of rules.
 * Returns the prompt string.
 */
function buildBatchPrompt(rules) {
  const rulesList = rules
    .map((r, i) => `${i + 1}. "${r.rule}"`)
    .join('\n');

  return `You are a rule-metadata assistant. For each numbered rule below, generate trigger metadata.

Rules:
${rulesList}

For each rule return a JSON object with:
- "nl": one sentence describing when an agent should apply this rule
- "match": array of OR-groups (AND-of-OR semantics). Each predicate: { "field": "agent_type"|"task"|"tool"|"tags", "op": "contains"|"regex"|"eq"|"in", "value": string|string[] }. Use empty [] if rule applies globally to all agents/tasks.

Return a JSON array with exactly ${rules.length} objects, one per rule, in the same order.
Respond with raw JSON array only — no markdown fence, no explanation.`;
}

/**
 * Call Haiku for a batch of rules.
 * Returns array of { nl, match } (one per rule in batch).
 * Falls back to empty trigger on any failure.
 */
function callHaiku(rules) {
  const prompt = buildBatchPrompt(rules);

  const result = spawnSync(
    CLAUDE_BIN,
    [
      '-p', prompt,
      '--model', HAIKU_MODEL,
      '--output-format', 'text',
    ],
    { encoding: 'utf8', timeout: 90000 }
  );

  if (result.status !== 0 || !result.stdout?.trim()) {
    LOG('Haiku call failed:', result.stderr?.slice(0, 300) || '(no stderr)');
    return rules.map(r => fallbackTrigger(r.rule));
  }

  let parsed;
  try {
    const match = result.stdout.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array found in Haiku output');
    parsed = JSON.parse(match[0]);
  } catch (e) {
    LOG('Could not parse Haiku batch response:', e.message);
    return rules.map(r => fallbackTrigger(r.rule));
  }

  // Validate and normalise each item; fall back individually if malformed
  return rules.map((r, i) => {
    const item = parsed[i];
    if (!item || typeof item.nl !== 'string' || !Array.isArray(item.match)) {
      LOG(`Malformed trigger at index ${i}, using fallback`);
      return fallbackTrigger(r.rule);
    }
    return { nl: item.nl, match: item.match };
  });
}

function fallbackTrigger(ruleText) {
  return { nl: ruleText, match: [] };
}

/**
 * Generate triggers for all raw rules, batching BATCH_SIZE at a time.
 */
function generateTriggers(rawRules) {
  const triggers = [];
  const total    = rawRules.length;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = rawRules.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(total / BATCH_SIZE);
    LOG(`Haiku batch ${batchNum}/${totalBatches} (${batch.length} rules)...`);

    const results = callHaiku(batch);
    triggers.push(...results);
  }

  return triggers;
}

// ---------------------------------------------------------------------------
// Build full rule objects
// ---------------------------------------------------------------------------

/**
 * Normalise origin string to allowed enum values.
 * draft.md schema: "dream" | "bulk-dream" | "mega-dream" | "manual"
 */
function normaliseOrigin(raw) {
  if (!raw) return 'manual';
  const r = raw.toLowerCase().trim();
  if (r === 'dream')      return 'dream';
  if (r === 'bulk-dream') return 'bulk-dream';
  if (r === 'mega-dream') return 'mega-dream';
  return 'manual';
}

function buildRuleObjects(rawRules, triggers) {
  return rawRules.map((raw, i) => {
    const trigger = triggers[i] || fallbackTrigger(raw.rule);
    const tags    = extractTags(raw.rule);

    // agent-specific rules get their agent_type baked into tags and trigger
    if (raw.agentType && !tags.includes(raw.agentType)) {
      tags.unshift(raw.agentType);
    }

    return {
      id:         crypto.randomUUID(),
      rule:       raw.rule,
      trigger,
      source:     'unknown',
      confidence: 7,
      created:    raw.created || TODAY,
      updated:    TODAY,
      origin:     normaliseOrigin(raw.origin),
      tags,
      disabled:   false,
    };
  });
}

// ---------------------------------------------------------------------------
// Backup originals
// ---------------------------------------------------------------------------

function backupSources(sources) {
  const stamp = TODAY.replace(/-/g, '');
  for (const [filePath, content] of Object.entries(sources)) {
    const bakPath = `${filePath}.bak-${stamp}`;
    if (fs.existsSync(bakPath)) {
      LOG(`Backup already exists, skipping: ${bakPath}`);
      continue;
    }
    fs.writeFileSync(bakPath, content, 'utf8');
    INFO(`Backed up: ${bakPath}`);
  }
}

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

function atomicWriteJson(targetPath, data) {
  const tmp = `${targetPath}.tmp-${Date.now()}`;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, targetPath);
}

// ---------------------------------------------------------------------------
// Dry-run preview
// ---------------------------------------------------------------------------

function printDryRun(ruleObjects) {
  console.log('\n=== DRY RUN — rules that would be written ===\n');
  for (const r of ruleObjects) {
    console.log(`ID:         ${r.id}`);
    console.log(`Rule:       ${r.rule}`);
    console.log(`Trigger NL: ${r.trigger.nl}`);
    console.log(`Match:      ${JSON.stringify(r.trigger.match)}`);
    console.log(`Tags:       ${r.tags.join(', ') || '(none)'}`);
    console.log(`Origin:     ${r.origin}  Created: ${r.created}  Confidence: ${r.confidence}`);
    console.log('---');
  }
  console.log(`\nTotal: ${ruleObjects.length} rule(s) would be written to:\n  ${RULES_JSON}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  INFO(`Mode: ${DRY_RUN ? 'DRY RUN' : 'MIGRATE'}`);

  // 1. Collect raw rules from .md files
  const { rawRules, sources } = collectRules();
  INFO(`Collected ${rawRules.length} rule(s) from .md files`);

  if (rawRules.length === 0) {
    INFO('Nothing to migrate.');
    process.exit(0);
  }

  // 2. Generate triggers via Haiku (batched; same call for both dry-run and real run)
  INFO(DRY_RUN
    ? 'DRY RUN: Calling Haiku to preview triggers (no files will be written)...'
    : 'Generating trigger conditions via Haiku...'
  );
  const triggers = generateTriggers(rawRules);

  // 3. Build full rule objects
  const ruleObjects = buildRuleObjects(rawRules, triggers);

  // 4. Output
  if (DRY_RUN) {
    printDryRun(ruleObjects);
    process.exit(0);
  }

  // 5. Backup originals
  backupSources(sources);

  // 6. Atomic write to rules.json
  atomicWriteJson(RULES_JSON, ruleObjects);
  INFO(`Written ${ruleObjects.length} rule(s) to: ${RULES_JSON}`);

  // 7. Summary
  const byOrigin = ruleObjects.reduce((acc, r) => {
    acc[r.origin] = (acc[r.origin] || 0) + 1;
    return acc;
  }, {});
  INFO('Rules by origin:', JSON.stringify(byOrigin));

  const globalRules = ruleObjects.filter(r => r.trigger.match.length === 0).length;
  INFO(`Global rules (empty match): ${globalRules}`);
  INFO(`Targeted rules (non-empty match): ${ruleObjects.length - globalRules}`);
}

main().catch(e => {
  LOG('Fatal:', e.message);
  process.exit(1);
});
