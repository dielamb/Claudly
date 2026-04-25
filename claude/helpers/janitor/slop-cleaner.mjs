/**
 * slop-cleaner.js — Batch CSS deletion engine for the overnight janitor.
 *
 * ESM module, zero external npm deps.
 *
 * Entry point:
 *   export async function runSlopCleaner(projectConfig, options)
 *
 * Algorithm (design doc §1):
 *   1. Run dead-css detection → raw candidates
 *   2. Score each candidate (0–100 clamped)
 *   3. Split: auto-remove (score ≥ 70) vs flag-only (score < 70)
 *   4. Process auto-remove in batches of batchSize, sorted score desc
 *   5. Per batch:
 *      a. Create git branch `janitor/slop-YYYYMMDD` if not exists
 *      b. Remove CSS blocks from files
 *      c. Layer 1 safety: re-run dead-css, verify delta is correct
 *      d. Layer 2 safety: verify no HTML file references the removed selectors
 *      e. Any layer failure → git restore files, aborted=true, return
 *      f. dryRun → skip git ops, collect what would be removed
 *      g. Commit: `janitor(projectName): remove N dead CSS selectors (scores X-Y)`
 *   6. Return summary
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── validate-html.js is ESM — lazy dynamic import ────────────────────────────

let _validateHtml = null;
async function getValidateHtml() {
  if (!_validateHtml) {
    _validateHtml = await import('./safety/validate-html.js');
  }
  return _validateHtml;
}

// ── Dead-CSS detection ────────────────────────────────────────────────────────
//
// Mirrors the logic from checks/dead-css.js (which is CJS and cannot be
// required from an ESM module when package.json has type:module).
// Both files must stay in sync if the detection logic changes.

/**
 * Strip CSS block comments, preserving line count so line numbers stay accurate.
 */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, match =>
    match.replace(/[^\n]/g, ' '),
  );
}

/**
 * Collect all class names used in HTML (class="..." attributes).
 * Returns Set<string> of bare class names (no leading dot).
 */
