#!/usr/bin/env node
/**
 * Two-Phase AI Security Scanner
 * Usage: node security-scan.js --project <path> [--scope recent|full] [--exceptions <file>]
 *
 * Phase 1: 5 reporter agents scan in parallel
 * Phase 2: 3 exploiter agents validate Phase 1 findings
 * Output:  ~/Desktop/Labirynt/3 Atlas/Domains/general/security-reports/YYYY-MM-DD.md
 */

'use strict';

const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── CLI args ────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { project: null, scope: 'recent', exceptions: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project'    && args[i + 1]) { opts.project    = args[++i]; }
    if (args[i] === '--scope'      && args[i + 1]) { opts.scope      = args[++i]; }
    if (args[i] === '--exceptions' && args[i + 1]) { opts.exceptions = args[++i]; }
  }
  if (!opts.project) { die('--project <path> is required'); }
  opts.project = path.resolve(opts.project);
  return opts;
}

function die(msg) { console.error(`[security-scan] ERROR: ${msg}`); process.exit(1); }
function log(msg) { console.log(`[security-scan] ${msg}`); }

// ─── File collection ─────────────────────────────────────────────────────────

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.cache',
  '__pycache__', '.pytest_cache', 'venv', '.venv', 'coverage',
  '.nyc_output', 'vendor', 'bower_components',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.rb', '.go', '.java', '.php', '.cs', '.rs',
  '.html', '.ejs', '.hbs', '.pug', '.jinja', '.j2',
  '.json', '.yaml', '.yml', '.toml', '.env', '.env.example',
  '.sh', '.bash', '.zsh',
  '.sql',
  '.conf', '.config', '.ini',
]);

const CONFIG_FILES = new Set([
  'package.json', 'requirements.txt', 'Pipfile', 'Gemfile',
  'go.mod', 'Cargo.toml', 'composer.json',
  '.htaccess', 'nginx.conf', 'Dockerfile', 'docker-compose.yml',
  'docker-compose.yaml', '.env', '.env.example',
]);

function walkDir(dir, files = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return files; }

  for (const e of entries) {
    if (e.name.startsWith('.') && !CONFIG_FILES.has(e.name)) continue;
    if (IGNORED_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkDir(full, files);
    } else if (
      CODE_EXTENSIONS.has(path.extname(e.name).toLowerCase()) ||
      CONFIG_FILES.has(e.name)
    ) {
      files.push(full);
    }
  }
  return files;
}

function getProjectFiles(projectPath, scope) {
  const all = walkDir(projectPath);

  if (scope === 'full') return all;

  // recent = files changed in last 7 days
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = all.filter(f => {
    try { return fs.statSync(f).mtimeMs >= cutoff; }
    catch { return false; }
  });

  // Always include config/manifest files regardless of mtime
  const configs = all.filter(f => CONFIG_FILES.has(path.basename(f)));
  const combined = [...new Set([...recent, ...configs])];

  if (combined.length === 0) {
    log('No recently-changed files found — falling back to full scope');
    return all;
  }
  return combined;
}

function buildFileBundle(files, projectPath) {
  const MAX_BYTES = 180_000; // stay within context limits per agent
  const lines = [];
  let total = 0;
  let included = 0;
  let skipped = 0;

  for (const f of files) {
    let content;
    try { content = fs.readFileSync(f, 'utf8'); }
    catch { continue; }

    if (content.length > 40_000) {
      content = content.slice(0, 40_000) + '\n... [truncated] ...';
    }

    const rel  = path.relative(projectPath, f);
    const block = `\n### FILE: ${rel}\n\`\`\`\n${content}\n\`\`\`\n`;

    if (total + block.length > MAX_BYTES) {
      skipped++;
      continue;
    }

    lines.push(block);
    total += block.length;
    included++;
  }

  if (skipped > 0) log(`Bundle: ${included} files included, ${skipped} skipped (size limit)`);
  return lines.join('');
}

