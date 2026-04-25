#!/usr/bin/env node
/**
 * portfolio-drift-check.js
 * Drift detector for Portfolio www_v2.
 *
 * Usage: node portfolio-drift-check.js [path-to-www_v2]
 * Default: __HOME__/Desktop/Portfolio/www_v2
 *
 * Checks:
 *   CHECK-01  stroke-draw data-delay units (must be seconds, < 10)
 *   CHECK-02  data-reveal on pinned elements (forbidden inside .pin-content)
 *   CHECK-03  .active CSS rules exist for every .proj--XX class
 *   CHECK-04  no hardcoded oklch() values in CSS
 *   CHECK-05  no dead CSS selectors (class unused in any HTML)
 *   CHECK-06  no dead JS DOM references (querySelector targets missing from HTML)
 *
 * Output: console + drift-reports/YYYY-MM-DD.md
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Config ───────────────────────────────────────────────────────────────────

const ROOT = process.argv[2] || '__HOME__/Desktop/Portfolio/www_v2';
const REPORT_DIR = '__HOME__/Desktop/Labirynt/3 Atlas/Domains/portfolio/drift-reports';

const INDEX_HTML   = path.join(ROOT, 'index.html');
const INDEX_CSS    = path.join(ROOT, 'css', 'index.css');
const CSS_DIR      = path.join(ROOT, 'css');
const JS_DIR       = path.join(ROOT, 'js');

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function readAllCss(cssDir) {
  const cssFiles = [];
  if (!fs.existsSync(cssDir)) return cssFiles;
  for (const name of fs.readdirSync(cssDir)) {
    if (name.endsWith('.css')) {
      const full = path.join(cssDir, name);
      cssFiles.push({ file: full, name, content: readFile(full) });
    }
  }
  return cssFiles;
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

// Strip CSS block comments (non-greedy, handles multiline).
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Parse index.html and find all elements that have BOTH data-stroke-draw AND data-delay.
 * Returns Array<{ tag: string, delay: number, context: string }>
 */
function findStrokeDrawDelays(html) {
  const results = [];
  // Find all tags containing data-stroke-draw
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)[^>]*data-stroke-draw[^>]*>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[1];
    const fullTag = m[0];
    const delayMatch = fullTag.match(/data-delay=["']?([^"'\s>]+)["']?/);
    if (delayMatch) {
      results.push({
        tag,
        delay: parseFloat(delayMatch[1]),
        context: fullTag.slice(0, 80).replace(/\n/g, ' ')
      });
    }
  }
  return results;
}

/**
 * Find pin-content sections in HTML and check for data-reveal inside them.
 * Returns Array<{ pinSection: string, element: string, attrValue: string }>
 */
function findDataRevealInPinContent(html) {
  const violations = [];
  // Split on pin-content opening tags to find boundaries
  // Strategy: find each .pin-content block and scan its interior
  const pinRe = /class="[^"]*\bpin-content\b[^"]*"/g;
  let m;
  while ((m = pinRe.exec(html)) !== null) {
    const start = m.index;
    // Find the wrapping tag's opening bracket
    let tagStart = start;
    while (tagStart > 0 && html[tagStart] !== '<') tagStart--;

    // Walk forward to find matching closing tag
    // Count depth of the pin-content element
    let depth = 0;
    let pos = tagStart;
    let firstTag = true;
    let pinTagName = 'section'; // default
    const tagNameMatch = html.slice(tagStart, tagStart + 30).match(/<([a-zA-Z][a-zA-Z0-9]*)/);
    if (tagNameMatch) pinTagName = tagNameMatch[1];

    const openRe  = new RegExp(`<${pinTagName}[\\s>]`, 'g');
    const closeRe = new RegExp(`</${pinTagName}>`, 'g');

    openRe.lastIndex  = tagStart;
    closeRe.lastIndex = tagStart;

    // Simple depth tracker
    let end = html.length;
    let tmpPos = tagStart;
    depth = 0;
    while (tmpPos < html.length) {
      const nextOpen  = html.indexOf(`<${pinTagName}`, tmpPos);
      const nextClose = html.indexOf(`</${pinTagName}>`, tmpPos);
      if (nextOpen === -1 && nextClose === -1) break;
      if (nextClose === -1 || (nextOpen !== -1 && nextOpen < nextClose)) {
        depth++;
        tmpPos = nextOpen + 1;
      } else {
        depth--;
        tmpPos = nextClose + 1;
        if (depth === 0) {
          end = nextClose + `</${pinTagName}>`.length;
          break;
        }
      }
    }

    const interior = html.slice(tagStart, end);

    // Look for data-reveal inside this pin-content
    const revealRe = /<([a-zA-Z][a-zA-Z0-9]*)[^>]*data-reveal=["']?([^"'\s>]*)["']?[^>]*>/g;
    let rm;
    while ((rm = revealRe.exec(interior)) !== null) {
      const elemTag = rm[1];
      const revealVal = rm[2];
      const classMatch = rm[0].match(/class=["']([^"']+)["']/);
      const elemClass = classMatch ? classMatch[1].split(/\s+/)[0] : elemTag;
      violations.push({
        element: `.${elemClass}`,
        attrValue: revealVal,
        context: rm[0].slice(0, 80).replace(/\n/g, ' ')
      });
    }
  }
  return violations;
}

