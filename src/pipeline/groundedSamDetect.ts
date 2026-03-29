/**
 * Grounded SAM: detection + pixel-level segmentation in one Replicate call.
 * Combines Grounding DINO (text-based detection) with Meta SAM (mask generation).
 *
 * Returns per-item transparent-background images, bounding boxes, and a
 * segmentation_confidence score (0-1) used by the pipeline to decide whether
 * to trust SAM output or fall back to bounding-box detection.
 */

import { replicateCreate, replicatePoll } from '../apiHelper';
import type { BoundingBox } from '../types';

// schananas/grounded_sam on Replicate
const GROUNDED_SAM_VERSION =
  'ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c';

const MASK_PROMPT =
  'clothing, shirt, pants, shoes, jacket, dress, bag, hat, skirt, coat, sweater, jeans, boots, sneakers, blazer, cardigan, hoodie, shorts, sandals, scarf, belt';

const NEGATIVE_PROMPT = 'background, floor, wall, person, skin, body, face, hair, furniture';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 90; // 3 minutes max

const MAX_DIM = 800; // Max dimension for upload & processing

export interface GroundedSAMItem {
  segmentedBase64: string; // Transparent-background image (data URI)
  boundingBox: BoundingBox; // Normalised 0-1 box
  label: string;
}

/** Confidence metrics computed from the mask analysis */
export interface SegmentationQuality {
  /** Overall confidence 0-1: ≥0.7 = use SAM, 0.4-0.7 = partial, <0.4 = fallback */
  segmentation_confidence: number;
  /** Fraction of image pixels that are "clothing" in the mask (0-1) */
  maskCoverage: number;
  /** Number of distinct items produced */
  itemCount: number;
  /** Average mask edge sharpness (0-1): higher = cleaner edges */
  edgeSharpness: number;
  /** Whether the mask appears to cover the whole image (likely a bad mask) */
  maskCoversAll: boolean;
  /** Human-readable reason for the confidence level */
  reason: string;
}

export interface GroundedSAMResult {
  items: GroundedSAMItem[];
  quality: SegmentationQuality;
}

/**
 * Detect and segment clothing items using Grounded SAM.
 * Returns items + quality metrics for the confidence-based pipeline.
 */
export async function detectAndSegment(
  base64Image: string,
): Promise<GroundedSAMResult> {
  const dataUri = await compressForUpload(base64Image);
  console.log(`[GroundedSAM] Sending image (${Math.round(dataUri.length / 1024)}KB)`);

  const prediction = await replicateCreate({
    version: GROUNDED_SAM_VERSION,
    input: {
      image: dataUri,
      mask_prompt: MASK_PROMPT,
      negative_mask_prompt: NEGATIVE_PROMPT,
      adjustment_factor: 0,
    },
  });

  const pollUrl: string = (prediction.urls as Record<string, string>)?.get;
  if (!pollUrl) throw new Error('Grounded SAM: no poll URL in response');

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const result = await replicatePoll(pollUrl);

    if (result.status === 'failed' || result.status === 'canceled') {
      throw new Error(`Grounded SAM ${result.status}: ${result.error || 'unknown'}`);
    }

    if (result.status === 'succeeded') {
      console.log(`[GroundedSAM] Prediction succeeded after ${attempt + 1} polls (~${Math.round((attempt + 1) * POLL_INTERVAL_MS / 1000)}s)`);
      return processOutput(result.output, dataUri);
    }

    if (attempt > 0 && attempt % 10 === 0) {
      console.log(`[GroundedSAM] Still waiting... poll ${attempt}/${MAX_POLL_ATTEMPTS} (status: ${result.status})`);
    }
  }

  throw new Error('Grounded SAM: prediction timed out after 3 minutes');
}

// ── Output processing ──────────────────────────────────────────────────────────

/**
 * Process Grounded SAM output.
 * Output indices: [0] annotated, [1] neg annotated, [2] mask.jpg, [3] inverted mask
 */
