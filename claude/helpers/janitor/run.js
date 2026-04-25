#!/usr/bin/env node
'use strict';

/**
 * Janitor — nightly dead-code/dead-css runner.
 *
 * Usage:
 *   node run.js
 *   node run.js --dry-run
 *   node run.js --project=portfolio
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args      = process.argv.slice(2);
const DRY_RUN   = args.includes('--dry-run');
const projectArg = (() => {
  const flag = args.find(a => a.startsWith('--project='));
  return flag ? flag.split('=')[1] : null;
})();

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const JANITOR_DIR  = __dirname;
const CHECKS_DIR   = path.join(JANITOR_DIR, 'checks');
const PROJECTS_DIR = path.join(JANITOR_DIR, 'projects');
const REPORTS_DIR  = path.join(JANITOR_DIR, 'reports');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today() {
  // YYYY-MM-DD in local time
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function log(msg) {
  process.stderr.write(`[janitor] ${msg}\n`);
}

/**
 * Dynamically require a module, returning null if the file doesn't exist or
 * throws on load.  We intentionally surface non-ENOENT errors so bugs in
 * check/project modules aren't silently swallowed.
 */
function safeRequire(filePath) {
  try {
    return require(filePath);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      // Could be a missing dep inside the module — re-throw those.
      // Only swallow when the top-level file itself is absent.
      if (err.message.includes(filePath)) return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Load check modules (optional — runner degrades gracefully if absent)
// ---------------------------------------------------------------------------

const checkDeadCss = (() => {
  const mod = safeRequire(path.join(CHECKS_DIR, 'dead-css.js'));
  return mod ? mod.checkDeadCss : null;
})();

const checkDeadJs = (() => {
  const mod = safeRequire(path.join(CHECKS_DIR, 'dead-js.js'));
  return mod ? mod.checkDeadJs : null;
})();

// ---------------------------------------------------------------------------
// Load project configs
// ---------------------------------------------------------------------------

function loadProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) {
    log(`projects/ directory not found at ${PROJECTS_DIR} — nothing to run`);
    return [];
  }

  const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.js'));

  const projects = [];
  for (const file of files) {
    const filePath = path.join(PROJECTS_DIR, file);
    try {
      const mod = require(filePath);
      projects.push(mod);
    } catch (err) {
      log(`ERROR loading project config ${file}: ${err.message}`);
    }
  }

  return projects;
}

// ---------------------------------------------------------------------------
// Run checks for a single project
// ---------------------------------------------------------------------------

/**
 * @typedef {{ type: string, message: string }} Issue
 */

/**
 * @param {object} project
 * @returns {{ deadCss: Issue[], deadJs: Issue[], custom: Issue[] }}
 */
