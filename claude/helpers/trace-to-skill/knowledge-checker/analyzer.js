#!/usr/bin/env node
// analyzer.js — orchestrates 4 parallel analyst agents, then calls consolidator

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      args[key] = argv[i + 1];
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function usage() {
  console.error('Usage: node analyzer.js --logs <dir> --output <dir> [--skill <skill-name>] [--update]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load run log files
// ---------------------------------------------------------------------------

function loadRunLogs(logsDir) {
  if (!fs.existsSync(logsDir)) {
    console.error(`Error: logs directory not found: ${logsDir}`);
    process.exit(1);
  }
  const files = fs.readdirSync(logsDir)
    .filter(f => f.startsWith('run-') && f.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    console.error(`Error: no run-*.json files found in ${logsDir}`);
    process.exit(1);
  }
  return files.map(f => JSON.parse(fs.readFileSync(path.join(logsDir, f), 'utf8')));
}

// ---------------------------------------------------------------------------
// Serialize check results to a compact text block for analyst prompts
// ---------------------------------------------------------------------------

function serializeCheckResults(runs) {
  if (runs.length === 0) return '(no runs in this category)';
  return runs.map(r => [
    `=== RUN ${r.runIndex} [${r.actual_result}] ===`,
    `PROMPT: ${r.prompt}`,
    `RESULT: ${r.actual_result}`,
    `KEYWORDS_MATCHED: ${Array.isArray(r.keywords_matched) ? r.keywords_matched.join(', ') : r.keywords_matched}`,
    `OUTPUT_LENGTH: ${r.output_length}`,
    `CONTEXT:\n${r.context_full || r.context_excerpt || r.raw_output || '(empty)'}`,
  ].join('\n')).join('\n\n');
}

// ---------------------------------------------------------------------------
// Load prompt template
// ---------------------------------------------------------------------------

function loadPromptTemplate(analystType) {
  const templatePath = path.join(__dirname, 'prompts', `${analystType}-analyst.md`);
  if (!fs.existsSync(templatePath)) {
    console.error(`Error: prompt template not found: ${templatePath}`);
    process.exit(1);
  }
  return fs.readFileSync(templatePath, 'utf8');
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
// Run a single analyst agent via claude CLI
// ---------------------------------------------------------------------------

function runAnalyst(analystType, promptContent) {
  return new Promise((resolve, reject) => {
    console.log(`  Starting ${analystType}-analyst...`);

    const proc = spawn(
      'claude',
      ['-p', promptContent, '--model', 'claude-haiku-4-5-20251001', '--output-format', 'text'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    const stdoutChunks = [];
    const stderrChunks = [];

    proc.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        console.error('Error: claude CLI not found. Install from: https://claude.ai/cli');
        process.exit(1);
      }
      reject(err);
    });

    proc.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (code !== 0) {
        console.error(`  ${analystType}-analyst exited with code ${code}`);
        if (stderr) console.error(`  stderr: ${stderr.slice(0, 500)}`);
      }

      resolve({ analystType, output: stdout, exitCode: code });
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.logs || !args.output) {
    usage();
  }

  await checkClaudeCLI();

  const logsDir = path.resolve(args.logs);
  const outputDir = path.resolve(args.output);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`Loading run logs from: ${logsDir}`);
  const runs = loadRunLogs(logsDir);
  console.log(`Loaded ${runs.length} run log file(s)`);

  // Classify runs — feedback.correct overrides auto-classification when present
  const hasFeedback = runs.some(r => r.feedback !== undefined);
  if (hasFeedback) {
    console.log(`  Human feedback present — using feedback.correct for error/success routing`);
  }

  const isWrong = r => r.feedback !== undefined ? r.feedback.correct === false : r.actual_result === 'FAIL';
  const isRight = r => r.feedback !== undefined ? r.feedback.correct === true  : r.actual_result === 'PASS';

  const errorData   = serializeCheckResults(runs.filter(isWrong));
  const successData = serializeCheckResults(runs.filter(isRight));
  const structData  = serializeCheckResults(runs);
  const edgeData    = serializeCheckResults(runs.filter(r => r.actual_result === 'SKIP'));

  const failCount = runs.filter(isWrong).length;
  const passCount = runs.filter(isRight).length;
  const skipCount = runs.filter(r => r.actual_result === 'SKIP').length;
  const reviewedCount = runs.filter(r => r.feedback !== undefined).length;
  console.log(`  PASS: ${passCount}  FAIL: ${failCount}  SKIP: ${skipCount}  Reviewed: ${reviewedCount}/${runs.length}`);

  // Load and fill prompt templates
  const analystConfigs = [
    { type: 'error',     traces: errorData   },
    { type: 'success',   traces: successData },
    { type: 'structure', traces: structData  },
    { type: 'edge',      traces: edgeData    },
  ];

  const preparedAnalysts = analystConfigs.map(({ type, traces }) => {
    const template = loadPromptTemplate(type);
    const prompt = template.replace('{TRACES}', traces);
    return { type, prompt };
  });

  console.log(`\nSpawning 4 analyst agents in parallel...`);
  const startTime = Date.now();

  // Run all 4 analysts in parallel
  const results = await Promise.all(
    preparedAnalysts.map(({ type, prompt }) => runAnalyst(type, prompt))
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nAll analysts completed in ${elapsed}s`);

  // Save each analyst output
  for (const result of results) {
    const outFile = path.join(outputDir, `analyst-${result.analystType}.txt`);
    const header = `# ${result.analystType.toUpperCase()} ANALYST OUTPUT\n# Generated: ${new Date().toISOString()}\n# Exit code: ${result.exitCode}\n\n`;
    fs.writeFileSync(outFile, header + result.output, 'utf8');
    const ruleCount = (result.output.match(/^RULE:/gm) || []).length;
    console.log(`  ${result.analystType}-analyst -> ${outFile} (${ruleCount} rules)`);
  }

  // Auto-call consolidator
  const consolidatorPath = '__HOME__/.claude/helpers/trace-to-skill/consolidator.js';
  if (!fs.existsSync(consolidatorPath)) {
    console.error('\nWarning: consolidator.js not found. Run it manually:');
    console.error(`  node ${consolidatorPath} --analysts ${outputDir} --skill knowledge-checker --threshold 1`);
    return;
  }

  console.log('\nRunning consolidator...');
  const consolidatorArgs = ['--analysts', outputDir, '--skill', args.skill || 'knowledge-checker', '--threshold', '1'];
  if (args.update !== undefined) consolidatorArgs.push('--update');

  const consolidator = spawn('node', [consolidatorPath, ...consolidatorArgs], {
    stdio: 'inherit',
  });

  consolidator.on('error', (err) => {
    console.error('Error running consolidator:', err.message);
  });

  consolidator.on('close', (code) => {
    if (code !== 0) {
      console.error(`Consolidator exited with code ${code}`);
      process.exit(code);
    }
  });
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
