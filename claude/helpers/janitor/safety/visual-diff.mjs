/**
 * safety/visual-diff.js
 *
 * Layer 3 — Visual diff safety net.
 *
 * Uses Chrome headless to screenshot each HTML entry-point at 1440×900, then
 * compares before/after pairs with pixelmatch. Any page with ≥1% pixel
 * difference causes the check to fail, triggering a slop-cleaner rollback.
 *
 * Contracts:
 *   captureBaseline(projectConfig) → { pages: string[], dir: string }
 *   diffAgainstBaseline(projectConfig, baselineDir) → { pass: boolean, maxDiff: number, details: Array }
 *
 * ESM — no external npm deps. PNG parsing uses Node built-ins (zlib + Buffer).
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ── Constants ─────────────────────────────────────────────────────────────────

const CHROME_PATH =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 900;

/** Maximum allowed pixel-diff ratio before we abort (1% of total pixels). */
const DIFF_THRESHOLD = 0.01;

// ── Chrome availability ───────────────────────────────────────────────────────

function assertChromeExists() {
  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error('Chrome not found — visual diff cannot run');
  }
}

// ── Entry-point resolution ────────────────────────────────────────────────────

/**
 * Derive the list of HTML pages to screenshot for a project.
 *
 * If `projectConfig.htmlEntryPoints` is a non-empty array, use it verbatim.
 * Otherwise fall back to all `.html` files at the project root level (flat).
 *
 * @param {{ root: string, htmlEntryPoints?: string[] }} projectConfig
 * @returns {string[]} - relative page filenames, e.g. ['index.html', 'work.html']
 */
function resolveEntryPoints(projectConfig) {
  if (
    Array.isArray(projectConfig.htmlEntryPoints) &&
    projectConfig.htmlEntryPoints.length > 0
  ) {
    return projectConfig.htmlEntryPoints;
  }

  // Fallback: all .html files at root level (not recursive)
  const root = projectConfig.root;
  if (!fs.existsSync(root)) {
    return [];
  }

  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.html'))
    .map((e) => e.name);
}

// ── Screenshot helpers ────────────────────────────────────────────────────────

/**
 * Derive a safe filename stem from a page path.
 * 'work.html'          → 'work'
 * 'pages/contact.html' → 'pages-contact'
 *
 * @param {string} page
 * @returns {string}
 */
function pageToStem(page) {
  return page
    .replace(/\.html$/i, '')
    .replace(/[/\\]/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Screenshot a single HTML page via Chrome headless.
 * Writes a PNG file to `outFile`.
 *
 * @param {string} projectRoot - absolute path to the project root
 * @param {string} page - relative path to HTML file, e.g. 'work.html'
 * @param {string} outFile - absolute path for the output PNG
 */
function screenshotPage(projectRoot, page, outFile) {
  const absPage = path.resolve(projectRoot, page);
  const fileUrl = `file://${absPage}`;

  // Chrome requires the path to be shell-escaped when passed as a string to
  // execSync — we use an args array via the shell to avoid injection.
  // The double-escaping of the screenshot path handles spaces in outFile.
  const cmd = [
    `'${CHROME_PATH.replace(/'/g, "'\\''")}'`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`,
    `--screenshot='${outFile.replace(/'/g, "'\\''")}'`,
    `'${fileUrl.replace(/'/g, "'\\''")}'`,
  ].join(' ');

  execSync(cmd, { stdio: 'pipe', shell: '/bin/sh' });
}

