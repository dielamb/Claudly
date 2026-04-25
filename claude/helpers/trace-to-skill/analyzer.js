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
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1];
  }
  return args;
}

function usage() {
  console.error('Usage: node analyzer.js --traces <dir> --output <dir> [--skill <skill-name>] [--update]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Read and classify trace files
// ---------------------------------------------------------------------------

function loadTraces(tracesDir) {
  if (!fs.existsSync(tracesDir)) {
    console.error(`Error: traces directory not found: ${tracesDir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(tracesDir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();

  if (files.length === 0) {
    console.error(`Error: no .jsonl files found in ${tracesDir}`);
    process.exit(1);
  }

  const runs = [];

  for (const file of files) {
    const filePath = path.join(tracesDir, file);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);

    let meta = null;
    const events = [];

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.__meta) {
          meta = obj;
        } else {
          events.push(obj);
        }
      } catch (_) {
        // skip malformed lines
      }
    }

    if (!meta) {
      // infer minimal meta from filename
      meta = { runIndex: parseInt(file, 10) || 0, feedback: 'n', variationType: 'normal' };
    }

    runs.push({ file, meta, events });
  }

  return runs;
}

// ---------------------------------------------------------------------------
// Serialize runs to a compact text block for analyst prompts
// ---------------------------------------------------------------------------

function serializeRuns(runs) {
  return runs
    .map((run) => {
      const header = `=== RUN ${run.meta.runIndex} [${run.meta.variationType}] feedback=${run.meta.feedback} ===`;
      const task = `TASK: ${run.meta.task || run.meta.baseTask || '(unknown)'}`;

      // Extract tool calls and assistant messages for compact representation
      const lines = [header, task];

      for (const event of run.events) {
        if (event.type === 'assistant' && event.message && event.message.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              lines.push(`ASSISTANT: ${block.text.slice(0, 400)}`);
            } else if (block.type === 'tool_use') {
              const inputStr = JSON.stringify(block.input || {}).slice(0, 200);
              lines.push(`TOOL_USE: ${block.name}(${inputStr})`);
            }
          }
        } else if (event.type === 'tool' && event.content) {
          const content = Array.isArray(event.content)
            ? event.content.map((c) => (c.text || '').slice(0, 200)).join(' ')
            : String(event.content).slice(0, 200);
          lines.push(`TOOL_RESULT: ${content}`);
        } else if (event.type === 'error') {
          lines.push(`ERROR: ${JSON.stringify(event).slice(0, 300)}`);
        }
      }

      return lines.join('\n');
    })
    .join('\n\n');
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

  if (!args.traces || !args.output) {
    usage();
  }

  await checkClaudeCLI();

  const tracesDir = path.resolve(args.traces);
  const outputDir = path.resolve(args.output);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`Loading traces from: ${tracesDir}`);
  const runs = loadTraces(tracesDir);
  console.log(`Loaded ${runs.length} trace file(s)`);

  // Classify runs
  const goodRuns = runs.filter((r) => r.meta.feedback === 'y');
  const badRuns = runs.filter((r) => r.meta.feedback === 'n');
  const hardAdversarialRuns = runs.filter((r) =>
    ['hard', 'adversarial'].includes(r.meta.variationType)
  );

  console.log(
    `  Good: ${goodRuns.length}  Bad: ${badRuns.length}  Hard/Adversarial: ${hardAdversarialRuns.length}`
  );

  // Serialize run groups
  const allTracesText = serializeRuns(runs);
  const goodTracesText = goodRuns.length > 0 ? serializeRuns(goodRuns) : '(no good runs)';
  const badTracesText = badRuns.length > 0 ? serializeRuns(badRuns) : '(no bad runs)';
  const hardTracesText =
    hardAdversarialRuns.length > 0 ? serializeRuns(hardAdversarialRuns) : '(no hard/adversarial runs)';

  // Load and fill prompt templates
  const analystConfigs = [
    {
      type: 'error',
      traces: badTracesText,
    },
    {
      type: 'success',
      traces: goodTracesText,
    },
    {
      type: 'structure',
      traces: allTracesText,
    },
    {
      type: 'edge',
      traces: hardTracesText,
    },
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
    console.log(`  ${result.analystType}-analyst → ${outFile} (${ruleCount} rules)`);
  }

  // Auto-call consolidator
  const consolidatorPath = path.join(__dirname, 'consolidator.js');
  if (!fs.existsSync(consolidatorPath)) {
    console.error('\nWarning: consolidator.js not found. Run it manually:');
    console.error(`  node consolidator.js --analysts ${outputDir} --skill ${args.skill || '<skill-name>'}`);
    return;
  }

  console.log('\nRunning consolidator...');
  const consolidatorArgs = ['--analysts', outputDir];
  if (args.skill) consolidatorArgs.push('--skill', args.skill);
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
