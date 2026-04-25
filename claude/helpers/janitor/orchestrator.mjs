#!/usr/bin/env node
/**
 * Overnight Janitor Orchestrator
 *
 * Entry point called by cron at 2am:
 *   0 2 * * * /usr/local/bin/node __HOME__/.claude/helpers/janitor/orchestrator.js \
 *             >> __HOME__/.claude/helpers/janitor/logs/cron.log 2>&1
 *
 * CLI flags:
 *   --dry-run         full run, no commits, no notification
 *   --project=name    only run that project
 *
 * Env:
 *   JANITOR_SKIP_NOTIFY=1   suppress osascript
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import os from 'os';

// ---------------------------------------------------------------------------
// Bootstrap paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const JANITOR_DIR  = __dirname;
const PROJECTS_DIR = path.join(JANITOR_DIR, 'projects');
const REPORTS_DIR  = path.join(JANITOR_DIR, 'reports');
const LOGS_DIR     = path.join(JANITOR_DIR, 'logs');
const LOCK_FILE    = path.join(process.env.HOME, '.janitor.lock');

const VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const argv        = process.argv.slice(2);
const DRY_RUN     = argv.includes('--dry-run');
const SKIP_NOTIFY = process.env.JANITOR_SKIP_NOTIFY === '1';

const projectArg = (() => {
  const flag = argv.find(a => a.startsWith('--project='));
  return flag ? flag.split('=')[1] : null;
})();

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** ISO timestamp in UTC — no milliseconds */
function ts() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** YYYYMMDD in local time (branch names, filenames) */
function dateCompact() {
  const d   = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** YYYY-MM-DD in local time (human-readable labels) */
function dateDash() {
  const c = dateCompact();
  return `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}`;
}

// ---------------------------------------------------------------------------
// Structured logger — overnight[-dryrun]-YYYYMMDD.log, tab-delimited, append-only
// ---------------------------------------------------------------------------

let logStream = null;

function initLogger(isDryRun) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const fname = `overnight${isDryRun ? '-dryrun' : ''}-${dateCompact()}.log`;
  logStream   = fs.createWriteStream(path.join(LOGS_DIR, fname), { flags: 'a' });
}

/**
 * Write one structured tab-delimited log line.
 * Format: ISO-TS\tEVENT\tSUBJECT\tkv1\tkv2...
 *
 * Matches spec:
 *   2026-04-25T02:00:01Z\tSTART\torchestrator\tpid=38421
 */
function logLine(event, subject, ...kv) {
  // Filter out empty strings so optional kv pairs don't leave trailing tabs
  const parts = [ts(), event, subject, ...kv.filter(Boolean)];
  const line  = parts.join('\t');
  if (logStream) logStream.write(line + '\n');
  process.stderr.write(line + '\n');
}

// ---------------------------------------------------------------------------
// Lock file management
// ---------------------------------------------------------------------------

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write PID lock.  If a live lock exists → exit 0.  If stale → remove and continue.
 * Must be called before initLogger so ABORT can still reach stderr.
 */
function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const raw = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    const pid = parseInt(raw, 10);

    if (!isNaN(pid) && isProcessAlive(pid)) {
      // Another instance is running — exit silently (lock file is the log)
      process.stderr.write(`${ts()}\tABORT\torchestrator\treason=already-running\tpid=${pid}\n`);
      process.exit(0);
    }

    // Stale lock from a dead process
    logLine('LOCK', 'orchestrator', 'action=remove-stale', `stale-pid=${pid}`);
    fs.unlinkSync(LOCK_FILE);
  }

  fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
  logLine('LOCK', 'orchestrator', 'action=acquired', `pid=${process.pid}`);
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      // Only remove if the PID matches ours (another instance could have taken over)
      const stored = fs.readFileSync(LOCK_FILE, 'utf8').trim();
      if (stored === String(process.pid)) {
        fs.unlinkSync(LOCK_FILE);
        logLine('LOCK', 'orchestrator', 'action=released');
      }
    }
  } catch {
    // Best-effort — never crash on cleanup
  }
}

