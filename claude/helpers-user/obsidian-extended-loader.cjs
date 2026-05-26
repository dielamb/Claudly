#!/usr/bin/env node
/**
 * Obsidian Extended Loader
 *
 * Fixes the 30-day cutoff bug in RuFlo's ruflo-session-loader.cjs.
 *
 * Problem: ruflo-session-loader only reads Problems/ modified in last 30 days.
 * High-quality solved problems from 2+ months ago are invisible to intelligence.
 *
 * Solution: after RuFlo loads its 30d slice, scan ALL of 3 Atlas/Problems/,
 * find entries with frontmatter quality: high that weren't already loaded,
 * append them to auto-memory-store.json. Graphify-intelligence will then
 * include them in the graph, and quality-rescorer will boost them.
 *
 * Runs after: hook-handler.cjs session-restore (which calls ruflo-session-loader)
 * Runs before: graphify-intelligence.cjs (so they flow through graph build)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || '';
const VAULT = path.join(HOME, 'Desktop', 'Labirynt');
const PROBLEMS_DIR = path.join(VAULT, '3 Atlas', 'Problems');
const SYNTHESIS_DIR = path.join(VAULT, '3 Atlas', 'Synthesis');
const REASONING_DIR = path.join(VAULT, '3 Atlas', 'Reasoning');
const CODE_DIR = path.join(VAULT, '3 Atlas', 'Code');
const DESIGN_DIR = path.join(VAULT, '3 Atlas', 'Design');
const CALENDAR_DIR = path.join(VAULT, '1 Calendar');
const DATA_DIR = path.join(HOME, '.claude-flow', 'data');
const STORE_PATH = path.join(DATA_DIR, 'auto-memory-store.json');
const LOG_PATH = path.join(HOME, 'logs', 'obsidian-extended-loader.log');

const MAX_HIGH_QUALITY_TO_ADD = 20;
const MAX_SYNTHESIS_TO_LOAD = 30;   // all, folder stays small by design
const MAX_REASONING_TO_LOAD = 30;   // all, decision rationale is high-value
const MAX_PATTERNS_TO_LOAD = 30;    // Code/ patterns — all are high-value
const MAX_PRINCIPLES_TO_LOAD = 30;  // Design/ principles
const MAX_DAILIES_TO_LOAD = 5;      // last N daily notes for hot context

function log(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* non-fatal */ }
}

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

function parseFrontmatter(content) {
  const match = content && content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function extractSections(content, headings) {
  const parts = [];
  for (const heading of headings) {
    const idx = content.indexOf(heading);
    if (idx === -1) continue;
    const next = content.slice(idx + heading.length).search(/\n## /);
    const end = next === -1 ? content.length : idx + heading.length + next;
    parts.push(content.slice(idx, end).trim());
  }
  return parts.length ? parts.join('\n\n') : null;
}

function listMarkdown(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => ({
        name: f,
        path: path.join(dir, f),
        mtime: fs.statSync(path.join(dir, f)).mtimeMs
      }));
  } catch { return []; }
}

function allProblems() { return listMarkdown(PROBLEMS_DIR); }
function allSynthesis() { return listMarkdown(SYNTHESIS_DIR); }
function allReasoning() { return listMarkdown(REASONING_DIR); }
function allPatterns() { return listMarkdown(CODE_DIR); }
function allPrinciples() { return listMarkdown(DESIGN_DIR); }
function recentDailies() {
  const all = listMarkdown(CALENDAR_DIR);
  // Filter to YYYY-MM-DD.md format only (not weekly summaries)
  return all.filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f.name));
}

function makeEntryId(file) {
  return 'obs-' + file.replace(/[^a-z0-9]/gi, '-').substring(0, 40);
}

function pushEntry(store, storeIds, file, mtime, content, fm, namespace, nodeType, sectionHeaders) {
  const id = makeEntryId(file);
  if (storeIds.has(id)) return false;
  const extracted = extractSections(content, sectionHeaders);
  const patternText = extracted || content.slice(0, 900);
  const quality = (fm.quality || 'normal').trim();
  store.push({
    id,
    key: id,
    content: patternText,
    summary: `Obsidian ${nodeType}`,
    namespace,
    type: nodeType === 'synthesis' ? 'semantic' : 'procedural',
    quality,
    metadata: {
      source: 'obsidian',
      category: namespace,
      file,
      quality,
      nodeType,
      fromObsidian: true,
      extendedLoader: true
    },
    createdAt: mtime || Date.now()
  });
  storeIds.add(id);
  return true;
}

