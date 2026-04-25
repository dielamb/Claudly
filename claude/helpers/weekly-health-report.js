#!/usr/bin/env node
'use strict';
/**
 * Weekly AI System Health Report
 * Computes key metrics from sessions, rules, janitor logs.
 * Writes to ~/Desktop/Labirynt/0 Inbox/weekly-health-YYYY-WW.md
 *
 * Cron (Monday 08:00):
 *   0 8 * * 1 node ~/.claude/helpers/weekly-health-report.js >> ~/.claude/learning/weekly-health.log 2>&1
 */

const fs   = require('fs');
const path = require('path');
const readline = require('readline');

const HOME         = process.env.HOME || '__HOME__';
const SESSIONS_DIR = path.join(HOME, '.claude', 'learning', 'sessions');
const RULES_PATH   = path.join(HOME, '.claude', 'learning', 'rules.json');
const JANITOR_LOG  = path.join(HOME, '.claude', 'helpers', 'janitor', 'logs');
const INBOX        = path.join(HOME, 'Desktop', 'Labirynt', '0 Inbox');

const META_PATTERNS = [
  'Read the session transcript at', 'Write a concise session summary',
  'dream-worker', 'bulk-dream', 'Analyze these', 'learning/sessions',
  'Run GAN loop', 'You are a JSON generator',
];

function isMetaSession(first) {
  return META_PATTERNS.some(p => first.includes(p));
}

