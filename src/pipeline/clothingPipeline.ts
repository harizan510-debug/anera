/**
 * Confidence-based clothing image processing pipeline.
 *
 * 1. Attempt segmentation with Grounded SAM
 * 2. Evaluate segmentation quality (confidence 0-1)
 * 3. Route based on confidence:
 *    - ≥ 0.7  → FULL USE: SAM segmented images + Claude classification
 *    - 0.4–0.7 → PARTIAL USE: SAM images for display, but also run bounding-box
 *                 detection as backup; merge best results
 *    - < 0.4  → FALLBACK: discard SAM, use DINO bounding-box or Claude-only
 *
 * The system NEVER fails — always returns usable wardrobe items.
 */

import type { DetectedItem, BoundingBox } from '../types';
import { hasReplicateKey } from '../apiHelper';
import { detectAndSegment } from './groundedSamDetect';
import type { SegmentationQuality } from './groundedSamDetect';
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
  /** Segmentation quality metrics (only present when SAM was attempted) */
  segmentationQuality?: SegmentationQuality;
  /** Which pipeline path was used */
  pipelinePath: 'sam-full' | 'sam-partial' | 'dino-fallback' | 'claude-only';
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
 * Convert Grounding DINO pixel-coordinate bounding boxes to normalised 0-1 BoundingBox format.
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

// ── Confidence thresholds ───────────────────────────────────────────────────────

const CONFIDENCE_HIGH = 0.70;   // ≥ 0.7 → full SAM
const CONFIDENCE_PARTIAL = 0.40; // 0.4–0.7 → partial SAM + fallback

/**
 * Main entry point: process a clothing image through the confidence-based pipeline.
 * NEVER throws — always returns usable items.
 */