/**
 * Find all .proj--XX classes used in HTML files.
 */
function findProjClasses(htmlContents) {
  const classes = new Set();
  const re = /\bproj--[\w-]+\b/g;
  for (const { content } of htmlContents) {
    let m;
    while ((m = re.exec(content)) !== null) {
      classes.add(m[0]);
    }
  }
  return [...classes];
}

/**
 * Check if a proj-- class has any .active rules in index.css.
 */
function hasActiveCssRule(cssContent, projClass) {
  const stripped = stripCssComments(cssContent);
  // Look for .projClass.active or .projClass .something.active or inside .active .projClass
  const patterns = [
    new RegExp(`\\.${projClass}\\.active`, 'g'),
    new RegExp(`\\.${projClass}[\\s.#:]*\\.active`, 'g'),
    new RegExp(`\\.active[^{]*\\.${projClass}`, 'g'),
    // Also check .proj--XX.active written split across selector list
  ];
  return patterns.some(p => p.test(stripped));
}

/**
 * Find all hardcoded oklch() values not preceded by "from var(".
 * Returns Array<{ file: string, line: number, value: string }>
 */
function findHardcodedOklch(cssFiles) {
  const results = [];
  for (const { file, name, content } of cssFiles) {
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      // Skip comment lines
      if (/^\s*\/\*/.test(line)) return;
      // Find oklch( not preceded by "from var("
      const oklchRe = /oklch\([^)]+\)/g;
      let m;
      while ((m = oklchRe.exec(line)) !== null) {
        // Check context before this match: last 20 chars
        const before = line.slice(Math.max(0, m.index - 20), m.index);
        if (/from\s+var\s*\(/.test(before)) continue;
        results.push({ file: name, line: idx + 1, value: m[0] });
      }
    });
  }
  return results;
}

/**
 * Find dead CSS class selectors - classes defined in index.css but never used in any HTML.
 * Returns Array<{ selector: string }>
 */
function findDeadCssSelectors(indexCssContent, htmlContents) {
  const stripped = stripCssComments(indexCssContent);
  // Find all class names defined as selectors
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
    // Check in HTML: class="... cls ..." or class='... cls ...'
    // and also JS references
    const inHtml = new RegExp(`\\b${cls}\\b`).test(combinedHtml);
    if (!inHtml) {
      dead.push(cls);
    }
  }
  return dead;
}

/**
 * Find dead JS DOM references.
 * Returns Array<{ selector: string, file: string, line: number, code: string }>
 */
