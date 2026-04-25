#!/usr/bin/env node
// rule-verifier.js — Rule effectiveness verifier
// Runs before rule-evolver.js. Zero external deps. Node 18+.
//
// Usage:
//   node ~/.claude/helpers/rule-verifier.js           # verify all rules, update rules.json
//   node ~/.claude/helpers/rule-verifier.js --dry-run # preview, no writes

'use strict';

const fs   = require('fs');
const path = require('path');
const rl   = require('readline');

// ─── Constants ────────────────────────────────────────────────────────────────

const HOME          = process.env.HOME || '__HOME__';
const LEARNING_DIR  = path.join(HOME, '.claude', 'learning');
const RULES_FILE    = path.join(LEARNING_DIR, 'rules.json');
const SESSIONS_DIR  = path.join(LEARNING_DIR, 'sessions');
const REPORT_DIR    = LEARNING_DIR;

const COLD_START_DAYS  = 30;
const MIN_GROUP_SIZE   = 5;
const EFFECTIVE_THRESH = 0.50; // >50% relative drop = effective

// ─── Stop-word list ───────────────────────────────────────────────────────────
// Words appearing in >30% of rule texts contribute no signal — excluded.

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','if','then','when','while','for',
  'to','of','in','on','at','by','with','from','this','that','these',
  'those','is','are','was','were','be','been','being','have','has',
  'had','do','does','did','will','would','could','should','may','might',
  'must','can','not','no','never','always','every','all','any','each',
  'it','its','i','you','we','they','he','she','my','your','our','their',
  'use','run','make','get','set','add','put','keep','call','read','write',
  'check','before','after','only','also','just','very','more','less',
  'than','as','so','into','out','up','down','new','old','same','other',
  'rule','rules','session','sessions','file','files','code','output',
]);

// ─── Keyword extraction ───────────────────────────────────────────────────────

/**
 * Extract 2-3 discriminative keywords from rule text.
 * Pure regex/string ops — no LLM.
 *
 * Algorithm:
 * 1. Normalise: lowercase, strip punctuation except hyphens
 * 2. Tokenise on whitespace
 * 3. Filter: length >= 4 AND not in STOP_WORDS
 * 4. Score by within-rule term frequency, tie-break by token length desc
 * 5. Return top 3
 *
 * Edge case: if no candidates survive step 3, fall back to the two longest
 * raw tokens (ignoring stop-word constraint). Caller logs a warn.
 */
function extractKeywords(text) {
  const normalised = text.toLowerCase().replace(/[^a-z0-9\-\s]/g, ' ');
  const tokens = normalised.split(/\s+/).filter(Boolean);
  const candidates = tokens.filter(t => t.length >= 4 && !STOP_WORDS.has(t));

  if (candidates.length === 0) {
    // Fallback: two longest raw tokens
    const sorted = tokens.slice().sort((a, b) => b.length - a.length);
    return sorted.slice(0, 2);
  }

  const freq = {};
  for (const t of candidates) freq[t] = (freq[t] || 0) + 1;

  // Primary sort: freq desc. Tie-break: length desc (more specific first).
  const sorted = Object.keys(freq).sort((a, b) => {
    const d = freq[b] - freq[a];
    return d !== 0 ? d : b.length - a.length;
  });

  return sorted.slice(0, 3);
}

/**
 * Return keywords for a rule object, preferring trigger.nl when it yields ≥2.
 */
function keywordsForRule(rule) {
  if (rule.trigger && rule.trigger.nl) {
    const kw = extractKeywords(rule.trigger.nl);
    if (kw.length >= 2) return kw;
    // Supplement from rule text until we have 3
    const extra = extractKeywords(rule.rule || '');
    return [...new Set([...kw, ...extra])].slice(0, 3);
  }
  return extractKeywords(rule.rule || '');
}

// ─── isMetaSession ────────────────────────────────────────────────────────────
// Mirrors dream-worker.js logic. Skips dream-worker self-call sessions.

function isMetaSession(event) {
  return (event.agents_run || []).includes('dream-worker')
      && (event.human_messages || []).length === 0;
}

// ─── Date index ───────────────────────────────────────────────────────────────
// Built once at startup: Map<"YYYY-MM-DD", string[]>
// Uses session `ts` field when available (evaluator note).
// Falls back to file mtime when `ts` is absent.

/**
 * Peek at the first line of a JSONL file and return the `ts` date string,
 * or null if unavailable / parse fails.
 */
