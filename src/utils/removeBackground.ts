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
    console.warn('[RemoveBG] No Replicate key — skipping');
    throw new Error('No Replicate key available');
  }

  const dataUri = base64Image.startsWith('data:')
    ? base64Image
    : `data:image/jpeg;base64,${base64Image}`;

  console.log(`[RemoveBG] Starting (image=${Math.round(dataUri.length / 1024)}KB)`);

  // Create prediction
  const prediction = await replicateCreate({
    version: REMBG_VERSION,
    input: { image: dataUri },
  });

  const pollUrl: string = (prediction.urls as Record<string, string>)?.get;
  if (!pollUrl) throw new Error('No poll URL in rembg response');

  console.log(`[RemoveBG] Prediction created, polling...`);

  // Poll for completion
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const result = await replicatePoll(pollUrl);

    if (result.status === 'failed' || result.status === 'canceled') {
      throw new Error(`rembg prediction ${result.status}: ${result.error || 'unknown'}`);
    }

    if (result.status === 'succeeded') {
      const outputUrl = typeof result.output === 'string'
        ? result.output
        : Array.isArray(result.output)
          ? String(result.output[0])
          : null;

      if (!outputUrl) throw new Error('rembg succeeded but no output URL');

      console.log(`[RemoveBG] Succeeded after ${attempt + 1} polls, fetching result...`);

      // Fetch the result image and convert to base64 PNG (preserve transparency)
      const imgRes = await fetch(outputUrl);
      if (!imgRes.ok) throw new Error(`Failed to fetch rembg output: ${imgRes.status}`);
      const blob = await imgRes.blob();
      // Force PNG type to guarantee transparency is preserved in data URI
      const pngBlob = blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' });
      const result64 = await blobToBase64(pngBlob);
      console.log(`[RemoveBG] Done (${Math.round(result64.length / 1024)}KB, type=${pngBlob.type})`);
      return result64;
    }

    if (attempt > 0 && attempt % 10 === 0) {
      console.log(`[RemoveBG] Still waiting... poll ${attempt}/${MAX_POLL_ATTEMPTS}`);
    }
  }

  throw new Error('rembg timed out after 45 seconds');
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