function loadExceptions(exceptionsFile) {
  if (!exceptionsFile) return [];
  try {
    return fs.readFileSync(exceptionsFile, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
  } catch (e) {
    log(`Could not read exceptions file: ${e.message}`);
    return [];
  }
}

// ─── Prompt templates ────────────────────────────────────────────────────────

const DB_ACCESS_PROMPT = `You are a database access security auditor. Analyze the provided source code for data access vulnerabilities.

Focus exclusively on:
1. ROW-LEVEL SECURITY: Can user A access user B's data by changing URL params or request body IDs?
   - Look for queries like: db.findById(req.params.id) with no ownership check
   - Pattern: fetch resource by ID without verifying resource.userId === req.user.id
2. MISSING WHERE clauses: queries that return all records instead of filtering by current user/tenant
   - SELECT * FROM orders (no WHERE user_id = ?)
   - Model.find({}) instead of Model.find({ userId: currentUser.id })
3. DIRECT ID MANIPULATION: endpoints that accept IDs from user input without validating ownership
   - PUT /api/records/:id — is there an ownership check before update?
   - DELETE /api/items/:id — does it verify the item belongs to the caller?
4. AUTH MIDDLEWARE GAPS: routes that access user data but are missing auth middleware
   - Express router without authenticate/requireAuth/verifyToken middleware
   - Flask routes without @login_required or similar decorator

For each finding output a JSON object (one per line) with this exact structure:
{"type":"IDOR"|"MISSING_TENANT_FILTER"|"MISSING_AUTH"|"OWNERSHIP_BYPASS","severity":"CRITICAL"|"HIGH"|"MEDIUM","file":"<relative path>","line":<number or null>,"description":"<what the vulnerability is>","evidence":"<exact code snippet>","fix":"<concrete fix>"}

If no vulnerabilities found, output: {"type":"CLEAN","severity":"INFO","description":"No database access vulnerabilities found"}

Be precise. Only report what you actually see in the code — no speculation.

Code to analyze:
`;

const INPUT_VALIDATION_PROMPT = `You are an input validation security auditor. Analyze the provided source code for injection vulnerabilities.

Focus exclusively on:
1. SQL INJECTION: unparameterized queries concatenating user input
   - db.query("SELECT * FROM users WHERE name = '" + req.body.name + "'")
   - Template literals: db.query(\`SELECT ... WHERE id = \${req.params.id}\`)
   - String concatenation in any SQL/ORM raw() call
2. PATH TRAVERSAL: file operations using user-supplied paths
   - fs.readFile(req.query.file) or path.join(__dirname, req.params.name)
   - Without sanitization like path.normalize + checking prefix
3. COMMAND INJECTION: exec/spawn/shell calls with user input
   - exec('ls ' + req.body.dir)
   - spawn(userSuppliedCommand)
   - child_process with unsanitized input
4. XSS: unescaped user content rendered into HTML
   - res.send('<div>' + req.body.name + '</div>')
   - innerHTML = userContent (without sanitization)
   - Template engines outputting unescaped vars: {{{variable}}} in handlebars, |safe in Jinja
5. NOSQL INJECTION: MongoDB/similar queries with unvalidated operators
   - User can pass {$gt: ""} as field value
   - req.body passed directly as query filter

For each finding output a JSON object (one per line):
{"type":"SQL_INJECTION"|"PATH_TRAVERSAL"|"CMD_INJECTION"|"XSS"|"NOSQL_INJECTION","severity":"CRITICAL"|"HIGH"|"MEDIUM","file":"<relative path>","line":<number or null>,"description":"<what is vulnerable>","evidence":"<exact code snippet>","fix":"<parameterized/escaped alternative>"}

If no vulnerabilities found: {"type":"CLEAN","severity":"INFO","description":"No injection vulnerabilities found"}

Only report confirmed patterns in the actual code — no speculation.

Code to analyze:
`;

const AUTH_SESSION_PROMPT = `You are an authentication and session security auditor. Analyze the provided source code for auth vulnerabilities.

Focus exclusively on:
1. MISSING AUTH on endpoints: routes that perform sensitive operations without verifying identity
   - POST /api/admin/* without auth middleware
   - Any route modifying data (POST/PUT/PATCH/DELETE) without authenticate/requireAuth/verifyToken
   - GraphQL mutations without auth checks
2. SESSION FIXATION: session ID not regenerated after login
   - req.session.userId = user.id (without req.session.regenerate() first)
   - Django: login() called without session cycle
3. TOKEN STORAGE: JWT or session tokens stored insecurely
   - localStorage.setItem('token', ...) — tokens should be in httpOnly cookies
   - sessionStorage for sensitive tokens
   - Token readable by JavaScript (not httpOnly)
4. RATE LIMITING MISSING on auth endpoints:
   - /login, /register, /forgot-password, /reset-password without rate limiter middleware
   - No brute-force protection on password verification
5. WEAK JWT: algorithm set to 'none', or secret is short/hardcoded
   - jwt.sign(payload, 'secret') — weak secret
   - jwt.verify(token, secret, {algorithms: ['none']})

For each finding output a JSON object (one per line):
{"type":"MISSING_AUTH"|"SESSION_FIXATION"|"INSECURE_TOKEN_STORAGE"|"MISSING_RATE_LIMIT"|"WEAK_JWT","severity":"CRITICAL"|"HIGH"|"MEDIUM","file":"<relative path>","line":<number or null>,"description":"<what is vulnerable>","evidence":"<exact code snippet>","fix":"<concrete fix>"}

If no vulnerabilities found: {"type":"CLEAN","severity":"INFO","description":"No auth/session vulnerabilities found"}

Only report what you actually see — no speculation.

Code to analyze:
`;

const DATA_LEAKAGE_PROMPT = `You are a data leakage security auditor. Analyze the provided source code for information disclosure vulnerabilities.

Focus exclusively on:
1. OVER-RETURNING API RESPONSES: endpoints that expose more fields than the client needs
   - Returning full user object (including password hash, internal flags, admin fields) in public API
   - User.findById(id) returned directly without .select('-password -internalNotes')
   - Serializers/serialization without field whitelisting
2. HARDCODED SECRETS in code (not in .env):
   - API keys, tokens, passwords directly in source: const API_KEY = 'sk-...'
   - Private keys or certificates embedded as strings
   - Database connection strings with credentials
   - AWS/GCP/Azure credentials in code
3. STACK TRACES / VERBOSE ERRORS exposed to clients:
   - res.status(500).json({ error: err.stack })
   - err.message sent directly to frontend in production context
   - express error handlers that leak internal paths or code
4. .ENV OR CONFIG FILES that may be served:
   - .env file in public directory
   - Config files with secrets accessible via web root
   - Any indication secrets are committed (e.g., .env without .gitignore entry)
5. INTERNAL DATA IN LOGS:
   - console.log(password), console.log(token), console.log(req.headers.authorization)
   - Logging full request body which may contain sensitive fields

For each finding output a JSON object (one per line):
{"type":"OVER_EXPOSURE"|"HARDCODED_SECRET"|"STACK_TRACE_LEAK"|"ENV_FILE_SERVED"|"SENSITIVE_LOGGING","severity":"CRITICAL"|"HIGH"|"MEDIUM","file":"<relative path>","line":<number or null>,"description":"<what leaks and what data>","evidence":"<exact code snippet>","fix":"<concrete fix>"}

If no vulnerabilities found: {"type":"CLEAN","severity":"INFO","description":"No data leakage vulnerabilities found"}

Only report confirmed patterns — no speculation.

Code to analyze:
`;

const CONFIG_HEADERS_PROMPT = `You are a configuration and security headers auditor. Analyze the provided source code and config files for misconfiguration vulnerabilities.

Focus exclusively on:
1. MISSING SECURITY HEADERS in HTTP layer:
   - No Content-Security-Policy (CSP) header set
   - No X-Frame-Options or frame-ancestors CSP directive (clickjacking risk)
   - No X-Content-Type-Options: nosniff
   - Missing Strict-Transport-Security (HSTS)
   - Check for helmet() usage in Express or equivalent in other frameworks
2. CORS MISCONFIGURATION:
   - cors({ origin: '*' }) or Access-Control-Allow-Origin: * on APIs handling auth
   - Reflecting Origin header without validation
   - CORS allowing credentials with wildcard origin
3. DEBUG / DEVELOPMENT CONFIG in production context:
   - DEBUG=true, NODE_ENV not set to 'production'
   - Stack traces enabled in production error handlers
   - verbose logging of internal data in production paths
   - Default admin credentials left in config
4. VULNERABLE DEPENDENCIES (from package.json / requirements.txt / etc.):
   - Check package.json for known-problematic packages and version ranges
   - Look for packages with known CVEs if version is very old (e.g. express <4.17.3, lodash <4.17.21)
   - requirements.txt with unpinned or old versions of cryptography, django, flask, requests
   - Note: you cannot run npm audit, so flag suspicious outdated ranges you can see
5. COOKIE SECURITY:
   - Cookies set without httpOnly flag
   - Cookies set without secure flag
   - Missing SameSite attribute on session cookies

For each finding output a JSON object (one per line):
{"type":"MISSING_CSP"|"MISSING_XFRAME"|"CORS_WILDCARD"|"DEBUG_ENABLED"|"VULNERABLE_DEPENDENCY"|"INSECURE_COOKIE","severity":"CRITICAL"|"HIGH"|"MEDIUM"|"LOW","file":"<relative path>","line":<number or null>,"description":"<what is misconfigured>","evidence":"<exact code snippet or config value>","fix":"<concrete fix>"}

If no vulnerabilities found: {"type":"CLEAN","severity":"INFO","description":"No configuration vulnerabilities found"}

Only report confirmed patterns — no speculation.

Code to analyze:
`;

// ─── Exploiter prompts ────────────────────────────────────────────────────────

function buildApiExploiterPrompt(findings, fileBundle) {
  return `You are a penetration tester validating security findings by crafting concrete proof-of-concept API exploits.

You have been given Phase 1 security findings and the full source code. Your job is to:
1. Review each finding
2. Determine if it is genuinely exploitable based on the actual code
3. For exploitable findings: craft a concrete curl command or HTTP request that would demonstrate the issue
4. For non-exploitable findings (false positives, mitigated by other code): mark as NOT_CONFIRMED with reason

Focus on: SQL injection, IDOR/broken access control, missing auth, CORS bypass, API data over-exposure.

Phase 1 Findings:
${findings}

For each finding you evaluate, output a JSON object (one per line):
{"finding_type":"<type from phase 1>","file":"<file>","confirmed":true|false,"severity":"CRITICAL"|"HIGH"|"MEDIUM"|"LOW","proof":"<curl command or HTTP request that demonstrates exploit>","expected_response":"<what a vulnerable server would return>","false_positive_reason":"<why it is not exploitable, if not confirmed>"}

For confirmed vulnerabilities, the proof field MUST contain a runnable curl command.
Do not confirm a finding unless you can show a concrete exploit path.

Source code for context:
${fileBundle}
`;
}

function buildBrowserExploiterPrompt(findings, fileBundle) {
  return `You are a penetration tester validating client-side security findings by crafting browser-based proof-of-concept exploits.

You have been given Phase 1 security findings and the full source code. Your job is to:
1. Review findings related to XSS, clickjacking, insecure token storage, CSP bypass
2. Determine if each is genuinely exploitable from the actual code
3. For exploitable findings: craft a specific payload and explain the exact attack scenario
4. For non-exploitable findings: mark as NOT_CONFIRMED with reason

Focus on: XSS payloads, clickjacking via iframe, token theft from localStorage, CSP bypass vectors.

Phase 1 Findings:
${findings}

For each finding you evaluate, output a JSON object (one per line):
{"finding_type":"<type from phase 1>","file":"<file>","confirmed":true|false,"severity":"CRITICAL"|"HIGH"|"MEDIUM"|"LOW","affected_url":"<URL path or component where attack applies>","payload":"<exact XSS payload, iframe embed, or JS snippet>","attack_description":"<step-by-step attack the user would execute>","false_positive_reason":"<why not exploitable, if not confirmed>"}

Do not confirm a finding unless you can show a concrete payload and attack path.

Source code for context:
${fileBundle}
`;
}

function buildLogicExploiterPrompt(findings, fileBundle) {
  return `You are a penetration tester validating business logic and privilege escalation findings.

You have been given Phase 1 security findings and the full source code. Your job is to:
1. Review findings related to IDOR, auth bypass, privilege escalation, session attacks
2. Determine if each is genuinely exploitable based on actual code flow
3. For exploitable findings: provide a step-by-step attack sequence
4. For non-exploitable findings: mark as NOT_CONFIRMED with reason

Focus on: IDOR (accessing another user's data), horizontal/vertical privilege escalation,
session fixation, JWT algorithm confusion, auth bypass via parameter manipulation.

Phase 1 Findings:
${findings}

For each finding you evaluate, output a JSON object (one per line):
{"finding_type":"<type from phase 1>","file":"<file>","confirmed":true|false,"severity":"CRITICAL"|"HIGH"|"MEDIUM"|"LOW","attack_sequence":["step 1: ...","step 2: ...","step 3: ..."],"proof_of_access":"<what attacker gains: specific data or capability>","prerequisites":"<what attacker needs: valid account, specific role, etc.>","false_positive_reason":"<why not exploitable, if not confirmed>"}

Do not confirm a finding unless you can trace the exact code path an attacker would traverse.

Source code for context:
${fileBundle}
`;
}

// ─── Claude subprocess runner ────────────────────────────────────────────────

function checkClaudeAvailable() {
  return new Promise(resolve => {
    const proc = spawn('which', ['claude']);
    proc.on('close', code => resolve(code === 0));
  });
}

function runClaude(prompt, label) {
  return new Promise((resolve) => {
    log(`Starting agent: ${label}`);
    const startMs = Date.now();

    let proc;
    try {
      proc = spawn('claude', [
        '-p', prompt,
        '--model', 'claude-haiku-4-5-20251001',
        '--output-format', 'json',
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    } catch (e) {
      log(`Failed to spawn claude for ${label}: ${e.message}`);
      resolve({ label, raw: '', findings: [], error: e.message, durationMs: 0 });
      return;
    }

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      const durationMs = Date.now() - startMs;
      log(`Agent ${label} finished in ${(durationMs / 1000).toFixed(1)}s (exit ${code})`);

      // claude --output-format json wraps result in a JSON envelope
      // Try to extract the text content from it
      let text = stdout;
      try {
        const envelope = JSON.parse(stdout);
        // Claude JSON output format: {type: "result", subtype: "success", result: "..."}
        if (envelope.result) text = envelope.result;
        else if (envelope.content)  text = Array.isArray(envelope.content)
          ? envelope.content.map(c => c.text || '').join('\n')
          : envelope.content;
      } catch {
        // stdout is plain text — use as-is
      }

      const findings = extractFindings(text, label);
      resolve({ label, raw: text, findings, durationMs, stderr: stderr.slice(0, 500) });
    });

    proc.on('error', err => {
      const durationMs = Date.now() - startMs;
      log(`Agent ${label} error: ${err.message}`);
      resolve({ label, raw: '', findings: [], error: err.message, durationMs });
    });

    // Feed prompt via stdin as well for large prompts, close after write
    proc.stdin.write('');
    proc.stdin.end();
  });
}

// ─── Finding extraction ───────────────────────────────────────────────────────

function extractFindings(text, label) {
  const findings = [];
  if (!text) return findings;

  // Extract all JSON objects from text (one per line or mixed with prose)
  const jsonPattern = /\{[^{}]*"type"[^{}]*\}/g;
  let match;
  while ((match = jsonPattern.exec(text)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj.type && obj.type !== 'CLEAN') {
        obj._reporter = label;
        findings.push(obj);
      }
    } catch {
      // skip malformed JSON
    }
  }

  // Also try line-by-line for well-formatted output
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj.type && obj.type !== 'CLEAN') {
        // Avoid duplicates from regex pass
        const isDup = findings.some(f =>
          f.type === obj.type && f.file === obj.file && f.evidence === obj.evidence
        );
        if (!isDup) {
          obj._reporter = label;
          findings.push(obj);
        }
      }
    } catch {
      // skip
    }
  }

  return findings;
}

