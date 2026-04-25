#!/usr/bin/env node
/**
 * Graphify Intelligence Bridge
 *
 * Reads graphify output (185 nodes, 238 edges) and integrates it into RuFlo
 * intelligence layer, replacing the near-empty self-built graph (18 nodes, 1 edge).
 *
 * Flow:
 *   1. Read ~/Desktop/Labirynt/graphify-out/graph.json
 *   2. Read ~/.claude-flow/data/auto-memory-store.json (RuFlo entries)
 *   3. Map graphify nodes (source_file) to store entries (metadata.file)
 *   4. Build enriched graph-state.json with real edges + community + node type
 *   5. Compute PageRank on the meaningful graph
 *   6. Write back graph-state.json
 *
 * Runs AFTER RuFlo intelligence.init() — we enrich/override its output.
 * Non-fatal: if graphify missing, exits silently (0).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || '';
const GRAPHIFY_PATH = path.join(HOME, 'Desktop', 'Labirynt', 'graphify-out', 'graph.json');
const DATA_DIR = path.join(HOME, '.claude-flow', 'data');
const STORE_PATH = path.join(DATA_DIR, 'auto-memory-store.json');
const GRAPH_PATH = path.join(DATA_DIR, 'graph-state.json');
const LOG_PATH = path.join(HOME, 'logs', 'graphify-intelligence.log');

// Node type scoring weights (higher = more valuable pattern)
// Updated 2026-04-20: distinguish pattern (Code/) and principle (Design/) from problem-solution
// Updated 2026-04-20 P0: synthesis (compounding answers) = highest weight (Karpathy LLM Wiki)
const TYPE_WEIGHTS = {
  'synthesis': 1.05,          // Synthesis/ — compounding cross-note answers (most valuable)
  'reasoning': 1.0,           // Reasoning/ — decision rationale (WHY behind architecture)
  'pattern': 1.0,             // Code/ — reusable snippet, highest actionable value
  'design-principle': 0.95,   // Design/ — visual rule/token
  'problem-solution': 0.9,    // Problems/ — bug+fix with context
  'rationale': 0.85,
  'tool-note': 0.8,           // Tools/ — MCP/plugin how-to
  'effort': 0.8,
  'technique': 0.75,
  'concept': 0.7,
  'moc': 0.7,
  'idea': 0.55,               // Ideas/ — aspirational, not proven
  'person': 0.6,
  'organization': 0.5,
  'source': 0.5,
  'tool': 0.7,                // legacy alias for tool-note
  'note': 0.55,
  'group': 0.4,
  'template': 0.2,
  'log': 0.3,
  'feedback': 0.5,
  'document': 0.5,
  'system': 0.3,
  'unsorted': 0.3,            // 0 Inbox/ — deprioritized until sorted
  'undefined': 0.4
};

// Folder-based type inference — when graphify type is generic, folder path tells us more
function inferTypeFromPath(sourceFile) {
  if (!sourceFile) return null;
  const p = sourceFile.toLowerCase();
  if (p.includes('3 atlas/synthesis/')) return 'synthesis';
  if (p.includes('3 atlas/reasoning/')) return 'reasoning';
  if (p.includes('3 atlas/code/')) return 'pattern';
  if (p.includes('3 atlas/design/')) return 'design-principle';
  if (p.includes('3 atlas/problems/')) return 'problem-solution';
  if (p.includes('3 atlas/tools/')) return 'tool-note';
  if (p.includes('3 atlas/ideas/')) return 'idea';
  if (p.includes('0 inbox/')) return 'unsorted';
  if (p.includes('2 efforts/')) return 'effort';
  if (p.includes('4 people/')) return 'person';
  if (p.includes('5 sources/')) return 'source';
  if (p.includes('6 maps/')) return 'moc';
  if (p.includes('templates/')) return 'template';
  return null;
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function writeJSON(p, data) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    log(`writeJSON failed for ${p}: ${e.message}`);
  }
}

function log(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* non-fatal */ }
}