async function processOutput(
  output: unknown,
  originalDataUri: string,
): Promise<GroundedSAMResult> {
  const emptyQuality: SegmentationQuality = {
    segmentation_confidence: 0,
    maskCoverage: 0,
    itemCount: 0,
    edgeSharpness: 0,
    maskCoversAll: false,
    reason: 'No output from model',
  };

  if (!output || !Array.isArray(output) || output.length === 0) {
    console.warn('[GroundedSAM] Empty output');
    return { items: [], quality: emptyQuality };
  }

  const outputUrls = output as string[];
  console.log(`[GroundedSAM] Got ${outputUrls.length} output images`);

  const maskUrl = outputUrls.length >= 3 ? outputUrls[2] : outputUrls[outputUrls.length - 1];

  try {
    const [originalImg, maskImg] = await Promise.all([
      loadImage(originalDataUri),
      fetchAndLoadImage(maskUrl),
    ]);

    const width = originalImg.naturalWidth;
    const height = originalImg.naturalHeight;
    console.log(`[GroundedSAM] Processing ${width}×${height} image, mask ${maskImg.naturalWidth}×${maskImg.naturalHeight}`);

    // Analyse mask quality FIRST (on tiny thumbnail — ~40KB)
    const maskAnalysis = analyseMask(maskImg, width, height);

    // Apply mask compositing
    const segmentedBase64 = applyMaskCompositing(originalImg, maskImg, width, height);

    if (!segmentedBase64) {
      return {
        items: [],
        quality: { ...emptyQuality, reason: 'Canvas compositing failed' },
      };
    }

    // Find bounding box & split into items
    const boundingBox = maskAnalysis.boundingBox;
    const items = splitIntoItems(segmentedBase64, boundingBox, originalImg, maskImg, width, height);

    // Compute final confidence
    const quality = computeConfidence(maskAnalysis, items.length);

    console.log(
      `[GroundedSAM] Produced ${items.length} items | ` +
      `confidence=${quality.segmentation_confidence.toFixed(2)}, ` +
      `coverage=${(quality.maskCoverage * 100).toFixed(1)}%, ` +
      `sharpness=${quality.edgeSharpness.toFixed(2)} | ${quality.reason}`,
    );

    return { items, quality };
  } catch (err) {
    console.error('[GroundedSAM] Failed to process mask:', err);
    return { items: [], quality: { ...emptyQuality, reason: `Processing error: ${err}` } };
  }
}

// ── Mask analysis (confidence scoring) ──────────────────────────────────────────

interface MaskAnalysis {
  /** Fraction of pixels that are "clothing" (0-1) */
  coverage: number;
  /** Edge sharpness: ratio of pixels that are clearly white or black vs gray (0-1) */
  sharpness: number;
  /** Whether the mask appears inverted */
  inverted: boolean;
  /** Avg brightness of mask */
  avgBrightness: number;
  /** Bounding box of the clothing region */
  boundingBox: BoundingBox;
  /** Whether mask covers >90% of the image */
  coversAll: boolean;
}

/**
 * Analyse the binary mask on a 100×100 thumbnail to assess quality.
 * Only ~40KB of memory used.
 */
function analyseMask(maskImg: HTMLImageElement, _imgW: number, _imgH: number): MaskAnalysis {
  const S = 100;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(maskImg, 0, 0, S, S);
  const data = ctx.getImageData(0, 0, S, S);
  canvas.width = 0; canvas.height = 0;

  const totalPix = S * S;
  let brightSum = 0;
  let clothingPixels = 0;
  let sharpPixels = 0; // pixels that are clearly black (<30) or white (>225)
  let minX = S, minY = S, maxX = 0, maxY = 0;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const val = data.data[(y * S + x) * 4];
      brightSum += val;
      // Count sharp (non-gray) pixels
      if (val < 30 || val > 225) sharpPixels++;
    }
  }

  const avgBrightness = brightSum / totalPix;
  const inverted = avgBrightness > 180;

  // Second pass: count clothing pixels and find bounding box
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const val = data.data[(y * S + x) * 4];
      const isClothing = inverted ? val < 128 : val > 128;
      if (isClothing) {
        clothingPixels++;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  const coverage = clothingPixels / totalPix;
  const sharpness = sharpPixels / totalPix;
  const coversAll = coverage > 0.90;

  const boundingBox: BoundingBox = (maxX > minX && maxY > minY)
    ? { x: minX / S, y: minY / S, width: (maxX - minX) / S, height: (maxY - minY) / S }
    : { x: 0, y: 0, width: 1, height: 1 };

  return { coverage, sharpness, inverted, avgBrightness, boundingBox, coversAll };
}

/**
 * Compute overall segmentation confidence from mask analysis + item count.
 *
 * Scoring rubric:
 * - Good mask coverage (5-80%):         +0.25
 * - Sharp edges (>70% of pixels):       +0.25
 * - Reasonable item count (1-6):         +0.25
 * - Mask doesn't cover everything:       +0.15
 * - Mask has some clothing (>2%):        +0.10
 *
 * Penalties:
 * - Mask covers >90% of image:           -0.30 (likely failed to segment)
 * - Coverage <2% (nothing detected):     -0.40
 * - Coverage >80% (too much):            -0.20
 * - Fuzzy edges (<50% sharp):            -0.15
 * - 0 items produced:                    → confidence = 0
 */