function extractExploiterResults(text, label) {
  const results = [];
  if (!text) return results;

  const jsonPattern = /\{[^{}]*"confirmed"[^{}]*\}/g;
  let match;
  while ((match = jsonPattern.exec(text)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      obj._exploiter = label;
      results.push(obj);
    } catch {
      // skip
    }
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
    try {
      const obj = JSON.parse(trimmed);
      if ('confirmed' in obj) {
        const isDup = results.some(r =>
          r.finding_type === obj.finding_type && r.file === obj.file
        );
        if (!isDup) {
          obj._exploiter = label;
          results.push(obj);
        }
      }
    } catch {
      // skip
    }
  }

  return results;
}

// ─── Phase 1 ──────────────────────────────────────────────────────────────────

async function phase1(projectPath, fileBundle) {
  log('=== PHASE 1: Running 5 reporter agents in parallel ===');

  const reporters = [
    { label: 'db-access',       prompt: DB_ACCESS_PROMPT       + fileBundle },
    { label: 'input-validation', prompt: INPUT_VALIDATION_PROMPT + fileBundle },
    { label: 'auth-session',    prompt: AUTH_SESSION_PROMPT    + fileBundle },
    { label: 'data-leakage',    prompt: DATA_LEAKAGE_PROMPT    + fileBundle },
    { label: 'config-headers',  prompt: CONFIG_HEADERS_PROMPT  + fileBundle },
  ];

  const results = await Promise.all(reporters.map(r => runClaude(r.prompt, r.label)));

  const allFindings = [];
  for (const r of results) {
    if (r.error) log(`Reporter ${r.label} failed: ${r.error}`);
    allFindings.push(...r.findings);
  }

  log(`Phase 1 complete. Total raw findings: ${allFindings.length}`);
  return { results, allFindings };
}

