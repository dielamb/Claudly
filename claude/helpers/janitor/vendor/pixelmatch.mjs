// pixelmatch — perceptual pixel-level image comparison
// Faithful ESM port of mapbox/pixelmatch (MIT)
// Original author: Vladimir Agafonkin
//
// MIT License
// Copyright (c) 2019 Mapbox
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * Compare two RGBA pixel buffers and return the number of differing pixels.
 *
 * @param {Uint8Array|Buffer} img1   - First image, RGBA pixels (width * height * 4 bytes)
 * @param {Uint8Array|Buffer} img2   - Second image, RGBA pixels (width * height * 4 bytes)
 * @param {Uint8Array|null}   output - Receives the diff image (RGBA), or null to skip
 * @param {number}            width  - Image width in pixels
 * @param {number}            height - Image height in pixels
 * @param {object}            options
 * @param {number}   [options.threshold=0.1]          - Matching threshold (0–1); lower = stricter
 * @param {boolean}  [options.includeAA=false]        - Count anti-aliased pixels as different
 * @param {number}   [options.alpha=0.1]              - Opacity of unchanged pixels in diff image
 * @param {number[]} [options.aaColor=[255,255,0]]    - Color for anti-aliased pixels in diff [R,G,B]
 * @param {number[]} [options.diffColor=[255,0,0]]    - Color for differing pixels in diff [R,G,B]
 * @param {number[]} [options.diffColorAlt=null]      - Alternate diff color when img2 is darker
 * @param {boolean}  [options.diffMask=false]         - Draw only diff pixels; transparent elsewhere
 * @returns {number} Number of pixels that differ
 */
export default function pixelmatch(img1, img2, output, width, height, options = {}) {
  if (
    !(img1 instanceof Uint8Array || (typeof Buffer !== 'undefined' && img1 instanceof Buffer)) ||
    !(img2 instanceof Uint8Array || (typeof Buffer !== 'undefined' && img2 instanceof Buffer))
  ) {
    throw new Error('img1 and img2 must be Uint8Array or Buffer instances');
  }

  const len = width * height;

  if (img1.length !== img2.length) {
    throw new Error('img1 and img2 must be the same size');
  }
  if (img1.length !== len * 4) {
    throw new Error('img1 / img2 length does not match width * height * 4');
  }
  if (output !== null && output !== undefined && output.length !== len * 4) {
    throw new Error('output length does not match width * height * 4');
  }

  const {
    threshold = 0.1,
    includeAA = false,
    alpha = 0.1,
    aaColor = [255, 255, 0],
    diffColor = [255, 0, 0],
    diffColorAlt = null,
    diffMask = false,
  } = options;

  // Maximum perceptual delta squared for the given threshold.
  // colorDeltaSq returns values in the YIQ scale; threshold maps linearly to maxDelta.
  const maxDelta = 35215 * threshold * threshold;

  let diff = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = (y * width + x) * 4;

      const delta = colorDeltaSq(img1, img2, pos, pos);

      if (delta > maxDelta) {
        // Check whether either image has antialiasing at this pixel
        if (!includeAA && (isAntialiased(img1, x, y, width, height, img2) ||
                           isAntialiased(img2, x, y, width, height, img1))) {
          // Antialiased pixel — mark with aaColor, don't count as diff
          if (output) {
            drawPixel(output, pos, aaColor[0], aaColor[1], aaColor[2]);
          }
        } else {
          // Genuine difference
          if (output) {
            const color =
              diffColorAlt !== null && colorDelta(img1, img2, pos, pos) < 0
                ? diffColorAlt
                : diffColor;
            drawPixel(output, pos, color[0], color[1], color[2]);
          }
          diff++;
        }
      } else if (output) {
        if (!diffMask) {
          // Blend grayscale version of img1 with low alpha for context
          const v = grayPixel(img1, pos, alpha);
          drawPixel(output, pos, v, v, v);
        } else {
          // Fully transparent — only diff pixels are visible in mask mode
          output[pos + 0] = 0;
          output[pos + 1] = 0;
          output[pos + 2] = 0;
          output[pos + 3] = 0;
        }
      }
    }
  }

  return diff;
}

// ---------------------------------------------------------------------------
// Color math
// ---------------------------------------------------------------------------

// YIQ NTSC transmission coefficients
function rgb2y(r, g, b) { return r * 0.29889531 + g * 0.58662247 + b * 0.11448223; }
function rgb2i(r, g, b) { return r * 0.59597799 - g * 0.27417610 - b * 0.32180189; }
function rgb2q(r, g, b) { return r * 0.21147017 - g * 0.52261711 + b * 0.31114694; }

/**
 * Blend a channel value with the white background at a given alpha.
 * Equivalent to: channel * alpha + 255 * (1 - alpha)
 */
function blend(c, a) {
  return 255 + (c - 255) * a;
}

/**
 * Signed YIQ luminance delta between pixel at k in img1 and pixel at m in img2.
 * Used for diffColorAlt direction detection.
 */
