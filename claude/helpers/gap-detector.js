#!/usr/bin/env node
// gap-detector.js — Finds uncovered failure patterns in session history
// Runs after rule-verifier.js (03:00), before rule-evolver.js (05:00).
// Zero external deps. Memory-efficient: readline, not readFileSync, for sessions.
//
// Usage:
//   node ~/.claude/helpers/gap-detector.js           # full run
//   node ~/.claude/helpers/gap-detector.js --dry-run # skip file writes

'use strict';

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const os       = require('os');
const { spawnSync } = require('child_process');

// ─── Constants ────────────────────────────────────────────────────────────────

const HOME         = process.env.HOME || '__HOME__';
const LEARNING_DIR = path.join(HOME, '.claude', 'learning');
const SESSIONS_DIR = path.join(LEARNING_DIR, 'sessions');
const RULES_PATH   = path.join(LEARNING_DIR, 'rules.json');
const DRAFT_RULES  = path.join(LEARNING_DIR, 'draft-rules.md');
const CLAUDE_BIN   = path.join(HOME, '.nvm', 'versions', 'node', 'v24.15.0', 'bin', 'claude');

const SIX_MONTHS_MS  = 6 * 30 * 24 * 60 * 60 * 1000;
const SIX_MONTHS_AGO = Date.now() - SIX_MONTHS_MS;

const MIN_NGRAM_FREQ   = 3;   // n-gram must appear ≥ 3 times across sessions
const CLUSTER_JACCARD  = 0.5; // merge threshold for similar grams
const COVERAGE_JACCARD = 0.2; // rule covers cluster when score ≥ this
const GAP_MIN_FREQ     = 5;   // uncovered cluster must have freq ≥ 5 to be a gap
const TOP_CLUSTERS     = 20;  // keep top N clusters by accumulated frequency
const DRAFT_CONFIDENCE = 7;   // minimum Haiku confidence to write draft rule

// Patterns that identify meta/system sessions (dream-worker, rule-verifier, etc.)
const META_PATTERNS = [
  'Read the session transcript at',
  'Write a concise session summary',
  'dream-worker',
  'bulk-dream',
  'rule-evolver',
  'rule-verifier',
  'gap-detector',
  'Analyze these',
  'learning/sessions',
  'Run GAN loop',
  'run gan loop',
  'Summarize this task in',
  'You are a JSON generator',
  'You are scoring the relevance',
  'Output ONLY valid JSON',
];

// Tokens excluded from n-gram building. Two categories:
//   1. English stopwords — high-frequency function words with no discriminative signal
//   2. Structural noise — filesystem path components, system context words that appear
//      frequently because session prompts embed absolute paths and system templates.
const NOISE_TOKENS = new Set([
  // English stopwords (subset from rule-verifier.js STOP_WORDS, extended)
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were',
  'been', 'have', 'has', 'had', 'not', 'but', 'its', 'all', 'any', 'each',
  'will', 'can', 'may', 'should', 'would', 'could', 'must', 'shall',
  'into', 'out', 'also', 'more', 'then', 'than', 'when', 'where', 'how',
  'what', 'which', 'who', 'they', 'their', 'your', 'our', 'his', 'her',
  'there', 'here', 'only', 'just', 'very', 'about', 'after', 'before',
  'always', 'never', 'every', 'make', 'use', 'used', 'using', 'get',
  'set', 'run', 'call', 'add', 'see', 'take', 'check', 'read', 'write',
  // Common prompt template words with no discriminative value
  'the', 'user', 'output', 'file', 'tool', 'task', 'code', 'rule', 'rules',
  'session', 'model', 'prompt', 'result', 'data', 'type', 'value', 'list',
  'local', 'command', 'new', 'current', 'last', 'first', 'next', 'same',
  // Filesystem/path structural noise
  'users', '__USERNAME__', 'claude', 'tools', 'helpers', 'learning',
  'sessions', 'agents', 'skills', 'plugins', 'home', 'desktop', 'labirynt',
  'projects', 'library', 'config', 'tmp', 'working', 'directory', 'briefs',
  // JSON / system context tokens
  'true', 'false', 'null', 'none', 'undefined', 'json', 'text', 'format',
  'context', 'version', 'path', 'name', 'mode', 'status', 'error', 'warning',
]);

