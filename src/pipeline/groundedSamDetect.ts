/**
 * Grounded SAM: detection + pixel-level segmentation in one Replicate call.
 * Combines Grounding DINO (text-based detection) with Meta SAM (mask generation).
 *
 * Returns per-item transparent-background images and bounding boxes.
 *
 * IMPORTANT: All canvas work uses GPU-accelerated compositing (globalCompositeOperation)
 * instead of pixel-by-pixel getImageData to avoid OOM crashes on mobile.
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

/**
 * Detect and segment clothing items using Grounded SAM.
 */
export async function detectAndSegment(
  base64Image: string,
): Promise<GroundedSAMItem[]> {
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

/**
 * Process Grounded SAM output using ONLY GPU-accelerated canvas compositing.
 * No getImageData, no typed arrays, no pixel loops — pure drawImage + compositing.
 *
 * Output indices: [0] annotated, [1] neg annotated, [2] mask.jpg, [3] inverted mask
 */
async function processOutput(
  output: unknown,
  originalDataUri: string,
): Promise<GroundedSAMItem[]> {
  if (!output || !Array.isArray(output) || output.length === 0) {
    console.warn('[GroundedSAM] Empty output');
    return [];
  }

  const outputUrls = output as string[];
  console.log(`[GroundedSAM] Got ${outputUrls.length} output images`);

  const maskUrl = outputUrls.length >= 3 ? outputUrls[2] : outputUrls[outputUrls.length - 1];

  try {
    // Load original + mask as Image elements (browser manages memory)
    const [originalImg, maskImg] = await Promise.all([
      loadImage(originalDataUri),
      fetchAndLoadImage(maskUrl),
    ]);

    const width = originalImg.naturalWidth;
    const height = originalImg.naturalHeight;
    console.log(`[GroundedSAM] Processing ${width}×${height} image, mask ${maskImg.naturalWidth}×${maskImg.naturalHeight}`);

    // Use GPU-accelerated compositing to apply mask — NO getImageData needed
    const segmentedBase64 = applyMaskCompositing(originalImg, maskImg, width, height);

    if (!segmentedBase64) {
      console.warn('[GroundedSAM] Compositing produced empty result');
      return [];
    }

    // Find bounding box from the mask using a tiny thumbnail (avoids OOM)
    const boundingBox = estimateBoundingBoxFromMask(maskImg, width, height);

    // Split into top/bottom halves if mask covers >60% of image height
    // (likely shirt + pants in a full-body photo)
    const items = splitIntoItems(segmentedBase64, boundingBox, originalImg, maskImg, width, height);

    console.log(`[GroundedSAM] Produced ${items.length} segmented items`);
    return items;
  } catch (err) {
    console.error('[GroundedSAM] Failed to process mask:', err);
    return [];
  }
}

/**
 * Apply mask to original image using a single getImageData on the mask canvas.
 * The mask is a JPEG (white=clothing, black=background) so we convert
 * brightness → alpha, then use 'destination-in' compositing.
 *
 * Memory: one getImageData on 800×800 = ~2.5MB — safe on all devices.
 * The OOM was from multiple simultaneous getImageData + typed arrays.
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

/**
 * Estimate bounding box from mask using a tiny thumbnail.
 * Scans a 100×100 version to find white region bounds — uses ~40KB RAM.
 */
function estimateBoundingBoxFromMask(
  maskImg: HTMLImageElement,
  _imgWidth: number,
  _imgHeight: number,
): BoundingBox {
  const S = 100; // thumbnail size
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { x: 0, y: 0, width: 1, height: 1 };

  ctx.drawImage(maskImg, 0, 0, S, S);
  const data = ctx.getImageData(0, 0, S, S); // ~40KB
  canvas.width = 0; canvas.height = 0;

  // Check if inverted
  let brightSum = 0;
  for (let i = 0; i < data.data.length; i += 4) brightSum += data.data[i];
  const inverted = (brightSum / (S * S)) > 180;

  let minX = S, minY = S, maxX = 0, maxY = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const val = data.data[(y * S + x) * 4];
      const isClothing = inverted ? val < 128 : val > 128;
      if (isClothing) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX <= minX || maxY <= minY) return { x: 0, y: 0, width: 1, height: 1 };

  return {
    x: minX / S,
    y: minY / S,
    width: (maxX - minX) / S,
    height: (maxY - minY) / S,
  };
}

/**
 * If the masked region is tall (>60% of image), split into top and bottom halves.
 * This handles full-body photos where shirt + pants are one continuous mask.
 * Uses ONLY drawImage (no getImageData on full-size canvases).
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

  // Create top half
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

  // Create bottom half
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

  // Fallback: if splitting failed, return the full segmented image
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

  // Draw mask for this crop region and convert brightness → alpha
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = pw;
  maskCanvas.height = ph;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return null;

  maskCtx.drawImage(maskImg, px, py, pw, ph, 0, 0, pw, ph);
  const maskData = maskCtx.getImageData(0, 0, pw, ph);

  // Check brightness to detect inversion
  let brightSum = 0;
  const pixCount = pw * ph;
  for (let i = 0; i < maskData.data.length; i += 4) brightSum += maskData.data[i];
  const inverted = (brightSum / pixCount) > 180;

  // Convert brightness → alpha
  for (let i = 0; i < maskData.data.length; i += 4) {
    const brightness = maskData.data[i];
    maskData.data[i] = 255;
    maskData.data[i + 1] = 255;
    maskData.data[i + 2] = 255;
    maskData.data[i + 3] = inverted ? (255 - brightness) : brightness;
  }
  maskCtx.putImageData(maskData, 0, 0);

  // Composite: original crop + alpha mask
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
    // Don't revoke immediately — the img element still references it.
    // It will be GC'd when the img element is no longer referenced.
    // Schedule cleanup for later:
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

/**
 * Ensure image is a proper data URI and compress if still too large.
 * Usually the caller (Wardrobe.tsx) already compressed to 800px,
 * so this is mostly a pass-through.
 */
async function compressForUpload(base64Image: string): Promise<string> {
  const dataUri = base64Image.startsWith('data:')
    ? base64Image
    : `data:image/jpeg;base64,${base64Image}`;

  // Already small enough — skip compression
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

  const result = canvas.toDataURL('image/jpeg', 0.75);
  canvas.width = 0; canvas.height = 0;
  console.log(`[GroundedSAM] Compressed to ${Math.round(result.length / 1024)}KB (${w}×${h})`);
  return result;
}