function main() {
  if (!fs.existsSync(PROBLEMS_DIR)) {
    log('Problems dir missing — exiting');
    process.exit(0);
  }

  let store = [];
  try {
    store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
    if (!Array.isArray(store)) store = [];
  } catch {
    log('auto-memory-store.json missing — exiting (RuFlo should have created it)');
    process.exit(0);
  }

  const storeIds = new Set(store.map(e => e.id));

  const thirtyDaysAgo = Date.now() - 30 * 86400000;
  const problems = allProblems();

  // Candidates: high-quality problems NOT loaded by RuFlo (older than 30d or missed)
  const candidates = [];
  for (const p of problems) {
    const id = makeEntryId(p.name);
    // Skip if already in store (RuFlo loaded it)
    if (storeIds.has(id)) continue;

    const content = readFileSafe(p.path);
    if (!content || content.length < 50) continue;

    const fm = parseFrontmatter(content);
    const quality = (fm.quality || 'normal').trim();
    if (quality !== 'high') continue;

    candidates.push({ file: p.name, path: p.path, mtime: p.mtime, content, fm, quality });
  }

  // Sort newest first, cap to MAX
  candidates.sort((a, b) => b.mtime - a.mtime);
  const toAdd = candidates.slice(0, MAX_HIGH_QUALITY_TO_ADD);

  let added = 0;
  for (const c of toAdd) {
    const id = makeEntryId(c.file);
    const extracted = extractSections(c.content, ['## Problem', '## Rozwiązanie', '## Efekt', '## Solution', '## Effect']);
    const patternText = extracted || c.content.slice(0, 800);

    store.push({
      id,
      key: id,
      content: patternText,
      summary: 'Obsidian proven pattern (extended)',
      namespace: 'rules-proven',
      type: 'procedural',
      quality: 'high',
      metadata: {
        source: 'obsidian',
        category: 'problem',
        file: c.file,
        quality: 'high',
        breakthrough_commit: (c.fm.breakthrough_commit || '').replace(/["\s]/g, '') || null,
        fromObsidian: true,
        extendedLoader: true,
        loadedBeyond30d: c.mtime < thirtyDaysAgo
      },
      createdAt: c.mtime || Date.now()
    });
    added++;
  }

  // Synthesis/ — ALL loaded (compounding knowledge, folder stays small)
  let synthAdded = 0;
  const synthesis = allSynthesis();
  synthesis.sort((a, b) => b.mtime - a.mtime);
  for (const s of synthesis.slice(0, MAX_SYNTHESIS_TO_LOAD)) {
    const content = readFileSafe(s.path);
    if (!content || content.length < 100) continue;
    const fm = parseFrontmatter(content);
    if (pushEntry(store, storeIds, s.name, s.mtime, content, fm, 'synthesis', 'synthesis',
        ['## Synteza', '## Kluczowe insighty', '## Synthesis', '## Key insights'])) {
      synthAdded++;
    }
  }

  // Code/ patterns — ALL loaded (reusable snippets)
  let patternAdded = 0;
  const patterns = allPatterns();
  patterns.sort((a, b) => b.mtime - a.mtime);
  for (const p of patterns.slice(0, MAX_PATTERNS_TO_LOAD)) {
    const content = readFileSafe(p.path);
    if (!content || content.length < 80) continue;
    const fm = parseFrontmatter(content);
    if (pushEntry(store, storeIds, p.name, p.mtime, content, fm, 'patterns', 'pattern',
        ['## Wzorzec', '## Pattern', '## Kod', '## Kiedy używać'])) {
      patternAdded++;
    }
  }

  // Design/ principles — ALL loaded
  let principleAdded = 0;
  const principles = allPrinciples();
  principles.sort((a, b) => b.mtime - a.mtime);
  for (const d of principles.slice(0, MAX_PRINCIPLES_TO_LOAD)) {
    const content = readFileSafe(d.path);
    if (!content || content.length < 80) continue;
    const fm = parseFrontmatter(content);
    if (pushEntry(store, storeIds, d.name, d.mtime, content, fm, 'design-principles', 'design-principle',
        ['## Zasada', '## Principle', '## Dlaczego', '## Kiedy stosować'])) {
      principleAdded++;
    }
  }

  // Reasoning/ — decision rationale, load all
  let reasoningAdded = 0;
  const reasoning = allReasoning();
  reasoning.sort((a, b) => b.mtime - a.mtime);
  for (const r of reasoning.slice(0, MAX_REASONING_TO_LOAD)) {
    const content = readFileSafe(r.path);
    if (!content || content.length < 100) continue;
    const fm = parseFrontmatter(content);
    if (pushEntry(store, storeIds, r.name, r.mtime, content, fm, 'reasoning', 'reasoning',
        ['## Decyzja', '## Dlaczego', '## Trade-offs', '## Decision', '## Rationale'])) {
      reasoningAdded++;
    }
  }

  // Recent daily notes (hot context — cross-session learnings)
  let dailyAdded = 0;
  const dailies = recentDailies();
  dailies.sort((a, b) => b.mtime - a.mtime);
  for (const d of dailies.slice(0, MAX_DAILIES_TO_LOAD)) {
    const content = readFileSafe(d.path);
    if (!content || content.length < 100) continue;
    const fm = parseFrontmatter(content);
    if (pushEntry(store, storeIds, d.name, d.mtime, content, fm, 'daily-context', 'log',
        ['## Sesje z Claude', '## Zrobiono', '## Learnings', '## TIL'])) {
      dailyAdded++;
    }
  }

  const totalAdded = added + synthAdded + reasoningAdded + patternAdded + principleAdded + dailyAdded;
  if (totalAdded > 0) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  }

  log(`Loaded: +${added} problems, +${synthAdded} synthesis, +${reasoningAdded} reasoning, +${patternAdded} patterns, +${principleAdded} principles, +${dailyAdded} dailies`);
  console.log(`[OBS-EXT] +${added} probs, +${synthAdded} synth, +${reasoningAdded} reason, +${patternAdded} patt, +${principleAdded} princ, +${dailyAdded} daily`);
}

try {
  main();
} catch (e) {
  log(`FATAL: ${e.message}\n${e.stack}`);
  process.exit(0);
}