// ── PNG parsing (pure Node built-ins) ────────────────────────────────────────
//
// Chrome --screenshot always produces a valid PNG. We need to decode it into
// a flat RGBA Uint8Array so pixelmatch can compare pixel-by-pixel.
//
// PNG structure (simplified):
//   8-byte signature
//   IHDR chunk  (width, height, bitDepth, colorType, …)
//   IDAT chunk(s) — zlib-compressed filtered row data
//   IEND chunk
//
// We support colorType 2 (RGB) and colorType 6 (RGBA), 8-bit depth — which is
// exactly what Chrome produces. Other formats will throw.

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Parse a PNG buffer into { width, height, data: Uint8Array } where `data`
 * is a flat RGBA array (4 bytes per pixel, left-to-right, top-to-bottom).
 *
 * @param {Buffer} buf - raw PNG file contents
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
function parsePng(buf) {
  // Verify signature
  if (!buf.slice(0, 8).equals(PNG_SIG)) {
    throw new Error('Not a valid PNG file');
  }

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  // Walk chunks
  while (pos < buf.length) {
    const chunkLength = buf.readUInt32BE(pos);
    const chunkType = buf.toString('ascii', pos + 4, pos + 8);
    const chunkData = buf.slice(pos + 8, pos + 8 + chunkLength);
    // Skip CRC (4 bytes)
    pos += 12 + chunkLength;

    if (chunkType === 'IHDR') {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData.readUInt8(8);
      colorType = chunkData.readUInt8(9);

      if (bitDepth !== 8) {
        throw new Error(`Unsupported PNG bit depth: ${bitDepth} (expected 8)`);
      }
      // colorType 2 = RGB, 6 = RGBA
      if (colorType !== 2 && colorType !== 6) {
        throw new Error(`Unsupported PNG color type: ${colorType} (expected 2=RGB or 6=RGBA)`);
      }
    } else if (chunkType === 'IDAT') {
      idatChunks.push(chunkData);
    } else if (chunkType === 'IEND') {
      break;
    }
  }

  if (width === 0 || height === 0) {
    throw new Error('PNG IHDR chunk not found or invalid dimensions');
  }

  // Decompress all IDAT chunks (concatenated)
  const compressed = Buffer.concat(idatChunks);
  const raw = zlib.inflateSync(compressed);

  // Determine bytes-per-pixel (bpp)
  const channels = colorType === 6 ? 4 : 3; // RGBA or RGB
  const bytesPerRow = 1 + width * channels; // 1 filter byte + pixel data

  // Allocate RGBA output
  const rgba = new Uint8Array(width * height * 4);

  // PNG filter reconstruction — we handle all five filter types (0–4)
  // Previous row buffer (initialized to zeros per spec)
  const prevRow = new Uint8Array(width * channels);

  for (let y = 0; y < height; y++) {
    const filterByte = raw[y * bytesPerRow];
    const rowStart = y * bytesPerRow + 1;
    const row = new Uint8Array(raw.buffer, raw.byteOffset + rowStart, width * channels);
    const recon = new Uint8Array(width * channels);

    for (let x = 0; x < row.length; x++) {
      const a = x >= channels ? recon[x - channels] : 0; // left
      const b = prevRow[x];                               // above
      const c = x >= channels ? prevRow[x - channels] : 0; // upper-left

      switch (filterByte) {
        case 0: recon[x] = row[x]; break; // None
        case 1: recon[x] = (row[x] + a) & 0xff; break; // Sub
        case 2: recon[x] = (row[x] + b) & 0xff; break; // Up
        case 3: recon[x] = (row[x] + Math.floor((a + b) / 2)) & 0xff; break; // Average
        case 4: recon[x] = (row[x] + paethPredictor(a, b, c)) & 0xff; break; // Paeth
        default:
          throw new Error(`Unknown PNG filter type: ${filterByte} at row ${y}`);
      }
    }

    // Write reconstructed row into RGBA output
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const si = x * channels;
      const di = rowOffset + x * 4;
      rgba[di + 0] = recon[si + 0]; // R
      rgba[di + 1] = recon[si + 1]; // G
      rgba[di + 2] = recon[si + 2]; // B
      rgba[di + 3] = channels === 4 ? recon[si + 3] : 255; // A
    }

    prevRow.set(recon);
  }

  return { width, height, data: rgba };
}

/**
 * Paeth predictor function as defined in the PNG specification.
 */
function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// ── Cache directory ───────────────────────────────────────────────────────────

