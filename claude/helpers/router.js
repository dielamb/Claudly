#!/usr/bin/env node
/**
 * Claude Flow Agent Router (with history-based learning)
 *
 * Routes tasks to optimal agents based on keyword patterns + past routing outcomes.
 * History is stored in .claude-flow/data/router-history.json and used to adjust
 * confidence for future similar prompts.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), '.claude-flow', 'data');
const HISTORY_PATH = path.join(DATA_DIR, 'router-history.json');
const MAX_HISTORY = 200;

const AGENT_CAPABILITIES = {
  coder: ['code-generation', 'refactoring', 'debugging', 'implementation'],
  tester: ['unit-testing', 'integration-testing', 'coverage', 'test-generation'],
  reviewer: ['code-review', 'security-audit', 'quality-check', 'best-practices'],
  researcher: ['web-search', 'documentation', 'analysis', 'summarization'],
  architect: ['system-design', 'architecture', 'patterns', 'scalability'],
  'backend-dev': ['api', 'database', 'server', 'authentication'],
  'frontend-dev': ['ui', 'react', 'css', 'components'],
  devops: ['ci-cd', 'docker', 'deployment', 'infrastructure'],
};

const TASK_PATTERNS = {
  'implement|create|build|add|write code': 'coder',
  'test|spec|coverage|unit test|integration': 'tester',
  'review|audit|check|validate|security': 'reviewer',
  'research|find|search|documentation|explore': 'researcher',
  'design|architect|structure|plan': 'architect',
  'api|endpoint|server|backend|database': 'backend-dev',
  'ui|frontend|component|react|css|style': 'frontend-dev',
  'deploy|docker|ci|cd|pipeline|infrastructure': 'devops',
};

// ── History helpers ──────────────────────────────────────────────────────────

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
    }
  } catch { /* corrupt → start fresh */ }
  return [];
}

function saveHistory(history) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    // Keep only recent entries
    const trimmed = history.slice(-MAX_HISTORY);
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch { /* best effort */ }
}

/**
 * Extract keywords from a prompt for similarity matching.
 * Strips stop words, returns sorted unique lowercase tokens.
 */
function extractKeywords(text) {
  const STOP = new Set(['the','a','an','is','are','was','to','of','in','for','on','with','at','by','and','or','not','i','me','my','it','this','that','do','does','how','what','can','will','would','should']);
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w))
    .sort();
}

/**
 * Compute keyword overlap between two prompts (0-1).
 */
function promptSimilarity(kwA, kwB) {
  if (kwA.length === 0 || kwB.length === 0) return 0;
  const setB = new Set(kwB);
  let overlap = 0;
  for (const w of kwA) { if (setB.has(w)) overlap++; }
  return overlap / Math.max(kwA.length, kwB.length);
}

/**
 * Look up history for similar past routings and compute adjustment.
 */
function getHistoryAdjustment(prompt, agent) {
  const history = loadHistory();
  if (history.length < 5) return null; // not enough data

  const promptKw = extractKeywords(prompt);
  if (promptKw.length === 0) return null;

  // Find similar past prompts routed to the same agent
  let sameAgentSuccess = 0;
  let sameAgentFail = 0;
  let totalSimilar = 0;

  for (const entry of history) {
    const sim = promptSimilarity(promptKw, entry.keywords || []);
    if (sim < 0.3) continue; // not similar enough
    totalSimilar++;
    if (entry.agent === agent) {
      if (entry.outcome === 'success') sameAgentSuccess++;
      else if (entry.outcome === 'failure') sameAgentFail++;
    }
  }

  if (totalSimilar === 0) return null;

  const total = sameAgentSuccess + sameAgentFail;
  if (total < 2) return null; // not enough data for this agent

  const successRate = sameAgentSuccess / total;

  if (successRate < 0.4) {
    return {
      adjustment: -0.15,
      message: `History: ${agent} had ${Math.round(successRate*100)}% success on similar tasks (${total} cases)`,
    };
  } else if (successRate > 0.8) {
    return {
      adjustment: 0.1,
      message: `History: ${agent} had ${Math.round(successRate*100)}% success on similar tasks (${total} cases)`,
    };
  }

  return null;
}

/**
 * Record a routing decision for future learning.
 * outcome: 'success' | 'failure' | 'pending'
 */
function recordRouting(prompt, agent, outcome) {
  const history = loadHistory();
  const keywords = extractKeywords(prompt);

  // Check if there's a pending entry for this prompt → update it
  for (let i = history.length - 1; i >= Math.max(0, history.length - 5); i--) {
    if (history[i].outcome === 'pending' && promptSimilarity(keywords, history[i].keywords || []) > 0.8) {
      history[i].outcome = outcome;
      history[i].resolvedAt = Date.now();
      saveHistory(history);
      return;
    }
  }

  // New entry
  history.push({
    prompt: prompt.slice(0, 100),
    keywords,
    agent,
    outcome,
    timestamp: Date.now(),
  });
  saveHistory(history);
}

function routeTask(task) {
  const taskLower = task.toLowerCase();

  // Check patterns
  let agent = 'coder';
  let confidence = 0.5;
  let reason = 'Default routing — no specific pattern matched';

  for (const [pattern, matchedAgent] of Object.entries(TASK_PATTERNS)) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(taskLower)) {
      agent = matchedAgent;
      confidence = 0.8;
      reason = `Matched pattern: ${pattern.substring(0, 40)}`;
      break;
    }
  }

  // Apply history-based adjustment
  const historyAdj = getHistoryAdjustment(task, agent);
  let historyAdjustment = null;
  if (historyAdj) {
    confidence = Math.max(0.1, Math.min(1.0, confidence + historyAdj.adjustment));
    historyAdjustment = historyAdj.message;
  }

  // Record this routing as pending (will be resolved by feedback)
  recordRouting(task, agent, 'pending');

  return {
    agent,
    confidence,
    reason,
    historyAdjustment,
  };
}

/**
 * markLastRoutingOutcome(success) — Called by hook-handler to close the feedback loop.
 */
function markLastRoutingOutcome(success) {
  const history = loadHistory();
  // Find most recent pending entry
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].outcome === 'pending') {
      history[i].outcome = success ? 'success' : 'failure';
      history[i].resolvedAt = Date.now();
      saveHistory(history);
      return true;
    }
  }
  return false;
}

// CLI
const task = process.argv.slice(2).join(' ');

if (task) {
  const result = routeTask(task);
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('Usage: router.js <task description>');
  console.log('\nAvailable agents:', Object.keys(AGENT_CAPABILITIES).join(', '));
}

module.exports = { routeTask, markLastRoutingOutcome, recordRouting, AGENT_CAPABILITIES, TASK_PATTERNS };
