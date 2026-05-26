#!/usr/bin/env node
'use strict';
/**
 * Dream Worker — self-evolving rule promoter.
 *
 * Reads last 20 sessions (raw observations), sends to Haiku,
 * Haiku decides what corrections exist and writes one-line rules to:
 *   ~/.claude/learning/global.md        — all agents
 *   ~/.claude/learning/agents/{type}.md — specific agent
 *   ~/.claude/skills/{name}/SKILL.md    — specific skill
 *
 * Trigger: 4h cooldown + 3+ new sessions.
 * Max 5 rules per run.
 */

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOME         = process.env.HOME || '__HOME__';
const LEARNING_DIR = path.join(HOME, '.claude', 'learning');
const SESSIONS_DIR = path.join(LEARNING_DIR, 'sessions');
const AGENTS_DIR   = path.join(LEARNING_DIR, 'agents');
const PROCESSED    = path.join(LEARNING_DIR, 'processed.json');
const LAST_DREAM   = path.join(LEARNING_DIR, 'last-dream.txt');
const GLOBAL_MD    = path.join(LEARNING_DIR, 'global.md');
const SKILLS_DIR   = path.join(HOME, '.claude', 'skills');

const LOG_FILE = path.join(process.env.HOME || '__HOME__', '.claude', 'learning', 'dream-worker.log');
const LOG = (...a) => {
  const line = '[dream-worker] ' + a.join(' ') + '\n';
  process.stderr.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch (_) {}
};

// TODO: extract to ./vault-utils.js once other callers need it
// (export-rules-to-obsidian.js, backfill-wikilinks.js per GAN draft 20260425-063225)
function loadVaultNoteTitles() {
  const vaultRoot = path.join(HOME, 'Desktop/Labirynt');
  const dirs = ['3 Atlas/Problems', '3 Atlas/Tools', '3 Atlas/Synthesis'];
  const titles = [];
  for (const dir of dirs) {
    const dirPath = path.join(vaultRoot, dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const file of fs.readdirSync(dirPath)) {
      if (file.endsWith('.md')) {
        titles.push(file.replace(/\.md$/, '').replace(/\|/g, '-'));
      }
    }
  }
  return titles;
}

// Returns comma-separated wikilinks string (e.g. "[[Note A]],[[Note B]]"), or "".
async function generateWikilinks(ruleText) {
  const titles = loadVaultNoteTitles();
  if (titles.length === 0) return '';
  const noteList = titles.map(t => `"${t}"`).join(', ');
  const prompt = `Rule: "${ruleText}". Available Obsidian notes: [${noteList}]. Return JSON array of 1-3 relevant note titles as wikilinks: ["[[Title1]]", "[[Title2]]"]. Return [] if nothing is relevant. Respond with raw JSON only.`;
  const claudeBin = `${HOME}/.nvm/versions/node/v24.15.0/bin/claude`;
  const cliEnv = { ...process.env }; delete cliEnv.ANTHROPIC_API_KEY;
  const res = await new Promise((resolve) => {
    const child = spawn(claudeBin,
      ['-p', prompt, '--model', 'claude-haiku-4-5-20251001', '--output-format', 'text'],
      { env: cliEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); resolve({ stdout: '' }); }, 20000);
    child.on('error', () => { clearTimeout(timer); resolve({ stdout: '' }); });
    child.on('close', () => { clearTimeout(timer); resolve({ stdout }); });
  });
  if (!res.stdout?.trim()) return '';
  try {
    const arr = JSON.parse((res.stdout.match(/\[[\s\S]*\]/) || ['[]'])[0]);
    return Array.isArray(arr) ? arr.join(',') : '';
  } catch (_) { return ''; }
}

const META_PATTERNS = [
  'Read the session transcript at',
  'Write a concise session summary',
  'dream-worker',
  'bulk-dream',
  'Analyze these',
  'learning/sessions',
];

function isMetaSession(session) {
  const first = (session.human_messages || [])[0] || '';
  return META_PATTERNS.some(p => first.includes(p));
}

function shouldRun() {
  try {
    const raw = fs.readFileSync(LAST_DREAM, 'utf8').trim();
    if (!raw) return true;
    if (Date.now() - new Date(raw).getTime() < 4 * 3600000) {
      LOG('Cooldown active, skipping'); return false;
    }
  } catch (_) {}
  return true;
}

