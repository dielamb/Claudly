#!/usr/bin/env node
'use strict';
/**
 * Bulk Dream Runner — processes ALL historical sessions in batches.
 * Unlike dream-worker (reads last 20), this scrolls from oldest → newest.
 * Max 2 rules/batch to reduce noise across 450+ Haiku calls.
 */

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HOME         = process.env.HOME || '__HOME__';
const LEARNING_DIR = path.join(HOME, '.claude', 'learning');
const SESSIONS_DIR = path.join(LEARNING_DIR, 'sessions');
const AGENTS_DIR   = path.join(LEARNING_DIR, 'agents');
const PROCESSED    = path.join(LEARNING_DIR, 'processed.json');
const GLOBAL_MD    = path.join(LEARNING_DIR, 'global.md');
const SKILLS_DIR   = path.join(HOME, '.claude', 'skills');
const LOG_FILE     = path.join(LEARNING_DIR, 'bulk-dream.log');
const BATCH_SIZE   = 20;
const MAX_RULES    = 2;
const SLEEP_MS     = 1500;

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

const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`;
  process.stdout.write(line);
  fs.appendFileSync(LOG_FILE, line);
};

function loadProcessed() {
  try { return JSON.parse(fs.readFileSync(PROCESSED, 'utf8')); } catch (_) { return {}; }
}

function saveProcessed(p) {
  fs.writeFileSync(PROCESSED, JSON.stringify(p, null, 2));
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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function formatBatch(sessions) {
  return sessions.map(s => {
    const agents = s.agents_run.map(a => a.type).join(', ') || 'none';
    const skills = s.skills_read.join(', ') || 'none';
    const msgs = s.human_messages.map((m, i) => `  ${i+1}. "${m.slice(0, 150)}"`).join('\n');
    const outcome = s.outcome === 'failure' ? '[FAILURE]' : s.outcome === 'success' ? '[SUCCESS]' : '';
    return `${s.ts?.split('T')[0] || 'unknown'} ${outcome} | agents:[${agents}] | skills:[${skills}]\n${msgs}`;
  }).join('\n\n');
}

function buildTargetInfo(sessions) {
  const agentTypes = [...new Set(sessions.flatMap(s => s.agents_run.map(a => a.type)))].filter(Boolean);
  const skillNames = [...new Set(sessions.flatMap(s => s.skills_read))].filter(Boolean);
  const lines = [
    '- learning/global.md (all agents)',
    ...agentTypes.map(t => `- learning/agents/${t}.md`),
    ...skillNames.map(s => `- skills/${s}/SKILL.md`),
  ];
  return lines.join('\n');
}

async function processBatch(sessions, processed) {
  const sessionBlock = formatBatch(sessions);
  const targetBlock  = buildTargetInfo(sessions);

  const prompt = `Analyze these ${sessions.length} Claude Code sessions. Find corrections/mistakes that appear in 2+ sessions. Write max ${MAX_RULES} specific one-line rules to prevent recurrence.

Sessions marked [FAILURE] = higher signal — prioritize finding rules that prevent these failures.

Sessions:
${sessionBlock}

Available targets:
${targetBlock}

Rules:
- 1 session = noise. Same issue in 2+ sessions = write it.
- Specific, not vague. One-line only.
- Good: "Never use em-dashes. Use commas or short sentences instead."
- Bad: "Be more careful with formatting."

Output ONLY JSON array (or [] if nothing found):
[{"rule": "one-line rule", "target": "global|agents/type|skills/name", "file": "relative path"}]`;

  const claudeBin = process.env.HOME
    ? `${process.env.HOME}/.nvm/versions/node/v24.15.0/bin/claude`
    : 'claude';

  const result = spawnSync(
    claudeBin,
    ['-p', prompt, '--model', 'claude-haiku-4-5-20251001', '--output-format', 'text'],
    { encoding: 'utf8', timeout: 60000 }
  );

  if (result.status !== 0 || !result.stdout?.trim()) {
    log(`Haiku call failed: status=${result.status} err=${result.error?.code || ''} stderr=${result.stderr?.slice(0, 80)} stdout=${result.stdout?.slice(0, 80)}`);
    return 0;
  }

  let rules = [];
  try {
    const match = result.stdout.match(/\[[\s\S]*?\]/);
    if (match) rules = JSON.parse(match[0]);
  } catch (_) {
    log('JSON parse error, skipping batch');
    return 0;
  }

  let written = 0;
  for (const item of rules.slice(0, MAX_RULES)) {
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
        log(`Skill dir missing: ${path.dirname(targetFile)}`); continue;
      }
    }

    if (!fs.existsSync(targetFile) && !item.file.includes('skills/')) {
      ensureFile(targetFile, '# Rules\n');
    }
    if (!fs.existsSync(targetFile)) { log(`Target missing: ${targetFile}`); continue; }
    if (alreadyExists(targetFile, item.rule)) { log(`Duplicate skipped: "${item.rule.slice(0, 50)}"`); continue; }

    const date = new Date().toISOString().split('T')[0];
    fs.appendFileSync(targetFile, `${item.rule}\n<!-- bulk-dream ${date} -->\n\n`);
    log(`+ Rule: "${item.rule.slice(0, 60)}" → ${item.file}`);
    written++;
  }

  return written;
}

async function main() {
  log('=== Bulk Dream Runner started ===');

  let allFiles;
  try {
    allFiles = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .sort(); // oldest first
  } catch (_) {
    log('No sessions dir — run parser first'); process.exit(1);
  }

  const processed = loadProcessed();
  const unprocessed = allFiles.filter(f => !processed[f]);

  log(`Total sessions: ${allFiles.length}, unprocessed: ${unprocessed.length}`);

  if (unprocessed.length === 0) {
    log('All sessions already processed. Done.'); return;
  }

  // Separate real vs meta up front — only call haiku with full BATCH_SIZE real sessions
  let metaCount = 0;
  const realSessions = [];

  for (const f of unprocessed) {
    let session;
    try {
      const raw = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8').trim();
      session = { file: f, ...JSON.parse(raw.split('\n')[0]) };
    } catch (_) { processed[f] = { processedAt: new Date().toISOString(), skipped: 'parse-error' }; continue; }

    if (isMetaSession(session)) {
      processed[f] = { processedAt: new Date().toISOString(), skipped: 'meta' };
      metaCount++;
    } else {
      realSessions.push(session);
    }
  }

  saveProcessed(processed);
  log(`Filtered: ${realSessions.length} real sessions, ${metaCount} meta skipped`);

  if (realSessions.length === 0) {
    log('No real sessions to process. Done.'); return;
  }

  const totalBatches = Math.ceil(realSessions.length / BATCH_SIZE);
  let totalRules = 0;

  for (let i = 0; i < realSessions.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = realSessions.slice(i, i + BATCH_SIZE);

    log(`Batch ${batchNum}/${totalBatches}: ${batch.length} real sessions...`);
    const written = await processBatch(batch, processed);
    totalRules += written;

    for (const s of batch) processed[s.file] = { processedAt: new Date().toISOString() };
    saveProcessed(processed);

    log(`Batch ${batchNum}/${totalBatches} done. Rules written: ${written}. Total so far: ${totalRules}`);

    if (i + BATCH_SIZE < realSessions.length) {
      await sleep(SLEEP_MS);
    }
  }

  log(`=== Done. ${totalBatches} batches, ${totalRules} total rules written ===`);
}

main().catch(e => { log('Fatal:', e.message); process.exit(1); });
