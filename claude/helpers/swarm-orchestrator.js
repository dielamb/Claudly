#!/usr/bin/env node
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Usage: node swarm-orchestrator.js --state <state-file.json> [--dry-run]

function readState(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeState(file, state) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file); // atomic
}

function updateTask(file, taskId, updates) {
  const state = readState(file);
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  Object.assign(task, updates);
  state.log.push({ ts: new Date().toISOString(), msg: `${taskId}: ${JSON.stringify(updates)}` });
  writeState(file, state);
}

function routeTask(task) {
  const map = { feature: 'builder', fix: 'builder', refactor: 'builder', design: 'designer' };
  return map[task.type] || 'builder';
}

function createWorktree(projectPath, branch, dryRun) {
  const script = path.join(os.homedir(), '.claude/helpers/worktree-create.sh');
  if (dryRun) {
    console.log(`[DRY] worktree-create.sh ${projectPath} ${branch}`);
    return `/tmp/dry-run-worktree`;
  }
  const result = spawnSync('bash', [script, projectPath, branch], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Worktree creation failed: ${result.stderr}`);
  return result.stdout.trim();
}

function buildAgentPrompt(agentType, task, worktreePath, project) {
  const templatePath = path.join(os.homedir(), `.claude/helpers/swarm-agents/${agentType}-prompt.md`);
  const template = fs.existsSync(templatePath) ? fs.readFileSync(templatePath, 'utf8') : '';
  return `You are a ${agentType} agent working in an isolated git worktree.
Working directory: ${worktreePath}
Branch: swarm/${task.id}
Project type: ${project.type}

Task: ${task.title}
Description: ${task.description}

RULES:
- Make ALL changes in ${worktreePath} only
- Do NOT modify files outside this directory
- Commit all changes: git commit -m "swarm(${task.id}): ${task.title}"
- Verify no import errors after changes

${template}`;
}

function runAgent(agentType, task, worktreePath, project, dryRun) {
  const prompt = buildAgentPrompt(agentType, task, worktreePath, project);
  if (dryRun) {
    console.log(`[DRY] spawn claude -p "${prompt.slice(0, 80)}..." cwd=${worktreePath}`);
    return { success: true };
  }

  const result = spawnSync('claude', ['-p', prompt, '--output-format', 'json'], {
    cwd: worktreePath,
    encoding: 'utf8',
    timeout: 600000, // 10 min
  });
  return { success: result.status === 0, output: result.stdout, error: result.stderr };
}

function runGate(gateName, worktreePath, dryRun) {
  const script = path.join(os.homedir(), `.claude/helpers/swarm-gates/gate-${gateName}.sh`);
  if (!fs.existsSync(script)) {
    return { passed: true, output: `gate-${gateName}.sh not found, skipped` };
  }
  if (dryRun) {
    console.log(`[DRY] gate-${gateName}.sh ${worktreePath}`);
    return { passed: true, output: 'dry-run' };
  }
  const result = spawnSync('bash', [script, worktreePath], { encoding: 'utf8', timeout: 120000 });
  return { passed: result.status === 0, output: result.stdout + result.stderr };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function orchestrate(stateFile, dryRun) {
  console.log(`Swarm orchestrator starting. State: ${stateFile} DryRun: ${dryRun}`);

  for (let iteration = 0; iteration < 100; iteration++) {
    const state = readState(stateFile);
    const pending = state.tasks.filter(t => t.status === 'pending');
    const active = state.tasks.filter(t => ['in_progress', 'gate_check'].includes(t.status));

    if (pending.length === 0 && active.length === 0) {
      console.log('All tasks complete.');
      break;
    }

    const task = pending[0];
    if (!task) {
      console.log('Waiting for active tasks...');
      await sleep(5000);
      continue;
    }

    if (task.attempts >= task.maxAttempts) {
      updateTask(stateFile, task.id, { status: 'failed', notes: 'Max attempts reached' });
      continue;
    }

    // Mark in_progress
    const branch = `swarm/${task.id}`;
    updateTask(stateFile, task.id, { status: 'in_progress', branch, attempts: task.attempts + 1 });

    // Create worktree
    let worktreePath;
    try {
      worktreePath = createWorktree(state.project.path, branch, dryRun);
    } catch (e) {
      updateTask(stateFile, task.id, { status: 'failed', notes: e.message });
      continue;
    }

    updateTask(stateFile, task.id, { worktree: worktreePath });

    // Run agent
    const agentType = routeTask(task);
    console.log(`Running ${agentType} agent for: ${task.title}`);
    const agentResult = runAgent(agentType, task, worktreePath, state.project, dryRun);

    if (!agentResult.success) {
      updateTask(stateFile, task.id, {
        status: 'pending',
        notes: `Agent failed: ${(agentResult.error || '').slice(0, 200)}`,
      });
      continue;
    }

    // Run gates
    updateTask(stateFile, task.id, { status: 'gate_check' });
    const currentState = readState(stateFile);
    const gates = currentState.project.gates || ['secrets'];
    const gateResults = {};

    for (const gate of gates) {
      console.log(`Gate: ${gate}`);
      gateResults[gate] = runGate(gate, worktreePath, dryRun);
    }

    const allPassed = Object.values(gateResults).every(r => r.passed);
    const failedGates = Object.entries(gateResults)
      .filter(([, v]) => !v.passed)
      .map(([k]) => k)
      .join(', ');

    updateTask(stateFile, task.id, {
      status: allPassed ? 'completed' : 'pending',
      gateResults,
      notes: allPassed ? 'All gates passed' : `Failed gates: ${failedGates}`,
    });

    console.log(`Task ${task.id}: ${allPassed ? 'COMPLETED' : 'FAILED — will retry'}`);
  }

  // Print final summary
  const finalState = readState(stateFile);
  const completed = finalState.tasks.filter(t => t.status === 'completed').length;
  const failed = finalState.tasks.filter(t => t.status === 'failed').length;
  const total = finalState.tasks.length;
  console.log(`\nSummary: ${completed}/${total} completed, ${failed} failed`);
}

// Parse args and run
const args = process.argv.slice(2);
const stateIdx = args.indexOf('--state');
const stateFile = stateIdx >= 0 ? args[stateIdx + 1] : null;
const dryRun = args.includes('--dry-run');

if (!stateFile) {
  console.error('Usage: swarm-orchestrator.js --state <file.json> [--dry-run]');
  process.exit(1);
}
if (!fs.existsSync(stateFile)) {
  console.error(`State file not found: ${stateFile}`);
  process.exit(1);
}

orchestrate(stateFile, dryRun).catch(e => {
  console.error(e);
  process.exit(1);
});