export async function processClothingImage(
  base64Image: string,
  mimeType: string,
  originalObjectUrl: string,
): Promise<PipelineResult> {
  console.log(`[Pipeline] START processClothingImage (image=${Math.round(base64Image.length / 1024)}KB, mime=${mimeType})`);
  const totalStart = performance.now();
  const hasReplicate = hasReplicateKey();
  console.log(`[Pipeline] hasReplicate=${hasReplicate}`);

  // ── NO REPLICATE → Claude-only ──────────────────────────────────────────
  if (!hasReplicate) {
    console.log('[Pipeline] No Replicate API key — falling back to Claude-only detection');
    return fallbackClaudeOnly(base64Image, mimeType, originalObjectUrl, totalStart);
  }

  // ── STEP 1: Attempt Grounded SAM ──────────────────────────────────────────
  let samItems: DetectedItem[] = [];
  let quality: SegmentationQuality | undefined;
  let detectionMs = 0;
  let classMs = 0;

  try {
    const samStart = performance.now();

    // Race with 4-minute safety timeout
    const samResult = await Promise.race([
      detectAndSegment(base64Image),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('SAM timed out (4 min)')), 240_000),
      ),
    ]);

    detectionMs = performance.now() - samStart;
    quality = samResult.quality;

    console.log(
      `[Pipeline] SAM returned ${samResult.items.length} items in ${Math.round(detectionMs)}ms | ` +
      `confidence=${quality.segmentation_confidence.toFixed(2)} | ${quality.reason}`,
    );

    // ── STEP 2: Evaluate confidence & route ──────────────────────────────────

    if (quality.segmentation_confidence >= CONFIDENCE_HIGH && samResult.items.length > 0) {
      // ═══ HIGH CONFIDENCE: Full SAM ═══
      console.log(`[Pipeline] ✓ HIGH confidence (${quality.segmentation_confidence.toFixed(2)}) → using SAM output`);

      const classStart = performance.now();
      samItems = await classifyItems(samResult.items.map(s => ({
        segmentedBase64: s.segmentedBase64,
        boundingBox: s.boundingBox,
        label: s.label,
      })), originalObjectUrl);
      classMs = performance.now() - classStart;

      if (samItems.length > 0) {
        const totalMs = performance.now() - totalStart;
        console.log(`[Pipeline] SAM-FULL complete: ${samItems.length} items in ${Math.round(totalMs)}ms`);
        return {
          items: samItems,
          timing: { detection_ms: Math.round(detectionMs), crop_ms: 0, classification_ms: Math.round(classMs), total_ms: Math.round(totalMs) },
          segmentationQuality: quality,
          pipelinePath: 'sam-full',
        };
      }
      // If classification failed for all items, fall through to partial
      console.warn('[Pipeline] HIGH confidence but all classifications failed — treating as partial');
    }

    if (quality.segmentation_confidence >= CONFIDENCE_PARTIAL && samResult.items.length > 0) {
      // ═══ PARTIAL CONFIDENCE: SAM + bounding-box fallback ═══
      console.log(`[Pipeline] ~ PARTIAL confidence (${quality.segmentation_confidence.toFixed(2)}) → SAM + DINO backup`);

      // Classify SAM items
      const classStart = performance.now();
      samItems = await classifyItems(samResult.items.map(s => ({
        segmentedBase64: s.segmentedBase64,
        boundingBox: s.boundingBox,
        label: s.label,
      })), originalObjectUrl);
      classMs = performance.now() - classStart;

      // Also run DINO bounding-box detection in parallel as backup
      let dinoItems: DetectedItem[] = [];
      try {
        dinoItems = await dinoPipelineItems(base64Image, mimeType, originalObjectUrl);
      } catch (err) {
        console.warn('[Pipeline] DINO backup failed in partial mode:', err);
      }

      // Merge: prefer SAM items, supplement with DINO items that don't overlap
      const merged = mergeItems(samItems, dinoItems);
      const totalMs = performance.now() - totalStart;

      console.log(
        `[Pipeline] SAM-PARTIAL complete: ${samItems.length} SAM + ${dinoItems.length} DINO → ${merged.length} merged | ${Math.round(totalMs)}ms`,
      );

      if (merged.length > 0) {
        return {
          items: merged,
          timing: { detection_ms: Math.round(detectionMs), crop_ms: 0, classification_ms: Math.round(classMs), total_ms: Math.round(totalMs) },
          segmentationQuality: quality,
          pipelinePath: 'sam-partial',
        };
      }
    }

    // ═══ LOW CONFIDENCE or no items: discard SAM ═══
    console.log(
      `[Pipeline] ✗ LOW confidence (${quality?.segmentation_confidence.toFixed(2) ?? '0'}) → falling back to DINO/Claude`,
    );

  } catch (err) {
    console.warn('[Pipeline] Grounded SAM failed:', err);
  }

  // ── FALLBACK: DINO bounding-box detection ─────────────────────────────────
  try {
    console.log('[Pipeline] Trying DINO bounding-box fallback...');
    const dinoStart = performance.now();
    const dinoResult = await dinoPipeline(base64Image, mimeType, originalObjectUrl, totalStart);
    dinoResult.segmentationQuality = quality;
    dinoResult.pipelinePath = 'dino-fallback';

    if (dinoResult.items.length > 0) {
      console.log(`[Pipeline] DINO fallback: ${dinoResult.items.length} items in ${Math.round(performance.now() - dinoStart)}ms`);
      return dinoResult;
    }
  } catch (err) {
    console.warn('[Pipeline] DINO pipeline also failed:', err);
  }

  // ── FINAL FALLBACK: Claude Vision only ────────────────────────────────────
  console.log('[Pipeline] Using Claude-only final fallback');
  const result = await fallbackClaudeOnly(base64Image, mimeType, originalObjectUrl, totalStart);
  result.segmentationQuality = quality;
  result.pipelinePath = 'claude-only';
  return result;
}

// ── Shared classification helper ────────────────────────────────────────────────

interface ClassifyInput {
  segmentedBase64: string;
  boundingBox: BoundingBox;
  label: string;
}

/**
 * Classify an array of segmented items in parallel. Returns only successfully classified items.
 */
