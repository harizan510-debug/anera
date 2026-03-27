/**
 * Background removal using Replicate's rembg model.
 * Falls back to original image if removal fails.
 */

import { replicateCreate, replicatePoll, hasReplicateKey } from '../apiHelper';

const REMBG_VERSION = 'fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003';
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 30; // 45 seconds max

/**
 * Remove background from an image using Replicate's rembg model.
 * Returns a base64 data URI of the result (PNG with transparency).
 * Falls back to the original image if removal fails.
 */
export async function removeBackground(base64Image: string): Promise<string> {
  if (!hasReplicateKey()) {
    console.log('[RemoveBG] No Replicate key — skipping background removal');
    return base64Image;
  }

  try {
    const dataUri = base64Image.startsWith('data:')
      ? base64Image
      : `data:image/jpeg;base64,${base64Image}`;

    // Create prediction
    const prediction = await replicateCreate({
      version: REMBG_VERSION,
      input: { image: dataUri },
    });

    const pollUrl: string = (prediction.urls as Record<string, string>)?.get;
    if (!pollUrl) {
      console.warn('[RemoveBG] No poll URL — skipping');
      return base64Image;
    }

    // Poll for completion
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      const result = await replicatePoll(pollUrl);

      if (result.status === 'failed' || result.status === 'canceled') {
        console.warn(`[RemoveBG] Prediction ${result.status}`);
        return base64Image;
      }

      if (result.status === 'succeeded') {
        const outputUrl = typeof result.output === 'string'
          ? result.output
          : Array.isArray(result.output)
            ? String(result.output[0])
            : null;

        if (!outputUrl) {
          console.warn('[RemoveBG] No output URL');
          return base64Image;
        }

        // Fetch the result image and convert to base64
        try {
          const imgRes = await fetch(outputUrl);
          const blob = await imgRes.blob();
          return await blobToBase64(blob);
        } catch {
          console.warn('[RemoveBG] Failed to fetch result image');
          return base64Image;
        }
      }
    }

    console.warn('[RemoveBG] Timed out');
    return base64Image;
  } catch (err) {
    console.warn('[RemoveBG] Error:', err);
    return base64Image;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
