#!/usr/bin/env node
// rule-evolver.js — monthly rule evolution pipeline
// Zero external npm deps. Uses only Node.js built-ins.
//
// Usage:
//   node rule-evolver.js              # generate evolution-proposals.md
//   node rule-evolver.js --dry-run    # preview without writing
//   node rule-evolver.js --apply      # apply human-approved proposals
//   node rule-evolver.js --force      # skip 25-day lock guard
//
// Cron entry (add via: crontab -e):
//   # Rule evolution — runs monthly on the 1st at 09:00, skips if last run < 25 days ago
//   0 9 1 * * __HOME__/.nvm/versions/node/v24.15.0/bin/node ~/.claude/helpers/rule-evolver.js >> ~/.claude/logs/rule-evolver.log 2>&1
//
// File layout this script touches:
//   ~/.claude/learning/rules.json                    ← reads (and writes on --apply)
//   ~/.claude/learning/sessions/*.jsonl              ← reads (session evidence)
//   ~/.claude/learning/evolution-proposals.md        ← writes (human review)
//   ~/.claude/learning/evolution-log.jsonl           ← appends (audit trail)
//   ~/.claude/learning/.evolver-last-run             ← writes (lock file)
//   ~/.claude/learning/evolution-archive/            ← archives on --apply
//   ~/.claude/logs/rule-evolver.log                  ← appends (run log)

'use strict';

const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');
const os   = require('os');

// ── Config ────────────────────────────────────────────────────────────────────
const HOME             = process.env.HOME || os.homedir();
const RULES_FILE       = path.join(HOME, '.claude/learning/rules.json');
const SESSIONS_DIR     = path.join(HOME, '.claude/learning/sessions');
const PROPOSALS_FILE   = path.join(HOME, '.claude/learning/evolution-proposals.md');
const EVOLUTION_LOG    = path.join(HOME, '.claude/learning/evolution-log.jsonl');
const ARCHIVE_DIR      = path.join(HOME, '.claude/learning/evolution-archive');
const LOCK_FILE        = path.join(HOME, '.claude/learning/.evolver-last-run');
const RUN_LOG          = path.join(HOME, '.claude/logs/rule-evolver.log');
const CLAUDE_BIN       = path.join(HOME, '.nvm/versions/node/v24.15.0/bin/claude');
const MODEL            = 'claude-sonnet-4-6';
const BATCH_SIZE       = 5;        // max rules per Sonnet call
const SESSIONS_PER_RULE = 20;     // cap: 10-20 per brief
const COLD_START_DAYS  = 30;
const MIN_INTERVAL_DAYS = 25;

// ── Parse CLI flags ───────────────────────────────────────────────────────────
const argv     = process.argv.slice(2);
const DRY_RUN  = argv.includes('--dry-run');
const APPLY    = argv.includes('--apply');
const FORCE    = argv.includes('--force');

if (DRY_RUN && APPLY) {
  console.error('[ERROR] --dry-run and --apply are mutually exclusive.');
  process.exit(1);
}

// ── Logging ───────────────────────────────────────────────────────────────────
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function logEvent(event, extra = {}) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), event, ...extra });
  if (!DRY_RUN) {
    ensureDir(path.dirname(RUN_LOG));
    fs.appendFileSync(RUN_LOG, entry + '\n');
  }
  console.log(`[${event}]`, JSON.stringify(extra));
}

// ── 25-day lock guard ─────────────────────────────────────────────────────────
function checkLock() {
  if (FORCE || APPLY) return false; // --apply always proceeds
  if (!fs.existsSync(LOCK_FILE)) return false;
  const lastRun = new Date(fs.readFileSync(LOCK_FILE, 'utf8').trim());
  const daysSince = (Date.now() - lastRun.getTime()) / 86_400_000;
  return daysSince < MIN_INTERVAL_DAYS;
}

function writeLock() {
  if (!DRY_RUN) fs.writeFileSync(LOCK_FILE, new Date().toISOString());
}

