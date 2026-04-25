#!/usr/bin/env node
/**
 * Router History Retention
 *
 * Caps ~/.claude-flow/data/router-history.json at 1000 most recent entries.
 * RuFlo's intelligence.cjs appends to this file but never truncates —
 * grows unbounded (currently 71KB, will hit MB in months).
 *
 * Runs on SessionEnd.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || '';
const ROUTER_HISTORY_PATH = path.join(HOME, '.claude-flow', 'data', 'router-history.json');
const LOG_PATH = path.join(HOME, 'logs', 'router-retention.log');

const MAX_ENTRIES = 1000;

function log(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* non-fatal */ }
}

function main() {
  if (!fs.existsSync(ROUTER_HISTORY_PATH)) {
    process.exit(0);
  }

  let history;
  try {
    history = JSON.parse(fs.readFileSync(ROUTER_HISTORY_PATH, 'utf-8'));
  } catch (e) {
    log(`Corrupt router-history.json: ${e.message}`);
    process.exit(0);
  }

  if (!Array.isArray(history)) process.exit(0);

  const originalSize = history.length;
  if (originalSize <= MAX_ENTRIES) {
    process.exit(0);
  }

  // Keep last MAX_ENTRIES (most recent — file is append-only so tail = newest)
  const trimmed = history.slice(-MAX_ENTRIES);
  fs.writeFileSync(ROUTER_HISTORY_PATH, JSON.stringify(trimmed, null, 2));

  log(`Trimmed router-history.json: ${originalSize} -> ${trimmed.length} entries`);
  console.log(`[ROUTER-RETENTION] ${originalSize} -> ${trimmed.length}`);
}

try {
  main();
} catch (e) {
  log(`FATAL: ${e.message}`);
  process.exit(0);
}
