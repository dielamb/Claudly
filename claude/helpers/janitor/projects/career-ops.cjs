'use strict';

/**
 * Janitor project config — career-ops
 *
 * Node.js job-search pipeline built with ESM (.mjs) scripts.
 * Dependencies: dotenv, js-yaml, playwright, @google/generative-ai.
 * No HTML/CSS layer — all logic is server-side Node.js modules.
 *
 * Custom checks target Node.js-specific hygiene:
 *   1. Missing imports — .mjs files importing modules not installed/present
 *   2. Defined-but-never-called functions — dead function detection
 *   3. Stale TODO/FIXME comments — older than 30 days via git log
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const PROJECT_ROOT = '__HOME__/Desktop/Jobs/career-ops';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return all .mjs files in PROJECT_ROOT (top-level only; subfolders excluded
 * because batch/, dashboard/, examples/ are not part of the main pipeline).
 * @returns {Array<{rel: string, abs: string, content: string}>}
 */
function mjsFiles() {
  let entries;
  try {
    entries = fs.readdirSync(PROJECT_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.mjs'))
    .map((e) => {
      const abs = path.join(PROJECT_ROOT, e.name);
      let content = null;
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch {
        // file unreadable — skip silently
      }
      return { rel: e.name, abs, content };
    })
    .filter((f) => f.content !== null);
}

/**
 * Resolve a specifier string to an absolute path or a bare package name.
 * Returns { kind: 'node-builtin' | 'package' | 'local', name: string }
 */
function classifySpecifier(specifier) {
  // Node.js built-ins (node: protocol or bare names)
  const builtins = new Set([
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
    'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
    'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
    'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks',
    'process', 'punycode', 'querystring', 'readline', 'repl', 'stream',
    'stream/consumers', 'stream/promises', 'stream/web', 'string_decoder',
    'sys', 'timers', 'timers/promises', 'tls', 'trace_events', 'tty', 'url',
    'util', 'util/types', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
  ]);

  if (specifier.startsWith('node:')) return { kind: 'node-builtin', name: specifier };
  if (builtins.has(specifier)) return { kind: 'node-builtin', name: specifier };
  if (specifier.startsWith('.') || specifier.startsWith('/')) return { kind: 'local', name: specifier };
  return { kind: 'package', name: specifier.split('/')[0].replace(/^@[^/]+\/[^/]+.*/, specifier.split('/').slice(0, 2).join('/')) };
}

/**
 * Parse the top-level package.json and return a Set of installed package names.
 * Returns an empty Set if package.json is unreadable.
 */
function installedPackages() {
  const pkgPath = path.join(PROJECT_ROOT, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const names = new Set();
    for (const dep of Object.keys(pkg.dependencies || {})) names.add(dep);
    for (const dep of Object.keys(pkg.devDependencies || {})) names.add(dep);
    for (const dep of Object.keys(pkg.peerDependencies || {})) names.add(dep);
    return names;
  } catch {
    return new Set();
  }
}

// ── Custom checks ─────────────────────────────────────────────────────────────

/**
 * Check 1: .mjs files importing modules that don't exist in the project.
 *
 * For package imports: the package must be in package.json dependencies AND
 * have a corresponding directory under node_modules/.
 *
 * For local relative imports (./foo, ../bar): the referenced file must exist
 * on disk (tries .mjs, .js, and exact path).
 *
 * Node.js built-ins are always allowed.
 */
function checkMissingImports() {
  const findings = [];
  const packages = installedPackages();
  const nodeModulesDir = path.join(PROJECT_ROOT, 'node_modules');
  const nodeModulesExists = fs.existsSync(nodeModulesDir);

  // ESM static import: import ... from 'specifier'
  // Also catches: import 'specifier' (side-effect imports)
  const importRe = /^\s*import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm;

  for (const { rel, abs, content } of mjsFiles()) {
    const dir = path.dirname(abs);
    let m;
    importRe.lastIndex = 0;
    while ((m = importRe.exec(content)) !== null) {
      const specifier = m[1];
      const { kind, name } = classifySpecifier(specifier);

      if (kind === 'node-builtin') continue;

      if (kind === 'package') {
        const inPkg = packages.has(name);
        const inNodeModules = nodeModulesExists && fs.existsSync(path.join(nodeModulesDir, name));
        if (!inPkg && !inNodeModules) {
          findings.push({
            file: rel,
            line: null,
            message: `Imports package \`${name}\` which is not listed in package.json and not found in node_modules`,
          });
        } else if (inPkg && !inNodeModules) {
          findings.push({
            file: rel,
            line: null,
            message: `Imports package \`${name}\` listed in package.json but not installed — run \`npm install\``,
          });
        }
        continue;
      }

      // Local import: resolve relative to the importing file
      if (kind === 'local') {
        const base = path.resolve(dir, specifier);
        const candidates = [base, `${base}.mjs`, `${base}.js`, `${base}/index.mjs`, `${base}/index.js`];
        const exists = candidates.some((c) => {
          try { return fs.statSync(c).isFile(); } catch { return false; }
        });
        if (!exists) {
          findings.push({
            file: rel,
            line: null,
            message: `Imports local module \`${specifier}\` but no matching file was found on disk`,
          });
        }
      }
    }
  }

  return {
    name: 'missing-imports',
    description: 'ESM imports referencing packages not in package.json or local files that do not exist',
    findings,
  };
}

/**
 * Check 2: functions defined but never called within the project.
 *
 * Detects top-level named function declarations and named function expressions
 * assigned to a const/let/var. Checks whether the function name appears as a
 * call site (name followed by `(`) anywhere in the combined source of all .mjs
 * files. Export references count as usage.
 *
 * Limitations: dynamic dispatch (obj[fn](), call/apply) is not detected.
 * This check is intentionally conservative — it only flags names with zero
 * appearances outside their own definition line.
 */
function checkUnusedFunctions() {
  const findings = [];
  const files = mjsFiles();
  if (files.length === 0) {
    return { name: 'unused-functions', description: 'Functions defined but never called', findings };
  }

  // Build a combined view for call-site search
  const allSource = files.map((f) => f.content).join('\n');

  // Pattern 1: function foo(
  // Pattern 2: const foo = (async )?(function)?( )?\(  OR  const foo = async (
  // We capture the function name only
  const defPatterns = [
    /^(?:async\s+)?function\s+([\w$]+)\s*\(/gm,
    /^(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|\w+\s*=>)/gm,
  ];

  for (const { rel, content } of files) {
    for (const re of defPatterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content)) !== null) {
        const fnName = m[1];

        // Count how many times this name appears in the total source
        // We look for: fnName( as a call, fnName as an export, or fnName passed as value
        // Use a word-boundary equivalent: preceded and followed by non-word chars
        const callRe = new RegExp(`\\b${fnName}\\b`, 'g');
        let occurrences = 0;
        let hit;
        while ((hit = callRe.exec(allSource)) !== null) {
          occurrences++;
        }

        // The definition itself accounts for at least 1 occurrence in allSource.
        // If it's defined in multiple files somehow, or if name appears in comments,
        // occurrences > 1 is sufficient to treat as "used".
        // We use <= 1 to flag names that appear only in their own definition.
        if (occurrences <= 1) {
          findings.push({
            file: rel,
            line: null,
            message: `Function \`${fnName}\` is defined but never called anywhere in the project`,
          });
        }
      }
    }
  }

  return {
    name: 'unused-functions',
    description: 'Top-level functions defined in .mjs files but never called or exported',
    findings,
  };
}

