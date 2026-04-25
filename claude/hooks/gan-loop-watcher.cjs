#!/usr/bin/env node
// gan-loop-watcher.cjs
// Background watcher spawned by gan-loop-classifier.cjs.
// Polls runs/ directory until run-summary.md appears, then POSTs result to RuFlo.
// Args: [taskName]

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const POLL_INTERVAL_MS = 6000;
const TIMEOUT_MS = 12 * 60 * 1000;
const GAN_LOOP_DIR = path.join(os.homedir(), 'tools', 'gan-loop');
const RUNS_DIR = path.join(GAN_LOOP_DIR, 'runs');
const RUFLO_URL = 'http://localhost:8741/message';

const taskName = process.argv[2] || '';
if (!taskName) process.exit(0);

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

function findRunDir() {
  try {
    const match = fs.readdirSync(RUNS_DIR).find(e => e.includes(taskName));
    return match ? path.join(RUNS_DIR, match) : null;
  } catch (_) { return null; }
}

function parseSummary(summaryPath) {
  try {
    const text = fs.readFileSync(summaryPath, 'utf8');
    const score = text.match(/Final score:\s*([\d.]+)/i)?.[1] ?? '?';
    const verdict = (text.match(/Verdict:\s*(\w+)/i)?.[1] ?? 'UNKNOWN').toUpperCase();
    const iterations = text.match(/Iterations?:\s*([\d\s\/]+)/i)?.[1]?.trim() ?? '?';
    return { score, verdict, iterations };
  } catch (_) {
    return { score: '?', verdict: 'UNKNOWN', iterations: '?' };
  }
}

const startTime = Date.now();

const intervalId = setInterval(() => {
  if (Date.now() - startTime > TIMEOUT_MS) {
    notifyRuFlo('idle', `GAN Loop timeout after 12 min [${taskName}]`, taskName);
    clearInterval(intervalId);
    process.exit(0);
    return;
  }

  const runDir = findRunDir();
  if (!runDir) return;

  const summaryPath = path.join(runDir, 'run-summary.md');
  if (!fs.existsSync(summaryPath)) return;

  const { score, verdict, iterations } = parseSummary(summaryPath);
  const icon = verdict === 'PASS' ? '✓' : '✗';

  notifyRuFlo('idle', `GAN Loop ${icon} ${verdict} — ${score}/10 ${iterations} iter [${taskName.slice(0, 40)}]`, taskName);

  clearInterval(intervalId);
  process.exit(0);
}, POLL_INTERVAL_MS);
