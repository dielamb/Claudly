'use strict';

/**
 * checkDeadJs({ htmlFiles, jsFiles }) → [{ ref, file, line, type }]
 *
 * Detects querySelector / querySelectorAll / getElementById /
 * getElementsByClassName calls whose targets are absent from every HTML file.
 *
 * Skips:
 *   - Calls where the selector argument is dynamically constructed
 *     (template literals with ${…}, string concatenation with +)
 *   - Calls inside single-line or block comments
 *
 * @param {{ htmlFiles: {path:string, content:string}[],
 *            jsFiles:  {path:string, content:string}[] }} opts
 * @returns {{ ref:string, file:string, line:number,
 *             type:'querySelector'|'getElementById'|'class' }[]}
 */
function checkDeadJs({ htmlFiles, jsFiles }) {
  const combinedHtml = htmlFiles.map(f => f.content).join('\n');

  // ── Patterns ────────────────────────────────────────────────────────────────

  // Matches only plain string literals (single, double, or backtick without ${)
  const STATIC_STR = '([\'"`])([^\'"`\\\\${}]+)\\1';

  const QS_RE    = new RegExp(`querySelector(?:All)?\\s*\\(\\s*${STATIC_STR}`, 'g');
  const GBID_RE  = new RegExp(`getElementById\\s*\\(\\s*${STATIC_STR}`, 'g');
  const GBCN_RE  = new RegExp(`getElementsByClassName\\s*\\(\\s*${STATIC_STR}`, 'g');

  // ── HTML presence tests ─────────────────────────────────────────────────────

  function hasId(id) {
    // id="foo" or id='foo'
    return new RegExp(`\\bid=["']${escRx(id)}["']`, 'i').test(combinedHtml);
  }

  function hasClass(cls) {
    return new RegExp(`\\b${escRx(cls)}\\b`).test(combinedHtml);
  }

  function selectorExists(sel) {
    sel = sel.trim();
    if (!sel) return true;

    // Walk the selector right-to-left — only check the rightmost simple selector
    const parts = sel.split(/[\s>+~]+/).filter(Boolean);
    const last  = parts[parts.length - 1];

    // #id
    const idMatch = last.match(/^#([\w-]+)/);
    if (idMatch) return hasId(idMatch[1]);

    // .class (pick the first class token)
    const clsMatch = last.match(/\.([\w-]+)/);
    if (clsMatch) return hasClass(clsMatch[1]);

    // [attr] — check attribute name is present anywhere in HTML
    const attrMatch = last.match(/^\[([^=\]~|^$*]+)/);
    if (attrMatch) return new RegExp(`\\b${escRx(attrMatch[1].trim())}\\b`).test(combinedHtml);

    // Plain tag selector — always assume it exists (html, body, div…)
    return true;
  }

  // ── Comment stripping ───────────────────────────────────────────────────────

  function stripComments(src) {
    // Remove block comments (/* … */) and line comments (// …)
    // Replace with same-length whitespace to preserve line numbers
    return src
      .replace(/\/\*[\s\S]*?\*\//g,  m => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g,        m => ' '.repeat(m.length));
  }

  // ── Core scan ───────────────────────────────────────────────────────────────

  const results = [];
  const seen    = new Set();

  for (const { path: filePath, content } of jsFiles) {
    const src   = stripComments(content);
    const lines = src.split('\n');

    lines.forEach((line, idx) => {
      const lineNo = idx + 1;

      // querySelector / querySelectorAll
      for (const m of matchAll(line, QS_RE)) {
        const sel = m[2];
        if (!selectorExists(sel)) {
          push(results, seen, { ref: sel, file: filePath, line: lineNo, type: 'querySelector' });
        }
      }

      // getElementById
      for (const m of matchAll(line, GBID_RE)) {
        const id  = m[2];
        const sel = `#${id}`;
        if (!hasId(id)) {
          push(results, seen, { ref: sel, file: filePath, line: lineNo, type: 'getElementById' });
        }
      }

      // getElementsByClassName
      for (const m of matchAll(line, GBCN_RE)) {
        const cls = m[2];
        if (!hasClass(cls)) {
          push(results, seen, { ref: cls, file: filePath, line: lineNo, type: 'class' });
        }
      }
    });
  }

  return results;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escRx(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchAll(str, re) {
  const copy = new RegExp(re.source, re.flags);
  const out  = [];
  let m;
  while ((m = copy.exec(str)) !== null) out.push(m);
  return out;
}

function push(results, seen, entry) {
  const key = `${entry.type}:${entry.ref}:${entry.file}:${entry.line}`;
  if (seen.has(key)) return;
  seen.add(key);
  results.push(entry);
}

module.exports = { checkDeadJs };
