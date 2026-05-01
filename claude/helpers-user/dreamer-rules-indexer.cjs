#!/usr/bin/env node
/**
 * Dreamer Rules Indexer
 *
 * Walks ~/.claude/learning/**\/*.md and extracts behavioral rules tagged with
 * <!-- (dream|bulk-dream|mega-dream) YYYY-MM-DD --> markers. Each rule becomes
 * an entry in auto-memory-store.json so they're vectorizable + semantically
 * searchable alongside Obsidian content.
 *
 * Rules ALSO continue to be raw-injected into every session via the existing
 * UserPromptSubmit hook flow — this indexer is ADDITIVE (vectorization on top
 * of injection, not replacement).
 *
 * Dedup: deterministic id based on rule content hash. Re-runs are idempotent.
 *
 * Output entries get namespace="rules-dreamer".
 *
 * Vectorization happens on next session-start via auto-memory-hook.mjs ONNX bridge.
 *
 * Run: node ~/.claude/helpers-user/dreamer-rules-indexer.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOME = process.env.HOME || '';
const LEARNING_DIR = path.join(HOME, '.claude', 'learning');
const STORE_PATH = path.join(HOME, '.claude-flow', 'data', 'auto-memory-store.json');

const MIN_RULE_LEN = 20;

// Match rule terminator markers: <!-- dream YYYY-MM-DD -->, <!-- bulk-dream ... -->, etc.
const RULE_MARKER = /<!--\s*(dream|bulk-dream|mega-dream)(?:\s+(\d{4}-\d{2}-\d{2}))?(?:\s+([^>]*?))?\s*-->/g;

function shortHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

function slugifyTitle(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      yield full;
    }
  }
}

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) {
    console.error(`[dreamer-rules] store not found: ${STORE_PATH}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
  return Array.isArray(raw) ? raw : (raw.entries || []);
}

function buildIdIndex(entries) {
  const ids = new Set();
  for (const e of entries) {
    if (e?.id) ids.add(e.id);
  }
  return ids;
}

// Extract rules from one .md file. Each rule = text BEFORE a marker, going back
// to the previous marker or document start. Strip headers and structural prose.
function extractRules(content) {
  const rules = [];
  let lastEnd = 0;
  let match;
  RULE_MARKER.lastIndex = 0;
  while ((match = RULE_MARKER.exec(content)) !== null) {
    const before = content.slice(lastEnd, match.index);
    // Strip markdown headers, "Apply to every agent." style preambles, blank lines
    const cleaned = before
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        if (!t) return false;
        if (/^#{1,6}\s/.test(t)) return false;            // markdown headers
        if (/^Apply to every agent\.?$/i.test(t)) return false;
        return true;
      })
      .join('\n')
      .trim();
    if (cleaned.length >= MIN_RULE_LEN) {
      rules.push({
        text: cleaned,
        markerType: match[1],         // dream | bulk-dream | mega-dream
        date: match[2] || null,
        extra: (match[3] || '').trim() || null,
      });
    }
    lastEnd = match.index + match[0].length;
  }
  return rules;
}

function deriveScope(relPath) {
  // agents/coder.md -> "agent:coder"
  // global.md -> "global"
  // anything else -> sluggified path
  if (relPath === 'global.md') return 'global';
  const m = relPath.match(/^agents\/([^/]+)\.md$/);
  if (m) return `agent:${m[1]}`;
  return relPath.replace(/\.md$/, '');
}

function summarize(text) {
  const firstSentence = text.split(/(?<=[.!?])\s/)[0] || text;
  return firstSentence.slice(0, 120);
}

function main() {
  if (!fs.existsSync(LEARNING_DIR)) {
    console.error(`[dreamer-rules] learning dir not found: ${LEARNING_DIR}`);
    process.exit(1);
  }

  const entries = loadStore();
  const knownIds = buildIdIndex(entries);
  const startCount = entries.length;

  let scannedFiles = 0;
  let rulesFound = 0;
  let added = 0;
  let skippedDup = 0;
  const byScope = Object.create(null);

  for (const filePath of walk(LEARNING_DIR)) {
    scannedFiles++;
    const relPath = path.relative(LEARNING_DIR, filePath);
    const scope = deriveScope(relPath);

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const rules = extractRules(content);
    rulesFound += rules.length;

    for (const rule of rules) {
      const hash = shortHash(rule.text);
      const id = `dreamer-rule-${scope.replace(/[^a-z0-9]+/gi, '-')}-${hash}`;

      if (knownIds.has(id)) {
        skippedDup++;
        continue;
      }

      const summary = summarize(rule.text);

      entries.push({
        id,
        key: id,
        content: rule.text,
        summary,
        namespace: 'rules-dreamer',
        type: 'behavioral-rule',
        quality: 'high',
        metadata: {
          fromDreamer: true,
          scope,
          markerType: rule.markerType,
          dreamDate: rule.date,
          dreamMeta: rule.extra,
          sourceFile: relPath,
          hash,
          quality: 'high',
        },
        createdAt: Date.now(),
      });

      added++;
      knownIds.add(id);
      byScope[scope] = (byScope[scope] || 0) + 1;
    }
  }

  if (added > 0) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(entries, null, 2), 'utf-8');
  }

  console.log(`[dreamer-rules] scanned=${scannedFiles} files, rules_found=${rulesFound}, added=${added}, skipped_dup=${skippedDup}`);
  console.log(`[dreamer-rules] store: ${startCount} -> ${entries.length}`);
  if (added > 0) {
    const breakdown = Object.entries(byScope)
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `${s}=${n}`)
      .join(', ');
    console.log(`[dreamer-rules] by scope: ${breakdown}`);
    console.log(`[dreamer-rules] vectorization: run on next session-start (auto-memory-hook ONNX bridge)`);
  }
}

main();