/**
 * Check 3: stale TODO/FIXME comments older than 30 days.
 *
 * Uses `git log -S` to find the commit that introduced each comment line, then
 * compares the commit date to today. Falls back to file mtime if git is
 * unavailable (e.g. no git repo or git not on PATH).
 *
 * Only checks .mjs files at project root level.
 */
function checkStaleTodos() {
  const findings = [];
  const STALE_DAYS = 30;
  const nowMs = Date.now();
  const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000;

  // Detect if git is available and the project is a git repo
  let gitAvailable = false;
  try {
    execSync('git -C ' + JSON.stringify(PROJECT_ROOT) + ' rev-parse --git-dir', {
      stdio: 'pipe',
      timeout: 5000,
    });
    gitAvailable = true;
  } catch {
    // git unavailable or not a repo — will fall back to mtime
  }

  /**
   * Given a file and a TODO/FIXME line, return the approximate date (ms) when
   * that line was introduced. Returns null if undetermined.
   */
  function lineAge(absPath, lineText) {
    if (gitAvailable) {
      try {
        // -S searches for commits that added or removed the exact string
        // --follow handles renames; --diff-filter=A limits to additions
        // We take the oldest commit that introduced this text
        const result = execSync(
          `git -C ${JSON.stringify(PROJECT_ROOT)} log --follow --diff-filter=A --format="%ai" -S ${JSON.stringify(lineText.trim())} -- ${JSON.stringify(path.relative(PROJECT_ROOT, absPath))}`,
          { stdio: 'pipe', timeout: 10000 },
        )
          .toString()
          .trim();

        if (result) {
          // Multiple lines = multiple commits; take the most recent (first line)
          const dateStr = result.split('\n')[0].trim();
          const ts = Date.parse(dateStr);
          if (!isNaN(ts)) return ts;
        }
      } catch {
        // git command failed — fall through to mtime
      }
    }

    // Fallback: use the file's mtime
    try {
      return fs.statSync(absPath).mtimeMs;
    } catch {
      return null;
    }
  }

  const todoRe = /\/\/\s*(TODO|FIXME)\b[^\n]*/gi;

  for (const { rel, abs, content } of mjsFiles()) {
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      todoRe.lastIndex = 0;
      const m = todoRe.exec(line);
      if (!m) return;

      const commentText = m[0];
      const introducedMs = lineAge(abs, commentText);

      if (introducedMs === null) return; // can't determine age, skip

      const ageMs = nowMs - introducedMs;
      if (ageMs > STALE_MS) {
        const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
        findings.push({
          file: rel,
          line: idx + 1,
          message: `Stale ${m[1]} comment (${ageDays}d old): "${commentText.trim()}"`,
        });
      }
    });
  }

  return {
    name: 'stale-todos',
    description: `TODO/FIXME comments not resolved within ${STALE_DAYS} days`,
    findings,
  };
}

// ── Export ────────────────────────────────────────────────────────────────────

module.exports = {
  /** Absolute path to the project root */
  projectRoot: PROJECT_ROOT,

  /** Human-readable project name */
  name: 'career-ops',

  /** File globs to include in general janitor checks */
  include: ['*.mjs', 'package.json', '.env.example'],

  /** File globs to always exclude */
  exclude: [
    'node_modules/**',
    '.git/**',
    'output/**',
    'batch/logs/**',
    'reports/**',
    'fonts/**',
    'docs/**',
    'examples/**',
    'modes/**',
    'interview-prep/**',
  ],

  /**
   * HTML/CSS checks are not applicable to this project.
   * The runner should skip them based on this flag.
   */
  skipHtmlChecks: true,

  /**
   * Custom checks specific to career-ops.
   * Each function returns: { name, description, findings: Array<{file, line?, message}> }
   */
  customChecks: [
    checkMissingImports,
    checkUnusedFunctions,
    checkStaleTodos,
  ],

  /**
   * Dead-CSS runner configuration.
   * Not applicable — no CSS in this project.
   */
  deadCss: null,
};
