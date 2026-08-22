// photo-qc.js (2026-08-20)
// Client-side quality gates that reject bad photos BEFORE we spend a
// Ximilar / API credit. Three gates:
//
//  1. LOW-RES: reject images whose short edge is below 400px (a scanned
//     card is typically 600x825 at minimum; anything smaller is guaranteed
//     to fail identification).
//
//  2. BLUR: variance-of-Laplacian on a downsampled grayscale copy. The
//     standard cheap CV blur check. Threshold tuned empirically:
//       - crisp card:      variance >  600
//       - slightly blurry: variance ~  200-400  (still usable)
//       - motion blur:     variance <  100      (reject)
//     We use 120 as the reject threshold (aggressive on blur, lenient on
//     everything else).
//
//  3. DUPE: perceptual hash of the current image compared against the
//     last N scans in this session (in-memory only, per-tab). If the new
//     hash is within Hamming distance 6 of a recent one, flag as dupe.
//     User can override ("Yes, scan again" button in the UI).
//
// Public API: window.CardResellPhotoQC.check(file) -> Promise<QCResult>
//
//   QCResult = {
//     ok: boolean,
//     reasons: [string, ...],   // list of failure reasons, empty if ok
//     details: {
//       width, height,
//       blurScore,              // higher = sharper; null if not run
//       phash,                  // 64-bit dHash as hex string
//       dupOfHash,              // hash we matched against (if any)
//     }
//   }

