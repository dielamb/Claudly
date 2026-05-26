#!/usr/bin/env node
// feedback.js — interactive feedback collector for knowledge-checker runs
// Usage: node feedback.js [--logs results/latest]
// Flow: shows each run result + context excerpt → asks y/n → saves feedback to run-N.json

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

function parseArgs(argv) {
  const args = { logs: path.join(__dirname, 'results', 'latest') };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--logs' && argv[i + 1]) { args.logs = argv[i + 1]; i++; }
  }
  return args;
}

const args = parseArgs(process.argv);
const logsDir = path.resolve(args.logs);

if (!fs.existsSync(logsDir)) {
  console.error(`Error: logs directory not found: ${logsDir}`);
  console.error('Run runner.sh first.');
  process.exit(1);
}

const files = fs.readdirSync(logsDir)
  .filter(f => f.startsWith('run-') && f.endsWith('.json'))
  .sort((a, b) => {
    const na = parseInt(a.match(/run-(\d+)\.json/)?.[1] || 0);
    const nb = parseInt(b.match(/run-(\d+)\.json/)?.[1] || 0);
    return na - nb;
  });

if (files.length === 0) {
  console.error('Error: no run-*.json files found.');
  process.exit(1);
}

const runs = files.map(f => ({
  file: path.join(logsDir, f),
  data: JSON.parse(fs.readFileSync(path.join(logsDir, f), 'utf8'))
}));

// Check if already has feedback
const withFeedback = runs.filter(r => r.data.feedback !== undefined).length;
if (withFeedback > 0) {
  console.log(`Note: ${withFeedback}/${runs.length} runs already have feedback (will be overwritten if you answer again).`);
  console.log('Press Ctrl+C to abort, Enter to continue...');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

// ANSI colors
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[36m', DIM = '\x1b[2m', NC = '\x1b[0m';

function resultColor(r) {
  if (r === 'PASS') return G;
  if (r === 'FAIL') return R;
  if (r === 'SKIP') return Y;
  return NC;
}

function contextExcerpt(raw) {
  if (!raw || raw.length === 0) return '(empty — no context injected)';
  try {
    const parsed = JSON.parse(raw);
    const ctx = parsed?.hookSpecificOutput?.additionalContext || '';
    if (!ctx) return '(empty — hook returned no additionalContext)';
    // Strip XML-like tags, show plain text
    const plain = ctx.replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').trim();
    return plain.slice(0, 500);
  } catch {
    return raw.slice(0, 400).replace(/\n/g, ' ');
  }
}

async function main() {
  console.log(`\n${B}=== Knowledge-Checker Feedback Session ===${NC}`);
  console.log(`${DIM}Logs: ${logsDir}${NC}`);
  console.log(`${DIM}Runs: ${runs.length} | Commands: y=correct  n=wrong  s=skip  q=quit${NC}\n`);

  const summary = { correct: 0, wrong: 0, skipped: 0 };

  for (let i = 0; i < runs.length; i++) {
    const { file, data } = runs[i];
    const rc = resultColor(data.actual_result);
    const ep = data.expected_pass;
    const expected = (ep === true || ep === 'true') ? 'expected PASS'
                   : (ep === false || ep === 'false') ? 'expected FAIL'
                   : 'expected SKIP';

    // Load difficulty + expected_description from test-prompts.json if available
    const promptsMeta = (() => {
      try {
        const all = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'test-prompts.json'), 'utf8'));
        return all.find(p => p.prompt === data.prompt) || {};
      } catch { return {}; }
    })();
    const difficulty = promptsMeta.difficulty || '?';
    const expectedDesc = promptsMeta.expected_description || '';

    const diffColor = difficulty === 'easy' ? G : difficulty === 'normal' ? B : difficulty === 'hard' ? Y : R;

    console.log(`${DIM}─────────────────────────────────────────${NC}`);
    console.log(`${B}[${i + 1}/${runs.length}]${NC} ${rc}${data.actual_result}${NC}  ${DIM}(${expected})${NC}  ${diffColor}[${difficulty}]${NC}`);
    console.log(`  Prompt: ${data.prompt}`);
    console.log(`  ${DIM}Expected: ${expectedDesc}${NC}`);
    if (data.keywords_matched && data.keywords_matched.length > 0) {
      console.log(`  Keywords matched: ${G}${data.keywords_matched.join(', ')}${NC}`);
    }
    const ctxText = data.context_excerpt
      ? data.context_excerpt.replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').trim().slice(0, 500)
      : contextExcerpt(data.raw_output);
    console.log(`  Context (${data.output_length} chars): ${DIM}${ctxText || '(empty)'}${NC}`);

    let answer = '';
    while (!['y', 'n', 's', 'q'].includes(answer)) {
      answer = (await ask(`  Was retrieval correct? (y/n/s=skip/q=quit): `)).trim().toLowerCase();
    }

    if (answer === 'q') {
      console.log('\nQuitting. Feedback saved for completed runs.');
      break;
    }

    if (answer === 's') {
      summary.skipped++;
      continue;
    }

    let note = '';
    if (answer === 'n') {
      note = (await ask(`  What went wrong? (Enter to skip): `)).trim();
    } else {
      summary.correct++;
    }
    if (answer === 'n') summary.wrong++;

    // Write feedback back to run-N.json
    data.feedback = {
      correct: answer === 'y',
      note: note || null,
      reviewed_at: new Date().toISOString()
    };
    fs.writeFileSync(file, JSON.stringify(data, null, 2));

    const mark = answer === 'y' ? `${G}✓${NC}` : `${R}✗${NC}`;
    console.log(`  ${mark} saved`);
    console.log();
  }

  rl.close();

  const total = summary.correct + summary.wrong;
  console.log(`\n${B}=== Feedback complete ===${NC}`);
  console.log(`  ${G}Correct: ${summary.correct}${NC}  ${R}Wrong: ${summary.wrong}${NC}  ${DIM}Skipped: ${summary.skipped}${NC}`);
  if (total > 0) {
    const accuracy = Math.round((summary.correct / total) * 100);
    console.log(`  Accuracy: ${accuracy}% (${summary.correct}/${total} reviewed)`);
  }
  console.log(`\nNext step:`);
  console.log(`  node analyzer.js --logs ${logsDir} --output ${logsDir}/analysis\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