async function runProject(project) {
  const result = { deadCss: [], deadJs: [], custom: [] };

  // Resolve file lists — getters may be sync or async
  const [htmlFiles, cssFiles, jsFiles] = await Promise.all([
    Promise.resolve(
      typeof project.getHtmlFiles === 'function'
        ? project.getHtmlFiles(project.root)
        : []
    ),
    Promise.resolve(
      typeof project.getCssFiles === 'function'
        ? project.getCssFiles(project.root)
        : []
    ),
    Promise.resolve(
      typeof project.getJsFiles === 'function'
        ? project.getJsFiles(project.root)
        : []
    ),
  ]);

  // Dead CSS
  if (checkDeadCss && cssFiles.length > 0) {
    try {
      const raw = await Promise.resolve(checkDeadCss({ htmlFiles, cssFiles }));
      result.deadCss = Array.isArray(raw) ? raw.map(i => ({
        message: i.selector || i.message || String(i),
        location: i.file ? `${i.file.split('/').pop()}:${(i.lines||[])[0]||'?'}` : (i.location || ''),
      })) : [];
    } catch (err) {
      log(`  dead-css check failed for ${project.name}: ${err.message}`);
      result.deadCss = [{ type: 'ERROR', message: `dead-css check threw: ${err.message}` }];
    }
  }

  // Dead JS
  if (checkDeadJs && jsFiles.length > 0) {
    try {
      const raw = await Promise.resolve(checkDeadJs({ htmlFiles, jsFiles }));
      result.deadJs = Array.isArray(raw) ? raw.map(i => ({
        message: i.ref || i.message || String(i),
        location: i.file ? `${i.file.split('/').pop()}:${i.line||'?'} (${i.type||'ref'})` : (i.location || ''),
      })) : [];
    } catch (err) {
      log(`  dead-js check failed for ${project.name}: ${err.message}`);
      result.deadJs = [{ type: 'ERROR', message: `dead-js check threw: ${err.message}` }];
    }
  }

  // Custom checks
  const cc = project.customChecks;
  if (cc) {
    try {
      let issues;
      if (typeof cc === 'function') {
        issues = await Promise.resolve(cc(project.root));
      } else if (Array.isArray(cc)) {
        // Array of zero-arg check functions
        const results = await Promise.all(cc.map(fn => Promise.resolve(fn())));
        issues = results.flatMap(r => {
          if (Array.isArray(r)) return r;
          if (r && Array.isArray(r.findings)) return r.findings.map(f => ({
            type: r.name || 'custom',
            message: f.message || f.description || String(f),
            location: f.location || f.file || '',
          }));
          return [];
        });
      }
      result.custom = Array.isArray(issues) ? issues.map(i => ({
        type: i.type || i.severity || 'issue',
        message: i.message || i.description || String(i),
        location: i.location || i.file || '',
      })) : [];
    } catch (err) {
      log(`  custom checks failed for ${project.name}: ${err.message}`);
      result.custom = [{ type: 'ERROR', message: `customChecks threw: ${err.message}` }];
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

/**
 * Format a list of issues as markdown list items.
 * Each issue is expected to be a string or { message, location? }.
 */
function formatIssues(issues) {
  return issues.map(issue => {
    if (typeof issue === 'string') return `- ${issue}`;
    const loc  = issue.location ? ` — ${issue.location}` : '';
    const type = issue.type && issue.type !== 'issue' ? `[${issue.type}] ` : '';
    return `- ${type}${issue.message}${loc}`;
  }).join('\n');
}

function buildReport(date, projectResults) {
  const lines = [`# Janitor Report ${date}`, ''];

  for (const { project, checks } of projectResults) {
    const total = checks.deadCss.length + checks.deadJs.length + checks.custom.length;
    lines.push(`## ${project.name} — ${total} issue${total !== 1 ? 's' : ''}`);

    if (total === 0) {
      lines.push('✓ Clean');
    } else {
      if (checks.deadCss.length > 0) {
        lines.push(`### Dead CSS (${checks.deadCss.length})`);
        lines.push(formatIssues(checks.deadCss));
      }
      if (checks.deadJs.length > 0) {
        lines.push(`### Dead JS (${checks.deadJs.length})`);
        lines.push(formatIssues(checks.deadJs));
      }
      if (checks.custom.length > 0) {
        lines.push(`### Custom (${checks.custom.length})`);
        lines.push(formatIssues(checks.custom));
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// macOS notification
// ---------------------------------------------------------------------------

function notify(title, message) {
  try {
    const safe = s => s.replace(/"/g, '\\"');
    execSync(
      `osascript -e 'display notification "${safe(message)}" with title "${safe(title)}"'`,
      { stdio: 'ignore' }
    );
  } catch {
    // Notifications are best-effort — never crash the runner.
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`starting${DRY_RUN ? ' (dry-run)' : ''}${projectArg ? ` for project=${projectArg}` : ''}`);

  const allProjects = loadProjects();

  // Apply --project filter
  const projects = projectArg
    ? allProjects.filter(p => p.name === projectArg)
    : allProjects;

  if (projectArg && projects.length === 0) {
    log(`ERROR: no project named "${projectArg}" found in projects/`);
    process.exit(0); // exit 0 — never block cron
  }

  // Only enabled projects whose root exists
  /** @type {{ project: object, checks: object }[]} */
  const projectResults = [];

  for (const project of projects) {
    // Normalize: accept both `root` and `projectRoot`
    if (!project.root && project.projectRoot) project.root = project.projectRoot;
    // Default enabled to true if not set
    if (project.enabled === undefined) project.enabled = true;

    if (!project.enabled) {
      log(`skip ${project.name} (disabled)`);
      continue;
    }

    if (!project.root || !fs.existsSync(project.root)) {
      log(`skip ${project.name} (root not found: ${project.root})`);
      continue;
    }

    log(`checking ${project.name} (${project.root})`);

    let checks;
    try {
      checks = await runProject(project);
    } catch (err) {
      log(`ERROR in ${project.name}: ${err.message}`);
      checks = {
        deadCss: [{ type: 'ERROR', message: err.message }],
        deadJs:  [],
        custom:  [],
      };
    }

    const total = checks.deadCss.length + checks.deadJs.length + checks.custom.length;
    log(`  ${project.name}: ${total} issue(s)`);

    projectResults.push({ project, checks });
  }

  // Build report
  const date   = today();
  const report = buildReport(date, projectResults);

  if (DRY_RUN) {
    process.stdout.write(report);
    process.stdout.write('\n');
    log('dry-run complete — no file written, no notification sent');
    process.exit(0);
  }

  // Write report file
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const reportPath = path.join(REPORTS_DIR, `${date}.md`);
  fs.writeFileSync(reportPath, report, 'utf8');
  log(`report written to ${reportPath}`);

  // macOS notification
  const totalIssues = projectResults.reduce(
    (sum, { checks }) => sum + checks.deadCss.length + checks.deadJs.length + checks.custom.length,
    0
  );

  if (totalIssues === 0) {
    notify('Janitor', 'all clean ✓');
  } else {
    const breakdown = projectResults
      .filter(({ checks }) => checks.deadCss.length + checks.deadJs.length + checks.custom.length > 0)
      .map(({ project, checks }) => {
        const n = checks.deadCss.length + checks.deadJs.length + checks.custom.length;
        return `${project.name}(${n})`;
      })
      .join(' ');
    notify('Janitor', `${totalIssues} issues — ${breakdown}`);
  }

  // Always exit 0 — never block cron
  process.exit(0);
}

main().catch(err => {
  // Last-resort safety net: log and exit cleanly
  process.stderr.write(`[janitor] FATAL: ${err.stack || err.message}\n`);
  process.exit(0);
});