/**
 * PageRank on {id -> node} + [{_src, _tgt}] edges.
 * Returns { id: score }. Scores sum to 1.
 */
function computePageRank(nodes, edges, damping = 0.85, iterations = 40) {
  const ids = Object.keys(nodes);
  const n = ids.length;
  if (n === 0) return {};

  // outbound[id] = [targetIds...]
  const outbound = Object.create(null);
  for (const id of ids) outbound[id] = [];
  for (const e of edges) {
    if (outbound[e._src]) outbound[e._src].push(e._tgt);
  }

  let pr = Object.create(null);
  for (const id of ids) pr[id] = 1 / n;

  for (let iter = 0; iter < iterations; iter++) {
    const next = Object.create(null);
    const baseline = (1 - damping) / n;
    for (const id of ids) next[id] = baseline;

    let dangling = 0;
    for (const id of ids) {
      const outs = outbound[id];
      if (outs.length === 0) {
        dangling += pr[id];
      } else {
        const share = damping * pr[id] / outs.length;
        for (const tgt of outs) {
          if (next[tgt] !== undefined) next[tgt] += share;
        }
      }
    }
    // Distribute dangling mass
    const danglingShare = damping * dangling / n;
    for (const id of ids) next[id] += danglingShare;

    pr = next;
  }

  return pr;
}

/**
 * Build a lookup: obsidian-file-path -> store entry id
 */
function buildStoreLookup(store) {
  const byFile = Object.create(null);
  const byCategory = Object.create(null);
  if (!Array.isArray(store)) return { byFile, byCategory };

  for (const entry of store) {
    const meta = entry.metadata || {};
    if (meta.file) {
      // Graphify source_file is absolute, metadata.file is basename. Match both.
      byFile[meta.file] = entry.id;
      byFile[meta.file.toLowerCase()] = entry.id;
    }
    if (meta.category) {
      if (!byCategory[meta.category]) byCategory[meta.category] = [];
      byCategory[meta.category].push(entry.id);
    }
  }
  return { byFile, byCategory };
}

/**
 * Map graphify node to RuFlo store entry ID (or generate stable ID).
 */
function nodeToStoreId(gNode, lookup) {
  const src = gNode.source_file || '';
  if (src) {
    const basename = path.basename(src);
    if (lookup.byFile[basename]) return lookup.byFile[basename];
    if (lookup.byFile[basename.toLowerCase()]) return lookup.byFile[basename.toLowerCase()];
  }
  // Fallback: use graphify's own ID prefixed
  return `graphify-${gNode.id}`;
}