// ─── Session filtering ────────────────────────────────────────────────────────

/**
 * Returns true when the session entry represents a meta/system invocation
 * rather than a real user interaction. Mirrors rule-verifier.js and dream-worker.js.
 */
function isMetaSession(entry) {
  const first = Array.isArray(entry.human_messages)
    ? (entry.human_messages[0] || '')
    : (entry.human_messages || '');
  return META_PATTERNS.some(p => first.includes(p));
}

/**
 * Derive session timestamp from entry or fallback to filename date.
 * Sessions use `ts` field (ISO string) or filename prefix "YYYY-MM-DD-*".
 */
function sessionTimestamp(entry, filename) {
  if (entry.ts) {
    const t = new Date(entry.ts).getTime();
    if (!isNaN(t)) return t;
  }
  // Filename may encode date as prefix "YYYYMMDD" or not at all — fallback to now-safe 0
  const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    const t = new Date(dateMatch[1]).getTime();
    if (!isNaN(t)) return t;
  }
  return 0; // unknown date — include it (conservative)
}

/**
 * Determine if a session counts as a "failure" session.
 *
 * Reality check: current sessions have no `outcome` field (all undefined).
 * Strategy: treat ALL non-meta sessions as candidates for n-gram extraction.
 * When the `outcome` field is present (future data), filter to 'failure' only.
 * This ensures the tool works with current data and becomes more precise over time.
 */
function isFailureSession(entry) {
  const outcome = entry.outcome;
  if (outcome === undefined || outcome === null) return true; // no outcome → include all
  return outcome === 'failure';
}

// ─── Session streaming ────────────────────────────────────────────────────────

/**
 * Stream all qualifying sessions from SESSIONS_DIR.
 * Qualifying = not meta, not success-only (per isFailureSession), within 6-month window.
 * callback receives the parsed entry object for each qualifying session line.
 *
 * Memory model: one line in memory at a time. ReadStream is closed between files.
 */
async function streamSessions(callback) {
  let files;
  try {
    files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
  } catch (err) {
    console.warn(`[gap-detector] Sessions directory not found or unreadable: ${SESSIONS_DIR}`);
    return;
  }

  for (const filename of files) {
    const filePath = path.join(SESSIONS_DIR, filename);
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    await new Promise((resolve) => {
      let firstEntryTs = null;
      let fileIsMetaFromFirstLine = false;

      rl.on('line', (line) => {
        if (!line.trim()) return;

        let entry;
        try { entry = JSON.parse(line); } catch { return; }

        // Use first line to classify file-level meta and get timestamp
        if (firstEntryTs === null) {
          firstEntryTs = sessionTimestamp(entry, filename);
          fileIsMetaFromFirstLine = isMetaSession(entry);
        }

        // Skip entire file if first line is meta (e.g. dream-worker sessions)
        if (fileIsMetaFromFirstLine) {
          rl.close();
          return;
        }

        // Six-month date filter (use first-line timestamp as proxy for whole file)
        if (firstEntryTs !== 0 && firstEntryTs < SIX_MONTHS_AGO) {
          rl.close();
          return;
        }

        // Per-line meta and outcome filters
        if (isMetaSession(entry)) return;
        if (!isFailureSession(entry)) return;

        callback(entry);
      });

      rl.on('close', resolve);
      rl.on('error', resolve); // ignore unreadable files
    });
  }
}

// ─── N-gram extraction ────────────────────────────────────────────────────────

