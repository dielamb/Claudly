#!/usr/bin/env node
'use strict';
/**
 * Shared vault utilities for scripts that need to read Obsidian note titles.
 * No external dependencies — only Node.js built-ins.
 */

const fs = require('fs');
const path = require('path');

const VAULT_ROOT = path.join(process.env.HOME || '__HOME__', 'Desktop', 'Labirynt');

/**
 * Scans the three knowledge-layer directories in the Obsidian vault and returns
 * an array of note titles (filenames without the .md extension).
 *
 * Directories scanned:
 *   3 Atlas/Problems  — reactive problem capture
 *   3 Atlas/Tools     — tool/MCP documentation
 *   3 Atlas/Synthesis — cross-domain synthesis notes
 *
 * Notes:
 *   - Missing directories are silently skipped (graceful degradation).
 *   - The pipe character `|` is replaced with `-` because Obsidian treats `|`
 *     as an alias separator inside wikilinks; leaving it in the title would
 *     break any [[Title|alias]] that Haiku might emit.
 *   - All other characters (spaces, parentheses, dashes, unicode) are preserved
 *     so that wikilinks round-trip back to the exact filesystem path.
 *
 * @returns {string[]} Sorted array of note titles, deduplicated across dirs.
 */
function loadVaultNoteTitles() {
  const SCAN_DIRS = [
    '3 Atlas/Problems',
    '3 Atlas/Tools',
    '3 Atlas/Synthesis',
  ];

  const seen = new Set();
  const titles = [];

  for (const rel of SCAN_DIRS) {
    const dirPath = path.join(VAULT_ROOT, rel);

    let entries;
    try {
      entries = fs.readdirSync(dirPath);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        // Directory does not exist — skip silently.
        continue;
      }
      // Unexpected error (permissions, I/O) — surface it so callers can act.
      throw err;
    }

    for (const filename of entries) {
      if (!filename.endsWith('.md')) continue;
      // Strip extension; normalise pipe to avoid wikilink alias breakage.
      const title = filename.slice(0, -3).replace(/\|/g, '-');
      if (!seen.has(title)) {
        seen.add(title);
        titles.push(title);
      }
    }
  }

  return titles.sort();
}

module.exports = { loadVaultNoteTitles };
