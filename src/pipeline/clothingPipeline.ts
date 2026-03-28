/**
 * Multi-step clothing image processing pipeline.
 *
 * PRIMARY: Grounded SAM (detection + segmentation in one call)
 * FALLBACK 1: Grounding DINO → crop → rembg (if Grounded SAM fails)
 * FALLBACK 2: Claude Vision only (if no Replicate key)
 *
 * After segmentation, each item is classified with Claude Vision.
 */

import type { DetectedItem, BoundingBox } from '../types';
import { hasReplicateKey } from '../apiHelper';
import { detectAndSegment } from './groundedSamDetect';
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
  const nx = x1 / imgWidth;
  const ny = y1 / imgHeight;
  const nw = (x2 - x1) / imgWidth;
  const nh = (y2 - y1) / imgHeight;
  const px = Math.max(0, nx - padding);
  const py = Math.max(0, ny - padding);
  const pw = Math.min(1 - px, nw + padding * 2);
  const ph = Math.min(1 - py, nh + padding * 2);
  return { x: px, y: py, width: pw, height: ph };
}

/**
 * Main entry point: process a clothing image through the multi-step pipeline.
 */
export async function processClothingImage(
  base64Image: string,
  mimeType: string,
  originalObjectUrl: string,
): Promise<PipelineResult> {
  const totalStart = performance.now();
  const hasReplicate = hasReplicateKey();

  // ── NO REPLICATE → Claude-only ──────────────────────────────────────────
  if (!hasReplicate) {
    console.log('[Pipeline] No Replicate API key — falling back to Claude-only detection');
    return fallbackClaudeOnly(base64Image, mimeType, originalObjectUrl, totalStart);
  }

  // ── PRIMARY: Grounded SAM (detection + segmentation) ────────────────────
  try {
    return await groundedSamPipeline(base64Image, originalObjectUrl, totalStart);
  } catch (err) {
    console.warn('[Pipeline] Grounded SAM failed, trying DINO + rembg fallback:', err);
  }

  // ── FALLBACK 1: Grounding DINO → crop → rembg ──────────────────────────
  try {
    return await dinoPipeline(base64Image, mimeType, originalObjectUrl, totalStart);
  } catch (err) {
    console.warn('[Pipeline] DINO pipeline also failed, using Claude-only:', err);
  }

  // ── FALLBACK 2: Claude Vision only ─────────────────────────────────────
  return fallbackClaudeOnly(base64Image, mimeType, originalObjectUrl, totalStart);
}

// ── Grounded SAM pipeline ────────────────────────────────────────────────────

async function groundedSamPipeline(
  base64Image: string,
  originalObjectUrl: string,
  totalStart: number,
): Promise<PipelineResult> {
  const detectionStart = performance.now();
  const samResults = await detectAndSegment(base64Image);
  const detectionMs = performance.now() - detectionStart;

  if (samResults.length === 0) {
    throw new Error('Grounded SAM detected 0 items');
  }

  console.log(`[Pipeline] Grounded SAM: ${samResults.length} items in ${Math.round(detectionMs)}ms`);

  // Classify each segmented item in parallel
  const classStart = performance.now();
  const classPromises = samResults.map(async (seg) => {
    try {
      return await classifyClothingItem(seg.segmentedBase64, seg.label);
    } catch (err) {
      console.error(`[Pipeline] Classification failed for "${seg.label}":`, err);
      return null;
    }
  });
  const classifications = await Promise.all(classPromises);
  const classMs = performance.now() - classStart;

  // Assemble results
  const items: DetectedItem[] = [];
  for (let i = 0; i < samResults.length; i++) {
    const cls = classifications[i];
    if (!cls) continue;

    items.push({
      tempId: genId(),
      croppedImageUrl: samResults[i].segmentedBase64,
      originalImageUrl: originalObjectUrl,
      category: cls.category,
      categoryConfidence: cls.categoryConfidence,
      subcategory: cls.subcategory,
      subcategoryConfidence: cls.subcategoryConfidence,
      color: cls.color,
      colorConfidence: cls.colorConfidence,
      brand: cls.brand,
      brandConfidence: cls.brandConfidence,
      pattern: cls.pattern,
      fit: cls.fit,
      tags: cls.tags,
      boundingBox: samResults[i].boundingBox,
    });
  }

  const totalMs = performance.now() - totalStart;
  console.log(
    `[Pipeline] Grounded SAM complete: ${items.length} items | ` +
    `detection+seg=${Math.round(detectionMs)}ms, classification=${Math.round(classMs)}ms, total=${Math.round(totalMs)}ms`,
  );

  return {
    items,
    timing: {
      detection_ms: Math.round(detectionMs),
      crop_ms: 0, // Segmentation is included in detection_ms
      classification_ms: Math.round(classMs),
      total_ms: Math.round(totalMs),
    },
  };
}

// ── DINO + rembg fallback pipeline ───────────────────────────────────────────

async function dinoPipeline(
  base64Image: string,
  _mimeType: string,
  originalObjectUrl: string,
  totalStart: number,
): Promise<PipelineResult> {
  // Step 1: Detection with Grounding DINO
  const detectionStart = performance.now();
  const dinoBoxes: GroundingDINOBox[] = await detectWithGroundingDINO(base64Image);
  const detectionMs = performance.now() - detectionStart;

  if (dinoBoxes.length === 0) {
    throw new Error('Grounding DINO detected 0 items');
  }

  console.log(`[Pipeline] DINO detected ${dinoBoxes.length} items in ${Math.round(detectionMs)}ms`);

  // Step 2: Crop each detected item
  const cropStart = performance.now();
  const imgDims = await getImageDimensions(originalObjectUrl);
  const croppedItems: Array<{
    croppedBase64: string;
    boundingBox: BoundingBox;
    dinoLabel: string;
  }> = [];

  for (const box of dinoBoxes) {
    const normalizedBox = dinoBoxToNormalized(box, imgDims.width, imgDims.height);
    let croppedBase64: string;
    try {
      croppedBase64 = await cropImage(originalObjectUrl, normalizedBox, 0);
    } catch {
      croppedBase64 = `data:image/jpeg;base64,${base64Image}`;
    }
    croppedItems.push({ croppedBase64, boundingBox: normalizedBox, dinoLabel: box.label });
  }
  const cropMs = performance.now() - cropStart;

  // Step 3: Remove backgrounds + classify in parallel
  const classStart = performance.now();
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
  const results = await Promise.all(processingPromises);
  const classMs = performance.now() - classStart;

  // Assemble
  const items: DetectedItem[] = [];
  for (let i = 0; i < croppedItems.length; i++) {
    const { noBgImage, classification } = results[i];
    if (!classification) continue;

    items.push({
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
      boundingBox: croppedItems[i].boundingBox,
    });
  }

  const totalMs = performance.now() - totalStart;
  console.log(
    `[Pipeline] DINO+rembg complete: ${items.length} items | ` +
    `detection=${Math.round(detectionMs)}ms, crop=${Math.round(cropMs)}ms, ` +
    `classification=${Math.round(classMs)}ms, total=${Math.round(totalMs)}ms`,
  );

  return {
    items,
    timing: {
      detection_ms: Math.round(detectionMs),
      crop_ms: Math.round(cropMs),
      classification_ms: Math.round(classMs),
      total_ms: Math.round(totalMs),
    },
  };
}

// ── Claude-only fallback ─────────────────────────────────────────────────────

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

    // Remove background from cropped image
    const croppedFallback = croppedImageUrl;
    try {
      const noBg = await removeBackground(croppedImageUrl);
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
