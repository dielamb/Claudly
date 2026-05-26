'use strict';

/**
 * janitor/projects/portfolio.js
 * Project config + custom checks for Portfolio www_v2.
 *
 * Consumed by the nightly janitor runner. Exports the standard module shape:
 *   { name, root, enabled, getHtmlFiles, getCssFiles, getJsFiles, customChecks }
 *
 * customChecks ports CHECK-01 through CHECK-04 from portfolio-drift-check.js.
 * CHECK-05 (dead CSS) and CHECK-06 (dead JS) are handled by the runner's
 * built-in dead-css / dead-js passes using the file-list helpers below.
 */

const fs   = require('fs');
const path = require('path');

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Read a file, return '' when it does not exist. */
function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return '';
  }
}

/** Recursively collect files matching a predicate under dir. */
function walkFiles(dir, predicate) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const recurse = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_) {
      return; // unreadable directory — skip gracefully
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        recurse(full);
      } else if (predicate(entry.name)) {
        results.push({ path: full, content: readFile(full) });
      }
    }
  };

  recurse(dir);
  return results;
}

/** Strip CSS block comments (handles multiline). */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// ── CHECK-01 helpers ─────────────────────────────────────────────────────────

/**
 * Find all elements with data-stroke-draw AND data-delay.
 * Returns Array<{ tag, delay, rawDelay, lineNumber, context }>
 * lineNumber is 1-based within the file content.
 */
function findStrokeDrawDelays(content) {
  const results = [];
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    if (!line.includes('data-stroke-draw')) return;

    const tagMatch = line.match(/<([a-zA-Z][a-zA-Z0-9]*)[^>]*data-stroke-draw[^>]*>/);
    if (!tagMatch) return;

    const delayMatch = tagMatch[0].match(/data-delay=["']?([^"'\s>]+)["']?/);
    if (!delayMatch) return;

    const rawDelay = delayMatch[1];
    const delay    = parseFloat(rawDelay);

    results.push({
      tag:        tagMatch[1],
      delay,
      rawDelay,
      lineNumber: idx + 1,
      context:    tagMatch[0].slice(0, 80).replace(/\n/g, ' '),
    });
  });

  return results;
}

// ── CHECK-02 helpers ─────────────────────────────────────────────────────────

/**
 * Find all data-reveal attributes that appear inside a .pin-content element.
 * Returns Array<{ element, attrValue, lineNumber, context }>
 *
 * Strategy: locate each .pin-content opening tag, walk to its matching
 * close tag (depth-tracking on the tag name), then scan that substring
 * for data-reveal occurrences.
 */