function computeConfidence(analysis: MaskAnalysis, itemCount: number): SegmentationQuality {
  if (itemCount === 0) {
    return {
      segmentation_confidence: 0,
      maskCoverage: analysis.coverage,
      itemCount: 0,
      edgeSharpness: analysis.sharpness,
      maskCoversAll: analysis.coversAll,
      reason: 'No items extracted from mask',
    };
  }

  let score = 0;
  const reasons: string[] = [];

  // Coverage scoring
  if (analysis.coverage >= 0.05 && analysis.coverage <= 0.80) {
    score += 0.25;
    reasons.push(`good coverage ${(analysis.coverage * 100).toFixed(0)}%`);
  } else if (analysis.coverage < 0.02) {
    score -= 0.40;
    reasons.push(`very low coverage ${(analysis.coverage * 100).toFixed(1)}%`);
  } else if (analysis.coverage > 0.80) {
    score += 0.05;
    reasons.push(`high coverage ${(analysis.coverage * 100).toFixed(0)}%`);
  } else {
    // 2-5% — borderline
    score += 0.10;
    reasons.push(`low coverage ${(analysis.coverage * 100).toFixed(1)}%`);
  }

  // Edge sharpness
  if (analysis.sharpness > 0.70) {
    score += 0.25;
    reasons.push('sharp edges');
  } else if (analysis.sharpness > 0.50) {
    score += 0.15;
    reasons.push('moderate edges');
  } else {
    score += 0.05;
    reasons.push('fuzzy edges');
  }

  // Item count
  if (itemCount >= 1 && itemCount <= 6) {
    score += 0.25;
    reasons.push(`${itemCount} items`);
  } else if (itemCount > 6) {
    score += 0.10;
    reasons.push(`many items (${itemCount})`);
  }

  // Full-image coverage penalty
  if (analysis.coversAll) {
    score -= 0.30;
    reasons.push('PENALTY: mask covers entire image');
  } else {
    score += 0.15;
    reasons.push('mask has clear boundaries');
  }

  // Minimum clothing presence
  if (analysis.coverage > 0.02) {
    score += 0.10;
    reasons.push('clothing detected');
  }

  // Clamp to 0-1
  const segmentation_confidence = Math.max(0, Math.min(1, score));

  return {
    segmentation_confidence,
    maskCoverage: analysis.coverage,
    itemCount,
    edgeSharpness: analysis.sharpness,
    maskCoversAll: analysis.coversAll,
    reason: reasons.join(', '),
  };
}

// ── Mask compositing ────────────────────────────────────────────────────────────

/**
 * Apply mask to original image using a single getImageData on the mask canvas.
 * The mask is a JPEG (white=clothing, black=background) so we convert
 * brightness → alpha, then use 'destination-in' compositing.
 *
 * Memory: one getImageData on 800×800 = ~2.5MB — safe on all devices.
 */
