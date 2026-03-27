/**
 * Multi-step clothing image processing pipeline.
 *
 * Step 1: Grounding DINO (via Replicate) — detect bounding boxes
 * Step 2: Canvas crop — extract each item with padding
 * Step 3: Claude Vision — classify each cropped item individually
 * Step 4: Assemble — combine into DetectedItem[] for MultiItemReview
 *
 * Falls back to the existing single-call Claude detection when Replicate
 * API key is not configured.
 */

import type { DetectedItem, BoundingBox } from '../types';
import { hasReplicateKey } from '../apiHelper';
import { detectWithGroundingDINO } from './replicateDetect';
import type { GroundingDINOBox } from './replicateDetect';
import { classifyClothingItem } from './classifyItem';
import { cropImage } from '../utils/cropImage';
import { removeBackground } from '../utils/removeBackground';
import { detectClothingItems } from '../api';
import type { RawDetection } from '../api';
import { genId } from '../store';

export interface PipelineResult {
  items: DetectedItem[];
  timing: {
    detection_ms: number;
    crop_ms: number;
    classification_ms: number;
    total_ms: number;
  };
}

/**
 * Get image natural dimensions from a data URI or object URL.
 */
function getImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to load image for dimensions'));
    img.src = src;
  });
}

/**
 * Convert Grounding DINO pixel-coordinate bounding boxes to normalised 0-1 BoundingBox format
 * with 8% padding.
 */
function dinoBoxToNormalized(
  box: GroundingDINOBox,
  imgWidth: number,
  imgHeight: number,
  padding = 0.08,
): BoundingBox {
  const [x1, y1, x2, y2] = box.bbox;

  // Normalise pixel coords to 0-1
  const nx = x1 / imgWidth;
  const ny = y1 / imgHeight;
  const nw = (x2 - x1) / imgWidth;
  const nh = (y2 - y1) / imgHeight;

  // Add padding
  const px = Math.max(0, nx - padding);
  const py = Math.max(0, ny - padding);
  const pw = Math.min(1 - px, nw + padding * 2);
  const ph = Math.min(1 - py, nh + padding * 2);

  return { x: px, y: py, width: pw, height: ph };
}

/**
 * Main entry point: process a clothing image through the multi-step pipeline.
 *
 * @param base64Image - base64 data URI of the image
 * @param mimeType - MIME type of the image
 * @param originalObjectUrl - object URL for the original image (used for cropping on canvas)
 */