// ---------------------------------------------------------------------------
// Load project configs from projects/*.js
// ---------------------------------------------------------------------------

async function loadProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) {
    logLine('WARN', 'orchestrator', `projects-dir-missing=${PROJECTS_DIR}`);
    return [];
  }

  const files    = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.js') || f.endsWith('.cjs'));
  const projects = [];

  for (const file of files) {
    const filePath = path.join(PROJECTS_DIR, file);
    try {
      // Support both `export default {}` (ESM) and `module.exports = {}` (CJS)
      const mod = await import(filePath);
      const cfg = mod.default ?? mod;
      if (cfg && typeof cfg === 'object' && cfg.name) {
        projects.push(cfg);
      } else {
        logLine('WARN', 'orchestrator', `bad-project-config=${file}`, 'reason=missing-name');
      }
    } catch (err) {
      logLine('ERROR', 'orchestrator', `load-project-failed=${file}`, `err=${err.message}`);
    }
  }

  return projects;
}

// ---------------------------------------------------------------------------
// SCAN phase
//
// Spawns run.js as a child process (it is CJS; avoids ESM/CJS interop) with
// --dry-run --project=<name> so only stdout (the markdown report) is captured.
// Issue count = lines starting with '- ' in the markdown output.
// The shared AbortController propagates the 60s budget via the spawn signal.
// ---------------------------------------------------------------------------

/**
 * @param {{ name: string, root: string }} project
 * @param {AbortSignal} signal
 * @returns {Promise<{ status: 'ok'|'error'|'skip'|'timeout', issues: number, duration: string }>}
 */
