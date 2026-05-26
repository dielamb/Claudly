#!/usr/bin/env node
/**
 * Obsidian Vault Indexer
 *
 * Walks ~/Desktop/Labirynt/**\/*.md and appends entries to auto-memory-store.json
 * for the orphan files that graphify pipeline misses (notes without wikilinks,
 * Calendar dailies, People, Sources, etc).
 *
 * Dedup: skips files whose relative path is already present as metadata.sourceFile
 * in any existing entry (graphify uses sourceFile too, so we don't duplicate).
 *
 * Output entries get namespace="obsidian-direct" so they're distinguishable from
 * the 675 graphify entries.
 *
 * Vectorization happens on next session-start via auto-memory-hook.mjs ONNX bridge.
 *
 * Run: node ~/.claude/helpers-user/obsidian-vault-indexer.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOME = process.env.HOME || '';
const VAULT = path.join(HOME, 'Desktop', 'Labirynt');
const STORE_PATH = path.join(HOME, '.claude-flow', 'data', 'auto-memory-store.json');

// Folders skipped (low signal / templates / unsorted)
const SKIP_DIRS = new Set([
  '0 Inbox',
  'templates',
  'Templates',
  '.obsidian',
  '.trash',
  'graphify-out',
]);

// Min content length to bother indexing (matches auto-memory-hook bridge threshold)
const MIN_CONTENT_LEN = 50;

function inferType(relPath) {
  const p = relPath.toLowerCase();
  if (p.startsWith('3 atlas/synthesis/')) return 'synthesis';
  if (p.startsWith('3 atlas/reasoning/')) return 'reasoning';
  if (p.startsWith('3 atlas/code/')) return 'pattern';
  if (p.startsWith('3 atlas/design/')) return 'design-principle';
  if (p.startsWith('3 atlas/problems/')) return 'problem-solution';
  if (p.startsWith('3 atlas/tools/')) return 'tool-note';
  if (p.startsWith('3 atlas/ideas/')) return 'idea';
  if (p.startsWith('3 atlas/career/')) return 'career';
  if (p.startsWith('1 calendar/')) return 'daily';
  if (p.startsWith('2 efforts/')) return 'effort';
  if (p.startsWith('4 people/')) return 'person';
  if (p.startsWith('5 sources/')) return 'source';
  if (p.startsWith('6 maps/')) return 'moc';
  return 'note';
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function shortHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

function firstLineTitle(content, fallback) {
  const m = content.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim().slice(0, 120);
  const firstLine = content.split('\n').find((l) => l.trim().length > 0);
  return (firstLine || fallback).trim().slice(0, 120);
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      yield full;
    }
  }
}

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
    return Array.isArray(raw) ? raw : (raw.entries || []);
  } catch (e) {
    // Store may be mid-write from a concurrent SessionStart hook — start fresh
    console.error(`[obsidian-indexer] store parse failed (race?): ${e.message}`);
    return [];
  }
}

function buildIndex(entries) {
  const bySource = new Set();
  for (const e of entries) {
    const sf = e?.metadata?.sourceFile;
    if (sf) bySource.add(sf);
  }
  return bySource;
}

function main() {
  if (!fs.existsSync(VAULT)) {
    console.error(`[obsidian-indexer] vault not found: ${VAULT}`);
    process.exit(1);
  }

  // Phase 1: scan vault and collect candidates (slow ~0.5s — other hooks run concurrently)
  let scanned = 0;
  const candidates = [];
  for (const filePath of walk(VAULT)) {
    scanned++;
    const relPath = path.relative(VAULT, filePath);
    const basename = path.basename(filePath);

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    if (content.length < MIN_CONTENT_LEN) continue;

    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      stat = { mtimeMs: Date.now() };
    }

    const type = inferType(relPath);
    const hash = shortHash(content);
    const title = firstLineTitle(content, basename.replace(/\.md$/, ''));
    const id = `obsidian-direct-${slugify(relPath)}`;
    candidates.push({ id, relPath, basename, content, type, hash, title, stat });
  }

  // Phase 2: late read — happens AFTER scan so concurrent hooks (graphify etc.) have finished
  // writing their entries. This preserves entries added by parallel hooks.
  const entries = loadStore();
  const knownSources = buildIndex(entries);
  const startCount = entries.length;

  let skippedDup = 0;
  let skippedShort = 0;
  let added = 0;
  const byType = Object.create(null);

  for (const { id, relPath, basename, content, type, hash, title, stat } of candidates) {
    // Dedup: also try basename match (graphify stores e.g. "vault-log.md", not full relPath)
    if (knownSources.has(relPath) || knownSources.has(basename)) {
      skippedDup++;
      continue;
    }
    if (content.length < MIN_CONTENT_LEN) {
      skippedShort++;
      continue;
    }

    entries.push({
      id,
      key: id,
      content,
      summary: title,
      namespace: 'obsidian-direct',
      type: 'semantic',
      quality: 'normal',
      metadata: {
        fromObsidian: true,
        nodeType: type,
        sourceFile: relPath,
        hash,
        mtime: stat.mtimeMs,
        quality: 'normal',
      },
      createdAt: Date.now(),
    });
    added++;
    byType[type] = (byType[type] || 0) + 1;
    knownSources.add(relPath);
  }

  if (added > 0) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(entries, null, 2), 'utf-8');
  }

  console.log(`[obsidian-indexer] scanned=${scanned} added=${added} skipped_dup=${skippedDup} skipped_short=${skippedShort}`);
  console.log(`[obsidian-indexer] store: ${startCount} -> ${entries.length}`);
  if (added > 0) {
    const breakdown = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t}=${n}`)
      .join(', ');
    console.log(`[obsidian-indexer] by type: ${breakdown}`);
    console.log(`[obsidian-indexer] vectorization: run on next session-start (auto-memory-hook ONNX bridge)`);
  }
}

main();
