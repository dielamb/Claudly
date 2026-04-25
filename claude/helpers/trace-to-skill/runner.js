#!/usr/bin/env node
// runner.js — executes a skill task N times, captures JSONL traces + binary feedback

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1];
  }
  return args;
}

function usage() {
  console.error(
    'Usage: node runner.js --skill <skill-name> --task <task-description> --n <count> --output <dir>'
  );
  console.error(
    'Example: node runner.js --skill impeccable --task "redesign CS01 section" --n 10 --output ./traces/impeccable'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Variation generator
// ---------------------------------------------------------------------------

const VARIATION_TYPES = ['easy', 'normal', 'hard', 'adversarial'];

function generateVariations(baseTask, n) {
  const variations = [];
  const modifiers = {
    easy: [
      'Keep it minimal — single file only.',
      'Simple change, one component, no dependencies.',
      'Focus on one small, clearly scoped element.',
    ],
    normal: [
      '',
      'Standard complexity, follow existing patterns.',
      'Apply to the relevant section as-is.',
    ],
    hard: [
      'Apply across multiple files, handle edge cases.',
      'Implement with cross-component consistency and responsive variants.',
      'Multi-step transformation with backwards-compatible changes.',
    ],
    adversarial: [
      'The layout is already broken. Fix it without introducing regressions.',
      'The design spec conflicts with the existing CSS. Resolve the conflict explicitly.',
      'Partial information only — infer the rest from context and document assumptions.',
    ],
  };

  for (let i = 0; i < n; i++) {
    const type = VARIATION_TYPES[i % VARIATION_TYPES.length];
    const pool = modifiers[type];
    const suffix = pool[Math.floor(Math.random() * pool.length)];
    const task = suffix ? `${baseTask} ${suffix}` : baseTask;
    variations.push({ index: i + 1, type, task });
  }
  return variations;
}

// ---------------------------------------------------------------------------
// Skill file reader
// ---------------------------------------------------------------------------

function readSkillFile(skillName) {
  const skillsDir = path.join(process.env.HOME, '.claude', 'skills');
  const candidates = [
    path.join(skillsDir, skillName, 'skill.md'),
    path.join(skillsDir, skillName, `${skillName}.md`),
    path.join(skillsDir, `${skillName}.md`),
    path.join(skillsDir, `${skillName}.yaml`),
    path.join(skillsDir, skillName, 'skill.yaml'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { filePath: candidate, content: fs.readFileSync(candidate, 'utf8') };
    }
  }

  console.error(`Error: skill file not found for "${skillName}"`);
  console.error(`Searched in: ${skillsDir}`);
  console.error(`Candidates tried:\n  ${candidates.join('\n  ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Claude CLI check
// ---------------------------------------------------------------------------

function checkClaudeCLI() {
  return new Promise((resolve) => {
    const proc = spawn('which', ['claude']);
    proc.on('close', (code) => {
      if (code !== 0) {
        console.error('Error: claude CLI not found in PATH.');
        console.error('Install it from: https://claude.ai/cli');
        process.exit(1);
      }
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Run a single variation
// ---------------------------------------------------------------------------

function runVariation(prompt, outputFile) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const proc = spawn('claude', ['-p', prompt, '--output-format', 'stream-json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.stderr.on('data', (chunk) => {
      // surface stderr so the user sees model errors
      process.stderr.write(chunk);
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        console.error('Error: claude CLI not found. Install from: https://claude.ai/cli');
        process.exit(1);
      }
      reject(err);
    });

    proc.on('close', (code) => {
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve({ raw, exitCode: code });
    });
  });
}

// ---------------------------------------------------------------------------
// Binary feedback prompt
// ---------------------------------------------------------------------------

function askFeedback(rl, runIndex, total) {
  return new Promise((resolve) => {
    rl.question(`  Was this output good? (y/n): `, (answer) => {
      const feedback = answer.trim().toLowerCase() === 'y' ? 'y' : 'n';
      resolve(feedback);
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.skill || !args.task || !args.n || !args.output) {
    usage();
  }

  const n = parseInt(args.n, 10);
  if (isNaN(n) || n < 1) {
    console.error('Error: --n must be a positive integer');
    process.exit(1);
  }

  await checkClaudeCLI();

  const { filePath: skillPath, content: skillContent } = readSkillFile(args.skill);
  console.log(`Skill loaded: ${skillPath}`);

  const outputDir = path.resolve(args.output);
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`Output directory: ${outputDir}`);

  const variations = generateVariations(args.task, n);
  console.log(`\nRunning ${n} variations for skill: ${args.skill}`);
  console.log('─'.repeat(60));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const summary = [];

  for (const variation of variations) {
    const { index, type, task } = variation;
    console.log(`\nRun ${index}/${n} [${type}]`);
    console.log(`  Task: ${task}`);

    const prompt = `/skill:${args.skill} ${task}`;
    const startTime = Date.now();

    let raw = '';
    let exitCode = 0;

    try {
      ({ raw, exitCode } = await runVariation(prompt, null));
    } catch (err) {
      console.error(`  Run failed: ${err.message}`);
      raw = JSON.stringify({ error: err.message });
      exitCode = 1;
    }

    const durationMs = Date.now() - startTime;

    // Display a brief preview (first 300 chars of last assistant message)
    let preview = '(no output)';
    try {
      const lines = raw.split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        const obj = JSON.parse(lines[i]);
        if (obj.type === 'assistant' && obj.message && obj.message.content) {
          const textBlock = obj.message.content.find((b) => b.type === 'text');
          if (textBlock) {
            preview = textBlock.text.slice(0, 300).replace(/\n/g, ' ');
            break;
          }
        }
      }
    } catch (_) {
      preview = raw.slice(0, 300).replace(/\n/g, ' ');
    }

    console.log(`  Preview: ${preview}`);
    console.log(`  Duration: ${(durationMs / 1000).toFixed(1)}s`);

    const feedback = await askFeedback(rl, index, n);

    const traceFile = path.join(outputDir, `${String(index).padStart(3, '0')}.jsonl`);
    const metadata = {
      runIndex: index,
      skill: args.skill,
      baseTask: args.task,
      task,
      variationType: type,
      feedback,
      exitCode,
      durationMs,
      timestamp: new Date().toISOString(),
      prompt,
    };

    // Write metadata as first line, then raw JSONL lines
    const metaLine = JSON.stringify({ __meta: true, ...metadata });
    const traceLines = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          JSON.parse(line);
          return line;
        } catch (_) {
          return JSON.stringify({ __raw: line });
        }
      });

    fs.writeFileSync(traceFile, [metaLine, ...traceLines].join('\n') + '\n', 'utf8');
    console.log(`  Feedback: ${feedback} — saved to ${path.basename(traceFile)}`);

    summary.push({ index, type, feedback, durationMs });
  }

  rl.close();

  console.log('\n' + '─'.repeat(60));
  console.log('Summary:');
  const good = summary.filter((s) => s.feedback === 'y').length;
  const bad = summary.filter((s) => s.feedback === 'n').length;
  console.log(`  Good runs (y): ${good}/${n}`);
  console.log(`  Bad runs  (n): ${bad}/${n}`);
  console.log(`\nTraces saved to: ${outputDir}`);
  console.log(`\nNext step: node analyzer.js --traces ${outputDir} --output ${outputDir}/analysis`);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
