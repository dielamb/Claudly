#!/usr/bin/env node
/**
 * URL Ingest Detector (P2c)
 *
 * UserPromptSubmit hook. Detects:
 *   - URL(s) in user prompt
 *   - Sufficient context (>50 words total, or "przeczytaj/add/zapisz" signal)
 *
 * Outputs hint: "[INGEST] URL detected — /ingest-source to save to vault"
 * Only if URL looks like a resource (article/paper/video), NOT generic (github.com).
 */

'use strict';

const fs = require('fs');

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

// Skip low-value URLs
const SKIP_DOMAINS = [
  /^(localhost|127\.0\.0\.1|192\.168|10\.)/,
  /github\.com\/[^\/]+\/[^\/]+\/(blob|tree)\//,  // specific github files not articles
  /google\.com\/search/,
  /accounts\./,
  /login\./,
  /auth\./
];

// High-value domains (definitely ingest-worthy)
const HIGH_VALUE = [
  /arxiv\.org/, /medium\.com/, /substack\.com/,
  /twitter\.com|x\.com/, /youtube\.com|youtu\.be/,
  /wikipedia\.org/, /dev\.to/, /hackernews/, /news\.ycombinator/,
  /gist\.github\.com/, /\.pdf($|\?)/,
  /anthropic\.com/, /openai\.com/
];

const INGEST_TRIGGERS = /\b(przeczytaj|zapisz|dodaj|add|save|read this|ingest)\b/i;

function readPrompt() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8');
    if (stdin && stdin.trim()) {
      try {
        const data = JSON.parse(stdin);
        return data.user_prompt || data.prompt || data.userPrompt || stdin;
      } catch { return stdin; }
    }
  } catch { /* no stdin */ }
  return process.argv.slice(2).join(' ');
}

function main() {
  const prompt = readPrompt();
  if (!prompt) process.exit(0);

  const urls = prompt.match(URL_RE) || [];
  if (urls.length === 0) process.exit(0);

  // Filter high-value URLs
  const interesting = urls.filter(u => {
    for (const skip of SKIP_DOMAINS) if (skip.test(u)) return false;
    return true;
  });

  if (interesting.length === 0) process.exit(0);

  // Decide if hint should fire
  const wordCount = prompt.split(/\s+/).length;
  const hasExplicitTrigger = INGEST_TRIGGERS.test(prompt);
  const hasHighValueUrl = interesting.some(u => HIGH_VALUE.some(hv => hv.test(u)));

  // Fire hint if: explicit trigger OR (high-value URL AND enough context)
  const shouldHint = hasExplicitTrigger || (hasHighValueUrl && wordCount > 10);

  if (!shouldHint) process.exit(0);

  const shortUrl = interesting[0].length > 80 ? interesting[0].slice(0, 77) + '...' : interesting[0];
  console.log('[INGEST] URL detected: ' + shortUrl);
  console.log('  → Consider /ingest-source to save as summary in 5 Sources/ + cross-link to Atlas');
  console.log('  → Skill auto-extracts title, author, key claims, finds contradictions');
  if (interesting.length > 1) {
    console.log(`  → (${interesting.length - 1} more URL${interesting.length > 2 ? 's' : ''} in prompt)`);
  }
  process.exit(0);
}

try {
  main();
} catch (e) {
  process.exit(0);
}
