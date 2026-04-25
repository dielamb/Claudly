#!/usr/bin/env node
/**
 * portfolio-slop-check.js
 * Actionable delete list extending CHECK-05 and CHECK-06.
 *
 * Usage: node portfolio-slop-check.js [path-to-www_v2]
 * Default: __HOME__/Desktop/Portfolio/www_v2
 *
 * For each dead CSS selector: prints exact line range to delete in index.css.
 * For each dead JS ref: prints exact line to review in the JS file.
 *
 * Output is an actionable list — nothing else.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Config ───────────────────────────────────────────────────────────────────

const ROOT      = process.argv[2] || '__HOME__/Desktop/Portfolio/www_v2';
const INDEX_CSS = path.join(ROOT, 'css', 'index.css');
const CSS_DIR   = path.join(ROOT, 'css');
const JS_DIR    = path.join(ROOT, 'js');

// ── Helpers (shared with drift-check) ────────────────────────────────────────

function readFile(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function readAllHtml(root) {
  const htmlFiles = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name.endsWith('.html')) htmlFiles.push(full);
    }
  }
  walk(root);
  return htmlFiles.map(f => ({ file: f, content: readFile(f) }));
}

function readAllJs(jsDir) {
  const jsFiles = [];
  if (!fs.existsSync(jsDir)) return jsFiles;
  for (const name of fs.readdirSync(jsDir)) {
    if (name.endsWith('.js') && !name.includes('.min.')) {
      const full = path.join(jsDir, name);
      jsFiles.push({ file: full, name, content: readFile(full) });
    }
  }
  return jsFiles;
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// ── CSS block range finder ───────────────────────────────────────────────────

/**
 * Find ALL rule blocks for a given class selector in index.css.
 * Returns Array<{ startLine: number, endLine: number, preview: string }>
 * Lines are 1-indexed.
 *
 * Handles:
 *   - Single-class selectors: .foo { ... }
 *   - Multi-selector rules:   .foo, .bar { ... }
 *   - Nested/scoped selectors: .parent .foo { ... }
 *   - Pseudo-classes/elements: .foo:hover { ... }
 *   - Media query blocks that contain .foo
 */