function main() {
  const graphify = readJSON(GRAPHIFY_PATH);
  if (!graphify || !graphify.nodes || !graphify.links) {
    log('graphify output missing or malformed — exiting');
    process.exit(0);
  }

  // Check staleness
  try {
    const stat = fs.statSync(GRAPHIFY_PATH);
    const ageDays = (Date.now() - stat.mtimeMs) / 86400000;
    if (ageDays > 7) {
      log(`WARN: graphify stale (${ageDays.toFixed(1)} days old) — run /graphify`);
    }
  } catch { /* ignore */ }

  const store = readJSON(STORE_PATH) || [];
  const lookup = buildStoreLookup(store);

  // Build nodes in RuFlo format
  const nodes = Object.create(null);
  const graphifyIdToRufloId = Object.create(null);

  for (const gNode of graphify.nodes) {
    const rufloId = nodeToStoreId(gNode, lookup);
    graphifyIdToRufloId[gNode.id] = rufloId;

    // Priority: folder-based type > graphify's extracted type > 'undefined'
    // Folder wins because it's deterministic and reflects user intent
    const pathType = inferTypeFromPath(gNode.source_file);
    const graphifyType = gNode.type || 'undefined';
    const nodeType = pathType || graphifyType;

    const existingStoreEntry = store.find(e => e.id === rufloId);
    const quality = (existingStoreEntry && (existingStoreEntry.quality || (existingStoreEntry.metadata && existingStoreEntry.metadata.quality))) || 'normal';

    nodes[rufloId] = {
      id: rufloId,
      category: nodeType,
      community: gNode.community !== undefined ? gNode.community : -1,
      confidence: existingStoreEntry ? (existingStoreEntry.metadata && existingStoreEntry.metadata.confidence) || 0.5 : 0.5,
      accessCount: 0,
      nodeType,
      graphifyType,                // preserve original for diagnostics
      typeFromFolder: !!pathType,  // true if folder-inferred
      typeWeight: TYPE_WEIGHTS[nodeType] !== undefined ? TYPE_WEIGHTS[nodeType] : 0.4,
      quality,
      label: gNode.label || gNode.id,
      sourceFile: gNode.source_file || null,
      createdAt: Date.now()
    };
  }

  // Build edges in RuFlo format, mapping graphify IDs
  const edges = [];
  for (const gEdge of graphify.links) {
    const srcId = graphifyIdToRufloId[gEdge._src] || graphifyIdToRufloId[gEdge.source];
    const tgtId = graphifyIdToRufloId[gEdge._tgt] || graphifyIdToRufloId[gEdge.target];
    if (!srcId || !tgtId || srcId === tgtId) continue;
    if (!nodes[srcId] || !nodes[tgtId]) continue;

    edges.push({
      _src: srcId,
      _tgt: tgtId,
      relationship: gEdge.relationship || 'related',
      confidence: gEdge.confidence_score || 0.7,
      type: gEdge.type || 'EXTRACTED'
    });
  }

  // Compute PageRank on the meaningful graph
  const pageRanks = computePageRank(nodes, edges, 0.85, 40);

  // Inject pageRank into each node
  for (const id of Object.keys(nodes)) {
    nodes[id].pageRank = pageRanks[id] || 0;
  }

  // Write back graph-state.json
  const graph = {
    version: 2,
    source: 'graphify',
    updatedAt: Date.now(),
    nodeCount: Object.keys(nodes).length,
    edgeCount: edges.length,
    nodes,
    edges,
    pageRanks
  };
  writeJSON(GRAPH_PATH, graph);

  // Also merge graphify-only nodes into auto-memory-store so rescorer can find them
  const storeIds = new Set((store || []).map(e => e.id));
  let addedToStore = 0;
  for (const id of Object.keys(nodes)) {
    if (!storeIds.has(id) && id.startsWith('graphify-')) {
      const n = nodes[id];
      store.push({
        id,
        key: id,
        content: `${n.nodeType}: ${n.label}${n.sourceFile ? ' (' + path.basename(n.sourceFile) + ')' : ''}`,
        summary: n.label,
        namespace: 'graphify',
        type: 'semantic',
        quality: n.quality,
        metadata: {
          fromGraphify: true,
          nodeType: n.nodeType,
          community: n.community,
          sourceFile: n.sourceFile,
          quality: n.quality
        },
        createdAt: Date.now()
      });
      addedToStore++;
    }
  }
  if (addedToStore > 0) writeJSON(STORE_PATH, store);

  const result = {
    status: 'ok',
    nodes: Object.keys(nodes).length,
    edges: edges.length,
    communities: new Set(Object.values(nodes).map(n => n.community)).size,
    addedToStore
  };
  log(`OK: ${result.nodes} nodes, ${result.edges} edges, ${result.communities} communities, +${addedToStore} to store`);
  console.log(`[GRAPHIFY-INT] ${result.nodes} nodes, ${result.edges} edges, ${result.communities} communities`);
  process.exit(0);
}

try {
  main();
} catch (e) {
  log(`FATAL: ${e.message}\n${e.stack}`);
  process.exit(0); // never block session
}
