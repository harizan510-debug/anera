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
 *
 * The model always returns exactly 4 images:
 *  [0] = annotated_picture_mask.jpg — original with positive mask overlay
 *  [1] = neg_annotated_picture_mask.jpg — original with negative mask overlay
 *  [2] = mask.jpg — binary mask (WHITE = detected clothing, BLACK = background)
 *  [3] = inverted_mask.jpg — inverted binary mask
 *
 * We use mask.jpg [2] and apply it to the original image on canvas
 * to create a transparent-background clothing cutout.
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

  // The mask is at index 2 (mask.jpg: white=clothing, black=background)
  // If output has fewer than 3 items, use the last one as the mask
  const maskUrl = outputUrls.length >= 3 ? outputUrls[2] : outputUrls[outputUrls.length - 1];

  // Load the original image for compositing
  const originalImg = await loadImage(originalDataUri);
  const width = originalImg.naturalWidth;
  const height = originalImg.naturalHeight;

  try {
    // Fetch mask image
    const maskBase64 = await fetchImageAsBase64(maskUrl);
    const maskImg = await loadImage(maskBase64);

    // The mask may contain multiple clothing items (e.g., shirt + pants).
    // Split into connected components and create one item per component.
    const components = splitMaskIntoComponents(maskImg, width, height);
    console.log(`[GroundedSAM] Found ${components.length} connected components in mask`);

    const items: GroundedSAMItem[] = [];

    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      // Only keep components that are >2% of image area
      if (comp.boundingBox.width * comp.boundingBox.height < 0.02) continue;

      // Apply this component's mask to the original image
      const { segmentedBase64 } = applyComponentMask(
        originalImg, comp.mask, comp.pixelBounds, width, height,
      );

      items.push({
        segmentedBase64,
        boundingBox: comp.boundingBox,
        label: `clothing_${i}`,
      });
    }

    // If component splitting failed or found nothing, fall back to full mask
    if (items.length === 0) {
      const { segmentedBase64, boundingBox } = applyMask(
        originalImg, maskImg, width, height,
      );
      if (boundingBox.width * boundingBox.height > 0.02) {
        items.push({ segmentedBase64, boundingBox, label: 'clothing' });
      }
    }

    return items;
  } catch (err) {
    console.warn('[GroundedSAM] Failed to process mask:', err);
    return [];
  }
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

// ── Connected component splitting ────────────────────────────────────────────

interface MaskComponent {
  mask: boolean[]; // true = this pixel belongs to this component
  boundingBox: BoundingBox;
  pixelBounds: { minX: number; minY: number; maxX: number; maxY: number };
  pixelCount: number;
}

/**
 * Split a binary mask image into connected components using flood fill.
 * Each component becomes a separate clothing item.
 */
function splitMaskIntoComponents(
  maskImg: HTMLImageElement,
  width: number,
  height: number,
): MaskComponent[] {
  // Get mask pixel data
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(maskImg, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);

  // Create binary mask (true = white = clothing)
  const binary = new Uint8Array(width * height);
  for (let i = 0; i < binary.length; i++) {
    binary[i] = data.data[i * 4] > 128 ? 1 : 0;
  }

  // Track visited pixels
  const visited = new Uint8Array(width * height);
  const components: MaskComponent[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (binary[idx] === 0 || visited[idx]) continue;

      // Flood fill to find connected component
      const compMask = new Array<boolean>(width * height).fill(false);
      let minX = x, minY = y, maxX = x, maxY = y;
      let count = 0;
      const stack = [idx];

      while (stack.length > 0) {
        const ci = stack.pop()!;
        if (visited[ci] || binary[ci] === 0) continue;
        visited[ci] = 1;
        compMask[ci] = true;
        count++;

        const cx = ci % width;
        const cy = Math.floor(ci / width);
        minX = Math.min(minX, cx);
        minY = Math.min(minY, cy);
        maxX = Math.max(maxX, cx);
        maxY = Math.max(maxY, cy);

        // 4-connected neighbours
        if (cx > 0) stack.push(ci - 1);
        if (cx < width - 1) stack.push(ci + 1);
        if (cy > 0) stack.push(ci - width);
        if (cy < height - 1) stack.push(ci + width);
      }

      // Skip tiny components (noise) — need at least 0.5% of image
      if (count < width * height * 0.005) continue;

      components.push({
        mask: compMask,
        boundingBox: {
          x: minX / width,
          y: minY / height,
          width: (maxX - minX) / width,
          height: (maxY - minY) / height,
        },
        pixelBounds: { minX, minY, maxX, maxY },
        pixelCount: count,
      });
    }
  }

  // Sort by area (largest first)
  components.sort((a, b) => b.pixelCount - a.pixelCount);

  return components;
}

/**
 * Apply a single component's boolean mask to the original image.
 * Returns a cropped transparent-background image.
 */
function applyComponentMask(
  originalImg: HTMLImageElement,
  mask: boolean[],
  pixelBounds: { minX: number; minY: number; maxX: number; maxY: number },
  width: number,
  height: number,
): { segmentedBase64: string } {
  // Draw original
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(originalImg, 0, 0, width, height);
  const imgData = ctx.getImageData(0, 0, width, height);

  // Apply mask: make non-component pixels transparent
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) {
      imgData.data[i * 4 + 3] = 0; // Set alpha to 0
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Crop to bounding box with 5% padding
  const { minX, minY, maxX, maxY } = pixelBounds;
  const bw = maxX - minX;
  const bh = maxY - minY;
  const pad = 0.05;
  const cropX = Math.max(0, Math.floor(minX - bw * pad));
  const cropY = Math.max(0, Math.floor(minY - bh * pad));
  const cropW = Math.min(width - cropX, Math.ceil(bw * (1 + pad * 2)));
  const cropH = Math.min(height - cropY, Math.ceil(bh * (1 + pad * 2)));

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropW;
  cropCanvas.height = cropH;
  const cropCtx = cropCanvas.getContext('2d')!;
  cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  return { segmentedBase64: cropCanvas.toDataURL('image/png') };
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
