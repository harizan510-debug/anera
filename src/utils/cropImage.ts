import type { BoundingBox } from '../types';

/**
 * Crop a clothing item from a source image using a normalised bounding box.
 * Adds padding around the box so garment edges are never clipped.
 * Returns a base64 JPEG data URL (persistent — safe to store in localStorage).
 *
 * @param sourceUrl  Object URL or base64 data URL of the source photo
 * @param box        Normalised 0-1 bounding box from Claude
 * @param padding    Extra space to add around the box (default 6% of image dimensions)
 */
export function cropImage(
  sourceUrl: string,
  box: BoundingBox,
  padding = 0.06,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Expand box by padding, clamped to image bounds
      const px = Math.max(0, box.x - padding);
      const py = Math.max(0, box.y - padding);
      const pw = Math.min(1 - px, box.width + padding * 2);
      const ph = Math.min(1 - py, box.height + padding * 2);

      const srcX = Math.round(px * img.naturalWidth);
      const srcY = Math.round(py * img.naturalHeight);
      const srcW = Math.max(1, Math.round(pw * img.naturalWidth));
      const srcH = Math.max(1, Math.round(ph * img.naturalHeight));

      const canvas = document.createElement('canvas');
      canvas.width = srcW;
      canvas.height = srcH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(sourceUrl); // fallback: return original
        return;
      }
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
      // Preserve transparency: use PNG if source is PNG (e.g. after background removal)
      const isPng = sourceUrl.startsWith('data:image/png');
      resolve(isPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('cropImage: failed to load source image'));
    img.src = sourceUrl;
  });
}
