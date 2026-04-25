#!/usr/bin/env node
// consolidator.js — merges analyst outputs into a frequency-ranked rule set

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { update: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--update') {
      args.update = true;
    } else if (argv[i].startsWith('--')) {
      const key = argv[i].replace(/^--/, '');
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function usage() {
  console.error(
    'Usage: node consolidator.js --analysts <dir> --skill <skill-name> [--threshold <n>] [--update]'
  );
  console.error('  --analysts  directory containing analyst-*.txt files');
  console.error('  --skill     skill name (used for optional --update)');
  console.error('  --threshold minimum evidence count to include a rule (default: 2)');
  console.error('  --update    write result back to ~/.claude/skills/<skill-name>/skill.md');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse rules from a single analyst output file
// ---------------------------------------------------------------------------

function parseAnalystFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const rules = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('RULE:')) continue;

    // Expected format: RULE: {text} | EVIDENCE: {run numbers} | PRIORITY: {high/med/low}
    const parts = trimmed.split('|').map((p) => p.trim());

    const ruleText = parts[0].replace(/^RULE:\s*/, '').trim();
    if (!ruleText) continue;

    let evidence = [];
    let priority = 'med';

    for (const part of parts.slice(1)) {
      if (part.startsWith('EVIDENCE:')) {
        const raw = part.replace(/^EVIDENCE:\s*/, '').trim();
        // Extract all numbers from the evidence string
        evidence = (raw.match(/\d+/g) || []).map(Number);
      } else if (part.startsWith('PRIORITY:')) {
        const p = part.replace(/^PRIORITY:\s*/, '').trim().toLowerCase();
        if (['high', 'med', 'low'].includes(p)) priority = p;
      }
    }

    rules.push({ ruleText, evidence, priority, evidenceCount: evidence.length });
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Normalize rule text for deduplication (lowercase + strip punctuation)
// ---------------------------------------------------------------------------

function normalizeRule(text) {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Merge rules across analysts, summing evidence counts
// ---------------------------------------------------------------------------

function mergeRules(allRules) {
  // Map: normalized text → { canonical text, totalEvidence, priority scores }
  const merged = new Map();

  for (const rule of allRules) {
    const key = normalizeRule(rule.ruleText);
    if (!key) continue;

    if (!merged.has(key)) {
      merged.set(key, {
        text: rule.ruleText,
        totalEvidence: rule.evidenceCount,
        evidenceRuns: new Set(rule.evidence),
        priorityScores: { high: 0, med: 0, low: 0 },
        occurrences: 1,
      });
    } else {
      const existing = merged.get(key);
      existing.totalEvidence += rule.evidenceCount;
      rule.evidence.forEach((n) => existing.evidenceRuns.add(n));
      existing.occurrences += 1;

      // Keep the longest (most descriptive) version of the rule text
      if (rule.ruleText.length > existing.text.length) {
        existing.text = rule.ruleText;
      }
    }

    const entry = merged.get(key);
    entry.priorityScores[rule.priority] = (entry.priorityScores[rule.priority] || 0) + 1;
  }

  // Convert to array and compute final priority
  return Array.from(merged.values()).map((entry) => {
    const { high, med, low } = entry.priorityScores;
    let priority = 'low';
    if (high >= med && high >= low) priority = 'high';
    else if (med >= low) priority = 'med';

    return {
      text: entry.text,
      totalEvidence: entry.totalEvidence,
      uniqueRuns: entry.evidenceRuns.size,
      occurrences: entry.occurrences,
      priority,
    };
  });
}

// ---------------------------------------------------------------------------
// Classify rules by frequency tier
// ---------------------------------------------------------------------------

function classifyRules(rules, threshold) {
  const core = [];
  const guidance = [];
  const edgeCases = [];
  const discarded = [];

  for (const rule of rules) {
    const e = rule.totalEvidence;
    if (e >= 8) {
      core.push(rule);
    } else if (e >= 4) {
      guidance.push(rule);
    } else if (e >= Math.max(2, threshold)) {
      edgeCases.push(rule);
    } else {
      discarded.push(rule);
    }
  }

  // Sort each tier: priority (high > med > low) then evidence count descending
  const priorityOrder = { high: 0, med: 1, low: 2 };
  const sort = (arr) =>
    arr.sort(
      (a, b) =>
        priorityOrder[a.priority] - priorityOrder[b.priority] ||
        b.totalEvidence - a.totalEvidence
    );

  return {
    core: sort(core).slice(0, 30), // cap core at 30
    guidance: sort(guidance),
    edgeCases: sort(edgeCases),
    discarded,
  };
}

// ---------------------------------------------------------------------------
// Format output as Markdown
// ---------------------------------------------------------------------------

function formatMarkdown(classified, skillName) {
  const lines = [];
  const now = new Date().toISOString();

  lines.push(`# Evidence-Based Rules: ${skillName || 'unnamed skill'}`);
  lines.push(`_Generated: ${now}_`);
  lines.push('');

  // Core rules
  lines.push('## Core Rules (apply always)');
  if (classified.core.length === 0) {
    lines.push('_(no rules reached core threshold of 8+ evidence mentions)_');
  } else {
    classified.core.forEach((rule, i) => {
      lines.push(`${i + 1}. ${rule.text} [evidence: ${rule.totalEvidence} runs]`);
    });
  }
  lines.push('');

  // Guidance
  lines.push('## Guidance (apply in most cases)');
  if (classified.guidance.length === 0) {
    lines.push('_(no rules in 4-7 evidence range)_');
  } else {
    classified.guidance.forEach((rule) => {
      lines.push(`- ${rule.text} [evidence: ${rule.totalEvidence}]`);
    });
  }
  lines.push('');

  // Edge cases
  lines.push('## Edge Cases (apply when relevant)');
  if (classified.edgeCases.length === 0) {
    lines.push('_(no rules in 2-3 evidence range)_');
  } else {
    classified.edgeCases.forEach((rule) => {
      lines.push(`- ${rule.text} [evidence: ${rule.totalEvidence}]`);
    });
  }
  lines.push('');

  lines.push('---');
  lines.push(
    `_Discarded ${classified.discarded.length} rules with insufficient evidence (< threshold)._`
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Update skill file (optional)
// ---------------------------------------------------------------------------

function updateSkillFile(skillName, rulesMarkdown) {
  const skillsDir = path.join(process.env.HOME, '.claude', 'skills');
  const candidates = [
    path.join(skillsDir, skillName, 'skill.md'),
    path.join(skillsDir, skillName, `${skillName}.md`),
    path.join(skillsDir, `${skillName}.md`),
  ];

  let targetPath = null;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      targetPath = candidate;
      break;
    }
  }

  if (!targetPath) {
    // Create new skill file
    const dir = path.join(skillsDir, skillName);
    fs.mkdirSync(dir, { recursive: true });
    targetPath = path.join(dir, 'skill.md');
  }

  // Append evidence section (don't overwrite existing content)
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  const divider = '\n\n---\n<!-- trace-to-skill: evidence-based rules below -->\n';

  // Remove any previous evidence section
  const baseContent = existing.split('<!-- trace-to-skill: evidence-based rules below -->')[0].trimEnd();
  const updated = baseContent + divider + rulesMarkdown;

  fs.writeFileSync(targetPath, updated, 'utf8');
  console.log(`\nSkill file updated: ${targetPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);

  if (!args.analysts) {
    usage();
  }

  const analystsDir = path.resolve(args.analysts);
  if (!fs.existsSync(analystsDir)) {
    console.error(`Error: analysts directory not found: ${analystsDir}`);
    process.exit(1);
  }

  const threshold = parseInt(args.threshold || '2', 10);
  if (isNaN(threshold) || threshold < 1) {
    console.error('Error: --threshold must be a positive integer');
    process.exit(1);
  }

  // Read analyst files
  const analystFiles = fs
    .readdirSync(analystsDir)
    .filter((f) => f.startsWith('analyst-') && f.endsWith('.txt'))
    .sort();

  if (analystFiles.length === 0) {
    console.error(`Error: no analyst-*.txt files found in ${analystsDir}`);
    process.exit(1);
  }

  console.log(`Reading ${analystFiles.length} analyst file(s) from ${analystsDir}`);

  // Parse all rules
  const allRules = [];
  for (const file of analystFiles) {
    const filePath = path.join(analystsDir, file);
    const rules = parseAnalystFile(filePath);
    console.log(`  ${file}: ${rules.length} raw rules`);
    allRules.push(...rules);
  }

  console.log(`Total raw rules: ${allRules.length}`);

  // Merge and classify
  const merged = mergeRules(allRules);
  const classified = classifyRules(merged, threshold);

  console.log('\nRule classification:');
  console.log(`  Core (8+ evidence):    ${classified.core.length}`);
  console.log(`  Guidance (4-7):        ${classified.guidance.length}`);
  console.log(`  Edge cases (2-3):      ${classified.edgeCases.length}`);
  console.log(`  Discarded (<${threshold}):       ${classified.discarded.length}`);

  // Format and output
  const skillName = args.skill || 'unnamed';
  const markdown = formatMarkdown(classified, skillName);

  console.log('\n' + '='.repeat(60));
  console.log(markdown);
  console.log('='.repeat(60));

  // Save to file in analysts dir
  const outFile = path.join(analystsDir, 'consolidated-rules.md');
  fs.writeFileSync(outFile, markdown, 'utf8');
  console.log(`\nConsolidated rules saved to: ${outFile}`);

  // Optionally update skill file
  if (args.update && args.skill) {
    updateSkillFile(args.skill, markdown);
  } else if (args.update && !args.skill) {
    console.error('Warning: --update requires --skill to be set. Skipping skill file update.');
  }
}

main();