function isoWeek(d) {
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function parseDate(ts) {
  if (!ts) return null;
  try { return new Date(ts); } catch (_) { return null; }
}

async function scanSessions(cutoffMs) {
  const stats = { total: 0, failure: 0, success: 0, unknown: 0 };
  if (!fs.existsSync(SESSIONS_DIR)) return stats;

  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
  for (const f of files) {
    let data;
    try {
      const raw = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8').trim().split('\n')[0];
      data = JSON.parse(raw);
    } catch (_) { continue; }

    const ts = parseDate(data.ts);
    if (!ts || ts.getTime() < cutoffMs) continue;

    const first = (data.human_messages || [])[0] || '';
    if (isMetaSession(first)) continue;

    stats.total++;
    const outcome = data.outcome || 'unknown';
    if (outcome === 'failure') stats.failure++;
    else if (outcome === 'success') stats.success++;
    else stats.unknown++;
  }
  return stats;
}

function loadRules() {
  try { return JSON.parse(fs.readFileSync(RULES_PATH, 'utf8')); }
  catch (_) { return []; }
}

function getRulesStats(rules) {
  const active = rules.filter(r => !r.disabled);
  const withTrigger = active.filter(r => r.trigger?.match?.length > 0);
  const highConf = active.filter(r => (r.confidence || 7) >= 8);
  const needsEvol = active.filter(r => r.needsEvolution === true);
  const failureSourced = active.filter(r => r.source === 'failure');
  return { total: active.length, withTrigger: withTrigger.length, highConf: highConf.length, needsEvol: needsEvol.length, failureSourced: failureSourced.length };
}

function getJanitorStats() {
  const stats = { removed: 0, flagged: 0, runs: 0 };
  if (!fs.existsSync(JANITOR_LOG)) return stats;

  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  try {
    const logs = fs.readdirSync(JANITOR_LOG)
      .filter(f => f.startsWith('overnight-') && f.endsWith('.log'))
      .map(f => ({ f, mtime: fs.statSync(path.join(JANITOR_LOG, f)).mtimeMs }))
      .filter(x => x.mtime > cutoff);

    for (const { f } of logs) {
      const content = fs.readFileSync(path.join(JANITOR_LOG, f), 'utf8');
      const removedMatch = content.match(/removed=(\d+)/g) || [];
      const flaggedMatch = content.match(/flagged=(\d+)/g) || [];
      stats.removed += removedMatch.reduce((s, m) => s + parseInt(m.split('=')[1], 10), 0);
      stats.flagged  += flaggedMatch.reduce((s, m) => s + parseInt(m.split('=')[1], 10), 0);
      if (content.includes('=== Janitor')) stats.runs++;
    }
  } catch (_) {}
  return stats;
}

function getGapStats() {
  const gapFile = path.join(HOME, '.claude', 'learning', 'gap-report-' + new Date().toISOString().split('T')[0] + '.md');
  if (!fs.existsSync(gapFile)) return null;
  const content = fs.readFileSync(gapFile, 'utf8');
  const uncoveredMatch = content.match(/Gaps \(uncovered\/partial.*?\): (\d+)/);
  return uncoveredMatch ? parseInt(uncoveredMatch[1], 10) : null;
}

function failureRateStr(stats) {
  if (stats.total === 0) return 'N/A (no sessions)';
  const pct = Math.round((stats.failure / stats.total) * 100);
  return `${pct}% (${stats.failure}/${stats.total})`;
}

async function main() {
  const now = new Date();
  const week = isoWeek(now);
  const cutoff = now.getTime() - 7 * 24 * 3600 * 1000;
  const cutoffPrev = cutoff - 7 * 24 * 3600 * 1000;

  console.log(`[weekly-health] Computing week ${week}...`);

  const [thisWeek, lastWeek, rules, janitor] = await Promise.all([
    scanSessions(cutoff),
    scanSessions(cutoffPrev),
    Promise.resolve(loadRules()),
    Promise.resolve(getJanitorStats()),
  ]);

  const rulesStats = getRulesStats(rules);
  const gapCount = getGapStats();

  const thisRate = thisWeek.total > 0 ? Math.round((thisWeek.failure / thisWeek.total) * 100) : null;
  const lastRate = lastWeek.total > 0 ? Math.round((lastWeek.failure / lastWeek.total) * 100) : null;

  let trend = '';
  if (thisRate !== null && lastRate !== null) {
    const delta = thisRate - lastRate;
    trend = delta > 0 ? ` ↑${delta}pp ⚠` : delta < 0 ? ` ↓${Math.abs(delta)}pp ✓` : ' → unchanged';
  }

  const lines = [
    '---',
    'type: inbox',
    `created: ${now.toISOString().split('T')[0]}`,
    'tags: [health, weekly, review-needed]',
    '---',
    '',
    `# AI System Health — ${week}`,
    '',
    '## Session Quality',
    '',
    `| Metric | This Week | Last Week | Trend |`,
    `|--------|-----------|-----------|-------|`,
    `| Failure rate | ${failureRateStr(thisWeek)} | ${failureRateStr(lastWeek)} | ${trend || 'N/A'} |`,
    `| Total sessions | ${thisWeek.total} | ${lastWeek.total} | |`,
    `| Success sessions | ${thisWeek.success} | ${lastWeek.success} | |`,
    '',
    '## Rules Health',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Active rules | ${rulesStats.total} |`,
    `| With trigger conditions | ${rulesStats.withTrigger} (${Math.round(rulesStats.withTrigger/Math.max(1,rulesStats.total)*100)}%) |`,
    `| High confidence (≥8) | ${rulesStats.highConf} |`,
    `| Failure-sourced | ${rulesStats.failureSourced} |`,
    `| Needs evolution | ${rulesStats.needsEvol} |`,
    gapCount !== null ? `| Uncovered failure gaps | ${gapCount} |` : '',
    '',
    '## Code Health (Janitor, 7d)',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Nightly runs | ${janitor.runs} |`,
    `| Dead selectors removed | ${janitor.removed} |`,
    `| Selectors flagged | ${janitor.flagged} |`,
    '',
    '## Actions Needed',
    '',
  ].filter(l => l !== null);

  const actions = [];
  if (thisRate !== null && lastRate !== null && thisRate > lastRate + 5) {
    actions.push('⚠ Failure rate rising — check gap-detector output, run dreamer manually');
  }
  if (rulesStats.needsEvol > 0) {
    actions.push(`⚠ ${rulesStats.needsEvol} rule(s) flagged for evolution — check evolution-proposals.md`);
  }
  if (gapCount !== null && gapCount > 10) {
    actions.push(`⚠ ${gapCount} uncovered failure patterns — promote draft-rules.md to rules.json`);
  }
  if (janitor.flagged > 20) {
    actions.push(`⚠ ${janitor.flagged} dead selectors still flagged — review janitor reports in Inbox`);
  }
  if (actions.length === 0) actions.push('✓ All metrics nominal. No action needed.');

  actions.forEach(a => lines.push(`- ${a}`));
  lines.push('');
  lines.push('## Related');
  lines.push('');
  lines.push('[[Rules Autoimprovement Pipeline]] [[Janitor Crew System]]');

  // Regression alert
  if (thisRate !== null && lastRate !== null && thisRate > lastRate + 5) {
    try {
      const { execFileSync } = require('child_process');
      execFileSync('osascript', [
        '-e', `display notification "Failure rate: ${lastRate}% → ${thisRate}% (↑${thisRate-lastRate}pp)" with title "⚠ AI System Regression" sound name "Basso"`
      ], { stdio: 'ignore' });
    } catch (_) {}
  }

  fs.mkdirSync(INBOX, { recursive: true });
  const outFile = path.join(INBOX, `weekly-health-${week}.md`);
  fs.writeFileSync(outFile, lines.join('\n') + '\n');
  console.log(`[weekly-health] Written to ${outFile}`);

  // Print summary
  console.log(`  Failure rate: ${thisRate ?? 'N/A'}%${trend}`);
  console.log(`  Rules: ${rulesStats.total} active, ${rulesStats.needsEvol} need evolution`);
  console.log(`  Janitor: ${janitor.removed} removed, ${janitor.flagged} flagged`);
}

main().catch(e => { console.error('[weekly-health] Fatal:', e.message); process.exit(0); });