function loadProcessed() {
  try { return JSON.parse(fs.readFileSync(PROCESSED, 'utf8')); } catch (_) { return {}; }
}

function ensureFile(file, header) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${header}\n\n`, 'utf8');
}

function alreadyExists(file, text) {
  try {
    return fs.readFileSync(file, 'utf8').toLowerCase()
      .includes(text.toLowerCase().slice(0, 50));
  } catch (_) { return false; }
}

// Format sessions for Haiku prompt (article format)
function formatSessions(sessions, processedIds) {
  return sessions.map(s => {
    const isNew = !processedIds[path.basename(s.file)];
    const star = isNew ? '★ ' : '  ';
    const agents = s.agents_run.map(a => a.type).join(', ') || 'none';
    const skills = s.skills_read.join(', ') || 'none';
    const msgs = s.human_messages.map((m, i) => `    ${i + 1}. "${m.slice(0, 200)}"`).join('\n');
    const outputs = s.agents_run.map(a =>
      `  ${a.type} output: "${(a.output_preview || '').slice(0, 200)}"`
    ).join('\n');
    const outcome = s.outcome === 'failure' ? '[FAILURE]' : s.outcome === 'success' ? '[SUCCESS]' : '';
    return `${star}${s.ts?.split('T')[0] || 'unknown'} ${outcome} | agents:[${agents}] | skills:[${skills}]\n  Human messages:\n${msgs}${outputs ? '\n' + outputs : ''}`;
  }).join('\n\n');
}

// Build the target files list for Haiku
function buildTargetInfo(sessions) {
  const agentTypes = [...new Set(sessions.flatMap(s => s.agents_run.map(a => a.type)))];
  const skillNames = [...new Set(sessions.flatMap(s => s.skills_read))];
  const lines = [
    '- .claude/learning/global.md          for every agent',
    ...agentTypes.map(t => `- .claude/learning/agents/${t}.md   for ${t} agent`),
    ...skillNames.map(s => `- .claude/skills/${s}/SKILL.md      fix the skill that caused the mistake`)
  ];
  return lines.join('\n');
}

async function main() {
  if (!shouldRun()) return;
  fs.writeFileSync(LAST_DREAM, new Date().toISOString());

  const processed = loadProcessed();
  let sessionFiles;
  try {
    // Sort by mtime, not UUID alphabetical — UUIDs are random so sort() never picks recent files.
    // Window size honors DREAM_WINDOW env (default 20) for catch-up runs over backlog.
    const windowSize = parseInt(process.env.DREAM_WINDOW || '20', 10);
    sessionFiles = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, m: fs.statSync(path.join(SESSIONS_DIR, f)).mtimeMs }))
      .sort((a, b) => a.m - b.m)
      .slice(-windowSize)
      .map(o => path.join(SESSIONS_DIR, o.f));
  } catch (_) { LOG('No sessions dir'); return; }

  const unprocessed = sessionFiles.filter(f => !processed[path.basename(f)]);
  const realUnprocessed = unprocessed.filter(f => {
    try {
      const raw = fs.readFileSync(f, 'utf8').trim();
      const obs = JSON.parse(raw.split('\n')[0]);
      return !isMetaSession(obs);
    } catch (_) { return true; }
  });
  if (realUnprocessed.length < 3) {
    LOG(`Only ${realUnprocessed.length} new session(s), need 3+`); return;
  }
  LOG(`Processing ${realUnprocessed.length} session(s)`);

  // Load all session observations
  const sessions = sessionFiles.map(f => {
    try {
      const raw = fs.readFileSync(f, 'utf8').trim();
      const obs = JSON.parse(raw.split('\n')[0]);
      return { file: f, ...obs };
    } catch (_) { return null; }
  }).filter(Boolean);

  if (!sessions.length) { LOG('No parseable sessions'); return; }

  const realSessions = sessions.filter(s => !isMetaSession(s));
  LOG(`Filtered ${sessions.length - realSessions.length} meta sessions, ${realSessions.length} real remaining`);

  const sessionBlock = formatSessions(realSessions, processed);
  const targetBlock  = buildTargetInfo(realSessions);

  const dreamPrompt = `You analyze recent sessions and write one-line rules to prevent repeated mistakes.

★ = new since last dream. These are fresh signal.
Sessions marked [FAILURE] = higher signal — prioritize finding rules that prevent these failures.