// ─── Phase 2 ──────────────────────────────────────────────────────────────────

async function phase2(allFindings, fileBundle) {
  if (allFindings.length === 0) {
    log('Phase 1 found no issues — skipping Phase 2');
    return { results: [], confirmed: [], unconfirmed: [] };
  }

  log('=== PHASE 2: Running 3 exploiter agents in parallel ===');

  const findingsJson = JSON.stringify(allFindings, null, 2);

  const exploiters = [
    { label: 'api-exploiter',    prompt: buildApiExploiterPrompt(findingsJson, fileBundle) },
    { label: 'browser-exploiter', prompt: buildBrowserExploiterPrompt(findingsJson, fileBundle) },
    { label: 'logic-exploiter',  prompt: buildLogicExploiterPrompt(findingsJson, fileBundle) },
  ];

  const results = await Promise.all(exploiters.map(r => runClaude(r.prompt, r.label)));

  const confirmed   = [];
  const unconfirmed = [];

  for (const r of results) {
    if (r.error) log(`Exploiter ${r.label} failed: ${r.error}`);
    const exploitResults = extractExploiterResults(r.raw, r.label);
    for (const er of exploitResults) {
      if (er.confirmed) confirmed.push(er);
      else              unconfirmed.push(er);
    }
  }

  // Any Phase 1 finding not evaluated by any exploiter = unconfirmed (no proof)
  for (const f of allFindings) {
    const wasEvaluated = [...confirmed, ...unconfirmed].some(
      er => er.finding_type === f.type && er.file === f.file
    );
    if (!wasEvaluated) {
      unconfirmed.push({
        finding_type: f.type,
        file: f.file,
        confirmed: false,
        severity: f.severity,
        false_positive_reason: 'Not evaluated by any exploiter agent',
        _exploiter: 'none',
      });
    }
  }

  log(`Phase 2 complete. Confirmed: ${confirmed.length}, Unconfirmed: ${unconfirmed.length}`);
  return { results, confirmed, unconfirmed };
}

