#!/usr/bin/env node
/**
 * Retro Quality Tagger (P0c)
 *
 * Scans all ~/Desktop/Labirynt/3 Atlas/Problems/*.md and predicts quality tag
 * from content signals. Outputs proposals as a single report; user runs with
 * --apply to commit changes.
 *
 * Signals:
 *   high:
 *     - breakthrough_commit field filled (non-empty)
 *     - "finally", "wreszcie", "after N hours", "po N godzinach" in content
 *     - "breakthrough", "przełom" in content
 *     - frontmatter tags contain "debug", "critical", "hard"
 *     - file length >2000 chars (deep problem)
 *
 *   low:
 *     - file length <300 chars
 *     - "auto-generated", "frequently-edited" in title
 *     - no sections, just bullets
 *
 *   normal: default
 *
 * Usage:
 *   node retro-quality-tagger.cjs            → dry-run, prints proposals
 *   node retro-quality-tagger.cjs --apply    → writes changes to frontmatter
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || '';
const PROBLEMS_DIR = path.join(HOME, 'Desktop', 'Labirynt', '3 Atlas', 'Problems');

const APPLY = process.argv.includes('--apply');

function readSafe(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

function parseFrontmatter(content) {
  const match = content && content.match(/^---\n([\s\S]*?)\n---/);
  const result = {};
  if (match) {
    for (const line of match[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) result[key] = value;
    }
  }
  // Fallback: some old notes have quality/breakthrough_commit AFTER closing ---
  // but before first heading. Scan next 10 lines for them.
  const afterFm = match ? content.slice(match[0].length).split('\n').slice(0, 10).join('\n') : content.slice(0, 500);
  for (const line of afterFm.split('\n')) {
    const m = line.match(/^(quality|breakthrough_commit):\s*(.+)$/);
    if (m && !result[m[1]]) {
      result[m[1]] = m[2].trim();
    }
  }
  return { fm: result, fmEnd: match ? match[0].length : -1 };
}

function detectQuality(content, fm) {
  const lower = content.toLowerCase();
  const len = content.length;

  // HIGH signals
  const hasBreakthroughCommit = (fm.breakthrough_commit || '').replace(/["\s]/g, '').length > 0;
  const strugglePhrases = [
    /\bfinally\b/i, /\bwreszcie\b/i,
    /\bafter\s+\d+\s*(h|hour|godz)/i, /\bpo\s+\d+\s*(h|godz)/i,
    /\bbreakthrough\b/i, /\bprzełom/i,
    /\b2h\s+deb/i, /\b\d+h\s+(debug|walk)/i
  ];
  let struggleHits = 0;
  for (const p of strugglePhrases) if (p.test(lower)) struggleHits++;

  const hasDeepContent = len > 2000;
  const hasHardTags = (fm.tags || '').toLowerCase().match(/debug|critical|hard|gotcha|breakthrough/);

  // LOW signals
  const isShort = len < 300;
  const isAutoGen = /frequently-edited|auto-generated|auto-tldr/.test(fm.type || '') ||
                    /frequently-edited|auto-generated/.test(fm.title || '');

  // Decision logic (in priority order)
  if (isAutoGen || (isShort && struggleHits === 0)) return { quality: 'low', reasons: ['short/auto-generated'] };

  const highSignals = [];
  if (hasBreakthroughCommit) highSignals.push('breakthrough_commit');
  if (struggleHits >= 2) highSignals.push(`${struggleHits}x struggle phrases`);
  else if (struggleHits === 1 && hasDeepContent) highSignals.push('struggle+depth');
  if (hasHardTags) highSignals.push('hard tag');
  if (hasDeepContent && struggleHits >= 1) highSignals.push('deep+struggle');

  if (highSignals.length >= 1) return { quality: 'high', reasons: highSignals };
  return { quality: 'normal', reasons: [] };
}

function updateFrontmatter(content, newQuality) {
  // Find or insert quality field within frontmatter
  const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---)/);
  if (!fmMatch) {
    // No frontmatter — prepend
    return `---\ntype: problem-solution\nquality: ${newQuality}\n---\n\n${content}`;
  }
  const [full, open, body, close] = fmMatch;
  const qualityLine = body.match(/^quality:\s*.*$/m);
  let newBody;
  if (qualityLine) {
    newBody = body.replace(/^quality:\s*.*$/m, `quality: ${newQuality}`);
  } else {
    newBody = body.trimEnd() + `\nquality: ${newQuality}`;
  }
  return content.replace(fmMatch[0], open + newBody + close);
}

function main() {
  if (!fs.existsSync(PROBLEMS_DIR)) {
    console.error('Problems dir missing');
    process.exit(1);
  }

  const files = fs.readdirSync(PROBLEMS_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();

  console.log(`Scanning ${files.length} files in Problems/...`);
  console.log('');

  const counts = { high: 0, normal: 0, low: 0, skipped: 0, changed: 0 };

  for (const f of files) {
    const p = path.join(PROBLEMS_DIR, f);
    const content = readSafe(p);
    if (!content) { counts.skipped++; continue; }

    const { fm } = parseFrontmatter(content);
    const currentQualityRaw = (fm.quality || '').trim().replace(/["']/g, '');
    const hasExisting = currentQualityRaw.length > 0;
    const currentQuality = hasExisting ? currentQualityRaw : 'none';
    const { quality: predicted, reasons } = detectQuality(content, fm);

    // NEVER demote existing quality — user explicitly set it
    // Only: apply if missing, or upgrade normal→high
    let finalQuality = currentQuality;
    if (!hasExisting) {
      finalQuality = predicted;
    } else if (currentQuality === 'normal' && predicted === 'high') {
      finalQuality = 'high';
    } else if (currentQuality === 'low' && predicted === 'high') {
      finalQuality = 'high';
    }
    // else: keep user's existing value

    counts[finalQuality]++;

    if (currentQuality === finalQuality) {
      console.log(`  ✓ ${f} — ${currentQuality} (unchanged)`);
      continue;
    }

    const arrow = `${currentQuality} → ${finalQuality}`;
    const why = reasons.length ? ` [${reasons.join(', ')}]` : '';
    console.log(`  ${APPLY ? '✎' : '→'} ${f} — ${arrow}${why}`);

    if (APPLY) {
      const updated = updateFrontmatter(content, finalQuality);
      fs.writeFileSync(p, updated);
      counts.changed++;
    }
  }

  console.log('');
  console.log(`Totals: high=${counts.high}, normal=${counts.normal}, low=${counts.low}, skipped=${counts.skipped}`);
  if (APPLY) {
    console.log(`Changed: ${counts.changed} files`);
  } else {
    console.log('(dry-run — pass --apply to write changes)');
  }
}

main();
