/**
 * Grounded SAM: detection + pixel-level segmentation in one Replicate call.
 * Combines Grounding DINO (text-based detection) with Meta SAM (mask generation).
 *
 * Returns per-item transparent-background images and bounding boxes — replaces
 * the old Grounding DINO → crop → rembg pipeline with a single API call.
 */

import { replicateCreate, replicatePoll } from '../apiHelper';
import type { BoundingBox } from '../types';

// schananas/grounded_sam on Replicate
const GROUNDED_SAM_VERSION =
  'ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c';

const MASK_PROMPT =
  'clothing, shirt, pants, shoes, jacket, dress, bag, hat, skirt, coat, sweater, jeans, boots, sneakers, blazer, cardigan, hoodie, shorts, sandals, scarf, belt';

const NEGATIVE_PROMPT = 'background, floor, wall, person, skin, body, face, hair, furniture';

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 40; // 60 seconds max

export interface GroundedSAMItem {
  segmentedBase64: string; // Transparent-background image (data URI)
  boundingBox: BoundingBox; // Normalised 0-1 box derived from mask
  label: string;
}

/**
 * Detect and segment clothing items using Grounded SAM.
 * Returns an array of segmented items with transparent backgrounds.
 */
export async function detectAndSegment(
  base64Image: string,
): Promise<GroundedSAMItem[]> {
  const dataUri = base64Image.startsWith('data:')
    ? base64Image
    : `data:image/jpeg;base64,${base64Image}`;

  // Create prediction
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

  // Poll for completion
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const result = await replicatePoll(pollUrl);

    if (result.status === 'failed' || result.status === 'canceled') {
      throw new Error(`Grounded SAM ${result.status}: ${result.error || 'unknown'}`);
    }

    if (result.status === 'succeeded') {
      return processOutput(result.output, dataUri);
    }
  }

  throw new Error('Grounded SAM: prediction timed out');
}

/**
 * Process Grounded SAM output.
 * The model returns an array of image URLs — typically:
 *  [0] = annotated overview image (bboxes drawn on original)
 *  [1..N] = individual mask images (white=object, black=background)
 *
 * We apply each mask to the original image on canvas to create
 * transparent-background items.
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

  // Skip the first image (annotated overview) — process masks only
  // If there's only 1 output, it IS the mask
  const maskUrls = outputUrls.length > 1 ? outputUrls.slice(1) : outputUrls;

  // Load the original image for compositing
  const originalImg = await loadImage(originalDataUri);
  const width = originalImg.naturalWidth;
  const height = originalImg.naturalHeight;

  const items: GroundedSAMItem[] = [];

  for (let i = 0; i < maskUrls.length; i++) {
    try {
      // Fetch mask image as base64
      const maskBase64 = await fetchImageAsBase64(maskUrls[i]);
      const maskImg = await loadImage(maskBase64);

      // Apply mask to original image
      const { segmentedBase64, boundingBox } = applyMask(
        originalImg, maskImg, width, height,
      );

      // Only keep items with reasonable bounding box size (>2% of image area)
      if (boundingBox.width * boundingBox.height > 0.02) {
        items.push({
          segmentedBase64,
          boundingBox,
          label: `clothing_${i}`, // Grounded SAM doesn't label individual masks
        });
      }
    } catch (err) {
      console.warn(`[GroundedSAM] Failed to process mask ${i}:`, err);
    }
  }

  return items;
}

/**
 * Apply a binary mask to the original image using canvas compositing.
 * White mask pixels = keep, black = transparent.
 * Also derives a bounding box from the non-transparent region.
 */
function applyMask(
  originalImg: HTMLImageElement,
  maskImg: HTMLImageElement,
  width: number,
  height: number,
): { segmentedBase64: string; boundingBox: BoundingBox } {
  // Draw original image
  const origCanvas = document.createElement('canvas');
  origCanvas.width = width;
  origCanvas.height = height;
  const origCtx = origCanvas.getContext('2d')!;
  origCtx.drawImage(originalImg, 0, 0, width, height);
  const origData = origCtx.getImageData(0, 0, width, height);

  // Draw mask (scale to same size as original)
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext('2d')!;
  maskCtx.drawImage(maskImg, 0, 0, width, height);
  const maskData = maskCtx.getImageData(0, 0, width, height);

  // Determine if mask is "normal" (white=keep) or "inverted" (black=keep)
  // by checking average brightness — if mostly white, it's inverted (background = white)
  let brightSum = 0;
  for (let i = 0; i < maskData.data.length; i += 4) {
    brightSum += maskData.data[i]; // Red channel
  }
  const avgBrightness = brightSum / (width * height);
  const inverted = avgBrightness > 128; // Mostly white = mask is inverted

  // Apply mask: set alpha based on mask brightness
  let minX = width, minY = height, maxX = 0, maxY = 0;

  for (let i = 0; i < origData.data.length; i += 4) {
    const maskVal = maskData.data[i]; // Red channel of mask (grayscale)
    const keep = inverted ? maskVal < 128 : maskVal > 128;

    if (keep) {
      // Keep this pixel, track bounding box
      const pixelIdx = i / 4;
      const px = pixelIdx % width;
      const py = Math.floor(pixelIdx / width);
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    } else {
      // Make transparent
      origData.data[i + 3] = 0;
    }
  }

  origCtx.putImageData(origData, 0, 0);

  // Crop to bounding box with 5% padding
  const pad = 0.05;
  const bw = maxX - minX;
  const bh = maxY - minY;
  const cropX = Math.max(0, Math.floor(minX - bw * pad));
  const cropY = Math.max(0, Math.floor(minY - bh * pad));
  const cropW = Math.min(width - cropX, Math.ceil(bw * (1 + pad * 2)));
  const cropH = Math.min(height - cropY, Math.ceil(bh * (1 + pad * 2)));

  // Create cropped canvas
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropW;
  cropCanvas.height = cropH;
  const cropCtx = cropCanvas.getContext('2d')!;
  cropCtx.drawImage(origCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  const segmentedBase64 = cropCanvas.toDataURL('image/png');

  // Normalised bounding box (0-1)
  const boundingBox: BoundingBox = {
    x: minX / width,
    y: minY / height,
    width: (maxX - minX) / width,
    height: (maxY - minY) / height,
  };

  return { segmentedBase64, boundingBox };
}

// ── Utility helpers ──────────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

async function fetchImageAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
