#!/usr/bin/env node
/**
 * Quality Rescorer
 *
 * Post-processes ranked-context.json after RuFlo's init() has built it.
 * Applies multi-factor scoring that RuFlo's built-in scoring misses:
 *   - quality signal (high/normal/low from Obsidian frontmatter)
 *   - node type weight (problem-solution > concept > template)
 *   - PageRank (from graphify-enriched graph-state.json)
 *   - recency (time decay on createdAt)
 *
 * Also enforces community diversity in top-K to prevent echo chamber.
 *
 * Final formula:
 *   score = 0.30 * pageRank_normalized
 *         + 0.25 * quality_boost
 *         + 0.20 * type_weight
 *         + 0.15 * confidence
 *         + 0.10 * recency
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || '';
const DATA_DIR = path.join(HOME, '.claude-flow', 'data');
const RANKED_PATH = path.join(DATA_DIR, 'ranked-context.json');
const GRAPH_PATH = path.join(DATA_DIR, 'graph-state.json');
const STORE_PATH = path.join(DATA_DIR, 'auto-memory-store.json');
const LOG_PATH = path.join(HOME, 'logs', 'quality-rescorer.log');

const QUALITY_BOOST = { high: 1.0, normal: 0.5, low: 0.0 };
const TYPE_WEIGHTS = {
  // Primary knowledge types (Atlas subfolders) — must match graphify-intelligence.cjs
  'synthesis': 1.05,          // Synthesis/ — compounding cross-note answers (Karpathy)
  'reasoning': 1.0,           // Reasoning/ — decision rationale
  'pattern': 1.0,             // Code/
  'design-principle': 0.95,   // Design/
  'problem-solution': 0.9,    // Problems/
  'rationale': 0.85,
  'tool-note': 0.8,           // Tools/
  'rules-proven': 1.0,        // legacy from Obsidian loader (rule-proven)
  'rules': 0.85,
  'effort': 0.8,
  'technique': 0.75,
  'concept': 0.7,
  'moc': 0.7,
  'tool': 0.7,                // legacy alias for tool-note
  'idea': 0.55,               // Ideas/
  'note': 0.55,
  'person': 0.5,
  'organization': 0.4,
  'source': 0.5,
  'group': 0.4,
  'template': 0.2,
  'log': 0.3,
  'feedback': 0.5,
  'system': 0.3,
  'context': 0.6,
  'unsorted': 0.3,            // 0 Inbox/ — deprioritized until sorted
  'default': 0.5,
  'undefined': 0.4
};

// Recency half-life: 60 days (older entries decay to 0.5, then slower)
const RECENCY_HALF_LIFE_MS = 60 * 86400000;

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function writeJSON(p, data) {
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8'); } catch { /* non-fatal */ }
}

function log(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* non-fatal */ }
}

function recencyScore(createdAt) {
  if (!createdAt) return 0.5;
  const ageMs = Date.now() - createdAt;
  if (ageMs <= 0) return 1.0;
  // Exponential decay with half-life
  return Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS);
}