/**
 * Ensure `.janitor-cache/` exists under the project root.
 *
 * @param {string} projectRoot
 * @returns {string} - absolute path to the cache dir
 */
function ensureCacheDir(projectRoot) {
  const dir = path.join(projectRoot, '.janitor-cache');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Screenshot every HTML entry-point at 1440×900 and save PNGs to
 * `.janitor-cache/before-{pagename}.png` in the project root.
 *
 * @param {{ root: string, name?: string, htmlEntryPoints?: string[] }} projectConfig
 * @returns {Promise<{ pages: string[], dir: string }>}
 */
export async function captureBaseline(projectConfig) {
  assertChromeExists();

  const root = projectConfig.root;
  const pages = resolveEntryPoints(projectConfig);
  const cacheDir = ensureCacheDir(root);

  for (const page of pages) {
    const stem = pageToStem(page);
    const outFile = path.join(cacheDir, `before-${stem}.png`);
    screenshotPage(root, page, outFile);
  }

  return { pages, dir: cacheDir };
}

/**
 * Screenshot every HTML entry-point again, compare against the baseline PNGs
 * in `baselineDir`, and return a pass/fail result.
 *
 * A page fails if the ratio of differing pixels exceeds DIFF_THRESHOLD (1%).
 *
 * @param {{ root: string, name?: string, htmlEntryPoints?: string[] }} projectConfig
 * @param {string} baselineDir - path returned by captureBaseline (the .janitor-cache dir)
 * @returns {Promise<{
 *   pass: boolean,
 *   maxDiff: number,
 *   details: Array<{ page: string, diff: number, passed: boolean }>
 * }>}
 */
export async function diffAgainstBaseline(projectConfig, baselineDir) {
  assertChromeExists();

  // Import vendored pixelmatch — ESM dynamic import so this module can be used
  // even in environments where the vendor file doesn't exist yet (e.g. tests
  // that stub this function). The import is deferred until first actual diff.
  const { default: pixelmatch } = await import(
    new URL('../vendor/pixelmatch.mjs', import.meta.url).pathname
  );

  const root = projectConfig.root;
  const pages = resolveEntryPoints(projectConfig);
  const cacheDir = ensureCacheDir(root);

  const details = [];
  let maxDiff = 0;

  for (const page of pages) {
    const stem = pageToStem(page);
    const beforeFile = path.join(baselineDir, `before-${stem}.png`);
    const afterFile = path.join(cacheDir, `after-${stem}.png`);

    // Take the "after" screenshot
    screenshotPage(root, page, afterFile);

    // Bail out clearly if baseline is missing (shouldn't happen in normal flow)
    if (!fs.existsSync(beforeFile)) {
      throw new Error(
        `Baseline screenshot missing for page "${page}": ${beforeFile}\n` +
        'Run captureBaseline() before diffAgainstBaseline().'
      );
    }

    // Parse both PNGs
    const before = parsePng(fs.readFileSync(beforeFile));
    const after = parsePng(fs.readFileSync(afterFile));

    // Require identical dimensions — Chrome at a fixed window-size should
    // always produce the same dimensions, but guard explicitly.
    if (before.width !== after.width || before.height !== after.height) {
      throw new Error(
        `Screenshot dimensions changed for page "${page}": ` +
        `before=${before.width}×${before.height}, ` +
        `after=${after.width}×${after.height}`
      );
    }

    const totalPixels = before.width * before.height;
    const diffBuffer = new Uint8Array(totalPixels * 4); // pixelmatch writes diff image here

    const numDiffPixels = pixelmatch(
      before.data,
      after.data,
      diffBuffer,
      before.width,
      before.height,
      { threshold: 0.1 } // per-pixel colour tolerance (not the abort threshold)
    );

    const diffRatio = numDiffPixels / totalPixels;
    const passed = diffRatio < DIFF_THRESHOLD;

    details.push({ page, diff: diffRatio, passed });

    if (diffRatio > maxDiff) {
      maxDiff = diffRatio;
    }
  }

  const pass = details.every((d) => d.passed);

  return { pass, maxDiff, details };
}
