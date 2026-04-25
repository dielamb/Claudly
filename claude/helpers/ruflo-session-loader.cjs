#!/usr/bin/env node
/**
 * RuFlo Session Loader
 * Reads Obsidian vault on session start and loads relevant patterns into RuFlo pattern store.
 * Called by session-start hook.
 *
 * Sources:
 *   - 2 Efforts/ → active project context
 *   - 3 Atlas/Problems/ (last 30 days) → solved problems as rules
 *   - 3 Atlas/Career/Decisions.md → active decisions
 *   - Project CLAUDE.md → constraints per project
 */

const fs = require('fs');
const path = require('path');

const VAULT = path.join(process.env.HOME, 'Desktop', 'Labirynt');
const EFFORTS = path.join(VAULT, '2 Efforts');
const PROBLEMS = path.join(VAULT, '3 Atlas', 'Problems');
const DECISIONS = path.join(VAULT, '3 Atlas', 'Career', 'Decisions.md');
const GRAPH_REPORT = path.join(VAULT, 'graphify-out', 'GRAPH_REPORT.md');

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) result[key.trim()] = rest.join(':').trim();
  }
  return result;
}

function extractSections(content, headings) {
  const parts = [];
  for (const heading of headings) {
    const idx = content.indexOf(heading);
    if (idx === -1) continue;
    const nextHeading = content.slice(idx + heading.length).search(/\n## /);
    const end = nextHeading === -1 ? content.length : idx + heading.length + nextHeading;
    parts.push(content.slice(idx, end).trim());
  }
  return parts.length ? parts.join('\n\n') : null;
}

function recentFiles(dir, daysBack = 30) {
  try {
    const cutoff = Date.now() - daysBack * 86400000;
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => ({ name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter(f => f.mtime > cutoff)
      .sort((a, b) => b.mtime - a.mtime);
  } catch { return []; }
}

async function main() {
  const patterns = [];

  // 1. Active efforts
  const efforts = recentFiles(EFFORTS, 90);
  for (const e of efforts.slice(0, 5)) {
    const content = readIfExists(e.path);
    if (content && content.length > 50) {
      patterns.push({
        pattern: `Active project: ${e.name.replace('.md', '')}. ${content.slice(0, 500)}`,
        type: 'context',
        metadata: { source: 'obsidian', category: 'effort', file: e.name }
      });
    }
  }

  // 2. Recent problems (solved patterns)
  const problems = recentFiles(PROBLEMS, 30);
  for (const p of problems.slice(0, 10)) {
    const content = readIfExists(p.path);
    if (!content || content.length < 50) continue;

    const frontmatter = parseFrontmatter(content);
    const quality = frontmatter.quality || 'normal';
    if (quality === 'low') continue;

    const extracted = extractSections(content, ['## Problem', '## Rozwiązanie', '## Efekt', '## Solution', '## Effect', '## Context', '## Why it worked']);
    const patternText = extracted || content.slice(0, 800);

    patterns.push({
      pattern: patternText,
      type: quality === 'high' ? 'rule-proven' : 'rule',
      metadata: {
        source: 'obsidian',
        category: 'problem',
        file: p.name,
        quality,
        breakthrough_commit: frontmatter.breakthrough_commit || null
      }
    });
  }

  // 3. Graph God Nodes (most connected concepts in vault)
  const graphReport = readIfExists(GRAPH_REPORT);
  if (graphReport) {
    const godNodes = extractSections(graphReport, ['## God Nodes']);
    const surprisingConnections = extractSections(graphReport, ['## Surprising Connections']);
    if (godNodes) {
      const summary = [godNodes, surprisingConnections].filter(Boolean).join('\n\n').slice(0, 600);
      patterns.push({
        pattern: `Vault knowledge graph — most connected concepts:\n${summary}`,
        type: 'context',
        metadata: { source: 'obsidian', category: 'graph' }
      });
    }
  }

  // 4. Active decisions
  const decisions = readIfExists(DECISIONS);
  if (decisions) {
    // Get last 10 lines (most recent decisions)
    const recent = decisions.split('\n').filter(l => l.trim()).slice(-10).join('\n');
    if (recent.length > 20) {
      patterns.push({
        pattern: `Active decisions: ${recent}`,
        type: 'context',
        metadata: { source: 'obsidian', category: 'decisions' }
      });
    }
  }

  // Check if previous session needs braindump
  const cpPath = path.join(process.env.HOME || '', '.claude', 'last-session.json');
  let braindumpNeeded = false;
  try {
    const cp = JSON.parse(fs.readFileSync(cpPath, 'utf8'));
    if (cp.needsBraindump) {
      braindumpNeeded = true;
      // Clear the flag
      cp.needsBraindump = false;
      fs.writeFileSync(cpPath, JSON.stringify(cp, null, 2));
    }
  } catch (e) { /* no checkpoint = no braindump needed */ }

  // Output for hook handler to process
  console.log(JSON.stringify({
    status: 'ok',
    patternsLoaded: patterns.length,
    braindumpNeeded,
    sources: {
      efforts: efforts.length,
      problems: problems.length,
      hasDecisions: !!decisions
    },
    patterns
  }));
}

main().catch(err => {
  console.error('[ruflo-session-loader] Error:', err.message);
  process.exit(0); // Don't block session start
});