function tokenize(text) {
  if (!text) return [];
  return String(text).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function main() {
  const store = readJSON(STORE_PATH) || [];
  if (!Array.isArray(store) || store.length === 0) {
    log('auto-memory-store.json empty — nothing to rescore');
    process.exit(0);
  }

  const graph = readJSON(GRAPH_PATH);
  const nodes = (graph && graph.nodes) || {};

  // Read existing ranked for carrying over access counts (accumulated feedback)
  const existingRanked = readJSON(RANKED_PATH);
  const existingById = new Map(
    existingRanked && Array.isArray(existingRanked.entries)
      ? existingRanked.entries.map(e => [e.id, e])
      : []
  );

  const storeById = new Map(store.map(e => [e.id, e]));
  // Rebuild ranked from full store (not from stale ranked-context)
  const ranked = {
    version: 2,
    computedAt: Date.now(),
    entries: store.map(entry => {
      const existing = existingById.get(entry.id) || {};
      return {
        id: entry.id,
        content: entry.content || entry.value || '',
        summary: entry.summary || entry.key || '',
        category: entry.namespace || entry.type || 'default',
        confidence: existing.confidence || (entry.metadata && entry.metadata.confidence) || 0.5,
        accessCount: existing.accessCount || 0,
        words: tokenize((entry.content || '') + ' ' + (entry.summary || ''))
      };
    })
  };

  // Normalize PageRanks to [0,1]
  const prValues = Object.values(nodes).map(n => n.pageRank || 0);
  const prMax = prValues.length ? Math.max(...prValues) : 1;
  const prNorm = prMax > 0 ? prMax : 1;

  let qualityCounts = { high: 0, normal: 0, low: 0 };
  let rescored = 0;

  for (const entry of ranked.entries) {
    const storeEntry = storeById.get(entry.id);
    const node = nodes[entry.id];

    // Extract signals
    const quality = entry.quality
      || (storeEntry && storeEntry.quality)
      || (storeEntry && storeEntry.metadata && storeEntry.metadata.quality)
      || (node && node.quality)
      || 'normal';

    const nodeType = (node && node.nodeType)
      || (storeEntry && storeEntry.metadata && storeEntry.metadata.nodeType)
      || entry.category
      || 'default';

    const pageRank = (node && node.pageRank) || entry.pageRank || 0;
    const pageRankNorm = prNorm > 0 ? pageRank / prNorm : 0;

    const confidence = entry.confidence || (node && node.confidence) || 0.5;

    const createdAt = (storeEntry && storeEntry.createdAt) || (node && node.createdAt) || Date.now();
    const recency = recencyScore(createdAt);

    const qBoost = QUALITY_BOOST[quality] !== undefined ? QUALITY_BOOST[quality] : 0.5;
    const tWeight = TYPE_WEIGHTS[nodeType] !== undefined ? TYPE_WEIGHTS[nodeType] : 0.5;

    // Multi-factor score
    const score =
      0.30 * pageRankNorm +
      0.25 * qBoost +
      0.20 * tWeight +
      0.15 * confidence +
      0.10 * recency;

    // Enrich entry with signals for downstream consumers
    entry.quality = quality;
    entry.nodeType = nodeType;
    entry.community = node ? node.community : -1;
    entry.typeWeight = tWeight;
    entry.recency = +recency.toFixed(4);
    entry.pageRank = pageRank;
    entry.baseScore = +score.toFixed(4);

    qualityCounts[quality] = (qualityCounts[quality] || 0) + 1;
    rescored++;
  }

  // Drop quality:low entries entirely (Obsidian intent: not valuable)
  const filtered = ranked.entries.filter(e => e.quality !== 'low');

  // Sort by new baseScore descending
  filtered.sort((a, b) => (b.baseScore || 0) - (a.baseScore || 0));

  // Community diversity: reorder so top-10 span at least 3 communities
  const diverseTop = [];
  const seenCommunities = new Set();
  const remaining = [...filtered];
  const DIVERSE_K = 10;

  while (diverseTop.length < DIVERSE_K && remaining.length > 0) {
    // First pass: pick highest-scored from unseen community
    let picked = false;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i].community;
      if (c === undefined || c === -1 || !seenCommunities.has(c)) {
        diverseTop.push(remaining[i]);
        if (c !== undefined && c !== -1) seenCommunities.add(c);
        remaining.splice(i, 1);
        picked = true;
        break;
      }
    }
    // Fallback: if all communities seen, just take next highest
    if (!picked) {
      diverseTop.push(remaining.shift());
    }
  }

  const finalOrdered = [...diverseTop, ...remaining];

  ranked.entries = finalOrdered;
  ranked.rescoredAt = Date.now();
  ranked.rescorer = {
    version: 1,
    droppedLowQuality: ranked.entries.length !== rescored ? rescored - filtered.length : 0,
    qualityDistribution: qualityCounts,
    communitiesInTop10: seenCommunities.size
  };

  writeJSON(RANKED_PATH, ranked);

  const topSample = finalOrdered.slice(0, 5).map(e => ({
    id: e.id,
    q: e.quality,
    t: e.nodeType,
    c: e.community,
    s: e.baseScore
  }));

  log(`Rescored ${rescored} entries. Quality: high=${qualityCounts.high} normal=${qualityCounts.normal} low=${qualityCounts.low}. Top-10 communities: ${seenCommunities.size}`);
  log(`Top 5: ${JSON.stringify(topSample)}`);
  console.log(`[QUALITY-RESCORE] ${rescored} entries, q-high=${qualityCounts.high}, communities=${seenCommunities.size}`);
}

try {
  main();
} catch (e) {
  log(`FATAL: ${e.message}\n${e.stack}`);
  process.exit(0);
}