export async function processClothingImage(
  base64Image: string,
  mimeType: string,
  originalObjectUrl: string,
): Promise<PipelineResult> {
  const totalStart = performance.now();
  const hasReplicate = hasReplicateKey();

  // ── FALLBACK: Claude-only detection ───────────────────────────────────────
  if (!hasReplicate) {
    console.log('[Pipeline] No Replicate API key — falling back to Claude-only detection');
    return fallbackClaudeOnly(base64Image, mimeType, originalObjectUrl, totalStart);
  }

  // ── STEP 1: Detection with Grounding DINO ─────────────────────────────────
  let dinoBoxes: GroundingDINOBox[];
  const detectionStart = performance.now();
  try {
    dinoBoxes = await detectWithGroundingDINO(base64Image);
  } catch (err) {
    console.error('[Pipeline] Grounding DINO failed, falling back to Claude-only:', err);
    return fallbackClaudeOnly(base64Image, mimeType, originalObjectUrl, totalStart);
  }
  const detectionMs = performance.now() - detectionStart;

  if (dinoBoxes.length === 0) {
    console.warn('[Pipeline] Grounding DINO detected 0 items, falling back to Claude-only');
    return fallbackClaudeOnly(base64Image, mimeType, originalObjectUrl, totalStart);
  }

  console.log(`[Pipeline] Grounding DINO detected ${dinoBoxes.length} items in ${Math.round(detectionMs)}ms`);

  // ── STEP 2: Crop each detected item ───────────────────────────────────────
  const cropStart = performance.now();

  // Get image dimensions for normalising DINO boxes
  const imgDims = await getImageDimensions(originalObjectUrl);

  const croppedItems: Array<{
    croppedBase64: string;
    boundingBox: BoundingBox;
    dinoLabel: string;
    dinoConfidence: number;
  }> = [];

  for (const box of dinoBoxes) {
    const normalizedBox = dinoBoxToNormalized(box, imgDims.width, imgDims.height);
    let croppedBase64: string;
    try {
      // cropImage already adds its own padding, so pass 0 extra since we added 8% in dinoBoxToNormalized
      croppedBase64 = await cropImage(originalObjectUrl, normalizedBox, 0);
    } catch {
      // If cropping fails, use the full image
      croppedBase64 = base64Image;
    }
    croppedItems.push({
      croppedBase64,
      boundingBox: normalizedBox,
      dinoLabel: box.label,
      dinoConfidence: box.confidence,
    });
  }
  const cropMs = performance.now() - cropStart;

  // ── STEP 3: Remove backgrounds + Classify in parallel ──────────────────────
  const classificationStart = performance.now();

  // Run background removal and classification in parallel for each item
  const processingPromises = croppedItems.map(async (item) => {
    const [noBgImage, classification] = await Promise.all([
      removeBackground(item.croppedBase64).catch(() => item.croppedBase64),
      classifyClothingItem(item.croppedBase64, item.dinoLabel).catch(err => {
        console.error(`[Pipeline] Classification failed for "${item.dinoLabel}":`, err);
        return null;
      }),
    ]);
    return { noBgImage, classification };
  });
  const processingResults = await Promise.all(processingPromises);

  const classificationMs = performance.now() - classificationStart;

  // ── STEP 4: Assemble DetectedItem[] ───────────────────────────────────────
  const detectedItems: DetectedItem[] = [];

  for (let i = 0; i < croppedItems.length; i++) {
    const cropped = croppedItems[i];
    const { noBgImage, classification } = processingResults[i];

    if (!classification) continue; // skip items that failed classification

    detectedItems.push({
      tempId: genId(),
      croppedImageUrl: noBgImage,
      originalImageUrl: originalObjectUrl,
      category: classification.category,
      categoryConfidence: classification.categoryConfidence,
      subcategory: classification.subcategory,
      subcategoryConfidence: classification.subcategoryConfidence,
      color: classification.color,
      colorConfidence: classification.colorConfidence,
      brand: classification.brand,
      brandConfidence: classification.brandConfidence,
      pattern: classification.pattern,
      fit: classification.fit,
      tags: classification.tags,
      boundingBox: cropped.boundingBox,
    });
  }

  const totalMs = performance.now() - totalStart;

  console.log(
    `[Pipeline] Complete: ${detectedItems.length} items | ` +
    `detection=${Math.round(detectionMs)}ms, crop=${Math.round(cropMs)}ms, ` +
    `classification=${Math.round(classificationMs)}ms, total=${Math.round(totalMs)}ms`,
  );

  return {
    items: detectedItems,
    timing: {
      detection_ms: Math.round(detectionMs),
      crop_ms: Math.round(cropMs),
      classification_ms: Math.round(classificationMs),
      total_ms: Math.round(totalMs),
    },
  };
}

/**
 * Fallback: use the existing single-call Claude detection pipeline.
 */
async function fallbackClaudeOnly(
  base64Image: string,
  mimeType: string,
  originalObjectUrl: string,
  totalStart: number,
): Promise<PipelineResult> {
  const detectionStart = performance.now();
  const rawItems: RawDetection[] = await detectClothingItems(base64Image, mimeType);
  const detectionMs = performance.now() - detectionStart;

  const cropStart = performance.now();
  const detectedItems: DetectedItem[] = [];

  for (const raw of rawItems) {
    let croppedImageUrl = originalObjectUrl;
    try {
      croppedImageUrl = await cropImage(originalObjectUrl, raw.boundingBox);
    } catch {
      // fallback: use full photo
    }

    // Remove background from cropped image (keep original crop as fallback)
    const croppedFallback = croppedImageUrl;
    try {
      const noBg = await removeBackground(croppedImageUrl);
      // Only use bg-removed image if it's a valid data URI and not too small
      if (noBg && noBg.length > 100 && noBg !== croppedImageUrl) {
        croppedImageUrl = noBg;
      }
    } catch {
      croppedImageUrl = croppedFallback;
    }

    detectedItems.push({
      tempId: genId(),
      croppedImageUrl,
      originalImageUrl: originalObjectUrl,
      category: raw.category,
      categoryConfidence: raw.categoryConfidence,
      subcategory: raw.subcategory,
      subcategoryConfidence: raw.subcategoryConfidence,
      color: raw.color,
      colorConfidence: raw.colorConfidence,
      brand: raw.brand,
      brandConfidence: raw.brandConfidence,
      pattern: raw.pattern,
      fit: raw.fit,
      tags: raw.tags,
      boundingBox: raw.boundingBox,
    });
  }
  const cropMs = performance.now() - cropStart;
  const totalMs = performance.now() - totalStart;

  return {
    items: detectedItems,
    timing: {
      detection_ms: Math.round(detectionMs),
      crop_ms: Math.round(cropMs),
      classification_ms: 0,
      total_ms: Math.round(totalMs),
    },
  };
}
