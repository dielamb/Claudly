#!/usr/bin/env node
// gsd-read-tracker.js — PostToolUse hook on Read
// Records which files were read in this session so gsd-read-guard.js
// can suppress the advisory for already-read files.

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(process.env.HOME || '', '.claude', 'read-guard-state');

let input = '';
const timeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const data = JSON.parse(input);
    if (data.tool_name !== 'Read') return process.exit(0);

    const filePath = data.tool_input?.file_path;
    if (!filePath) return process.exit(0);

    const sessionId = data.session_id || 'default';
    const stateFile = path.join(STATE_DIR, `${sessionId}.json`);

    fs.mkdirSync(STATE_DIR, { recursive: true });

    let files = [];
    try { files = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}

    if (!files.includes(filePath)) {
      files.push(filePath);
      fs.writeFileSync(stateFile, JSON.stringify(files));
    }
  } catch {}
  process.exit(0);
});