/**
 * Tokenise text: lowercase, strip non-alphanumeric, split, drop single chars
 * and structural noise tokens (filesystem paths, usernames, etc.).
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !NOISE_TOKENS.has(t));
}

/**
 * Generate n-grams of length n from a token array.
 */
function extractNgrams(tokens, n) {
  const grams = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    grams.push(tokens.slice(i, i + n).join(' '));
  }
  return grams;
}

/**
 * Build a frequency map of 2-grams and 3-grams from all qualifying sessions.
 * Entries appearing fewer than MIN_NGRAM_FREQ times are pruned.
 * Returns Map<string, number>.
 */
async function buildNgramFrequencyMap() {
  const freq = new Map();

  await streamSessions((entry) => {
    const messages = Array.isArray(entry.human_messages)
      ? entry.human_messages
      : [entry.human_messages || ''];

    for (const msg of messages) {
      if (typeof msg !== 'string' || !msg.trim()) continue;

      // Strip all XML-tagged system blocks from the message text.
      // Hooks inject <local-command-caveat>, <task-notification>, <command-name>,
      // <task-result>, <agent-result>, etc. — none of these are user-authored.
      // A message that is ONLY such tags (after stripping) is skipped entirely.
      const stripped = msg.replace(/<[a-z][a-z0-9-]*>[\s\S]*?<\/[a-z][a-z0-9-]*>/gi, '').trim();
      if (!stripped) continue;

      // Skip very short residual text — no meaningful n-gram signal
      if (stripped.length < 20) continue;

      const tokens = tokenize(stripped);
      // Require at least 2 non-noise tokens before extracting grams
      if (tokens.length < 2) continue;
      const grams  = [...extractNgrams(tokens, 2), ...extractNgrams(tokens, 3)];
      for (const gram of grams) {
        freq.set(gram, (freq.get(gram) || 0) + 1);
      }
    }
  });

  // Prune below minimum frequency
  for (const [gram, count] of freq) {
    if (count < MIN_NGRAM_FREQ) freq.delete(gram);
  }

  return freq;
}

// ─── Clustering ───────────────────────────────────────────────────────────────

/**
 * Jaccard similarity on token sets of two gram strings.
 */