function colorDelta(img1, img2, k, m) {
  let r1 = img1[k];
  let g1 = img1[k + 1];
  let b1 = img1[k + 2];
  let a1 = img1[k + 3];

  let r2 = img2[m];
  let g2 = img2[m + 1];
  let b2 = img2[m + 2];
  let a2 = img2[m + 3];

  if (a1 === a2 && r1 === r2 && g1 === g2 && b1 === b2) return 0;

  if (a1 < 255) { a1 /= 255; r1 = blend(r1, a1); g1 = blend(g1, a1); b1 = blend(b1, a1); }
  if (a2 < 255) { a2 /= 255; r2 = blend(r2, a2); g2 = blend(g2, a2); b2 = blend(b2, a2); }

  return rgb2y(r1, g1, b1) - rgb2y(r2, g2, b2);
}

/**
 * Squared YIQ perceptual color difference between pixel at k in img1 and pixel at m in img2.
 * The weighting (0.5053 Y + 0.299 I + 0.1957 Q) matches the original pixelmatch.
 */
function colorDeltaSq(img1, img2, k, m) {
  let r1 = img1[k];
  let g1 = img1[k + 1];
  let b1 = img1[k + 2];
  let a1 = img1[k + 3];

  let r2 = img2[m];
  let g2 = img2[m + 1];
  let b2 = img2[m + 2];
  let a2 = img2[m + 3];

  if (a1 === a2 && r1 === r2 && g1 === g2 && b1 === b2) return 0;

  if (a1 < 255) { a1 /= 255; r1 = blend(r1, a1); g1 = blend(g1, a1); b1 = blend(b1, a1); }
  if (a2 < 255) { a2 /= 255; r2 = blend(r2, a2); g2 = blend(g2, a2); b2 = blend(b2, a2); }

  const y = rgb2y(r1, g1, b1) - rgb2y(r2, g2, b2);
  const i = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2);
  const q = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2);

  return 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

/** Write a solid RGB pixel into an RGBA output buffer at byte offset pos. */
function drawPixel(output, pos, r, g, b) {
  output[pos]     = r;
  output[pos + 1] = g;
  output[pos + 2] = b;
  output[pos + 3] = 255;
}

/**
 * Compute the grey shade of a pixel blended over white, scaled by (1-alpha).
 * This is what unchanged pixels look like in the diff output.
 */
function grayPixel(img, pos, alpha) {
  const a  = img[pos + 3] / 255;
  const r  = blend(img[pos],     a);
  const g  = blend(img[pos + 1], a);
  const b  = blend(img[pos + 2], a);
  return (rgb2y(r, g, b) * (1 - alpha)) | 0;
}

// ---------------------------------------------------------------------------
// Antialiasing detection
// ---------------------------------------------------------------------------

/**
 * Determine whether a pixel at (x, y) in img is likely antialiased.
 *
 * The original pixelmatch heuristic (ported faithfully):
 *   - Scan the 3×3 neighbourhood (up to 8 pixels).
 *   - Track the min/max luminance delta against the centre pixel within that neighbourhood.
 *   - Count how many neighbours are identical (delta === 0) to centre pixel.
 *   - If there are ≥ 2 identical neighbours → NOT antialiased (solid region).
 *   - If min/max delta ratio < 0.5 → there is a sharp gradient nearby (AA candidate).
 *   - Additionally check the same neighbourhood in img2 for direction consistency.
 *
 * @param {Uint8Array} img    - The image being checked
 * @param {number}     x      - X coordinate
 * @param {number}     y      - Y coordinate
 * @param {number}     width
 * @param {number}     height
 * @param {Uint8Array} img2   - The other image (for cross-image direction check)
 * @returns {boolean}
 */
function isAntialiased(img, x, y, width, height, img2) {
  const x0 = Math.max(x - 1, 0);
  const y0 = Math.max(y - 1, 0);
  const x1 = Math.min(x + 1, width - 1);
  const y1 = Math.min(y + 1, height - 1);
  const pos = (y * width + x) * 4;

  let zeroes   = 0; // neighbours identical to centre
  let positive = 0; // neighbours where img2 is brighter
  let negative = 0; // neighbours where img2 is darker
  let minDelta = Infinity;
  let maxDelta = 0;

  for (let sy = y0; sy <= y1; sy++) {
    for (let sx = x0; sx <= x1; sx++) {
      if (sx === x && sy === y) continue;

      const sPos = (sy * width + sx) * 4;

      // Luminance delta between centre and this neighbour within the same image
      const delta = colorDeltaSq(img, img, pos, sPos);

      if (delta === 0) {
        zeroes++;
        // Two identical neighbours → solid region, definitely not AA
        if (zeroes > 1) return false;
      } else {
        if (delta < minDelta) minDelta = delta;
        if (delta > maxDelta) maxDelta = delta;
      }

      // Check the same neighbour position in img2 for brightness direction
      const cross = colorDelta(img, img2, sPos, sPos);
      if (cross > 0) positive++;
      else if (cross < 0) negative++;
    }
  }

  // If all neighbours are identical, it is not AA
  if (minDelta === Infinity || maxDelta === 0) return false;

  // Strong gradient (ratio < 0.5) AND at least one cross-image directional difference
  // indicates antialiasing
  return minDelta / maxDelta < 0.5 && (positive > 0 || negative > 0);
}
