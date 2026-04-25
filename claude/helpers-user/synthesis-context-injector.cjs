#!/usr/bin/env node
/**
 * Synthesis Context Injector (P0a — Karpathy write-back enforcement)
 *
 * UserPromptSubmit hook. Detects:
 *   1. Synthesis intent in user prompt (Polish + English keywords)
 *   2. Matches existing Synthesis/ notes by title/content similarity
 *
 * Outputs:
 *   - If matching synthesis found: "[SYNTHESIS] Existing: [[X]] — update if stale"
 *   - If synthesis intent + no match: "[SYNTHESIS] Non-trivial answer — save to 3 Atlas/Synthesis/"
 *   - Otherwise: silent
 *
 * Runs on every UserPromptSubmit. Output goes to stdout (visible to Claude via hook).
 * Budget: <100ms.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || '';
const SYNTHESIS_DIR = path.join(HOME, 'Desktop', 'Labirynt', '3 Atlas', 'Synthesis');

// Synthesis intent keywords (PL + EN)
const INTENT_PATTERNS = [
  // Polish
  /\b(porównaj|porównanie|vs)\b/i,
  /\b(podsumuj|podsumowanie|syntez[ayę]|synteza)\b/i,
  /\b(analiza|przeanalizuj|przeglądnij)\b/i,
  /\b(jak (się )?ma (się )?do|jak to wygląda w)\b/i,
  /\b(wyjaśnij|wytłumacz|opisz)\b/i,
  /\b(dlaczego|czemu|po co)\b/i,
  /\b(różnice|podobieństwa|alternatywy)\b/i,
  // English
  /\b(compare|comparison|vs|versus)\b/i,
  /\b(summarize|summary|synthesize|synthesis)\b/i,
  /\b(analyze|analysis|review)\b/i,
  /\b(how does? .+ (relate|compare) to)\b/i,
  /\b(explain|describe|walk me through)\b/i,
  /\b(why|reason for)\b/i,
  /\b(differences|similarities|alternatives|trade-offs?)\b/i
];

function readPrompt() {
  // Hook receives user prompt via stdin or argv
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

function detectSynthesisIntent(prompt) {
  if (!prompt || prompt.length < 15) return false;
  let hits = 0;
  for (const pat of INTENT_PATTERNS) {
    if (pat.test(prompt)) hits++;
  }
  // Also: question length — long questions (>100 chars) with any pattern signal synthesis
  return hits >= 1 && prompt.length > 40;
}

function tokenize(text) {
  return String(text || '').toLowerCase()
    .replace(/[^a-z0-9ąćęłńóśźż\s-]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3);
}

function findMatchingSynthesis(prompt) {
  if (!fs.existsSync(SYNTHESIS_DIR)) return [];
  const promptTokens = new Set(tokenize(prompt));
  if (promptTokens.size === 0) return [];

  const matches = [];
  try {
    const files = fs.readdirSync(SYNTHESIS_DIR).filter(f => f.endsWith('.md'));
    for (const f of files) {
      const p = path.join(SYNTHESIS_DIR, f);
      let content = '';
      try {
        content = fs.readFileSync(p, 'utf-8').slice(0, 2000);
      } catch { continue; }

      // Extract title from filename + first heading + question field
      const title = f.replace(/\.md$/, '');
      const fmMatch = content.match(/question:\s*["']?([^"'\n]+)/);
      const question = fmMatch ? fmMatch[1].trim() : '';

      const docTokens = new Set(tokenize(title + ' ' + question + ' ' + content.slice(0, 500)));

      // Jaccard similarity
      let intersect = 0;
      for (const t of promptTokens) if (docTokens.has(t)) intersect++;
      const unionSize = promptTokens.size + docTokens.size - intersect;
      const jaccard = unionSize > 0 ? intersect / unionSize : 0;

      if (jaccard >= 0.08) {
        matches.push({ file: f, title, question, similarity: jaccard });
      }
    }
  } catch { /* non-fatal */ }

  matches.sort((a, b) => b.similarity - a.similarity);
  return matches.slice(0, 3);
}

function main() {
  const prompt = readPrompt();
  if (!prompt) process.exit(0);

  const hasIntent = detectSynthesisIntent(prompt);
  const matches = findMatchingSynthesis(prompt);

  const lines = [];

  if (matches.length > 0) {
    lines.push('[SYNTHESIS] Existing notes may answer this — check before writing new synthesis:');
    for (const m of matches) {
      lines.push(`  - [[${m.title}]] (similarity ${(m.similarity * 100).toFixed(0)}%)`);
    }
    if (hasIntent) {
      lines.push('  → If answer evolves beyond these, UPDATE the matching synthesis (do not create duplicate).');
    }
  } else if (hasIntent) {
    lines.push('[SYNTHESIS] Your answer likely involves synthesizing 3+ notes.');
    lines.push('  → If final answer is >200 words AND non-obvious, save to 3 Atlas/Synthesis/[topic].md');
    lines.push('  → Template: type: synthesis, question, sources: [[A]], [[B]], [[C]], quality:, synteza, insighty');
  }

  if (lines.length > 0) {
    console.log(lines.join('\n'));
  }
  process.exit(0);
}

try {
  main();
} catch (e) {
  // Never block prompt submission
  process.exit(0);
}