## Sessions

${sessionBlock}

## Where to write

${targetBlock}

## Rules

- 1 session = noise. Same correction in 2+ sessions = write it.
- One-line rules only. Specific, not vague.
- Read the target file first. Do not duplicate existing rules.
- Max 5 new rules per run.

Good: "Never use em-dashes. Use commas or short sentences instead."
Bad: "Be more careful with formatting."

Output ONLY a JSON array of rules to write:
[
  {"rule": "one-line rule text", "target": "global|agents/type|skills/name", "file": "relative path"}
]
If no rules needed, output: []`;

  LOG('Sending sessions to Haiku for analysis...');
  const claudeBin = process.env.HOME
    ? `${process.env.HOME}/.nvm/versions/node/v24.15.0/bin/claude`
    : 'claude';
  // Strip ANTHROPIC_API_KEY so claude CLI falls back to OAuth from Claude Pro/Max desktop login.
  // The shell env may carry an invalid/expired key that the API rejects (auth_error).
  const cliEnv = { ...process.env }; delete cliEnv.ANTHROPIC_API_KEY;

  // Use async spawn to avoid event-loop blocking and pipe-buffer deadlocks.
  const rawOutput = await new Promise((resolve) => {
    const child = spawn(claudeBin,
      ['-p', dreamPrompt, '--model', 'claude-haiku-4-5-20251001', '--output-format', 'text'],
      { env: cliEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); resolve({ stdout: '', stderr: 'timeout', code: null }); }, 90000);
    child.on('error', err => { clearTimeout(timer); resolve({ stdout: '', stderr: err.message, code: null }); });
    child.on('close', code => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
  });

  if (!rawOutput.stdout?.trim()) {
    LOG(`Haiku call failed: code=${rawOutput.code} stderr=${rawOutput.stderr?.slice(0, 300) || ''} stdout_len=${rawOutput.stdout?.length}`);
    return;
  }

  let rules = [];
  try {
    const match = rawOutput.stdout.match(/\[[\s\S]*\]/);
    if (match) rules = JSON.parse(match[0]);
  } catch (_) {
    LOG('Could not parse Haiku output as JSON'); return;
  }

  LOG(`Haiku proposed ${rules.length} rule(s)`);
  let written = 0;

  for (const item of rules.slice(0, 5)) {
    if (!item.rule || !item.file) continue;

    const targetFile = item.file.startsWith('/')
      ? item.file
      : path.join(HOME, '.claude', item.file.replace(/^\.claude\//, ''));

    if (item.file.includes('global')) {
      ensureFile(GLOBAL_MD, '# Global Rules\n\nApply to every agent.');
    } else if (item.file.includes('agents/')) {
      ensureFile(targetFile, `# Rules for ${path.basename(targetFile, '.md')}\n`);
    } else if (item.file.includes('skills/')) {
      if (!fs.existsSync(path.dirname(targetFile))) {
        LOG(`Skill dir not found: ${path.dirname(targetFile)}, skipping`); continue;
      }
    }

    if (!fs.existsSync(targetFile) && !item.file.includes('skills/')) {
      ensureFile(targetFile, `# Rules\n`);
    }
    if (!fs.existsSync(targetFile)) { LOG(`Target not found: ${targetFile}`); continue; }

    if (alreadyExists(targetFile, item.rule)) {
      LOG(`Already exists: "${item.rule.slice(0, 50)}"`); continue;
    }

    const date = new Date().toISOString().split('T')[0];
    const wikilinks = await generateWikilinks(item.rule);
    const wikilinksMeta = wikilinks ? ` wikilinks:${wikilinks}` : '';
    fs.appendFileSync(targetFile, `${item.rule}\n<!-- dream ${date}${wikilinksMeta} -->\n\n`);
    LOG(`+ Written to ${item.file}: "${item.rule.slice(0, 60)}"`);
    written++;
  }

  // Mark processed
  for (const f of unprocessed) {
    processed[path.basename(f)] = { processedAt: new Date().toISOString() };
  }
  fs.writeFileSync(PROCESSED, JSON.stringify(processed, null, 2));
  LOG(`Done. ${written} rule(s) written from ${realUnprocessed.length} session(s).`);
}

main().catch(e => { LOG('Fatal:', e.message); process.exit(1); });