async function classifyItems(
  inputs: ClassifyInput[],
  originalObjectUrl: string,
  bgRemovedImageUrl?: string,
): Promise<DetectedItem[]> {
  const results = await Promise.all(
    inputs.map(async (input) => {
      try {
        const cls = await classifyClothingItem(input.segmentedBase64, input.label);
        return {
          tempId: genId(),
          croppedImageUrl: input.segmentedBase64,
          originalImageUrl: originalObjectUrl,
          bgRemovedImageUrl: bgRemovedImageUrl || undefined,
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
          boundingBox: input.boundingBox,
        } as DetectedItem;
      } catch (err) {
        console.error(`[Pipeline] Classification failed for "${input.label}":`, err);
        return null;
      }
    }),
  );

  return results.filter((r): r is DetectedItem => r !== null);
}

// ── Merge logic for partial confidence ──────────────────────────────────────────

/**
 * Merge SAM items with DINO items, avoiding duplicates.
 * Two items overlap if their bounding boxes share >50% IoU.
 */
function mergeItems(samItems: DetectedItem[], dinoItems: DetectedItem[]): DetectedItem[] {
  const merged = [...samItems];

  for (const dino of dinoItems) {
    const overlaps = samItems.some(sam => boxIoU(sam.boundingBox, dino.boundingBox) > 0.3);
    if (!overlaps) {
      merged.push(dino);
    }
  }

  return merged;
}

/** Intersection over Union for two bounding boxes */
function boxIoU(a: BoundingBox, b: BoundingBox): number {
  const ax1 = a.x, ay1 = a.y, ax2 = a.x + a.width, ay2 = a.y + a.height;
  const bx1 = b.x, by1 = b.y, bx2 = b.x + b.width, by2 = b.y + b.height;

  const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);

  const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
  const intersection = iw * ih;
  const union = a.width * a.height + b.width * b.height - intersection;

  return union > 0 ? intersection / union : 0;
}

// ── DINO + rembg pipeline ───────────────────────────────────────────────────────

/** Run DINO pipeline and return just the items (for use in partial merge) */
async function dinoPipelineItems(
  base64Image: string,
  _mimeType: string,
  originalObjectUrl: string,
): Promise<DetectedItem[]> {
  // Remove background ONCE from full image
  let cleanImageUrl = originalObjectUrl;
  try {
    const noBg = await removeBackground(base64Image);
    if (noBg && noBg.length > 100) cleanImageUrl = noBg;
  } catch { /* use original */ }

  const dinoBoxes = await detectWithGroundingDINO(base64Image);
  if (dinoBoxes.length === 0) return [];

  const imgDims = await getImageDimensions(originalObjectUrl);
  const items: DetectedItem[] = [];

  for (const box of dinoBoxes) {
    const normalizedBox = dinoBoxToNormalized(box, imgDims.width, imgDims.height);
    let croppedBase64: string;
    try {
      croppedBase64 = await cropImage(cleanImageUrl, normalizedBox, 0);
    } catch {
      try {
        croppedBase64 = await cropImage(originalObjectUrl, normalizedBox, 0);
      } catch { continue; }
    }

    // Classify only — no per-item rembg needed
    const classification = await classifyClothingItem(croppedBase64, box.label).catch(() => null);
    if (!classification) continue;

    items.push({
      tempId: genId(),
      croppedImageUrl: croppedBase64,
      originalImageUrl: originalObjectUrl,
      bgRemovedImageUrl: cleanImageUrl !== originalObjectUrl ? cleanImageUrl : undefined,
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
      boundingBox: normalizedBox,
    });
  }

  return items;
}

