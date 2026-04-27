#!/usr/bin/env node
// sona-trigger.mjs
// Hook: post-task SONA learning trigger
// Reads last task outcome, calls SONA processTrajectory + EWC recordPatternOutcome

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME || '';
const PENDING = join(HOME, '.claude-flow', 'data', 'pending-insights.jsonl');

async function main() {
  // Load SONA + EWC from compiled v3 dist
  let sona = null;
  let ewc = null;
  try {
    const sonaPath = join(__dirname, '..', 'v3', '@claude-flow', 'cli', 'dist', 'src', 'memory', 'sona-optimizer.js');
    if (existsSync(sonaPath)) {
      const m = await import(`file://${sonaPath}`);
      sona = m;
    }
  } catch { /* skip */ }

  try {
    const ewcPath = join(__dirname, '..', 'v3', '@claude-flow', 'cli', 'dist', 'src', 'memory', 'ewc-consolidation.js');
    if (existsSync(ewcPath)) {
      const m = await import(`file://${ewcPath}`);
      ewc = m;
    }
  } catch { /* skip */ }

  if (!sona && !ewc) {
    process.stderr.write('[sona-trigger] SONA/EWC not loaded\n');
    return;
  }

  // Read last 5 pending insights as task outcomes
  if (!existsSync(PENDING)) return;
  const lines = readFileSync(PENDING, 'utf-8').split('\n').filter(Boolean).slice(-5);

  let processed = 0;
  for (const line of lines) {
    try {
      const insight = JSON.parse(line);
      if (sona?.processTrajectory) {
        await sona.processTrajectory({
          task: insight.task || insight.summary || 'unknown',
          outcome: insight.outcome || insight.success === true ? 'success' : 'partial',
          confidence: insight.confidence || 0.5,
          metadata: { source: 'sona-trigger', timestamp: insight.timestamp },
        });
        processed++;
      }
    } catch { /* skip malformed */ }
  }

  if (processed > 0) {
    process.stderr.write(`[sona-trigger] processed ${processed} trajectories\n`);
  }
}

main().catch(e => { process.stderr.write(`[sona-trigger] ERROR: ${e.message}\n`); });