function findDataRevealInPinContent(content) {
  const violations = [];

  const pinRe = /class="[^"]*\bpin-content\b[^"]*"/g;
  let m;

  while ((m = pinRe.exec(content)) !== null) {
    // Walk back to the '<' that opens this element
    let tagStart = m.index;
    while (tagStart > 0 && content[tagStart] !== '<') tagStart--;

    const tagNameMatch = content.slice(tagStart, tagStart + 40).match(/<([a-zA-Z][a-zA-Z0-9]*)/);
    const pinTagName   = tagNameMatch ? tagNameMatch[1] : 'section';

    // Depth-track to find the matching closing tag
    let depth  = 0;
    let pos    = tagStart;
    let end    = content.length;
    const open  = `<${pinTagName}`;
    const close = `</${pinTagName}>`;

    while (pos < content.length) {
      const nextOpen  = content.indexOf(open,  pos);
      const nextClose = content.indexOf(close, pos);

      if (nextOpen === -1 && nextClose === -1) break;

      if (nextClose === -1 || (nextOpen !== -1 && nextOpen < nextClose)) {
        depth++;
        pos = nextOpen + 1;
      } else {
        depth--;
        pos = nextClose + 1;
        if (depth === 0) {
          end = nextClose + close.length;
          break;
        }
      }
    }

    const interior = content.slice(tagStart, end);

    // Find 1-based line number of tagStart in the full content
    const linesBeforePin = content.slice(0, tagStart).split('\n').length;

    const revealRe = /<([a-zA-Z][a-zA-Z0-9]*)[^>]*data-reveal=["']?([^"'\s>]*)["']?[^>]*/g;
    let rm;
    while ((rm = revealRe.exec(interior)) !== null) {
      const classMatch = rm[0].match(/class=["']([^"']+)["']/);
      const elemClass  = classMatch
        ? classMatch[1].trim().split(/\s+/)[0]
        : rm[1];

      // Compute line number within interior, offset by pin start
      const linesBeforeReveal = interior.slice(0, rm.index).split('\n').length - 1;
      const lineNumber = linesBeforePin + linesBeforeReveal;

      violations.push({
        element:    `.${elemClass}`,
        attrValue:  rm[2],
        lineNumber,
        context:    rm[0].slice(0, 80).replace(/\n/g, ' '),
      });
    }
  }

  // Deduplicate by element + value
  const seen = new Set();
  return violations.filter(v => {
    const key = `${v.element}:${v.attrValue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── CHECK-03 helpers ─────────────────────────────────────────────────────────

/** Collect all .proj--XX classes referenced in a set of HTML file contents. */
function findProjClasses(htmlFiles) {
  const classes = new Set();
  const re = /\bproj--[\w-]+\b/g;
  for (const { content } of htmlFiles) {
    let m;
    while ((m = re.exec(content)) !== null) classes.add(m[0]);
  }
  return [...classes];
}

/**
 * Return true if any .active rule exists for projClass in the given CSS text.
 * Handles: .projClass.active, .projClass .child.active, .active .projClass
 */
function hasActiveCssRule(cssContent, projClass) {
  const stripped = stripCssComments(cssContent);
  const escaped  = projClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    new RegExp(`\\.${escaped}\\.active`),
    new RegExp(`\\.${escaped}[\\s.#:]*\\.active`),
    new RegExp(`\\.active[^{]*\\.${escaped}`),
  ].some(p => p.test(stripped));
}

// ── CHECK-04 helpers ─────────────────────────────────────────────────────────

/**
 * Find hardcoded oklch() values not preceded by "from var(".
 * Returns Array<{ line, value }> (line is 1-based within the file).
 */
function findHardcodedOklch(content) {
  const results = [];
  const lines   = content.split('\n');

  lines.forEach((line, idx) => {
    // Skip full-line block-comment openers
    if (/^\s*\/\*/.test(line)) return;

    const oklchRe = /oklch\([^)]+\)/g;
    let m;
    while ((m = oklchRe.exec(line)) !== null) {
      const before = line.slice(Math.max(0, m.index - 20), m.index);
      if (/from\s+var\s*\(/.test(before)) continue;
      results.push({ line: idx + 1, value: m[0] });
    }
  });

  return results;
}

// ── Module export ────────────────────────────────────────────────────────────

const ROOT = '__HOME__/Desktop/Portfolio/www_v2';

module.exports = {
  name:    'portfolio',
  root:    ROOT,
  enabled: true,

  // ── File-list helpers ──────────────────────────────────────────────────────

  getHtmlFiles(root) {
    return walkFiles(root, name => name.endsWith('.html'));
  },

  getCssFiles(root) {
    const cssDir = path.join(root, 'css');
    return walkFiles(cssDir, name => name.endsWith('.css'));
  },

  getJsFiles(root) {
    const jsDir = path.join(root, 'js');
    return walkFiles(jsDir, name =>
      name.endsWith('.js') && !name.includes('.min.')
    );
  },

  // ── Custom checks ──────────────────────────────────────────────────────────

  /**
   * Run all portfolio-specific checks.
   * Returns Array<{ check, severity, message, file, line }>
   *   severity: 'error' | 'warning' | 'info'
   *   file/line may be null when the finding is aggregate.
   */
  customChecks(root) {
    const findings = [];

    // Resolve key paths; abort gracefully if root is absent
    if (!fs.existsSync(root)) return findings;

    const indexHtmlPath = path.join(root, 'index.html');
    const indexCssPath  = path.join(root, 'css', 'index.css');

    const indexHtml    = readFile(indexHtmlPath);
    const indexCssText = readFile(indexCssPath);
    const htmlFiles    = module.exports.getHtmlFiles(root);
    const cssFiles     = module.exports.getCssFiles(root);

    // ── CHECK-01: stroke-draw data-delay units ───────────────────────────────
    // data-delay must be in seconds. Values >= 10 are almost certainly ms.
    if (indexHtml) {
      const delays = findStrokeDrawDelays(indexHtml);
      for (const item of delays) {
        if (item.delay >= 10) {
          findings.push({
            check:    'CHECK-01',
            severity: 'error',
            message:  `data-delay="${item.rawDelay}" on <${item.tag}> looks like milliseconds — must be seconds (e.g. 0.2, not 200)`,
            file:     indexHtmlPath,
            line:     item.lineNumber,
          });
        }
      }
    }

    // ── CHECK-02: data-reveal forbidden inside .pin-content ─────────────────
    // Reveals inside pinned sections must use .section.active CSS instead.
    if (indexHtml) {
      const violations = findDataRevealInPinContent(indexHtml);
      for (const v of violations) {
        findings.push({
          check:    'CHECK-02',
          severity: 'error',
          message:  `data-reveal="${v.attrValue}" on ${v.element} inside .pin-content — use .section.active .element CSS instead`,
          file:     indexHtmlPath,
          line:     v.lineNumber,
        });
      }
    }

    // ── CHECK-03: .active CSS must exist for every .proj--XX class ───────────
    // Missing .active rules break project card activation.
    if (indexCssText && htmlFiles.length > 0) {
      const projClasses = findProjClasses(htmlFiles);
      for (const cls of projClasses) {
        if (!hasActiveCssRule(indexCssText, cls)) {
          findings.push({
            check:    'CHECK-03',
            severity: 'warning',
            message:  `No .active rule found for .${cls} in css/index.css`,
            file:     indexCssPath,
            line:     null,
          });
        }
      }
    }

    // ── CHECK-04: no hardcoded oklch() values in CSS ─────────────────────────
    // All color values must reference design tokens via var().
    for (const { path: filePath, content } of cssFiles) {
      const hits = findHardcodedOklch(content);
      for (const hit of hits) {
        findings.push({
          check:    'CHECK-04',
          severity: 'error',
          message:  `Hardcoded oklch() value "${hit.value}" — use a CSS custom property instead`,
          file:     filePath,
          line:     hit.line,
        });
      }
    }

    return findings;
  },
};