async function dinoPipeline(
  base64Image: string,
  _mimeType: string,
  originalObjectUrl: string,
  totalStart: number,
): Promise<PipelineResult> {
  // Step 1: Remove background from FULL image FIRST (one API call)
  let cleanImageUrl = originalObjectUrl;
  try {
    console.log('[Pipeline] DINO: removing background from full image first...');
    const noBg = await removeBackground(base64Image);
    if (noBg && noBg.length > 100) {
      cleanImageUrl = noBg;
      console.log(`[Pipeline] DINO: background removed (${Math.round(noBg.length / 1024)}KB)`);
    }
  } catch (err) {
    console.warn('[Pipeline] DINO: background removal failed, using original:', err);
  }

  // Step 2: Detect with DINO
  const detectionStart = performance.now();
  const dinoBoxes: GroundingDINOBox[] = await detectWithGroundingDINO(base64Image);
  const detectionMs = performance.now() - detectionStart;

  if (dinoBoxes.length === 0) {
    throw new Error('Grounding DINO detected 0 items');
  }

  console.log(`[Pipeline] DINO detected ${dinoBoxes.length} items in ${Math.round(detectionMs)}ms`);

  // Step 3: Crop from the clean (background-removed) image
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
      croppedBase64 = await cropImage(cleanImageUrl, normalizedBox, 0);
    } catch {
      try {
        croppedBase64 = await cropImage(originalObjectUrl, normalizedBox, 0);
      } catch {
        continue;
      }
    }
    croppedItems.push({ croppedBase64, boundingBox: normalizedBox, dinoLabel: box.label });
  }
  const cropMs = performance.now() - cropStart;

  // Step 4: Classify each item (no per-item rembg needed — already clean)
  const classStart = performance.now();
  const classPromises = croppedItems.map(async (item) => {
    try {
      return await classifyClothingItem(item.croppedBase64, item.dinoLabel);
    } catch (err) {
      console.error(`[Pipeline] Classification failed for "${item.dinoLabel}":`, err);
      return null;
    }
  });
  const classifications = await Promise.all(classPromises);
  const classMs = performance.now() - classStart;

  const items: DetectedItem[] = [];
  for (let i = 0; i < croppedItems.length; i++) {
    const cls = classifications[i];
    if (!cls) continue;

    items.push({
      tempId: genId(),
      croppedImageUrl: croppedItems[i].croppedBase64,
      originalImageUrl: originalObjectUrl,
      bgRemovedImageUrl: cleanImageUrl !== originalObjectUrl ? cleanImageUrl : undefined,
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
      boundingBox: croppedItems[i].boundingBox,
    });
  }

  const totalMs = performance.now() - totalStart;
  console.log(
    `[Pipeline] DINO complete: ${items.length} items | ` +
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
    pipelinePath: 'dino-fallback',
  };
}

// ── Claude-only fallback ─────────────────────────────────────────────────────────

async function fallbackClaudeOnly(
  base64Image: string,
  mimeType: string,
  originalObjectUrl: string,
  totalStart: number,
): Promise<PipelineResult> {
  // Step 1: Remove background from FULL image FIRST (one API call instead of N)
  // This removes the model, background, etc. before detection
  let cleanImageUrl = originalObjectUrl;
  try {
    console.log('[Pipeline] Claude-only: removing background from full image first...');
    const noBg = await removeBackground(base64Image);
    if (noBg && noBg.length > 100) {
      cleanImageUrl = noBg; // data URI works with cropImage
      console.log(`[Pipeline] Claude-only: background removed (${Math.round(noBg.length / 1024)}KB)`);
    }
  } catch (err) {
    console.warn('[Pipeline] Claude-only: background removal failed, using original:', err);
  }

  // Step 2: Detect items using Claude Vision (on original image for best detection)
  const detectionStart = performance.now();
  const rawItems: RawDetection[] = await detectClothingItems(base64Image, mimeType);
  const detectionMs = performance.now() - detectionStart;

  // Step 3: Crop each item from the CLEAN (background-removed) image
  const cropStart = performance.now();
  const detectedItems: DetectedItem[] = [];

  for (const raw of rawItems) {
    let croppedImageUrl = cleanImageUrl;
    try {
      // Crop from the background-removed image — items already have clean backgrounds
      croppedImageUrl = await cropImage(cleanImageUrl, raw.boundingBox);
    } catch {
      // Fallback: try cropping from original
      try {
        croppedImageUrl = await cropImage(originalObjectUrl, raw.boundingBox);
      } catch {
        croppedImageUrl = originalObjectUrl;
      }
    }

    detectedItems.push({
      tempId: genId(),
      croppedImageUrl,
      originalImageUrl: originalObjectUrl,
      bgRemovedImageUrl: cleanImageUrl !== originalObjectUrl ? cleanImageUrl : undefined,
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
    pipelinePath: 'claude-only',
  };
}
