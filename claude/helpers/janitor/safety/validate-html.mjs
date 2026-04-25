import fs from 'fs';
import path from 'path';

function findHtmlFiles(dir) {
  let results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      results.push(full);
    }
  }
  return results;
}

export function checkSelectorsAbsent(projectRoot, removedSelectors) {
  if (!projectRoot || !fs.existsSync(projectRoot)) {
    return { pass: true, hits: [] };
  }

  const htmlFiles = findHtmlFiles(projectRoot);
  const hits = [];

  for (const file of htmlFiles) {
    let src;
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const sel of removedSelectors) {
      const bare = sel.replace(/^[.#]/, '');
      if (src.includes(bare)) {
        hits.push({ file, selector: sel });
      }
    }
  }

  return { pass: hits.length === 0, hits };
}
