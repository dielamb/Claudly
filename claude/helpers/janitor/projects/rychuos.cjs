'use strict';

/**
 * Janitor project config — RychuOS
 *
 * Vanilla static site: index.html, brain.html, server.py served at localhost:8741.
 * No build step. Colors defined via Tailwind config object (oklch values) and
 * CSS custom properties in brain.html. Alpine.js + D3 loaded from CDN.
 */

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = '__HOME__/RychuOS';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read a file from the project, returning null if it doesn't exist.
 * @param {string} relPath - path relative to PROJECT_ROOT
 * @returns {string|null}
 */
function readProjectFile(relPath) {
  const abs = path.join(PROJECT_ROOT, relPath);
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Walk all HTML files in the project root (non-recursive; RychuOS is flat).
 * @returns {Array<{rel: string, content: string}>}
 */
function htmlFiles() {
  let entries;
  try {
    entries = fs.readdirSync(PROJECT_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.html'))
    .map((e) => ({ rel: e.name, content: readProjectFile(e.name) }))
    .filter((f) => f.content !== null);
}

// ── Custom checks ─────────────────────────────────────────────────────────────

/**
 * Check: no inline style attributes with hardcoded color values.
 *
 * Acceptable: oklch() calls, var(--*), named keywords (transparent, inherit,
 * currentColor). Flagged: #rrggbb, rgb(), rgba(), hsl(), hsla(), raw named
 * colors (e.g. "red", "blue") when used as a color property value in a style
 * attribute.
 *
 * Note: RychuOS deliberately uses oklch() strings inside its Tailwind config
 * block and CSS rules — those are fine. This check only targets inline style=""
 * attributes on HTML elements.
 */
function checkInlineHardcodedColors() {
  const findings = [];

  // Matches style="..." or style='...' (single-line; sufficient for this codebase)
  const styleAttrRe = /style\s*=\s*["']([^"']+)["']/g;

  // Color property names we care about
  const colorProps = [
    'color', 'background', 'background-color', 'border-color',
    'border-top-color', 'border-right-color', 'border-bottom-color',
    'border-left-color', 'outline-color', 'text-decoration-color',
    'fill', 'stroke',
  ];
  const colorPropRe = new RegExp(
    `(?:^|;)\\s*(${colorProps.join('|')})\\s*:\\s*([^;]+)`,
    'gi',
  );

  // Values that indicate a hardcoded color (not a CSS variable or oklch)
  const hardcodedRe =
    /^(?:#[0-9a-f]{3,8}|rgb\s*\(|rgba\s*\(|hsl\s*\(|hsla\s*\(|(?:red|blue|green|yellow|black|white|gray|grey|pink|orange|purple|teal|navy|maroon|olive|coral|cyan|magenta|lime|indigo|violet|gold|silver|beige)\s*(?:$|[;!]))/i;

  for (const { rel, content } of htmlFiles()) {
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      let styleMatch;
      styleAttrRe.lastIndex = 0;
      while ((styleMatch = styleAttrRe.exec(line)) !== null) {
        const styleValue = styleMatch[1];
        let propMatch;
        colorPropRe.lastIndex = 0;
        while ((propMatch = colorPropRe.exec(styleValue)) !== null) {
          const value = propMatch[2].trim();
          if (
            !value.startsWith('var(') &&
            !value.startsWith('oklch(') &&
            !value.startsWith('inherit') &&
            !value.startsWith('transparent') &&
            !value.startsWith('currentColor') &&
            hardcodedRe.test(value)
          ) {
            findings.push({
              file: rel,
              line: idx + 1,
              message: `Hardcoded color in inline style: \`${propMatch[1]}: ${value}\` — use a CSS variable or oklch() token instead`,
            });
          }
        }
      }
    });
  }

  return {
    name: 'no-inline-hardcoded-colors',
    description: 'Inline style attributes must use CSS variables or oklch() tokens, not raw color values',
    findings,
  };
}

/**
 * Check: <script> tags loading non-critical scripts without defer or async.
 *
 * "Non-critical" means any external script that is NOT Alpine.js (which already
 * uses defer in this project). Tailwind CDN and D3 are flagged when missing
 * both attributes, since they block HTML parsing.
 *
 * Module scripts (<script type="module">) are deferred by the browser spec and
 * are excluded. Inline scripts (no src) are also excluded — they run in order
 * and adding defer/async to them is meaningless.
 */
function checkScriptDeferAsync() {
  const findings = [];

  // Pattern: <script ... src="..." ...> without defer or async
  // We parse line-by-line to get line numbers; scripts rarely span many lines in this project.
  const scriptTagRe = /<script\b([^>]*)>/gi;

  for (const { rel, content } of htmlFiles()) {
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      let m;
      scriptTagRe.lastIndex = 0;
      while ((m = scriptTagRe.exec(line)) !== null) {
        const attrs = m[1];

        // Skip inline scripts (no src)
        if (!/\bsrc\s*=/i.test(attrs)) continue;

        // Module scripts are implicitly deferred
        if (/\btype\s*=\s*["']module["']/i.test(attrs)) continue;

        const hasDefer = /\bdefer\b/i.test(attrs);
        const hasAsync = /\basync\b/i.test(attrs);

        if (!hasDefer && !hasAsync) {
          // Extract the src value for the message
          const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
          const src = srcMatch ? srcMatch[1] : '(unknown src)';
          findings.push({
            file: rel,
            line: idx + 1,
            message: `<script src="${src}"> is missing defer or async — it blocks HTML parsing`,
          });
        }
      }
    });
  }

  return {
    name: 'script-defer-async',
    description: 'External <script> tags on non-critical scripts should use defer or async to avoid render-blocking',
    findings,
  };
}

/**
 * Check: dead CSS selectors.
 *
 * Extracts class selectors from inline <style> blocks in HTML files, then
 * checks each against the full HTML markup across all project HTML files.
 * A selector is considered "dead" if no element in the markup could match it.
 *
 * Scope: class selectors only (.foo, .foo:hover, .foo.bar). ID and element
 * selectors are skipped — too noisy and often set dynamically via Alpine.js.
 *
 * Alpine.js dynamic classes (x-bind:class, :class expressions) make full
 * static analysis impossible; we therefore only flag selectors with zero
 * occurrences of the base class name anywhere in the HTML markup.
 */
function checkDeadCssSelectors() {
  const findings = [];

  const files = htmlFiles();
  if (files.length === 0) return { name: 'dead-css-selectors', description: 'Dead CSS selectors (classes defined but never referenced in markup)', findings };

  // Collect all markup text (all HTML files combined) for class reference search
  const allMarkup = files.map((f) => f.content).join('\n');

  // Extract inline <style> blocks
  const styleBlockRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;

  // Match class selectors (base name extraction)
  // Captures: .chip, .chip:hover, .chip.active-orange, .chip::before etc.
  const classSelectorRe = /\.([\w-]+)(?:[:\s.,+~>#[\](){}\n]|$)/g;

  // Track which selectors we've already reported (dedupe across files)
  const reported = new Set();

  for (const { rel, content } of files) {
    let styleMatch;
    styleBlockRe.lastIndex = 0;
    while ((styleMatch = styleBlockRe.exec(content)) !== null) {
      const cssText = styleMatch[1];
      let classMatch;
      classSelectorRe.lastIndex = 0;
      while ((classMatch = classSelectorRe.exec(cssText)) !== null) {
        const className = classMatch[1];

        // Skip utility-like names that are generated at runtime or used by
        // Alpine.js / Tailwind internals
        if (
          className === 'active' ||
          className.startsWith('x-') ||
          reported.has(className)
        ) {
          continue;
        }

        // Check if the class name appears anywhere in the markup
        // We search for: class="...<name>...", :class, x-bind, or dynamic expressions
        const appearsInMarkup =
          allMarkup.includes(`"${className}`) ||
          allMarkup.includes(`'${className}`) ||
          allMarkup.includes(` ${className}`) ||
          allMarkup.includes(`\t${className}`) ||
          // Alpine.js string interpolation: `active-${...}` patterns
          allMarkup.includes(`-${className}`) ||
          allMarkup.includes(`${className}-`);

        if (!appearsInMarkup) {
          reported.add(className);
          findings.push({
            file: rel,
            line: null,
            message: `CSS class \`.${className}\` is defined in a <style> block but never referenced in any HTML markup`,
          });
        }
      }
    }
  }

  return {
    name: 'dead-css-selectors',
    description: 'Dead CSS selectors (classes defined in <style> blocks but never referenced in markup)',
    findings,
  };
}

// ── Export ────────────────────────────────────────────────────────────────────

module.exports = {
  /** Absolute path to the project root */
  projectRoot: PROJECT_ROOT,

  /** Human-readable project name */
  name: 'RychuOS',

  /** File globs to include in general janitor checks (relative to projectRoot) */
  include: ['*.html', 'server.py', '*.sh', '*.json'],

  /** File globs to always exclude */
  exclude: ['__pycache__/**', '.git/**', '*.pyc', 'node_modules/**'],

  /**
   * Custom checks specific to this project.
   * Each function returns: { name, description, findings: Array<{file, line?, message}> }
   */
  customChecks: [
    checkInlineHardcodedColors,
    checkScriptDeferAsync,
    checkDeadCssSelectors,
  ],

  /**
   * Dead-CSS runner configuration.
   * The janitor runner's built-in dead-css check uses these paths.
   */
  deadCss: {
    cssFiles: [],          // No standalone .css files; styles are inline
    htmlFiles: ['*.html'], // All HTML files in project root
  },
};
