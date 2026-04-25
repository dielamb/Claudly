#!/usr/bin/env node
// detect-skill-candidates.js
// Reads ~/.claude/learning/rules.json, scores each rule for skill candidacy,
// writes ~/.claude/learning/skill-candidates.md
// Zero external deps — Node built-ins only (fs, path)

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Paths ────────────────────────────────────────────────────────────────────

const HOME        = process.env.HOME;
const RULES_PATH  = path.join(HOME, '.claude/learning/rules.json');
const OUTPUT_PATH = path.join(HOME, '.claude/learning/skill-candidates.md');

// ─── Signal patterns ──────────────────────────────────────────────────────────
// "Multi-step" rules: contain arrows, numbered steps, "then", "first…then",
// or "after … X". We scan the full text of the rule object.

const MULTISTEP_PATTERNS = [
  /→/u,                                           // arrow notation (→)
  /\bthen\b/i,                                    // "resize, then reload"
  /\bfirst\b.{1,100}\bthen\b/is,                 // "first X, then Y"
  /\bafter\b.{1,100}\b(do|run|take|call|check)\b/is, // "after X do Y"
  /^\s*\d+\.\s+.+(\n|\r\n?)\s*\d+\.\s+/m,       // numbered list (2+ items)
  /\bstep \d+/i,                                  // "Step 1", "Step 2"
];

// ─── Scoring ──────────────────────────────────────────────────────────────────
// Brief scoring formula:
//   multi-step     → +3 pts  (any MULTISTEP_PATTERNS hit)
//   has trigger    → +2 pts  (rule.trigger object present and non-empty)
//   tag "tool"     → +1 pt   (rule.tags includes "tool")
//   tag "ui"       → +1 pt   (rule.tags includes "ui")
//   confidence ≥ 8 → +1 pt   (rule.confidence field ≥ 8)
// Max possible: 8 pts

function isMultiStep(rule) {
  // Concatenate all textual fields into one blob for pattern matching
  const text = [
    rule.rule,
    rule.trigger?.nl,
    rule.description,
    rule.context,
  ]
    .filter(Boolean)
    .join('\n');

  return MULTISTEP_PATTERNS.some(re => re.test(text));
}

function hasTrigger(rule) {
  const t = rule.trigger;
  if (!t) return false;
  // trigger.nl (natural language description) OR trigger.match array must be present
  const hasNl    = typeof t.nl === 'string' && t.nl.trim().length > 0;
  const hasMatch = Array.isArray(t.match) && t.match.length > 0;
  return hasNl || hasMatch;
}

function scoreRule(rule) {
  let score = 0;
  const reasons = [];

  if (isMultiStep(rule)) {
    score += 3;
    reasons.push('multi-step');
  }

  if (hasTrigger(rule)) {
    score += 2;
    reasons.push('has trigger');
  }

  const tags = Array.isArray(rule.tags) ? rule.tags : [];

  if (tags.includes('tool')) {
    score += 1;
    reasons.push('tag:tool');
  }

  if (tags.includes('ui')) {
    score += 1;
    reasons.push('tag:ui');
  }

  const conf = Number(rule.confidence);
  if (!Number.isNaN(conf) && conf >= 8) {
    score += 1;
    reasons.push(`confidence:${conf}`);
  }

  return { score, reasons };
}

// ─── Skill-name suggestion ────────────────────────────────────────────────────

// UUID pattern — detect when id is a UUID so we fall through to rule text
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function suggestSkillName(rule) {
  // If id is meaningful (not a UUID), use it
  if (rule.id && !UUID_RE.test(rule.id)) {
    return rule.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  // Derive from rule text: take first 4 significant words, skip stop words
  const STOP = new Set(['a','an','the','and','or','in','on','at','to','for',
    'of','is','are','be','by','do','it','if','no','so','as','any']);
  const words = (rule.rule || '')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w))
    .slice(0, 4);
  return words.join('-') || 'unnamed-skill';
}

function shortLabel(rule) {
  return rule.id ?? (rule.rule || '').slice(0, 60) ?? '(unnamed)';
}

// ─── Report builder ───────────────────────────────────────────────────────────

function buildReport(scored, totalRules) {
  // Group by score tier
  const high   = scored.filter(c => c.score >= 5);   // strong candidate
  const medium = scored.filter(c => c.score >= 3 && c.score < 5);
  const low    = scored.filter(c => c.score > 0 && c.score < 3);
  const zero   = scored.filter(c => c.score === 0);

  const ts = new Date().toISOString();

  const lines = [
    '# Skill Candidates',
    '',
    `Generated: ${ts}`,
    `Rules evaluated: ${totalRules}`,
    `Scoring: multi-step(+3) + has-trigger(+2) + tag:tool(+1) + tag:ui(+1) + confidence≥8(+1)`,
    '',
    '---',
    '',
    `## High (score ≥ 5) — ${high.length} rule(s)`,
    '',
  ];

  if (high.length === 0) {
    lines.push('_(none)_', '');
  }

  for (const c of high) {
    lines.push(
      `### ${shortLabel(c)} — score ${c.score}/8`,
      '',
      `**Rule:** ${(c.rule || '').slice(0, 160)}`,
      '',
      `**Tags:** ${(c.tags || []).join(', ') || '(none)'}`,
      '',
      `**Reasons:** ${c.reasons.join(' · ')}`,
      '',
      `**Suggested skill name:** \`${suggestSkillName(c)}\``,
      '',
      `**Trigger nl:** ${c.trigger?.nl || '(none)'}`,
      '',
    );
  }

  lines.push(`## Medium (score 3–4) — ${medium.length} rule(s)`, '');
  for (const c of medium) {
    lines.push(
      `- **${shortLabel(c)}** — ${c.score}/8 · ${c.reasons.join(', ')} · \`${suggestSkillName(c)}\``,
    );
  }
  lines.push('');

  lines.push(`## Low (score 1–2) — ${low.length} rule(s)`, '');
  for (const c of low) {
    lines.push(`- ${shortLabel(c)} — ${c.score}/8 (${c.reasons.join(', ')})`);
  }
  lines.push('');

  lines.push(`## Zero score — ${zero.length} rule(s)`, '');
  for (const c of zero) {
    lines.push(`- ${shortLabel(c)}`);
  }
  lines.push('');

  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  // Load rules.json
  if (!fs.existsSync(RULES_PATH)) {
    console.error(`[ERROR] rules.json not found: ${RULES_PATH}`);
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
  } catch (err) {
    console.error(`[ERROR] Failed to parse rules.json: ${err.message}`);
    process.exit(1);
  }

  const ruleList = Array.isArray(raw) ? raw : (raw.rules || []);
  if (ruleList.length === 0) {
    console.error('[ERROR] No rules found in rules.json');
    process.exit(1);
  }

  // Score all rules
  const scored = ruleList
    .map(rule => ({ ...rule, ...scoreRule(rule) }))
    .sort((a, b) => b.score - a.score);

  // Write report
  const report = buildReport(scored, ruleList.length);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, report, 'utf8');

  const topCandidates = scored.filter(r => r.score >= 5);
  console.log(`[OK] ${OUTPUT_PATH}`);
  console.log(`     Rules: ${ruleList.length}  |  High candidates (≥5): ${topCandidates.length}`);
  if (scored.length > 0) {
    console.log(`     Top: ${shortLabel(scored[0])} (score ${scored[0].score}/8)`);
  }
}

main();
