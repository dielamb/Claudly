#!/usr/bin/env node
// gsd-hook-version: 1.35.0
// GSD Read Guard — PreToolUse hook
// Injects advisory guidance when Write/Edit targets an existing file
// that has NOT been read in the current session.
//
// State tracking: gsd-read-tracker.js (PostToolUse Read) writes session
// read list to ~/.claude/read-guard-state/<session_id>.json.
// This hook skips the advisory if the file is already in that list.

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(process.env.HOME || '', '.claude', 'read-guard-state');

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name;

    if (toolName !== 'Write' && toolName !== 'Edit') {
      process.exit(0);
    }

    const filePath = data.tool_input?.file_path || '';
    if (!filePath) process.exit(0);

    // Only fire for existing files
    try {
      fs.accessSync(filePath, fs.constants.F_OK);
    } catch {
      process.exit(0);
    }

    // Check if file was already read this session
    const sessionId = data.session_id || 'default';
    const stateFile = path.join(STATE_DIR, `${sessionId}.json`);
    try {
      const files = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (Array.isArray(files) && files.includes(filePath)) {
        process.exit(0); // Already read — no advisory needed
      }
    } catch {}

    const fileName = path.basename(filePath);

    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext:
          `READ-BEFORE-EDIT REMINDER: You are about to modify "${fileName}" which already exists. ` +
          'If you have not already used the Read tool to read this file in the current session, ' +
          'you MUST Read it first before editing. The runtime will reject edits to files that ' +
          'have not been read. Use the Read tool on this file path, then retry your edit.',
      },
    };

    process.stdout.write(JSON.stringify(output));
  } catch {
    process.exit(0);
  }
});