function applyMaskCompositing(
  originalImg: HTMLImageElement,
  maskImg: HTMLImageElement,
  width: number,
  height: number,
): string | null {
  // Step 1: Draw mask and convert brightness → alpha
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return null;

  maskCtx.drawImage(maskImg, 0, 0, width, height);
  const maskData = maskCtx.getImageData(0, 0, width, height); // ~2.5MB for 800×800

  // Check if mask is inverted (mostly white = background is white)
  let brightSum = 0;
  const pixCount = width * height;
  for (let i = 0; i < maskData.data.length; i += 4) {
    brightSum += maskData.data[i];
  }
  const avgBrightness = Math.round(brightSum / pixCount);
  const inverted = avgBrightness > 180;
  console.log(`[GroundedSAM] Mask avg brightness: ${avgBrightness}, inverted: ${inverted}`);

  // Convert: set RGB to white, alpha = brightness (or inverted)
  for (let i = 0; i < maskData.data.length; i += 4) {
    const brightness = maskData.data[i];
    maskData.data[i] = 255;     // R
    maskData.data[i + 1] = 255; // G
    maskData.data[i + 2] = 255; // B
    maskData.data[i + 3] = inverted ? (255 - brightness) : brightness; // Alpha
  }
  maskCtx.putImageData(maskData, 0, 0);

  // Step 2: Draw original, then apply alpha mask with 'destination-in'
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(originalImg, 0, 0, width, height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  maskCanvas.width = 0; maskCanvas.height = 0; // release mask canvas

  const result = canvas.toDataURL('image/png');
  canvas.width = 0; canvas.height = 0; // release
  console.log(`[GroundedSAM] Composited image: ${Math.round(result.length / 1024)}KB`);

  return result;
}

// ── Item splitting ──────────────────────────────────────────────────────────────

/**
 * If the masked region is tall (>60% of image), split into top and bottom halves.
 * This handles full-body photos where shirt + pants are one continuous mask.
 */
function splitIntoItems(
  fullSegmentedBase64: string,
  bbox: BoundingBox,
  originalImg: HTMLImageElement,
  maskImg: HTMLImageElement,
  width: number,
  height: number,
): GroundedSAMItem[] {
  // If bounding box covers <60% of height, return as single item
  if (bbox.height < 0.6) {
    return [{
      segmentedBase64: fullSegmentedBase64,
      boundingBox: bbox,
      label: 'clothing_0',
    }];
  }

  // Split into top and bottom halves at the midpoint of the bounding box
  const midY = bbox.y + bbox.height / 2;
  const items: GroundedSAMItem[] = [];

  const topBase64 = cropSegmented(originalImg, maskImg, width, height, {
    x: bbox.x, y: bbox.y,
    width: bbox.width, height: midY - bbox.y,
  });
  if (topBase64) {
    items.push({
      segmentedBase64: topBase64,
      boundingBox: { x: bbox.x, y: bbox.y, width: bbox.width, height: midY - bbox.y },
      label: 'clothing_top',
    });
  }

  const bottomBase64 = cropSegmented(originalImg, maskImg, width, height, {
    x: bbox.x, y: midY,
    width: bbox.width, height: bbox.y + bbox.height - midY,
  });
  if (bottomBase64) {
    items.push({
      segmentedBase64: bottomBase64,
      boundingBox: { x: bbox.x, y: midY, width: bbox.width, height: bbox.y + bbox.height - midY },
      label: 'clothing_bottom',
    });
  }

  if (items.length === 0) {
    items.push({
      segmentedBase64: fullSegmentedBase64,
      boundingBox: bbox,
      label: 'clothing_0',
    });
  }

  return items;
}

/**
 * Crop a region from the masked image.
 * Draws mask region, converts brightness→alpha, then composites with original.
 */
function cropSegmented(
  originalImg: HTMLImageElement,
  maskImg: HTMLImageElement,
  width: number,
  height: number,
  region: BoundingBox,
): string | null {
  const px = Math.floor(region.x * width);
  const py = Math.floor(region.y * height);
  const pw = Math.ceil(region.width * width);
  const ph = Math.ceil(region.height * height);

  if (pw < 10 || ph < 10) return null;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = pw;
  maskCanvas.height = ph;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return null;

  maskCtx.drawImage(maskImg, px, py, pw, ph, 0, 0, pw, ph);
  const maskData = maskCtx.getImageData(0, 0, pw, ph);

  let brightSum = 0;
  const pixCount = pw * ph;
  for (let i = 0; i < maskData.data.length; i += 4) brightSum += maskData.data[i];
  const inverted = (brightSum / pixCount) > 180;

  for (let i = 0; i < maskData.data.length; i += 4) {
    const brightness = maskData.data[i];
    maskData.data[i] = 255;
    maskData.data[i + 1] = 255;
    maskData.data[i + 2] = 255;
    maskData.data[i + 3] = inverted ? (255 - brightness) : brightness;
  }
  maskCtx.putImageData(maskData, 0, 0);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = pw;
  outCanvas.height = ph;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) return null;

  outCtx.drawImage(originalImg, px, py, pw, ph, 0, 0, pw, ph);
  outCtx.globalCompositeOperation = 'destination-in';
  outCtx.drawImage(maskCanvas, 0, 0);
  outCtx.globalCompositeOperation = 'source-over';

  maskCanvas.width = 0; maskCanvas.height = 0;

  const result = outCanvas.toDataURL('image/png');
  outCanvas.width = 0; outCanvas.height = 0;

  return result;
}

// ── Utility helpers ──────────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (src.startsWith('http')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image (${src.substring(0, 60)}...)`));
    img.src = src;
  });
}

/** Fetch a URL as blob, convert to object URL, then load as HTMLImageElement */
async function fetchAndLoadImage(url: string): Promise<HTMLImageElement> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

/**
 * Ensure image is a proper data URI and compress if still too large.
 */
async function compressForUpload(base64Image: string): Promise<string> {
  const dataUri = base64Image.startsWith('data:')
    ? base64Image
    : `data:image/jpeg;base64,${base64Image}`;

  if (dataUri.length < 600_000) return dataUri;

  console.log(`[GroundedSAM] Image still large (${Math.round(dataUri.length / 1024)}KB), compressing...`);
  const img = await loadImage(dataUri);

  let { naturalWidth: w, naturalHeight: h } = img;
  if (w > MAX_DIM || h > MAX_DIM) {
    const scale = MAX_DIM / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot create canvas for compression');
  ctx.drawImage(img, 0, 0, w, h);

  // Preserve transparency: use PNG if source is PNG (e.g. after background removal)
  const isPng = dataUri.startsWith('data:image/png');
  const result = isPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.75);
  canvas.width = 0; canvas.height = 0;
  console.log(`[GroundedSAM] Compressed to ${Math.round(result.length / 1024)}KB (${w}×${h}, ${isPng ? 'PNG' : 'JPEG'})`);
  return result;
}
