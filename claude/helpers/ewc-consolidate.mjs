#!/usr/bin/env node
// ewc-consolidate.mjs
// Hook: SessionEnd EWC consolidation
// Calls EWCConsolidator.consolidatePatterns() to prevent catastrophic forgetting

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  try {
    const ewcPath = join(__dirname, '..', 'v3', '@claude-flow', 'cli', 'dist', 'src', 'memory', 'ewc-consolidation.js');
    if (!existsSync(ewcPath)) {
      process.stderr.write('[ewc] not available\n');
      return;
    }
    const m = await import(`file://${ewcPath}`);

    // Get current patterns from intelligence layer
    let patterns = [];
    try {
      const intPath = join(__dirname, '..', 'v3', '@claude-flow', 'cli', 'dist', 'src', 'memory', 'intelligence.js');
      if (existsSync(intPath)) {
        const intel = await import(`file://${intPath}`);
        const stats = intel.getIntelligenceStats?.();
        if (stats?.patterns) patterns = stats.patterns;
      }
    } catch { /* skip */ }

    if (patterns.length === 0) {
      process.stderr.write('[ewc] no patterns to consolidate\n');
      return;
    }

    const result = await m.consolidatePatterns(patterns);
    const stats = await m.getEWCStats();
    process.stderr.write(`[ewc] consolidated ${result?.consolidated || 0} patterns | total: ${stats.totalPatterns} | high-importance: ${stats.highImportancePatterns}\n`);
  } catch (e) {
    process.stderr.write(`[ewc] ERROR: ${e.message?.slice(0, 100)}\n`);
  }
}

main();