function findDeadJsRefs(jsFiles, htmlContents) {
  const combinedHtml = htmlContents.map(h => h.content).join('\n');
  const results = [];

  // querySelector('...'), querySelectorAll('...'), getElementById('...')
  const qsRe = /querySelector(?:All)?\s*\(\s*['"`]([^'"`]+)['"`]/g;
  const gbidRe = /getElementById\s*\(\s*['"`]([^'"`]+)['"`]/g;

  for (const { file, name, content } of jsFiles) {
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      // querySelector / querySelectorAll
      let m;
      const qsCopy = new RegExp(qsRe.source, 'g');
      while ((m = qsCopy.exec(line)) !== null) {
        const sel = m[1];
        if (!isDomSelectorInHtml(sel, combinedHtml)) {
          results.push({ selector: sel, file: name, line: idx + 1, code: line.trim() });
        }
      }

      // getElementById
      const gbidCopy = new RegExp(gbidRe.source, 'g');
      while ((m = gbidCopy.exec(line)) !== null) {
        const id = m[1];
        const idSel = `#${id}`;
        if (!isDomSelectorInHtml(idSel, combinedHtml)) {
          results.push({ selector: idSel, file: name, line: idx + 1, code: line.trim() });
        }
      }
    });
  }

  return results;
}

/**
 * Check if a CSS selector string resolves to something in the HTML.
 * Handles: .class, #id, [attr], tagname, and compound selectors.
 */
function isDomSelectorInHtml(selector, html) {
  // Strip leading/trailing whitespace
  selector = selector.trim();
  if (!selector) return true; // empty selector - skip

  // Split compound selectors (space, >, +, ~) and check the last meaningful part
  const parts = selector.split(/[\s>+~]+/).filter(Boolean);
  const last = parts[parts.length - 1];

  // Class selector
  const classMatch = last.match(/^\.([\w-]+)/);
  if (classMatch) {
    return new RegExp(`\\b${classMatch[1]}\\b`).test(html);
  }

  // ID selector
  const idMatch = last.match(/^#([\w-]+)/);
  if (idMatch) {
    return new RegExp(`\\bid="${idMatch[1]}"`, 'i').test(html) ||
           new RegExp(`\\bid='${idMatch[1]}'`, 'i').test(html);
  }

  // Attribute selector [attr] or [attr=val]
  const attrMatch = last.match(/^\[([^\]]+)\]/);
  if (attrMatch) {
    const attr = attrMatch[1].split('=')[0].replace(/[~|^$*]$/, '');
    return new RegExp(`\\b${attr}\\b`).test(html);
  }

  // Tag name - always assume present (too broad to check)
  if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(last)) return true;

  // Unknown/complex - pass through
  return true;
}

// ── Checks ───────────────────────────────────────────────────────────────────

function check01(html) {
  const items = findStrokeDrawDelays(html);
  const fails = items.filter(i => i.delay > 10);
  if (fails.length === 0) {
    return { id: 'CHECK-01', status: 'PASS', message: 'all stroke-draw delays < 10', details: [] };
  }
  return {
    id: 'CHECK-01',
    status: 'FAIL',
    message: `${fails.length} stroke-draw delay(s) look like milliseconds`,
    details: fails.map(f =>
      `data-delay=${f.delay} on <${f.tag}> - should be seconds (e.g. 0.2 not 200)`
    )
  };
}

function check02(html) {
  const violations = findDataRevealInPinContent(html);
  // Deduplicate by selector
  const unique = [];
  const seen = new Set();
  for (const v of violations) {
    const key = `${v.element}:${v.attrValue}`;
    if (!seen.has(key)) { seen.add(key); unique.push(v); }
  }
  if (unique.length === 0) {
    return { id: 'CHECK-02', status: 'PASS', message: 'no data-reveal inside pin-content', details: [] };
  }
  return {
    id: 'CHECK-02',
    status: 'FAIL',
    message: `${unique.length} data-reveal attribute(s) found inside pin-content`,
    details: unique.map(v =>
      `data-reveal="${v.attrValue}" on ${v.element} inside pin-section - use .section.active .element CSS instead`
    )
  };
}

function check03(htmlContents, indexCssContent) {
  const projClasses = findProjClasses(htmlContents);
  const missing = projClasses.filter(cls => !hasActiveCssRule(indexCssContent, cls));
  if (missing.length === 0) {
    return { id: 'CHECK-03', status: 'PASS', message: 'all proj-- classes have .active rules', details: [] };
  }
  return {
    id: 'CHECK-03',
    status: 'WARN',
    message: `${missing.length} proj-- class(es) missing .active CSS rules`,
    details: missing.map(cls => `No .active rules found for .${cls} in index.css`)
  };
}

