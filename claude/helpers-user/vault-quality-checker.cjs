#!/usr/bin/env node
/**
 * Vault Quality Checker (P2d)
 *
 * Post-edit hook. When Write/Edit touches a vault file in Problems/, Code/, Design/,
 * Synthesis/, Reasoning/, checks:
 *   - Does frontmatter exist?
 *   - Is `quality` field present?
 *   - If not, suggest quality based on content signals
 *
 * Output goes to stderr (visible in Claude Code but non-blocking).
 *
 * Hook input: JSON with tool info including file path.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || '';
const VAULT_PREFIX = path.join(HOME, 'Desktop', 'Labirynt');

// Folders where quality field is required
const QUALITY_REQUIRED_FOLDERS = [
  '3 Atlas/Problems',
  '3 Atlas/Code',
  '3 Atlas/Design',
  '3 Atlas/Synthesis',
  '3 Atlas/Reasoning'
];

function readHookInput() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8');
    if (stdin && stdin.trim()) {
      try { return JSON.parse(stdin); } catch { return { raw: stdin }; }
    }
  } catch { /* no stdin */ }
  return {};
}

function extractFilePath(input) {
  // Possible shapes: {tool_input: {file_path: ...}}, {file_path: ...}, argv
  if (input.tool_input && input.tool_input.file_path) return input.tool_input.file_path;
  if (input.file_path) return input.file_path;
  if (input.path) return input.path;
  return process.argv[2] || null;
}

function isVaultFile(filePath) {
  if (!filePath) return false;
  const abs = path.resolve(filePath);
  if (!abs.startsWith(VAULT_PREFIX)) return false;
  return QUALITY_REQUIRED_FOLDERS.some(f => abs.includes(path.join(VAULT_PREFIX, f)));
}

function parseFrontmatter(content) {
  const match = content && content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { hasFm: false, fm: {} };
  const result = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) result[key] = value;
  }
  return { hasFm: true, fm: result };
}

function suggestQuality(content) {
  const lower = content.toLowerCase();
  const len = content.length;

  const strugglePhrases = [
    /\bfinally\b/i, /\bwreszcie\b/i,
    /\bafter\s+\d+\s*(h|hour|godz)/i, /\bpo\s+\d+\s*(h|godz)/i,
    /\bbreakthrough\b/i, /\bprzełom/i
  ];
  const struggleHits = strugglePhrases.filter(p => p.test(lower)).length;

  if (struggleHits >= 2 || (struggleHits >= 1 && len > 2000)) return 'high';
  if (len < 300) return 'low';
  return 'normal';
}

function main() {
  const input = readHookInput();
  const filePath = extractFilePath(input);
  if (!filePath || !isVaultFile(filePath)) process.exit(0);

  // Only check markdown files
  if (!filePath.endsWith('.md')) process.exit(0);

  let content;
  try { content = fs.readFileSync(filePath, 'utf-8'); } catch { process.exit(0); }
  if (!content || content.length < 50) process.exit(0);

  const { hasFm, fm } = parseFrontmatter(content);
  const hasQuality = (fm.quality || '').trim().length > 0;

  if (hasQuality) process.exit(0); // all good

  const suggested = suggestQuality(content);
  const filename = path.basename(filePath);

  process.stderr.write(
    `[QUALITY-MISSING] ${filename} has no 'quality' in frontmatter.\n` +
    `  → Suggested: quality: ${suggested}\n` +
    `  → Add to frontmatter: high (breakthrough), normal (routine), low (trivia)\n` +
    `  → Without quality, pattern has default scoring (no boost, no filter).\n`
  );
  process.exit(0);
}

try {
  main();
} catch (e) {
  process.exit(0);
}