function findCssBlockRanges(css, className) {
  const lines = css.split('\n');
  const stripped = stripCssComments(css).split('\n');
  const results = [];

  // We match selector lines that reference the class
  // A selector line ends with { and contains the class name
  const classPattern = new RegExp(`\\.${escapeRegex(className)}\\b`);

  let i = 0;
  while (i < stripped.length) {
    const line = stripped[i];
    const trimmed = line.trim();

    // A rule start: line contains our class and ends with { (possibly multiline selector)
    if (classPattern.test(trimmed) && trimmed.includes('{')) {
      const startLine = i + 1; // 1-indexed

      // Walk forward to find the matching closing brace
      let depth = 0;
      let j = i;
      while (j < stripped.length) {
        for (const ch of stripped[j]) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
        if (depth === 0) break;
        j++;
      }
      const endLine = j + 1; // 1-indexed

      // Preview: first original line of the block
      const preview = lines[i].trim().slice(0, 60);
      results.push({ startLine, endLine, preview });
      i = j + 1;
      continue;
    }

    // Also catch multi-line selectors where our class is on a continuation line
    // e.g.:
    //   .parent
    //   .foo {
    if (classPattern.test(trimmed) && !trimmed.includes('{') && !trimmed.includes('}')) {
      // Look ahead for the opening brace
      let k = i + 1;
      while (k < stripped.length) {
        const next = stripped[k].trim();
        if (next.includes('{')) {
          // Found the opening brace — now find start of this selector block
          const startLine = i + 1;
          let depth = 0;
          let j = k;
          while (j < stripped.length) {
            for (const ch of stripped[j]) {
              if (ch === '{') depth++;
              else if (ch === '}') depth--;
            }
            if (depth === 0) break;
            j++;
          }
          const endLine = j + 1;
          const preview = lines[i].trim().slice(0, 60);
          results.push({ startLine, endLine, preview });
          i = j + 1;
          break;
        }
        if (next.includes('}') || next.startsWith('.') || next.startsWith('#') || next === '') {
          break; // not a continuation, abort
        }
        k++;
      }
      if (k >= stripped.length || stripped[k].trim().includes('{')) continue;
    }

    i++;
  }

  return results;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Dead selector detection (same logic as drift-check) ─────────────────────

function findDeadCssSelectors(indexCssContent, htmlContents) {
  const stripped = stripCssComments(indexCssContent);
  const allCssClasses = new Set();
  // Class names must start with a letter or underscore (not a digit — avoids clamp() numbers)
  const re = /\.([a-zA-Z_][\w-]*)\s*[{,:.[\s>+~]/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    allCssClasses.add(m[1]);
  }

  const combinedHtml = htmlContents.map(h => h.content).join('\n');
  const dead = [];

  for (const cls of allCssClasses) {
    const inHtml = new RegExp(`\\b${cls}\\b`).test(combinedHtml);
    if (!inHtml) dead.push(cls);
  }
  return dead;
}

// ── Dead JS ref detection (same logic as drift-check) ────────────────────────

function isDomSelectorInHtml(selector, html) {
  selector = selector.trim();
  if (!selector) return true;
  const parts = selector.split(/[\s>+~]+/).filter(Boolean);
  const last = parts[parts.length - 1];

  const classMatch = last.match(/^\.([\w-]+)/);
  if (classMatch) return new RegExp(`\\b${classMatch[1]}\\b`).test(html);

  const idMatch = last.match(/^#([\w-]+)/);
  if (idMatch) {
    return new RegExp(`\\bid="${idMatch[1]}"`, 'i').test(html) ||
           new RegExp(`\\bid='${idMatch[1]}'`, 'i').test(html);
  }

  const attrMatch = last.match(/^\[([^\]]+)\]/);
  if (attrMatch) {
    const attr = attrMatch[1].split('=')[0].replace(/[~|^$*]$/, '');
    return new RegExp(`\\b${attr}\\b`).test(html);
  }

  if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(last)) return true;
  return true;
}

function findDeadJsRefs(jsFiles, htmlContents) {
  const combinedHtml = htmlContents.map(h => h.content).join('\n');
  const results = [];
  const qsRe   = /querySelector(?:All)?\s*\(\s*['"`]([^'"`]+)['"`]/g;
  const gbidRe = /getElementById\s*\(\s*['"`]([^'"`]+)['"`]/g;

  for (const { file, name, content } of jsFiles) {
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      let m;
      const qsCopy = new RegExp(qsRe.source, 'g');
      while ((m = qsCopy.exec(line)) !== null) {
        const sel = m[1];
        if (!isDomSelectorInHtml(sel, combinedHtml)) {
          results.push({ selector: sel, file: name, filePath: file, line: idx + 1, code: line.trim() });
        }
      }
      const gbidCopy = new RegExp(gbidRe.source, 'g');
      while ((m = gbidCopy.exec(line)) !== null) {
        const id = m[1];
        if (!isDomSelectorInHtml(`#${id}`, combinedHtml)) {
          results.push({ selector: `#${id}`, file: name, filePath: file, line: idx + 1, code: line.trim() });
        }
      }
    });
  }

  // Deduplicate
  const seen = new Set();
  return results.filter(d => {
    const key = `${d.selector}:${d.file}:${d.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(ROOT)) {
    console.error(`ERROR: Project root not found: ${ROOT}`);
    process.exit(1);
  }

  const indexCssContent = readFile(INDEX_CSS);
  const htmlContents    = readAllHtml(ROOT);
  const jsFiles         = readAllJs(JS_DIR);

  if (!indexCssContent) {
    console.error(`ERROR: css/index.css not found at ${INDEX_CSS}`);
    process.exit(1);
  }

  const deadSelectors = findDeadCssSelectors(indexCssContent, htmlContents);
  const deadJsRefs    = findDeadJsRefs(jsFiles, htmlContents);

  const output = [];

  // ── Dead CSS selectors with exact line ranges ─────────────────────────────
  if (deadSelectors.length > 0) {
    output.push('--- Dead CSS Selectors (index.css) ---');
    output.push('');

    for (const cls of deadSelectors) {
      const blocks = findCssBlockRanges(indexCssContent, cls);
      if (blocks.length === 0) {
        // Selector appears in CSS but couldn't locate block (may be inside a comment or complex rule)
        output.push(`REVIEW .${cls} in css/index.css - could not locate block boundaries`);
      } else {
        for (const block of blocks) {
          output.push(`DELETE lines ${block.startLine}-${block.endLine} in css/index.css: .${cls}`);
          output.push(`       (${block.preview})`);
        }
      }
    }
    output.push('');
  } else {
    output.push('--- Dead CSS Selectors: none ---');
    output.push('');
  }

  // ── Dead JS DOM references with exact lines ───────────────────────────────
  if (deadJsRefs.length > 0) {
    output.push('--- Dead JS DOM References ---');
    output.push('');
    for (const ref of deadJsRefs) {
      output.push(`REVIEW line ${ref.line} in ${ref.file}: ${ref.code}`);
    }
    output.push('');
  } else {
    output.push('--- Dead JS DOM References: none ---');
    output.push('');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalBlocks = deadSelectors.reduce((sum, cls) => {
    return sum + findCssBlockRanges(indexCssContent, cls).length;
  }, 0);

  output.push(`Total: ${totalBlocks} CSS block(s) to delete, ${deadJsRefs.length} JS line(s) to review`);

  console.log(output.join('\n'));
}

main();