function readSessionDate(fpath) {
  try {
    // Read only the first line — minimal I/O.
    const fd = fs.openSync(fpath, 'r');
    const buf = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    const firstLine = buf.slice(0, bytesRead).toString('utf8').split('\n')[0];
    const event = JSON.parse(firstLine);
    if (event.ts) {
      const d = new Date(event.ts);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  } catch (_) {}
  return null;
}

/**
 * Build date index. Prefers `ts` from first JSONL line; falls back to mtime.
 * Returns Map<"YYYY-MM-DD", string[]>.
 * O(N) stat + minimal reads — no full file accumulation.
 */
function buildDateIndex(sessionsDir) {
  const index = new Map();
  let files;
  try { files = fs.readdirSync(sessionsDir); }
  catch { return index; } // sessions dir missing → empty index

  for (const fname of files) {
    if (!fname.endsWith('.jsonl')) continue;
    const fpath = path.join(sessionsDir, fname);

    let dateKey = readSessionDate(fpath);
    if (!dateKey) {
      // Fallback: mtime
      try {
        const mtime = fs.statSync(fpath).mtime;
        dateKey = mtime.toISOString().slice(0, 10);
      } catch { continue; }
    }

    if (!index.has(dateKey)) index.set(dateKey, []);
    index.get(dateKey).push(fpath);
  }

  return index;
}

/**
 * Split session paths into pre/post groups relative to ruleCreatedDate.
 * Sessions on the exact creation date are excluded (ambiguous).
 */
function getSessionPaths(index, ruleCreatedDate) {
  const allDates = [...index.keys()].sort();
  const pre = [];
  const post = [];
  for (const d of allDates) {
    if (d < ruleCreatedDate)      pre.push(...index.get(d));
    else if (d > ruleCreatedDate) post.push(...index.get(d));
    // exact date excluded
  }
  return { pre, post };
}

// ─── Streaming scan ───────────────────────────────────────────────────────────
// Never accumulates raw file contents. One file in memory at a time.

/**
 * Scan a single JSONL file for keyword hits and failure outcomes.
 *
 * Match logic:
 * - AND: all keywords must appear in human_messages (AND for 2-3 keywords).
 * - Lines with missing `outcome` default to 'unknown' (conservative: not a failure).
 *
 * Returns { matched: number, failures: number }.
 */
function scanFile(filePath, keywords) {
  return new Promise((resolve) => {
    let matched  = 0;
    let failures = 0;

    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    stream.on('error', () => resolve({ matched, failures }));

    const iface = rl.createInterface({ input: stream, crlfDelay: Infinity });

    iface.on('line', (line) => {
      if (!line.trim()) return;

      let event;
      try { event = JSON.parse(line); } catch { return; }

      if (isMetaSession(event)) return;

      const humanText = (event.human_messages || []).join(' ').toLowerCase();

      // AND match: every keyword must appear. Trivially satisfied for 1 keyword.
      const hit = keywords.every(k => humanText.includes(k));
      if (!hit) return;

      matched++;

      // Gracefully handle missing outcome: treat as 'unknown', not a failure.
      const outcome = event.outcome || 'unknown';
      if (outcome === 'failure') failures++;
    });

    iface.on('close', () => resolve({ matched, failures }));
  });
}

/**
 * Scan a list of files sequentially — only one file in memory at a time.
 * Returns { totalMatched, totalFailures }.
 */
async function scanGroup(filePaths, keywords) {
  let totalMatched  = 0;
  let totalFailures = 0;

  for (const fp of filePaths) {
    const { matched, failures } = await scanFile(fp, keywords);
    totalMatched  += matched;
    totalFailures += failures;
    // fp's stream is closed and GC-eligible here
  }

  return { totalMatched, totalFailures };
}

// ─── Confidence updates ───────────────────────────────────────────────────────

/**
 * Apply case logic (spec §4) and mutate rule in place.
 *
 * Case priority:
 * 1. Too new    → caller handles (early continue before reaching here)
 * 2. Insufficient data (<5 matched in either group)
 * 3. Effective  (>50% relative drop)
 * 4. Ineffective (rate unchanged or rose)
 * 5. Ambiguous  (0 < drop ≤ 50%) — no confidence change
 *
 * Returns { category, ratePre, ratePost, rateDrop, note }.
 */
function updateRule(rule, pre, post, today) {
  const ratePre  = pre.totalMatched  > 0 ? pre.totalFailures  / pre.totalMatched  : null;
  const ratePost = post.totalMatched > 0 ? post.totalFailures / post.totalMatched : null;

  // Case 3: insufficient data
  if (pre.totalMatched < MIN_GROUP_SIZE || post.totalMatched < MIN_GROUP_SIZE) {
    rule.insufficient_data = true;
    rule.lastVerified = today;
    rule.verificationNote =
      `insufficient_data: pre=${pre.totalMatched} post=${post.totalMatched}`;
    return {
      category: 'insufficient',
      ratePre, ratePost, rateDrop: null,
      note: rule.verificationNote,
    };
  }

  // Compute relative drop.
  // Special case: if pre=0 failures (ratePre===0), the rule was already working perfectly.
  // Treat as 100% drop if post is also 0, else 0% (no improvement from 0%).
  let rateDrop;
  if (ratePre === 0) {
    rateDrop = (ratePost === 0) ? 1.0 : 0.0;
  } else {
    rateDrop = (ratePre - ratePost) / ratePre;
  }

  // Case 4: effective
  if (rateDrop > EFFECTIVE_THRESH) {
    rule.confidence = Math.min(10, rule.confidence + 1);
    rule.lastVerified = today;
    rule.verificationNote = `proven_effective: ${(rateDrop * 100).toFixed(0)}% drop`;
    return { category: 'effective', ratePre, ratePost, rateDrop, note: rule.verificationNote };
  }

  // Case 5: ineffective (rate unchanged or rose — rateDrop <= 0)
  if (rateDrop <= 0.0) {
    rule.confidence = Math.max(1, rule.confidence - 1);
    rule.needsEvolution = true;
    rule.lastVerified = today;
    rule.verificationNote =
      `ineffective: rate ${(ratePre * 100).toFixed(1)}% → ${(ratePost * 100).toFixed(1)}%`;
    return { category: 'ineffective', ratePre, ratePost, rateDrop, note: rule.verificationNote };
  }

  // Case 6: ambiguous (0 < drop ≤ 50%) — no confidence change, no flag
  rule.lastVerified = today;
  rule.verificationNote =
    `ambiguous: ${(rateDrop * 100).toFixed(0)}% drop (threshold 50%)`;
  return { category: 'ambiguous', ratePre, ratePost, rateDrop, note: rule.verificationNote };
}

// ─── Report builder ───────────────────────────────────────────────────────────

function pct(v) {
  return v !== null && v !== undefined ? `${(v * 100).toFixed(0)}%` : 'n/a';
}

function snippet(text, max = 50) {
  if (!text) return '(no rule text)';
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

/**
 * Build the markdown verification report.
 * All four sections always present; empty sections use *(none)* placeholders.
 */
function buildReport(results, today) {
  const effective    = results.filter(r => r.category === 'effective');
  const ineffective  = results.filter(r => r.category === 'ineffective');
  const insufficient = results.filter(r => r.category === 'insufficient' || r.category === 'too_new');
  const ambiguous    = results.filter(r => r.category === 'ambiguous');

  let md = `# Rule Verification Report — ${today}\n\n`;

  // ── Effective ──────────────────────────────────────────────────────────────
  md += `## Effective (confidence increased)\n`;
  md += `| Rule | Before | After | Δ |\n`;
  md += `|------|--------|-------|---|\n`;
  for (const r of effective) {
    const drop = r.rateDrop !== null ? `-${pct(r.rateDrop)}` : 'n/a';
    md += `| "${snippet(r.ruleText)}" | ${pct(r.ratePre)}/matched | ${pct(r.ratePost)}/matched | ${drop} |\n`;
  }
  if (effective.length === 0) md += `| *(none)* | — | — | — |\n`;
  md += '\n';

  // ── Ineffective ───────────────────────────────────────────────────────────
  md += `## Ineffective (needs evolution)\n`;
  md += `| Rule | Evidence | Action |\n`;
  md += `|------|----------|--------|\n`;
  for (const r of ineffective) {
    md += `| "${snippet(r.ruleText)}" | ${r.note} | Flagged for evolution |\n`;
  }
  if (ineffective.length === 0) md += `| *(none)* | — | — |\n`;
  md += '\n';

  // ── Insufficient data (too-new + low-match + ambiguous) ───────────────────
  md += `## Insufficient data\n`;
  for (const r of insufficient) {
    md += `- "${snippet(r.ruleText, 60)}" (${r.note})\n`;
  }
  for (const r of ambiguous) {
    md += `- "${snippet(r.ruleText, 60)}" (${r.note} — no confidence change)\n`;
  }
  if (insufficient.length === 0 && ambiguous.length === 0) md += `*(none)*\n`;
  md += '\n';

  // ── Summary ───────────────────────────────────────────────────────────────
  const insuffTotal = insufficient.length + ambiguous.length;
  md += `## Summary\n`;
  md += `- ${effective.length} rule${effective.length !== 1 ? 's' : ''} proven effective (+confidence)\n`;
  md += `- ${ineffective.length} rule${ineffective.length !== 1 ? 's' : ''} flagged for evolution\n`;
  md += `- ${insuffTotal} rule${insuffTotal !== 1 ? 's' : ''} insufficient data (too new or too few matches)\n`;

  return md;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run the full verification pass.
 *
 * @param {object} opts
 * @param {boolean} opts.dryRun - Skip rules.json write when true. Report is always written.
 * @returns {{ rules: object[], results: object[], reportPath: string }}
 */
async function verifyRules({ dryRun = false } = {}) {
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  // Load rules
  let rules;
  try {
    rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read rules.json: ${err.message}`);
  }

  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error('rules.json is empty or not an array');
  }

  // Build date index once — O(N) reads of first 512 bytes, no full accumulation
  console.log('[rule-verifier] building session date index…');
  const dateIndex = buildDateIndex(SESSIONS_DIR);
  const totalFiles = [...dateIndex.values()].flat().length;
  console.log(`[rule-verifier] indexed ${totalFiles} session files across ${dateIndex.size} dates`);

  if (totalFiles === 0) {
    console.warn('[rule-verifier] warn: no session files found — all rules will be insufficient_data');
  }

  const results = [];
  let rulesProcessed = 0;

  for (const rule of rules) {
    // Skip disabled rules without touching them
    if (rule.disabled === true) {
      results.push({
        category: 'insufficient',
        ruleText: rule.rule || '',
        ratePre: null, ratePost: null, rateDrop: null,
        note: 'rule is disabled',
      });
      continue;
    }

    // Case 1: too new — skip entirely, no mutations to the rule object
    const createdDate = rule.created || '';
    const daysSinceCreated = createdDate
      ? (Date.now() - new Date(createdDate).getTime()) / 86400000
      : Infinity; // no created date → treat as old (don't skip)

    if (createdDate && daysSinceCreated < COLD_START_DAYS) {
      results.push({
        category: 'too_new',
        ruleText: rule.rule || '',
        ratePre: null, ratePost: null, rateDrop: null,
        note: `created ${createdDate} (${Math.floor(daysSinceCreated)} days ago, <30 days)`,
      });
      continue;
    }

    // Extract keywords — pure local logic
    const keywords = keywordsForRule(rule);
    if (keywords.length === 0) {
      // Fallback exhausted — no signal possible
      results.push({
        category: 'insufficient',
        ruleText: rule.rule || '',
        ratePre: null, ratePost: null, rateDrop: null,
        note: 'no keywords extracted from rule text',
      });
      console.warn(`[rule-verifier] warn: keyword_fallback for rule ${rule.id}`);
      continue;
    }

    const ruleCreatedDate = createdDate || '1970-01-01';
    const { pre: prePaths, post: postPaths } = getSessionPaths(dateIndex, ruleCreatedDate);

    // Sequential scan — one file in memory at a time
    const pre  = await scanGroup(prePaths,  keywords);
    const post = await scanGroup(postPaths, keywords);

    const outcome = updateRule(rule, pre, post, today);

    results.push({
      ...outcome,
      ruleText: rule.rule || '',
    });

    rulesProcessed++;
  }

  console.log(`[rule-verifier] processed ${rulesProcessed} eligible rules (${rules.length} total)`);

  // Write mutated rules.json (unless dry-run)
  if (!dryRun) {
    fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2), 'utf8');
    console.log(`[rule-verifier] rules.json updated`);
  } else {
    console.log(`[rule-verifier] dry-run: rules.json NOT written`);
  }

  // Write verification report — always written (even in dry-run, useful for review)
  const dateStamp = today.replace(/-/g, ''); // "YYYYMMDD"
  const reportPath = path.join(REPORT_DIR, `verification-report-${dateStamp}.md`);
  const reportContent = buildReport(results, today);
  fs.writeFileSync(reportPath, reportContent, 'utf8');
  console.log(`[rule-verifier] report written to ${reportPath}`);

  return {
    rules,       // mutated array (same objects, modified in place)
    results,     // per-rule outcome records
    reportPath,
  };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) {
    console.log('[rule-verifier] dry-run mode — rules.json will NOT be modified');
  }

  verifyRules({ dryRun })
    .then(({ results, reportPath }) => {
      const effective   = results.filter(r => r.category === 'effective').length;
      const ineffective = results.filter(r => r.category === 'ineffective').length;
      const tooNew      = results.filter(r => r.category === 'too_new').length;
      const insuff      = results.filter(r => r.category === 'insufficient').length;
      const ambiguous   = results.filter(r => r.category === 'ambiguous').length;

      console.log(`[rule-verifier] done`);
      console.log(`  effective:    ${effective}`);
      console.log(`  ineffective:  ${ineffective}`);
      console.log(`  ambiguous:    ${ambiguous}`);
      console.log(`  insufficient: ${insuff}`);
      console.log(`  too new:      ${tooNew}`);
      console.log(`  report:       ${reportPath}`);
    })
    .catch(err => {
      console.error('[rule-verifier] error:', err.message);
      process.exit(1);
    });
}

module.exports = { verifyRules };
