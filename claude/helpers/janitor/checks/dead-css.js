'use strict';

/**
 * checkDeadCss({ htmlFiles, cssFiles }) → [{ selector, file, lines }]
 *
 * Finds CSS class selectors that are defined in CSS but never referenced in any HTML.
 *
 * @param {Object} params
 * @param {{ path: string, content: string }[]} params.htmlFiles
 * @param {{ path: string, content: string }[]} params.cssFiles
 * @returns {{ selector: string, file: string, lines: number[] }[]}
 */
function checkDeadCss({ htmlFiles, cssFiles }) {
  const combinedHtml = htmlFiles.map(f => f.content).join('\n');
  const usedClasses = extractUsedClasses(combinedHtml);

  const results = [];

  for (const cssFile of cssFiles) {
    const definitions = extractClassDefinitions(cssFile.content);

    for (const { selector, lines } of definitions) {
      if (shouldIgnore(selector)) continue;
      if (!usedClasses.has(selector)) {
        results.push({ selector, file: cssFile.path, lines });
      }
    }
  }

  return results;
}

// ── Internals ────────────────────────────────────────────────────────────────

/**
 * Strip /* ... *\/ comments from CSS text.
 * Preserves line count so line numbers remain accurate.
 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, match =>
    match.replace(/[^\n]/g, ' ')
  );
}

/**
 * Collect all class names actually used in HTML (class="..." attributes and
 * bare class tokens that appear as word-bounded strings).
 * Returns a Set<string> of plain class names (no leading dot).
 */
function extractUsedClasses(html) {
  const used = new Set();

  // Extract from class="..." and class='...' attributes
  const attrRe = /class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi;
  let m;
  while ((m = attrRe.exec(html)) !== null) {
    const value = m[1] ?? m[2] ?? m[3] ?? '';
    for (const cls of value.split(/\s+/)) {
      if (cls) used.add(cls);
    }
  }

  return used;
}

/**
 * Extract all class selectors defined in a CSS file, including inside @media.
 * Returns [{ selector: string, lines: number[] }] where:
 *   - selector is the bare class name (no leading dot)
 *   - lines is an array of 1-indexed line numbers where the selector appears
 *
 * Each unique (selector, first-occurrence-line) pair is deduplicated so that
 * a selector appearing in multiple rules produces one entry per rule block.
 */
function extractClassDefinitions(css) {
  const stripped = stripComments(css);
  const rawLines = stripped.split('\n');

  // Match .classname followed by whitespace, {, ,, :, [, >, +, ~ or end of string
  // Class names must start with a letter or underscore to avoid clamp()/calc() numbers
  const selectorRe = /\.([a-zA-Z_][\w-]*)\s*(?=[{,\s:.[\]>+~]|$)/g;

  // Track (selector, lineNumber) pairs; deduplicate by that key
  const seen = new Set();
  const bySelector = new Map(); // selector → lines[]

  rawLines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const trimmed = line.trim();

    // Skip @keyframes rules and @media / @supports lines themselves
    if (/^@keyframes\b/.test(trimmed)) return;
    if (/^@[a-z-]+\s/.test(trimmed) && !trimmed.includes('{')) return;

    let match;
    selectorRe.lastIndex = 0;
    while ((match = selectorRe.exec(line)) !== null) {
      const name = match[1];
      const key = `${name}:${lineNo}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (!bySelector.has(name)) bySelector.set(name, []);
      bySelector.get(name).push(lineNo);
    }
  });

  return Array.from(bySelector.entries()).map(([selector, lines]) => ({
    selector,
    lines,
  }));
}

/**
 * Returns true for selectors that should never be flagged as dead.
 *
 * Ignored:
 *   - Pseudo-selectors: :hover, :focus, :active, ::before, ::after
 *     (the reference implementation ignores these globally, so we skip any
 *      selector name that is only ever used with a pseudo — handled upstream
 *      by the caller stripping pseudo context; here we guard the name itself)
 *   - Selectors starting with html, body, *, [data-
 *   - @keyframes keyframe names
 */
function shouldIgnore(selector) {
  // These element-level names are caught by the ignore prefixes below,
  // but listed explicitly for clarity
  const IGNORE_PREFIXES = ['html', 'body'];

  for (const prefix of IGNORE_PREFIXES) {
    if (selector === prefix || selector.startsWith(prefix + '-')) return true;
  }

  // The raw name should never be a pseudo token (callers pass bare names)
  // Guard anyway: if somehow a colon crept in, ignore it
  if (selector.includes(':')) return true;

  return false;
}

module.exports = { checkDeadCss };