// ── Rule loading and filtering ────────────────────────────────────────────────

/**
 * Load rules.json. Expects array of rule objects with at minimum:
 *   { id, rule, confidence, created, needsEvolution? }
 * The rule text field may be `rule` (current format) or `text` (legacy).
 * Returns the full array with a normalised `.text` accessor.
 */
function loadRules() {
  if (!fs.existsSync(RULES_FILE)) {
    console.error(`[ERROR] rules.json not found at ${RULES_FILE}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(RULES_FILE, 'utf8');
  const rules = JSON.parse(raw);
  // Normalise: rules.json uses `rule` field; draft uses `text`. Support both.
  for (const r of rules) {
    if (!r.text && r.rule) r.text = r.rule;
    if (!r.rule && r.text) r.rule = r.text;
  }
  return rules;
}

/**
 * Filter: (confidence < 6 OR needsEvolution === true) AND rule is >= 30 days old.
 * Returns { eligible: Rule[], tooNew: Rule[] }
 */
function filterRules(rules) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - COLD_START_DAYS);

  const eligible = [];
  const tooNew   = [];

  for (const rule of rules) {
    if (rule.disabled) continue; // skip disabled rules entirely

    const createdDate = new Date(rule.created);
    const isWeak = rule.confidence < 6 || rule.needsEvolution === true;

    if (createdDate >= cutoff) {
      // Rule is younger than 30 days — cold start, skip regardless of weakness
      tooNew.push(rule);
    } else if (isWeak) {
      eligible.push(rule);
    }
    // else: confident and old enough — not eligible for evolution this cycle
  }

  return { eligible, tooNew };
}

// ── Keyword extraction ─────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the','and','for','are','was','with','that','this','from','have',
  'they','will','been','when','what','but','not','all','can','each',
  'run','use','add','get','set','put','how','its','more','then','than',
  'into','only','some','also','after','before','their','there','about',
]);

/**
 * Extract meaningful keywords from rule text.
 * Returns array of lowercase words > 4 chars, stopwords removed.
 * Prefers trigger.nl when available (mirrors rule-verifier.js pattern).
 */
function extractKeywords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !STOPWORDS.has(w))
    .slice(0, 15); // cap to avoid over-broad matching
}

function keywordsForRule(rule) {
  // Prefer trigger.nl (richer signal, mirrors rule-verifier.js)
  if (rule.trigger && rule.trigger.nl) {
    const kw = extractKeywords(rule.trigger.nl);
    if (kw.length >= 2) return kw;
    // Supplement from rule text until we have 3
    const extra = extractKeywords(rule.text || '');
    return [...new Set([...kw, ...extra])].slice(0, 15);
  }
  return extractKeywords(rule.text || '');
}

// ── Meta-session detection ─────────────────────────────────────────────────────

const META_PATTERNS = [
  'Read the session transcript at',
  'Write a concise session summary',
  'dream-worker',
  'bulk-dream',
  'rule-evolver',
  'Analyze these',
  'learning/sessions',
  'evolution-proposals',
];

/**
 * Returns true if a session line looks like a meta/tooling session.
 * Mirrors dream-worker.js isMetaSession pattern.
 */
function isMetaSession(firstLine) {
  return META_PATTERNS.some(p => firstLine.includes(p));
}

// ── Session file handling ──────────────────────────────────────────────────────

/**
 * Parse date from session filename. Expected format: YYYYMMDD-HHMMSS-<hash>.jsonl
 * Returns Date object or null if unparseable.
 */
function parseSessionDate(filename) {
  const m = filename.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
}

/**
 * Read first 512 bytes of a JSONL file to get `ts` field or detect meta-session.
 * Returns { date: Date|null, isMeta: boolean }.
 */
function peekSession(filepath) {
  try {
    const fd = fs.openSync(filepath, 'r');
    const buf = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    const firstLine = buf.slice(0, bytesRead).toString('utf8').split('\n')[0];
    if (isMetaSession(firstLine)) return { date: null, isMeta: true };
    try {
      const event = JSON.parse(firstLine);
      if (event.ts) {
        const d = new Date(event.ts);
        if (!isNaN(d.getTime())) return { date: d, isMeta: false };
      }
    } catch (_) {}
    return { date: null, isMeta: false };
  } catch (_) {
    return { date: null, isMeta: false };
  }
}

/**
 * For a rule, find up to SESSIONS_PER_RULE session files created AFTER rule.created
 * that contain keywords from the rule text. Skips meta/tooling sessions.
 */
function findSessionsForRule(rule) {
  if (!fs.existsSync(SESSIONS_DIR)) return [];

  const ruleDate = new Date(rule.created);
  const keywords = keywordsForRule(rule);
  if (keywords.length === 0) return [];

  let allFiles;
  try {
    allFiles = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
  } catch (_) {
    return [];
  }

  // Pre-filter by filename date (zero file reads for this step)
  const candidates = allFiles.filter(f => {
    const d = parseSessionDate(f);
    return d !== null && d > ruleDate;
  });

  // Scan content for keyword matches
  const matched = [];
  for (const filename of candidates) {
    if (matched.length >= SESSIONS_PER_RULE) break;
    const filepath = path.join(SESSIONS_DIR, filename);
    const { date, isMeta } = peekSession(filepath);
    if (isMeta) continue;

    try {
      const content = fs.readFileSync(filepath, 'utf8');
      const contentLower = content.toLowerCase();
      const hasKeyword = keywords.some(k => contentLower.includes(k));
      if (hasKeyword) {
        matched.push({ filename, filepath, content });
      }
    } catch (_) {
      // skip unreadable files
    }
  }

  if (matched.length < 10) {
    console.warn(`[WARN] Rule ${rule.id}: only ${matched.length} evidence sessions (< 10 threshold)`);
  }

  return matched.slice(0, SESSIONS_PER_RULE);
}

/**
 * Extract a brief snippet from session content for evidence bundles.
 * Returns up to 3 relevant lines containing any keyword.
 */
function extractSnippet(content, keywords, maxLines = 3) {
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  const relevant = lines.filter(l => {
    const lower = l.toLowerCase();
    return keywords.some(k => lower.includes(k));
  });
  return relevant.slice(0, maxLines).join(' | ').slice(0, 400);
}

// ── Build evidence bundles ────────────────────────────────────────────────────

/**
 * Build an evidence bundle for a rule and its matched sessions.
 */
function buildEvidenceBundle(rule, sessions) {
  const keywords = keywordsForRule(rule);
  const snippets = sessions.map(s => ({
    filename: s.filename,
    snippet: extractSnippet(s.content, keywords),
  })).filter(s => s.snippet.length > 0);

  return {
    rule_id:           rule.id,
    rule_text:         rule.text,
    confidence:        rule.confidence,
    needs_evolution:   rule.needsEvolution || false,
    created:           rule.created,
    sessions_scanned:  sessions.length,
    evidence_snippets: snippets,
  };
}

// ── Quality Gates ─────────────────────────────────────────────────────────────

const QG_WEASEL     = /\b(generally|usually|consider|might|could|may)\b/gi;
const QG_TRIGGER    = /\b(when|if|after|before|never|only if|always with)\b/gi;
const QG_MEASURABLE = /(\d+\s*(days?|steps?|files?|iter|sec|ms)|[<>≥≤]=?\s*\d+)/gi;
const QG_ARTIFACT   = /(draft\.md|feedback-\w+\.md|gan-loop|\.jsonl|cron|\.claude|rules\.json)/gi;

function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}

/**
 * Run all 5 quality gates on an improved rule text.
 * Returns { ok: boolean, failures: string[] }
 */
function qualityGates(original, improved) {
  const failures = [];

  // QG-1: shorter OR trigger condition added
  const shorter    = improved.length < original.length;
  const hasTrigger = QG_TRIGGER.test(improved);
  QG_TRIGGER.lastIndex = 0;
  if (!shorter && !hasTrigger) {
    failures.push('QG-1: not shorter and no trigger condition added');
  }

  // QG-2: vagueness must not increase
  const origWeasels = countMatches(original, QG_WEASEL);
  const imprWeasels = countMatches(improved, QG_WEASEL);
  if (imprWeasels > origWeasels) {
    failures.push(`QG-2: vagueness increased (${origWeasels} → ${imprWeasels} weasel words)`);
  }

  // QG-3: testability — at least one condition, threshold, or named artifact
  const hasTrig2    = QG_TRIGGER.test(improved);   QG_TRIGGER.lastIndex = 0;
  const hasMeasure  = QG_MEASURABLE.test(improved); QG_MEASURABLE.lastIndex = 0;
  const hasArtifact = QG_ARTIFACT.test(improved);   QG_ARTIFACT.lastIndex = 0;
  if (!hasTrig2 && !hasMeasure && !hasArtifact) {
    failures.push('QG-3: not testable (no condition, threshold, or named artifact)');
  }

  // QG-4: scope preserved — keyword overlap >= 50%
  const origKw = new Set((original.toLowerCase().match(/\b\w{4,}\b/g) || []));
  const imprKw = new Set((improved.toLowerCase().match(/\b\w{4,}\b/g) || []));
  if (origKw.size > 0) {
    const intersection = [...origKw].filter(k => imprKw.has(k)).length;
    const overlap = intersection / origKw.size;
    if (overlap < 0.5) {
      failures.push(`QG-4: scope drift — keyword overlap ${(overlap * 100).toFixed(0)}% (< 50%)`);
    }
  }

  // QG-5: not identical to original
  if (improved.trim() === original.trim()) {
    failures.push('QG-5: identical to original — Sonnet echoed input');
  }

  return { ok: failures.length === 0, failures };
}

// ── Sonnet / Claude binary integration ───────────────────────────────────────

/**
 * Build the Sonnet prompt for a batch of evidence bundles.
 */
function buildPrompt(bundles) {
  const today = new Date().toISOString().slice(0, 10);
  const evidenceJson = JSON.stringify(bundles, null, 2);

  return `Today's date: ${today}

You are a rule quality analyst for an AI assistant's behavior ruleset.
You receive rules with evidence from real sessions created after the rule was written.
Your job: decide keep / improve / delete for each rule.

Analyze the following ${bundles.length} rule(s). For each rule output exactly one JSON object in a JSON array.

EVIDENCE DATA:
${evidenceJson}

For each rule return:
{
  "rule_id": "<id>",
  "verdict": "keep" | "improve" | "delete",
  "confidence": 0.0-1.0,
  "reason": "<1-2 sentences citing specific evidence>",
  "improved_text": "<new rule text — only present when verdict is improve>"
}

HARD CONSTRAINTS (must not be violated):
1. improved_text MUST be shorter than the original OR have a concrete trigger condition added (when X, if Y, never Z, after N steps, only if ...).
2. improved_text MUST contain at least one testable condition — a condition clause, measurable threshold, or named artifact.
3. Do NOT make rules more general — specificity is required. Keyword overlap with original must be >= 50%.
4. Delete verdict requires at least one of: (a) zero evidence snippets, (b) evidence shows repeated failure/violation, (c) rule contradicts current workflow.
5. Use confidence >= 0.7 for keep/improve; >= 0.8 for delete.
6. Reason MUST reference the evidence (session count, snippet content, or observed pattern).
7. Output MUST be a valid JSON array. No markdown fences, no prose outside the array.
8. Never include "improved_text" for keep or delete verdicts.`;
}

/**
 * Call the Claude binary with the prompt, return parsed JSON array of verdicts.
 * Uses child_process.spawnSync (blocks — acceptable for batch evolution).
 */
function callClaude(prompt) {
  if (!fs.existsSync(CLAUDE_BIN)) {
    console.error(`[ERROR] Claude binary not found at ${CLAUDE_BIN}`);
    process.exit(1);
  }

  const result = cp.spawnSync(
    CLAUDE_BIN,
    ['--model', MODEL, '-p', prompt],
    {
      encoding:  'utf8',
      maxBuffer: 8 * 1024 * 1024, // 8MB
      timeout:   120_000,          // 2 minute timeout per batch
    }
  );

  if (result.error) {
    throw new Error(`Claude binary error: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Claude exited with status ${result.status}: ${result.stderr}`);
  }

  const output = result.stdout.trim();

  // Extract JSON array from response (may have surrounding text despite instructions)
  const arrayMatch = output.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    throw new Error(`Claude response did not contain a JSON array. Raw: ${output.slice(0, 500)}`);
  }

  return JSON.parse(arrayMatch[0]);
}

/**
 * Process all eligible rules in batches of BATCH_SIZE.
 * Returns array of { rule, verdict, qgResult } objects.
 */
function runEvolution(eligibleRules, dryRun = false) {
  const results = [];
  const batches = [];

  for (let i = 0; i < eligibleRules.length; i += BATCH_SIZE) {
    batches.push(eligibleRules.slice(i, i + BATCH_SIZE));
  }

  logEvent('evolution_start', { total_rules: eligibleRules.length, batches: batches.length });

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const bundles = batch.map(rule => {
      const sessions = findSessionsForRule(rule);
      return { rule, bundle: buildEvidenceBundle(rule, sessions) };
    });

    const prompt = buildPrompt(bundles.map(b => b.bundle));

    if (dryRun) {
      console.log(`[DRY RUN] Would call Sonnet with batch ${batchIdx + 1}/${batches.length} (${batch.length} rules):`);
      batch.forEach(r => console.log(`  - ${r.id}: confidence=${r.confidence}, needsEvolution=${r.needsEvolution || false}`));
      for (const { rule } of bundles) {
        results.push({
          rule,
          verdict:  { rule_id: rule.id, verdict: 'keep', confidence: 0, reason: '[dry-run placeholder]' },
          qgResult: { ok: true, failures: [] },
        });
      }
      continue;
    }

    console.log(`[batch ${batchIdx + 1}/${batches.length}] Calling ${MODEL} with ${batch.length} rules...`);
    let verdicts;
    try {
      verdicts = callClaude(prompt);
    } catch (err) {
      console.error(`[ERROR] Batch ${batchIdx + 1} failed: ${err.message}`);
      logEvent('batch_error', { batch: batchIdx + 1, error: err.message });
      continue;
    }

    logEvent('batch_complete', { batch: batchIdx + 1, rules: batch.length });

    // Map verdicts back to rules by rule_id
    for (const { rule } of bundles) {
      const verdict = verdicts.find(v => v.rule_id === rule.id);
      if (!verdict) {
        console.warn(`[WARN] No verdict returned for rule ${rule.id}`);
        continue;
      }

      let qgResult = { ok: true, failures: [] };
      if (verdict.verdict === 'improve' && verdict.improved_text) {
        qgResult = qualityGates(rule.text, verdict.improved_text);
        if (!qgResult.ok) {
          console.warn(`[WARN] ${rule.id} improved_text failed quality gates: ${qgResult.failures.join('; ')}`);
          // Downgrade to keep so it still appears in proposals with QG failures noted
          verdict.verdict = 'keep';
          verdict.reason  = `[QG BLOCKED] Original verdict was improve but quality gates failed: ${qgResult.failures.join('; ')}. Original reason: ${verdict.reason}`;
          delete verdict.improved_text;
        }
      }

      results.push({ rule, verdict, qgResult });
    }
  }

  return results;
}

// ── Proposals file writer ─────────────────────────────────────────────────────

function formatDate(isoString) {
  return isoString ? new Date(isoString).toISOString().slice(0, 10) : 'unknown';
}

/**
 * Write evolution-proposals.md from results array and tooNew rules.
 * Returns the proposals file content as a string.
 */
function buildProposalsContent(results, tooNew, runId) {
  const today    = new Date().toISOString().slice(0, 10);
  const keeps    = results.filter(r => r.verdict.verdict === 'keep');
  const improves = results.filter(r => r.verdict.verdict === 'improve');
  const deletes  = results.filter(r => r.verdict.verdict === 'delete');
  const pending  = [...improves, ...deletes];

  const lines = [
    `# Rule Evolution Proposals — ${today}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Rules evaluated: ${results.length}`,
    `Proposals: ${results.length} (${keeps.length} keep, ${improves.length} improve, ${deletes.length} delete)`,
    `Pending review: ${pending.length} (${improves.length} improve, ${deletes.length} delete)`,
    '',
    '---',
    '',
  ];

  // IMPROVE proposals
  for (const { rule, verdict, qgResult } of improves) {
    lines.push(`## Rule: ${rule.id}`);
    lines.push(`Action: improve`);
    lines.push(`Approved: no`);
    lines.push(`Proposed text: "${verdict.improved_text}"`);
    lines.push('');
    lines.push(`**Original (written ${formatDate(rule.created)}):**`);
    lines.push(`> ${rule.text}`);
    lines.push('');
    lines.push(`**Reason:** ${verdict.reason}`);
    lines.push(`**Confidence:** ${verdict.confidence}`);
    lines.push(`**Quality gates:** ${qgResult.ok ? 'PASSED (all 5)' : 'FAILED: ' + qgResult.failures.join('; ')}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // DELETE proposals
  for (const { rule, verdict } of deletes) {
    lines.push(`## Rule: ${rule.id}`);
    lines.push(`Action: delete`);
    lines.push(`Approved: no`);
    lines.push('');
    lines.push(`**Original (written ${formatDate(rule.created)}):**`);
    lines.push(`> ${rule.text}`);
    lines.push('');
    lines.push(`**Reason:** ${verdict.reason}`);
    lines.push(`**Confidence:** ${verdict.confidence}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // KEEP entries (audit trail, no action needed)
  if (keeps.length > 0) {
    for (const { rule, verdict } of keeps) {
      lines.push(`## KEEP — ${rule.id}`);
      lines.push('');
      lines.push(`*No action needed. ${verdict.reason}*`);
      lines.push(`*Confidence: ${verdict.confidence}*`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  // TOO NEW section
  if (tooNew.length > 0) {
    lines.push('## TOO NEW — skipped (< 30 days old)');
    lines.push('');
    for (const rule of tooNew) {
      const created  = new Date(rule.created);
      const eligible = new Date(created);
      eligible.setDate(eligible.getDate() + COLD_START_DAYS);
      lines.push(`- ${rule.id} — written ${formatDate(rule.created)} — eligible after ${eligible.toISOString().slice(0, 10)}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push(`<!-- EVOLVER-METADATA`);
  lines.push(`run_id: ${runId}`);
  lines.push(`rules_evaluated: ${results.length}`);
  lines.push(`next_eligible: ${(() => {
    const d = new Date();
    d.setDate(d.getDate() + MIN_INTERVAL_DAYS);
    return d.toISOString().slice(0, 10);
  })()}`);
  lines.push(`-->`);

  return lines.join('\n');
}

// ── Apply logic ───────────────────────────────────────────────────────────────

/**
 * Parse the proposals file and return all approved entries.
 *
 * Proposal section structure:
 *   ## Rule: rule_id
 *   Action: improve|delete
 *   Approved: no        ← human changes to "yes" to approve
 *   Proposed text: "..."
 *
 * To approve: change `Approved: no` to `Approved: yes`
 * To reject:  leave as `Approved: no` (or delete the section)
 */
function parseProposals(content) {
  const approved = [];

  // Split on section headers for rule proposals
  const sections = content.split(/\n(?=## Rule: )/);

  for (const section of sections) {
    const headerMatch = section.match(/^## Rule: (\S+)/);
    if (!headerMatch) continue;
    const ruleId = headerMatch[1];

    const actionMatch = section.match(/^Action:\s*(\S+)/m);
    if (!actionMatch) continue;
    const action = actionMatch[1].toLowerCase(); // improve | delete

    if (action === 'keep') continue; // never needs apply

    const approvedMatch = section.match(/^Approved:\s*(\S+)/m);
    if (!approvedMatch) continue;
    const approvedValue = approvedMatch[1].toLowerCase();

    if (approvedValue === 'yes') {
      let improvedText = null;
      if (action === 'improve') {
        const propMatch = section.match(/^Proposed text:\s*"(.+)"/m);
        if (!propMatch) {
          console.warn(`[WARN] IMPROVE proposal for ${ruleId} has no proposed text — skipping`);
          continue;
        }
        improvedText = propMatch[1].trim();
      }
      approved.push({ action: action.toUpperCase(), ruleId, improvedText });
    }
  }

  return approved;
}

/**
 * Apply approved proposals to rules.json atomically.
 * Uses write-to-temp + fs.renameSync for crash safety.
 */
function applyProposals() {
  if (!fs.existsSync(PROPOSALS_FILE)) {
    console.error(`[ERROR] Proposals file not found: ${PROPOSALS_FILE}`);
    process.exit(1);
  }

  const content  = fs.readFileSync(PROPOSALS_FILE, 'utf8');
  const approved = parseProposals(content);

  if (approved.length === 0) {
    console.log('[apply] No approved proposals found. Edit evolution-proposals.md and change `Approved: no` to `Approved: yes` to approve.');
    return;
  }

  const rules = loadRules();
  const today = new Date().toISOString().slice(0, 10);
  let improvedCount = 0;
  let deletedCount  = 0;
  let skippedCount  = 0;

  for (const { action, ruleId, improvedText } of approved) {
    const ruleIdx = rules.findIndex(r => r.id === ruleId);

    if (ruleIdx === -1) {
      console.warn(`[WARN] Rule ${ruleId} not found in rules.json — already deleted?`);
      skippedCount++;
      continue;
    }

    const rule = rules[ruleIdx];

    // Idempotency: skip if already evolved/deleted
    if (rule.evolved_date || rule.deleted_date) {
      console.log(`[apply] ${ruleId} already processed (evolved: ${rule.evolved_date || 'n/a'}, deleted: ${rule.deleted_date || 'n/a'}) — skipping`);
      skippedCount++;
      continue;
    }

    if (action === 'IMPROVE') {
      const original = rule.text;
      rule.text         = improvedText;
      rule.rule         = improvedText; // keep both fields in sync
      rule.evolved_date = today;
      rule.updated      = today;
      rule.confidence   = Math.min(10, (rule.confidence || 5) + 1); // bump confidence slightly
      logAppend(EVOLUTION_LOG, {
        ts:            new Date().toISOString(),
        event:         'improved',
        rule_id:       ruleId,
        original_text: original,
        new_text:      improvedText,
        run_date:      today,
      });
      improvedCount++;
      console.log(`[apply] IMPROVED ${ruleId}`);
    } else if (action === 'DELETE') {
      rules.splice(ruleIdx, 1);
      logAppend(EVOLUTION_LOG, {
        ts:            new Date().toISOString(),
        event:         'deleted',
        rule_id:       ruleId,
        original_text: rule.text,
        run_date:      today,
      });
      deletedCount++;
      console.log(`[apply] DELETED ${ruleId}`);
    }
  }

  // Atomic write: temp file + rename
  const tempFile = RULES_FILE + '.tmp.' + Date.now();
  fs.writeFileSync(tempFile, JSON.stringify(rules, null, 2) + '\n');
  fs.renameSync(tempFile, RULES_FILE);

  console.log(`[apply] Done. Improved: ${improvedCount}, Deleted: ${deletedCount}, Skipped: ${skippedCount}`);

  // Archive proposals file
  ensureDir(ARCHIVE_DIR);
  const archiveName = `proposals-${today}.md`;
  const archivePath = path.join(ARCHIVE_DIR, archiveName);
  fs.copyFileSync(PROPOSALS_FILE, archivePath);
  console.log(`[apply] Archived proposals → ${archivePath}`);

  logEvent('apply_complete', { improved: improvedCount, deleted: deletedCount, skipped: skippedCount });
}

function logAppend(filepath, obj) {
  ensureDir(path.dirname(filepath));
  fs.appendFileSync(filepath, JSON.stringify(obj) + '\n');
}

// ── Main entry point ──────────────────────────────────────────────────────────

function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);

  // --apply mode: separate code path, only mutates files
  if (APPLY) {
    console.log('[mode] apply');
    applyProposals();
    return;
  }

  // Check 25-day lock (skipped in --dry-run and --force)
  if (checkLock() && !DRY_RUN) {
    const lastRun  = new Date(fs.readFileSync(LOCK_FILE, 'utf8').trim());
    const daysSince = ((Date.now() - lastRun.getTime()) / 86_400_000).toFixed(1);
    logEvent('skip', { reason: 'last run < 25 days ago', days_since: daysSince });
    console.log(`[SKIP] Last run was ${daysSince} days ago (< ${MIN_INTERVAL_DAYS}). Use --force to override.`);
    process.exit(0);
  }

  console.log(`[mode] ${DRY_RUN ? 'dry-run' : 'generate'}`);

  const startTs = Date.now();
  const rules   = loadRules();
  const { eligible, tooNew } = filterRules(rules);

  logEvent('run_start', {
    rules_total: rules.length,
    eligible:    eligible.length,
    too_new:     tooNew.length,
  });

  console.log(`[filter] Total rules: ${rules.length} | Eligible: ${eligible.length} | Too new: ${tooNew.length}`);

  if (DRY_RUN) {
    console.log('[DRY RUN] Eligible rules that would be evolved:');
    eligible.forEach(r => console.log(`  - ${r.id}: confidence=${r.confidence}, needsEvolution=${r.needsEvolution || false}, created=${r.created}`));
    console.log('[DRY RUN] Too new (would be skipped):');
    tooNew.forEach(r => console.log(`  - ${r.id}: created=${r.created}`));

    const results = runEvolution(eligible, true);
    const proposalsContent = buildProposalsContent(results, tooNew, runId);
    console.log('[DRY RUN] Would write evolution-proposals.md:');
    console.log('---');
    console.log(proposalsContent);
    console.log('---');
    console.log('[DRY RUN] No files written.');
    return;
  }

  if (eligible.length === 0) {
    console.log('[INFO] No eligible rules for evolution this cycle.');
    const proposalsContent = buildProposalsContent([], tooNew, runId);
    ensureDir(path.dirname(PROPOSALS_FILE));
    fs.writeFileSync(PROPOSALS_FILE, proposalsContent);
    writeLock();
    logEvent('run_complete', { duration_sec: ((Date.now() - startTs) / 1000).toFixed(1), proposals: 0 });
    return;
  }

  const results = runEvolution(eligible, false);

  const proposalsContent = buildProposalsContent(results, tooNew, runId);
  ensureDir(path.dirname(PROPOSALS_FILE));
  fs.writeFileSync(PROPOSALS_FILE, proposalsContent);

  const improves = results.filter(r => r.verdict.verdict === 'improve').length;
  const deletes  = results.filter(r => r.verdict.verdict === 'delete').length;
  logEvent('proposals_written', {
    path:      PROPOSALS_FILE,
    proposals: results.length,
    improve:   improves,
    delete:    deletes,
  });

  writeLock();

  const duration = ((Date.now() - startTs) / 1000).toFixed(1);
  logEvent('run_complete', { duration_sec: duration, proposals: results.length });

  console.log(`\n[done] Proposals written to ${PROPOSALS_FILE}`);
  console.log(`[done] Review and change \`Approved: no\` to \`Approved: yes\` for items you want to apply, then run:`);
  console.log(`[done]   node ${__filename} --apply`);
}

try {
  main();
} catch (err) {
  console.error('[FATAL]', err);
  process.exit(1);
}