// ─── Report generation ────────────────────────────────────────────────────────

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

function severityBadge(s) {
  const badges = { CRITICAL: '[CRITICAL]', HIGH: '[HIGH]', MEDIUM: '[MEDIUM]', LOW: '[LOW]', INFO: '[INFO]' };
  return badges[s] || `[${s}]`;
}

function generateReport(opts, phase1Data, phase2Data, exceptions) {
  const { projectPath, scope } = opts;
  const { allFindings }        = phase1Data;
  const { confirmed, unconfirmed } = phase2Data;
  const date = new Date().toISOString().slice(0, 10);

  const sortedConfirmed = [...confirmed].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5)
  );

  const summary = {
    total:    confirmed.length,
    CRITICAL: confirmed.filter(f => f.severity === 'CRITICAL').length,
    HIGH:     confirmed.filter(f => f.severity === 'HIGH').length,
    MEDIUM:   confirmed.filter(f => f.severity === 'MEDIUM').length,
    LOW:      confirmed.filter(f => f.severity === 'LOW').length,
  };

  const noiseRate = allFindings.length > 0
    ? Math.round((unconfirmed.length / allFindings.length) * 100)
    : 0;

  let md = `# Security Scan Report — ${date}\n`;
  md += `Project: ${projectPath}\n`;
  md += `Scope: ${scope}\n\n`;

  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Phase 1 raw findings | ${allFindings.length} |\n`;
  md += `| Confirmed vulnerabilities | ${confirmed.length} |\n`;
  md += `| Noise eliminated | ${unconfirmed.length} (${noiseRate}%) |\n`;
  md += `| Critical | ${summary.CRITICAL} |\n`;
  md += `| High | ${summary.HIGH} |\n`;
  md += `| Medium | ${summary.MEDIUM} |\n`;
  md += `| Low | ${summary.LOW} |\n\n`;

  // ── Confirmed vulnerabilities
  md += `## Confirmed Vulnerabilities (${confirmed.length})\n\n`;

  if (sortedConfirmed.length === 0) {
    md += `No confirmed vulnerabilities. All Phase 1 findings were not reproducible.\n\n`;
  } else {
    for (const v of sortedConfirmed) {
      md += `### ${severityBadge(v.severity)} ${v.finding_type} in ${v.file || 'unknown'}\n\n`;

      if (v.affected_url)    md += `**Affected URL:** ${v.affected_url}\n\n`;

      if (v.proof) {
        md += `**Proof:**\n\`\`\`\n${v.proof}\n\`\`\`\n\n`;
      }
      if (v.expected_response) {
        md += `**Expected response:** ${v.expected_response}\n\n`;
      }
      if (v.payload) {
        md += `**Payload:**\n\`\`\`\n${v.payload}\n\`\`\`\n\n`;
      }
      if (v.attack_description) {
        md += `**Attack:** ${v.attack_description}\n\n`;
      }
      if (v.attack_sequence && v.attack_sequence.length > 0) {
        md += `**Attack sequence:**\n`;
        for (const step of v.attack_sequence) md += `- ${step}\n`;
        md += '\n';
      }
      if (v.proof_of_access) {
        md += `**Proof of access:** ${v.proof_of_access}\n\n`;
      }
      if (v.prerequisites) {
        md += `**Prerequisites:** ${v.prerequisites}\n\n`;
      }

      // Pull fix from phase 1 finding if available
      const p1 = allFindings.find(f => f.type === v.finding_type && f.file === v.file);
      if (p1?.fix) md += `**Fix:** ${p1.fix}\n\n`;
      if (p1?.evidence) {
        md += `**Vulnerable code:**\n\`\`\`\n${p1.evidence}\n\`\`\`\n\n`;
      }

      md += `---\n\n`;
    }
  }

  // ── Phase 1 findings not confirmed
  md += `## Phase 1 Findings Not Confirmed (${unconfirmed.length})\n\n`;

  if (unconfirmed.length === 0) {
    md += `All Phase 1 findings were confirmed.\n\n`;
  } else {
    for (const u of unconfirmed) {
      const reason = u.false_positive_reason || 'Could not demonstrate real impact';
      md += `- **${u.finding_type}** in \`${u.file || 'unknown'}\` — ${reason}\n`;
    }
    md += '\n';
  }

  // ── Exceptions
  md += `## Exceptions Applied (${exceptions.length})\n\n`;
  if (exceptions.length === 0) {
    md += `No exceptions file provided.\n\n`;
  } else {
    for (const e of exceptions) md += `- ${e}\n`;
    md += '\n';
  }

  // ── Metadata
  md += `---\n*Generated by security-scan.js on ${new Date().toISOString()}*\n`;

  return md;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const { project: projectPath, scope, exceptions: exceptionsFile } = opts;

  // Verify project exists
  if (!fs.existsSync(projectPath)) die(`Project path does not exist: ${projectPath}`);

  // Check claude CLI
  const claudeAvailable = await checkClaudeAvailable();
  if (!claudeAvailable) {
    die('claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code');
  }

  log(`Project: ${projectPath}`);
  log(`Scope:   ${scope}`);
  log(`Exceptions: ${exceptionsFile || 'none'}`);

  const exceptions = loadExceptions(exceptionsFile);
  if (exceptions.length > 0) log(`Loaded ${exceptions.length} exception(s)`);

  // Collect files
  log('Collecting files...');
  const files = getProjectFiles(projectPath, scope);
  log(`Files collected: ${files.length}`);

  if (files.length === 0) die('No scannable files found in project directory');

  const fileBundle = buildFileBundle(files, projectPath);
  log(`File bundle size: ${(fileBundle.length / 1024).toFixed(1)} KB`);

  // Phase 1
  const phase1Data = await phase1(projectPath, fileBundle);

  // Phase 2
  const phase2Data = await phase2(phase1Data.allFindings, fileBundle);

  // Report
  const reportContent = generateReport(
    { projectPath, scope },
    phase1Data,
    phase2Data,
    exceptions,
  );

  // Write report
  const reportDir = path.join(
    os.homedir(),
    'Desktop', 'Labirynt', '3 Atlas', 'Domains', 'general', 'security-reports'
  );
  fs.mkdirSync(reportDir, { recursive: true });

  const dateStr     = new Date().toISOString().slice(0, 10);
  const reportPath  = path.join(reportDir, `${dateStr}.md`);
  fs.writeFileSync(reportPath, reportContent, 'utf8');

  log(`\nReport written to: ${reportPath}`);

  // Also print summary to stdout
  const { confirmed, unconfirmed } = phase2Data;
  const critical = confirmed.filter(f => f.severity === 'CRITICAL').length;
  const high     = confirmed.filter(f => f.severity === 'HIGH').length;

  console.log('\n' + '─'.repeat(60));
  console.log('SECURITY SCAN COMPLETE');
  console.log('─'.repeat(60));
  console.log(`Phase 1 findings:       ${phase1Data.allFindings.length}`);
  console.log(`Confirmed:              ${confirmed.length}`);
  console.log(`  Critical:             ${critical}`);
  console.log(`  High:                 ${high}`);
  console.log(`Noise eliminated:       ${unconfirmed.length}`);
  console.log(`Report:                 ${reportPath}`);
  console.log('─'.repeat(60));

  if (critical > 0) {
    process.exit(2); // signal CI: critical vulns found
  } else if (confirmed.length > 0) {
    process.exit(1); // signal CI: non-critical vulns found
  } else {
    process.exit(0); // clean
  }
}

main().catch(err => {
  console.error('[security-scan] Fatal error:', err);
  process.exit(3);
});