(function () {
  'use strict';

  const MIN_SHORT_EDGE = 400;   // pixels
  const BLUR_THRESHOLD = 120;   // variance of Laplacian; below = blurry
  // 2026-08-21: tightened from 6 to 4 to combat false positives on
  // cards shot against the same background. Combined with cropped-
  // region hashing in check().
  const DUPE_DISTANCE  = 4;     // Hamming on cropped card; <= is a dupe
  const RECENT_HASH_CAP = 8;    // keep last 8 scans

  const recentHashes = []; // ring buffer of hex strings

  // ── helpers ────────────────────────────────────────────────────────
  function loadBitmap(file) {
    return new Promise((resolve, reject) => {
      // Prefer createImageBitmap where available (Safari 15+, all modern)
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(file).then(resolve).catch(reject);
        return;
      }
      // Fallback: HTMLImageElement
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  function drawToCanvas(source, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    return { canvas: c, ctx };
  }

  // Variance of Laplacian on a downsampled grayscale copy.
  // Returns a positive number; higher = sharper.
  function blurScore(bitmap) {
    // Downsample to 256px on the short edge for consistent scoring.
    const sw = bitmap.width, sh = bitmap.height;
    const short = Math.min(sw, sh);
    const scale = short > 256 ? 256 / short : 1;
    const w = Math.max(64, Math.round(sw * scale));
    const h = Math.max(64, Math.round(sh * scale));
    const { ctx } = drawToCanvas(bitmap, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    // Grayscale luma.
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      // Rec. 709 luma; alpha ignored
      gray[p] = 0.2126 * data[i] + 0.7152 * data[i+1] + 0.0722 * data[i+2];
    }
    // 3x3 Laplacian kernel:  0 -1  0
    //                       -1  4 -1
    //                        0 -1  0
    let sum = 0, sumSq = 0, n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const v = 4 * gray[i]
                - gray[i - 1] - gray[i + 1]
                - gray[i - w] - gray[i + w];
        sum   += v;
        sumSq += v * v;
        n++;
      }
    }
    if (n === 0) return 0;
    const mean = sum / n;
    return (sumSq / n) - (mean * mean); // variance
  }

  // Difference-hash: 8x9 -> 64 bits. Returns hex string.
  function dHash(bitmap) {
    const w = 9, h = 8;
    const { ctx } = drawToCanvas(bitmap, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = (0.2126 * data[i] + 0.7152 * data[i+1] + 0.0722 * data[i+2]) | 0;
    }
    // Compare each pixel to the one to its right; bit = 1 if left > right.
    let bits = 0n;
    let shift = 63n;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w - 1; x++) {
        const i = y * w + x;
        if (gray[i] > gray[i + 1]) bits |= (1n << shift);
        shift--;
      }
    }
    // pad to 16 hex chars
    return bits.toString(16).padStart(16, '0');
  }

  function hamming(hexA, hexB) {
    if (!hexA || !hexB) return 64;
    const a = BigInt('0x' + hexA);
    const b = BigInt('0x' + hexB);
    let x = a ^ b;
    let count = 0;
    while (x) { count += Number(x & 1n); x >>= 1n; }
    return count;
  }

  function recordHash(hex) {
    recentHashes.push({ hex, ts: Date.now() });
    while (recentHashes.length > RECENT_HASH_CAP) recentHashes.shift();
  }

  function findDupe(hex) {
    for (let i = recentHashes.length - 1; i >= 0; i--) {
      const d = hamming(hex, recentHashes[i].hex);
      if (d <= DUPE_DISTANCE) return { hex: recentHashes[i].hex, distance: d };
    }
    return null;
  }

  // ── public API ─────────────────────────────────────────────────────
  async function check(file, opts = {}) {
    const skipDupe = !!opts.skipDupe;

    const details = {
      width: null, height: null,
      blurScore: null,
      phash: null,
      dupOfHash: null,
    };
    const reasons = [];

    let bitmap;
    try {
      bitmap = await loadBitmap(file);
    } catch (e) {
      return { ok: false, reasons: ['unreadable'], details };
    }
    details.width  = bitmap.width;
    details.height = bitmap.height;

    // Gate 1: low-res
    const shortEdge = Math.min(bitmap.width, bitmap.height);
    if (shortEdge < MIN_SHORT_EDGE) {
      reasons.push('low_resolution');
    }

    // Gate 2: blur (only if resolution is high enough to be worth measuring)
    if (shortEdge >= 200) {
      try {
        details.blurScore = Math.round(blurScore(bitmap));
        if (details.blurScore < BLUR_THRESHOLD) {
          reasons.push('blurry');
        }
      } catch (e) {
        // Blur check failure is non-fatal; just log and continue.
        console.warn('[photo-qc] blur check failed', e);
      }
    }

    // Gate 3: dupe (unless caller opted out — e.g. user pressed "scan again")
    // 2026-08-21: hash the CROPPED card region, not the whole frame,
    // so the desk / hand / keyboard background can't dominate the hash.
    try {
      let hashSource = bitmap;
      try {
        const detect = window.CardResellFastPath && window.CardResellFastPath.detectCardBounds;
        if (detect && bitmap && bitmap.width && bitmap.height) {
          const fc = document.createElement('canvas');
          fc.width = bitmap.width; fc.height = bitmap.height;
          fc.getContext('2d').drawImage(bitmap, 0, 0);
          const imgData = fc.getContext('2d').getImageData(0, 0, fc.width, fc.height).data;
          const bounds = detect(imgData, fc.width, fc.height);
          if (bounds) {
            const ratio = (bounds.w * bounds.h) / (fc.width * fc.height);
            const aspect = bounds.h > 0 ? bounds.w / bounds.h : 0;
            if (ratio >= 0.25 && ((aspect >= 0.55 && aspect <= 0.85) || (aspect >= 1.15 && aspect <= 1.80))) {
              const cc = document.createElement('canvas');
              cc.width = bounds.w; cc.height = bounds.h;
              cc.getContext('2d').drawImage(fc, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
              hashSource = cc;
            }
          }
        }
      } catch(_) {}
      details.phash = dHash(hashSource);
      if (!skipDupe) {
        const dup = findDupe(details.phash);
        if (dup) {
          details.dupOfHash = dup.hex;
          reasons.push('duplicate');
        }
      }
      // Record AFTER dupe check so we don't dupe against ourselves.
      recordHash(details.phash);
    } catch (e) {
      console.warn('[photo-qc] phash failed', e);
    }

    // Release bitmap memory eagerly on browsers that support close()
    if (bitmap && typeof bitmap.close === 'function') {
      try { bitmap.close(); } catch(_) {}
    }

    return { ok: reasons.length === 0, reasons, details };
  }

  function reset() { recentHashes.length = 0; }

  window.CardResellPhotoQC = { check, reset, MIN_SHORT_EDGE, BLUR_THRESHOLD, DUPE_DISTANCE };
})();
