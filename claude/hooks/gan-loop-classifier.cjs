#!/usr/bin/env node
// gan-loop-classifier.cjs
// Claude Code Stop hook: detects shipping artifacts and triggers the GAN loop.
// Zero-dependency (fs, path, child_process, http only). Must exit 0 always.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');

// ─── Constants ────────────────────────────────────────────────────────────────
const COOLDOWN_FILE = '/tmp/gan-loop-classifier-last-run';
const COOLDOWN_MS = 8 * 60 * 1000;
const GAN_LOOP_DIR = path.join(os.homedir(), '.claude', 'tools', 'gan-loop');
const BRIEFS_DIR = path.join(GAN_LOOP_DIR, 'briefs');
const RUFLO_URL = 'http://localhost:8741/message';
const WATCHER_SCRIPT = path.join(__dirname, 'gan-loop-watcher.cjs');

// ─── Artifact classification ──────────────────────────────────────────────────
function isArtifact(text) {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const codeBlockCount = Math.floor((text.match(/```/g) || []).length / 2);
  const questionMarkCount = (text.match(/\?/g) || []).length;
  const headerCount = (text.match(/^#{2,6} /gm) || []).length;
  const noSourcesDump = !text.includes('Sources:');

  return (
    wordCount > 280 &&
    codeBlockCount < 2 &&
    questionMarkCount < 4 &&
    headerCount >= 1 &&
    noSourcesDump
  );
}

// ─── JSONL helpers ────────────────────────────────────────────────────────────
function readJsonlMessages(sessionId, cwd) {
  try {
    const projectDir = cwd.replace(/\//g, '-');
    const jsonlPath = path.join(os.homedir(), '.claude', 'projects', projectDir, `${sessionId}.jsonl`);
    if (!fs.existsSync(jsonlPath)) return [];
    return fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean);
  } catch (_) {
    return [];
  }
}

function extractText(content) {
  if (Array.isArray(content)) {
    return content.filter(c => c.type === 'text').map(c => c.text || '').join('');
  }
  if (typeof content === 'string') return content;
  return '';
}

function getLastAssistantText(sessionId, cwd) {
  const lines = readJsonlMessages(sessionId, cwd);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const msg = JSON.parse(lines[i]);
      if (msg.type !== 'assistant') continue;
      const text = extractText(msg?.message?.content);
      if (text.length > 0) return text;
    } catch (_) {}
  }
  return null;
}

function getLastUserPrompt(sessionId, cwd) {
  const lines = readJsonlMessages(sessionId, cwd);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const msg = JSON.parse(lines[i]);
      if (msg.type !== 'user') continue;
      const text = extractText(msg?.message?.content);
      if (text.length > 0) return text.slice(0, 120);
    } catch (_) {}
  }
  return '';
}

// ─── Cooldown ─────────────────────────────────────────────────────────────────
function isCoolingDown() {
  try {
    const elapsed = Date.now() - fs.statSync(COOLDOWN_FILE).mtimeMs;
    return elapsed < COOLDOWN_MS;
  } catch (_) {
    return false;
  }
}

function resetCooldown() {
  try { fs.writeFileSync(COOLDOWN_FILE, String(Date.now()), 'utf8'); } catch (_) {}
}

// ─── Task name ────────────────────────────────────────────────────────────────
function buildTaskName(userPrompt) {
  const ts = Date.now();
  const slug = (userPrompt || 'artifact')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join('-')
    .replace(/[^A-Za-z0-9_-]/g, '-') || 'artifact';
  const name = `auto-${ts}-${slug}`;
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : `auto-${ts}-artifact`;
}

// ─── Brief ────────────────────────────────────────────────────────────────────
function writeBrief(taskName, artifactText, userPrompt) {
  try {
    fs.mkdirSync(BRIEFS_DIR, { recursive: true });
    const briefPath = path.join(BRIEFS_DIR, `${taskName}.md`);
    fs.writeFileSync(briefPath, [
      '---',
      `task: ${taskName}`,
      'output_type: text',
      'profile: fast',
      '---',
      '',
      '# Context',
      `User prompt: ${userPrompt.slice(0, 120)}`,
      '',
      '# Original text (improve this)',
      '',
      artifactText.slice(0, 2500),
    ].join('\n'), 'utf8');
    return briefPath;
  } catch (_) {
    return null;
  }
}

// ─── RuFlo ────────────────────────────────────────────────────────────────────
function notifyRuFlo(type, text, context) {
  try {
    const payload = JSON.stringify({ type, text, context });
    const url = new URL(RUFLO_URL);
    const req = http.request({
      hostname: url.hostname,
      port: Number(url.port) || 80,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => { res.resume(); });
    req.on('error', () => {});
    req.write(payload);
    req.end();
  } catch (_) {}
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  let stdinData = '';
  try {
    for await (const chunk of process.stdin) stdinData += chunk;
  } catch (_) { process.exit(0); }

  let hookInput;
  try { hookInput = JSON.parse(stdinData); } catch (_) { process.exit(0); }

  const { session_id: sessionId, cwd } = hookInput;
  if (!sessionId || !cwd) process.exit(0);

  const assistantText = getLastAssistantText(sessionId, cwd);
  if (!assistantText) process.exit(0);

  if (!isArtifact(assistantText)) process.exit(0);
  if (isCoolingDown()) process.exit(0);

  const userPrompt = getLastUserPrompt(sessionId, cwd);
  const taskName = buildTaskName(userPrompt);
  const briefPath = writeBrief(taskName, assistantText, userPrompt);
  if (!briefPath) process.exit(0);

  const wordCount = assistantText.trim().split(/\s+/).filter(Boolean).length;
  const codeBlockCount = Math.floor((assistantText.match(/```/g) || []).length / 2);

  notifyRuFlo('thinking', `GAN Classifier: ${wordCount}w / ${codeBlockCount} blocks — loop starting...`, taskName);

  try {
    const ganProc = spawn('bash', ['-c', `cd '${GAN_LOOP_DIR}' && ./run.sh 'briefs/${taskName}.md'`], {
      detached: true, stdio: 'ignore',
    });
    ganProc.unref();
    resetCooldown();
  } catch (_) {}

  try {
    const watcherProc = spawn('node', [WATCHER_SCRIPT, taskName], { detached: true, stdio: 'ignore' });
    watcherProc.unref();
  } catch (_) {}

  process.exit(0);
}

process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));

main().catch(() => process.exit(0));
