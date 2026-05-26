#!/usr/bin/env node
/**
 * Project Scope Filter (P1a)
 *
 * Detects current working context (cwd → project name) and re-weights
 * ranked-context.json entries: matching-project entries get +boost,
 * cross-cutting (no project field) stay neutral, other-project entries decay.
 *
 * Project detection:
 *   1. cwd matches known project path (~/projects/www_v2/ → www_v2)
 *   2. metadata.project field in store entry
 *   3. folder-based heuristics (3 Atlas/Tools/Chrome DevTools → cross-cutting)
 *
 * Runs AFTER quality-rescorer (takes its baseScore, re-weights with project).
 * If cwd is vault itself (~/Desktop/Labirynt) → no filter, all entries equal.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || '';
const DATA_DIR = path.join(HOME, '.claude-flow', 'data');
const RANKED_PATH = path.join(DATA_DIR, 'ranked-context.json');
const LOG_PATH = path.join(HOME, 'logs', 'project-scope-filter.log');

// Read cwd from UserPromptSubmit stdin JSON (like prompt-enrichment.sh)
let INPUT_CWD = '';
try {
  const raw = fs.readFileSync('/dev/stdin', 'utf-8');
  const parsed = JSON.parse(raw);
  INPUT_CWD = parsed.cwd || '';
} catch { /* SessionStart fallback or stdin unavailable */ }

// Known project paths → project slug
const PROJECT_ROOTS = [
  { pattern: /\/www[-_]?v2\b/i, slug: 'www_v2' },
  { pattern: /\/www[-_]?v3\b/i, slug: 'www_v3' },
  { pattern: /\/lazy[-_]?divines\b/i, slug: 'lazy_divines' },
  { pattern: /\/portfolio\b/i, slug: 'portfolio' },
  { pattern: /\/bsh\b/i, slug: 'bsh' },
  { pattern: /\/atlas\b/i, slug: 'atlas' },
  { pattern: /\/ruflo\b/i, slug: 'ruflo' },
  { pattern: /claude[-_]?flow/i, slug: 'ruflo' }
];

function log(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* non-fatal */ }
}

function detectCurrentProject() {
  const cwd = INPUT_CWD || process.cwd();
  for (const { pattern, slug } of PROJECT_ROOTS) {
    if (pattern.test(cwd)) return slug;
  }
  // Vault / home / unknown
  return null;
}

function entryProject(entry) {
  // 1. Explicit project in metadata
  const meta = entry.metadata || {};
  if (meta.project) return String(meta.project).toLowerCase();

  // 2. Derive from content mentions (heuristic — keyword match)
  const text = String(entry.content || '').toLowerCase() + ' ' + String(entry.summary || '').toLowerCase();
  for (const { pattern, slug } of PROJECT_ROOTS) {
    if (pattern.test(text)) return slug;
  }

  // 3. Cross-cutting concept (Tools, templates, generic patterns)
  const nodeType = entry.nodeType || entry.category;
  if (nodeType === 'tool-note' || nodeType === 'pattern' || nodeType === 'design-principle') {
    return '__cross_cutting__';
  }

  return null; // unknown — leave neutral
}

function main() {
  const ranked = (() => {
    try { return JSON.parse(fs.readFileSync(RANKED_PATH, 'utf-8')); } catch { return null; }
  })();
  if (!ranked || !Array.isArray(ranked.entries)) {
    log('ranked-context missing or empty');
    process.exit(0);
  }

  const currentProject = detectCurrentProject();
  if (!currentProject) {
    // No project context (home dir, vault, unknown) — neutral, exit silently
    process.exit(0);
  }

  log(`cwd=${process.cwd()} project=${currentProject}`);

  let boosted = 0, decayed = 0, neutral = 0;
  const BOOST = 0.15;   // +15% for matching project
  const DECAY = 0.08;   // -8% for other project (still reachable, just down-ranked)

  for (const e of ranked.entries) {
    const proj = entryProject(e);
    const base = e.baseScore || 0;

    if (proj === currentProject) {
      e.baseScore = Math.min(1, base + BOOST);
      e.scopeTag = 'boost';
      boosted++;
    } else if (proj === '__cross_cutting__' || proj === null) {
      e.scopeTag = 'neutral';
      neutral++;
    } else {
      e.baseScore = Math.max(0, base - DECAY);
      e.scopeTag = 'decay';
      decayed++;
    }
  }

  // Re-sort by new baseScore
  ranked.entries.sort((a, b) => (b.baseScore || 0) - (a.baseScore || 0));
  ranked.scopedAt = Date.now();
  ranked.scope = currentProject;

  fs.writeFileSync(RANKED_PATH, JSON.stringify(ranked, null, 2));

  log(`Project=${currentProject}: boosted=${boosted}, neutral=${neutral}, decayed=${decayed}`);
  console.log(`[PROJECT-SCOPE] ${currentProject}: +${boosted} boosted, ${neutral} neutral, -${decayed} decayed`);
}

try {
  main();
} catch (e) {
  log(`FATAL: ${e.message}`);
  process.exit(0);
}