function check04(cssFiles) {
  const hits = findHardcodedOklch(cssFiles);
  if (hits.length === 0) {
    return { id: 'CHECK-04', status: 'PASS', message: 'no hardcoded oklch() values', details: [] };
  }
  return {
    id: 'CHECK-04',
    status: 'FAIL',
    message: `${hits.length} hardcoded oklch() value(s) found`,
    details: hits.map(h => `Hardcoded oklch() at line ${h.line} in ${h.file}: ${h.value}`)
  };
}

function check05(indexCssContent, htmlContents) {
  const dead = findDeadCssSelectors(indexCssContent, htmlContents);
  if (dead.length === 0) {
    return { id: 'CHECK-05', status: 'PASS', message: 'no dead CSS selectors', details: [] };
  }
  const label = dead.length === 1 ? 'selector' : 'selectors';
  return {
    id: 'CHECK-05',
    status: 'WARN',
    message: `${dead.length} dead ${label}: ${dead.map(d => '.' + d).join(', ')}`,
    details: dead.map(d => `Dead selector: .${d} - 0 HTML references`)
  };
}

function check06(jsFiles, htmlContents) {
  const dead = findDeadJsRefs(jsFiles, htmlContents);
  // Deduplicate
  const seen = new Set();
  const unique = dead.filter(d => {
    const key = `${d.selector}:${d.file}:${d.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length === 0) {
    return { id: 'CHECK-06', status: 'PASS', message: 'no dead JS DOM references', details: [] };
  }
  return {
    id: 'CHECK-06',
    status: 'WARN',
    message: `${unique.length} dead JS ref(s) found`,
    details: unique.map(d => `Dead JS ref: '${d.selector}' in ${d.file}:${d.line} - not found in HTML`)
  };
}

// ── Report formatting ────────────────────────────────────────────────────────

function statusPad(status) {
  return status.padEnd(4);
}

function formatReport(results, date) {
  const lines = [`=== Portfolio Drift Report - ${date} ===`, ''];

  for (const r of results) {
    lines.push(`${r.id} ${statusPad(r.status)}  ${r.message}`);
    if (r.details.length > 0) {
      for (const d of r.details) {
        lines.push(`         ${d}`);
      }
    }
  }

  lines.push('');
  const fails = results.filter(r => r.status === 'FAIL').length;
  const warns = results.filter(r => r.status === 'WARN').length;
  const passes = results.filter(r => r.status === 'PASS').length;
  lines.push(`Summary: ${fails} FAIL, ${warns} WARN, ${passes} PASS`);
  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const today = new Date().toISOString().slice(0, 10);

  // Validate project root
  if (!fs.existsSync(ROOT)) {
    console.error(`ERROR: Project root not found: ${ROOT}`);
    process.exit(1);
  }
  if (!fs.existsSync(INDEX_HTML)) {
    console.error(`ERROR: index.html not found at ${INDEX_HTML}`);
    process.exit(1);
  }

  const indexHtml      = readFile(INDEX_HTML);
  const indexCss       = readFile(INDEX_CSS);
  const htmlContents   = readAllHtml(ROOT);
  const cssFiles       = readAllCss(CSS_DIR);
  const jsFiles        = readAllJs(JS_DIR);

  const results = [
    check01(indexHtml),
    check02(indexHtml),
    check03(htmlContents, indexCss),
    check04(cssFiles),
    check05(indexCss, htmlContents),
    check06(jsFiles, htmlContents),
  ];

  const report = formatReport(results, today);
  console.log(report);

  // Write to drift-reports directory
  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }
  const reportFile = path.join(REPORT_DIR, `${today}.md`);
  fs.writeFileSync(reportFile, report, 'utf8');
  console.log(`\nReport saved: ${reportFile}`);

  // Exit code: 1 if any FAIL, 0 otherwise
  const hasFail = results.some(r => r.status === 'FAIL');
  process.exit(hasFail ? 1 : 0);
}

main();