function scanProject(project, signal) {
  const start     = Date.now();
  const runScript = path.join(JANITOR_DIR, 'run.js');

  if (!fs.existsSync(runScript)) {
    logLine('WARN', project.name, 'scan=skip', 'reason=run.js-not-found');
    return Promise.resolve({ status: 'skip', issues: 0, duration: '0s' });
  }

  return new Promise(resolve => {
    let finished = false;
    let output   = '';
    let errout   = '';

    const child = spawn(
      process.execPath,
      [runScript, '--dry-run', `--project=${project.name}`],
      { env: process.env, signal },
    );

    const elapsed = () => ((Date.now() - start) / 1000).toFixed(1) + 's';

    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { errout  += d; });

    child.on('close', code => {
      if (finished) return;
      finished = true;
      const issues = (output.match(/^- /mg) ?? []).length;
      if (code === 0 || code === null) {
        resolve({ status: 'ok', issues, duration: elapsed() });
      } else {
        resolve({ status: 'error', issues, duration: elapsed(), detail: errout.trim() });
      }
    });

    child.on('error', err => {
      if (finished) return;
      finished = true;
      if (err.name === 'AbortError') {
        resolve({ status: 'timeout', issues: 0, duration: elapsed() });
      } else {
        resolve({ status: 'error', issues: 0, duration: elapsed(), detail: err.message });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// SLOP-CLEANER phase
// ---------------------------------------------------------------------------

/**
 * @param {{ name: string }} project
 * @param {{ dryRun: boolean, batchSize: number, branchName: string, signal: AbortSignal }} options
 * @returns {Promise<{ removed: object[], flagged: object[], aborted: boolean, reason?: string,
 *                     safetyBatches?: object[], commits?: object[] }>}
 */
async function invokeSlop(project, options) {
  const cleanerPath = path.join(JANITOR_DIR, 'slop-cleaner.mjs');

  if (!fs.existsSync(cleanerPath)) {
    logLine('WARN', project.name, 'slop=skip', 'reason=slop-cleaner.mjs-not-found');
    return { removed: [], flagged: [], aborted: false, reason: 'no-cleaner' };
  }

  let cleaner;
  try {
    const mod = await import(cleanerPath);
    cleaner   = mod.runSlopCleaner ?? mod.default?.runSlopCleaner;
  } catch (err) {
    logLine('ERROR', project.name, `slop=load-error`, `err=${err.message}`);
    return { removed: [], flagged: [], aborted: true, reason: `load-error: ${err.message}` };
  }

  if (typeof cleaner !== 'function') {
    logLine('WARN', project.name, 'slop=skip', 'reason=runSlopCleaner-not-exported');
    return { removed: [], flagged: [], aborted: false, reason: 'bad-export' };
  }

  try {
    return await cleaner(project, options);
  } catch (err) {
    if (err.name === 'AbortError') {
      logLine('WARN', project.name, 'slop=timeout');
      return { removed: [], flagged: [], aborted: true, reason: 'timeout' };
    }
    logLine('ERROR', project.name, `slop=error`, `err=${err.message}`);
    return { removed: [], flagged: [], aborted: true, reason: err.message };
  }
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

/**
 * @param {{ project: object, status: string, issues: number, duration: string }[]} scanResults
 * @param {{ project: object, removed: object[], flagged: object[],
 *           safetyLayers?: object, aborted?: boolean }[]} slopResults
 * @param {number} totalRunMs
 * @returns {string} Markdown content
 */
function buildSlopReport(scanResults, slopResults, totalRunMs) {
  const date         = dateDash();
  const compact      = dateCompact();
  const branchName   = `janitor/slop-${compact}`;
  const totalRemoved = slopResults.reduce((n, r) => n + (r.removed?.length ?? 0), 0);
  const totalFlagged = slopResults.reduce((n, r) => n + (r.flagged?.length ?? 0), 0);
  const runtimeSec   = Math.round(totalRunMs / 1000) + 's';

  // Shortcut for a clean run
  if (totalRemoved === 0 && totalFlagged === 0) {
    return [
      `# Janitor Report — ${date}`,
      '',
      '## Summary',
      '- Nothing removed, nothing flagged.',
      `- Branch: ${branchName}`,
      `- Runtime: ${runtimeSec}`,
      '',
    ].join('\n');
  }

  const lines = [
    `# Janitor Report — ${date}`,
    '',
    '## Summary',
    `- Removed: ${totalRemoved} dead selector${totalRemoved !== 1 ? 's' : ''} across ` +
      `${slopResults.filter(r => (r.removed?.length ?? 0) > 0).length} project(s)`,
    `- Flagged: ${totalFlagged} risky selector${totalFlagged !== 1 ? 's' : ''} — manual review needed`,
    `- Branch: ${branchName}`,
    `- Runtime: ${runtimeSec}`,
    '',
    '---',
    '',
  ];

  // Removed section
  if (totalRemoved > 0) {
    lines.push('## Removed (auto, high confidence)', '');
    for (const r of slopResults) {
      if (!r.removed?.length) continue;
      lines.push(`### ${r.project.name} — ${r.removed.length} selector${r.removed.length !== 1 ? 's' : ''}`);
      lines.push('| Selector | File | Score | Reason |');
      lines.push('|----------|------|-------|--------|');
      for (const issue of r.removed) {
        lines.push(`| \`${issue.selector}\` | ${issue.file} | ${issue.confidence} | ${issue.reason} |`);
      }
      lines.push('');
    }
  }

  // Flagged section
  if (totalFlagged > 0) {
    lines.push('## Flagged (manual review needed)', '');
    for (const r of slopResults) {
      if (!r.flagged?.length) continue;
      lines.push(`### ${r.project.name} — ${r.flagged.length} selector${r.flagged.length !== 1 ? 's' : ''}`);
      lines.push('| Selector | File | Score | Reason |');
      lines.push('|----------|------|-------|--------|');
      for (const issue of r.flagged) {
        lines.push(`| \`${issue.selector}\` | ${issue.file} | ${issue.confidence} | ${issue.reason} |`);
      }
      lines.push('');
    }
  }

  // Safety check aggregate
  lines.push('---', '', '## Safety Check Results');
  lines.push(...buildSafetyLines(slopResults));
  lines.push('');

  // Scan summary
  lines.push('---', '', '## Scan Summary');
  for (const s of scanResults) {
    const detail = s.status === 'skip'    ? 'SKIPPED'
                 : s.status === 'timeout' ? 'TIMEOUT'
                 : s.status === 'error'   ? 'ERROR'
                 : `${s.issues} issue${s.issues !== 1 ? 's' : ''}`;
    lines.push(`- **${s.project.name}**: ${detail} (${s.duration})`);
  }
  lines.push('');

  // Approval instructions
  lines.push(
    '---', '',
    '## What to do',
    `1. **Approve:** \`git checkout main && git merge --no-ff ${branchName} -m "merge: ${branchName}"\``,
    `2. **Reject:** \`git branch -D ${branchName}\``,
    '3. **Partial:** check out branch, revert specific commits, then merge.',
    '',
  );

  return lines.join('\n');
}

/**
 * Aggregate safety layer pass/fail from all slop results.
 * @returns {string[]}
 */
function buildSafetyLines(slopResults) {
  const layers = { layer1: [], layer2: [], layer3: [] };

  for (const r of slopResults) {
    if (!r.safetyLayers) continue;
    for (const k of Object.keys(layers)) {
      if (r.safetyLayers[k]) layers[k].push(r.safetyLayers[k]);
    }
  }

  const fmt = (key, label) => {
    if (!layers[key].length) return `- ${label}: N/A`;
    return `- ${label}: ${layers[key].every(v => v === 'pass') ? 'PASS' : 'FAIL'}`;
  };

  return [
    fmt('layer1', 'Layer 1 (re-scan delta)'),
    fmt('layer2', 'Layer 2 (class-existence scan)'),
    fmt('layer3', 'Layer 3 (visual diff)'),
  ];
}

// ---------------------------------------------------------------------------
// macOS notification
// ---------------------------------------------------------------------------

function sendNotification(title, message) {
  if (SKIP_NOTIFY || DRY_RUN) {
    logLine('NOTIFY', 'suppressed', `title="${title}"`, `message="${message}"`);
    return;
  }

  try {
    const esc = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    execFileSync('osascript', [
      '-e',
      `display notification "${esc(message)}" with title "${esc(title)}"`,
    ], { stdio: 'ignore', timeout: 10_000 });
    logLine('NOTIFY', 'sent', `summary="${message}"`);
  } catch (err) {
    // Best-effort — never crash the orchestrator over a notification failure
    logLine('WARN', 'orchestrator', `notify-failed=${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main orchestration sequence
// ---------------------------------------------------------------------------

async function main() {
  const runStart = Date.now();

  // 0. Init logger first so every subsequent step has a structured log
  initLogger(DRY_RUN);

  // 1. Lock ---------------------------------------------------------------
  acquireLock();

  // Ensure lock is always released — cover signals and uncaught exceptions
  process.on('exit',             releaseLock);
  process.on('SIGTERM',          () => { releaseLock(); process.exit(0); });
  process.on('SIGINT',           () => { releaseLock(); process.exit(0); });
  process.on('uncaughtException', err => {
    logLine('FATAL', 'orchestrator', `err=${err.message}`);
    releaseLock();
    process.exit(0); // always exit 0 — never break cron
  });

  logLine('START', 'orchestrator', `v${VERSION}`, `pid=${process.pid}`, DRY_RUN ? 'dry-run=true' : '');

  // 2. Load projects ------------------------------------------------------
  let allProjects = await loadProjects();

  if (projectArg) {
    allProjects = allProjects.filter(p => p.name === projectArg);
    if (allProjects.length === 0) {
      logLine('ABORT', 'orchestrator', 'reason=project-not-found', `name=${projectArg}`);
      releaseLock();
      process.exit(0);
    }
  }

  // 3. Guard check — skip projects whose root dir does not exist ----------
  const activeProjects = [];

  for (const project of allProjects) {
    // Normalise root alias used by some older configs
    if (!project.root && project.projectRoot) project.root = project.projectRoot;

    if (!project.root || !fs.existsSync(project.root)) {
      logLine('SKIP', project.name, 'reason=dir-not-found', `path=${project.root ?? 'undefined'}`);
      continue;
    }

    activeProjects.push(project);
  }

  if (activeProjects.length === 0) {
    logLine('WARN', 'orchestrator', 'no-active-projects');
  }

  // 4. SCAN phase — 60s total budget -------------------------------------
  const scanResults  = [];
  let   scanTimedOut = false;

  if (activeProjects.length > 0) {
    const scanAbort     = new AbortController();
    const scanTimeoutId = setTimeout(() => {
      scanAbort.abort();
      scanTimedOut = true;
      logLine('TIMEOUT', 'SCAN', 'budget=60s');
    }, 60_000);

    for (const project of activeProjects) {
      if (scanAbort.signal.aborted) {
        logLine('SKIP', project.name, 'reason=scan-budget-exhausted');
        scanResults.push({ project, status: 'skip', issues: 0, duration: '0s' });
        continue;
      }

      let result;
      try {
        result = await scanProject(project, scanAbort.signal);
      } catch (err) {
        result = { status: 'error', issues: 0, duration: '0s', detail: err.message };
      }

      scanResults.push({ project, ...result });

      if (result.status === 'ok') {
        logLine('SCAN', project.name, `status=ok`, `issues=${result.issues}`, `duration=${result.duration}`);
      } else {
        logLine('SCAN', project.name, `status=${result.status}`, `duration=${result.duration}`);
      }
    }

    clearTimeout(scanTimeoutId);

    const totalIssues   = scanResults.reduce((n, r) => n + (r.issues ?? 0), 0);
    const totalDuration = ((Date.now() - runStart) / 1000).toFixed(1) + 's';
    logLine('SCAN', 'TOTAL', `issues=${totalIssues}`, `duration=${totalDuration}`);
  }

  // 5. SLOP-CLEANER phase — 600s total budget ----------------------------
  const slopResults = [];
  const compact     = dateCompact();
  const branchName  = `janitor/slop-${compact}`;

  const shouldRunSlop = activeProjects.length > 0 && !scanTimedOut;

  if (shouldRunSlop) {
    logLine('SLOP', branchName, 'created');

    const slopAbort     = new AbortController();
    const slopTimeoutId = setTimeout(() => {
      slopAbort.abort();
      logLine('TIMEOUT', 'SLOP', 'budget=600s', 'action=abort-current-batch');
    }, 600_000);

    for (const project of activeProjects) {
      if (slopAbort.signal.aborted) {
        logLine('SKIP', project.name, 'reason=slop-budget-exhausted');
        slopResults.push({ project, removed: [], flagged: [], aborted: true, reason: 'budget-exhausted' });
        continue;
      }

      // One failing project must never crash the loop
      let result;
      try {
        result = await invokeSlop(project, {
          dryRun:     DRY_RUN,
          batchSize:  5,
          branchName,
          signal:     slopAbort.signal,
        });
      } catch (err) {
        logLine('ERROR', project.name, `slop=unhandled`, `err=${err.message}`);
        result = { removed: [], flagged: [], aborted: true, reason: err.message };
      }

      slopResults.push({ project, ...result });

      logLine(
        'SLOP', project.name,
        `candidates=${(result.removed?.length ?? 0) + (result.flagged?.length ?? 0)}`,
        `auto=${result.removed?.length ?? 0}`,
        `flag=${result.flagged?.length ?? 0}`,
        result.aborted ? `aborted=true` : '',
        result.aborted && result.reason ? `reason=${result.reason}` : '',
      );

      // Per-batch safety layer log lines (if slop-cleaner provides them)
      if (Array.isArray(result.safetyBatches)) {
        for (const batch of result.safetyBatches) {
          logLine(
            'SAFETY',
            `layer1=${batch.layer1 ?? 'n/a'}`,
            `layer2=${batch.layer2 ?? 'n/a'}`,
            `layer3=${batch.layer3 ?? 'n/a'}`,
            `batch=${batch.batchIndex ?? '?'}`,
            `removed=${batch.removed ?? 0}`,
          );
        }
      }

      // Commit SHAs (if slop-cleaner provides them)
      if (Array.isArray(result.commits)) {
        for (const commit of result.commits) {
          logLine('COMMIT', commit.message, `sha=${commit.sha}`);
        }
      }
    }

    clearTimeout(slopTimeoutId);
  } else if (scanTimedOut) {
    logLine('SKIP', 'SLOP', 'reason=scan-timeout');
  }

  // 6. Write slop-report-YYYYMMDD.md -------------------------------------
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const reportName = `slop-report-${compact}${DRY_RUN ? '-dryrun' : ''}.md`;
  const reportPath = path.join(REPORTS_DIR, reportName);
  const reportText = buildSlopReport(scanResults, slopResults, Date.now() - runStart);

  fs.writeFileSync(reportPath, reportText, 'utf8');

  const totalRemoved = slopResults.reduce((n, r) => n + (r.removed?.length ?? 0), 0);
  const totalFlagged = slopResults.reduce((n, r) => n + (r.flagged?.length ?? 0), 0);

  logLine('REPORT', reportName,
    `flagged=${totalFlagged}`,
    `removed=${totalRemoved}`,
    `branches=1`,
  );

  // 7. macOS notification ------------------------------------------------
  const notifyTitle   = `Janitor done — ${dateDash()}`;
  const notifyMessage = `${totalRemoved} dead selector${totalRemoved !== 1 ? 's' : ''} removed. ` +
                        `${totalFlagged} flagged. Branch: ${branchName}`;

  sendNotification(notifyTitle, notifyMessage);

  // 8. Write Obsidian Inbox entry if actionable ----------------------------
  if (!DRY_RUN && (totalRemoved > 0 || totalFlagged > 0)) {
    try {
      const inboxDir  = path.join(os.homedir(), 'Desktop', 'Labirynt', '0 Inbox');
      const inboxFile = path.join(inboxDir, `janitor-${dateDash()}.md`);
      fs.mkdirSync(inboxDir, { recursive: true });
      const branchCmd = totalRemoved > 0
        ? `\`git checkout main && git merge --no-ff ${branchName}\``
        : '*(no branch — flag-only run)*';
      const inboxText = [
        '---',
        'type: inbox',
        `created: ${dateDash()}`,
        'tags: [janitor, review-needed]',
        '---',
        '',
        `# Janitor — ${dateDash()}`,
        '',
        `- **Removed:** ${totalRemoved} dead CSS selectors`,
        `- **Flagged:** ${totalFlagged} for manual review`,
        `- **Branch:** \`${branchName}\``,
        '',
        '## Action',
        '',
        `Approve: ${branchCmd}`,
        `Reject: \`git branch -D ${branchName}\``,
        '',
        `Full report: [[${reportName}]]`,
      ].join('\n');
      fs.writeFileSync(inboxFile, inboxText, 'utf8');
      logLine('INBOX', 'wrote', `file=${inboxFile}`);
    } catch (err) {
      logLine('WARN', 'inbox-write-failed', `err=${err.message}`);
    }
  }

  // 9. Release lock + flush log ------------------------------------------
  const durationSec = Math.round((Date.now() - runStart) / 1000) + 's';
  logLine('END', `duration=${durationSec}`, 'status=ok');

  releaseLock();

  await new Promise(resolve => {
    if (logStream) logStream.end(resolve);
    else           resolve();
  });

  process.exit(0);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch(err => {
  // Last-resort safety net — never break cron
  const line = `${ts()}\tFATAL\torchestrator\t${err?.stack ?? err?.message ?? String(err)}`;
  process.stderr.write(line + '\n');
  if (logStream) logStream.write(line + '\n');
  releaseLock();
  process.exit(0);
});
