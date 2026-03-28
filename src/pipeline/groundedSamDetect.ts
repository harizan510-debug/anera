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

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 90; // 3 minutes max — Grounded SAM cold starts take ~2 min

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
  // Compress large images to avoid Replicate payload limits and speed up upload
  const dataUri = await compressForUpload(base64Image);
  console.log(`[GroundedSAM] Sending image (${Math.round(dataUri.length / 1024)}KB)`);

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

  // Poll for completion — cold starts can take 2+ minutes
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

    // Log progress every 10 polls
    if (attempt > 0 && attempt % 10 === 0) {
      console.log(`[GroundedSAM] Still waiting... poll ${attempt}/${MAX_POLL_ATTEMPTS} (status: ${result.status})`);
    }
  }

  throw new Error('Grounded SAM: prediction timed out after 3 minutes');
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
    const { components, labels } = splitMaskIntoComponents(maskImg, width, height);
    console.log(`[GroundedSAM] Found ${components.length} connected components in mask`);

    const items: GroundedSAMItem[] = [];

    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      // Only keep components that are >2% of image area
      if (comp.boundingBox.width * comp.boundingBox.height < 0.02) continue;

      // Apply this component's mask to the original image
      const { segmentedBase64 } = applyComponentMask(
        originalImg, labels, comp.labelId, comp.pixelBounds, width, height,
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

// ── Connected component labeling ─────────────────────────────────────────────

interface MaskComponent {
  labelId: number;
  boundingBox: BoundingBox;
  pixelBounds: { minX: number; minY: number; maxX: number; maxY: number };
  pixelCount: number;
}

/**
 * Split a binary mask into connected components using two-pass labeling.
 * Much more memory-efficient than flood fill for large images.
 */
function splitMaskIntoComponents(
  maskImg: HTMLImageElement,
  width: number,
  height: number,
): { components: MaskComponent[]; labels: Int32Array } {
  // Get mask pixel data
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(maskImg, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);

  const totalPixels = width * height;

  // Create binary mask (1 = white = clothing, 0 = background)
  const binary = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    binary[i] = data.data[i * 4] > 128 ? 1 : 0;
  }

  // Two-pass connected component labeling (much faster than flood fill)
  const labels = new Int32Array(totalPixels); // 0 = background, 1+ = component ID
  const parent = new Int32Array(totalPixels + 1); // Union-Find parent
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  let nextLabel = 1;

  // Find root with path compression
  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // Pass 1: Assign provisional labels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (binary[idx] === 0) continue;

      const above = y > 0 ? labels[idx - width] : 0;
      const left = x > 0 ? labels[idx - 1] : 0;

      if (above === 0 && left === 0) {
        labels[idx] = nextLabel++;
      } else if (above !== 0 && left === 0) {
        labels[idx] = above;
      } else if (above === 0 && left !== 0) {
        labels[idx] = left;
      } else {
        labels[idx] = Math.min(above, left);
        if (above !== left) union(above, left);
      }
    }
  }

  // Pass 2: Resolve labels & collect stats
  const statsMap = new Map<number, { minX: number; minY: number; maxX: number; maxY: number; count: number }>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (labels[idx] === 0) continue;
      const root = find(labels[idx]);
      labels[idx] = root;

      let s = statsMap.get(root);
      if (!s) { s = { minX: x, minY: y, maxX: x, maxY: y, count: 0 }; statsMap.set(root, s); }
      if (x < s.minX) s.minX = x;
      if (y < s.minY) s.minY = y;
      if (x > s.maxX) s.maxX = x;
      if (y > s.maxY) s.maxY = y;
      s.count++;
    }
  }

  // Convert to components, filter noise
  const minPixels = totalPixels * 0.005; // at least 0.5% of image
  const components: MaskComponent[] = [];

  for (const [labelId, s] of statsMap) {
    if (s.count < minPixels) continue;
    components.push({
      labelId,
      boundingBox: {
        x: s.minX / width,
        y: s.minY / height,
        width: (s.maxX - s.minX) / width,
        height: (s.maxY - s.minY) / height,
      },
      pixelBounds: { minX: s.minX, minY: s.minY, maxX: s.maxX, maxY: s.maxY },
      pixelCount: s.count,
    });
  }

  components.sort((a, b) => b.pixelCount - a.pixelCount);
  return { components, labels };
}

/**
 * Apply a single component's mask to the original image using label data.
 * Returns a cropped transparent-background image.
 */
function applyComponentMask(
  originalImg: HTMLImageElement,
  labels: Int32Array,
  labelId: number,
  pixelBounds: { minX: number; minY: number; maxX: number; maxY: number },
  width: number,
  height: number,
): { segmentedBase64: string } {
  // Crop region with 5% padding
  const { minX, minY, maxX, maxY } = pixelBounds;
  const bw = maxX - minX;
  const bh = maxY - minY;
  const pad = 0.05;
  const cropX = Math.max(0, Math.floor(minX - bw * pad));
  const cropY = Math.max(0, Math.floor(minY - bh * pad));
  const cropW = Math.min(width - cropX, Math.ceil(bw * (1 + pad * 2)));
  const cropH = Math.min(height - cropY, Math.ceil(bh * (1 + pad * 2)));

  // Draw original cropped region
  const canvas = document.createElement('canvas');
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(originalImg, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  const imgData = ctx.getImageData(0, 0, cropW, cropH);

  // Make non-component pixels transparent
  for (let cy = 0; cy < cropH; cy++) {
    for (let cx = 0; cx < cropW; cx++) {
      const srcIdx = (cropY + cy) * width + (cropX + cx);
      if (labels[srcIdx] !== labelId) {
        const pixIdx = (cy * cropW + cx) * 4;
        imgData.data[pixIdx + 3] = 0;
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);

  return { segmentedBase64: canvas.toDataURL('image/png') };
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

/**
 * Compress large images before sending to Replicate.
 * Phone cameras produce 5-10MB images; Replicate works fine with ~1MP.
 */
async function compressForUpload(base64Image: string): Promise<string> {
  const dataUri = base64Image.startsWith('data:')
    ? base64Image
    : `data:image/jpeg;base64,${base64Image}`;

  // If already small enough (<500KB), use as-is
  if (dataUri.length < 500_000) return dataUri;

  const img = await loadImage(dataUri);
  const MAX_DIM = 1200; // Max width or height

  let { naturalWidth: w, naturalHeight: h } = img;
  if (w > MAX_DIM || h > MAX_DIM) {
    const scale = MAX_DIM / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL('image/jpeg', 0.85);
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