function extractUsedClasses(html) {
  const used = new Set();
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
 * Extract all class selectors defined in CSS text.
 * Returns [{ selector: string (bare name), lines: number[] }]
 */
function extractClassDefinitions(css) {
  const stripped = stripCssComments(css);
  const rawLines = stripped.split('\n');
  const selectorRe = /\.([a-zA-Z_][\w-]*)\s*(?=[{,\s:.[\]>+~]|$)/g;

  const seen = new Set();
  const bySelector = new Map();

  rawLines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const trimmed = line.trim();
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
 */
function shouldIgnore(selector) {
  const IGNORE_PREFIXES = ['html', 'body'];
  for (const prefix of IGNORE_PREFIXES) {
    if (selector === prefix || selector.startsWith(prefix + '-')) return true;
  }
  if (selector.includes(':')) return true;
  return false;
}

/**
 * Find CSS class selectors defined in cssFiles but never referenced in htmlFiles.
 * Returns [{ selector: string (bare), file: string (abs path), lines: number[] }]
 */
function runDeadCssCheck({ htmlFiles, cssFiles }) {
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

// ── Constants ─────────────────────────────────────────────────────────────────

const AUTO_REMOVE_THRESHOLD = 70;
const DEFAULT_BATCH_SIZE = 5;

// Risk modifier patterns
const JS_TOGGLE_PATTERNS = ['active', 'open', 'hidden', 'visible'];
const ANIMATION_PATTERNS = ['animate', 'transition', 'reveal'];

// ── Date helper ───────────────────────────────────────────────────────────────

function yyyymmdd(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

// ── Regex escape ──────────────────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Git helpers ───────────────────────────────────────────────────────────────

/**
 * Run a git command in cwd. Returns trimmed stdout. Throws on non-zero exit.
 */
function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
    .toString()
    .trim();
}

function branchExists(name, cwd) {
  try {
    git(['rev-parse', '--verify', name], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create branch if it does not exist; check it out either way.
 */
function ensureBranch(name, cwd) {
  if (branchExists(name, cwd)) {
    git(['checkout', name], cwd);
  } else {
    git(['checkout', '-b', name], cwd);
  }
}

/**
 * Restore all tracked files to HEAD (rolls back uncommitted changes).
 */
function restoreFiles(cwd) {
  try {
    git(['checkout', 'HEAD', '--', '.'], cwd);
  } catch {
    // Best-effort rollback; orchestrator owns branch cleanup.
  }
}

// ── File list resolution ──────────────────────────────────────────────────────

function resolveFileLists(projectConfig) {
  const root = projectConfig.root;

  const htmlFiles =
    typeof projectConfig.getHtmlFiles === 'function'
      ? projectConfig.getHtmlFiles(root)
      : [];

  const cssFiles =
    typeof projectConfig.getCssFiles === 'function'
      ? projectConfig.getCssFiles(root)
      : [];

  const jsFiles =
    typeof projectConfig.getJsFiles === 'function'
      ? projectConfig.getJsFiles(root)
      : [];

  return { htmlFiles, cssFiles, jsFiles };
}

// ── Confidence scoring ────────────────────────────────────────────────────────

/**
 * Determine the base score for a dead-css candidate.
 *
 * Design doc base scores:
 *   100 — selector not found in any HTML/JS file (pure dead)
 *    80 — selector found only in commented-out HTML
 *    60 — selector found in HTML but no matching element exists in DOM
 *    40 — selector found once, but in a template/include file (ambiguous)
 */
function baseScore(selectorName, htmlFiles, jsFiles) {
  const combinedHtml = htmlFiles.map(f => f.content).join('\n');
  const combinedJs = jsFiles.map(f => f.content).join('\n');

  const inHtml = combinedHtml.includes(selectorName);

  if (!inHtml) {
    return 100; // pure dead
  }

  // Check if found only in HTML comments
  const htmlWithoutComments = combinedHtml.replace(/<!--[\s\S]*?-->/g, '');
  const inLiveHtml = htmlWithoutComments.includes(selectorName);

  if (!inLiveHtml) {
    return 80; // only in commented-out HTML
  }

  // In live HTML — check JS for dynamic toggling
  const inJs = combinedJs.includes(selectorName);

  if (!inJs) {
    return 60; // in live HTML but dead element (no DOM match via static scan)
  }

  // Found in both HTML and JS — likely a template or dynamically-used class
  return 40;
}

/**
 * Compute additive/subtractive modifiers per the design doc formula.
 */
function computeModifiers(selectorName, projectConfig, jsFiles, htmlFiles) {
  let mod = 0;

  // +10 — name does not match design-token patterns
  // (design tokens: CSS custom properties, oklch vars, state utility prefixes)
  const isTokenLike =
    selectorName.startsWith('--') ||
    /^(oklch|var|is|has|not|where|any)[\s(-]/.test(selectorName);
  if (!isTokenLike) {
    mod += 10;
  }

  // +10 — no CSS file touched in the last 90 days (git log)
  const projectRoot = projectConfig.root;
  try {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const logOut = git(['log', '--since', since, '--', '*.css'], projectRoot);
    if (!logOut) {
      mod += 10;
    }
  } catch {
    // Not a git repo or git unavailable — skip modifier
  }

  // -20 — name contains JS-toggled risk keyword
  const lowerName = selectorName.toLowerCase();
  if (JS_TOGGLE_PATTERNS.some(p => lowerName.includes(p))) {
    mod -= 20;
  }

  // -20 — name contains animation state keyword
  if (ANIMATION_PATTERNS.some(p => lowerName.includes(p))) {
    mod -= 20;
  }

  // -15 — selector appears in a <link rel="preload"> or data-* attribute
  const combinedHtml = htmlFiles.map(f => f.content).join('\n');
  const preloadBlockRe = /<link[^>]+rel=["']preload["'][^>]*>/gi;
  let pl;
  while ((pl = preloadBlockRe.exec(combinedHtml)) !== null) {
    if (pl[0].includes(selectorName)) {
      mod -= 15;
      break;
    }
  }

  const dataAttrRe = new RegExp(
    `data-[^=]+=['"][^'"]*${escapeRegex(selectorName)}[^'"]*['"]`,
  );
  if (dataAttrRe.test(combinedHtml)) {
    mod -= 15;
  }

  // -10 — project config marks selector as dynamically added
  if (
    Array.isArray(projectConfig.dynamicallyAdded) &&
    projectConfig.dynamicallyAdded.includes(selectorName)
  ) {
    mod -= 10;
  }

  return mod;
}

/**
 * Score a single dead-css candidate. Returns integer clamped to [0, 100].
 */
function scoreCandidate(rawItem, htmlFiles, jsFiles, projectConfig) {
  const name = rawItem.selector; // bare, no dot
  const base = baseScore(name, htmlFiles, jsFiles);
  const mods = computeModifiers(name, projectConfig, jsFiles, htmlFiles);
  return Math.max(0, Math.min(100, base + mods));
}

// ── Issue builder ─────────────────────────────────────────────────────────────

/**
 * Build a canonical Issue from a raw dead-css result and a score.
 *
 * @param {{ selector: string, file: string, lines: number[] }} rawItem
 * @param {number} score
 * @param {string} projectRoot
 * @returns {{ selector: string, file: string, line: number, confidence: number, action: 'remove'|'flag', reason: string }}
 */
function buildIssue(rawItem, score, projectRoot) {
  const { selector, file, lines } = rawItem;
  const line = lines && lines.length > 0 ? lines[0] : 0;
  const relFile = path.relative(projectRoot, file);

  const action = score >= AUTO_REMOVE_THRESHOLD ? 'remove' : 'flag';

  let reason;
  if (score >= 90) {
    reason = 'Not found in any HTML or JS file.';
  } else if (score >= 80) {
    reason = 'Found only in commented-out HTML.';
  } else if (score >= 70) {
    reason = 'Not found in live HTML; possible JS-toggled or animation class.';
  } else if (score >= 50) {
    reason = 'Found in HTML/JS but usage is ambiguous — manual review needed.';
  } else {
    reason = 'HIGH RISK: likely JS-toggled, animation state, or dynamically added class.';
  }

  return {
    selector: `.${selector}`,
    file: `${relFile}:${line}`,
    line,
    confidence: score,
    action,
    reason,
  };
}

// ── CSS block removal ─────────────────────────────────────────────────────────

/**
 * Returns true if a selector string (possibly with pseudo-classes, combinators, etc.)
 * contains `dotSelector` as a standalone class token.
 *
 * Examples:
 *   isSelectorMatch('.foo:hover', '.foo')     → true
 *   isSelectorMatch('.bar .foo', '.foo')       → true
 *   isSelectorMatch('.foobar', '.foo')         → false (substring, not a match)
 */
function isSelectorMatch(candidate, dotSelector) {
  const trimmed = candidate.trim();
  if (trimmed === dotSelector) return true;
  const escaped = escapeRegex(dotSelector);
  // Must be preceded by start-of-string or a combinator/whitespace/comma
  // and followed by end-of-string, combinator, pseudo, attribute, or comma
  const re = new RegExp(
    `(?:^|[\\s>+~,])${escaped}(?:[\\s{:.,>+~[\\]()#]|$)`,
  );
  return re.test(trimmed);
}

/**
 * Find the first line index at or above `lineIdx` that is blank,
 * returning the index from which we should start removal
 * (so we consume the blank lines above the block).
 */
function findRemoveStart(lines, lineIdx) {
  let i = lineIdx - 1;
  while (i >= 0 && lines[i].trim() === '') {
    i--;
  }
  // i is the last non-blank line before our block; we remove from i+1
  return i + 1;
}

/**
 * Find the last line index at or below `lineIdx` that is blank,
 * returning the last index to include in removal.
 */
function findRemoveEnd(lines, lineIdx) {
  let i = lineIdx + 1;
  while (i < lines.length && lines[i].trim() === '') {
    i++;
  }
  // i is the first non-blank line after the block; we remove up to i-1
  return i - 1;
}

/**
 * Remove the CSS rule block(s) for `selectorName` (bare name, no dot) from CSS text.
 *
 * Handles:
 *   - Simple single-selector blocks:  .foo { ... }
 *   - Multi-line blocks
 *   - Comma-separated selector lists: removes only `.foo` from the list,
 *     keeps the block with the remaining selectors
 *   - Nested rules inside @media/@supports
 *
 * Returns modified CSS string.
 */
function removeSelectorBlock(cssText, selectorName) {
  const dotSelector = `.${selectorName}`;
  const lines = cssText.split('\n');
  const result = [...lines];

  // Collect all line indices where our selector appears in a selector role.
  // We process in reverse order to avoid index shifting.
  const hitIndices = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\/\*/.test(line)) continue; // skip full comment-line openers
    const re = new RegExp(
      `${escapeRegex(dotSelector)}(?:\\s*[{,>+~\\s]|\\s*$)`,
    );
    if (re.test(line)) {
      hitIndices.push(i);
    }
  }

  if (hitIndices.length === 0) return cssText;

  for (let si = hitIndices.length - 1; si >= 0; si--) {
    const selectorLineIdx = hitIndices[si];

    // Walk forward to find the opening `{` of the rule block
    let blockOpenLine = -1;
    let blockOpenChar = -1;

    scan: for (let li = selectorLineIdx; li < result.length; li++) {
      const l = result[li];
      for (let ci = 0; ci < l.length; ci++) {
        if (l[ci] === '{') {
          blockOpenLine = li;
          blockOpenChar = ci;
          break scan;
        }
      }
    }

    if (blockOpenLine === -1) continue; // malformed — skip

    // Extract all selector text before the `{`
    const selectorLines = result
      .slice(selectorLineIdx, blockOpenLine + 1)
      .join('\n');
    const rawSelectorText = selectorLines.slice(
      0,
      selectorLines.lastIndexOf('{'),
    );

    const selectors = rawSelectorText
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    // Find the matching closing `}` using depth tracking
    let depth = 1;
    let blockCloseLine = -1;

    for (
      let li = blockOpenLine, startCi = blockOpenChar + 1;
      li < result.length;
      li++, startCi = 0
    ) {
      const l = result[li];
      for (let ci = startCi; ci < l.length; ci++) {
        if (l[ci] === '{') depth++;
        else if (l[ci] === '}') {
          depth--;
          if (depth === 0) {
            blockCloseLine = li;
            break;
          }
        }
      }
      if (blockCloseLine !== -1) break;
    }

    if (blockCloseLine === -1) continue; // unmatched brace — skip

    const remainingSelectors = selectors.filter(
      s => !isSelectorMatch(s, dotSelector),
    );

    if (remainingSelectors.length === 0) {
      // Remove entire block including surrounding blank lines
      const removeStart = findRemoveStart(result, selectorLineIdx);
      const removeEnd = findRemoveEnd(result, blockCloseLine);
      const count = removeEnd - removeStart + 1;
      result.splice(removeStart, count);

      // Adjust earlier hit indices (they shift down by `count` lines)
      for (let j = si - 1; j >= 0; j--) {
        hitIndices[j] -= count;
      }
    } else {
      // Rewrite selector list without our selector; keep the block body
      const newSelectorLines = remainingSelectors.join(',\n');
      // The block body is from blockOpenLine (the `{`) to blockCloseLine
      // We only rewrite the selector portion (selectorLineIdx to blockOpenLine)
      const blockOpen = result[blockOpenLine];
      const openBracePos = blockOpen.lastIndexOf('{');
      const bodyPrefix = blockOpen.slice(openBracePos); // `{...` or just `{`
      const replacement = (newSelectorLines + ' ' + bodyPrefix.trim()).split(
        '\n',
      );
      result.splice(
        selectorLineIdx,
        blockOpenLine - selectorLineIdx + 1,
        ...replacement,
      );
    }
  }

  return result.join('\n');
}

// ── Safety layer 1: re-scan delta check ──────────────────────────────────────

/**
 * After removing selectors, re-run dead-css and verify:
 *  - The removed selectors are no longer flagged
 *  - No new issues appeared that weren't in the original scan
 *
 * @returns {{ pass: boolean, reason: string }}
 */
function layer1DeltaCheck(projectConfig, originalDeadItems, removedSelectorNames) {
  let { htmlFiles, cssFiles } = resolveFileLists(projectConfig);

  // Re-read CSS files from disk (they've been modified)
  cssFiles = cssFiles.map(f => ({
    ...f,
    content: (() => {
      try {
        return fs.readFileSync(f.path, 'utf8');
      } catch {
        return f.content;
      }
    })(),
  }));

  let newItems;
  try {
    newItems = runDeadCssCheck({ htmlFiles, cssFiles });
  } catch (err) {
    return { pass: false, reason: `Layer 1: dead-css re-scan threw: ${err.message}` };
  }

  const originalSet = new Set(originalDeadItems.map(i => i.selector));
  const newSet = new Set(newItems.map(i => i.selector));

  // New issues = selectors that appeared after removal and were not in original scan
  const trulyNew = [...newSet].filter(s => !originalSet.has(s));
  if (trulyNew.length > 0) {
    return {
      pass: false,
      reason: `Layer 1: ${trulyNew.length} new dead-css issue(s) appeared after removal: ${trulyNew.slice(0, 3).join(', ')}`,
    };
  }

  // Removed selectors must actually be gone
  const stillPresent = removedSelectorNames.filter(s => newSet.has(s));
  if (stillPresent.length > 0) {
    return {
      pass: false,
      reason: `Layer 1: removed selector(s) still flagged by dead-css: ${stillPresent.join(', ')}`,
    };
  }

  return { pass: true, reason: 'Layer 1 pass.' };
}

// ── Safety layer 2: HTML class-existence scan ─────────────────────────────────

/**
 * Verify none of the removed selectors appear as string references in any HTML file.
 *
 * @returns {Promise<{ pass: boolean, reason: string }>}
 */
async function layer2HtmlScan(projectConfig, removedDotSelectors) {
  const { checkSelectorsAbsent } = await getValidateHtml();
  const result = checkSelectorsAbsent(projectConfig.root, removedDotSelectors);

  if (!result.pass) {
    const hitSummary = result.hits
      .slice(0, 3)
      .map(h => `${path.basename(h.file)}:${h.selector}`)
      .join(', ');
    return {
      pass: false,
      reason: `Layer 2: HTML still references removed selectors — ${hitSummary}`,
    };
  }

  return { pass: true, reason: 'Layer 2 pass.' };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Batch CSS deletion engine for the overnight janitor.
 *
 * @param {object} projectConfig
 *   Project object from projects/*.js
 *   { name: string, root: string, getHtmlFiles: fn, getCssFiles: fn, getJsFiles: fn,
 *     dynamicallyAdded?: string[], customChecks?: any }
 *
 * @param {{ dryRun?: boolean, batchSize?: number }} options
 *
 * @returns {Promise<{
 *   removed: Issue[],
 *   flagged: Issue[],
 *   aborted: boolean,
 *   reason?: string
 * }>}
 */
export async function runSlopCleaner(projectConfig, options = {}) {
  const dryRun = options.dryRun === true;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const projectRoot = projectConfig.root;
  const projectName = projectConfig.name;

  const removed = [];
  const flagged = [];

  // ── Guard: project root must exist ────────────────────────────────────────

  if (!projectRoot || !fs.existsSync(projectRoot)) {
    return {
      removed,
      flagged,
      aborted: true,
      reason: `Project root not found: ${projectRoot}`,
    };
  }

  // ── Step 1: resolve file lists and run dead-css detection ─────────────────

  let htmlFiles, cssFiles, jsFiles;
  try {
    ({ htmlFiles, cssFiles, jsFiles } = resolveFileLists(projectConfig));
  } catch (err) {
    return {
      removed,
      flagged,
      aborted: true,
      reason: `Failed to resolve file lists: ${err.message}`,
    };
  }

  if (cssFiles.length === 0) {
    return { removed, flagged, aborted: false };
  }

  let rawDeadItems;
  try {
    rawDeadItems = runDeadCssCheck({ htmlFiles, cssFiles });
  } catch (err) {
    return {
      removed,
      flagged,
      aborted: true,
      reason: `Dead-CSS check failed: ${err.message}`,
    };
  }

  if (!rawDeadItems || rawDeadItems.length === 0) {
    return { removed, flagged, aborted: false };
  }

  // ── Step 2: score each candidate ──────────────────────────────────────────

  const scored = rawDeadItems.map(item => ({
    raw: item,
    score: scoreCandidate(item, htmlFiles, jsFiles, projectConfig),
  }));

  // ── Step 3: split auto-remove vs flag-only ────────────────────────────────

  const toRemove = scored
    .filter(({ score }) => score >= AUTO_REMOVE_THRESHOLD)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.raw.selector.localeCompare(b.raw.selector),
    );

  const toFlag = scored.filter(({ score }) => score < AUTO_REMOVE_THRESHOLD);

  // Flag issues require no git operations
  for (const { raw, score } of toFlag) {
    flagged.push(buildIssue(raw, score, projectRoot));
  }

  if (toRemove.length === 0) {
    return { removed, flagged, aborted: false };
  }

  // ── Step 4: batch processing ──────────────────────────────────────────────

  const branchName = `janitor/slop-${yyyymmdd()}`;
  const originalDeadItems = rawDeadItems; // snapshot for Layer 1 delta check

  const batches = [];
  for (let i = 0; i < toRemove.length; i += batchSize) {
    batches.push(toRemove.slice(i, i + batchSize));
  }

  for (const batch of batches) {
    // ── 5a: create/checkout git branch ────────────────────────────────────

    if (!dryRun) {
      try {
        ensureBranch(branchName, projectRoot);
      } catch (err) {
        return {
          removed,
          flagged,
          aborted: true,
          reason: `Failed to create branch ${branchName}: ${err.message}`,
        };
      }
    }

    // ── 5b: remove CSS blocks from files ──────────────────────────────────

    // Group batch by CSS file path
    /** @type {Map<string, string[]>} absoluteFilePath → [selectorNames] */
    const fileGroups = new Map();
    for (const { raw } of batch) {
      const fp = raw.file;
      if (!fileGroups.has(fp)) fileGroups.set(fp, []);
      fileGroups.get(fp).push(raw.selector);
    }

    /** @type {Map<string, string>} absoluteFilePath → newContent */
    const modifiedFiles = new Map();

    for (const [filePath, selectorNames] of fileGroups.entries()) {
      if (!fs.existsSync(filePath)) {
        // File disappeared mid-run → rollback trigger #4
        if (!dryRun) restoreFiles(projectRoot);
        return {
          removed,
          flagged,
          aborted: true,
          reason: `CSS file disappeared mid-run: ${filePath}`,
        };
      }

      let content = fs.readFileSync(filePath, 'utf8');
      for (const name of selectorNames) {
        content = removeSelectorBlock(content, name);
      }
      modifiedFiles.set(filePath, content);
    }

    // Write modified files to disk (skipped in dry-run)
    if (!dryRun) {
      for (const [filePath, content] of modifiedFiles.entries()) {
        fs.writeFileSync(filePath, content, 'utf8');
      }
    }

    const removedSelectorNames = batch.map(({ raw }) => raw.selector);
    const removedDotSelectors = removedSelectorNames.map(n => `.${n}`);

    // ── 5c: Layer 1 safety ─────────────────────────────────────────────────

    if (!dryRun) {
      const l1 = layer1DeltaCheck(
        projectConfig,
        originalDeadItems,
        removedSelectorNames,
      );
      if (!l1.pass) {
        restoreFiles(projectRoot);
        return { removed, flagged, aborted: true, reason: l1.reason };
      }
    }

    // ── 5d: Layer 2 safety ─────────────────────────────────────────────────

    if (!dryRun) {
      const l2 = await layer2HtmlScan(projectConfig, removedDotSelectors);
      if (!l2.pass) {
        restoreFiles(projectRoot);
        return { removed, flagged, aborted: true, reason: l2.reason };
      }
    }

    // ── 5f/5g: commit or dry-run collect ──────────────────────────────────

    const batchIssues = batch.map(({ raw, score }) =>
      buildIssue(raw, score, projectRoot),
    );

    if (dryRun) {
      removed.push(...batchIssues);
      continue;
    }

    try {
      const relPaths = [...modifiedFiles.keys()].map(p =>
        path.relative(projectRoot, p),
      );
      git(['add', ...relPaths], projectRoot);

      const scores = batch.map(({ score }) => score);
      const minScore = Math.min(...scores);
      const maxScore = Math.max(...scores);
      const n = batch.length;
      const commitMsg =
        `janitor(${projectName}): remove ${n} dead CSS selector${n !== 1 ? 's' : ''} ` +
        `(scores ${minScore}-${maxScore})`;

      git(['commit', '-m', commitMsg], projectRoot);
    } catch (err) {
      restoreFiles(projectRoot);
      return {
        removed,
        flagged,
        aborted: true,
        reason: `Git commit failed: ${err.message}`,
      };
    }

    removed.push(...batchIssues);
  }

  return { removed, flagged, aborted: false };
}