function jaccardSimilarity(gramA, gramB) {
  const setA = new Set(gramA.split(' '));
  const setB = new Set(gramB.split(' '));
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Greedy cluster: merge grams with Jaccard >= CLUSTER_JACCARD.
 * Sorted by frequency descending so the most common gram becomes the representative.
 * Returns top TOP_CLUSTERS clusters by accumulated frequency.
 *
 * @typedef {{ representative: string, freq: number, members: string[] }} Cluster
 * @returns {Cluster[]}
 */
function clusterGrams(freq) {
  const sorted   = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const clusters = [];
  const assigned = new Set();

  for (const [gram, count] of sorted) {
    if (assigned.has(gram)) continue;

    const cluster = { representative: gram, freq: count, members: [gram] };
    assigned.add(gram);

    for (const [other, otherCount] of sorted) {
      if (assigned.has(other)) continue;
      if (jaccardSimilarity(gram, other) >= CLUSTER_JACCARD) {
        cluster.members.push(other);
        cluster.freq += otherCount;
        assigned.add(other);
      }
    }

    clusters.push(cluster);
  }

  return clusters
    .sort((a, b) => b.freq - a.freq)
    .slice(0, TOP_CLUSTERS);
}

// ─── Coverage check ───────────────────────────────────────────────────────────

/**
 * For each cluster, find the best-matching rule in rules.json.
 * Coverage levels:
 *   'covered'   — best Jaccard >= COVERAGE_JACCARD
 *   'partial'   — at least one token overlap but below threshold
 *   'uncovered' — no overlap at all
 *
 * @typedef {Cluster & { coverage: string, bestScore: number, bestRule: string|null }} CoveredCluster
 * @returns {CoveredCluster[]}
 */
function computeCoverage(clusters) {
  let rules;
  try {
    rules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
  } catch (err) {
    console.warn(`[gap-detector] Cannot read rules.json: ${err.message}`);
    rules = [];
  }

  if (!Array.isArray(rules)) rules = [];

  return clusters.map((cluster) => {
    const patternTokens = new Set(cluster.representative.split(' '));

    let bestScore = 0;
    let bestRule  = null;

    for (const rule of rules) {
      if (rule.disabled === true) continue;

      // Build rule text corpus: rule text + trigger NL + tags
      const ruleText = [
        rule.rule || rule.rule_text || '',
        (rule.trigger && rule.trigger.nl) ? rule.trigger.nl : '',
        ...(Array.isArray(rule.tags) ? rule.tags : []),
      ].join(' ');

      const ruleTokens = new Set(tokenize(ruleText));

      let intersection = 0;
      for (const t of patternTokens) if (ruleTokens.has(t)) intersection++;
      const union = patternTokens.size + ruleTokens.size - intersection;
      const jaccard = union === 0 ? 0 : intersection / union;

      if (jaccard > bestScore) {
        bestScore = jaccard;
        bestRule  = rule.rule || rule.rule_text || null;
      }
    }

    let coverage;
    if (bestScore >= COVERAGE_JACCARD) {
      coverage = 'covered';
    } else if (bestScore > 0) {
      coverage = 'partial';
    } else {
      coverage = 'uncovered';
    }

    return { ...cluster, coverage, bestScore, bestRule };
  });
}

/**
 * Extract gaps: uncovered or partial clusters with freq >= GAP_MIN_FREQ.
 */
function extractGaps(coveredClusters) {
  return coveredClusters.filter(c => c.coverage !== 'covered' && c.freq >= GAP_MIN_FREQ);
}

// ─── Haiku rule generation ────────────────────────────────────────────────────

/**
 * Call Claude Haiku once per gap to generate a suggested rule.
 * Uses spawnSync (matches dream-worker.js pattern) with 30s timeout.
 * Returns the gap array with a `suggestion` field added to each entry.
 */
function generateSuggestedRules(gaps, dryRun) {
  const results = [];

  for (const gap of gaps) {
    const prompt = [
      `Given this recurring failure pattern: "${gap.representative}"`,
      `Occurring ${gap.freq} times in the last 6 months.`,
      `Existing partial rule (if any): "${gap.bestRule || 'none'}"`,
      '',
      'Write a one-sentence rule that a developer should follow to prevent this failure.',
      'Return ONLY valid JSON: { "rule_text": "<string>", "confidence": <integer 1-10> }',
    ].join('\n');

    let suggestion = { rule_text: '(generation skipped)', confidence: 0 };

    if (dryRun) {
      suggestion = { rule_text: '(dry-run: Haiku not called)', confidence: 0 };
    } else {
      try {
        const result = spawnSync(
          CLAUDE_BIN,
          ['-p', prompt, '--model', 'claude-haiku-4-5-20251001', '--output-format', 'text'],
          { encoding: 'utf8', timeout: 30_000 }
        );

        if (result.status === 0 && result.stdout) {
          const jsonMatch = result.stdout.match(/\{[\s\S]*?\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (typeof parsed.rule_text === 'string' && typeof parsed.confidence === 'number') {
              suggestion = parsed;
            }
          }
        } else if (result.stderr) {
          console.warn(`[gap-detector] Haiku stderr for "${gap.representative}": ${result.stderr.slice(0, 200)}`);
        }
      } catch (err) {
        console.warn(`[gap-detector] Haiku call failed for "${gap.representative}": ${err.message}`);
      }
    }

    results.push({ ...gap, suggestion });
  }

  return results;
}

// ─── Report writing ───────────────────────────────────────────────────────────

/**
 * Build date stamp "YYYYMMDD" from today's date.
 */
function dateStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Truncate a string to max characters, appending ellipsis if needed.
 */
function trunc(str, max = 60) {
  if (!str) return '(none)';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/**
 * Write gap-report-YYYYMMDD.md to LEARNING_DIR.
 */
function writeReport(coveredClusters, gaps, gapsWithSuggestions, dryRun) {
  const stamp = dateStamp();
  const reportPath = path.join(LEARNING_DIR, `gap-report-${stamp}.md`);
  const now = new Date().toISOString();

  const lines = [
    `# Gap Report — ${stamp}`,
    '',
    `Generated: ${now}`,
    `Sessions scanned: 6-month window (non-meta, ${gapsWithSuggestions.length === 0 && gaps.length === 0 ? 'all' : 'FAILURE-filtered'})`,
    `Total clusters: ${coveredClusters.length} | Gaps (uncovered/partial, freq ≥ ${GAP_MIN_FREQ}): ${gaps.length}`,
    '',
    '## Uncovered Failure Patterns',
    '',
    '| Pattern | Frequency | Existing Rule | Suggested Rule |',
    '|---------|-----------|---------------|----------------|',
  ];

  if (gapsWithSuggestions.length === 0) {
    lines.push('| *(no gaps found)* | — | — | — |');
  } else {
    for (const g of gapsWithSuggestions) {
      const existing = g.bestRule
        ? `partial: "${trunc(g.bestRule, 40)}" (score ${g.bestScore.toFixed(2)})`
        : 'none';
      const suggested = `"${trunc(g.suggestion.rule_text, 80)}" (confidence: ${g.suggestion.confidence})`;
      const pattern = g.representative.replace(/\|/g, '\\|');
      lines.push(`| ${pattern} | ${g.freq} | ${existing} | ${suggested} |`);
    }
  }

  // Covered section
  const covered = coveredClusters.filter(c => c.coverage === 'covered');
  lines.push('', '## Covered Patterns (rule exists)', '', '| Pattern | Frequency | Covering Rule |', '|---------|-----------|---------------|');
  if (covered.length === 0) {
    lines.push('| *(none)* | — | — |');
  } else {
    for (const c of covered) {
      const ruleSnip = trunc(c.bestRule || '(unknown)', 60);
      const pattern = c.representative.replace(/\|/g, '\\|');
      lines.push(`| ${pattern} | ${c.freq} | "${ruleSnip}" (score ${c.bestScore.toFixed(2)}) |`);
    }
  }

  // Partial section (covered !== 'covered' but freq < GAP_MIN_FREQ — not urgent enough to be a gap)
  const partialLowFreq = coveredClusters.filter(c => c.coverage !== 'covered' && c.freq < GAP_MIN_FREQ);
  if (partialLowFreq.length > 0) {
    lines.push('', '## Partial Coverage (freq below gap threshold)', '', '| Pattern | Frequency | Best Match Score |', '|---------|-----------|-----------------|');
    for (const c of partialLowFreq) {
      const pattern = c.representative.replace(/\|/g, '\\|');
      lines.push(`| ${pattern} | ${c.freq} | ${c.bestScore.toFixed(2)} |`);
    }
  }

  const content = lines.join('\n') + '\n';

  if (dryRun) {
    console.log(`[gap-detector] dry-run: would write report to ${reportPath}`);
    console.log('[gap-detector] Report preview:');
    console.log(content.slice(0, 800));
  } else {
    fs.mkdirSync(LEARNING_DIR, { recursive: true });
    fs.writeFileSync(reportPath, content, 'utf8');
    console.log(`[gap-detector] Report written: ${reportPath}`);
  }

  return reportPath;
}

/**
 * Append high-confidence suggestions (>= DRAFT_CONFIDENCE) to draft-rules.md.
 * Never modifies rules.json directly — human promotion only.
 */
function writeDraftRules(gapsWithSuggestions, dryRun) {
  const highConfidence = gapsWithSuggestions.filter(
    g => g.suggestion.confidence >= DRAFT_CONFIDENCE
  );

  if (highConfidence.length === 0) {
    console.log('[gap-detector] No high-confidence suggestions to draft.');
    return;
  }

  const now = new Date().toISOString();
  const block = [
    `\n## Auto-drafted ${now}\n`,
    ...highConfidence.map(g => [
      `### Pattern: "${g.representative}" (freq: ${g.freq})`,
      `**Suggested rule:** ${g.suggestion.rule_text}`,
      `**Confidence:** ${g.suggestion.confidence}/10`,
      `**Status:** PENDING — promote manually to rules.json after review`,
      '',
    ].join('\n')),
  ].join('\n');

  if (dryRun) {
    console.log(`[gap-detector] dry-run: would append ${highConfidence.length} rule(s) to ${DRAFT_RULES}`);
    return;
  }

  fs.mkdirSync(LEARNING_DIR, { recursive: true });

  // Ensure file has a header if it doesn't exist yet
  if (!fs.existsSync(DRAFT_RULES)) {
    fs.writeFileSync(DRAFT_RULES, '# Draft Rules\n\nAuto-generated by gap-detector. Review and promote to rules.json manually.\n', 'utf8');
  }

  fs.appendFileSync(DRAFT_RULES, block, 'utf8');
  console.log(`[gap-detector] ${highConfidence.length} high-confidence rule(s) drafted → ${DRAFT_RULES}`);
  console.log('[gap-detector] Review draft-rules.md and promote entries to rules.json manually.');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) {
    console.log('[gap-detector] dry-run mode — no files will be written');
  }

  // 1. Build n-gram frequency map from qualifying sessions
  console.log('[gap-detector] Building n-gram frequency map from sessions…');
  const freq = await buildNgramFrequencyMap();
  console.log(`[gap-detector] Unique n-grams (≥${MIN_NGRAM_FREQ} occurrences): ${freq.size}`);

  if (freq.size === 0) {
    console.log('[gap-detector] No n-grams meet the minimum frequency threshold. Nothing to report.');
    return;
  }

  // 2. Cluster similar phrases
  console.log('[gap-detector] Clustering similar phrases…');
  const clusters = clusterGrams(freq);
  console.log(`[gap-detector] Top ${clusters.length} cluster(s) identified`);

  // 3. Coverage check against rules.json
  console.log('[gap-detector] Checking coverage against rules.json…');
  const coveredClusters = computeCoverage(clusters);
  const coveredCount  = coveredClusters.filter(c => c.coverage === 'covered').length;
  const partialCount  = coveredClusters.filter(c => c.coverage === 'partial').length;
  const uncoveredCount = coveredClusters.filter(c => c.coverage === 'uncovered').length;
  console.log(`[gap-detector] Coverage: ${coveredCount} covered, ${partialCount} partial, ${uncoveredCount} uncovered`);

  // 4. Extract actionable gaps (freq >= GAP_MIN_FREQ)
  const gaps = extractGaps(coveredClusters);
  console.log(`[gap-detector] Actionable gaps (uncovered/partial, freq ≥ ${GAP_MIN_FREQ}): ${gaps.length}`);

  // 5. Haiku suggestions (sequential, one call per gap)
  let gapsWithSuggestions = [];
  if (gaps.length > 0) {
    console.log(`[gap-detector] Generating Haiku suggestions (${gaps.length} call(s))…`);
    gapsWithSuggestions = generateSuggestedRules(gaps, dryRun);
  }

  // 6. Write gap report
  writeReport(coveredClusters, gaps, gapsWithSuggestions, dryRun);

  // 7. Write draft rules for high-confidence suggestions
  writeDraftRules(gapsWithSuggestions, dryRun);

  console.log('[gap-detector] Done.');
}

main().catch((err) => {
  console.error('[gap-detector] Fatal:', err.message);
  process.exit(1);
});
